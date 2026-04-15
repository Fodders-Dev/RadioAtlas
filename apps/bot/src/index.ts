import 'dotenv/config';
import { Bot, InlineKeyboard } from 'grammy';

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is missing');
}

const normalizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).toString();
  } catch {
    return '';
  }
};

const apiUrl = normalizeUrl(process.env.API_URL || '').replace(/\/+$/, '');
const configuredWebAppUrl = normalizeUrl(process.env.WEBAPP_URL || '');
const inferredWebAppUrl = (() => {
  if (!apiUrl) return '';
  try {
    const url = new URL(apiUrl);
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
})();

const webAppUrl = (() => {
  if (!configuredWebAppUrl) return inferredWebAppUrl;
  if (!inferredWebAppUrl) return configuredWebAppUrl;
  const configuredOrigin = new URL(configuredWebAppUrl).origin;
  const inferredOrigin = new URL(inferredWebAppUrl).origin;
  if (configuredOrigin !== inferredOrigin) {
    console.warn(
      `WEBAPP_URL origin ${configuredOrigin} differs from API_URL origin ${inferredOrigin}; using API origin for bot web app links`
    );
    return inferredWebAppUrl;
  }
  return configuredWebAppUrl;
})();
const deployStamp = String(process.env.SOURCE_COMMIT || '').trim().slice(0, 7);

const bot = new Bot(token);

const withSharedApi = (value: string) => {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (deployStamp) {
      url.searchParams.set('v', deployStamp);
    }
    if (apiUrl) {
      url.searchParams.set('api', apiUrl);
    }
    return url.toString();
  } catch {
    return value;
  }
};

const withMiniAppParam = (param: string) => {
  if (!webAppUrl) return '';
  const url = new URL(webAppUrl);
  if (deployStamp) {
    url.searchParams.set('v', deployStamp);
  }
  url.searchParams.set('start', param);
  if (apiUrl) {
    url.searchParams.set('api', apiUrl);
  }
  return url.toString();
};

const miniAppKeyboard = (label: string, param: string) =>
  webAppUrl ? new InlineKeyboard().webApp(label, withMiniAppParam(param)) : undefined;

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
  const deepLink =
    process.env.WEBAPP_DEEPLINK ||
    (ctx.me?.username ? `https://t.me/${ctx.me.username}?startapp=radio` : '');

  const lines = [
    'Добро пожаловать в RadioAtlas.',
    'Нажмите кнопку, чтобы открыть мини-приложение.',
    deepLink ? `Deep link: ${deepLink}` : ''
  ].filter(Boolean);

  const keyboard = webAppUrl
    ? new InlineKeyboard().webApp('Открыть радио', withSharedApi(webAppUrl))
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

try {
  await syncMenuButton();
} catch (error) {
  console.error('Failed to sync Telegram menu button', error);
}

bot.start();
