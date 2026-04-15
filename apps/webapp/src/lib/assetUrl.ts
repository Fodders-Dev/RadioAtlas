import { getApiBase } from './apiBase';

const normalizeAssetUrl = (value?: string | null) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed;
};

const getAssetProtocol = (value: string) => {
  try {
    return new URL(value).protocol.toLowerCase();
  } catch {
    return '';
  }
};

export const getProxiedAssetUrl = (value?: string | null) => {
  const normalized = normalizeAssetUrl(value);
  if (!normalized) return '';
  const protocol = getAssetProtocol(normalized);
  if (protocol !== 'http:') return normalized;

  const apiBase = getApiBase();
  const proxyBase = apiBase || '/api';
  return `${proxyBase.replace(/\/+$/, '')}/image?url=${encodeURIComponent(normalized)}`;
};
