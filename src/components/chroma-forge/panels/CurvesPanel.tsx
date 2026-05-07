'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Upload,
  RotateCcw,
  TrendingUp,
  Lock,
  Unlock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAppStore } from '@/store/useAppStore';
import type {
  CurveChannel,
  CurveType,
  CurvePoint,
  CurveData,
} from '@/store/useAppStore';
import { cn } from '@/lib/utils';
import { generateHistogram } from '@/lib/colorUtils';

// ── Constants ──────────────────────────────────────────────────────────────

const CHANNELS: { key: CurveChannel; label: string; color: string; dotClass: string }[] = [
  { key: 'master', label: 'Master', color: '#ffffff', dotClass: 'bg-white' },
  { key: 'r', label: 'R', color: '#ef4444', dotClass: 'bg-red-500' },
  { key: 'g', label: 'G', color: '#22c55e', dotClass: 'bg-green-500' },
  { key: 'b', label: 'B', color: '#3b82f6', dotClass: 'bg-blue-500' },
  { key: 'luminance', label: 'Luma', color: '#a1a1aa', dotClass: 'bg-zinc-400' },
];

const CURVE_TYPE_LABELS: Record<CurveType, string> = {
  custom: 'Custom',
  's-curve': 'S-Curve',
  contrast: 'Contrast',
  fade: 'Fade (Film)',
  'linear-contrast': 'Linear Contrast',
  negative: 'Negative',
  'cross-process': 'Cross Process',
  'bleach-bypass': 'Bleach Bypass',
};

const CURVE_TYPES: CurveType[] = [
  'custom',
  's-curve',
  'contrast',
  'fade',
  'linear-contrast',
  'negative',
  'cross-process',
  'bleach-bypass',
];

const CANVAS_PAD = 0; // internal padding in CSS px

// ── Curve Preset Generators ───────────────────────────────────────────────

/** Clamp a value to 0-255 integer */
function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Sigmoid-like helper for S-curve */
function sigmoid(x: number, strength: number): number {
  return 1 / (1 + Math.exp(-strength * (x - 0.5)));
}

function generateSCurvePoints(channel: CurveChannel): CurvePoint[] {
  const pts: CurvePoint[] = [];
  const strength = 8;
  for (let i = 0; i <= 255; i += 5) {
    const t = i / 255;
    const y = sigmoid(t, strength);
    pts.push({ id: `${channel}-sc-${i}`, x: i, y: clampByte(y * 255) });
  }
  // Ensure endpoints
  pts[0].y = 0;
  pts[pts.length - 1].y = 255;
  return pts;
}

function generateContrastPoints(channel: CurveChannel): CurvePoint[] {
  const pts: CurvePoint[] = [];
  const contrast = 1.4;
  for (let i = 0; i <= 255; i += 5) {
    const t = i / 255;
    const y = contrast * (t - 0.5) + 0.5;
    pts.push({ id: `${channel}-ct-${i}`, x: i, y: clampByte(y * 255) });
  }
  pts[0].y = 0;
  pts[pts.length - 1].y = 255;
  return pts;
}

function generateFadePoints(channel: CurveChannel): CurvePoint[] {
  const pts: CurvePoint[] = [];
  for (let i = 0; i <= 255; i += 5) {
    const t = i / 255;
    // Lift shadows, roll off highlights — film-like fade
    const shadowLift = 15;
    const highlightRoll = 20;
    let y: number;
    if (t < 0.5) {
      // Shadows: lift via gentle power curve
      const s = t * 2;
      y = shadowLift + (127.5 - shadowLift) * (s * s * (3 - 2 * s));
      y = y / 255;
    } else {
      // Highlights: compress and roll off
      const s = (t - 0.5) * 2;
      y = 127.5 + (255 - highlightRoll - 127.5) * (s * s * (3 - 2 * s));
      y = (y + highlightRoll * s) / 255;
    }
    pts.push({ id: `${channel}-fd-${i}`, x: i, y: clampByte(y * 255) });
  }
  pts[0].y = clampByte(15);
  pts[pts.length - 1].y = clampByte(240);
  return pts;
}

