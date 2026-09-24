export type GradientDraftStop = { color: string; position: number };

export type HydratedGradientDraft = {
  angle: number;
  stops: GradientDraftStop[];
  exactGradient: string | null;
};

// Match only the canonical format emitted by ThemeBuilder.composeGradient.
// Valid CSS gradients outside this narrow grammar stay intact until the user
// changes a composer control instead of being approximated with invented stops.
export const hydrateGradientDraft = (
  gradient: string,
  fallbackStops: GradientDraftStop[],
  fallbackAngle = 160
): HydratedGradientDraft => {
  const match = gradient.match(/^linear-gradient\(\s*(-?\d+)deg\s*,\s*(.+)\s*\)$/i);
  if (!match) return { angle: fallbackAngle, stops: fallbackStops, exactGradient: gradient };

  const stops = match[2].split(',').map((part) => {
    const stop = part.trim().match(/^(#[0-9a-f]{6})\s+(\d+)%$/i);
    return stop ? { color: stop[1], position: Number(stop[2]) } : null;
  });
  if (stops.length < 2 || stops.some((stop) => stop === null)) {
    return { angle: fallbackAngle, stops: fallbackStops, exactGradient: gradient };
  }

  return {
    angle: Number(match[1]),
    stops: stops as GradientDraftStop[],
    exactGradient: null
  };
};
