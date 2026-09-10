// Local review slice, off by default. Reload to enter/leave the preview.
export const CALM_PREVIEW = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('calm') === '1';
