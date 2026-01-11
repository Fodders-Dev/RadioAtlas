import 'dotenv/config';
import { Bot, InlineKeyboard } from 'grammy';

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is missing');
}

const webAppUrl = process.env.WEBAPP_URL;
const bot = new Bot(token);

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

bot.command('share', async (ctx) => {
  const payload = ctx.message?.text?.split(' ').slice(1).join(' ');
  if (!payload) {
    await ctx.reply('Usage: /share <station_url>');
    return;
  }
  await ctx.reply(`Share this station: ${payload}`);
});

bot.catch((err) => {
  console.error('Bot error', err);
});

bot.start();
