import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { getDeviceProfile } from '../lib/deviceProfile';
import { loadGlobeAssets, type GlobeAssets } from './globe/assets';
import { findNearestAreaToRotation } from './globe/selection';
import './globe/globe.css';

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
  tuneRequestKey?: number;
  spinRequestKey?: number;
  onAutoRotateChange?: (enabled: boolean) => void;
  hintText?: string;
  immersive?: boolean;
  statusText?: string;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;
const WHEEL_STEP = 0.25;
const DRAG_THRESHOLD = 6;
const TILT_LIMIT = 80;
const TILE_SIZE = 256;
const DEFAULT_SATELLITE_TILE_TEMPLATE =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_TILE_TEMPLATE =
  import.meta.env.VITE_GLOBE_SATELLITE_TILE_URL || DEFAULT_SATELLITE_TILE_TEMPLATE;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeLongitudeDelta = (value: number) => ((((value + 540) % 360) + 360) % 360) - 180;

const lonLatToWorldPixel = (lon: number, lat: number, zoom: number) => {
  const boundedLat = clamp(lat, -85.05112878, 85.05112878);
  const sinLat = Math.sin((boundedLat * Math.PI) / 180);
  const worldSize = TILE_SIZE * 2 ** zoom;
  return {
    x: ((lon + 180) / 360) * worldSize,
    y:
      (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) *
      worldSize,
    worldSize
  };
};

const satelliteTileUrl = (template: string, x: number, y: number, z: number) =>
  template
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{z}', String(z));

