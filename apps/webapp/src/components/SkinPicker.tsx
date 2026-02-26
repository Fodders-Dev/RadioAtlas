import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useRadio } from '../state/RadioContext';

export const SkinPicker = ({ compact = false }: { compact?: boolean }) => {
  const { winamp } = useRadio();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);

  const activeValue =
    winamp.activeSkin.source === 'preset' ? winamp.activeSkin.id : '__uploaded__';

  const openPicker = () => {
    fileInputRef.current?.click();
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    await winamp.importSkin(file);
    setLoading(false);
    event.target.value = '';
  };

  return (
    <div className={`skin-picker ${compact ? 'compact' : ''}`}>
      <label className="skin-picker-label" htmlFor={compact ? 'skin-select-compact' : 'skin-select'}>
        Skin
      </label>
      <select
        id={compact ? 'skin-select-compact' : 'skin-select'}
        className="skin-picker-select"
        value={activeValue}
        onChange={(event) => winamp.setSkin(event.target.value)}
      >
        {winamp.availableSkins.map((skin) => (
          <option key={skin.id} value={skin.id}>
            {skin.name}
          </option>
        ))}
        {winamp.activeSkin.source === 'uploaded' && (
          <option value="__uploaded__">{winamp.activeSkin.name}</option>
        )}
      </select>
      <button
        className="chip"
        type="button"
        onClick={openPicker}
        disabled={loading}
      >
        {loading ? 'Loading...' : 'Upload .wsz'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".wsz,.zip,application/zip"
        onChange={onFileChange}
        style={{ display: 'none' }}
      />
    </div>
  );
};
