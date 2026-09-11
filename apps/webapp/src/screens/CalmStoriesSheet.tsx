import { useEffect, useRef } from 'react';
import { useLocale } from '../state/LocaleContext';
import { CalmPoster } from './CalmPoster';
import type { CalmStory } from './calmStories';

// «Ещё» under «Под настроение» (A4 mock: «Музыкальные истории»): every story
// the journal knows, as a two-column grid of the same posters, including the
// day's lead. A tap opens that story's real catalogue sheet.
export function CalmStoriesSheet({ stories, onSelect, onClose }: { stories: CalmStory[]; onSelect: (story: CalmStory) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { t } = useLocale();
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="calm-sheet calm-stories-sheet" aria-labelledby="calm-stories-title" onClose={onClose} data-calm-stories-sheet>
    <div className="calm-sheet-handle" aria-hidden="true" />
    <div className="calm-sheet-head"><div><span className="calm-eyebrow">{t('journal.moods')}</span><h2 id="calm-stories-title">{t('journal.allStories')}</h2></div><button className="calm-icon" onClick={() => dialog.current?.close()} aria-label={t('common.close')}>×</button></div>
    <div className="calm-stories-grid">{stories.map((story) => <button key={story.id} className="calm-story" data-calm-story-all={story.id} onClick={() => { onSelect(story); dialog.current?.close(); }}>
      <CalmPoster art={story.art} word={t(`journal.stories.${story.copyKey}.poster`)} />
      <span className="calm-story-caption"><span><small>{t(`journal.stories.${story.copyKey}.kicker`)}</small><strong>{t(`journal.stories.${story.copyKey}.title`)}</strong></span></span>
    </button>)}</div>
  </dialog>;
}