function generateLinearContrastPoints(channel: CurveChannel): CurvePoint[] {
  const offset = 30;
  return [
    { id: `${channel}-lc-0`, x: 0, y: offset },
    { id: `${channel}-lc-255`, x: 255, y: 255 - offset },
  ];
}

function generateNegativePoints(channel: CurveChannel): CurvePoint[] {
  return [
    { id: `${channel}-neg-0`, x: 0, y: 255 },
    { id: `${channel}-neg-255`, x: 255, y: 0 },
  ];
}

function generateCrossProcessPoints(channel: CurveChannel): CurvePoint[] {
  // Cross-process: raises mids, crushes shadows slightly, pushes highlights
  const pts: CurvePoint[] = [];
  for (let i = 0; i <= 255; i += 5) {
    const t = i / 255;
    // S-shaped but asymmetric — boost mids
    let y: number;
    if (t < 0.3) {
      y = t * 0.7; // compress shadows
    } else if (t < 0.7) {
      // boost mids
      const s = (t - 0.3) / 0.4;
      y = 0.21 + s * 0.68 + 0.1 * Math.sin(s * Math.PI);
    } else {
      // push highlights
      const s = (t - 0.7) / 0.3;
      y = 0.89 + s * 0.15;
    }
    pts.push({ id: `${channel}-cp-${i}`, x: i, y: clampByte(y * 255) });
  }
  pts[0].y = 0;
  pts[pts.length - 1].y = 255;
  return pts;
}

function generateBleachBypassPoints(channel: CurveChannel): CurvePoint[] {
  // Bleach bypass: high contrast, desaturated look — steep S-curve
  const pts: CurvePoint[] = [];
  const strength = 14;
  for (let i = 0; i <= 255; i += 5) {
    const t = i / 255;
    const y = sigmoid(t, strength);
    pts.push({ id: `${channel}-bb-${i}`, x: i, y: clampByte(y * 255) });
  }
  pts[0].y = 0;
  pts[pts.length - 1].y = 255;
  return pts;
}

function generatePresetPoints(channel: CurveChannel, type: CurveType): CurvePoint[] {
  switch (type) {
    case 's-curve':
      return generateSCurvePoints(channel);
    case 'contrast':
      return generateContrastPoints(channel);
    case 'fade':
      return generateFadePoints(channel);
    case 'linear-contrast':
      return generateLinearContrastPoints(channel);
    case 'negative':
      return generateNegativePoints(channel);
    case 'cross-process':
      return generateCrossProcessPoints(channel);
    case 'bleach-bypass':
      return generateBleachBypassPoints(channel);
    case 'custom':
    default:
      return [
        { id: `${channel}-0`, x: 0, y: 0 },
        { id: `${channel}-255`, x: 255, y: 255 },
      ];
  }
}

// ── Monotone Cubic Spline Interpolation (Fritsch-Carlson) ─────────────────

function monotoneCubicSpline(
  points: CurvePoint[],
  resolution: number,
): { x: number; y: number }[] {
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y }));

  const n = points.length;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  // Compute slopes (delta y / delta x)
  const dxs: number[] = [];
  const dys: number[] = [];
  const ms: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dxs.push(xs[i + 1] - xs[i]);
    dys.push(ys[i + 1] - ys[i]);
    ms.push(dys[i] / dxs[i]);
  }

  // Compute tangents (m)
  const cs: number[] = [ms[0]];
  for (let i = 1; i < n - 1; i++) {
    if (ms[i - 1] * ms[i] <= 0) {
      cs.push(0);
    } else {
      cs.push(
        3 * ((dxs[i - 1] + dxs[i]) / (2 * dxs[i - 1] + 2 * dxs[i])) * ms[i],
      );
    }
  }
  cs.push(ms[n - 2]);

  // Compute Fritsch-Carlson coefficients
  const c1s: number[] = [...cs];
  const c2s: number[] = [];
  const c3s: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const inv = 1 / dxs[i];
    c2s.push((3 * ms[i] - 2 * c1s[i] - c1s[i + 1]) * inv);
    c3s.push((c1s[i] + c1s[i + 1] - 2 * ms[i]) * (inv * inv));
  }

  // Interpolate
  const result: { x: number; y: number }[] = [];
  const xMin = xs[0];
  const xMax = xs[n - 1];

  for (let i = 0; i <= resolution; i++) {
    const x = xMin + (xMax - xMin) * (i / resolution);
    // Find segment
    let j = n - 2;
    for (let k = 0; k < n - 1; k++) {
      if (x >= xs[k] && x <= xs[k + 1]) {
        j = k;
        break;
      }
    }
    const diff = x - xs[j];
    const y = ys[j] + c1s[j] * diff + c2s[j] * diff * diff + c3s[j] * diff * diff * diff;
    result.push({ x, y: Math.max(0, Math.min(255, y)) });
  }
  return result;
}

