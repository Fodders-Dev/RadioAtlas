export const APP_VERSION = __APP_VERSION__;
export const BUILD_TIME = __BUILD_TIME__;
export const APP_COMMIT = __APP_COMMIT__;

export const buildLabel = () => {
  const when = new Date(BUILD_TIME);
  if (Number.isNaN(when.getTime())) {
    return `v${APP_VERSION}+${APP_COMMIT}`;
  }
  const formatted = when.toLocaleString();
  return `v${APP_VERSION}+${APP_COMMIT} · ${formatted}`;
};
