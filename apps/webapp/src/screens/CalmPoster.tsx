import type { PosterArt } from './calmStories';

// The A4 poster: a drawn cover for an editorial story. Decorative CSS art — no
// station image, no invented listener figure — so it stays honest and cheap.
// The drawn word is the story's own (locale `journal.stories.<key>.poster`), in
// the listener's language: the cover says what the shelf really filters.
export function CalmPoster({ art, word, lead = false }: { art: PosterArt; word?: string; lead?: boolean }) {
  return (
    <div className={`calm-poster calm-poster-${art} ${lead ? 'calm-poster-lead' : ''}`.trim()} aria-hidden="true">
      <div className="calm-poster-record"><i /></div>
      <div className="calm-poster-lines" />
      {word && <b>{word}</b>}
    </div>
  );
}
