'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { isSkinToneHue } from '@/lib/colorUtils';

interface ScopesPanelProps {
  className?: string;
}

// ─────────────────────────────────────────────
// Demo Data Generators
// ─────────────────────────────────────────────

function gaussian(x: number, mean: number, stddev: number): number {
  const exponent = -0.5 * Math.pow((x - mean) / stddev, 2);
  return Math.exp(exponent) / (stddev * Math.sqrt(2 * Math.PI));
}

function generateDemoHistogram(): { r: number[]; g: number[]; b: number[]; luma: number[] } {
  const r = new Array(256).fill(0);
  const g = new Array(256).fill(0);
  const b = new Array(256).fill(0);
  const luma = new Array(256).fill(0);

  for (let i = 0; i < 256; i++) {
    // R channel: strong peak in highlights + midtone base
    r[i] = Math.round(
      gaussian(i, 60, 40) * 280 +
      gaussian(i, 190, 35) * 350 +
      gaussian(i, 240, 20) * 200 +
      gaussian(i, 15, 12) * 80
    );
    // G channel: broad midtone peak + highlight contribution
    g[i] = Math.round(
      gaussian(i, 45, 35) * 220 +
      gaussian(i, 130, 50) * 400 +
      gaussian(i, 210, 30) * 180 +
      gaussian(i, 250, 15) * 120
    );
    // B channel: shadow/midtone peak, less in highlights
    b[i] = Math.round(
      gaussian(i, 30, 30) * 250 +
      gaussian(i, 90, 40) * 200 +
      gaussian(i, 170, 45) * 150 +
      gaussian(i, 235, 25) * 90
    );
    // Luminance: computed from weighted sum of channels
    luma[i] = Math.round(0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i]);
  }

  return { r, g, b, luma };
}

interface VectorscopePoint {
  u: number;
  v: number;
  r: number;
  g: number;
  b: number;
  count: number;
}

function generateDemoVectorscope(): VectorscopePoint[] {
  const points: VectorscopePoint[] = [];
  const rng = (seed: number) => {
    let s = seed;
    return () => {
      s = (s * 16807 + 0) % 2147483647;
      return (s - 1) / 2147483646;
    };
  };

  const rand = rng(42);

  // Skin tone cluster (warm, moderate saturation)
  for (let i = 0; i < 800; i++) {
    const u = -8 + rand() * 14;
    const v = 10 + rand() * 16;
    const dist = Math.sqrt(u * u + v * v);
    if (dist < 50) {
      const intensity = 0.7 + rand() * 0.3;
      const r = Math.round(180 + rand() * 60);
      const g = Math.round(110 + rand() * 50);
      const b = Math.round(70 + rand() * 40);
      points.push({ u, v, r, g, b, count: Math.round(intensity * 3) });
    }
  }

  // Blue/cyan region (sky)
  for (let i = 0; i < 500; i++) {
    const u = -5 + rand() * 20;
    const v = -20 + rand() * 10;
    const dist = Math.sqrt(u * u + v * v);
    if (dist < 50) {
      const r = Math.round(40 + rand() * 40);
      const g = Math.round(80 + rand() * 60);
      const b = Math.round(160 + rand() * 80);
      points.push({ u, v, r, g, b, count: Math.round(1 + rand() * 3) });
    }
  }

  // Green region (foliage)
  for (let i = 0; i < 400; i++) {
    const u = -20 + rand() * 10;
    const v = -5 + rand() * 15;
    const dist = Math.sqrt(u * u + v * v);
    if (dist < 50) {
      const r = Math.round(30 + rand() * 40);
      const g = Math.round(120 + rand() * 80);
      const b = Math.round(30 + rand() * 40);
      points.push({ u, v, r, g, b, count: Math.round(1 + rand() * 3) });
    }
  }

  // Desaturated center cluster
  for (let i = 0; i < 300; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = rand() * 8;
    const u = Math.cos(angle) * radius;
    const v = Math.sin(angle) * radius;
    const base = Math.round(80 + rand() * 90);
    points.push({ u, v, r: base, g: base, b: base, count: Math.round(1 + rand() * 2) });
  }

  return points;
}

