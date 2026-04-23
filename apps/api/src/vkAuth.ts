export type VkIdentity = {
  id: number;
  first_name?: string;
  last_name?: string;
  screen_name?: string;
  photo_200?: string;
  email?: string;
};

type VkTokenResponse = {
  access_token?: string;
  user_id?: number;
  email?: string;
  error?: string;
  error_description?: string;
};

type VkUsersResponse = {
  response?: Array<{
    id: number;
    first_name?: string;
    last_name?: string;
    screen_name?: string;
    photo_200?: string;
  }>;
  error?: {
    error_code: number;
    error_msg: string;
  };
};

const TEST_FIXTURE_PREFIX = 'fixture-vk:';

export const buildVkAuthUrl = ({
  clientId,
  redirectUri,
  state
}: {
  clientId: string;
  redirectUri: string;
  state: string;
}) => {
  const url = new URL('https://oauth.vk.com/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'email');
  url.searchParams.set('state', state);
  url.searchParams.set('v', '5.199');
  return url.toString();
};

const decodeFixtureIdentity = (code: string): VkIdentity | null => {
  if (process.env.ENABLE_TEST_AUTH_FIXTURES !== '1') return null;
  if (!code.startsWith(TEST_FIXTURE_PREFIX)) return null;
  try {
    const raw = code.slice(TEST_FIXTURE_PREFIX.length).trim();
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const identity = JSON.parse(decoded) as VkIdentity;
    if (!identity?.id) {
      throw new Error('fixture payload is invalid');
    }
    return identity;
  } catch {
    throw new Error('fixture vk code could not be decoded');
  }
};

export const exchangeVkCode = async ({
  code,
  clientId,
  clientSecret,
  redirectUri
}: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) => {
  const fixtureIdentity = decodeFixtureIdentity(code);
  if (fixtureIdentity) {
    return fixtureIdentity;
  }

  const tokenUrl = new URL('https://oauth.vk.com/access_token');
  tokenUrl.searchParams.set('client_id', clientId);
  tokenUrl.searchParams.set('client_secret', clientSecret);
  tokenUrl.searchParams.set('redirect_uri', redirectUri);
  tokenUrl.searchParams.set('code', code);

  const tokenResponse = await fetch(tokenUrl.toString(), {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!tokenResponse.ok) {
    throw new Error(`vk token exchange failed (${tokenResponse.status})`);
  }

  const tokenPayload = (await tokenResponse.json()) as VkTokenResponse;
  if (!tokenPayload.access_token || !tokenPayload.user_id) {
    throw new Error(tokenPayload.error_description || tokenPayload.error || 'vk token payload is invalid');
  }

  const usersUrl = new URL('https://api.vk.com/method/users.get');
  usersUrl.searchParams.set('user_ids', String(tokenPayload.user_id));
  usersUrl.searchParams.set('fields', 'photo_200,screen_name');
  usersUrl.searchParams.set('access_token', tokenPayload.access_token);
  usersUrl.searchParams.set('v', '5.199');

  const userResponse = await fetch(usersUrl.toString(), {
    headers: {
      Accept: 'application/json'
    }
  });
  if (!userResponse.ok) {
    throw new Error(`vk profile fetch failed (${userResponse.status})`);
  }

  const userPayload = (await userResponse.json()) as VkUsersResponse;
  const profile = userPayload.response?.[0];
  if (!profile?.id) {
    throw new Error(userPayload.error?.error_msg || 'vk profile payload is invalid');
  }

  return {
    ...profile,
    email: tokenPayload.email?.trim() || undefined
  } satisfies VkIdentity;
};
