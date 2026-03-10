import type { WinampMuseumSkin } from '../types';

const SKIN_MUSEUM_GRAPHQL_URL = 'https://skins.webamp.org/graphql';
const DEFAULT_PAGE_SIZE = 12;

type GraphQLError = {
  message: string;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLError[];
};

type MuseumSkinNode = {
  md5: string | null;
  filename: string | null;
  download_url: string | null;
  screenshot_url: string | null;
  museum_url: string | null;
  nsfw: boolean | null;
};

const SEARCH_CLASSIC_SKINS_QUERY = `
  query SearchClassicSkins($query: String!, $first: Int!, $offset: Int!) {
    search_classic_skins(query: $query, first: $first, offset: $offset) {
      md5
      filename
      download_url
      screenshot_url
      museum_url
      nsfw
    }
  }
`;

const FETCH_SKIN_BY_MD5_QUERY = `
  query FetchSkinByMd5($md5: String!) {
    fetch_skin_by_md5(md5: $md5) {
      ... on ClassicSkin {
        md5
        filename
        download_url
        screenshot_url
        museum_url
        nsfw
      }
    }
  }
`;

const toErrorMessage = (errors?: GraphQLError[]) =>
  errors?.map((item) => item.message).filter(Boolean).join('; ') || 'Skin Museum request failed';

const toMuseumSkin = (value: MuseumSkinNode | null | undefined): WinampMuseumSkin | null => {
  if (!value?.md5 || !value.download_url || !value.filename || !value.museum_url) {
    return null;
  }

  return {
    id: `museum:${value.md5}`,
    md5: value.md5,
    name: value.filename,
    url: value.download_url,
    museumUrl: value.museum_url,
    screenshotUrl: value.screenshot_url || null,
    nsfw: Boolean(value.nsfw)
  };
};

const postGraphQL = async <T,>(
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal
) => {
  const response = await fetch(SKIN_MUSEUM_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      query,
      variables
    }),
    signal
  });

  const payload = (await response.json()) as GraphQLResponse<T>;
  if (!response.ok || payload.errors?.length) {
    throw new Error(toErrorMessage(payload.errors));
  }
  if (!payload.data) {
    throw new Error('Skin Museum returned no data');
  }

  return payload.data;
};

export const searchMuseumSkins = async (
  query: string,
  {
    limit = DEFAULT_PAGE_SIZE,
    offset = 0,
    signal
  }: { limit?: number; offset?: number; signal?: AbortSignal } = {}
) => {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const data = await postGraphQL<{ search_classic_skins: MuseumSkinNode[] }>(
    SEARCH_CLASSIC_SKINS_QUERY,
    {
      query: trimmed,
      first: limit,
      offset
    },
    signal
  );

  return (data.search_classic_skins || []).map(toMuseumSkin).filter(Boolean) as WinampMuseumSkin[];
};

export const fetchMuseumSkinByMd5 = async (md5: string, signal?: AbortSignal) => {
  const trimmed = md5.trim();
  if (!trimmed) return null;

  const data = await postGraphQL<{ fetch_skin_by_md5: MuseumSkinNode | null }>(
    FETCH_SKIN_BY_MD5_QUERY,
    {
      md5: trimmed
    },
    signal
  );

  return toMuseumSkin(data.fetch_skin_by_md5);
};