function generateDemoParade(): { r: number[][]; g: number[][]; b: number[][] } {
  const width = 512;
  const height = 256;
  const rng = (seed: number) => {
    let s = seed;
    return () => {
      s = (s * 16807 + 0) % 2147483647;
      return (s - 1) / 2147483646;
    };
  };

  const rand = rng(123);
  const rand2 = rng(456);
  const rand3 = rng(789);

  const r: number[][] = Array.from({ length: width }, () => new Array(height).fill(0));
  const g: number[][] = Array.from({ length: width }, () => new Array(height).fill(0));
  const b: number[][] = Array.from({ length: width }, () => new Array(height).fill(0));

  // Generate a realistic waveform: varying brightness across width
  for (let x = 0; x < width; x++) {
    // Create a waveform that simulates a photo with varying luminance
    const baseLuminance =
      0.3 + 0.2 * Math.sin(x * 0.02) + 0.15 * Math.sin(x * 0.05 + 1) + 0.1 * Math.sin(x * 0.11 + 2);

    for (let y = 0; y < height; y++) {
      const yNorm = 1 - y / height; // 0 at bottom, 1 at top

      // R waveform
      const rPeak = baseLuminance * (0.7 + rand() * 0.3) * 0.95 + 0.05;
      r[x][y] = Math.abs(yNorm - rPeak) < 0.015 ? 1 : 0;

      // G waveform  
      const gPeak = baseLuminance * (0.8 + rand2() * 0.2) * 0.9 + 0.08;
      g[x][y] = Math.abs(yNorm - gPeak) < 0.015 ? 1 : 0;

      // B waveform
      const bPeak = baseLuminance * (0.6 + rand3() * 0.4) * 0.85 + 0.1;
      b[x][y] = Math.abs(yNorm - bPeak) < 0.015 ? 1 : 0;
    }
  }

  return { r, g, b };
}

// ─────────────────────────────────────────────
// Canvas Drawing Utilities
// ─────────────────────────────────────────────

function setupCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  return ctx;
}

// ─────────────────────────────────────────────
// RGB Histogram Renderer
// ─────────────────────────────────────────────

