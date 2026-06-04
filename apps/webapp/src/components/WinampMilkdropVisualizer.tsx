import { useEffect, useRef } from 'react';
import { getDeviceProfile } from '../lib/deviceProfile';
import type { VisualizerFrame } from '../lib/useAudioPlayer';
import { useTheme } from '../state/ThemeContext';

type WinampMilkdropVisualizerProps = {
  active: boolean;
  available: boolean;
  spectrum: number[];
  waveform: number[];
  // P3-3b: when provided, the milkdrop pulls live spectrum/waveform straight from
  // the shared audio pump into its render ref — no React state per frame, no
  // second analyser.
  subscribe?: (callback: (frame: VisualizerFrame) => void) => () => void;
};

type VisualizerState = {
  active: boolean;
  available: boolean;
  spectrum: number[];
  waveform: number[];
};

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const hue = (value: number) => ((value % 360) + 360) % 360;

export const WinampMilkdropVisualizer = ({
  active,
  available,
  spectrum,
  waveform,
  subscribe
}: WinampMilkdropVisualizerProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<VisualizerState>({
    active,
    available,
    spectrum,
    waveform
  });

  useEffect(() => {
    stateRef.current.active = active;
    stateRef.current.available = available;
    // With a live pump attached, spectrum/waveform are driven by it (below);
    // otherwise fall back to the props.
    if (!subscribe) {
      stateRef.current.spectrum = spectrum;
      stateRef.current.waveform = waveform;
    }
  }, [active, available, spectrum, waveform, subscribe]);

  // P3-3b: live audio data from the shared pump. The frame is copied into the
  // render ref directly in the subscription callback — no React state per frame,
  // and the milkdrop's own RAF reads the ref. Only subscribed while active, so
  // the pump never spins up just for an idle card; on cleanup we hand back to the
  // (empty) props and the time-animated idle blob takes over.
  useEffect(() => {
    if (!subscribe || !active) return undefined;
    const unsubscribe = subscribe((frame) => {
      stateRef.current.spectrum = Array.from(frame.spectrum);
      stateRef.current.waveform = Array.from(frame.waveform);
    });
    return () => {
      unsubscribe();
      stateRef.current.spectrum = spectrum;
      stateRef.current.waveform = waveform;
    };
  }, [subscribe, active, spectrum, waveform]);

  // P3-3b: palette follows the active theme. The accent hue/sat + light/dark
  // mode are resolved ONCE per theme change into a ref (not per frame), and the
  // render loop reads that ref so the rainbow base is replaced by an
  // accent-family palette without parsing the theme 60x/s.
  const { currentTheme } = useTheme();
  const paletteRef = useRef({ hue: 184, sat: 64, light: false });
  useEffect(() => {
    const accent = currentTheme.layers.accent;
    paletteRef.current = {
      hue: accent ? (((Math.round(accent.hue) % 360) + 360) % 360) : 184,
      sat: accent ? Math.round(Math.min(100, Math.max(0, accent.sat))) : 64,
      light: currentTheme.mode === 'light'
    };
  }, [currentTheme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    let frameId = 0;
    let disposed = false;
    let lastFrameAt = 0;
    const { lowPower, reducedMotion } = getDeviceProfile();
    const targetFrameMs = reducedMotion ? 80 : lowPower ? 40 : 16;

    const resize = () => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.25 : 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas);

    const drawTunnel = (
      side: 'left' | 'right',
      width: number,
      height: number,
      time: number,
      energy: number,
      pulse: number,
      baseHue: number,
      columns: number,
      rows: number
    ) => {
      const startX = side === 'left' ? width * 0.08 : width * 0.92;
      const direction = side === 'left' ? 1 : -1;

      for (let column = 0; column < columns; column += 1) {
        const depth = column / (columns - 1);
        const x =
          startX +
          direction * (depth * width * 0.34 + Math.sin(time * 0.9 + column * 0.8) * width * 0.012);
        const radius = 1.8 + depth * 2.4 + energy * 2.8;
        const alpha = 0.2 + (1 - depth) * 0.38 + pulse * 0.14;
        for (let row = 0; row < rows; row += 1) {
          const yBase = ((row + 0.5) / rows) * height;
          const yOffset = Math.sin(time * 1.8 + row * 0.7 + column * 0.4) * (4 + energy * 6);
          const y = yBase + yOffset;
          const dotHue = hue(baseHue + (side === 'left' ? -12 : 14) + row * 1.6 - depth * 16);
          context.beginPath();
          context.fillStyle = `hsla(${dotHue} ${88 - depth * 14}% ${46 + pulse * 12}% / ${alpha})`;
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fill();
        }
      }
    };

    const render = (timestamp: number) => {
      if (disposed) return;
      if (document.hidden) {
        frameId = window.requestAnimationFrame(render);
        return;
      }
      if (lastFrameAt && timestamp - lastFrameAt < targetFrameMs) {
        frameId = window.requestAnimationFrame(render);
        return;
      }
      lastFrameAt = timestamp;

      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const { active: isActive, available: isAvailable, spectrum: nextSpectrum, waveform: nextWaveform } =
        stateRef.current;

      const energy = average(nextSpectrum);
      const waveformEnergy = average(nextWaveform.map((value) => Math.abs(value)));
      const pulse = isActive ? 0.45 + energy * 0.95 : 0.28;
      const time = timestamp * 0.001;
      // P3-3b: theme-driven palette (cached ref read, not parsed per frame).
      const { hue: accentHue, sat: accentSat, light } = paletteRef.current;
      // Drift gently around the accent instead of sweeping the whole wheel, and
      // fold the original rainbow offsets into a narrow band around it — keeps
      // the structure's variety while reading as the theme accent.
      const drift = Math.sin(time * 0.3) * 12 + energy * 20;
      const band = 50;
      const tone = (offset: number) =>
        hue(accentHue + drift + Math.sin((offset * Math.PI) / 180) * band);
      const baseSat = Math.round(56 + accentSat * 0.36);
      const tunnelColumns = lowPower ? 7 : 12;
      const tunnelRows = lowPower ? 9 : 14;
      const beamCount = lowPower ? 10 : 18;
      const sparkCount = lowPower ? 12 : 28;
      const blobPoints = lowPower ? 40 : 72;

      context.clearRect(0, 0, width, height);

      const bg = context.createLinearGradient(0, 0, 0, height);
      if (light) {
        bg.addColorStop(0, 'rgba(245, 241, 235, 0.96)');
        bg.addColorStop(0.42, 'rgba(236, 231, 224, 0.94)');
        bg.addColorStop(1, 'rgba(248, 244, 238, 1)');
      } else {
        bg.addColorStop(0, 'rgba(4, 7, 18, 0.98)');
        bg.addColorStop(0.42, 'rgba(8, 10, 28, 0.94)');
        bg.addColorStop(1, 'rgba(3, 5, 16, 1)');
      }
      context.fillStyle = bg;
      context.fillRect(0, 0, width, height);

      const aurora = context.createRadialGradient(
        width * 0.5,
        height * 0.56,
        width * 0.04,
        width * 0.5,
        height * 0.56,
        width * 0.52
      );
      aurora.addColorStop(0, `hsla(${tone(162)} ${baseSat}% 62% / ${0.18 + pulse * 0.18})`);
      aurora.addColorStop(0.42, `hsla(${tone(28)} ${baseSat}% 52% / ${0.08 + pulse * 0.12})`);
      aurora.addColorStop(1, 'rgba(0, 0, 0, 0)');
      context.fillStyle = aurora;
      context.fillRect(0, 0, width, height);

      drawTunnel('left', width, height, time, energy, pulse, tone(96), tunnelColumns, tunnelRows);
      drawTunnel('right', width, height, time, energy, pulse, tone(-74), tunnelColumns, tunnelRows);

      context.save();
      context.translate(width / 2, height / 2);

      const blobRadiusX = width * (0.17 + pulse * 0.045);
      const blobRadiusY = height * (0.26 + pulse * 0.06);
      const points = blobPoints;

      context.beginPath();
      for (let index = 0; index <= points; index += 1) {
        const angle = (index / points) * Math.PI * 2;
        const wave = nextWaveform[index % nextWaveform.length] ?? 0;
        const freq = nextSpectrum[index % nextSpectrum.length] ?? energy;
        const radialNoise =
          Math.sin(angle * 3.2 + time * 2.8) * 0.12 +
          Math.cos(angle * 5.1 - time * 1.7) * 0.08 +
          wave * 0.18 +
          freq * 0.16;
        const radiusX = blobRadiusX * (1 + radialNoise);
        const radiusY = blobRadiusY * (1 + radialNoise * 0.78);
        const x = Math.cos(angle) * radiusX;
        const y = Math.sin(angle) * radiusY;
        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }
      context.closePath();

      const blobFill = context.createRadialGradient(0, 0, width * 0.03, 0, 0, blobRadiusX * 1.15);
      blobFill.addColorStop(0, light ? 'rgba(255, 252, 246, 0.98)' : 'rgba(235, 248, 255, 0.98)');
      blobFill.addColorStop(0.12, `hsla(${tone(188)} ${baseSat}% 72% / 0.96)`);
      blobFill.addColorStop(0.4, `hsla(${tone(124)} ${baseSat}% 60% / 0.92)`);
      blobFill.addColorStop(0.72, `hsla(${tone(276)} ${Math.max(40, baseSat - 8)}% 54% / 0.84)`);
      blobFill.addColorStop(1, `hsla(${tone(24)} ${baseSat}% 28% / 0.12)`);

      context.shadowBlur = 24 + pulse * 22;
      context.shadowColor = `hsla(${tone(176)} 100% 70% / 0.72)`;
      context.fillStyle = blobFill;
      context.fill();

      context.shadowBlur = 0;
      context.lineWidth = 1.6;
      context.strokeStyle = `hsla(${tone(150)} 100% 80% / 0.82)`;
      context.stroke();

      context.globalCompositeOperation = 'screen';
      for (let index = 0; index < beamCount; index += 1) {
        const angle = (index / beamCount) * Math.PI * 2 + time * 0.35;
        const freq = nextSpectrum[index % nextSpectrum.length] ?? energy;
        const wave = nextWaveform[index % nextWaveform.length] ?? 0;
        const innerX = Math.cos(angle) * blobRadiusX * 0.18;
        const innerY = Math.sin(angle) * blobRadiusY * 0.18;
        const outerX = Math.cos(angle) * blobRadiusX * (0.72 + freq * 0.32);
        const outerY = Math.sin(angle) * blobRadiusY * (0.72 + Math.abs(wave) * 0.34);
        context.beginPath();
        context.moveTo(innerX, innerY);
        context.lineTo(outerX, outerY);
        context.strokeStyle = `hsla(${tone(index * 12)} 90% ${58 + freq * 18}% / ${0.16 + freq * 0.34})`;
        context.lineWidth = 1 + freq * 1.2;
        context.stroke();
      }

      for (let index = 0; index < sparkCount; index += 1) {
        const angle = (index / sparkCount) * Math.PI * 2 - time * 0.42;
        const orbit = 0.92 + ((nextSpectrum[index % nextSpectrum.length] ?? energy) * 0.28);
        const sparkX = Math.cos(angle) * blobRadiusX * orbit;
        const sparkY = Math.sin(angle) * blobRadiusY * orbit;
        context.beginPath();
        context.fillStyle = `hsla(${tone(220 + index * 9)} 96% 68% / ${0.16 + pulse * 0.18})`;
        context.arc(sparkX, sparkY, 0.9 + pulse * 0.8, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();

      context.globalCompositeOperation = 'source-over';
      const vignette = context.createRadialGradient(width / 2, height / 2, height * 0.12, width / 2, height / 2, width * 0.66);
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, light ? 'rgba(58, 46, 38, 0.14)' : 'rgba(0, 0, 0, 0.42)');
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);

      if (!isAvailable) {
        context.fillStyle = 'rgba(230, 240, 255, 0.12)';
        context.fillRect(0, height - 16, width, 16);
      }

      frameId = window.requestAnimationFrame(render);
    };

    frameId = window.requestAnimationFrame(render);

    return () => {
      disposed = true;
      observer.disconnect();
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  return <canvas className="winamp-milkdrop-canvas" ref={canvasRef} aria-hidden="true" />;
};
