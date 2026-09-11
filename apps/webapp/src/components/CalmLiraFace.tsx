import { useId } from 'react';

// Лира's drawn face for the calm «Журнал» composition — the same portrait the
// A4 mock used (docs/prototypes/directions/app.js), so the guide is
// recognisable as a person on Home and in her own window, not only as the
// lyre glyph the navigation keeps. Pure SVG, no raster: it scales, it themes
// through the surrounding ring, and it ships nothing the owner did not draw.
export function CalmLiraFace({ className = '' }: { className?: string }) {
  const id = useId();
  const hair = `lira-hair-${id}`;
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={hair}>
          <stop stopColor="#ffa665" />
          <stop offset="1" stopColor="#ae435f" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="#eeb797" />
      <path d="M11 39C5 7 40-1 51 17c9 16 0 27 7 35H9z" fill="#693a48" />
      <path d="M20 25c0-14 27-15 26 4l-3 17c-4 11-18 11-21-1z" fill="#ffd8b2" />
      <path d="M17 26c13 0 17-8 18-13 8 3 9 11 13 15V16L27 7 16 18z" fill="#693a48" />
      <path d="M24 34l5 1m7 0 5-1" stroke="#693a48" strokeWidth="2" strokeLinecap="round" />
      <path d="M29 43q5 4 9-1" fill="none" stroke="#b86362" strokeWidth="2" strokeLinecap="round" />
      <path d="M13 35V25a20 20 0 0 1 40 0v10" fill="none" stroke={`url(#${hair})`} strokeWidth="4" />
      <rect x="9" y="30" width="9" height="15" rx="4" fill="#fff0c9" />
      <rect x="48" y="30" width="9" height="15" rx="4" fill="#fff0c9" />
    </svg>
  );
}
