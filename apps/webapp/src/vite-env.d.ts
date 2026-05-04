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
        openTelegramLink?: (url: string) => void;
        openInvoice?: (
          url: string,
          callback?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void
        ) => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        platform?: string;
        version?: string;
        isActive?: boolean;
        initData?: string;
        initDataUnsafe?: {
          start_param?: string;
          user?: {
            id?: number;
            first_name?: string;
            last_name?: string;
            username?: string;
            language_code?: string;
            photo_url?: string;
          };
          auth_date?: number;
          hash?: string;
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
