import 'dotenv/config';
import express from 'express';
import { Readable } from 'node:stream';
import {
  claimStationForAccount,
  confirmBillingPurchase,
  createBillingPurchase,
  consumeLinkRequest,
  createLinkRequest,
  createSessionForAccount,
  getAccountAuditTrail,
  getAccountByToken,
  getStationAnalytics,
  getStationProfile,
  type LibraryMergeStrategy,
  listBillingProducts,
  listCatalogProfileOverrides,
  linkGoogleIdentity,
  linkTelegramIdentity,
  previewGoogleLink,
  previewTelegramLink,
  recordAccountEvent,
  recordPromotionEvent,
  unlinkProvider,
  updateAccountAlerts,
  updateAccountCollections,
  updateAccountEntitlements,
  updateAccountFollows,
  updateAccountLibrary,
  updateStationProfile
} from './accountStore.js';
import { verifyGoogleIdToken } from './googleAuth.js';
import { validateTelegramInitData } from './telegramAuth.js';

const API_URLS = [
  'https://de1.api.radio-browser.info/json/stations/search',
  'https://nl1.api.radio-browser.info/json/stations/search',
  'https://fr1.api.radio-browser.info/json/stations/search',
  'https://all.api.radio-browser.info/json/stations/search'
];

const USER_AGENT = 'RadioAtlas/1.0';
const CACHE_TTL_MS = 1000 * 60 * 30;
const PAGE_LIMIT = 10000;
const FAST_LIMIT = 10000;
const MAX_PAGES = 5;
const EXTRACTOR_URL = process.env.EXTRACTOR_URL || 'http://127.0.0.1:4001';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ENABLE_TEST_AUTH_FIXTURES = process.env.ENABLE_TEST_AUTH_FIXTURES === '1';
const WEBAPP_URL = process.env.WEBAPP_URL || '';
const METADATA_CACHE_TTL_MS = 1000 * 15;
const BLOCKED_HOSTS = [
  'youtube.com',
  'youtu.be',
  'music.youtube.com',
  'youtube-nocookie.com'
];

type Station = {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  state: string;
  language: string;
  codec: string;
  bitrate: number;
  geo_lat: number | null;
  geo_long: number | null;
  stationArtwork?: string | null;
  isClaimed?: boolean;
  isVerified?: boolean;
  promoted?: boolean;
  description?: string | null;
  websiteUrl?: string | null;
  scheduleNote?: string | null;
};

type CacheEntry = {
  ts: number;
  data: Station[];
};

type MetadataLookupResult = {
  title: string | null;
  logs: string[];
  source?: string;
};

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

const metadataCache = new Map<string, { ts: number; result: MetadataLookupResult }>();

const corsHeaders = (res: express.Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type'
  );
};

app.use((req, res, next) => {
  corsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

let fastCache: CacheEntry | null = null;
let fullCache: CacheEntry | null = null;

const normalizeStation = (raw: Station): Station => ({
  ...raw,
  name: raw.name?.trim() || 'Unknown Station',
  url_resolved: raw.url_resolved || raw.url,
  geo_lat: asNumber(raw.geo_lat),
  geo_long: asNumber(raw.geo_long)
});

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === 'null' || normalized === 'undefined') {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getHost = (value: string) => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
};

const isBlockedHost = (value: string) =>
  BLOCKED_HOSTS.some((host) => getHost(value).includes(host));

const fetchWithTimeout = async (url: string, ms: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        'X-User-Agent': USER_AGENT
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

const fetchFromEndpoint = async (endpoint: string, limit: number, maxPages: number) => {
  const collected: Station[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(endpoint);
    url.searchParams.set('order', 'clickcount');
    url.searchParams.set('reverse', 'true');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(page * limit));

    const response = await fetchWithTimeout(url.toString(), 8000);
    if (!response.ok) {
      throw new Error(`Radio Browser error: ${response.status}`);
    }
    const raw = (await response.json()) as Station[];
    collected.push(...raw);
    if (raw.length < limit) {
      break;
    }
  }
  return collected;
};

const getCatalog = async (mode: 'fast' | 'full') => {
  const cache = mode === 'fast' ? fastCache : fullCache;
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.data;
  }

  const limit = mode === 'fast' ? FAST_LIMIT : PAGE_LIMIT;
  const maxPages = mode === 'fast' ? 1 : MAX_PAGES;

  let raw: Station[] = [];
  const tasks = API_URLS.map((endpoint) =>
    fetchFromEndpoint(endpoint, limit, maxPages).then((data) => {
      if (!data.length) {
        throw new Error('Empty response');
      }
      return data;
    })
  );

  raw = await Promise.any(tasks);

  const byId = new Map<string, Station>();
  raw.forEach((item) => {
    if (!item?.stationuuid) return;
    if (!byId.has(item.stationuuid)) {
      byId.set(item.stationuuid, item);
    }
  });

  const stations = Array.from(byId.values())
    .map(normalizeStation)
    .filter((station) => Boolean(station.url_resolved));

  const entry = { ts: Date.now(), data: stations };
  if (mode === 'fast') {
    fastCache = entry;
  } else {
    fullCache = entry;
  }
  return stations;
};

