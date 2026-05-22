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
        // T1.3: Telegram client's per-user theme colors. Telegram does
        // not guarantee any of the 13 keys; clients send what they have.
        // Field is mutated in place by Telegram between themeChanged
        // events, so consumers should snapshot via {...themeParams}
        // before holding a reference to a specific value.
        themeParams?: {
          bg_color?: string;
          text_color?: string;
          hint_color?: string;
          link_color?: string;
          button_color?: string;
          button_text_color?: string;
          secondary_bg_color?: string;
          header_bg_color?: string;
          accent_text_color?: string;
          section_bg_color?: string;
          section_header_text_color?: string;
          subtitle_text_color?: string;
          destructive_text_color?: string;
        };
        // T1.3: subscribe/unsubscribe to client-side theme + viewport
        // events. We only consume 'themeChanged' today, but the SDK
        // surface accepts a wider event-name string set; keep this
        // loose so a future addition (e.g. 'viewportChanged') doesn't
        // require another type bump.
        onEvent?: (event: string, callback: () => void) => void;
        offEvent?: (event: string, callback: () => void) => void;
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
