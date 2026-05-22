import 'dotenv/config';
import { Bot, InlineKeyboard } from 'grammy';
import { forwardBillingWebhook } from './billingForward.js';
import {
  buildGiftPayload,
  buildPremiumPayload,
  buildSharePayload,
  buildStartPayload,
  buildSupportPayload
} from './replyPayloads.js';
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

bot.command('start', async (ctx) => {
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

bot.catch((err) => {
  console.error('Bot error', err);
});

try {
  await syncMenuButton();
} catch (error) {
  console.error('Failed to sync Telegram menu button', error);
}

bot.start();
