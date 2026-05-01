export type GeneratedArtworkPalette = {
  primary: string;
  secondary: string;
  tertiary: string;
  angle: string;
  pattern: 'bands' | 'dial' | 'grid' | 'wave';
};

export const hashArtworkSeed = (seed: string) => {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const createGeneratedArtworkPalette = (seed: string): GeneratedArtworkPalette => {
  const hash = hashArtworkSeed(seed || 'radioatlas');
  const hue = hash % 360;
  const patternIndex = (hash >>> 8) % 4;
  const patterns: GeneratedArtworkPalette['pattern'][] = ['bands', 'dial', 'grid', 'wave'];

  return {
    primary: `hsl(${hue} 74% 58%)`,
    secondary: `hsl(${(hue + 44) % 360} 82% 68%)`,
    tertiary: `hsl(${(hue + 198) % 360} 70% 50%)`,
    angle: `${18 + (hash % 128)}deg`,
    pattern: patterns[patternIndex] || 'bands'
  };
};