function drawRGBHistogram(
  canvas: HTMLCanvasElement,
  data: { r: number[]; g: number[]; b: number[]; luma: number[] }
) {
  const rect = canvas.parentElement?.getBoundingClientRect();
  if (!rect) return;

  const w = rect.width;
  const h = rect.height;
  const ctx = setupCanvas(canvas, w, h);
  if (!ctx) return;

  const padding = { top: 16, right: 12, bottom: 28, left: 12 };
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  // Clear
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();
  }
  for (let i = 0; i <= 8; i++) {
    const x = padding.left + (plotW / 8) * i;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, h - padding.bottom);
    ctx.stroke();
  }

  // Find max value for scaling
  const maxVal = Math.max(
    ...data.r.slice(1, 254),
    ...data.g.slice(1, 254),
    ...data.b.slice(1, 254),
    ...data.luma.slice(1, 254)
  );

  // Draw filled curves for each channel
  const channels = [
    { data: data.b, color: 'rgba(60, 120, 255, 0.45)', strokeColor: 'rgba(60, 120, 255, 0.8)' },
    { data: data.g, color: 'rgba(40, 210, 80, 0.45)', strokeColor: 'rgba(40, 210, 80, 0.8)' },
    { data: data.r, color: 'rgba(255, 60, 60, 0.45)', strokeColor: 'rgba(255, 60, 60, 0.8)' },
  ];

  for (const channel of channels) {
    ctx.beginPath();
    ctx.moveTo(padding.left, h - padding.bottom);

    for (let i = 0; i < 256; i++) {
      const x = padding.left + (i / 255) * plotW;
      const val = channel.data[i] / maxVal;
      const y = h - padding.bottom - val * plotH;
      if (i === 0) {
        ctx.lineTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.lineTo(padding.left + plotW, h - padding.bottom);
    ctx.closePath();
    ctx.fillStyle = channel.color;
    ctx.fill();

    // Stroke on top
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = padding.left + (i / 255) * plotW;
      const val = channel.data[i] / maxVal;
      const y = h - padding.bottom - val * plotH;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = channel.strokeColor;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // Luminance overlay line
  ctx.beginPath();
  for (let i = 0; i < 256; i++) {
    const x = padding.left + (i / 255) * plotW;
    const val = data.luma[i] / maxVal;
    const y = h - padding.bottom - val * plotH;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Axis labels
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('0', padding.left, h - padding.bottom + 16);
  ctx.fillText('64', padding.left + plotW * 0.25, h - padding.bottom + 16);
  ctx.fillText('128', padding.left + plotW * 0.5, h - padding.bottom + 16);
  ctx.fillText('192', padding.left + plotW * 0.75, h - padding.bottom + 16);
  ctx.fillText('255', padding.left + plotW, h - padding.bottom + 16);

  // Channel legend
  const legendX = w - padding.right - 140;
  const legendY = padding.top + 12;
  const legendItems = [
    { label: 'R', color: 'rgba(255, 60, 60, 0.9)' },
    { label: 'G', color: 'rgba(40, 210, 80, 0.9)' },
    { label: 'B', color: 'rgba(60, 120, 255, 0.9)' },
    { label: 'Luma', color: 'rgba(255, 255, 255, 0.7)' },
  ];
  legendItems.forEach((item, idx) => {
    const x = legendX + idx * 36;
    ctx.fillStyle = item.color;
    ctx.fillRect(x, legendY, 8, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(item.label, x + 11, legendY + 8);
  });

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

// ─────────────────────────────────────────────
// Vectorscope Renderer
// ─────────────────────────────────────────────

function drawVectorscope(canvas: HTMLCanvasElement, points: VectorscopePoint[]) {
  const rect = canvas.parentElement?.getBoundingClientRect();
  if (!rect) return;

  const w = rect.width;
  const h = rect.height;
  const ctx = setupCanvas(canvas, w, h);
  if (!ctx) return;

  const padding = 32;
  const centerX = w / 2;
  const centerY = h / 2;
  const maxRadius = Math.min(w, h) / 2 - padding;
  const scale = maxRadius / 55; // Scale factor: 55 units = full radius

  // Clear
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, w, h);

  // Draw color wheel ring
  const wheelRadius = maxRadius + 4;
  const wheelWidth = 6;
  for (let angle = 0; angle < 360; angle += 1) {
    const startAngle = ((angle - 90) * Math.PI) / 180;
    const endAngle = ((angle - 89) * Math.PI) / 180;

    ctx.beginPath();
    ctx.arc(centerX, centerY, wheelRadius, startAngle, endAngle);
    ctx.lineWidth = wheelWidth;

    // Convert YUV angle to approximate color
    const rad = ((angle) * Math.PI) / 180;
    const u = Math.cos(rad) * 0.6;
    const v = Math.sin(rad) * 0.6;
    const y = 0.5;
    const r = Math.min(255, Math.max(0, Math.round((y + 1.14 * v) * 255)));
    const g = Math.min(255, Math.max(0, Math.round((y - 0.395 * u - 0.581 * v) * 255)));
    const b = Math.min(255, Math.max(0, Math.round((y + 2.033 * u) * 255)));

    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.stroke();
  }

  // Concentric circles (25%, 50%, 75%, 100%)
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (const pct of [0.25, 0.5, 0.75, 1.0]) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, maxRadius * pct, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Crosshairs
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.moveTo(centerX - maxRadius, centerY);
  ctx.lineTo(centerX + maxRadius, centerY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - maxRadius);
  ctx.lineTo(centerX, centerY + maxRadius);
  ctx.stroke();

  // Axis labels
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('U+', centerX + maxRadius + 12, centerY + 4);
  ctx.fillText('U−', centerX - maxRadius - 12, centerY + 4);
  ctx.fillText('V+', centerX, centerY - maxRadius - 8);
  ctx.fillText('V−', centerX, centerY + maxRadius + 14);

  // Skin tone line
  // Skin tone falls roughly in the I (in-phase) quadrant
  // In YUV space: roughly U ≈ -5 to +5, V ≈ +10 to +22
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 200, 140, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  const skinStartU = -12;
  const skinStartV = 6;
  const skinEndU = 12;
  const skinEndV = 30;
  ctx.moveTo(
    centerX + skinStartU * scale,
    centerY - skinStartV * scale
  );
  ctx.lineTo(
    centerX + skinEndU * scale,
    centerY - skinEndV * scale
  );
  ctx.stroke();
  ctx.setLineDash([]);

  // Skin tone label
  ctx.fillStyle = 'rgba(255, 200, 140, 0.5)';
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('SKIN', centerX + skinEndU * scale + 4, centerY - skinEndV * scale + 3);
  ctx.restore();

  // Draw scatter points
  for (const point of points) {
    const px = centerX + point.u * scale;
    const py = centerY - point.v * scale;
    const size = 1 + point.count * 0.3;
    const alpha = 0.15 + Math.min(0.5, point.count * 0.08);

    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${point.r}, ${point.g}, ${point.b}, ${alpha})`;
    ctx.fill();
  }

  // Outer border
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

// ─────────────────────────────────────────────
// RGB Parade Renderer
// ─────────────────────────────────────────────

function drawRGBParade(
  canvas: HTMLCanvasElement,
  data: { r: number[][]; g: number[][]; b: number[][] }
) {
  const rect = canvas.parentElement?.getBoundingClientRect();
  if (!rect) return;

  const w = rect.width;
  const h = rect.height;
  const ctx = setupCanvas(canvas, w, h);
  if (!ctx) return;

  const padding = { top: 16, right: 8, bottom: 24, left: 8 };
  const gap = 6;
  const totalGaps = gap * 2;
  const channelWidth = (w - padding.left - padding.right - totalGaps) / 3;
  const plotH = h - padding.top - padding.bottom;

  // Clear
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, w, h);

  const channels: { data: number[][]; color: string; fillColor: string; label: string }[] = [
    { data: data.r, color: 'rgba(255, 60, 60, 0.9)', fillColor: 'rgba(255, 60, 60, 0.3)', label: 'R' },
    { data: data.g, color: 'rgba(40, 210, 80, 0.9)', fillColor: 'rgba(40, 210, 80, 0.3)', label: 'G' },
    { data: data.b, color: 'rgba(60, 120, 255, 0.9)', fillColor: 'rgba(60, 120, 255, 0.3)', label: 'B' },
  ];

  channels.forEach((channel, chIdx) => {
    const offsetX = padding.left + chIdx * (channelWidth + gap);

    // Channel background
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(offsetX, padding.top, channelWidth, plotH);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(offsetX, y);
      ctx.lineTo(offsetX + channelWidth, y);
      ctx.stroke();
    }
    // IRE markers (0%, 25%, 50%, 75%, 100%)
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (plotH / 4) * i;
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '8px ui-monospace, monospace';
      ctx.textAlign = 'right';
      if (chIdx === 0) {
        ctx.fillText(`${100 - i * 25}`, offsetX - 3, y + 3);
      }
    }

    // Vertical grid
    const vLines = 8;
    for (let i = 0; i <= vLines; i++) {
      const x = offsetX + (channelWidth / vLines) * i;
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + plotH);
      ctx.stroke();
    }

    // Draw waveform using ImageData for performance
    const imgData = ctx.createImageData(Math.ceil(channelWidth), Math.ceil(plotH));
    const pixels = imgData.data;
    const dataW = channel.data.length;
    const dataH = channel.data[0]?.length || 0;

    // Parse the fill color for RGB values
    let fillR = 255, fillG = 60, fillB = 60;
    if (chIdx === 1) { fillR = 40; fillG = 210; fillB = 80; }
    if (chIdx === 2) { fillR = 60; fillG = 120; fillB = 255; }

    for (let py = 0; py < plotH; py++) {
      for (let px = 0; px < channelWidth; px++) {
        const dataX = Math.floor((px / channelWidth) * dataW);
        const dataY = Math.floor((py / plotH) * dataH);

        if (dataX < dataW && dataY < dataH && channel.data[dataX][dataY] > 0) {
          const idx = (py * Math.ceil(channelWidth) + px) * 4;
          // Glow effect: brighter near the waveform center
          pixels[idx] = fillR;
          pixels[idx + 1] = fillG;
          pixels[idx + 2] = fillB;
          pixels[idx + 3] = 180;
        }
      }
    }

    ctx.putImageData(imgData, offsetX, padding.top);

    // Draw a brighter center line for the waveform
    ctx.beginPath();
    const dataW2 = channel.data.length;
    for (let x = 0; x < channelWidth; x++) {
      const dataX = Math.floor((x / channelWidth) * dataW2);
      if (dataX >= dataW2) continue;

      // Find the peak Y value (brightest point)
      const col = channel.data[dataX];
      let peakY = -1;
      for (let y = 0; y < col.length; y++) {
        if (col[y] > 0) {
          if (peakY === -1 || y < peakY) peakY = y;
        }
      }
      if (peakY >= 0) {
        const canvasY = padding.top + (peakY / (col.length - 1)) * plotH;
        if (x === 0 || peakY === -1) {
          ctx.moveTo(offsetX + x, canvasY);
        } else {
          ctx.lineTo(offsetX + x, canvasY);
        }
      }
    }
    ctx.strokeStyle = channel.color;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Channel separator
    if (chIdx < 2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const sepX = offsetX + channelWidth + gap / 2;
      ctx.moveTo(sepX, padding.top);
      ctx.lineTo(sepX, padding.top + plotH);
      ctx.stroke();
    }

    // Channel label
    ctx.fillStyle = channel.color;
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(channel.label, offsetX + channelWidth / 2, h - padding.bottom + 16);
  });

  // Outer border
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

// ─────────────────────────────────────────────
// Individual Scope Canvas Wrapper
// ─────────────────────────────────────────────

interface ScopeCanvasProps {
  drawFn: (canvas: HTMLCanvasElement) => void;
  active: boolean;
}

function ScopeCanvas({ drawFn, active }: ScopeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const draw = useCallback(() => {
    if (!canvasRef.current || !active) return;
    drawFn(canvasRef.current);
  }, [drawFn, active]);

  useEffect(() => {
    if (!active) return;

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    // Initial draw
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [draw, active]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-0"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Scopes Panel Component
// ─────────────────────────────────────────────

export default function ScopesPanel({ className }: ScopesPanelProps) {
  const [activeTab, setActiveTab] = useState('histogram');

  // Generate demo data once
  const histogramData = useRef(generateDemoHistogram());
  const vectorscopeData = useRef(generateDemoVectorscope());
  const paradeData = useRef(generateDemoParade());

  // Memoize draw functions
  const drawHistogram = useCallback(
    (canvas: HTMLCanvasElement) => drawRGBHistogram(canvas, histogramData.current),
    []
  );

  const renderVectorscope = useCallback(
    (canvas: HTMLCanvasElement) => drawVectorscope(canvas, vectorscopeData.current),
    []
  );

  const renderParade = useCallback(
    (canvas: HTMLCanvasElement) => drawRGBParade(canvas, paradeData.current),
    []
  );

  const tabVariants = {
    hidden: { opacity: 0, y: 4 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
  };

  return (
    <div className={`flex flex-col h-full ${className || ''}`}>
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-col h-full"
      >
        {/* Tab Header */}
        <div className="shrink-0 px-3 pt-3 pb-1">
          <TabsList className="bg-[#1a1a1a] border border-[rgba(255,255,255,0.06)] h-8 rounded-md">
            <TabsTrigger
              value="histogram"
              className="text-[11px] font-medium tracking-wide px-3 h-7 rounded-[5px] data-[state=active]:bg-[#2a2a2a] data-[state=active]:text-white text-[rgba(255,255,255,0.45)] data-[state=active]:shadow-none transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <svg width="12" height="10" viewBox="0 0 12 10" fill="none" className="opacity-60">
                  <path d="M0 10V6L3 8L5 2L7 5L9 1L12 4V10H0Z" fill="currentColor" />
                </svg>
                Histogram
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="vectorscope"
              className="text-[11px] font-medium tracking-wide px-3 h-7 rounded-[5px] data-[state=active]:bg-[#2a2a2a] data-[state=active]:text-white text-[rgba(255,255,255,0.45)] data-[state=active]:shadow-none transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="opacity-60">
                  <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  <circle cx="6" cy="6" r="1" fill="currentColor" />
                </svg>
                Vectorscope
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="parade"
              className="text-[11px] font-medium tracking-wide px-3 h-7 rounded-[5px] data-[state=active]:bg-[#2a2a2a] data-[state=active]:text-white text-[rgba(255,255,255,0.45)] data-[state=active]:shadow-none transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <svg width="14" height="10" viewBox="0 0 14 10" fill="none" className="opacity-60">
                  <rect x="0" y="0" width="3.5" height="10" rx="0.5" fill="currentColor" opacity="0.5" />
                  <rect x="5" y="0" width="3.5" height="10" rx="0.5" fill="currentColor" opacity="0.5" />
                  <rect x="10" y="0" width="3.5" height="10" rx="0.5" fill="currentColor" opacity="0.5" />
                </svg>
                RGB Parade
              </span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Scope Content */}
        <div className="flex-1 min-h-0 p-3 pt-1">
          <AnimatePresence mode="wait">
            {activeTab === 'histogram' && (
              <motion.div
                key="histogram"
                variants={tabVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="w-full h-full rounded-lg overflow-hidden border border-[rgba(255,255,255,0.06)]"
              >
                <ScopeCanvas drawFn={drawHistogram} active={true} />
              </motion.div>
            )}

            {activeTab === 'vectorscope' && (
              <motion.div
                key="vectorscope"
                variants={tabVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="w-full h-full rounded-lg overflow-hidden border border-[rgba(255,255,255,0.06)]"
              >
                <ScopeCanvas drawFn={renderVectorscope} active={true} />
              </motion.div>
            )}

            {activeTab === 'parade' && (
              <motion.div
                key="parade"
                variants={tabVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="w-full h-full rounded-lg overflow-hidden border border-[rgba(255,255,255,0.06)]"
              >
                <ScopeCanvas drawFn={renderParade} active={true} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Tabs>
    </div>
  );
}