// ── ACV Parser ─────────────────────────────────────────────────────────────

function parseACV(buffer: ArrayBuffer): { channel: CurveChannel; points: CurvePoint[] }[] {
  const view = new DataView(buffer);

  // Header: 4 bytes version, 4 bytes padding
  // const version = view.getUint16(0);
  // Skip 4 more bytes padding (total 4 bytes header in some versions, 8 in others)

  // Offset 4: number of input curves (per-channel curves for RGB + possibly master)
  let offset = 4;
  const numCurves = view.getUint16(offset);
  offset += 2;

  // In ACV format, first come the per-channel curves (R, G, B), then the master (0, 1)
  // But some .acv files have 4 curves: RGB then master, or just RGB
  // The standard format is: first numCurves are input curves (R, G, B, ...)
  // Then after those, numOutputCurves more curves

  const channelOrder: CurveChannel[] = ['r', 'g', 'b'];
  if (numCurves >= 4) {
    channelOrder.push('master');
  }

  const results: { channel: CurveChannel; points: CurvePoint[] }[] = [];

  for (let c = 0; c < Math.min(numCurves, 4); c++) {
    const numPoints = view.getUint16(offset);
    offset += 2;

    const points: CurvePoint[] = [];
    for (let p = 0; p < numPoints; p++) {
      const y = view.getUint16(offset);
      offset += 2;
      // X values are evenly distributed from 0 to 255
      const x = numPoints > 1 ? Math.round((p / (numPoints - 1)) * 255) : 0;
      const ch = channelOrder[c] || 'master';
      points.push({ id: `${ch}-acv-${x}`, x, y });
    }

    if (channelOrder[c]) {
      results.push({ channel: channelOrder[c], points });
    }
  }

  return results;
}

// ── Curve Canvas Component ─────────────────────────────────────────────────

interface CurveCanvasProps {
  channel: CurveChannel;
  curveData: CurveData;
  histogram: { r: number[]; g: number[]; b: number[]; luma: number[] } | null;
  onAddPoint: (x: number, y: number) => void;
  onRemovePoint: (pointId: string) => void;
  onMovePoint: (pointId: string, x: number, y: number) => void;
}

