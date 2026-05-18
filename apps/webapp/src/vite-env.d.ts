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
        // T1.2: disables the Telegram client's vertical-swipe-to-minimise
        // gesture so it stops competing with our own dock-tray. Once
        // disabled it persists for the WebApp lifetime; no re-enable
        // needed. Bot API 7.7+; no-op on standalone web.
        disableVerticalSwipes?: () => void;
        // T1.2: closing-confirmation pair. Driven by an effect that
        // watches the canonical audio-element `isPlaying` state, so
        // stream stalls / errors / station-change all flip the toggle
        // automatically without a UI button click being involved.
        // Both methods no-op on standalone web.
        enableClosingConfirmation?: () => void;
        disableClosingConfirmation?: () => void;
        // T1.2: Telegram-only physical feedback. Only impactOccurred is
        // wired today (single style argument), the rest of the
        // HapticFeedback surface is shape-faithful to the SDK so a
        // future expansion does not need another type bump.
        HapticFeedback?: {
          impactOccurred?: (
            style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'
          ) => void;
          notificationOccurred?: (type: 'error' | 'success' | 'warning') => void;
          selectionChanged?: () => void;
        };
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
