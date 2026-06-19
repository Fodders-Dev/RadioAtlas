import 'dotenv/config';
import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bot, Context, InlineKeyboard, InputFile } from 'grammy';
import ffmpegStaticPath from 'ffmpeg-static';
import { recordReachability } from './botReachability.js';
import { forwardBillingWebhook } from './billingForward.js';
import { resolveInlineQuery } from './inlineQuery.js';
import { buildStationStreamTargets } from './stationStreams.js';
import {
  clampDuration,
  createRecordingLimiter,
  DURATION_PRESETS_SEC,
  formatMskTimestamp,
  getStationById,
  parseStartPayload,
  recordStream,
  resolveFfmpegPath,
  searchStations,
  type RecordStation
} from './recordStream.js';
import {
  buildGiftPayload,
  buildPremiumPayload,
  buildSharePayload,
  buildStartPayload,
  buildSupportPayload
} from './replyPayloads.js';
import {
  AI_FALLBACK_TEXT,
  buildAiButtons,
  createAiLimiter,
  isAiEligibleMessage,
  requestAiChat
} from './aiChat.js';
import { createChatHistory } from './chatHistory.js';
import { createBotUrlRuntime } from './urlRuntime.js';

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is missing');
}

const internalWebhookToken = process.env.INTERNAL_WEBHOOK_TOKEN || '';
if (!internalWebhookToken) {
  // T0.2b: forward will fail, but users now receive an apology reply
  // (with the support handle + purchase ID) instead of silent
  // disappointment. Set the env to restore the happy path.
  console.warn(
    'INTERNAL_WEBHOOK_TOKEN is missing - billing webhook forwards will fail; users will receive apology copy until env is set'
  );
}

// T0.2b: support handle for the apology copy when the forward fails.
// Default is the project owner's TG handle; override via SUPPORT_HANDLE
// once a dedicated @radioatlas_support account exists.
const supportHandle = process.env.SUPPORT_HANDLE?.trim() || '@ahjkuio';

// «Лира» AI companion. Gated on AI_ENABLED (the bot never holds the DeepSeek
// key — it forwards to the api's internal endpoint). When off, the message:text
// handler is NOT registered, so the bot ignores free text exactly like today.
const aiEnabled = process.env.AI_ENABLED === '1';

const { apiUrl, webAppUrl, withSharedApi, withMiniAppParam } = createBotUrlRuntime({
  apiUrl: process.env.API_URL,
  webAppUrl: process.env.WEBAPP_URL,
  sourceCommit: process.env.SOURCE_COMMIT
});

const bot = new Bot(token);

const miniAppKeyboard = (label: string, param: string) =>
  webAppUrl ? new InlineKeyboard().webApp(label, withMiniAppParam(param)) : undefined;

const keyboardFromPayload = (payload: { buttonLabel?: string; buttonUrl?: string }) =>
  payload.buttonLabel && payload.buttonUrl
    ? new InlineKeyboard().webApp(payload.buttonLabel, payload.buttonUrl)
    : undefined;

const syncMenuButton = async () => {
  if (!webAppUrl) {
    console.warn('WEBAPP_URL is not configured; Telegram menu button sync skipped');
    return;
  }
  const targetUrl = withSharedApi(webAppUrl);
  const targetButton = {
    type: 'web_app' as const,
    text: 'RadioAtlas',
    web_app: {
      url: targetUrl
    }
  };

  const currentButton = await bot.api.getChatMenuButton();
  const currentUrl = currentButton.type === 'web_app' ? currentButton.web_app.url : '';
  const currentText = currentButton.type === 'web_app' ? currentButton.text : '';

  if (currentButton.type === 'web_app' && currentUrl === targetUrl && currentText === targetButton.text) {
    console.log(`Telegram menu button already points to ${targetUrl}`);
    return;
  }

  await bot.api.setChatMenuButton({
    menu_button: targetButton
  });
  console.log(`Synced Telegram menu button to ${targetUrl}`);
};

