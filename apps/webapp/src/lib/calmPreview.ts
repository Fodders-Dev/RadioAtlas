// The A4 «Журнал» shell. On the production build it is the DEFAULT — the
// owner's call on 14.09.2026: «новый на radioatlas.ru, старый с припиской».
// The dev server and the test harness keep the classic shell as default, so
// the classic specs keep their subject and `?calm=1` keeps opening the new
// one there. The query wins either way: `?calm=1` forces the new shell,
// `?calm=0` or `?classic=1` the old one. Reload to switch.
const resolveCalm = (): boolean => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('calm') === '1') return true;
  if (params.get('calm') === '0' || params.get('classic') === '1') return false;
  return import.meta.env.PROD === true;
};

export const CALM_PREVIEW = resolveCalm();
