// A pure rolling-window counter. The assistant runtime uses ONE instance across
// BOTH surfaces (Mini App + Telegram) as the global cost backstop: even if a
// flood arrives from many distinct real IPs (so the per-IP limiter never trips),
// the total number of accepted chats per window is capped, and overflow returns
// a warm fallback WITHOUT calling DeepSeek. Concurrency stays the per-second
// backstop; this caps total volume. `now` is injected for testability.

export type RollingVolumeCap = {
  // Returns true when THIS call pushes the window OVER the cap (reject it).
  exceeded: () => boolean;
};

export const createRollingVolumeCap = (options: {
  windowMs: number;
  max: number;
  now: () => number;
}): RollingVolumeCap => {
  let windowStart = options.now();
  let count = 0;
  return {
    exceeded: () => {
      const t = options.now();
      if (t - windowStart >= options.windowMs) {
        windowStart = t;
        count = 0;
      }
      count += 1;
      return count > options.max;
    }
  };
};