function CurveCanvas({
  channel,
  curveData,
  histogram,
  onAddPoint,
  onRemovePoint,
  onMovePoint,
}: CurveCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const sizeRef = useRef({ w: 0, h: 0 });

  // Interaction state (mutable refs for canvas drawing, not for rendering)
  const interactionRef = useRef({
    isDragging: false,
    dragPointId: null as string | null,
    hoveredPointId: null as string | null,
    mouseX: -1,
    mouseY: -1,
  });

  // Cursor state (tracked as React state for render)
  const [cursorState, setCursorState] = useState<'crosshair' | 'grab' | 'grabbing'>('crosshair');

  const channelColor = CHANNELS.find((c) => c.key === channel)?.color || '#ffffff';

  // Map value (0-255) to canvas pixel
  const valueToCanvas = useCallback(
    (val: number, size: number) => {
      return (val / 255) * (size - CANVAS_PAD * 2) + CANVAS_PAD;
    },
    [],
  );

  // Map canvas pixel to value (0-255)
  const canvasToValue = useCallback(
    (px: number, size: number) => {
      return Math.max(0, Math.min(255, ((px - CANVAS_PAD) / (size - CANVAS_PAD * 2)) * 255));
    },
    [],
  );

  // Find closest point to canvas coordinates
  const findClosestPoint = useCallback(
    (cx: number, cy: number, canvasSize: number) => {
      let closest: CurvePoint | null = null;
      let minDist = Infinity;
      const hitRadius = 12; // px

      for (const pt of curveData.points) {
        const px = valueToCanvas(pt.x, canvasSize);
        const py = valueToCanvas(pt.y, canvasSize);
        const dx = cx - px;
        const dy = cy - py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist && dist < hitRadius) {
          minDist = dist;
          closest = pt;
        }
      }
      return closest;
    },
    [curveData.points, valueToCanvas],
  );

  // Draw the canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    const drawArea = w - CANVAS_PAD * 2;

    // ── Histogram ──
    if (histogram) {
      let histData: number[] = [];
      if (channel === 'master' || channel === 'luminance') {
        histData = histogram.luma;
      } else if (channel === 'r') {
        histData = histogram.r;
      } else if (channel === 'g') {
        histData = histogram.g;
      } else if (channel === 'b') {
        histData = histogram.b;
      }

      if (histData.length === 256) {
        const maxVal = Math.max(...histData, 1);
        ctx.beginPath();
        ctx.moveTo(CANVAS_PAD, h - CANVAS_PAD);
        for (let i = 0; i < 256; i++) {
          const x = CANVAS_PAD + (i / 255) * drawArea;
          const barH = (histData[i] / maxVal) * drawArea * 0.9;
          ctx.lineTo(x, h - CANVAS_PAD - barH);
        }
        ctx.lineTo(CANVAS_PAD + drawArea, h - CANVAS_PAD);
        ctx.closePath();

        // Use channel color for histogram
        const histColor = channel === 'master' ? '168, 162, 158' :
          channel === 'r' ? '239, 68, 68' :
          channel === 'g' ? '34, 197, 94' :
          channel === 'b' ? '59, 130, 246' : '161, 161, 170';
        ctx.fillStyle = `rgba(${histColor}, 0.12)`;
        ctx.fill();
      }
    }

    // ── Grid lines ──
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 0.5;
    const gridDivs = 4;
    for (let i = 1; i < gridDivs; i++) {
      const pos = CANVAS_PAD + (i / gridDivs) * drawArea;
      // Vertical
      ctx.beginPath();
      ctx.moveTo(pos, CANVAS_PAD);
      ctx.lineTo(pos, CANVAS_PAD + drawArea);
      ctx.stroke();
      // Horizontal
      ctx.beginPath();
      ctx.moveTo(CANVAS_PAD, pos);
      ctx.lineTo(CANVAS_PAD + drawArea, pos);
      ctx.stroke();
    }

    // ── Diagonal identity line (x = y) ──
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(CANVAS_PAD, CANVAS_PAD + drawArea);
    ctx.lineTo(CANVAS_PAD + drawArea, CANVAS_PAD);
    ctx.stroke();

    // ── Spline curve ──
    const sortedPoints = [...curveData.points].sort((a, b) => a.x - b.x);
    const splinePoints = monotoneCubicSpline(sortedPoints, 256);

    // Shadow
    ctx.strokeStyle = channelColor;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    for (let i = 0; i < splinePoints.length; i++) {
      const sx = valueToCanvas(splinePoints[i].x, w);
      // Flip Y: 0 is at bottom
      const sy = CANVAS_PAD + drawArea - valueToCanvas(splinePoints[i].y, w);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Main curve
    ctx.strokeStyle = channelColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < splinePoints.length; i++) {
      const sx = valueToCanvas(splinePoints[i].x, w);
      const sy = CANVAS_PAD + drawArea - valueToCanvas(splinePoints[i].y, w);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    // ── Control points ──
    const interaction = interactionRef.current;
    for (const pt of sortedPoints) {
      const px = valueToCanvas(pt.x, w);
      const py = CANVAS_PAD + drawArea - valueToCanvas(pt.y, w);
      const isActive = interaction.dragPointId === pt.id;
      const isHovered = interaction.hoveredPointId === pt.id;

      // Glow for active/hovered
      if (isActive || isHovered) {
        ctx.beginPath();
        const glowRadius = isActive ? 16 : 13;
        ctx.arc(px, py, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = channelColor;
        ctx.globalAlpha = isActive ? 0.3 : 0.15;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Point circle
      const radius = isActive ? 6 : isHovered ? 5.5 : 4;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = channelColor;
      ctx.lineWidth = isActive ? 2.5 : 2;
      ctx.stroke();
    }

    // ── Tooltip ──
    if (interaction.hoveredPointId && !interaction.isDragging) {
      const pt = sortedPoints.find((p) => p.id === interaction.hoveredPointId);
      if (pt) {
        const px = valueToCanvas(pt.x, w);
        const py = CANVAS_PAD + drawArea - valueToCanvas(pt.y, w);
        const text = `In: ${pt.x}  Out: ${pt.y}`;
        ctx.font = '10px ui-monospace, monospace';
        const metrics = ctx.measureText(text);
        const tw = metrics.width + 10;
        const th = 18;
        let tx = px + 12;
        let ty = py - 24;
        if (tx + tw > w) tx = px - tw - 8;
        if (ty < 0) ty = py + 12;

        ctx.fillStyle = 'rgba(24, 24, 27, 0.92)';
        ctx.strokeStyle = 'rgba(63, 63, 70, 0.6)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.roundRect(tx, ty, tw, th, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#e4e4e7';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, tx + 5, ty + th / 2);
      }
    }

    // ── Crosshair cursor ──
    if (interaction.mouseX >= CANVAS_PAD && interaction.mouseX <= CANVAS_PAD + drawArea &&
        interaction.mouseY >= CANVAS_PAD && interaction.mouseY <= CANVAS_PAD + drawArea &&
        !interaction.isDragging && !interaction.hoveredPointId) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(interaction.mouseX, CANVAS_PAD);
      ctx.lineTo(interaction.mouseX, CANVAS_PAD + drawArea);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(CANVAS_PAD, interaction.mouseY);
      ctx.lineTo(CANVAS_PAD + drawArea, interaction.mouseY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [channel, channelColor, curveData.points, histogram, valueToCanvas]);

  // Schedule draw
  const scheduleDraw = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) continue;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        sizeRef.current = { w: width, h: height };
        scheduleDraw();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [scheduleDraw]);

  // Redraw when curve data changes
  useEffect(() => {
    scheduleDraw();
  }, [scheduleDraw]);

  // Get canvas-relative mouse position
  const getCanvasPos = useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // Mouse move handler
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = getCanvasPos(e);
      if (!pos) return;
      const { w, h } = sizeRef.current;
      const interaction = interactionRef.current;
      interaction.mouseX = pos.x;
      interaction.mouseY = pos.y;

      if (interaction.isDragging && interaction.dragPointId) {
        // Clamp to canvas area
        const valX = canvasToValue(pos.x, w);
        const valY = canvasToValue(pos.y, h);
        setCursorState('grabbing');

        // For endpoints, clamp x; for midpoints, clamp x to avoid overlap
        const pt = curveData.points.find((p) => p.id === interaction.dragPointId);
        if (pt) {
          const sorted = [...curveData.points].sort((a, b) => a.x - b.x);
          const idx = sorted.findIndex((p) => p.id === pt.id);

          let clampedX = Math.max(0, Math.min(255, valX));

          // Don't allow endpoints to move off 0 or 255
          if (pt.id.endsWith('-0')) clampedX = 0;
          if (pt.id.endsWith('-255')) clampedX = 255;

          // Prevent overlap with neighbors
          if (idx > 0 && clampedX <= sorted[idx - 1].x + 1) {
            clampedX = sorted[idx - 1].x + 1;
          }
          if (idx < sorted.length - 1 && clampedX >= sorted[idx + 1].x - 1) {
            clampedX = sorted[idx + 1].x - 1;
          }

          const clampedY = Math.max(0, Math.min(255, valY));
          onMovePoint(interaction.dragPointId, Math.round(clampedX), Math.round(clampedY));
        }
      } else {
        // Hover detection
        const closest = findClosestPoint(pos.x, pos.y, w);
        const newHoveredId = closest?.id || null;
        if (newHoveredId !== interaction.hoveredPointId) {
          interaction.hoveredPointId = newHoveredId;
          setCursorState(newHoveredId ? 'grab' : 'crosshair');
        }
      }
      scheduleDraw();
    },
    [canvasToValue, curveData.points, findClosestPoint, getCanvasPos, onMovePoint, scheduleDraw],
  );

  // Mouse down handler
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // Only left click
      const pos = getCanvasPos(e);
      if (!pos) return;
      const { w, h } = sizeRef.current;
      const interaction = interactionRef.current;

      const closest = findClosestPoint(pos.x, pos.y, w);
      if (closest) {
        interaction.isDragging = true;
        interaction.dragPointId = closest.id;
        setCursorState('grabbing');
        e.preventDefault();
        scheduleDraw();
      }
    },
    [findClosestPoint, getCanvasPos, scheduleDraw],
  );

  // Mouse up handler
  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const pos = getCanvasPos(e);
      const { w, h } = sizeRef.current;
      const interaction = interactionRef.current;

      if (!interaction.isDragging && pos) {
        // Click on empty space → add point
        const drawArea = w - CANVAS_PAD * 2;
        if (
          pos.x >= CANVAS_PAD &&
          pos.x <= CANVAS_PAD + drawArea &&
          pos.y >= CANVAS_PAD &&
          pos.y <= CANVAS_PAD + drawArea
        ) {
          const closest = findClosestPoint(pos.x, pos.y, w);
          if (!closest) {
            const valX = canvasToValue(pos.x, w);
            const valY = canvasToValue(pos.y, h);
            onAddPoint(Math.round(valX), Math.round(valY));
          }
        }
      }

      interaction.isDragging = false;
      interaction.dragPointId = null;
      setCursorState('crosshair');
      scheduleDraw();
    },
    [canvasToValue, findClosestPoint, getCanvasPos, onAddPoint, scheduleDraw],
  );

  // Double-click handler: remove point
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const pos = getCanvasPos(e);
      if (!pos) return;
      const { w } = sizeRef.current;
      const closest = findClosestPoint(pos.x, pos.y, w);
      if (closest) {
        // Don't remove endpoints
        if (closest.x === 0 && closest.y === 0) return;
        if (closest.x === 255 && closest.y === 255) return;
        onRemovePoint(closest.id);
      }
    },
    [findClosestPoint, getCanvasPos, onRemovePoint],
  );

  // Context menu handler: remove point
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const pos = getCanvasPos(e);
      if (!pos) return;
      const { w } = sizeRef.current;
      const closest = findClosestPoint(pos.x, pos.y, w);
      if (closest) {
        if (closest.x === 0 && closest.y === 0) return;
        if (closest.x === 255 && closest.y === 255) return;
        onRemovePoint(closest.id);
      }
    },
    [findClosestPoint, getCanvasPos, onRemovePoint],
  );

  // Mouse leave handler
  const handleMouseLeave = useCallback(() => {
    const interaction = interactionRef.current;
    interaction.hoveredPointId = null;
    interaction.mouseX = -1;
    interaction.mouseY = -1;
    interaction.isDragging = false;
    interaction.dragPointId = null;
    setCursorState('crosshair');
    scheduleDraw();
  }, [scheduleDraw]);

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-square rounded-lg overflow-hidden border border-zinc-800/60"
      style={{ cursor: cursorState }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        className="absolute inset-0 w-full h-full"
      />
    </div>
  );
}

