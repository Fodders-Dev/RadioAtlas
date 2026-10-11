import type express from 'express';
import type { AiModelConfig } from './ai/types.js';
import {
  extractMusicImageCandidates,
  MUSIC_IMAGE_DEADLINE_MS,
  MusicImageError,
  MusicImageRateLimitError,
  musicImageEnabled
} from './ai/musicImage.js';
import { MediaOverloadError, ProtectedMediaRoute } from './media/protection.js';
import { bumpCounter } from './observabilityStore.js';

const HOUR_MS = 60 * 60_000;
const globalStarts: number[] = [];

export const __resetMusicImageRateState = () => { globalStarts.length = 0; };

export const registerMusicImageRoutes = (
  app: express.Express,
  options: {
    model: AiModelConfig;
    fetch?: typeof fetch;
    now?: () => number;
    sharedMaxConcurrency?: number;
    deadlineMs?: number;
  }
) => {
  const enabled = musicImageEnabled(options.model);
  const provider = enabled
    ? options.model.provider === 'openai' ? 'gpt-6-luna' : 'deepseek'
    : undefined;
  const guard = new ProtectedMediaRoute<unknown>({
    routeName: 'ai-music-image',
    maxConcurrency: 1,
    sharedMaxConcurrency: options.sharedMaxConcurrency ?? 8,
    rateLimitPerWindow: 3,
    rateLimitWindowMs: 60_000,
    maxRateLimitKeys: 10_000
  });
  const now = options.now || (() => Date.now());

  app.get('/ai/music-image', (_req, res) => {
    res.json(enabled ? { enabled: true, provider } : { enabled: false });
  });

  app.post('/ai/music-image', async (req, res) => {
    if (!enabled) {
      res.status(503).json({ error: 'unavailable' });
      return;
    }
    const retryAfter = guard.checkRateLimit(req);
    if (retryAfter !== null) {
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    const controller = new AbortController();
    const onAborted = () => controller.abort();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once('aborted', onAborted);
    res.once('close', onClose);
    let timedOut = false;
    try {
      const result = await guard.run(null, async () => {
        const deadlineMs = options.deadlineMs ?? MUSIC_IMAGE_DEADLINE_MS;
        const deadlineAt = Date.now() + deadlineMs;
        const timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
          // Answer at the total deadline, while the protected task continues
          // to hold its slot until Sharp or the provider actually settles.
          if (!res.destroyed && !res.writableEnded) {
            if (!req.complete) {
              res.setHeader('Connection', 'close');
              res.once('finish', () => req.destroy());
            }
            res.status(504).json({ error: 'timeout' });
          }
        }, deadlineMs);
        try {
          return await extractMusicImageCandidates({
            req,
            model: options.model,
            fetch: options.fetch,
            signal: controller.signal,
            deadlineAt,
            beforeProvider: () => {
              const started = now();
              const hourAgo = started - HOUR_MS;
              while (globalStarts.length && (globalStarts[0] ?? Number.POSITIVE_INFINITY) <= hourAgo) globalStarts.shift();
              if (globalStarts.length >= 30) {
                bumpCounter('media_rate_limit:ai-music-image');
                throw new MusicImageRateLimitError();
              }
              globalStarts.push(started);
            }
          });
        } finally {
          clearTimeout(timeout);
        }
      });
      if (!res.destroyed && !res.writableEnded) res.json({ candidates: result });
    } catch (error) {
      if (res.destroyed || res.writableEnded || controller.signal.aborted && !timedOut) return;
      if (error instanceof MediaOverloadError || error instanceof MusicImageRateLimitError) {
        res.status(429).json({ error: 'rate_limited' });
      } else if (timedOut || controller.signal.aborted) {
        res.status(504).json({ error: 'timeout' });
      } else if (error instanceof MusicImageError) {
        const status = error.code === 'invalid_image' ? 400
          : error.code === 'image_too_large' ? 413
            : error.code === 'unsupported_image' ? 415
              : error.code === 'timeout' ? 504 : 503;
        if (error.code === 'unavailable') bumpCounter('ai_music_image_provider_error');
        if (!req.complete) res.setHeader('Connection', 'close');
        res.status(status).json({ error: error.code });
      } else {
        bumpCounter('ai_music_image_error');
        res.status(503).json({ error: 'unavailable' });
      }
    } finally {
      req.removeListener('aborted', onAborted);
      res.removeListener('close', onClose);
    }
  });
};
