import { geoDistance, geoGraticule10, geoOrthographic, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import worldData from '../assets/countries-110m.json';

type GlobePoint = {
  id: string;
  lat: number;
  lon: number;
  label: string;
};

type GlobeProps = {
  points: GlobePoint[];
  activeId?: string;
  focusPoint?: { lat: number; lon: number };
  onPick?: (id: string) => void;
  onPickCandidates?: (ids: string[]) => void;
  totalCount?: number;
  geoCount?: number;
  zoomLevel?: number;
  onZoomChange?: (value: number) => void;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.5;
const WHEEL_STEP = 0.25;
const DRAG_THRESHOLD = 6;
const TILT_LIMIT = 80;

export const Globe = ({
  points,
  activeId,
  focusPoint,
  onPick,
  onPickCandidates,
  totalCount,
  geoCount,
  zoomLevel,
  onZoomChange
}: GlobeProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rotationRef = useRef<[number, number, number]>([0, -15, 0]);
  const targetRotationRef = useRef<[number, number, number] | null>(null);
  const focusPulseRef = useRef(0);
  const draggingRef = useRef(false);
  const dragMovedRef = useRef(false);
  const dragDistanceRef = useRef(0);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const projectionRef = useRef<ReturnType<typeof geoOrthographic> | null>(null);

  const [size, setSize] = useState({ width: 320, height: 320 });
  const [autoRotate, setAutoRotate] = useState(true);
  const [scale, setScale] = useState(1);

  const land = useMemo(() => {
    const data = worldData as any;
    const landObject = data.objects.land ?? data.objects.countries;
    return feature(data, landObject);
  }, []);

  const borders = useMemo(() => {
    const data = worldData as any;
    if (!data.objects?.countries) return null;
    return mesh(data, data.objects.countries, (a: any, b: any) => a !== b);
  }, []);

  const timezones = useMemo(() => {
    const zones: { lon: number; offset: number }[] = [];
    for (let offset = -12; offset <= 12; offset += 1) {
      zones.push({ lon: offset * 15, offset });
    }
    return zones;
  }, []);

  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

  useEffect(() => {
    if (!focusPoint) return;
    const targetY = Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, -focusPoint.lat));
    targetRotationRef.current = [-focusPoint.lon, targetY, 0];
    focusPulseRef.current = 1;
    setAutoRotate(false);
  }, [focusPoint?.lat, focusPoint?.lon]);

  useEffect(() => {
    if (typeof zoomLevel === 'number') {
      setScale(zoomLevel);
    }
  }, [zoomLevel]);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateSize = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = { width: rect.width, height: rect.height };
      setSize(next);
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const delta = Math.sign(event.deltaY);
      const next = clamp(scale - delta * WHEEL_STEP, MIN_ZOOM, MAX_ZOOM);
      setScale(next);
      onZoomChange?.(next);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [scale, onZoomChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let frame: number;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = size.width * dpr;
      canvas.height = size.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const baseRadius = Math.min(size.width, size.height) * 0.42;
      const radius = baseRadius * scale;
      const projection = geoOrthographic()
        .translate([size.width / 2, size.height / 2])
        .scale(radius)
        .clipAngle(90);

      const rotation = rotationRef.current;
      if (targetRotationRef.current) {
        const [targetX, targetY] = targetRotationRef.current;
        rotation[0] += (targetX - rotation[0]) * 0.08;
        rotation[1] += (targetY - rotation[1]) * 0.08;
        rotation[1] = Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, rotation[1]));
        if (
          Math.abs(targetX - rotation[0]) < 0.2 &&
          Math.abs(targetY - rotation[1]) < 0.2
        ) {
          targetRotationRef.current = null;
        }
      } else if (!draggingRef.current && autoRotate) {
        const autoSpeed = 0.01 / Math.max(1, scale);
        rotation[0] += autoSpeed;
      }
      projection.rotate(rotation);
      projectionRef.current = projection;
      const center: [number, number] = [-rotation[0], -rotation[1]];

      const path = geoPath(projection, ctx);
      ctx.clearRect(0, 0, size.width, size.height);

      const gradient = ctx.createRadialGradient(
        size.width * 0.3,
        size.height * 0.3,
        radius * 0.2,
        size.width * 0.5,
        size.height * 0.5,
        radius * 1.2
      );
      gradient.addColorStop(0, '#1f3a36');
      gradient.addColorStop(1, '#0b1514');

      ctx.beginPath();
      path({ type: 'Sphere' } as any);
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      path(land as any);
      ctx.fillStyle = 'rgba(36, 56, 52, 0.95)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(246, 201, 69, 0.18)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      if (borders) {
        ctx.beginPath();
        path(borders as any);
        ctx.strokeStyle = 'rgba(246, 201, 69, 0.35)';
        ctx.lineWidth = 0.4;
        ctx.stroke();
      }

      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 0.6;
      timezones.forEach(({ lon }) => {
        const line = {
          type: 'LineString',
          coordinates: [
            [lon, -90],
            [lon, 90]
          ]
        };
        ctx.beginPath();
        path(line as any);
        ctx.stroke();
      });
      ctx.restore();

      ctx.save();
      ctx.fillStyle = 'rgba(246, 201, 69, 0.55)';
      ctx.font = '11px "Space Grotesk", sans-serif';
      const utcMs = Date.now() + new Date().getTimezoneOffset() * 60000;
      timezones.forEach(({ lon, offset }) => {
        if (lon % 30 !== 0) return;
        const distance = geoDistance([lon, 0], center);
        if (distance > Math.PI / 2) return;
        const coords = projection([lon, 0]);
        if (!coords) return;
        const time = new Date(utcMs + offset * 3600000);
        const hours = String(time.getUTCHours()).padStart(2, '0');
        const minutes = String(time.getUTCMinutes()).padStart(2, '0');
        ctx.fillText(`${hours}:${minutes}`, coords[0] + 4, coords[1] - 6);
      });
      ctx.restore();

      ctx.beginPath();
      path(geoGraticule10());
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 0.6;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(246, 201, 69, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      path({ type: 'Sphere' } as any);
      ctx.stroke();

      const baseDot = Math.max(1.1, 3 - (scale - 1) * 0.7);
      const activeDot = baseDot + 1.6;
      const pulse = focusPulseRef.current;
      focusPulseRef.current = Math.max(0, pulse - 0.02);

      points.forEach((point) => {
        const distance = geoDistance([point.lon, point.lat], center);
        if (distance > Math.PI / 2) return;
        const coords = projection([point.lon, point.lat]);
        if (!coords) return;
        const [x, y] = coords;
        ctx.beginPath();
        const isActive = point.id === activeId;
        ctx.fillStyle = isActive ? '#f6c945' : 'rgba(246, 201, 69, 0.7)';
        ctx.arc(x, y, isActive ? activeDot : baseDot, 0, Math.PI * 2);
        ctx.fill();
        if (isActive && pulse > 0.01) {
          ctx.strokeStyle = `rgba(246, 201, 69, ${0.4 + pulse * 0.4})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, activeDot + 6 + pulse * 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [size, points, activeId, land, borders, timezones, autoRotate, scale]);

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    dragMovedRef.current = false;
    dragDistanceRef.current = 0;
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    pointerIdRef.current = event.pointerId;
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });
    if (pointersRef.current.size >= 2) {
      const points = Array.from(pointersRef.current.values());
      const dx = points[0].x - points[1].x;
      const dy = points[0].y - points[1].y;
      pinchRef.current = { distance: Math.hypot(dx, dy), scale };
      dragMovedRef.current = true;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY
      });
    }
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      event.preventDefault();
      const points = Array.from(pointersRef.current.values());
      const dx = points[0].x - points[1].x;
      const dy = points[0].y - points[1].y;
      const distance = Math.hypot(dx, dy);
      if (pinchRef.current.distance > 0) {
        const factor = distance / pinchRef.current.distance;
        const next = clamp(pinchRef.current.scale * factor, MIN_ZOOM, MAX_ZOOM);
        setScale(next);
        onZoomChange?.(next);
      }
      dragMovedRef.current = true;
      return;
    }
    if (!draggingRef.current || !lastPointerRef.current) return;
    const dx = event.clientX - lastPointerRef.current.x;
    const dy = event.clientY - lastPointerRef.current.y;
    dragDistanceRef.current += Math.abs(dx) + Math.abs(dy);
    if (dragDistanceRef.current > DRAG_THRESHOLD) {
      dragMovedRef.current = true;
    }
    const speed = 0.4 / Math.max(1, scale);
    rotationRef.current = [
      rotationRef.current[0] + dx * speed,
      Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, rotationRef.current[1] - dy * speed)),
      0
    ];
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = false;
    lastPointerRef.current = null;
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointerIdRef.current === event.pointerId) {
      pointerIdRef.current = null;
    }
  };

  const handleReset = () => {
    rotationRef.current = [0, -15, 0];
    targetRotationRef.current = null;
    focusPulseRef.current = 0;
    setScale(1);
    onZoomChange?.(1);
  };

  const pickStation = (event: MouseEvent<HTMLCanvasElement>) => {
    if ((!onPick && !onPickCandidates) || !projectionRef.current || !canvasRef.current) {
      return;
    }
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const [cx, cy] = projectionRef.current.translate();
    const radius = projectionRef.current.scale();
    const dxSphere = x - cx;
    const dySphere = y - cy;
    if (dxSphere * dxSphere + dySphere * dySphere > (radius + 6) * (radius + 6)) {
      return;
    }
    const rotation = rotationRef.current;
    const center: [number, number] = [-rotation[0], -rotation[1]];
    const maxPick = Math.max(8, 18 - (scale - 1) * 1.1);
    const maxPickSq = maxPick * maxPick;

    const candidates: { id: string; dist: number }[] = [];
    points.forEach((point) => {
      const distance = geoDistance([point.lon, point.lat], center);
      if (distance > Math.PI / 2) return;
      const coords = projectionRef.current?.([point.lon, point.lat]);
      if (!coords) return;
      const dx = coords[0] - x;
      const dy = coords[1] - y;
      const dist = dx * dx + dy * dy;
      if (dist < maxPickSq) {
        candidates.push({ id: point.id, dist });
      }
    });

    if (!candidates.length) {
      onPickCandidates?.([]);
      return;
    }

    candidates.sort((a, b) => a.dist - b.dist);
    if (candidates.length === 1) {
      onPick?.(candidates[0].id);
      onPickCandidates?.([]);
      return;
    }

    if (onPickCandidates) {
      onPickCandidates(candidates.slice(0, 8).map((item) => item.id));
      return;
    }

    onPick?.(candidates[0].id);
  };

  return (
    <div className="globe" ref={containerRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={pickStation}
        aria-label="Interactive globe"
      />
      <div className="globe-overlay">
        <div className="globe-count">
          Showing {points.length}
          {typeof geoCount === 'number' ? ` / ${geoCount} mapped` : ''}
          {typeof totalCount === 'number' ? ` / ${totalCount} total` : ''}
        </div>
        <div className="globe-hint">Drag to spin / scroll to zoom / tap a dot</div>
        <div className="globe-controls">
          <button
            className="chip"
            onClick={() => setAutoRotate((prev) => !prev)}
            type="button"
          >
            {autoRotate ? 'Pause' : 'Spin'}
          </button>
          <button
            className="chip"
            onClick={() => {
              const next = clamp(scale + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
              setScale(next);
              onZoomChange?.(next);
            }}
            type="button"
          >
            +
          </button>
          <button
            className="chip"
            onClick={() => {
              const next = clamp(scale - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
              setScale(next);
              onZoomChange?.(next);
            }}
            type="button"
          >
            -
          </button>
          <button className="chip" onClick={handleReset} type="button">
            Reset
          </button>
        </div>
      </div>
    </div>
  );
};