// ── Main CurvesPanel Component ─────────────────────────────────────────────

export default function CurvesPanel({ className }: { className?: string }) {
  // Store
  const curveData = useAppStore((s) => s.curveData);
  const currentImage = useAppStore((s) => s.currentImage);
  const updateCurvePoints = useAppStore((s) => s.updateCurvePoints);
  const updateCurveType = useAppStore((s) => s.updateCurveType);
  const resetCurve = useAppStore((s) => s.resetCurve);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Local state
  const [activeChannel, setActiveChannel] = useState<CurveChannel>('master');

  // Histogram state
  const [histogram, setHistogram] = useState<{
    r: number[];
    g: number[];
    b: number[];
    luma: number[];
  } | null>(null);

  // Compute histogram from current image
  useEffect(() => {
    if (!currentImage) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const cvs = document.createElement('canvas');
      const sampleSize = 256;
      cvs.width = sampleSize;
      cvs.height = sampleSize;
      const c = cvs.getContext('2d');
      if (!c) return;
      c.drawImage(img, 0, 0, sampleSize, sampleSize);
      const data = c.getImageData(0, 0, sampleSize, sampleSize);
      setHistogram(generateHistogram(data));
    };
    img.src = currentImage.dataUrl;
    return () => { cancelled = true; };
  }, [currentImage]);

  // Get active curve data
  const activeCurveData = curveData.find((c) => c.channel === activeChannel);

  // ── Handlers ────────────────────────────────────────────────────────

  const handleCurveTypeChange = useCallback(
    (type: CurveType) => {
      if (type === 'custom') {
        // Reset to default linear
        resetCurve(activeChannel);
      } else {
        const points = generatePresetPoints(activeChannel, type);
        updateCurvePoints(activeChannel, points);
        updateCurveType(activeChannel, type);
      }
    },
    [activeChannel, resetCurve, updateCurvePoints, updateCurveType],
  );

  const handleAddPoint = useCallback(
    (x: number, y: number) => {
      if (!activeCurveData) return;
      if (activeCurveData.isLocked) return;
      // Use store addCurvePoint
      const store = useAppStore.getState();
      store.addCurvePoint(activeChannel, x, y);
    },
    [activeChannel, activeCurveData],
  );

  const handleRemovePoint = useCallback(
    (pointId: string) => {
      if (!activeCurveData) return;
      if (activeCurveData.isLocked) return;
      const store = useAppStore.getState();
      // Don't remove endpoints
      const pt = activeCurveData.points.find((p) => p.id === pointId);
      if (!pt) return;
      if (pt.x === 0 && pt.y === 0) return;
      if (pt.x === 255 && pt.y === 255) return;
      store.removeCurvePoint(activeChannel, pointId);
    },
    [activeChannel, activeCurveData],
  );

  const handleMovePoint = useCallback(
    (pointId: string, x: number, y: number) => {
      if (!activeCurveData) return;
      if (activeCurveData.isLocked) return;
      const store = useAppStore.getState();
      store.updateCurvePoint(activeChannel, pointId, x, y);
    },
    [activeChannel, activeCurveData],
  );

  const handleReset = useCallback(() => {
    resetCurve(activeChannel);
  }, [activeChannel, resetCurve]);

  const handleLockToggle = useCallback(() => {
    const store = useAppStore.getState();
    const current = curveData.find((c) => c.channel === activeChannel);
    if (!current) return;
    store.setCurveData(
      curveData.map((c) =>
        c.channel === activeChannel ? { ...c, isLocked: !c.isLocked } : c,
      ),
    );
  }, [activeChannel, curveData]);

  // ACV import
  const handleImportACV = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const buffer = ev.target?.result;
        if (!buffer || typeof buffer === 'string') return;
        try {
          const curves = parseACV(buffer);
          for (const curve of curves) {
            updateCurvePoints(curve.channel, curve.points);
            updateCurveType(curve.channel, 'custom');
          }
        } catch (err) {
          console.error('Failed to parse ACV file:', err);
        }
      };
      reader.readAsArrayBuffer(file);
      // Reset input
      e.target.value = '';
    },
    [updateCurvePoints, updateCurveType],
  );

  // ── Render ──────────────────────────────────────────────────────────

  const activeChannelConfig = CHANNELS.find((c) => c.key === activeChannel);

  return (
    <div className={cn('flex flex-col h-full bg-zinc-950 text-zinc-100', className)}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".acv"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.5)]" />
            <h2 className="text-base font-semibold tracking-tight text-white">
              Curves
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"
                  onClick={handleLockToggle}
                >
                  {activeCurveData?.isLocked ? (
                    <Lock size={13} />
                  ) : (
                    <Unlock size={13} />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
                {activeCurveData?.isLocked ? 'Unlock channel' : 'Lock channel'}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"
                  onClick={handleReset}
                >
                  <RotateCcw size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
                Reset channel
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"
                  onClick={handleImportACV}
                >
                  <Upload size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
                Import ACV curves
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Channel selector pills */}
        <div className="flex items-center gap-1 mb-3">
          {CHANNELS.map((ch) => {
            const isActive = ch.key === activeChannel;
            const hasCurve = curveData.find((c) => c.channel === ch.key);
            const isCustom =
              hasCurve &&
              hasCurve.type === 'custom' &&
              hasCurve.points.length > 2;

            return (
              <button
                key={ch.key}
                onClick={() => setActiveChannel(ch.key)}
                className={cn(
                  'relative flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full',
                  'text-xs font-medium transition-all duration-150',
                  'border',
                  isActive
                    ? ch.key === 'master'
                      ? 'bg-white/[0.12] border-white/[0.25] text-white'
                      : 'border-opacity-25 text-white'
                    : 'bg-transparent border-zinc-800/60 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700/60',
                )}
                style={
                  isActive
                    ? {
                        backgroundColor: `${ch.color}15`,
                        borderColor: `${ch.color}40`,
                        color: ch.color,
                      }
                    : undefined
                }
              >
                <span
                  className={cn(
                    'w-2 h-2 rounded-full',
                    isCustom ? 'animate-pulse' : '',
                  )}
                  style={{ backgroundColor: ch.color, opacity: isActive ? 1 : 0.4 }}
                />
                {ch.label}
              </button>
            );
          })}
        </div>

        {/* Curve type dropdown */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-zinc-500">
            <TrendingUp size={13} />
            <span className="text-[11px] font-medium uppercase tracking-wider">Type</span>
          </div>
          <Select
            value={activeCurveData?.type || 'custom'}
            onValueChange={(v) => handleCurveTypeChange(v as CurveType)}
          >
            <SelectTrigger
              size="sm"
              className="h-7 text-xs font-medium bg-zinc-900/60 border-zinc-800/60 text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-200 w-[160px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800 shadow-xl shadow-black/40">
              {CURVE_TYPES.map((type) => (
                <SelectItem
                  key={type}
                  value={type}
                  className="text-xs text-zinc-300 hover:text-white focus:bg-white/[0.06] focus:text-white cursor-pointer"
                >
                  {CURVE_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Active curve info */}
          {activeCurveData && activeCurveData.points.length > 2 && (
            <span className="text-[10px] text-zinc-600 tabular-nums ml-auto">
              {activeCurveData.points.length} pts
            </span>
          )}
        </div>
      </div>

      {/* ── Curve Canvas ────────────────────────────────────────────── */}
      <div className="flex-1 px-4 pb-2 min-h-0">
        {activeCurveData && (
          <CurveCanvas
            channel={activeChannel}
            curveData={activeCurveData}
            histogram={histogram}
            onAddPoint={handleAddPoint}
            onRemovePoint={handleRemovePoint}
            onMovePoint={handleMovePoint}
          />
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 py-2.5 border-t border-zinc-800/60">
        <div className="flex items-center justify-between text-[10px] text-zinc-600">
          <span>
            Click to add &middot; Drag to edit &middot; Right-click to remove
          </span>
          {activeChannelConfig && (
            <span className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: activeChannelConfig.color }}
              />
              {activeChannelConfig.label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