// ---------------------------------------------------------------------------
// Recording (PR1): /record <query> → pick station → pick duration → record the
// stream forward N minutes and send the MP3. All fetch/spawn/ffmpeg logic is in
// recordStream.ts (unit-tested with mock fetch + mock spawn). This file is the
// grammy glue: keyboards, callbacks, progress message, and sending the file.
// ---------------------------------------------------------------------------
const recordFetch = globalThis.fetch.bind(globalThis);
const ffmpegPath = resolveFfmpegPath({
  env: process.env,
  existsSync,
  staticPath: (ffmpegStaticPath as unknown as string | null) ?? null
});
// Confirm the chosen binary in the prod log (system ffmpeg vs bundled fallback).
console.log(`record: using ffmpeg at ${ffmpegPath ?? '(none found)'}`);
const recordingLimiter = createRecordingLimiter();
const activeRecordings = new Map<string, { controller: AbortController }>();
const DURATION_LABELS: Record<number, string> = { 300: '5 мин', 900: '15 мин', 1800: '30 мин' };

const stationPickKeyboard = (stations: RecordStation[]) => {
  const keyboard = new InlineKeyboard();
  for (const station of stations) {
    keyboard.text(station.name.slice(0, 48), `rec:${station.stationuuid}`).row();
  }
  return keyboard;
};

const durationKeyboard = (stationId: string) => {
  const keyboard = new InlineKeyboard();
  for (const seconds of DURATION_PRESETS_SEC) {
    keyboard.text(DURATION_LABELS[seconds] ?? `${Math.round(seconds / 60)} мин`, `recd:${stationId}:${seconds}`);
  }
  return keyboard;
};

const recordErrorText = (reason: string) => {
  switch (reason) {
    case 'too-large':
      return 'Запись получилась слишком большой для Telegram. Выбери длительность поменьше.';
    case 'no-ffmpeg':
    case 'no-candidates':
      return 'Запись этой станции сейчас недоступна. Попробуй другую.';
    default:
      return 'Не получилось записать эфир — поток не отвечает. Попробуй другую станцию или позже.';
  }
};

// Reusable by both the in-chat `rec:` callback and the PR2 Mini-App deep link:
// resolve a station by id and show the duration keyboard.
const presentStationForRecording = async (ctx: Context, stationId: string, canEdit: boolean) => {
  const station = await getStationById(stationId, { fetch: recordFetch, apiUrl });
  if (!station) {
    await ctx.reply('Не нашёл станцию. Попробуй ещё раз через /record.');
    return;
  }
  const text = `Станция «${station.name}». На сколько записать эфир?`;
  const markup = durationKeyboard(station.stationuuid);
  if (canEdit) {
    const edited = await ctx
      .editMessageText(text, { reply_markup: markup })
      .then(() => true)
      .catch(() => false);
    if (edited) return;
  }
  await ctx.reply(text, { reply_markup: markup });
};

// Start the actual recording for a resolved station + chosen duration. Shared by
// the in-chat flow and (PR2) the Mini-App flow.
const runRecording = async (ctx: Context, station: RecordStation, durationSec: number) => {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId || !chatId) return;

  if (!recordingLimiter.tryAcquire(userId)) {
    await ctx.reply('Уже идёт запись. Дождись её окончания и попробуй снова.');
    return;
  }

  const candidates = buildStationStreamTargets(station);
  if (!candidates.length) {
    recordingLimiter.release(userId);
    await ctx.reply('У этой станции нет доступного потока для записи.');
    return;
  }

  const jobId = randomUUID().slice(0, 8);
  const controller = new AbortController();
  activeRecordings.set(jobId, { controller });
  const outputPath = join(tmpdir(), `radioatlas-rec-${randomUUID()}.mp3`);
  const minutes = Math.round(durationSec / 60);
  let progressMessageId: number | undefined;

  try {
    const progress = await ctx.reply(
      `🔴 Пишу эфир «${station.name}» — ${minutes} мин. Пришлю файл, когда будет готов.`,
      { reply_markup: new InlineKeyboard().text('⏹ Отменить', `reccancel:${jobId}`) }
    );
    progressMessageId = progress.message_id;

    const result = await recordStream(
      { streamCandidates: candidates, durationSec, stationName: station.name, outputPath },
      {
        ffmpegPath,
        spawn: (command, args) => nodeSpawn(command, args, { stdio: 'ignore' }),
        probeSize: async (path) => {
          try {
            return (await stat(path)).size;
          } catch {
            return 0;
          }
        },
        signal: controller.signal,
        log: (line) => console.warn(line)
      }
    );

    if (result.ok) {
      await ctx.replyWithAudio(new InputFile(outputPath), {
        title: `${station.name} — ${formatMskTimestamp(new Date())} МСК`,
        performer: station.name,
        duration: durationSec
      });
    } else if (result.reason !== 'cancelled') {
      await ctx.reply(recordErrorText(result.reason));
    }
  } catch (error) {
    console.error('record: unexpected failure', error);
    try {
      await ctx.reply('Не получилось записать эфир. Попробуй ещё раз.');
    } catch {
      /* user closed the chat */
    }
  } finally {
    activeRecordings.delete(jobId);
    recordingLimiter.release(userId);
    if (progressMessageId !== undefined) {
      try {
        await ctx.api.deleteMessage(chatId, progressMessageId);
      } catch {
        /* progress message already gone */
      }
    }
    try {
      await rm(outputPath, { force: true });
    } catch {
      /* temp already cleaned */
    }
  }
};

