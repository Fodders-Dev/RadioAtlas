type BasicMetadata = {
  common: {
    title?: string;
    artist?: string;
  };
  format: Record<string, never>;
};

const titleFromUrl = (value: string) => {
  try {
    const parsed = new URL(value, window.location.origin);
    const leaf = parsed.pathname.split('/').filter(Boolean).pop() || 'Stream';
    return decodeURIComponent(leaf).replace(/\.[a-z0-9]+$/i, '') || 'Stream';
  } catch {
    return 'Stream';
  }
};

const titleFromBlob = (blob: Blob) => {
  if ('name' in blob && typeof blob.name === 'string' && blob.name.trim()) {
    return blob.name.replace(/\.[a-z0-9]+$/i, '');
  }
  return 'Track';
};

const buildMetadata = (title: string): BasicMetadata => ({
  common: {
    title,
    artist: ''
  },
  format: {}
});

export const parseBlob = async (blob: Blob) => buildMetadata(titleFromBlob(blob));
export const fetchFromUrl = async (audioTrackUrl: string) => buildMetadata(titleFromUrl(audioTrackUrl));
export const parseWebStream = async () => buildMetadata('Stream');
