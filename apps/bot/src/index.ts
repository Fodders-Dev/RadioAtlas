import 'dotenv/config';
import { Bot, InlineKeyboard } from 'grammy';
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
  const payment = ctx.message.successful_payment;
  const purchaseId = payment.invoice_payload?.trim();
  if (!purchaseId || !apiUrl) {
    return;
  }
  try {
    await fetch(`${apiUrl}/billing/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        purchaseId,
        telegramChargeId: payment.telegram_payment_charge_id
      })
    });
    if (webAppUrl) {
      await ctx.reply('Покупка подтверждена. Открой RadioAtlas, Premium уже должен примениться.', {
        reply_markup: miniAppKeyboard('Открыть RadioAtlas', 'premium-success')
      });
    }
  } catch (error) {
    console.error('Payment webhook forward failed', error);
  }
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
