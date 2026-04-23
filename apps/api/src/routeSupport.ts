import type express from 'express';
import { getAccountAuditTrail, type LibraryMergeStrategy, type StoredAccount } from './accountStore.js';

export const getBearerToken = (req: express.Request) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return '';
  return header.slice('Bearer '.length).trim();
};

export const parseMergeStrategy = (value: unknown): LibraryMergeStrategy => {
  if (value === 'prefer-current' || value === 'prefer-incoming') {
    return value;
  }
  return 'combine';
};

export const toClientProfile = (account: StoredAccount) => ({
  id: account.id,
  displayName: account.displayName,
  username: account.username,
  email: account.email,
  photoUrl: account.photoUrl,
  isPremium: account.isPremium,
  premiumStatus: account.premiumStatus,
  supporterTier: account.supporterTier,
  entitlements: account.entitlements,
  billingProvider: account.billingProvider,
  linkedProviders: account.providers.map((provider) => provider.kind),
  providers: account.providers,
  library: account.library
});

export const buildSessionEnvelope = async (token: string, account: StoredAccount) => ({
  token,
  profile: toClientProfile(account),
  auditTrail: await getAccountAuditTrail(account.id)
});

export const getWebappUrl = (req: express.Request, configuredWebappUrl: string) => {
  const origin = configuredWebappUrl.trim();
  if (origin) {
    return origin.replace(/\/+$/, '');
  }
  return `${req.protocol}://${req.get('host')}`;
};

export const redirectToWebapp = (
  req: express.Request,
  res: express.Response,
  configuredWebappUrl: string,
  params: Record<string, string>
) => {
  const target = new URL(getWebappUrl(req, configuredWebappUrl));
  Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
  res.redirect(target.toString());
};

export const encodeFixtureGoogleCredential = (identity: {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
  email_verified?: boolean;
}) => `fixture-google:${Buffer.from(JSON.stringify(identity), 'utf8').toString('base64url')}`;

export const createTelegramInvoiceLink = async (
  botToken: string,
  input: {
    title: string;
    description: string;
    payload: string;
    amount: number;
  }
) => {
  if (!botToken) {
    throw new Error('telegram billing is not configured');
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/createInvoiceLink`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: input.title,
      description: input.description,
      payload: input.payload,
      currency: 'XTR',
      prices: [{ label: input.title, amount: input.amount }]
    })
  });
  const body = (await response.json()) as { ok: boolean; result?: string; description?: string };
  if (!response.ok || !body.ok || !body.result) {
    throw new Error(body.description || `invoice creation failed (${response.status})`);
  }
  return body.result;
};
