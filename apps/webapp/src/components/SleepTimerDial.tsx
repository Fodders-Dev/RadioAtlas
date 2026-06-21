import { useRef, type PointerEvent } from 'react';

// Yandex-Music-style sleep dial: a circular SVG you drag (or tap) to set the
// minutes; when a timer is running it flips to a live countdown (the arc drains).
// Pointer-capture drag with touch-action:none so the gesture never scrolls the
// sheet. Snaps to 5-minute steps, 5–60 min.

const SIZE = 208;
const STROKE = 10;
const RADIUS = (SIZE - STROKE * 2) / 2;
const CENTER = SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export const SLEEP_DIAL_MIN = 5;
export const SLEEP_DIAL_MAX = 60;
const STEP = 5;

const clampMinutes = (m: number) => Math.min(SLEEP_DIAL_MAX, Math.max(SLEEP_DIAL_MIN, m));

// Pointer angle (0 at 12 o'clock, clockwise) → snapped minutes. A near-top angle
// wraps to the full 60 rather than collapsing to the 5-minute floor.
const angleToMinutes = (angleRad: number): number => {
  const fraction = angleRad / (2 * Math.PI);
  const raw = Math.round((fraction * SLEEP_DIAL_MAX) / STEP) * STEP;
  return clampMinutes(raw <= 0 ? SLEEP_DIAL_MAX : raw);
};

type SleepTimerDialProps = {
  minutes: number; // selected value while idle (5–60)
  onChange: (minutes: number) => void;
  active: boolean; // a timer is running → show the countdown, ignore input
  remainingMs: number;
  totalMs: number;
  centerLabel: string; // MM:00 idle, or the live countdown
};

export const SleepTimerDial = ({
  minutes,
  onChange,
  active,
  remainingMs,
  totalMs,
  centerLabel
}: SleepTimerDialProps) => {
  const svgRef = useRef<SVGSVGElement>(null);

  const fraction = active
    ? totalMs > 0
      ? Math.max(0, Math.min(1, remainingMs / totalMs))
      : 0
    : Math.min(1, Math.max(0, minutes / SLEEP_DIAL_MAX));

  const handleAngle = fraction * 2 * Math.PI;
  const handleX = CENTER + RADIUS * Math.sin(handleAngle);
  const handleY = CENTER - RADIUS * Math.cos(handleAngle);

  const updateFromPointer = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * SIZE - CENTER;
    const y = ((clientY - rect.top) / rect.height) * SIZE - CENTER;
    let angle = Math.atan2(x, -y); // 0 at top, clockwise
    if (angle < 0) angle += 2 * Math.PI;
    onChange(angleToMinutes(angle));
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (active) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event.clientX, event.clientY);
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (active || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateFromPointer(event.clientX, event.clientY);
  };

  return (
    <svg
      ref={svgRef}
      className={`sleep-dial ${active ? 'is-running' : ''}`}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="slider"
      aria-valuemin={SLEEP_DIAL_MIN}
      aria-valuemax={SLEEP_DIAL_MAX}
      aria-valuenow={active ? Math.max(0, Math.ceil(remainingMs / 60000)) : minutes}
      aria-label="Таймер сна, минуты"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      <circle
        cx={CENTER}
        cy={CENTER}
        r={RADIUS}
        className="sleep-dial-track"
        strokeWidth={STROKE}
        fill="none"
      />
      <circle
        cx={CENTER}
        cy={CENTER}
        r={RADIUS}
        className="sleep-dial-arc"
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        transform={`rotate(-90 ${CENTER} ${CENTER})`}
      />
      {!active ? (
        <circle cx={handleX} cy={handleY} r={STROKE + 1} className="sleep-dial-handle" />
      ) : null}
      <text
        x={CENTER}
        y={CENTER}
        className="sleep-dial-label"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {centerLabel}
      </text>
    </svg>
  );
};
