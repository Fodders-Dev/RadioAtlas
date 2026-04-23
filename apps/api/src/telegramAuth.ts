import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

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

export type TelegramLoginWidgetData = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
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

export const validateTelegramLoginWidgetData = (
  authData: Partial<TelegramLoginWidgetData>,
  botToken: string,
  maxAgeSeconds = 86400
) => {
  if (!botToken.trim()) throw new Error('botToken is required');

  const hash = String(authData.hash || '').trim();
  if (!hash) throw new Error('Telegram hash is missing');

  const authDate = Number(authData.auth_date || 0);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new Error('Telegram auth_date is invalid');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - authDate > maxAgeSeconds) {
    throw new Error('Telegram auth session expired');
  }

  const id = Number(authData.id || 0);
  const firstName = String(authData.first_name || '').trim();
  if (!Number.isFinite(id) || id <= 0 || !firstName) {
    throw new Error('Telegram login payload is invalid');
  }

  const entries = Object.entries(authData)
    .filter(([key, value]) => key !== 'hash' && value !== undefined && value !== null && String(value).trim())
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const dataCheckString = entries.map(([key, value]) => `${key}=${value}`).join('\n');

  const secret = createHash('sha256').update(botToken).digest();
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
    user: {
      id,
      first_name: firstName,
      ...(authData.last_name ? { last_name: String(authData.last_name) } : {}),
      ...(authData.username ? { username: String(authData.username) } : {}),
      ...(authData.photo_url ? { photo_url: String(authData.photo_url) } : {})
    } satisfies TelegramUser
  };
};
