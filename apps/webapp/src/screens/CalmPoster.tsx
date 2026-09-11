import type { PosterArt } from './calmStories';

// The A4 poster: a drawn cover for an editorial story. Decorative CSS art — no
// station image, no invented listener figure — so it stays honest and cheap.
const WORDS: Record<PosterArt, string> = {
  jazz: 'jazz.',
  night: 'slow\ndown',
  groove: 'GOOD\nGROOVE',
  world: 'ailleurs',
  road: 'on the\nroad',
  focus: 'focus.'
};

export function CalmPoster({ art, lead = false }: { art: PosterArt; lead?: boolean }) {
  return (
    <div className={`calm-poster calm-poster-${art} ${lead ? 'calm-poster-lead' : ''}`.trim()} aria-hidden="true">
      <div className="calm-poster-record"><i /></div>
      <div className="calm-poster-lines" />
      <b>{WORDS[art]}</b>
      <span>RADIOATLAS — EXPLORATIONS</span>
    </div>
  );
}
