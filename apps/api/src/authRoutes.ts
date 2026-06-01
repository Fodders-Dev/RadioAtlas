import { randomUUID } from 'node:crypto';
import type express from 'express';
import {
  __forceSessionExpiryForTesting,
  __inspectSessionForTesting,
  attributeReferral,
  consumeLinkRequest,
  createSessionForAccount,
  getAccountAuditTrail,
  getAccountByProvider,
  getAccountByToken,
  linkGoogleIdentity,
  linkTelegramIdentity,
  linkVkIdentity,
  peekLinkRequest,
  previewGoogleLink,
  previewTelegramLink,
  previewVkLink,
  recordAccountEvent,
  updateAccountLibrary,
  type LibraryMergeStrategy
} from './accountStore.js';
import { verifyGoogleIdToken } from './googleAuth.js';
import { buildSessionEnvelope, encodeFixtureGoogleCredential, getBearerToken, parseMergeStrategy, redirectToWebapp } from './routeSupport.js';
import { validateTelegramInitData, validateTelegramLoginWidgetData } from './telegramAuth.js';
import { buildVkAuthUrl, exchangeVkCode, type VkIdentity } from './vkAuth.js';

type VkAuthState = {
  state: string;
  accountId: string | null;
  mergeStrategy: LibraryMergeStrategy;
  createdAt: number;
  expiresAt: number;
};

type VkAuthTicket = {
  ticket: string;
  identity: VkIdentity;
  preview: Awaited<ReturnType<typeof previewVkLink>>;
  accountId: string | null;
  mergeStrategy: LibraryMergeStrategy;
  createdAt: number;
  expiresAt: number;
};

const pruneExpiredAuthState = (
  vkAuthStates: Map<string, VkAuthState>,
  vkAuthTickets: Map<string, VkAuthTicket>
) => {
  const now = Date.now();
  for (const [key, value] of vkAuthStates) {
    if (value.expiresAt <= now) {
      vkAuthStates.delete(key);
    }
  }
  for (const [key, value] of vkAuthTickets) {
    if (value.expiresAt <= now) {
      vkAuthTickets.delete(key);
    }
  }
};

// Resolve the link target for a provider sign-in / preview call. Per T0.5
// the ONLY way for a provider callback to attach an identity to a
// pre-existing account is to present a one-time linkCode that the account
// holder explicitly minted via /me/link-request. Authorization headers on
// provider callbacks are no longer treated as link authority - they are
// purely advisory, used at most to short-circuit issuing a new session if
// the resulting account happens to be the same one the caller was already
// signed in as.
type LinkCodeOk = {
  ok: true;
  targetAccountId: string | null;
  mergeStrategy: LibraryMergeStrategy;
};
type LinkCodeError = { ok: false; status: number; error: string };
type LinkCodeResolution = LinkCodeOk | LinkCodeError;

const resolveLinkCodeForSignIn = async (
  rawLinkCode: string,
  fallbackMergeStrategy: LibraryMergeStrategy
): Promise<LinkCodeResolution> => {
  if (!rawLinkCode) {
    return { ok: true, targetAccountId: null, mergeStrategy: fallbackMergeStrategy };
  }
  const linkRequest = await consumeLinkRequest(rawLinkCode);
  if (!linkRequest) {
    return { ok: false, status: 409, error: 'link request expired or unknown' };
  }
  return {
    ok: true,
    targetAccountId: linkRequest.accountId,
    mergeStrategy: linkRequest.mergeStrategy || fallbackMergeStrategy
  };
};

const resolveLinkCodeForPreview = async (
  rawLinkCode: string,
  fallbackMergeStrategy: LibraryMergeStrategy
): Promise<LinkCodeResolution> => {
  if (!rawLinkCode) {
    return { ok: true, targetAccountId: null, mergeStrategy: fallbackMergeStrategy };
  }
  const linkRequest = await peekLinkRequest(rawLinkCode);
  if (!linkRequest) {
    return { ok: false, status: 409, error: 'link request expired or unknown' };
  }
  return {
    ok: true,
    targetAccountId: linkRequest.accountId,
    mergeStrategy: linkRequest.mergeStrategy || fallbackMergeStrategy
  };
};

