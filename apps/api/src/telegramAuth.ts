import { createHmac, timingSafeEqual } from 'node:crypto';

type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  is_premium?: boolean;
};

export type TelegramInitData = {
  authDate: number;
  queryId: string | null;
  startParam: string | null;
  user: TelegramUser;
};

const parseUser = (raw: string | null): TelegramUser => {
  if (!raw) throw new Error('Telegram user payload is missing');
  const parsed = JSON.parse(raw) as TelegramUser;
  if (!parsed?.id || !parsed?.first_name) {
    throw new Error('Telegram user payload is invalid');
  }
  return parsed;
};

export const validateTelegramInitData = (
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400
): TelegramInitData => {
  if (!initData.trim()) throw new Error('initData is required');
  if (!botToken.trim()) throw new Error('botToken is required');

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('Telegram hash is missing');

  const authDate = Number(params.get('auth_date') || 0);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new Error('Telegram auth_date is invalid');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - authDate > maxAgeSeconds) {
    throw new Error('Telegram auth session expired');
  }

  params.delete('hash');
  const dataCheckString = Array.from(params.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const signature = createHmac('sha256', secret).update(dataCheckString).digest();
  const providedSignature = Buffer.from(hash, 'hex');

  if (
    signature.length !== providedSignature.length ||
    !timingSafeEqual(signature, providedSignature)
  ) {
    throw new Error('Telegram hash mismatch');
  }

  return {
    authDate,
    queryId: params.get('query_id'),
    startParam: params.get('start_param'),
    user: parseUser(params.get('user'))
  };
};
