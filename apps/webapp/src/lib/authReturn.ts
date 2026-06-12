// OAuth-style return-from-redirect parsing, shared by the VK flow and the
// Telegram data-auth-url hotfix flow (browser sign-in on iOS/Huawei, where the
// widget's third-party-cookie onauth mode silently never fires). Pure so the
// SessionContext effect stays a thin shell over unit-tested logic.

export const AUTH_RETURN_PARAM_KEYS = [
  'auth_provider',
  'auth_result',
  'ticket',
  'token',
  'message'
] as const;

export type AuthReturn =
  | { provider: 'vk' | 'telegram'; result: 'success'; token: string }
  | { provider: 'vk'; result: 'preview'; ticket: string }
  | { provider: 'vk' | 'telegram'; result: 'error'; message: string };

export const parseAuthReturn = (href: string): AuthReturn | null => {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const provider = url.searchParams.get('auth_provider');
  const result = url.searchParams.get('auth_result');
  if ((provider !== 'vk' && provider !== 'telegram') || !result) {
    return null;
  }

  if (result === 'success') {
    return { provider, result, token: url.searchParams.get('token') || '' };
  }
  // The merge-preview ticket flow only exists for VK; the Telegram redirect
  // flow is guest sign-in only (linking stays on the widget-POST path).
  if (result === 'preview' && provider === 'vk') {
    return { provider, result, ticket: url.searchParams.get('ticket') || '' };
  }
  if (result === 'error') {
    return {
      provider,
      result,
      message: url.searchParams.get('message') || `${provider} auth failed`
    };
  }
  return null;
};

// Strip every auth-return param (token included) so the bearer never lingers
// in the address bar / history.
export const stripAuthReturnParams = (href: string): string => {
  const url = new URL(href);
  AUTH_RETURN_PARAM_KEYS.forEach((key) => url.searchParams.delete(key));
  return url.toString();
};