type GlobeRenderState =
  | { mode: 'sphere' }
  | {
      mode: 'map';
      centerLat: number;
      centerLon: number;
      height: number;
      latSpan: number;
      lonSpan: number;
      projection: 'equirect' | 'mercator';
      centerPixelX?: number;
      centerPixelY?: number;
      worldSize?: number;
      width: number;
    };

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
  tuneRequestKey,
  spinRequestKey,
  onAutoRotateChange,
  hintText,
  immersive = false,
  statusText
}: GlobeProps) => {
  const deviceProfile = getDeviceProfile();
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
  const projectionRef = useRef<any>(null);
  const renderStateRef = useRef<GlobeRenderState>({ mode: 'sphere' });
  const tileCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const textureRenderRef = useRef<{ canvas: HTMLCanvasElement; key: string } | null>(null);
  const mapFrameRef = useRef<{ canvas: HTMLCanvasElement; key: string } | null>(null);
  const lastDrawTimeRef = useRef(0);
  const scaleRef = useRef(1);
  const targetScaleRef = useRef(1);
  const onZoomChangeRef = useRef(onZoomChange);
  const lastTuneRequestRef = useRef(0);
  const lastSpinRequestRef = useRef(0);
  // Pixels of pointer travel per millisecond, retained on pointer-up so the
  // globe keeps spinning briefly with inertia like a real planet.
  const dragVelocityRef = useRef<{ x: number; y: number; sampledAt: number }>({
    x: 0,
    y: 0,
    sampledAt: 0
  });
  const lastDrawTimestampRef = useRef(0);

  const [size, setSize] = useState({ width: 320, height: 320 });
  const [autoRotate, setAutoRotate] = useState(
    () => !immersive && !deviceProfile.lowPower && !deviceProfile.reducedMotion
  );
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === 'undefined' || !document.hidden
  );
  const [assets, setAssets] = useState<GlobeAssets | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // commitScale used to be an instant jump; instead we set a target the
  // draw loop tweens toward, which makes +/- buttons and pinch zoom feel
  // smooth instead of stepping in 0.75 increments.
  const commitScale = useCallback((value: number, options?: { instant?: boolean }) => {
    const next = clamp(value, MIN_ZOOM, MAX_ZOOM);
    targetScaleRef.current = next;
    if (options?.instant) {
      scaleRef.current = next;
      setScale(next);
      onZoomChangeRef.current?.(next);
    }
  }, []);

  const handleSurfaceWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const delta = Math.sign(event.deltaY);
      commitScale(scaleRef.current - delta * WHEEL_STEP);
    },
    [commitScale]
  );

  useEffect(() => {
    let mounted = true;
    void loadGlobeAssets().then((nextAssets) => {
      if (mounted) {
        setAssets(nextAssets);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setDocumentVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    onAutoRotateChange?.(autoRotate);
  }, [autoRotate, onAutoRotateChange]);

  useEffect(() => {
    if (!focusPoint) return;
    const targetY = Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, -focusPoint.lat));
    const targetRotation: [number, number, number] = [-focusPoint.lon, targetY, 0];
    if (immersive) {
      rotationRef.current = targetRotation;
      targetRotationRef.current = null;
    } else {
      targetRotationRef.current = targetRotation;
    }
    focusPulseRef.current = 1;
    setAutoRotate(false);
  }, [focusPoint?.lat, focusPoint?.lon, immersive]);

  useEffect(() => {
    if (typeof zoomLevel === 'number') {
      const next = clamp(zoomLevel, MIN_ZOOM, MAX_ZOOM);
      // External owner controls zoom; tween toward it instead of snapping.
      targetScaleRef.current = next;
    }
  }, [zoomLevel]);

  useEffect(() => {
    if (!tuneRequestKey || tuneRequestKey === lastTuneRequestRef.current) return;
    lastTuneRequestRef.current = tuneRequestKey;
    const nearest = findNearestAreaToRotation(
      points,
      rotationRef.current,
      assets?.geoDistance
    );
    if (!nearest) {
      onPickCandidates?.([]);
      return;
    }
    onPick?.(nearest.id);
    onPickCandidates?.([]);
  }, [assets?.geoDistance, onPick, onPickCandidates, points, tuneRequestKey]);

  useEffect(() => {
    if (!spinRequestKey || spinRequestKey === lastSpinRequestRef.current) return;
    lastSpinRequestRef.current = spinRequestKey;
    targetRotationRef.current = null;
    setAutoRotate(true);
  }, [spinRequestKey]);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateSize = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = { width: rect.width, height: rect.height };
      setSize((previous) =>
        Math.abs(previous.width - next.width) < 0.5 &&
        Math.abs(previous.height - next.height) < 0.5
          ? previous
          : next
      );
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
      commitScale(scaleRef.current - delta * WHEEL_STEP);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [commitScale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !documentVisible || !assets) return;

    let frame: number;
    const draw = (timestamp = 0) => {
      // Tween scale toward the target so +/- and pinch feel smooth.
      const targetScale = targetScaleRef.current;
      const scaleDelta = targetScale - scaleRef.current;
      if (Math.abs(scaleDelta) > 0.0008) {
        scaleRef.current += scaleDelta * 0.18;
      } else if (scaleRef.current !== targetScale) {
        scaleRef.current = targetScale;
        // Once we settle, propagate the value back up so external state
        // mirrors the actual zoom level.
        setScale(targetScale);
        onZoomChangeRef.current?.(targetScale);
      }
      const currentScale = scaleRef.current;
      const isTweening = Math.abs(scaleDelta) > 0.0008;
      const inertiaSpeed = Math.hypot(
        dragVelocityRef.current.x,
        dragVelocityRef.current.y
      );
      const mapLikely = immersive && currentScale >= 2.7;
      const moving =
        draggingRef.current ||
        autoRotate ||
        Boolean(targetRotationRef.current) ||
        focusPulseRef.current > 0.01 ||
        isTweening ||
        inertiaSpeed > 0.04;
      const minFrameMs = mapLikely
        ? deviceProfile.lowPower
          ? 50
          : 34
        : moving
          ? deviceProfile.lowPower
            ? 56
            : 34
          : 90;
      if (timestamp && timestamp - lastDrawTimeRef.current < minFrameMs) {
        frame = window.requestAnimationFrame(draw);
        return;
      }
      const previousTimestamp = lastDrawTimestampRef.current;
      lastDrawTimeRef.current = timestamp || performance.now();
      lastDrawTimestampRef.current = timestamp || performance.now();
      const frameDeltaMs = previousTimestamp
        ? Math.min(64, lastDrawTimestampRef.current - previousTimestamp)
        : 16;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = Math.min(window.devicePixelRatio || 1, deviceProfile.lowPower ? 1 : 1.35);
      const pixelWidth = Math.max(1, Math.round(size.width * dpr));
      const pixelHeight = Math.max(1, Math.round(size.height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const baseRadius = immersive
        ? Math.min(size.height * 0.46, size.width * 0.86)
        : Math.min(size.width, size.height) * 0.42;
      const radius = baseRadius * currentScale;
      const projection = assets.geoOrthographic()
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
        // A focus snap overrides any leftover drag inertia.
        dragVelocityRef.current = { x: 0, y: 0, sampledAt: 0 };
      } else if (draggingRef.current) {
        // Active drag: rotation is already updated in pointermove. Nothing
        // else to do; we just want the inertia memory fresh.
      } else if (inertiaSpeed > 0.04) {
        // Apply leftover pointer momentum after release. The decay is
        // tuned per frame, scaled by the actual frame delta so heavy
        // frames don't make the planet stop abruptly.
        const speed = 0.4 / Math.max(1, currentScale);
        rotation[0] += dragVelocityRef.current.x * speed * frameDeltaMs;
        rotation[1] = Math.max(
          -TILT_LIMIT,
          Math.min(TILT_LIMIT, rotation[1] - dragVelocityRef.current.y * speed * frameDeltaMs)
        );
        const decay = Math.pow(0.92, frameDeltaMs / 16);
        dragVelocityRef.current = {
          x: dragVelocityRef.current.x * decay,
          y: dragVelocityRef.current.y * decay,
          sampledAt: dragVelocityRef.current.sampledAt
        };
      } else if (autoRotate) {
        const autoSpeed = (deviceProfile.lowPower ? 0.006 : 0.01) / Math.max(1, currentScale);
        rotation[0] += autoSpeed;
      }
      projection.rotate(rotation);
      projectionRef.current = projection;
      const center: [number, number] = [-rotation[0], -rotation[1]];
      const [projectionCenterX, projectionCenterY] = projection.translate() as [number, number];
      const mapMode = immersive && currentScale >= 2.7 && Boolean(assets.earthTexture);

      const path = assets.geoPath(projection, ctx);
      const sphere = { type: 'Sphere' } as any;
      const drawMapTexture = () => {
        const texture = assets.earthTexture;
        if (!texture) return false;
        const centerLon = ((((center[0] + 180) % 360) + 360) % 360) - 180;
        const centerLat = clamp(center[1], -78, 78);
        const zoomPower = Math.max(1, Math.pow(currentScale, 1.42));
        const lonSpan = clamp(360 / zoomPower, 10, 120);
        const latSpan = clamp(lonSpan * (size.height / Math.max(1, size.width)), 8, 120);
        const drawEquirectFallback = () => {
          const sourceWidth = texture.width * (lonSpan / 360);
          const sourceHeight = texture.height * (latSpan / 180);
          const sourceCenterX =
            (((((centerLon + 180) / 360) % 1) + 1) % 1) * texture.width;
          const sourceCenterY = clamp(
            ((90 - centerLat) / 180) * texture.height,
            sourceHeight / 2,
            texture.height - sourceHeight / 2
          );
          const sourceY = sourceCenterY - sourceHeight / 2;
          let sourceX = sourceCenterX - sourceWidth / 2;
          let targetX = 0;
          let remaining = sourceWidth;

          ctx.fillStyle = '#081831';
          ctx.fillRect(0, 0, size.width, size.height);
          while (remaining > 0.5) {
            const wrappedX = ((sourceX % texture.width) + texture.width) % texture.width;
            const segmentWidth = Math.min(remaining, texture.width - wrappedX);
            const targetWidth = (segmentWidth / sourceWidth) * size.width;
            ctx.drawImage(
              texture.canvas,
              wrappedX,
              sourceY,
              segmentWidth,
              sourceHeight,
              targetX,
              0,
              targetWidth + 0.5,
              size.height
            );
            sourceX += segmentWidth;
            targetX += targetWidth;
            remaining -= segmentWidth;
          }
        };

        const tileZoom = clamp(Math.round(3 + currentScale * 0.9), 4, 12);
        const centerPixel = lonLatToWorldPixel(centerLon, centerLat, tileZoom);
        const startX = centerPixel.x - size.width / 2;
        const startY = centerPixel.y - size.height / 2;
        const endX = startX + size.width;
        const endY = startY + size.height;
        const tileMinX = Math.floor(startX / TILE_SIZE);
        const tileMaxX = Math.floor(endX / TILE_SIZE);
        const tileMinY = Math.max(0, Math.floor(startY / TILE_SIZE));
        const tileMaxY = Math.min(2 ** tileZoom - 1, Math.floor(endY / TILE_SIZE));
        const tileDescriptors: Array<{
          dx: number;
          dy: number;
          image: HTMLImageElement | null;
        }> = [];
        let drawnTiles = 0;

        if (SATELLITE_TILE_TEMPLATE) {
          for (let tileY = tileMinY; tileY <= tileMaxY; tileY += 1) {
            for (let rawTileX = tileMinX; rawTileX <= tileMaxX; rawTileX += 1) {
              const tileCount = 2 ** tileZoom;
              const tileX = ((rawTileX % tileCount) + tileCount) % tileCount;
              const url = satelliteTileUrl(SATELLITE_TILE_TEMPLATE, tileX, tileY, tileZoom);
              let image = tileCacheRef.current.get(url);
              if (!image && typeof Image !== 'undefined') {
                image = new Image();
                image.decoding = 'async';
                image.src = url;
                tileCacheRef.current.set(url, image);
              }
              const dx = rawTileX * TILE_SIZE - startX;
              const dy = tileY * TILE_SIZE - startY;
              const isLoaded = Boolean(image?.complete && image.naturalWidth);
              if (isLoaded) drawnTiles += 1;
              tileDescriptors.push({ dx, dy, image: isLoaded ? image! : null });
            }
          }
        }

        renderStateRef.current = {
          mode: 'map',
          centerLat,
          centerLon,
          centerPixelX: centerPixel.x,
          centerPixelY: centerPixel.y,
          height: size.height,
          latSpan,
          lonSpan,
          projection: 'mercator',
          width: size.width,
          worldSize: centerPixel.worldSize
        };

        const requestedTiles = tileDescriptors.length;
        const tileReadyRatio = requestedTiles ? drawnTiles / requestedTiles : 0;
        const previousFrame = mapFrameRef.current;
        const canUsePreviousFrame =
          Boolean(previousFrame) &&
          previousFrame!.canvas.width === canvas.width &&
          previousFrame!.canvas.height === canvas.height;
        if (requestedTiles && tileReadyRatio < 0.55 && canUsePreviousFrame) {
          ctx.drawImage(previousFrame!.canvas, 0, 0, size.width, size.height);
          ctx.fillStyle = 'rgba(0, 13, 28, 0.1)';
          ctx.fillRect(0, 0, size.width, size.height);
          return true;
        }

        drawEquirectFallback();

        tileDescriptors.forEach(({ dx, dy, image }) => {
          if (!image) return;
          ctx.drawImage(image, dx, dy, TILE_SIZE + 0.5, TILE_SIZE + 0.5);
        });

        const shade = ctx.createRadialGradient(
          size.width * 0.5,
          size.height * 0.48,
          Math.min(size.width, size.height) * 0.12,
          size.width * 0.5,
          size.height * 0.5,
          Math.max(size.width, size.height) * 0.72
        );
        shade.addColorStop(0, 'rgba(0, 0, 0, 0)');
        shade.addColorStop(0.78, 'rgba(2, 7, 15, 0.08)');
        shade.addColorStop(1, 'rgba(2, 7, 15, 0.36)');
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.fillStyle = 'rgba(0, 13, 28, 0.12)';
        ctx.fillRect(0, 0, size.width, size.height);

        if (!mapFrameRef.current) {
          mapFrameRef.current = { canvas: document.createElement('canvas'), key: '' };
        }
        const mapFrame = mapFrameRef.current;
        if (mapFrame.canvas.width !== canvas.width || mapFrame.canvas.height !== canvas.height) {
          mapFrame.canvas.width = canvas.width;
          mapFrame.canvas.height = canvas.height;
        }
        const mapFrameCtx = mapFrame.canvas.getContext('2d');
        if (mapFrameCtx) {
          mapFrameCtx.setTransform(1, 0, 0, 1, 0, 0);
          mapFrameCtx.clearRect(0, 0, mapFrame.canvas.width, mapFrame.canvas.height);
          mapFrameCtx.drawImage(canvas, 0, 0);
          mapFrame.key = `${tileZoom}:${Math.round(centerLon * 10) / 10}:${Math.round(centerLat * 10) / 10}`;
        }
        return true;
      };
      const drawEarthTexture = () => {
        const texture = assets.earthTexture;
        if (!texture || typeof document === 'undefined') return false;
        const renderScale = deviceProfile.lowPower ? 0.52 : 0.68;
        const diameter = Math.max(120, Math.min(420, Math.round(radius * 2 * renderScale)));
        const rotationKey = `${diameter}:${Math.round(rotation[0] * 2) / 2}:${
          Math.round(rotation[1] * 2) / 2
        }:${Math.round(size.width)}:${Math.round(size.height)}`;
        let render = textureRenderRef.current;
        if (!render) {
          render = { canvas: document.createElement('canvas'), key: '' };
          textureRenderRef.current = render;
        }
        if (render.key !== rotationKey) {
          render.canvas.width = diameter;
          render.canvas.height = diameter;
          const renderCtx = render.canvas.getContext('2d', { willReadFrequently: true });
          if (!renderCtx) return false;
          const imageData = renderCtx.createImageData(diameter, diameter);
          const target = imageData.data;
          const half = diameter / 2;
          for (let y = 0; y < diameter; y += 1) {
            const normalizedY = (y + 0.5 - half) / half;
            for (let x = 0; x < diameter; x += 1) {
              const normalizedX = (x + 0.5 - half) / half;
              if (normalizedX * normalizedX + normalizedY * normalizedY > 1) continue;
              const projected = projection.invert?.([
                projectionCenterX + normalizedX * radius,
                projectionCenterY + normalizedY * radius
              ]);
              if (!projected) continue;
              const [lon, lat] = projected;
              const u = ((((lon + 180) % 360) + 360) % 360) / 360;
              const v = clamp((90 - lat) / 180, 0, 1);
              const sourceX = Math.min(texture.width - 1, Math.max(0, Math.floor(u * texture.width)));
              const sourceY = Math.min(texture.height - 1, Math.max(0, Math.floor(v * texture.height)));
              const sourceIndex = (sourceY * texture.width + sourceX) * 4;
              const targetIndex = (y * diameter + x) * 4;
              target[targetIndex] = texture.data[sourceIndex];
              target[targetIndex + 1] = texture.data[sourceIndex + 1];
              target[targetIndex + 2] = texture.data[sourceIndex + 2];
              target[targetIndex + 3] = 255;
            }
          }
          renderCtx.putImageData(imageData, 0, 0);
          render.key = rotationKey;
        }

        ctx.save();
        ctx.beginPath();
        path(sphere);
        ctx.clip();
        ctx.drawImage(
          render.canvas,
          projectionCenterX - radius,
          projectionCenterY - radius,
          radius * 2,
          radius * 2
        );
        const limbShade = ctx.createRadialGradient(
          size.width * 0.38,
          size.height * 0.3,
          radius * 0.18,
          size.width * 0.5,
          size.height * 0.52,
          radius * 1.04
        );
        limbShade.addColorStop(0, 'rgba(255, 255, 255, 0.02)');
        limbShade.addColorStop(0.62, 'rgba(6, 18, 30, 0.06)');
        limbShade.addColorStop(1, 'rgba(2, 7, 14, 0.46)');
        ctx.fillStyle = limbShade;
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.restore();
        return true;
      };
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
      const mapDrawn = mapMode ? drawMapTexture() : false;
      if (!mapDrawn) {
        renderStateRef.current = { mode: 'sphere' };
      }

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

      if (!mapDrawn) {
        ctx.beginPath();
        path(sphere);
        ctx.fillStyle = oceanGradient;
        ctx.fill();
      }

      const hasEarthTexture = !mapDrawn && drawEarthTexture();

      if (!mapDrawn && !hasEarthTexture) {
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
        path(assets.land as any);
        ctx.fillStyle = landGradient;
        ctx.fill();

        ctx.save();
        ctx.beginPath();
        path(assets.land as any);
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
      }

      if (!mapDrawn) {
        ctx.beginPath();
        path(assets.land as any);
        ctx.strokeStyle = hasEarthTexture ? 'rgba(210, 243, 255, 0.08)' : 'rgba(210, 243, 255, 0.16)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        if (assets.borders) {
          ctx.beginPath();
          path(assets.borders as any);
          ctx.strokeStyle = hasEarthTexture ? 'rgba(190, 232, 255, 0.16)' : 'rgba(190, 232, 255, 0.34)';
          ctx.lineWidth = currentScale >= 2 ? 0.9 : 0.72;
          ctx.stroke();
        }

        ctx.beginPath();
        path(assets.geoGraticule10());
        ctx.strokeStyle = 'rgba(220, 241, 255, 0.12)';
        ctx.lineWidth = 0.6;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(212, 245, 255, 0.34)';
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        path(sphere);
        ctx.stroke();
      }

      const baseDot = immersive
        ? Math.max(2.3, 4.2 - (currentScale - 1) * 0.35)
        : Math.max(2.2, 4.4 - (currentScale - 1) * 0.55);
      const activeDot = baseDot + (immersive ? 2.8 : 2.2);
      const pulse = focusPulseRef.current;
      focusPulseRef.current = Math.max(0, pulse - (deviceProfile.lowPower ? 0.05 : 0.02));

      const visiblePoints = points
        .map((point) => {
          let x = 0;
          let y = 0;
          if (renderStateRef.current.mode === 'map') {
            const state = renderStateRef.current;
            if (
              state.projection === 'mercator' &&
              state.centerPixelX !== undefined &&
              state.centerPixelY !== undefined &&
              state.worldSize !== undefined
            ) {
              const pointPixel = lonLatToWorldPixel(
                point.lon,
                point.lat,
                Math.log2(state.worldSize / TILE_SIZE)
              );
              let dx = pointPixel.x - state.centerPixelX;
              if (Math.abs(dx) > state.worldSize / 2) {
                dx += dx > 0 ? -state.worldSize : state.worldSize;
              }
              x = state.width / 2 + dx;
              y = state.height / 2 + (pointPixel.y - state.centerPixelY);
            } else {
              const dx = normalizeLongitudeDelta(point.lon - state.centerLon);
              const dy = point.lat - state.centerLat;
              if (
                Math.abs(dx) > state.lonSpan * 0.58 ||
                Math.abs(dy) > state.latSpan * 0.58
              ) {
                return null;
              }
              x = state.width / 2 + (dx / state.lonSpan) * state.width;
              y = state.height / 2 - (dy / state.latSpan) * state.height;
            }
            if (x < -20 || x > state.width + 20 || y < -20 || y > state.height + 20) {
              return null;
            }
          } else {
            const distance = assets.geoDistance([point.lon, point.lat], center);
            if (distance > Math.PI / 2) return null;
            const coords = projection([point.lon, point.lat]);
            if (!coords) return null;
            [x, y] = coords;
          }
          const density = Math.min(5.8, Math.sqrt(point.count ?? 1));
          const pointRadius =
            (renderStateRef.current.mode === 'map' ? Math.max(1.6, baseDot - 1.1) : baseDot) +
            Math.max(0, density - 1) * (renderStateRef.current.mode === 'map' ? 0.55 : 1.05);
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

      const featuredPointLimit = immersive ? (deviceProfile.lowPower ? 42 : 72) : Number.POSITIVE_INFINITY;
      visiblePoints.forEach((point, index) => {
        const detailedPoint =
          !immersive || point.isSelected || point.isActive || index < featuredPointLimit;
        if (!detailedPoint) {
          const simpleRadius = Math.max(1.15, Math.min(2.6, point.pointRadius * 0.42));
          ctx.beginPath();
          ctx.fillStyle = 'rgba(0, 255, 132, 0.82)';
          ctx.arc(point.x, point.y, simpleRadius, 0, Math.PI * 2);
          ctx.fill();
          return;
        }

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
            : immersive
              ? 'rgba(0, 255, 132, 0.38)'
              : 'rgba(152, 220, 255, 0.12)';
        ctx.arc(point.x, point.y, haloRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.shadowColor = point.isSelected
          ? 'rgba(201, 250, 255, 0.48)'
          : point.isActive
            ? 'rgba(136, 241, 222, 0.42)'
            : immersive
              ? 'rgba(0, 255, 132, 0.5)'
              : 'rgba(152, 220, 255, 0.28)';
        ctx.shadowBlur = point.isSelected ? 18 : point.isActive ? 14 : immersive ? 11 : 10;
        ctx.beginPath();
        ctx.fillStyle = point.isSelected
          ? 'rgba(238, 254, 255, 0.98)'
          : point.isActive
            ? '#88f1de'
            : immersive
              ? '#00ff84'
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
        ctx.fillStyle = point.isSelected
          ? 'rgba(53, 73, 90, 0.82)'
          : immersive
            ? 'rgba(224, 255, 238, 0.92)'
            : 'rgba(244, 252, 255, 0.82)';
        ctx.arc(point.x, point.y, Math.max(1.7, point.pointRadius * 0.34), 0, Math.PI * 2);
        ctx.fill();

        if (point.isSelected) {
          ctx.strokeStyle = 'rgba(198, 248, 255, 0.6)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(point.x, point.y, point.pointRadius + 6.2, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (point.isActive && pulse > 0.01 && !deviceProfile.lowPower) {
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

      const labelLimitBase = immersive ? 0 : currentScale >= 3.6 ? 9 : currentScale >= 2.4 ? 7 : currentScale >= 1.5 ? 5 : 3;
      const labelLimit = deviceProfile.lowPower
        ? Math.max(2, Math.floor(labelLimitBase / 2))
        : labelLimitBase;
      const labelSlots: Array<{ left: number; top: number; right: number; bottom: number }> = [];
      visiblePoints
        .filter((point, index) => point.isSelected || point.isActive || index < labelLimit * 2)
        .forEach((point) => {
          if (labelSlots.length >= labelLimit && !point.isSelected) return;
          const title = trimLabel(point.label, point.isSelected ? 22 : 16);
          const detail =
            point.isSelected || currentScale >= 2.6
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
  }, [
    size,
    points,
    activeId,
    selectedId,
    assets,
    autoRotate,
    // scale is intentionally NOT in deps; we read scaleRef in the loop and
    // tween between targetScaleRef so re-renders don't recreate the rAF.
    documentVisible,
    immersive,
    deviceProfile.lowPower
  ]);

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    setAutoRotate(false);
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
      pinchRef.current = { distance: Math.hypot(dx, dy), scale: scaleRef.current };
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
        commitScale(pinchRef.current.scale * factor);
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
    const speed = 0.4 / Math.max(1, scaleRef.current);
    rotationRef.current = [
      rotationRef.current[0] + dx * speed,
      Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, rotationRef.current[1] - dy * speed)),
      0
    ];
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    // Sample drag velocity (pixels per ms) so the draw loop can keep
    // spinning the globe briefly after pointer release.
    const now = event.timeStamp || performance.now();
    const elapsed = Math.max(1, now - dragVelocityRef.current.sampledAt);
    if (elapsed < 64) {
      dragVelocityRef.current = {
        x: dx / elapsed,
        y: dy / elapsed,
        sampledAt: now
      };
    } else {
      dragVelocityRef.current = { x: 0, y: 0, sampledAt: now };
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = false;
    lastPointerRef.current = null;
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    // Cap inertia velocity so a frantic flick doesn't fling the globe.
    const v = dragVelocityRef.current;
    const speed = Math.hypot(v.x, v.y);
    if (speed > 3) {
      const factor = 3 / speed;
      dragVelocityRef.current = { x: v.x * factor, y: v.y * factor, sampledAt: performance.now() };
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointerIdRef.current === event.pointerId) {
      pointerIdRef.current = null;
    }
  };

  const pickStation = (event: MouseEvent<HTMLCanvasElement>) => {
    if ((!onPick && !onPickCandidates) || !projectionRef.current || !canvasRef.current || !assets) {
      return;
    }
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const renderState = renderStateRef.current;
    if (renderState.mode === 'map') {
      const maxPick = Math.max(12, 24 - (scaleRef.current - 1) * 0.7);
      const maxPickSq = maxPick * maxPick;
      const candidates: { id: string; dist: number }[] = [];
      points.forEach((point) => {
        let px = 0;
        let py = 0;
        if (
          renderState.projection === 'mercator' &&
          renderState.centerPixelX !== undefined &&
          renderState.centerPixelY !== undefined &&
          renderState.worldSize !== undefined
        ) {
          const pointPixel = lonLatToWorldPixel(
            point.lon,
            point.lat,
            Math.log2(renderState.worldSize / TILE_SIZE)
          );
          let dxMercator = pointPixel.x - renderState.centerPixelX;
          if (Math.abs(dxMercator) > renderState.worldSize / 2) {
            dxMercator += dxMercator > 0 ? -renderState.worldSize : renderState.worldSize;
          }
          px = renderState.width / 2 + dxMercator;
          py = renderState.height / 2 + (pointPixel.y - renderState.centerPixelY);
        } else {
          const dxLon = normalizeLongitudeDelta(point.lon - renderState.centerLon);
          const dyLat = point.lat - renderState.centerLat;
          if (
            Math.abs(dxLon) > renderState.lonSpan * 0.58 ||
            Math.abs(dyLat) > renderState.latSpan * 0.58
          ) {
            return;
          }
          px = renderState.width / 2 + (dxLon / renderState.lonSpan) * renderState.width;
          py = renderState.height / 2 - (dyLat / renderState.latSpan) * renderState.height;
        }
        const dx = px - x;
        const dy = py - y;
        const dist = dx * dx + dy * dy;
        if (dist < maxPickSq) {
          candidates.push({ id: point.id, dist });
        }
      });
      if (!candidates.length) {
        onPickCandidates?.([]);
        return;
      }
      candidates.sort((a, b) => a.dist - b.dist || a.id.localeCompare(b.id));
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
      return;
    }
    const [cx, cy] = projectionRef.current.translate();
    const radius = projectionRef.current.scale();
    const dxSphere = x - cx;
    const dySphere = y - cy;
    if (dxSphere * dxSphere + dySphere * dySphere > (radius + 6) * (radius + 6)) {
      return;
    }
    const rotation = rotationRef.current;
    const center: [number, number] = [-rotation[0], -rotation[1]];
    const maxPick = Math.max(11, 22 - (scaleRef.current - 1) * 0.9);
    const maxPickSq = maxPick * maxPick;

    const candidates: { id: string; dist: number }[] = [];
    points.forEach((point) => {
      const distance = assets.geoDistance([point.lon, point.lat], center);
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
    <div className="globe" ref={containerRef} onWheelCapture={handleSurfaceWheel}>
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
      <div className="globe-reticle" aria-hidden="true">
        <span className="globe-reticle-line globe-reticle-line-x" />
        <span className="globe-reticle-line globe-reticle-line-y" />
        <span className="globe-reticle-dot" />
      </div>
      <div className="globe-overlay">
        <div className="globe-count">
          {statusText ||
            `Showing ${points.length}${typeof geoCount === 'number' ? ` / ${geoCount} mapped` : ''}${typeof totalCount === 'number' ? ` / ${totalCount} total` : ''}`}
        </div>
        <div className="globe-hint">{hintText || 'Drag / pinch / tap'}</div>
      </div>
    </div>
  );
};
