/// <reference types="vite/client" />

declare global {
  const __APP_VERSION__: string;
  const __BUILD_TIME__: string;
  const __APP_COMMIT__: string;

  interface Window {
    Telegram?: {
      WebApp?: {
        ready?: () => void;
        expand?: () => void;
        openLink?: (
          url: string,
          options?: { try_instant_view?: boolean }
        ) => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        platform?: string;
        version?: string;
        isActive?: boolean;
        initDataUnsafe?: {
          start_param?: string;
        };
      };
    };
  }

  interface ImportMetaEnv {
    readonly VITE_TG_BOT?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export { };
