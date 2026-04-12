import 'dotenv/config';
import { Bot, InlineKeyboard } from 'grammy';

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is missing');
}

const webAppUrl = process.env.WEBAPP_URL;
const apiUrl = (process.env.API_URL || '').replace(/\/+$/, '');
const bot = new Bot(token);

const withMiniAppParam = (param: string) => {
  if (!webAppUrl) return '';
  const divider = webAppUrl.includes('?') ? '&' : '?';
  return `${webAppUrl}${divider}start=${encodeURIComponent(param)}`;
};

const miniAppKeyboard = (label: string, param: string) =>
  webAppUrl ? new InlineKeyboard().webApp(label, withMiniAppParam(param)) : undefined;

bot.command('start', async (ctx) => {
  const deepLink =
    process.env.WEBAPP_DEEPLINK ||
    (ctx.me?.username ? `https://t.me/${ctx.me.username}?startapp=radio` : '');

  const lines = [
    'Добро пожаловать в RadioAtlas.',
    'Нажмите кнопку, чтобы открыть мини-приложение.',
    deepLink ? `Deep link: ${deepLink}` : ''
  ].filter(Boolean);

  const keyboard = webAppUrl
    ? new InlineKeyboard().webApp('Открыть радио', webAppUrl)
    : undefined;

  await ctx.reply(lines.join('\n'), {
    reply_markup: keyboard
  });
});

bot.command('support', async (ctx) => {
  await ctx.reply('Поддержать RadioAtlas можно прямо в мини-приложении через Telegram Stars.', {
    reply_markup: miniAppKeyboard('Поддержать RadioAtlas', 'support')
  });
});

bot.command('premium', async (ctx) => {
  await ctx.reply('Открываю экран Premium в RadioAtlas.', {
    reply_markup: miniAppKeyboard('Открыть Premium', 'premium')
  });
});

bot.command('gift', async (ctx) => {
  const payload = ctx.message?.text?.split(' ').slice(1).join(' ').trim();
  const param = payload ? `gift:${payload}` : 'gift';
  await ctx.reply('Подарить Premium можно из мини-приложения.', {
    reply_markup: miniAppKeyboard('Подарить Premium', param)
  });
});

bot.command('share', async (ctx) => {
  const payload = ctx.message?.text?.split(' ').slice(1).join(' ');
  if (!payload) {
    await ctx.reply('Usage: /share <station_url>');
    return;
  }
  await ctx.reply(`Share this station: ${payload}`);
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

bot.start();