const toAbsoluteUrl = (value: string, base: string) => {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
};

const rewriteM3U8 = (body: string, sourceUrl: string, proxyBase: string) => {
  const lines = body.split('\n');
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const absolute = toAbsoluteUrl(trimmed, sourceUrl);
    return `${proxyBase}/stream?url=${encodeURIComponent(absolute)}`;
  });
  return rewritten.join('\n');
};

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const getBearerToken = (req: express.Request) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return '';
  return header.slice('Bearer '.length).trim();
};

const toClientProfile = (account: NonNullable<Awaited<ReturnType<typeof getAccountByToken>>>) => ({
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

const buildSessionEnvelope = async (
  token: string,
  account: NonNullable<Awaited<ReturnType<typeof getAccountByToken>>>
) => ({
  token,
  profile: toClientProfile(account),
  auditTrail: await getAccountAuditTrail(account.id)
});

const parseMergeStrategy = (value: unknown): LibraryMergeStrategy => {
  if (value === 'prefer-current' || value === 'prefer-incoming') {
    return value;
  }
  return 'combine';
};

const getTelegramApiUrl = (method: string) =>
  `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;

const createTelegramInvoiceLink = async (input: {
  title: string;
  description: string;
  payload: string;
  amount: number;
}) => {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('telegram billing is not configured');
  }
  const response = await fetch(getTelegramApiUrl('createInvoiceLink'), {
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

const withStationProfiles = async (stations: Station[]) => {
  const profiles = await listCatalogProfileOverrides();
  if (!profiles.length) return stations;
  const byId = new Map(profiles.map((profile) => [profile.stationuuid, profile]));
  return stations.map((station) => {
    const profile = byId.get(station.stationuuid);
    if (!profile) return station;
    return {
      ...station,
      stationArtwork: profile.artworkUrl || station.favicon || '',
      isClaimed: Boolean(profile.ownerAccountId),
      isVerified: profile.isVerified,
      promoted: profile.isPromoted && (!profile.promotedUntil || profile.promotedUntil > Date.now()),
      description: profile.description,
      websiteUrl: profile.websiteUrl || station.homepage,
      scheduleNote: profile.scheduleNote
    };
  });
};

const encodeFixtureGoogleCredential = (identity: {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
  email_verified?: boolean;
}) =>
  `fixture-google:${Buffer.from(JSON.stringify(identity), 'utf8').toString('base64url')}`;

app.post('/auth/telegram', async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN) {
    res.status(503).json({ error: 'telegram auth is not configured' });
    return;
  }

  const initData = typeof req.body?.initData === 'string' ? req.body.initData : '';
  if (!initData.trim()) {
    res.status(400).json({ error: 'initData is required' });
    return;
  }

  try {
    const validated = validateTelegramInitData(initData, TELEGRAM_BOT_TOKEN);
    const currentToken = getBearerToken(req);
    const currentAccount = currentToken ? await getAccountByToken(currentToken) : null;
    const linkCode = typeof req.body?.linkCode === 'string' ? req.body.linkCode.trim() : '';
    const requestedMergeStrategy = parseMergeStrategy(req.body?.mergeStrategy);
    const linkRequest =
      !currentAccount && linkCode
        ? await consumeLinkRequest(linkCode)
        : validated.startParam?.startsWith('link_')
          ? await consumeLinkRequest(validated.startParam.slice('link_'.length))
          : null;
    const account = await linkTelegramIdentity(
      validated.user,
      currentAccount?.id || linkRequest?.accountId || null,
      currentAccount ? requestedMergeStrategy : (linkRequest?.mergeStrategy || requestedMergeStrategy)
    );
    const token = currentToken || (account ? await createSessionForAccount(account.id) : '');
    await recordAccountEvent(
      account!.id,
      'sign_in',
      { reusedSession: Boolean(currentToken) },
      { kind: 'telegram', externalId: String(validated.user.id) }
    );
    res.json(await buildSessionEnvelope(token, account!));
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'telegram auth failed' });
  }
});

app.post('/auth/telegram/preview', async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN) {
    res.status(503).json({ error: 'telegram auth is not configured' });
    return;
  }

  const initData = typeof req.body?.initData === 'string' ? req.body.initData : '';
  if (!initData.trim()) {
    res.status(400).json({ error: 'initData is required' });
    return;
  }

  try {
    const validated = validateTelegramInitData(initData, TELEGRAM_BOT_TOKEN);
    const currentToken = getBearerToken(req);
    const currentAccount = currentToken ? await getAccountByToken(currentToken) : null;
    const linkCode = typeof req.body?.linkCode === 'string' ? req.body.linkCode.trim() : '';
    const requestedMergeStrategy = parseMergeStrategy(req.body?.mergeStrategy);
    const linkRequest =
      !currentAccount && linkCode
        ? await consumeLinkRequest(linkCode)
        : validated.startParam?.startsWith('link_')
          ? await consumeLinkRequest(validated.startParam.slice('link_'.length))
          : null;
    const preview = await previewTelegramLink(
      validated.user,
      currentAccount?.id || linkRequest?.accountId || null,
      currentAccount ? requestedMergeStrategy : (linkRequest?.mergeStrategy || requestedMergeStrategy)
    );
    res.json({ preview });
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'telegram auth preview failed' });
  }
});

app.post('/auth/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    res.status(503).json({ error: 'google auth is not configured' });
    return;
  }

  const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
  if (!credential.trim()) {
    res.status(400).json({ error: 'credential is required' });
    return;
  }

  try {
    const identity = await verifyGoogleIdToken(credential, GOOGLE_CLIENT_ID);
    const currentToken = getBearerToken(req);
    const currentAccount = currentToken ? await getAccountByToken(currentToken) : null;
    const linkCode = typeof req.body?.linkCode === 'string' ? req.body.linkCode.trim() : '';
    const requestedMergeStrategy = parseMergeStrategy(req.body?.mergeStrategy);
    const linkRequest = !currentAccount && linkCode ? await consumeLinkRequest(linkCode) : null;
    const account = await linkGoogleIdentity(
      identity,
      currentAccount?.id || linkRequest?.accountId || null,
      currentAccount ? requestedMergeStrategy : (linkRequest?.mergeStrategy || requestedMergeStrategy)
    );
    const token = currentToken || (account ? await createSessionForAccount(account.id) : '');
    await recordAccountEvent(
      account!.id,
      'sign_in',
      { reusedSession: Boolean(currentToken) },
      { kind: 'google', externalId: identity.sub }
    );
    res.json(await buildSessionEnvelope(token, account!));
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'google auth failed' });
  }
});

app.post('/auth/google/preview', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    res.status(503).json({ error: 'google auth is not configured' });
    return;
  }

  const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
  if (!credential.trim()) {
    res.status(400).json({ error: 'credential is required' });
    return;
  }

  try {
    const identity = await verifyGoogleIdToken(credential, GOOGLE_CLIENT_ID);
    const currentToken = getBearerToken(req);
    const currentAccount = currentToken ? await getAccountByToken(currentToken) : null;
    const linkCode = typeof req.body?.linkCode === 'string' ? req.body.linkCode.trim() : '';
    const requestedMergeStrategy = parseMergeStrategy(req.body?.mergeStrategy);
    const linkRequest = !currentAccount && linkCode ? await consumeLinkRequest(linkCode) : null;
    const preview = await previewGoogleLink(
      identity,
      currentAccount?.id || linkRequest?.accountId || null,
      currentAccount ? requestedMergeStrategy : (linkRequest?.mergeStrategy || requestedMergeStrategy)
    );
    res.json({ preview });
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'google auth preview failed' });
  }
});

app.get('/me', async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'authorization required' });
    return;
  }

  const account = await getAccountByToken(token);
  if (!account) {
    res.status(401).json({ error: 'session is invalid' });
    return;
  }

  res.json({
    profile: toClientProfile(account),
    auditTrail: await getAccountAuditTrail(account.id)
  });
});

app.put('/me/library', async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'authorization required' });
    return;
  }

  const account = await getAccountByToken(token);
  if (!account) {
    res.status(401).json({ error: 'session is invalid' });
    return;
  }

  const nextAccount = await updateAccountLibrary(account.id, req.body);
  if (!nextAccount) {
    res.status(404).json({ error: 'account not found' });
    return;
  }

  res.json({
    profile: toClientProfile(nextAccount),
    auditTrail: await getAccountAuditTrail(nextAccount.id)
  });
});

app.get('/me/entitlements', async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'authorization required' });
    return;
  }
  const account = await getAccountByToken(token);
  if (!account) {
    res.status(401).json({ error: 'session is invalid' });
    return;
  }
  res.json({
    premiumStatus: account.premiumStatus,
    supporterTier: account.supporterTier,
    entitlements: account.entitlements,
    billingProvider: account.billingProvider
  });
});

app.put('/me/collections', async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'authorization required' });
    return;
  }
  const account = await getAccountByToken(token);
  if (!account) {
    res.status(401).json({ error: 'session is invalid' });
    return;
  }
  const nextAccount = await updateAccountCollections(account.id, req.body?.collections);
  if (!nextAccount) {
    res.status(404).json({ error: 'account not found' });
    return;
  }
  res.json({
    profile: toClientProfile(nextAccount),
    auditTrail: await getAccountAuditTrail(nextAccount.id)
  });
});

app.put('/me/follows', async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'authorization required' });
    return;
  }
  const account = await getAccountByToken(token);
  if (!account) {
    res.status(401).json({ error: 'session is invalid' });
    return;
  }
  const nextAccount = await updateAccountFollows(account.id, {
    followedStations: req.body?.followedStations,
    followedRegions: req.body?.followedRegions
  });
  if (!nextAccount) {
    res.status(404).json({ error: 'account not found' });
    return;
  }
  res.json({
    profile: toClientProfile(nextAccount),
    auditTrail: await getAccountAuditTrail(nextAccount.id)
  });
});

app.put('/me/alerts', async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'authorization required' });
    return;
  }
  const account = await getAccountByToken(token);
  if (!account) {
    res.status(401).json({ error: 'session is invalid' });
    return;
  }
  const nextAccount = await updateAccountAlerts(account.id, req.body?.alerts);
  if (!nextAccount) {
    res.status(404).json({ error: 'account not found' });
    return;
  }
  res.json({
    profile: toClientProfile(nextAccount),
    auditTrail: await getAccountAuditTrail(nextAccount.id)
  });
});

app.post('/me/link-request', async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'authorization required' });
    return;
  }

  const account = await getAccountByToken(token);
  if (!account) {
    res.status(401).json({ error: 'session is invalid' });
    return;
  }

  const request = await createLinkRequest(account.id, parseMergeStrategy(req.body?.mergeStrategy));
  res.json({
    code: request.code,
    mergeStrategy: request.mergeStrategy,
    expiresAt: request.expiresAt,
    auditTrail: await getAccountAuditTrail(account.id)
  });
});

app.delete('/me/providers/:kind', async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'authorization required' });
    return;
  }

  const account = await getAccountByToken(token);
  if (!account) {
    res.status(401).json({ error: 'session is invalid' });
    return;
  }

  const kind = req.params.kind;
  if (kind !== 'telegram' && kind !== 'google') {
    res.status(400).json({ error: 'provider kind is invalid' });
    return;
  }

  try {
    const nextAccount = await unlinkProvider(account.id, kind);
    if (!nextAccount) {
      res.status(404).json({ error: 'account not found' });
      return;
    }

    res.json({
      profile: toClientProfile(nextAccount),
      auditTrail: await getAccountAuditTrail(nextAccount.id)
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'provider unlink failed' });
  }
});

app.get('/me/audit', async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'authorization required' });
    return;
  }

  const account = await getAccountByToken(token);
  if (!account) {
    res.status(401).json({ error: 'session is invalid' });
    return;
  }

  const limit = Math.max(1, Math.min(Number(req.query.limit || 12), 50));
  res.json({ auditTrail: await getAccountAuditTrail(account.id, limit) });
});

app.get('/billing/telegram/products', async (_req, res) => {
  res.json({ products: await listBillingProducts() });
});

app.post('/billing/telegram/create-invoice', async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'authorization required' });
    return;
  }
  const account = await getAccountByToken(token);
  if (!account) {
    res.status(401).json({ error: 'session is invalid' });
    return;
  }
  const productId = typeof req.body?.productId === 'string' ? req.body.productId : '';
  const recipientAccountId = typeof req.body?.recipientAccountId === 'string' ? req.body.recipientAccountId : null;
  try {
    const purchase = await createBillingPurchase(account.id, productId as any, recipientAccountId);
    if (!purchase) {
      res.status(400).json({ error: 'invalid billing product' });
      return;
    }
    const invoiceLink = await createTelegramInvoiceLink({
      title: purchase.product.title,
      description: purchase.product.description,
      payload: purchase.id,
      amount: purchase.product.amount
    });
    res.json({
      purchaseId: purchase.id,
      product: purchase.product,
      invoiceLink
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'invoice creation failed' });
  }
});

app.post('/billing/telegram/webhook', async (req, res) => {
  const purchaseId = typeof req.body?.purchaseId === 'string' ? req.body.purchaseId : '';
  if (!purchaseId) {
    res.status(400).json({ error: 'purchaseId is required' });
    return;
  }
  try {
    const account = await confirmBillingPurchase(
      purchaseId,
      typeof req.body?.telegramChargeId === 'string' ? req.body.telegramChargeId : null
    );
    if (!account) {
      res.status(404).json({ error: 'purchase not found' });
      return;
    }
    res.json({
      profile: toClientProfile(account),
      auditTrail: await getAccountAuditTrail(account.id)
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'billing confirmation failed' });
  }
});

app.post('/stations/:id/claim', async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'authorization required' });
    return;
  }
  const account = await getAccountByToken(token);
  if (!account) {
    res.status(401).json({ error: 'session is invalid' });
    return;
  }
  try {
    const profile = await claimStationForAccount(account.id, req.params.id, {
      displayName: typeof req.body?.displayName === 'string' ? req.body.displayName : 'Claimed station',
      websiteUrl: typeof req.body?.websiteUrl === 'string' ? req.body.websiteUrl : null,
      description: typeof req.body?.description === 'string' ? req.body.description : null,
      artworkUrl: typeof req.body?.artworkUrl === 'string' ? req.body.artworkUrl : null
    });
    res.json({ profile });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'station claim failed' });
  }
});

app.get('/stations/:id/profile', async (req, res) => {
  const profile = await getStationProfile(req.params.id);
  if (!profile) {
    res.status(404).json({ error: 'station profile not found' });
    return;
  }
  res.json({ profile });
});

app.put('/stations/:id/profile', async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'authorization required' });
    return;
  }
  const account = await getAccountByToken(token);
  if (!account) {
    res.status(401).json({ error: 'session is invalid' });
    return;
  }
  try {
    const profile = await updateStationProfile(account.id, req.params.id, {
      displayName: req.body?.displayName,
      description: req.body?.description,
      artworkUrl: req.body?.artworkUrl,
      websiteUrl: req.body?.websiteUrl,
      scheduleNote: req.body?.scheduleNote,
      editorialPitch: req.body?.editorialPitch,
      socialLinks: req.body?.socialLinks,
      isPromoted: req.body?.isPromoted,
      promotedUntil: req.body?.promotedUntil
    });
    res.json({ profile });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'station profile update failed' });
  }
});

app.get('/stations/:id/analytics', async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'authorization required' });
    return;
  }
  const account = await getAccountByToken(token);
  if (!account) {
    res.status(401).json({ error: 'session is invalid' });
    return;
  }
  try {
    res.json({ analytics: await getStationAnalytics(account.id, req.params.id) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'station analytics failed' });
  }
});

app.post('/promotions/impression', async (req, res) => {
  const stationuuid = typeof req.body?.stationuuid === 'string' ? req.body.stationuuid : '';
  if (!stationuuid) {
    res.status(400).json({ error: 'stationuuid is required' });
    return;
  }
  const token = getBearerToken(req);
  const account = token ? await getAccountByToken(token) : null;
  await recordPromotionEvent(
    stationuuid,
    'impression',
    typeof req.body?.sourceId === 'string' ? req.body.sourceId : null,
    account?.id || null
  );
  res.json({ ok: true });
});

app.post('/promotions/click', async (req, res) => {
  const stationuuid = typeof req.body?.stationuuid === 'string' ? req.body.stationuuid : '';
  if (!stationuuid) {
    res.status(400).json({ error: 'stationuuid is required' });
    return;
  }
  const token = getBearerToken(req);
  const account = token ? await getAccountByToken(token) : null;
  await recordPromotionEvent(
    stationuuid,
    'click',
    typeof req.body?.sourceId === 'string' ? req.body.sourceId : null,
    account?.id || null
  );
  res.json({ ok: true });
});

if (ENABLE_TEST_AUTH_FIXTURES) {
  app.post('/test/auth/seed-conflict', async (req, res) => {
    const mergeStrategy = parseMergeStrategy(req.body?.mergeStrategy);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const currentTelegramUser = {
      id: Number(String(Date.now()).slice(-9)),
      first_name: 'Fixture',
      last_name: 'Current',
      username: `fixture_current_${stamp.replace(/[^a-z0-9]/gi, '').slice(0, 16)}`,
      is_premium: true
    };
    const incomingGoogleIdentity = {
      sub: `fixture-google-${stamp}`,
      name: 'Fixture Incoming',
      email: `fixture-incoming-${stamp}@example.com`,
      email_verified: true
    };

    const currentAccount = await linkTelegramIdentity(currentTelegramUser, null, mergeStrategy);
    const incomingAccount = await linkGoogleIdentity(incomingGoogleIdentity, null, mergeStrategy);

    const currentLibrary = {
      favorites: [
        {
          stationuuid: `fixture-current-fav-a-${stamp}`,
          name: 'Current Favorite A',
          url_resolved: 'https://stream.example.com/current-a',
          favicon: '',
          country: 'Russia',
          state: 'Moscow',
          tags: 'indie',
          geo_lat: null,
          geo_long: null
        },
        {
          stationuuid: `fixture-current-fav-b-${stamp}`,
          name: 'Current Favorite B',
          url_resolved: 'https://stream.example.com/current-b',
          favicon: '',
          country: 'Germany',
          state: 'Berlin',
          tags: 'ambient',
          geo_lat: null,
          geo_long: null
        }
      ],
      recent: [
        {
          stationuuid: `fixture-current-recent-${stamp}`,
          name: 'Current Recent',
          url_resolved: 'https://stream.example.com/current-recent',
          favicon: '',
          country: 'Japan',
          state: 'Tokyo',
          tags: 'city pop',
          geo_lat: null,
          geo_long: null
        }
      ],
      trackHistory: [
        {
          id: `fixture-current-track-${stamp}`,
          stationId: `fixture-current-fav-a-${stamp}`,
          stationName: 'Current Favorite A',
          track: 'Current Track',
          timestamp: Date.now() - 1000
        }
      ],
      updatedAt: Date.now()
    };

    const incomingLibrary = {
      favorites: [
        {
          stationuuid: `fixture-incoming-fav-${stamp}`,
          name: 'Incoming Favorite',
          url_resolved: 'https://stream.example.com/incoming-fav',
          favicon: '',
          country: 'France',
          state: 'Paris',
          tags: 'electro',
          geo_lat: null,
          geo_long: null
        }
      ],
      recent: [
        {
          stationuuid: `fixture-incoming-recent-a-${stamp}`,
          name: 'Incoming Recent A',
          url_resolved: 'https://stream.example.com/incoming-recent-a',
          favicon: '',
          country: 'Brazil',
          state: 'Rio',
          tags: 'samba',
          geo_lat: null,
          geo_long: null
        },
        {
          stationuuid: `fixture-incoming-recent-b-${stamp}`,
          name: 'Incoming Recent B',
          url_resolved: 'https://stream.example.com/incoming-recent-b',
          favicon: '',
          country: 'USA',
          state: 'New York',
          tags: 'jazz',
          geo_lat: null,
          geo_long: null
        }
      ],
      trackHistory: [
        {
          id: `fixture-incoming-track-${stamp}`,
          stationId: `fixture-incoming-fav-${stamp}`,
          stationName: 'Incoming Favorite',
          track: 'Incoming Track',
          timestamp: Date.now()
        }
      ],
      updatedAt: Date.now()
    };

    const hydratedCurrent = await updateAccountLibrary(currentAccount!.id, currentLibrary);
    const hydratedIncoming = await updateAccountLibrary(incomingAccount!.id, incomingLibrary);
    const token = await createSessionForAccount(currentAccount!.id);

    res.json({
      token,
      currentAccountId: hydratedCurrent?.id || currentAccount!.id,
      incomingAccountId: hydratedIncoming?.id || incomingAccount!.id,
      incomingCredential: encodeFixtureGoogleCredential(incomingGoogleIdentity),
      mergeStrategy,
      currentCounts: {
        favorites: hydratedCurrent?.library.favorites.length || 0,
        recent: hydratedCurrent?.library.recent.length || 0,
        trackHistory: hydratedCurrent?.library.trackHistory.length || 0
      },
      incomingCounts: {
        favorites: hydratedIncoming?.library.favorites.length || 0,
        recent: hydratedIncoming?.library.recent.length || 0,
        trackHistory: hydratedIncoming?.library.trackHistory.length || 0
      }
    });
  });
}

app.get('/catalog', async (req, res) => {
  try {
    const mode = req.query.mode === 'fast' ? 'fast' : 'full';
    const data = await withStationProfiles(await getCatalog(mode));
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.get('/stream', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    res.status(400).json({ error: 'invalid url' });
    return;
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    res.status(400).json({ error: 'invalid protocol' });
    return;
  }

  try {
    const range = req.headers.range;
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT
    };
    if (range) {
      headers.Range = range;
    }
    const candidates: URL[] = [];
    if (target.protocol === 'http:') {
      const upgraded = new URL(target.toString());
      upgraded.protocol = 'https:';
      candidates.push(upgraded);
    }
    candidates.push(target);

    let upstream: Response | null = null;
    let lastError: Error | null = null;
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate.toString(), { headers });
        if (!response.ok) {
          lastError = new Error(`Upstream ${response.status}`);
          continue;
        }
        upstream = response;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Upstream failed');
      }
    }

    if (!upstream) {
      res.status(502).json({ error: lastError?.message || 'Upstream failed' });
      return;
    }

    const contentType = upstream.headers.get('content-type') || '';
    const proxyBase =
      process.env.PUBLIC_URL ||
      `${req.protocol}://${req.get('host')}`;

    if (contentType.includes('application/vnd.apple.mpegurl') || target.pathname.endsWith('.m3u8')) {
      const body = await upstream.text();
      const rewritten = rewriteM3U8(body, target.toString(), proxyBase);
      res.setHeader('content-type', 'application/vnd.apple.mpegurl');
      res.send(rewritten);
      return;
    }

    const length = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    const acceptRanges = upstream.headers.get('accept-ranges');

    res.status(upstream.status);
    if (length) res.setHeader('content-length', length);
    if (contentRange) res.setHeader('content-range', contentRange);
    if (acceptRanges) res.setHeader('accept-ranges', acceptRanges);
    res.setHeader('content-type', contentType || 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');

    if (!upstream.body) {
      res.status(204).end();
      return;
    }

    // Use a PassThrough stream with a buffer (highWaterMark) to smooth out network jitter
    const bufferStream = new (await import('node:stream')).PassThrough({
      highWaterMark: 512 * 1024 // 512KB buffer
    });

    Readable.fromWeb(upstream.body as any).pipe(bufferStream).pipe(res);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

const buildTrackTitle = (artist?: string | null, title?: string | null) => {
  const parts = [artist?.trim(), title?.trim()].filter(Boolean);
  if (!parts.length) return null;
  return parts.join(' - ');
};

const fetchMetadataPayload = async (
  targetUrl: string,
  responseType: 'json' | 'text',
  timeoutMs = 5000
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: responseType === 'json' ? 'application/json,text/plain,*/*' : 'text/plain,text/html,*/*'
      },
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    return responseType === 'json' ? await response.json() : await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
};

const fetchIcecastMetadata = async (
  origin: string,
  path: string,
  log: (msg: string) => void
): Promise<string | null> => {
  const target = `${origin}/status-json.xsl`;
  log(`Trying Icecast status: ${target}`);
  const data = await fetchMetadataPayload(target, 'json');
  if (!data || typeof data !== 'object') return null;

  const source = (data as any)?.icestats?.source;
  const sources = Array.isArray(source) ? source : source ? [source] : [];
  if (!sources.length) return null;

  const matchedSource =
    sources.find((entry: any) => entry?.listenurl?.endsWith(path) || entry?.listenurl?.includes(path)) ||
    sources[0];

  if (!matchedSource) return null;

  const composedTrack = buildTrackTitle(matchedSource.artist, matchedSource.title);
  return composedTrack || matchedSource.title?.trim?.() || null;
};

const fetchShoutcastMetadata = async (
  origin: string,
  log: (msg: string) => void
): Promise<string | null> => {
  const target = `${origin}/7.html`;
  log(`Trying Shoutcast status: ${target}`);
  const text = await fetchMetadataPayload(target, 'text');
  if (!text || typeof text !== 'string') return null;

  const bodyMatch = text.match(/<body[^>]*>(.*?)<\/body>/i);
  const content = bodyMatch?.[1] || text;
  const parts = content.split(',');
  if (parts.length >= 7) {
    return parts[6]?.trim?.() || null;
  }
  return null;
};

const parseAzuraMetadata = (payload: unknown) => {
  const data = Array.isArray(payload) ? payload[0] : payload;
  const song = (data as any)?.now_playing?.song;
  return song?.text || buildTrackTitle(song?.artist, song?.title);
};

const fetchAzuraMetadata = async (
  host: string,
  log: (msg: string) => void
): Promise<string | null> => {
  const candidates = [`https://${host}/api/nowplaying/1`, `https://${host}/api/nowplaying`];
  for (const candidate of candidates) {
    log(`Trying AzuraCast status: ${candidate}`);
    const data = await fetchMetadataPayload(candidate, 'json');
    const track = parseAzuraMetadata(data);
    if (track) return track;
  }
  return null;
};

const fetchStreamMetadata = async (url: string): Promise<MetadataLookupResult> => {
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(`[Metadata] ${msg}`);
    logs.push(msg);
  };

  log(`Fetching: ${url}`);

  try {
    const parsedUrl = new URL(url);
    const icecastTitle = await fetchIcecastMetadata(parsedUrl.origin, parsedUrl.pathname, log);
    if (icecastTitle) {
      return { title: icecastTitle, logs, source: 'icecast-status' };
    }

    const shoutcastTitle = await fetchShoutcastMetadata(parsedUrl.origin, log);
    if (shoutcastTitle) {
      return { title: shoutcastTitle, logs, source: 'shoutcast-status' };
    }

    const azuraTitle = await fetchAzuraMetadata(parsedUrl.host, log);
    if (azuraTitle) {
      return { title: azuraTitle, logs, source: 'azuracast' };
    }
  } catch (error) {
    log(`Status probe skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      headers: {
        'Icy-MetaData': '1',
        'User-Agent': USER_AGENT
      },
      redirect: 'follow',
      signal: controller.signal
    });

    log(`Status: ${response.status}`);
    const metaintHeader = response.headers.get('icy-metaint');
    log(`MetaInt: ${metaintHeader}`);

    if (!metaintHeader) return { title: null, logs };

    const metaint = Number(metaintHeader);
    if (isNaN(metaint) || metaint <= 0) {
      log('Invalid metaint');
      return { title: null, logs };
    }

    const body = response.body;
    if (!body) {
      log('No body');
      return { title: null, logs };
    }

    const reader = body.getReader ? body.getReader() : null;
    if (!reader) {
      log('No reader');
      return { title: null, logs };
    }

    let buffer = new Uint8Array(0);
    const maxBytes = metaint + 16384;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      const next = new Uint8Array(buffer.length + value.length);
      next.set(buffer);
      next.set(value, buffer.length);
      buffer = next;

      // We need at least metaint + 1 byte (length byte)
      if (buffer.length >= metaint + 1) {
        const lengthByte = buffer[metaint] || 0;
        const metaLen = lengthByte * 16;

        if (metaLen === 0) {
          log('Empty metadata block found');
          return { title: null, logs };
        }

        if (buffer.length >= metaint + 1 + metaLen) {
          const metaBytes = buffer.slice(metaint + 1, metaint + 1 + metaLen);
          const text = new TextDecoder('utf-8').decode(metaBytes);
          log(`Raw meta found`);
          const match = text.match(/StreamTitle='([^']*)'/) || text.match(/StreamTitle=([^;]*)/);
          if (match?.[1]) {
            return { title: match[1].trim(), logs, source: 'icy-stream' };
          } else {
            log(`StreamTitle not found in: ${text}`);
            return { title: null, logs };
          }
        }
      }

      if (buffer.length > maxBytes) {
        log('Max bytes reached');
        break;
      }
    }

  } catch (e) {
    log(`Error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
  return { title: null, logs };
};

// Top-Radio.ru fallback for Russian stations
const TOP_RADIO_MAPPING: Record<string, string> = {
  'kazak.fm': 'kazak-fm',
  'radio.kazak.fm': 'kazak-fm',
  // Add more Russian stations as needed
};

const getTopRadioSlug = (streamUrl: string): string | null => {
  try {
    const host = new URL(streamUrl).host.toLowerCase();
    for (const [key, slug] of Object.entries(TOP_RADIO_MAPPING)) {
      if (host.includes(key)) {
        return slug;
      }
    }
  } catch { }
  return null;
};

const fetchFromTopRadio = async (slug: string): Promise<string | null> => {
  try {
    // '/web/' pages are more live than '/playlist/' pages which are often cached
    const res = await fetch(`https://top-radio.ru/web/${slug}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    if (!res.ok) return null;

    const html = await res.text();

    // Look for the "playlist" section which contains live track data
    // Usually it has a label like "Что сейчас играет:" followed by track items
    const playlistSection = html.match(
      /Плейлист радиостанции[\s\S]*?Что сейчас играет:([\s\S]*?)Весь плей-лист/i
    );
    const contentToSearch = playlistSection?.[1] ?? html;

    // Structure is typically: <a class="artist">Artist</a> <span class="song">Song</span>
    const trackRegex = /class="artist"[^>]*>([^<]+)[\s\S]*?class="song"[^>]*>([^<]+)/gi;
    const matches = [...contentToSearch.matchAll(trackRegex)];

    if (matches.length > 0) {
      const artist = matches[0]?.[1]?.trim?.();
      const song = matches[0]?.[2]?.trim?.();

      if (artist && song) {
        return `${artist} - ${song}`;
      }
    }

    // Fallback if the specific section wasn't found or structure differs
    const fallbackMatch = html.match(
      /class="artist">([^<]+)<\/span>[\s\S]*?class="song">([^<]+)<\/span>/i
    );
    const fallbackArtist = fallbackMatch?.[1]?.trim?.();
    const fallbackSong = fallbackMatch?.[2]?.trim?.();
    if (fallbackArtist && fallbackSong) {
      return `${fallbackArtist} - ${fallbackSong}`;
    }

  } catch (e) {
    console.error(`[TopRadio] Error for ${slug}:`, e);
  }
  return null;
};

app.get('/metadata', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  const cached = metadataCache.get(url);
  if (cached && Date.now() - cached.ts < METADATA_CACHE_TTL_MS) {
    if (cached.result.title) {
      res.json(cached.result);
      return;
    }
    res.status(404).json({ error: 'No metadata found', ...cached.result });
    return;
  }

  const metadata = await fetchStreamMetadata(url);
  metadataCache.set(url, {
    ts: Date.now(),
    result: metadata
  });
  const { title, logs, source } = metadata;
  if (title) {
    res.json({ title, logs, source });
    return;
  }

  // Fallback: Try top-radio.ru for Russian stations
  const slug = getTopRadioSlug(url);
  if (slug) {
    logs.push(`Trying top-radio.ru fallback for ${slug}`);
    const topRadioTitle = await fetchFromTopRadio(slug);
    if (topRadioTitle) {
      logs.push(`Got from top-radio: ${topRadioTitle}`);
      const result = { title: topRadioTitle, logs, source: 'top-radio.ru' };
      metadataCache.set(url, {
        ts: Date.now(),
        result
      });
      res.json(result);
      return;
    }
  }

  res.status(404).json({ error: 'No metadata found', logs, source });
});

app.get('/extract', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  if (isBlockedHost(url)) {
    res.status(403).json({ error: 'blocked host' });
    return;
  }

  try {
    const base = EXTRACTOR_URL.replace(/\/+$/, '');
    const upstream = await fetch(
      `${base}/extract?url=${encodeURIComponent(url)}`,
      {
        headers: { 'User-Agent': USER_AGENT }
      }
    );
    const body = await upstream.text();
    const type = upstream.headers.get('content-type');
    if (type) res.setHeader('content-type', type);
    res.status(upstream.status).send(body);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Extractor failed'
    });
  }
});

app.get('/fetch', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  try {
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol)) {
      res.status(400).json({ error: 'invalid protocol' });
      return;
    }

    const response = await fetch(target.toString(), {
      headers: { 'User-Agent': USER_AGENT }
    });

    // Forward status code
    res.status(response.status);

    // Forward content-type if present
    const type = response.headers.get('content-type');
    if (type) res.setHeader('content-type', type);

    const text = await response.text();
    res.send(text);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`RadioAtlas API on ${port}`);
});
