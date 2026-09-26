import type { PosterArt } from './calmStories';
import './calm-poster-art.css';

// The A4 poster: a drawn cover for an editorial story. Decorative CSS art — no
// station image, no invented listener figure — so it stays honest and cheap.
// The drawn word is the story's own (locale `journal.stories.<key>.poster`), in
// the listener's language: the cover says what the shelf really filters.
export function CalmPoster({ art, word, lead = false }: { art: PosterArt; word?: string; lead?: boolean }) {
  return (
    <div className={`calm-poster calm-poster-${art} ${lead ? 'calm-poster-lead' : ''}`.trim()} aria-hidden="true">
      <div className="calm-poster-record"><i /></div>
      <div className="calm-poster-lines" />
      {art === 'jazz' && <svg className="calm-poster-illustration calm-poster-tonearm" viewBox="0 0 180 160"><circle cx="143" cy="34" r="8" /><path d="m143 42-43 42m-5 5 5-5 7 5m-7-5-6-7" /></svg>}
      {art === 'night' && <svg className="calm-poster-illustration calm-poster-window" viewBox="0 0 180 160"><path d="M28 139V32h94v107M28 66h94M75 32v107" /><path className="calm-poster-crescent" d="M145 39a28 28 0 1 0 0 48 25 25 0 0 1 0-48z" /><path d="M35 125h24m23 0h32" /></svg>}
      {art === 'world' && <svg className="calm-poster-illustration calm-poster-meridians" viewBox="0 0 180 160"><circle cx="92" cy="80" r="58" /><ellipse cx="92" cy="80" rx="27" ry="58" /><ellipse cx="92" cy="80" rx="48" ry="58" /><path d="M34 80h116M42 57h100M42 103h100M92 22v116" /><circle className="calm-poster-orbit-dot" cx="138" cy="53" r="5" /></svg>}
      {word && <b>{word}</b>}
    </div>
  );
}
