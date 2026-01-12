/// <reference types="vite/client" />

declare global {
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