bot.command('record', async (ctx) => {
  const query = ctx.match.toString().trim();
  if (!query) {
    await ctx.reply('Напиши, какую станцию записать: /record <название>. Например: /record lofi');
    return;
  }
  const stations = await searchStations(query, { fetch: recordFetch, apiUrl });
  if (!stations.length) {
    await ctx.reply(`Не нашёл станцию по запросу «${query}». Попробуй другое название.`);
    return;
  }
  await ctx.reply('Выбери станцию для записи эфира:', {
    reply_markup: stationPickKeyboard(stations)
  });
});

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;

  if (data.startsWith('rec:')) {
    await ctx.answerCallbackQuery();
    await presentStationForRecording(ctx, data.slice(4), true);
    return;
  }

  if (data.startsWith('recd:')) {
    await ctx.answerCallbackQuery();
    const [, stationId, secondsRaw] = data.split(':');
    const station = await getStationById(stationId, { fetch: recordFetch, apiUrl });
    if (!station) {
      await ctx.reply('Не нашёл станцию. Попробуй ещё раз через /record.');
      return;
    }
    await ctx.editMessageReplyMarkup().catch(() => {});
    await runRecording(ctx, station, clampDuration(Number(secondsRaw)));
    return;
  }

  if (data.startsWith('reccancel:')) {
    const job = activeRecordings.get(data.slice('reccancel:'.length));
    job?.controller.abort();
    await ctx.answerCallbackQuery({ text: job ? 'Отменяю запись…' : 'Запись уже завершена' });
    return;
  }

  await ctx.answerCallbackQuery();
});

bot.command('start', async (ctx) => {
  // PR2: a `?start=rec_<stationId>` deep link from the Mini-App "Записать эфир"
  // button enters the recording flow (resolve station → duration keyboard);
  // every other start payload keeps the normal onboarding reply.
  const startPayload = parseStartPayload(ctx.match.toString());
  if (startPayload.kind === 'record') {
    await presentStationForRecording(ctx, startPayload.stationId, false);
    return;
  }

  const payload = buildStartPayload(
    {
      webAppUrl,
      withSharedApi,
      withMiniAppParam
    },
    {
      deepLink: process.env.WEBAPP_DEEPLINK,
      username: ctx.me?.username
    }
  );

  await ctx.reply(payload.text, {
    reply_markup: keyboardFromPayload(payload)
  });

  // R1 (PR-A): record DM-reachability AFTER the reply — fail-safe, fire-and-
  // forget. recordReachability never throws/rejects, so onboarding is never
  // blocked even if the API is down. No message is sent to the user here.
  void recordReachability(
    { fetch, apiUrl, internalWebhookToken, log: (line) => console.warn(line) },
    ctx.from?.id
  );
});

bot.command('support', async (ctx) => {
  const payload = buildSupportPayload({ webAppUrl, withSharedApi, withMiniAppParam });
  await ctx.reply(payload.text, {
    reply_markup: keyboardFromPayload(payload)
  });
});

bot.command('premium', async (ctx) => {
  const payload = buildPremiumPayload({ webAppUrl, withSharedApi, withMiniAppParam });
  await ctx.reply(payload.text, {
    reply_markup: keyboardFromPayload(payload)
  });
});

bot.command('gift', async (ctx) => {
  const payload = buildGiftPayload(
    { webAppUrl, withSharedApi, withMiniAppParam },
    ctx.message?.text?.split(' ').slice(1).join(' ')
  );
  await ctx.reply(payload.text, {
    reply_markup: keyboardFromPayload(payload)
  });
});

bot.command('share', async (ctx) => {
  const payload = buildSharePayload(ctx.message?.text?.split(' ').slice(1).join(' '));
  await ctx.reply(payload.text);
});

