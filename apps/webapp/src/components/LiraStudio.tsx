import { useId, type ReactNode } from 'react';
import { useLocale } from '../state/LocaleContext';
import type { ChatPromptSpec } from '../lib/chatPrompts';
import './LiraStudio.css';

type LiraStudioProps = {
  prompts: ChatPromptSpec[];
  onPrompt: (prompt: ChatPromptSpec, keyboardActivation: boolean) => void;
  children?: ReactNode;
};

type StudioArtKind = 'grooves' | 'wave' | 'energy' | 'booklet' | 'sleeve' | 'records' | 'night' | 'morning';

const artByPrompt: Record<string, StudioArtKind> = {
  'ctx-foreign': 'records',
  'ctx-station': 'sleeve',
  'ctx-track': 'booklet',
  'time-night': 'night',
  'time-morning': 'morning',
  'time-focus': 'wave',
  'time-evening': 'grooves',
  lofi: 'wave',
  energy: 'energy',
  retro: 'grooves',
  tokyo: 'sleeve',
  road: 'wave',
  faraway: 'records',
  surprise: 'booklet'
};

const StudioArt = ({ kind }: { kind: StudioArtKind }) => {
  if (kind === 'grooves') return (
    <svg viewBox="0 0 112 82" aria-hidden="true" focusable="false">
      <ellipse cx="60" cy="43" rx="37" ry="34" fill="#bb694d" />
      <ellipse cx="60" cy="43" rx="28" ry="26" fill="none" stroke="#f2d8ad" strokeWidth="1.4" />
      <ellipse cx="60" cy="43" rx="19" ry="18" fill="none" stroke="#f2d8ad" strokeWidth="1.2" />
      <ellipse cx="60" cy="43" rx="10" ry="9" fill="none" stroke="#f2d8ad" strokeWidth="1.2" />
      <circle cx="60" cy="43" r="4" fill="#f2d8ad" />
      <path d="M22 20a31 31 0 0 1 20-10M22 62a31 31 0 0 0 12 10" fill="none" stroke="#f2d8ad" strokeWidth="1.5" strokeLinecap="round" />
      <path d="m87 18 13 9-3 4-13-9z" fill="#334a3e" /><path d="m89 28-19 19" stroke="#334a3e" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
  if (kind === 'energy') return (
    <svg viewBox="0 0 112 82" aria-hidden="true" focusable="false">
      <path d="m20 65 7-29m12 29 10-49m12 49 7-36m12 36 11-54" stroke="#a75b42" strokeWidth="10" strokeLinecap="round" />
      <path d="M12 75h89" stroke="#75876b" strokeWidth="2" strokeLinecap="round" />
      <circle cx="18" cy="17" r="8" fill="#d4a34f" />
    </svg>
  );
  if (kind === 'wave') return (
    <svg viewBox="0 0 112 82" aria-hidden="true" focusable="false">
      <path d="M7 50c8 0 8-10 16-10s8 22 16 22 8-36 16-36 8 48 16 48 8-27 16-27 8 10 16 10" fill="none" stroke="#a75b42" strokeWidth="4" strokeLinecap="round" />
      <path d="M7 63c8 0 8-6 16-6s8 13 16 13 8-19 16-19 8 25 16 25 8-14 16-14 8 5 16 5" fill="none" stroke="#75876b" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M8 19h96" stroke="#a75b42" strokeWidth="1" strokeDasharray="2 4" opacity=".55" />
      <circle cx="92" cy="20" r="10" fill="#d4a34f" /><circle cx="92" cy="20" r="3" fill="#f5e6c8" />
    </svg>
  );
  if (kind === 'booklet') return (
    <svg viewBox="0 0 112 82" aria-hidden="true" focusable="false">
      <path d="M18 15h37v57H18z" fill="#d2a24d" /><path d="M55 19h40v53H55z" fill="#75876b" />
      <path d="M55 19v53" stroke="#f4e5c7" strokeWidth="2" />
      <circle cx="75" cy="44" r="17" fill="#a75b42" /><circle cx="75" cy="44" r="10" fill="none" stroke="#f5e6c8" strokeWidth="1.4" /><circle cx="75" cy="44" r="3.5" fill="#f5e6c8" />
      <path d="M24 25h23M24 31h17M24 61h20" stroke="#f4e5c7" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
  if (kind === 'sleeve') return (
    <svg viewBox="0 0 112 82" aria-hidden="true" focusable="false">
      <path d="M25 12h53l12 12v49H25z" fill="#d4a34f" />
      <path d="M78 12v14h12" fill="#f4e5c7" />
      <circle cx="66" cy="45" r="24" fill="#bb694d" stroke="#f5e6c8" strokeWidth="1.5" />
      <circle cx="66" cy="45" r="16" fill="none" stroke="#f5e6c8" strokeWidth="1.2" /><circle cx="66" cy="45" r="5" fill="#495f4e" />
      <path d="M32 22h17M32 28h11M32 64h18" stroke="#495f4e" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
  if (kind === 'night' || kind === 'morning') return (
    <svg viewBox="0 0 112 82" aria-hidden="true" focusable="false">
      {kind === 'night' ? <><path d="M30 13a21 21 0 1 0 23 31A18 18 0 0 1 30 13Z" fill="#d4a34f" /><circle cx="22" cy="17" r="1.7" fill="#495f4e" /><circle cx="52" cy="13" r="1.4" fill="#495f4e" /></> : <><circle cx="39" cy="36" r="18" fill="#d4a34f" /><path d="M12 44h54M20 53h39" stroke="#a75b42" strokeWidth="2" strokeLinecap="round" /></>}
      <circle cx="71" cy="48" r="25" fill="#75876b" /><circle cx="71" cy="48" r="16" fill="none" stroke="#f5e6c8" strokeWidth="1.4" /><circle cx="71" cy="48" r="8" fill="none" stroke="#f5e6c8" strokeWidth="1.2" /><circle cx="71" cy="48" r="3.5" fill="#f5e6c8" />
      <path d="M50 68h42" stroke="#495f4e" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
  return (
    <svg viewBox="0 0 112 82" aria-hidden="true" focusable="false">
      <circle cx="43" cy="42" r="30" fill="#75876b" />
      <circle cx="43" cy="42" r="20" fill="none" stroke="#e7e3ca" strokeWidth="1.3" />
      <circle cx="43" cy="42" r="10" fill="none" stroke="#e7e3ca" strokeWidth="1.3" />
      <circle cx="43" cy="42" r="3.5" fill="#e7e3ca" />
      <circle cx="72" cy="42" r="27" fill="#bb694d" stroke="#f2d8ad" strokeWidth="2" />
      <circle cx="72" cy="42" r="17" fill="none" stroke="#f2d8ad" strokeWidth="1.2" />
      <circle cx="72" cy="42" r="4" fill="#f2d8ad" />
    </svg>
  );
};

export const LiraStudio = ({ prompts, onPrompt, children }: LiraStudioProps) => {
  const { t } = useLocale();
  const titleId = useId();

  return (
    <section className="lira-studio" data-lira-studio aria-labelledby={titleId}>
      <header className="lira-studio-heading">
        <h2 id={titleId}>{t('journal.liraAsk')}</h2>
      </header>
      <div className="lira-studio-layout">
        <div className="lira-studio-prompts" aria-label={t('chat.quickPrompts')} data-chat-prompts>
          {prompts.map((prompt) => (
            <button key={prompt.id} className="lira-studio-prompt" type="button" onClick={event => onPrompt(prompt, event.detail === 0)}>
              <span className="lira-studio-art"><StudioArt kind={artByPrompt[prompt.id] ?? 'grooves'} /></span>
              <span className="lira-studio-label">{t(prompt.labelKey)}</span>
              <span className="lira-studio-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
        {children ? <aside className="lira-studio-sources" aria-label={t('journal.liraPicks')}>{children}</aside> : null}
      </div>
    </section>
  );
};

export default LiraStudio;
