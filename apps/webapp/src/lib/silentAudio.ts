const SILENT_PCM_WAV_BASE64 =
  'UklGRlQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YTAAAAAA';

let cachedSilentAudioUrl: string | null = null;

export const getSilentAudioUrl = () => {
  if (cachedSilentAudioUrl) {
    return cachedSilentAudioUrl;
  }

  cachedSilentAudioUrl = `data:audio/wav;base64,${SILENT_PCM_WAV_BASE64}`;
  return cachedSilentAudioUrl;
};