// T_share_2: inline mode — `@radioatlasbot <query>` in any chat returns
// stations as article results that send a self-contained message + a URL button
// deep-linking into the Mini App. Inert until the owner runs BotFather /setinline.
// All fetch/format logic is in resolveInlineQuery (unit-tested with a mock fetch).
bot.on('inline_query', async (ctx) => {
  const { results, cacheTime } = await resolveInlineQuery(
    { query: ctx.inlineQuery.query, username: ctx.me?.username },
    { fetch: globalThis.fetch.bind(globalThis), apiUrl }
  );
  await ctx.answerInlineQuery(results, { cache_time: cacheTime });
});

bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

bot.on('message:successful_payment', async (ctx) => {
  // Telegram delivers successful_payment over the long-poll connection
  // authenticated by BOT_TOKEN, so the source is trusted by transport.
  // The forward logic is in billingForward.ts so we can unit-test the
  // intent + structured log shape without booting grammy.
  const payment = ctx.message.successful_payment;
  const result = await forwardBillingWebhook(
    {
      invoicePayload: payment.invoice_payload,
      telegramChargeId: payment.telegram_payment_charge_id
    },
    {
      fetch: globalThis.fetch.bind(globalThis),
      apiUrl,
      internalWebhookToken,
      webAppUrl,
      supportHandle,
      // Single-line JSON to stderr; console.error appends the newline.
      log: (line) => console.error(line)
    }
  );

  if (result.kind === 'success') {
    await ctx.reply(result.replyText, {
      reply_markup: result.showKeyboard
        ? miniAppKeyboard('Открыть RadioAtlas', 'premium-success')
        : undefined
    });
    return;
  }

  // Apology copy uses <code>…</code> for the purchase / charge ID so it
  // renders as monospace tap-to-copy in the Telegram client.
  await ctx.reply(result.replyText, { parse_mode: 'HTML' });
});

// «Лира» — free-text companion. Registered LAST (grammy matches in order) and
// only when AI is enabled. Commands (/...) and non-private chats are skipped, so
// this never shadows the record/start/billing flows.
if (aiEnabled) {
  // Per-user in-memory limiter (DI factory in aiChat.ts, prune-on-empty): one
  // in-flight reply per user, ~10/min, plus a global in-flight cap — so a flood
  // can't fan out into a burst of DeepSeek calls.
  const aiLimiter = createAiLimiter({
    windowMs: 60_000,
    maxPerWindow: 10,
    maxInflight: 8,
    now: () => Date.now()
  });
  // Per-user conversation memory so «Лира» follows the thread instead of treating
  // every message as new (the brain already consumes history; the bot just has to
  // build it). In-memory, bounded, idle-expiring — see chatHistory.ts.
  const aiHistory = createChatHistory({ now: () => Date.now() });

  bot.on('message:text', async (ctx) => {
    if (!isAiEligibleMessage({ text: ctx.message.text, chatType: ctx.chat?.type })) return;
    const userId = String(ctx.from?.id || '');
    if (!userId) return;

    const verdict = aiLimiter.verdict(userId);
    if (verdict === 'busy') {
      await ctx.reply('Секунду, я ещё думаю над прошлым — сейчас отвечу.');
      return;
    }
    if (verdict === 'flood') {
      await ctx.reply('Ой, как много всего сразу — дай мне чуть выдохнуть, и продолжим.');
      return;
    }

    aiLimiter.acquire(userId);
    try {
      await ctx.replyWithChatAction('typing');
      const result = await requestAiChat(
        { telegramId: userId, text: ctx.message.text, history: aiHistory.get(userId) },
        { fetch: globalThis.fetch.bind(globalThis), apiUrl, internalWebhookToken }
      );
      if (!result) {
        await ctx.reply(AI_FALLBACK_TEXT);
        return;
      }
      // Remember this exchange so the next message has context (the goldfish-memory fix).
      aiHistory.record(userId, ctx.message.text, result.reply);
      const buttons = buildAiButtons(result, ctx.me?.username || '');
      await ctx.reply(result.reply, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: buttons.length ? InlineKeyboard.from(buttons) : undefined
      });
    } catch (err) {
      console.error('ai chat handler error', err);
      try {
        await ctx.reply(AI_FALLBACK_TEXT);
      } catch {
        // ignore secondary failure
      }
    } finally {
      aiLimiter.release(userId);
    }
  });
}

bot.catch((err) => {
  console.error('Bot error', err);
});

try {
  await syncMenuButton();
} catch (error) {
  console.error('Failed to sync Telegram menu button', error);
}

bot.start();