const issueSessionForAccount = async (
  accountId: string,
  currentToken: string,
  currentAccount: { id: string } | null
) => {
  if (currentToken && currentAccount && currentAccount.id === accountId) {
    return currentToken;
  }
  return createSessionForAccount(accountId);
};

export const registerAuthRoutes = (
  app: express.Express,
  options: {
    telegramBotToken: string;
    googleClientId: string;
    vkClientId: string;
    vkClientSecret: string;
    vkRedirectUri: string;
    oauthTtlMs: number;
    webappUrl: string;
    enableTestAuthFixtures: boolean;
    nodeEnv: string;
  }
) => {
  const vkAuthStates = new Map<string, VkAuthState>();
  const vkAuthTickets = new Map<string, VkAuthTicket>();

  app.get('/auth/providers', (_req, res) => {
    res.json({
      telegram: {
        configured: Boolean(options.telegramBotToken),
        label: 'Telegram'
      },
      google: {
        configured: Boolean(options.googleClientId),
        label: 'Google'
      },
      vk: {
        configured: Boolean(options.vkClientId && options.vkClientSecret && options.vkRedirectUri),
        label: 'VK'
      }
    });
  });

  app.post('/auth/telegram', async (req, res) => {
    if (!options.telegramBotToken) {
      res.status(503).json({ error: 'telegram auth is not configured' });
      return;
    }

    const initData = typeof req.body?.initData === 'string' ? req.body.initData : '';
    if (!initData.trim()) {
      res.status(400).json({ error: 'initData is required' });
      return;
    }

    try {
      const validated = validateTelegramInitData(initData, options.telegramBotToken);
      const currentToken = getBearerToken(req);
      const currentAccount = currentToken ? await getAccountByToken(currentToken) : null;
      // T_share_4: capture whether this Telegram identity is brand new BEFORE we
      // link it, so referral attribution can fire only on a genuine first sign-in.
      const existingTelegramAccount = await getAccountByProvider(
        'telegram',
        String(validated.user.id)
      );
      const wasNewInvitee = !existingTelegramAccount;
      const requestedMergeStrategy = parseMergeStrategy(req.body?.mergeStrategy);
      const bodyLinkCode = typeof req.body?.linkCode === 'string' ? req.body.linkCode.trim() : '';
      const startParamLinkCode = validated.startParam?.startsWith('link_')
        ? validated.startParam.slice('link_'.length).trim()
        : '';
      const rawLinkCode = bodyLinkCode || startParamLinkCode;
      const resolution = await resolveLinkCodeForSignIn(rawLinkCode, requestedMergeStrategy);
      if (!resolution.ok) {
        res.status(resolution.status).json({ error: resolution.error });
        return;
      }
      const account = await linkTelegramIdentity(
        validated.user,
        resolution.targetAccountId,
        resolution.mergeStrategy
      );
      if (!account) {
        res.status(500).json({ error: 'telegram identity link failed' });
        return;
      }
      const token = await issueSessionForAccount(account.id, currentToken, currentAccount);
      await recordAccountEvent(
        account.id,
        'sign_in',
        {
          reusedSession: token === currentToken,
          linkRequest: Boolean(resolution.targetAccountId)
        },
        { kind: 'telegram', externalId: String(validated.user.id) }
      );
      // T_share_4: referral attribution is a fail-safe SIDE-EFFECT, never an auth
      // gate. The whole ref-logic is wrapped here so a throw CANNOT reach the
      // session response below — any failure is swallowed + logged and the user
      // still signs in. Fires only for a brand-new invitee (wasNewInvitee), and
      // attributeReferral itself re-guards self-refer / one-inviter / real-inviter.
      if (wasNewInvitee) {
        try {
          await attributeReferral({
            startParam: validated.startParam,
            inviteeAccountId: account.id
          });
        } catch (referralError) {
          console.error(
            '[T_share_4] referral attribution failed (sign-in unaffected):',
            referralError
          );
        }
      }
      res.json(await buildSessionEnvelope(token, account));
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'telegram auth failed' });
    }
  });

  app.post('/auth/telegram/preview', async (req, res) => {
    if (!options.telegramBotToken) {
      res.status(503).json({ error: 'telegram auth is not configured' });
      return;
    }

    const initData = typeof req.body?.initData === 'string' ? req.body.initData : '';
    if (!initData.trim()) {
      res.status(400).json({ error: 'initData is required' });
      return;
    }

    try {
      const validated = validateTelegramInitData(initData, options.telegramBotToken);
      const requestedMergeStrategy = parseMergeStrategy(req.body?.mergeStrategy);
      const bodyLinkCode = typeof req.body?.linkCode === 'string' ? req.body.linkCode.trim() : '';
      const startParamLinkCode = validated.startParam?.startsWith('link_')
        ? validated.startParam.slice('link_'.length).trim()
        : '';
      const rawLinkCode = bodyLinkCode || startParamLinkCode;
      const resolution = await resolveLinkCodeForPreview(rawLinkCode, requestedMergeStrategy);
      if (!resolution.ok) {
        res.status(resolution.status).json({ error: resolution.error });
        return;
      }
      const preview = await previewTelegramLink(
        validated.user,
        resolution.targetAccountId,
        resolution.mergeStrategy
      );
      res.json({ preview });
    } catch (err) {
      res
        .status(401)
        .json({ error: err instanceof Error ? err.message : 'telegram auth preview failed' });
    }
  });

  app.post('/auth/telegram/widget', async (req, res) => {
    if (!options.telegramBotToken) {
      res.status(503).json({ error: 'telegram auth is not configured' });
      return;
    }

    const authData =
      req.body?.authData && typeof req.body.authData === 'object' ? req.body.authData : null;
    if (!authData) {
      res.status(400).json({ error: 'authData is required' });
      return;
    }

    try {
      const validated = validateTelegramLoginWidgetData(authData, options.telegramBotToken);
      const currentToken = getBearerToken(req);
      const currentAccount = currentToken ? await getAccountByToken(currentToken) : null;
      const requestedMergeStrategy = parseMergeStrategy(req.body?.mergeStrategy);
      const rawLinkCode = typeof req.body?.linkCode === 'string' ? req.body.linkCode.trim() : '';
      const resolution = await resolveLinkCodeForSignIn(rawLinkCode, requestedMergeStrategy);
      if (!resolution.ok) {
        res.status(resolution.status).json({ error: resolution.error });
        return;
      }
      const account = await linkTelegramIdentity(
        validated.user,
        resolution.targetAccountId,
        resolution.mergeStrategy
      );
      if (!account) {
        res.status(500).json({ error: 'telegram widget identity link failed' });
        return;
      }
      const token = await issueSessionForAccount(account.id, currentToken, currentAccount);
      await recordAccountEvent(
        account.id,
        'sign_in',
        {
          reusedSession: token === currentToken,
          source: 'telegram-widget',
          linkRequest: Boolean(resolution.targetAccountId)
        },
        { kind: 'telegram', externalId: String(validated.user.id) }
      );
      res.json(await buildSessionEnvelope(token, account));
    } catch (err) {
      res
        .status(401)
        .json({ error: err instanceof Error ? err.message : 'telegram widget auth failed' });
    }
  });

  app.post('/auth/telegram/widget/preview', async (req, res) => {
    if (!options.telegramBotToken) {
      res.status(503).json({ error: 'telegram auth is not configured' });
      return;
    }

    const authData =
      req.body?.authData && typeof req.body.authData === 'object' ? req.body.authData : null;
    if (!authData) {
      res.status(400).json({ error: 'authData is required' });
      return;
    }

    try {
      const validated = validateTelegramLoginWidgetData(authData, options.telegramBotToken);
      const requestedMergeStrategy = parseMergeStrategy(req.body?.mergeStrategy);
      const rawLinkCode = typeof req.body?.linkCode === 'string' ? req.body.linkCode.trim() : '';
      const resolution = await resolveLinkCodeForPreview(rawLinkCode, requestedMergeStrategy);
      if (!resolution.ok) {
        res.status(resolution.status).json({ error: resolution.error });
        return;
      }
      const preview = await previewTelegramLink(
        validated.user,
        resolution.targetAccountId,
        resolution.mergeStrategy
      );
      res.json({ preview });
    } catch (err) {
      res
        .status(401)
        .json({ error: err instanceof Error ? err.message : 'telegram widget auth preview failed' });
    }
  });

  app.post('/auth/google', async (req, res) => {
    if (!options.googleClientId) {
      res.status(503).json({ error: 'google auth is not configured' });
      return;
    }

    const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
    if (!credential.trim()) {
      res.status(400).json({ error: 'credential is required' });
      return;
    }

    try {
      const identity = await verifyGoogleIdToken(credential, options.googleClientId);
      const currentToken = getBearerToken(req);
      const currentAccount = currentToken ? await getAccountByToken(currentToken) : null;
      const requestedMergeStrategy = parseMergeStrategy(req.body?.mergeStrategy);
      const rawLinkCode = typeof req.body?.linkCode === 'string' ? req.body.linkCode.trim() : '';
      const resolution = await resolveLinkCodeForSignIn(rawLinkCode, requestedMergeStrategy);
      if (!resolution.ok) {
        res.status(resolution.status).json({ error: resolution.error });
        return;
      }
      const account = await linkGoogleIdentity(
        identity,
        resolution.targetAccountId,
        resolution.mergeStrategy
      );
      if (!account) {
        res.status(500).json({ error: 'google identity link failed' });
        return;
      }
      const token = await issueSessionForAccount(account.id, currentToken, currentAccount);
      await recordAccountEvent(
        account.id,
        'sign_in',
        {
          reusedSession: token === currentToken,
          linkRequest: Boolean(resolution.targetAccountId)
        },
        { kind: 'google', externalId: identity.sub }
      );
      res.json(await buildSessionEnvelope(token, account));
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'google auth failed' });
    }
  });

  app.post('/auth/google/preview', async (req, res) => {
    if (!options.googleClientId) {
      res.status(503).json({ error: 'google auth is not configured' });
      return;
    }

    const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
    if (!credential.trim()) {
      res.status(400).json({ error: 'credential is required' });
      return;
    }

    try {
      const identity = await verifyGoogleIdToken(credential, options.googleClientId);
      const requestedMergeStrategy = parseMergeStrategy(req.body?.mergeStrategy);
      const rawLinkCode = typeof req.body?.linkCode === 'string' ? req.body.linkCode.trim() : '';
      const resolution = await resolveLinkCodeForPreview(rawLinkCode, requestedMergeStrategy);
      if (!resolution.ok) {
        res.status(resolution.status).json({ error: resolution.error });
        return;
      }
      const preview = await previewGoogleLink(
        identity,
        resolution.targetAccountId,
        resolution.mergeStrategy
      );
      res.json({ preview });
    } catch (err) {
      res
        .status(401)
        .json({ error: err instanceof Error ? err.message : 'google auth preview failed' });
    }
  });

  app.get('/auth/vk/start', async (req, res) => {
    if (!options.vkClientId || !options.vkClientSecret || !options.vkRedirectUri) {
      res.status(503).json({ error: 'vk auth is not configured' });
      return;
    }

    pruneExpiredAuthState(vkAuthStates, vkAuthTickets);
    const requestedMergeStrategy = parseMergeStrategy(req.query.mergeStrategy);
    const rawLinkCode = typeof req.query.linkCode === 'string' ? req.query.linkCode.trim() : '';
    const resolution = await resolveLinkCodeForSignIn(rawLinkCode, requestedMergeStrategy);
    if (!resolution.ok) {
      res.status(resolution.status).json({ error: resolution.error });
      return;
    }
    const state = randomUUID();
    vkAuthStates.set(state, {
      state,
      accountId: resolution.targetAccountId,
      mergeStrategy: resolution.mergeStrategy,
      createdAt: Date.now(),
      expiresAt: Date.now() + options.oauthTtlMs
    });

    res.json({
      authUrl: buildVkAuthUrl({
        clientId: options.vkClientId,
        redirectUri: options.vkRedirectUri,
        state
      })
    });
  });

  app.get('/auth/vk/callback', async (req, res) => {
    if (!options.vkClientId || !options.vkClientSecret || !options.vkRedirectUri) {
      redirectToWebapp(req, res, options.webappUrl, {
        auth_provider: 'vk',
        auth_result: 'error',
        message: 'vk auth is not configured'
      });
      return;
    }

    pruneExpiredAuthState(vkAuthStates, vkAuthTickets);
    const stateValue = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = stateValue ? vkAuthStates.get(stateValue) || null : null;
    if (stateValue) {
      vkAuthStates.delete(stateValue);
    }

    if (!state || state.expiresAt <= Date.now()) {
      redirectToWebapp(req, res, options.webappUrl, {
        auth_provider: 'vk',
        auth_result: 'error',
        message: 'vk auth session expired'
      });
      return;
    }

    if (!code.trim()) {
      redirectToWebapp(req, res, options.webappUrl, {
        auth_provider: 'vk',
        auth_result: 'error',
        message: 'vk auth code is missing'
      });
      return;
    }

    try {
      const identity = await exchangeVkCode({
        code,
        clientId: options.vkClientId,
        clientSecret: options.vkClientSecret,
        redirectUri: options.vkRedirectUri
      });
      const preview = await previewVkLink(identity, state.accountId, state.mergeStrategy);
      if (preview.requiresConfirmation) {
        const ticket = randomUUID();
        vkAuthTickets.set(ticket, {
          ticket,
          identity,
          preview,
          accountId: state.accountId,
          mergeStrategy: state.mergeStrategy,
          createdAt: Date.now(),
          expiresAt: Date.now() + options.oauthTtlMs
        });
        redirectToWebapp(req, res, options.webappUrl, {
          auth_provider: 'vk',
          auth_result: 'preview',
          ticket
        });
        return;
      }

      const account = await linkVkIdentity(identity, state.accountId, state.mergeStrategy);
      const token = await createSessionForAccount(account!.id);
      await recordAccountEvent(
        account!.id,
        'sign_in',
        { reusedSession: false },
        { kind: 'vk', externalId: String(identity.id) }
      );
      redirectToWebapp(req, res, options.webappUrl, {
        auth_provider: 'vk',
        auth_result: 'success',
        token
      });
    } catch (err) {
      redirectToWebapp(req, res, options.webappUrl, {
        auth_provider: 'vk',
        auth_result: 'error',
        message: err instanceof Error ? err.message : 'vk auth failed'
      });
    }
  });

  app.post('/auth/vk/preview', async (req, res) => {
    pruneExpiredAuthState(vkAuthStates, vkAuthTickets);
    const ticketValue = typeof req.body?.ticket === 'string' ? req.body.ticket.trim() : '';
    if (!ticketValue) {
      res.status(400).json({ error: 'ticket is required' });
      return;
    }
    const ticket = vkAuthTickets.get(ticketValue) || null;
    if (!ticket || ticket.expiresAt <= Date.now()) {
      vkAuthTickets.delete(ticketValue);
      res.status(404).json({ error: 'vk auth ticket is invalid' });
      return;
    }
    res.json({ preview: ticket.preview });
  });

  app.post('/auth/vk/confirm', async (req, res) => {
    pruneExpiredAuthState(vkAuthStates, vkAuthTickets);
    const ticketValue = typeof req.body?.ticket === 'string' ? req.body.ticket.trim() : '';
    if (!ticketValue) {
      res.status(400).json({ error: 'ticket is required' });
      return;
    }
    const ticket = vkAuthTickets.get(ticketValue) || null;
    if (!ticket || ticket.expiresAt <= Date.now()) {
      vkAuthTickets.delete(ticketValue);
      res.status(404).json({ error: 'vk auth ticket is invalid' });
      return;
    }
    vkAuthTickets.delete(ticketValue);

    try {
      const mergeStrategy = parseMergeStrategy(req.body?.mergeStrategy || ticket.mergeStrategy);
      const account = await linkVkIdentity(ticket.identity, ticket.accountId, mergeStrategy);
      const token = await createSessionForAccount(account!.id);
      await recordAccountEvent(
        account!.id,
        'sign_in',
        { reusedSession: false },
        { kind: 'vk', externalId: String(ticket.identity.id) }
      );
      res.json(await buildSessionEnvelope(token, account!));
    } catch (err) {
      res
        .status(401)
        .json({ error: err instanceof Error ? err.message : 'vk auth confirm failed' });
    }
  });

  if (options.enableTestAuthFixtures && options.nodeEnv === 'production') {
    // Defence-in-depth: the boot assertion in index.ts already refuses
    // to start with this combination, but if a caller wires
    // registerAuthRoutes directly (e.g., a future test harness, an
    // embedding host) we still refuse to register the fixture surfaces
    // and log loudly. We do NOT throw - the rest of the app must keep
    // serving traffic.
    console.error('test fixtures attempted to wire in production - refusing');
  } else if (options.enableTestAuthFixtures) {
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
            tags: 'test',
            geo_lat: null,
            geo_long: null
          }
        ],
        recent: [
          {
            stationuuid: `fixture-current-recent-a-${stamp}`,
            name: 'Current Recent A',
            url_resolved: 'https://stream.example.com/current-recent',
            favicon: '',
            country: 'Russia',
            state: 'Moscow',
            tags: 'test',
            geo_lat: null,
            geo_long: null
          }
        ],
        trackHistory: [
          {
            id: `fixture-current-track-${stamp}`,
            stationId: `fixture-current-fav-a-${stamp}`,
            stationName: 'Current Favorite A',
            track: 'Current Artist - Current Song',
            timestamp: Date.now()
          }
        ]
      };
      const incomingLibrary = {
        favorites: [
          {
            stationuuid: `fixture-incoming-fav-a-${stamp}`,
            name: 'Incoming Favorite A',
            url_resolved: 'https://stream.example.com/incoming-a',
            favicon: '',
            country: 'Germany',
            state: 'Berlin',
            tags: 'test',
            geo_lat: null,
            geo_long: null
          }
        ],
        recent: [
          {
            stationuuid: `fixture-incoming-recent-a-${stamp}`,
            name: 'Incoming Recent A',
            url_resolved: 'https://stream.example.com/incoming-recent',
            favicon: '',
            country: 'Germany',
            state: 'Berlin',
            tags: 'test',
            geo_lat: null,
            geo_long: null
          }
        ],
        trackHistory: [
          {
            id: `fixture-incoming-track-${stamp}`,
            stationId: `fixture-incoming-fav-a-${stamp}`,
            stationName: 'Incoming Favorite A',
            track: 'Incoming Artist - Incoming Song',
            timestamp: Date.now()
          }
        ]
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
        },
        auditTrail: await getAccountAuditTrail(currentAccount!.id)
      });
    });

    app.post('/test/auth/issue-session', async (req, res) => {
      const accountId =
        typeof req.body?.accountId === 'string' ? req.body.accountId : '';
      if (!accountId) {
        res.status(400).json({ error: 'accountId is required' });
        return;
      }
      const token = await createSessionForAccount(accountId);
      res.json({ token });
    });

    app.post('/test/auth/expire-session', async (req, res) => {
      const token = typeof req.body?.token === 'string' ? req.body.token : '';
      if (!token) {
        res.status(400).json({ error: 'token is required' });
        return;
      }
      const expired = await __forceSessionExpiryForTesting(token);
      res.json({ expired });
    });

    app.post('/test/auth/inspect-session', async (req, res) => {
      const token = typeof req.body?.token === 'string' ? req.body.token : '';
      if (!token) {
        res.status(400).json({ error: 'token is required' });
        return;
      }
      const info = await __inspectSessionForTesting(token);
      if (!info) {
        res.json({ exists: false, expiresAt: null, accountId: null });
        return;
      }
      res.json({ exists: true, expiresAt: info.expiresAt, accountId: info.accountId });
    });
  }
};
