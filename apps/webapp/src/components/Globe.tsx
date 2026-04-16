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
  subtitle?: string;
  count?: number;
};

type GlobeProps = {
  points: GlobePoint[];
  activeId?: string;
  selectedId?: string;
  focusPoint?: { lat: number; lon: number };
  onPick?: (id: string) => void;
  onPickCandidates?: (ids: string[]) => void;
  totalCount?: number;
  geoCount?: number;
  zoomLevel?: number;
  onZoomChange?: (value: number) => void;
  hintText?: string;
  statusText?: string;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;
const WHEEL_STEP = 0.25;
const DRAG_THRESHOLD = 6;
const TILT_LIMIT = 80;

export const Globe = ({
  points,
  activeId,
  selectedId,
  focusPoint,
  onPick,
  onPickCandidates,
  totalCount,
  geoCount,
  zoomLevel,
  onZoomChange,
  hintText,
  statusText
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

      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
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
      const sphere = { type: 'Sphere' } as any;
      const drawRoundedRect = (
        x: number,
        y: number,
        width: number,
        height: number,
        radiusValue: number
      ) => {
        const radius = Math.min(radiusValue, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
      };
      const trimLabel = (value: string, maxLength: number) =>
        value.length > maxLength ? `${value.slice(0, Math.max(1, maxLength - 1))}\u2026` : value;
      ctx.clearRect(0, 0, size.width, size.height);

      const oceanGradient = ctx.createRadialGradient(
        size.width * 0.26,
        size.height * 0.24,
        radius * 0.2,
        size.width * 0.5,
        size.height * 0.5,
        radius * 1.2
      );
      oceanGradient.addColorStop(0, '#1b4f6f');
      oceanGradient.addColorStop(0.3, '#10395c');
      oceanGradient.addColorStop(0.72, '#0b2037');
      oceanGradient.addColorStop(1, '#050b13');

      ctx.beginPath();
      path(sphere);
      ctx.fillStyle = oceanGradient;
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      path(sphere);
      ctx.clip();
      const hazeGradient = ctx.createRadialGradient(
        size.width * 0.42,
        size.height * 0.18,
        radius * 0.1,
        size.width * 0.5,
        size.height * 0.52,
        radius * 1.1
      );
      hazeGradient.addColorStop(0, 'rgba(196, 244, 255, 0.22)');
      hazeGradient.addColorStop(0.44, 'rgba(92, 150, 214, 0.08)');
      hazeGradient.addColorStop(1, 'rgba(6, 12, 21, 0)');
      ctx.fillStyle = hazeGradient;
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.restore();

      const landGradient = ctx.createLinearGradient(
        size.width * 0.22,
        size.height * 0.18,
        size.width * 0.78,
        size.height * 0.84
      );
      landGradient.addColorStop(0, 'rgba(88, 121, 84, 0.98)');
      landGradient.addColorStop(0.34, 'rgba(69, 96, 67, 0.96)');
      landGradient.addColorStop(0.74, 'rgba(82, 92, 58, 0.94)');
      landGradient.addColorStop(1, 'rgba(61, 64, 43, 0.94)');
      ctx.beginPath();
      path(land as any);
      ctx.fillStyle = landGradient;
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      path(land as any);
      ctx.clip();
      const terrainGlow = ctx.createRadialGradient(
        size.width * 0.35,
        size.height * 0.3,
        radius * 0.12,
        size.width * 0.44,
        size.height * 0.44,
        radius * 1.08
      );
      terrainGlow.addColorStop(0, 'rgba(144, 181, 105, 0.28)');
      terrainGlow.addColorStop(0.48, 'rgba(95, 128, 84, 0.12)');
      terrainGlow.addColorStop(1, 'rgba(25, 32, 22, 0)');
      ctx.fillStyle = terrainGlow;
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.restore();

      ctx.beginPath();
      path(land as any);
      ctx.strokeStyle = 'rgba(210, 243, 255, 0.16)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      if (borders) {
        ctx.beginPath();
        path(borders as any);
        ctx.strokeStyle = 'rgba(190, 232, 255, 0.34)';
        ctx.lineWidth = scale >= 2 ? 0.9 : 0.72;
        ctx.stroke();
      }

      ctx.beginPath();
      path(geoGraticule10());
      ctx.strokeStyle = 'rgba(220, 241, 255, 0.12)';
      ctx.lineWidth = 0.6;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(212, 245, 255, 0.34)';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      path(sphere);
      ctx.stroke();

      const baseDot = Math.max(2.2, 4.4 - (scale - 1) * 0.55);
      const activeDot = baseDot + 2.2;
      const pulse = focusPulseRef.current;
      focusPulseRef.current = Math.max(0, pulse - 0.02);

      const visiblePoints = points
        .map((point) => {
        const distance = geoDistance([point.lon, point.lat], center);
          if (distance > Math.PI / 2) return null;
        const coords = projection([point.lon, point.lat]);
          if (!coords) return null;
        const [x, y] = coords;
          const density = Math.min(5.8, Math.sqrt(point.count ?? 1));
          const pointRadius = baseDot + Math.max(0, density - 1) * 1.05;
          return {
            ...point,
            x,
            y,
            pointRadius,
            isSelected: point.id === selectedId,
            isActive: point.id === activeId,
            distanceToCenter: Math.hypot(x - size.width / 2, y - size.height / 2)
          };
        })
        .filter(Boolean)
        .sort((left, right) => {
          if (!left || !right) return 0;
          const leftBoost =
            (left.isSelected ? 10000 : 0) + (left.isActive ? 5000 : 0) + (left.count ?? 0);
          const rightBoost =
            (right.isSelected ? 10000 : 0) + (right.isActive ? 5000 : 0) + (right.count ?? 0);
          if (leftBoost !== rightBoost) return rightBoost - leftBoost;
          return left.distanceToCenter - right.distanceToCenter;
        }) as Array<
        GlobePoint & {
          x: number;
          y: number;
          pointRadius: number;
          isSelected: boolean;
          isActive: boolean;
          distanceToCenter: number;
        }
      >;

      visiblePoints.forEach((point) => {
        const haloRadius = point.isSelected
          ? point.pointRadius + 14
          : point.isActive
            ? point.pointRadius + 11
            : point.pointRadius + 7;
        ctx.beginPath();
        ctx.fillStyle = point.isSelected
          ? 'rgba(208, 251, 255, 0.22)'
          : point.isActive
            ? 'rgba(136, 241, 222, 0.18)'
            : 'rgba(152, 220, 255, 0.12)';
        ctx.arc(point.x, point.y, haloRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.shadowColor = point.isSelected
          ? 'rgba(201, 250, 255, 0.48)'
          : point.isActive
            ? 'rgba(136, 241, 222, 0.42)'
            : 'rgba(152, 220, 255, 0.28)';
        ctx.shadowBlur = point.isSelected ? 18 : point.isActive ? 14 : 10;
        ctx.beginPath();
        ctx.fillStyle = point.isSelected
          ? 'rgba(238, 254, 255, 0.98)'
          : point.isActive
            ? '#88f1de'
            : 'rgba(159, 224, 255, 0.92)';
        ctx.arc(
          point.x,
          point.y,
          point.isActive ? Math.max(activeDot, point.pointRadius + 1.6) : point.pointRadius,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.restore();

        ctx.beginPath();
        ctx.fillStyle = point.isSelected ? 'rgba(53, 73, 90, 0.82)' : 'rgba(244, 252, 255, 0.82)';
        ctx.arc(point.x, point.y, Math.max(1.7, point.pointRadius * 0.34), 0, Math.PI * 2);
        ctx.fill();

        if (point.isSelected) {
          ctx.strokeStyle = 'rgba(198, 248, 255, 0.6)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(point.x, point.y, point.pointRadius + 6.2, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (point.isActive && pulse > 0.01) {
          ctx.strokeStyle = `rgba(136, 241, 222, ${0.38 + pulse * 0.38})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(
            point.x,
            point.y,
            Math.max(activeDot + 7, point.pointRadius + 7) + pulse * 6,
            0,
            Math.PI * 2
          );
          ctx.stroke();
        }
      });

      const labelLimit = scale >= 3.6 ? 9 : scale >= 2.4 ? 7 : scale >= 1.5 ? 5 : 3;
      const labelSlots: Array<{ left: number; top: number; right: number; bottom: number }> = [];
      visiblePoints
        .filter((point, index) => point.isSelected || point.isActive || index < labelLimit * 2)
        .forEach((point) => {
          if (labelSlots.length >= labelLimit && !point.isSelected) return;
          const title = trimLabel(point.label, point.isSelected ? 22 : 16);
          const detail =
            point.isSelected || scale >= 2.6
              ? trimLabel(point.subtitle || '', point.isSelected ? 24 : 18)
              : '';

          ctx.font = `700 ${point.isSelected ? 11 : 10}px "Segoe UI", sans-serif`;
          const titleWidth = ctx.measureText(title).width;
          ctx.font = `600 9px "Segoe UI", sans-serif`;
          const detailWidth = detail ? ctx.measureText(detail).width : 0;
          const labelWidth = Math.max(titleWidth, detailWidth) + 20;
          const labelHeight = detail ? 34 : 22;

          let labelX = point.x + 12;
          if (labelX + labelWidth > size.width - 8) {
            labelX = point.x - labelWidth - 12;
          }
          let labelY = point.y - labelHeight - 12;
          if (labelY < 8) {
            labelY = point.y + 12;
          }
          labelX = clamp(labelX, 8, size.width - labelWidth - 8);
          labelY = clamp(labelY, 8, size.height - labelHeight - 8);

          const rect = {
            left: labelX - 3,
            top: labelY - 3,
            right: labelX + labelWidth + 3,
            bottom: labelY + labelHeight + 3
          };
          const intersects = labelSlots.some(
            (slot) =>
              !(rect.right < slot.left || rect.left > slot.right || rect.bottom < slot.top || rect.top > slot.bottom)
          );
          if (intersects && !point.isSelected) return;
          labelSlots.push(rect);

          const connectorToLeft = labelX > point.x;
          ctx.strokeStyle = point.isSelected
            ? 'rgba(198, 248, 255, 0.52)'
            : 'rgba(175, 223, 246, 0.26)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(point.x, point.y);
          ctx.lineTo(
            connectorToLeft ? labelX : labelX + labelWidth,
            labelY + Math.min(labelHeight - 8, Math.max(8, labelHeight / 2))
          );
          ctx.stroke();

          drawRoundedRect(labelX, labelY, labelWidth, labelHeight, 11);
          ctx.fillStyle = point.isSelected
            ? 'rgba(8, 20, 29, 0.94)'
            : 'rgba(10, 21, 32, 0.82)';
          ctx.fill();
          ctx.strokeStyle = point.isSelected
            ? 'rgba(201, 250, 255, 0.48)'
            : 'rgba(186, 228, 248, 0.18)';
          ctx.lineWidth = point.isSelected ? 1.15 : 1;
          ctx.stroke();

          ctx.fillStyle = '#f1fbff';
          ctx.font = `700 ${point.isSelected ? 11 : 10}px "Segoe UI", sans-serif`;
          ctx.textBaseline = 'top';
          ctx.fillText(title, labelX + 10, labelY + 7);

          if (detail) {
            ctx.fillStyle = 'rgba(198, 221, 235, 0.78)';
            ctx.font = `600 9px "Segoe UI", sans-serif`;
            ctx.fillText(detail, labelX + 10, labelY + 19);
          }
        });

      frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [size, points, activeId, land, borders, autoRotate, scale]);

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
    const maxPick = Math.max(11, 22 - (scale - 1) * 0.9);
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

    candidates.sort((a, b) => {
      if (a.dist !== b.dist) return a.dist - b.dist;
      return a.id.localeCompare(b.id);
    });
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
          {statusText ||
            `Showing ${points.length}${typeof geoCount === 'number' ? ` / ${geoCount} mapped` : ''}${typeof totalCount === 'number' ? ` / ${totalCount} total` : ''}`}
        </div>
        <div className="globe-hint">{hintText || 'Drag to spin / scroll to zoom / tap a dot'}</div>
      </div>
    </div>
  );
};
