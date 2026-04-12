export type GoogleIdentity = {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
  email_verified?: boolean;
  aud?: string;
};

const TEST_FIXTURE_PREFIX = 'fixture-google:';

const decodeFixtureIdentity = (idToken: string, clientId: string): GoogleIdentity | null => {
  if (process.env.ENABLE_TEST_AUTH_FIXTURES !== '1') return null;
  if (!idToken.startsWith(TEST_FIXTURE_PREFIX)) return null;

  const encoded = idToken.slice(TEST_FIXTURE_PREFIX.length).trim();
  if (!encoded) {
    throw new Error('Fixture Google credential is invalid');
  }

  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as GoogleIdentity;
    if (!parsed?.sub) {
      throw new Error('Fixture Google credential payload is invalid');
    }
    return {
      ...parsed,
      aud: parsed.aud || clientId,
      email_verified: parsed.email_verified ?? true
    };
  } catch {
    throw new Error('Fixture Google credential could not be decoded');
  }
};

export const verifyGoogleIdToken = async (idToken: string, clientId: string) => {
  if (!idToken.trim()) {
    throw new Error('Google credential is required');
  }
  if (!clientId.trim()) {
    throw new Error('Google client id is not configured');
  }

  const fixtureIdentity = decodeFixtureIdentity(idToken, clientId);
  if (fixtureIdentity) {
    return fixtureIdentity;
  }

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );

  if (!response.ok) {
    throw new Error(`Google token verification failed (${response.status})`);
  }

  const payload = (await response.json()) as GoogleIdentity;
  if (!payload.sub) {
    throw new Error('Google token payload is invalid');
  }
  if (payload.aud !== clientId) {
    throw new Error('Google token audience mismatch');
  }
  if (payload.email && payload.email_verified === false) {
    throw new Error('Google email is not verified');
  }
  return payload;
};
