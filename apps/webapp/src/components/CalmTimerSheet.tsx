import { useEffect, useRef, useState } from 'react';
import { SLEEP_TIMER_PRESETS_MIN, formatSleepRemaining } from '../lib/sleepTimer';
import { useLocale } from '../state/LocaleContext';
import { usePlayback } from '../state/RadioContext';

// The sleep timer on its own sheet (A4 mock «Таймер сна»): the remaining time,
// four presets, your own minutes, and «Отменить» while it runs. The full
// player tray («Ещё») keeps volume, queue and the rest; the timer is the one
// control a listener reaches for at night, so it gets a short path.
export function CalmTimerSheet({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { t } = useLocale();
  const { sleepTimer, startSleepTimer, cancelSleepTimer } = usePlayback();
  const [custom, setCustom] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const minutes = Number(custom);
  const customValid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 720;
  return <dialog ref={dialog} className="calm-sheet calm-timer-sheet" aria-labelledby="calm-timer-title" onClose={onClose} data-calm-timer>
    <div className="calm-sheet-handle" aria-hidden="true" />
    <div className="calm-sheet-head"><div><span className="calm-eyebrow">{t('calm.player')}</span><h2 id="calm-timer-title">{t('settings.sleepTimerLabel')}</h2></div><button className="calm-icon" onClick={() => dialog.current?.close()} aria-label={t('common.close')}>×</button></div>
    <p className="calm-timer-status" role="status" data-calm-timer-status={sleepTimer.active ? 'on' : 'off'}>
      {sleepTimer.active ? t('journal.timerRunning', { left: formatSleepRemaining(sleepTimer.remainingMs) }) : t('journal.timerCopy')}
    </p>
    <div className="calm-chips calm-timer-presets">
      {SLEEP_TIMER_PRESETS_MIN.map((preset) => (
        <button key={preset} className="calm-chip" aria-pressed={sleepTimer.active && sleepTimer.minutes === preset} onClick={() => { startSleepTimer(preset); dialog.current?.close(); }} data-calm-timer-preset={preset}>
          {preset} {t('settings.sleepMin')}
        </button>
      ))}
    </div>
    <form className="calm-timer-custom" onSubmit={(event) => { event.preventDefault(); if (customValid) { startSleepTimer(minutes); dialog.current?.close(); } }}>
      <label><span>{t('journal.timerCustom')}</span><input type="number" inputMode="numeric" min={1} max={720} value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="90" aria-label={t('journal.timerCustom')} /></label>
      <button className="calm-more" type="submit" disabled={!customValid}>{t('journal.timerStart')}</button>
    </form>
    {sleepTimer.active ? <button className="calm-text calm-timer-stop" onClick={() => { cancelSleepTimer(); dialog.current?.close(); }} data-calm-timer-stop>{t('settings.sleepStop')}</button> : null}
  </dialog>;
}
