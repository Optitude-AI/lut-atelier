'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/useAppStore';
import { hslToRgb } from '@/lib/colorUtils';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface MeshNode {
  id: string;
  ring: number;       // 0 = center, 1/2/3 = ring index
  index: number;      // 0 for center, 0-7 for outer rings
  branch: number;     // 0-7 angular branch (-1 = center, belongs to all)
  angleRad: number;   // home angle (radians, clockwise from top)
  radiusFrac: number; // home radius as fraction of maxR
  offsetX: number;    // pixel offset from home position
  offsetY: number;
}

interface TooltipData {
  x: number;
  y: number;
  hue: number;
  saturation: number;
  offsetX: number;
  offsetY: number;
  isDragging: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const NODE_RADIUS = 4.5;
const CENTER_RADIUS = 7;
const HIT_RADIUS = 13;
const MAX_DRAG_FRAC = 0.18;
const SIGMA = 1.8;
const TWO_PI = Math.PI * 2;
const INV_TWO_PI = 1 / TWO_PI;

// ═══════════════════════════════════════════════════════════════════════════════
// Mesh topology — 33 nodes (center + 4 rings × 8), 96 connections,
// 56 fill triangles. Ring 4 extends to 1.0 radius for full color coverage.
// ═══════════════════════════════════════════════════════════════════════════════

const INITIAL_NODES: MeshNode[] = (() => {
  const out: MeshNode[] = [];
  // Ring 0 — center
  out.push({
    id: 'ab-c', ring: 0, index: 0, branch: -1,
    angleRad: 0, radiusFrac: 0, offsetX: 0, offsetY: 0,
  });
  // Ring 1 — 8 nodes at 0.22 radius
  for (let i = 0; i < 8; i++) {
    out.push({
      id: `ab-1-${i}`, ring: 1, index: i, branch: i,
      angleRad: (i / 8) * TWO_PI, radiusFrac: 0.22,
      offsetX: 0, offsetY: 0,
    });
  }
  // Ring 2 — 8 nodes at 0.44 radius, offset by 22.5°
  for (let i = 0; i < 8; i++) {
    out.push({
      id: `ab-2-${i}`, ring: 2, index: i, branch: i,
      angleRad: (i / 8) * TWO_PI + Math.PI / 8, radiusFrac: 0.44,
      offsetX: 0, offsetY: 0,
    });
  }
  // Ring 3 — 8 nodes at 0.70 radius, same angles as Ring 1
  for (let i = 0; i < 8; i++) {
    out.push({
      id: `ab-3-${i}`, ring: 3, index: i, branch: i,
      angleRad: (i / 8) * TWO_PI, radiusFrac: 0.70,
      offsetX: 0, offsetY: 0,
    });
  }
  // Ring 4 — 8 nodes at 1.0 radius (edge), offset by 22.5°
  for (let i = 0; i < 8; i++) {
    out.push({
      id: `ab-4-${i}`, ring: 4, index: i, branch: i,
      angleRad: (i / 8) * TWO_PI + Math.PI / 8, radiusFrac: 1.0,
      offsetX: 0, offsetY: 0,
    });
  }
  return out;
})();

// Node-array index offsets
const C = 0;    // center
const R1 = 1;   // ring-1 start  (1..8)
const R2 = 9;   // ring-2 start  (9..16)
const R3 = 17;  // ring-3 start  (17..24)
const R4 = 25;  // ring-4 start  (25..32)

// ── 96 connections ─────────────────────────────────────────────────────────

const CONNS: [number, number][] = [
  // center → ring-1  (8)
  ...Array.from({ length: 8 }, (_, i) => [C, R1 + i] as [number, number]),
  // ring-1 circumferential  (8)
  ...Array.from({ length: 8 }, (_, i) => [R1 + i, R1 + (i + 1) % 8] as [number, number]),
  // ring-2 circumferential  (8)
  ...Array.from({ length: 8 }, (_, i) => [R2 + i, R2 + (i + 1) % 8] as [number, number]),
  // ring-3 circumferential  (8)
  ...Array.from({ length: 8 }, (_, i) => [R3 + i, R3 + (i + 1) % 8] as [number, number]),
  // ring-4 circumferential  (8)
  ...Array.from({ length: 8 }, (_, i) => [R4 + i, R4 + (i + 1) % 8] as [number, number]),
  // ring-1 → ring-2  (16)
  ...Array.from({ length: 8 }, (_, i) => [R1 + i, R2 + i] as [number, number]),
  ...Array.from({ length: 8 }, (_, i) => [R1 + i, R2 + (i + 7) % 8] as [number, number]),
  // ring-2 → ring-3  (16)
  ...Array.from({ length: 8 }, (_, i) => [R2 + i, R3 + i] as [number, number]),
  ...Array.from({ length: 8 }, (_, i) => [R2 + i, R3 + (i + 1) % 8] as [number, number]),
  // ring-3 → ring-4  (16)
  ...Array.from({ length: 8 }, (_, i) => [R3 + i, R4 + i] as [number, number]),
  ...Array.from({ length: 8 }, (_, i) => [R3 + i, R4 + (i + 1) % 8] as [number, number]),
];

// ── 56 fill triangles ──────────────────────────────────────────────────────

const TRIS: [number, number, number][] = [
  // center → ring-1  (8 sectors)
  ...Array.from({ length: 8 }, (_, i) => [C, R1 + i, R1 + (i + 1) % 8] as [number, number]),
  // ring-1 → ring-2  (16 triangles)
  ...Array.from({ length: 8 }, (_, i) => [R1 + i, R2 + (i + 7) % 8, R2 + i] as [number, number]),
  ...Array.from({ length: 8 }, (_, i) => [R1 + i, R2 + i, R1 + (i + 1) % 8] as [number, number]),
  // ring-2 → ring-3  (16 triangles)
  ...Array.from({ length: 8 }, (_, i) => [R2 + i, R3 + i, R3 + (i + 1) % 8] as [number, number]),
  ...Array.from({ length: 8 }, (_, i) => [R2 + i, R3 + (i + 1) % 8, R2 + (i + 1) % 8] as [number, number]),
  // ring-3 → ring-4  (16 triangles)
  ...Array.from({ length: 8 }, (_, i) => [R3 + i, R4 + i, R4 + (i + 1) % 8] as [number, number]),
  ...Array.from({ length: 8 }, (_, i) => [R3 + i, R4 + (i + 1) % 8, R3 + (i + 1) % 8] as [number, number]),
];

// ═══════════════════════════════════════════════════════════════════════════════
// Pure helpers (no closures over component state)
// ═══════════════════════════════════════════════════════════════════════════════

/** Polar (angle clockwise-from-top in rad, radius fraction) → canvas pixel. */
function polarToXY(
  angle: number,
  rFrac: number,
  cx: number,
  cy: number,
  maxR: number,
): [number, number] {
  return [
    cx + maxR * rFrac * Math.sin(angle),
    cy - maxR * rFrac * Math.cos(angle),
  ];
}

/** Canvas pixel → polar (angle, distance from center). */
function xyToPolar(x: number, y: number, cx: number, cy: number) {
  const dx = x - cx;
  const dy = -(y - cy);
  let a = Math.atan2(dx, dy);
  if (a < 0) a += TWO_PI;
  return { angle: a, dist: Math.sqrt(dx * dx + dy * dy) };
}

/** Node's current position (home + offset) in canvas pixels. */
function nodeXY(n: MeshNode, cx: number, cy: number, maxR: number): [number, number] {
  const [hx, hy] = polarToXY(n.angleRad, n.radiusFrac, cx, cy, maxR);
  return [hx + n.offsetX, hy + n.offsetY];
}

/** Node's home position (no offset) in canvas pixels. */
function homeXY(n: MeshNode, cx: number, cy: number, maxR: number): [number, number] {
  return polarToXY(n.angleRad, n.radiusFrac, cx, cy, maxR);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Get hue/saturation at a canvas position (for tooltip display). */
function hueSatAt(
  x: number,
  y: number,
  cx: number,
  cy: number,
  maxR: number,
): { hue: number; saturation: number } {
  const { angle, dist } = xyToPolar(x, y, cx, cy);
  const hue = Math.round(angle * INV_TWO_PI * 3600) / 10;
  const saturation = Math.round(clamp((dist / maxR) * 1000, 0, 1000)) / 10;
  return { hue, saturation };
}

/** Find the node index closest to (mx, my) within hit radius, or -1. */
function hitTest(
  nodes: MeshNode[],
  cx: number,
  cy: number,
  maxR: number,
  mx: number,
  my: number,
): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const [nx, ny] = nodeXY(nodes[i], cx, cy, maxR);
    const d = Math.hypot(mx - nx, my - ny);
    const hr = nodes[i].ring === 0 ? CENTER_RADIUS + 6 : HIT_RADIUS;
    if (d < hr && d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════════

export default function ABGrid({ className = '' }: { className?: string }) {
  // ── DOM refs ─────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const olRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const lastSyncRef = useRef(0);

  // ── Mutable interaction state (refs to avoid re-renders) ─────────────────
  const sizeRef = useRef({ w: 0, h: 0 });
  const nodesRef = useRef<MeshNode[]>(INITIAL_NODES.map((n) => ({ ...n })));
  const draggingRef = useRef(false);
  const dragIdxRef = useRef(-1);
  const hoverIdxRef = useRef(-1);
  const dragStartRef = useRef<{
    mx: number;
    my: number;
    bases: Float64Array;
  } | null>(null);

  // ── React state (only for tooltip + CSS-size-dependent JSX) ─────────────
  const [cssSize, setCssSize] = useState({ w: 0, h: 0 });
  const [tip, setTip] = useState<TooltipData | null>(null);

  // ── Store ───────────────────────────────────────────────────────────────
  const setSelectedNodeId = useAppStore((s) => s.setSelectedNodeId);

  /** Sync mesh node offsets → Zustand store for the pixel grading pipeline.
   *  Converts polar canvas coords + pixel offsets into store-compatible
   *  GridNode format: hue (0–360), saturation (0–100), offsetX (hue shift°),
   *  offsetY (sat shift %). */
  const syncToStore = useCallback(() => {
    const ns = nodesRef.current;
    const { w, h } = sizeRef.current;
    if (w < 1 || h < 1) return;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(cx, cy) * 0.95;
    if (maxR < 1) return;

    const storeNodes = ns.map((n) => ({
      id: n.id,
      hue: ((n.angleRad / TWO_PI) * 360 + 360) % 360,
      saturation: Math.round(n.radiusFrac * 1000) / 10,
      lightness: 50,
      // Pixel offset → colour-space offset  (scale relative to circle radius)
      offsetX: Math.round((n.offsetX / maxR) * 1800) / 10,
      offsetY: Math.round(-(n.offsetY / maxR) * 1200) / 10,
    }));

    useAppStore.getState().setABNodes(storeNodes);
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // Background canvas — redrawn only on resize
  // ══════════════════════════════════════════════════════════════════════════

  const drawBg = useCallback((w: number, h: number) => {
    const cv = bgRef.current;
    if (!cv || w < 1) return;

    const dpr = window.devicePixelRatio || 1;
    const iw = Math.round(w * dpr);
    const ih = Math.round(h * dpr);
    cv.width = iw;
    cv.height = ih;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;

    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(iw, ih);
    const d = img.data;
    const cx = iw / 2;
    const cy = ih / 2;
    const mr = Math.min(cx, cy) * 0.95;
    const mr2 = mr * mr;

    // Pixel-by-pixel hue wheel via ImageData
    for (let py = 0; py < ih; py++) {
      const dy = py - cy;
      const dy2 = dy * dy;
      for (let px = 0; px < iw; px++) {
        const dx = px - cx;
        const dist2 = dx * dx + dy2;
        const idx = (py * iw + px) << 2;

        if (dist2 <= mr2) {
          const dist = Math.sqrt(dist2);
          let a = Math.atan2(dx, -dy);
          if (a < 0) a += TWO_PI;
          const hue = a * INV_TWO_PI * 360;
          const sat = (dist / mr) * 100;
          const [r, g, b] = hslToRgb(hue, sat, 50);
          // Subtle vignette
          const vig = 1 - (dist / mr) ** 2 * 0.35;
          d[idx] = (r * vig) | 0;
          d[idx + 1] = (g * vig) | 0;
          d[idx + 2] = (b * vig) | 0;
          d[idx + 3] = 255;
        } else {
          d[idx] = 10;
          d[idx + 1] = 10;
          d[idx + 2] = 10;
          d[idx + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);

    // Grid overlay lines (drawn once on the background canvas)
    ctx.save();
    ctx.scale(dpr, dpr);
    const scx = w / 2;
    const scy = h / 2;
    const smr = Math.min(scx, scy) * 0.95;

    // 8 radial lines at 45° intervals
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TWO_PI;
      ctx.beginPath();
      ctx.moveTo(scx, scy);
      ctx.lineTo(scx + smr * Math.sin(a), scy - smr * Math.cos(a));
      ctx.stroke();
    }

    // 5 concentric circles at ring boundaries
    const radii = [0.22, 0.44, 0.70, 1.0];
    for (const rf of radii) {
      ctx.beginPath();
      ctx.arc(scx, scy, smr * rf, 0, TWO_PI);
      ctx.stroke();
    }

    ctx.restore();
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // Overlay canvas — redrawn on every interaction
  // ══════════════════════════════════════════════════════════════════════════

  const drawOl = useCallback(() => {
    const cv = olRef.current;
    if (!cv) return;
    const { w, h } = sizeRef.current;
    if (w < 1) return;

    const dpr = window.devicePixelRatio || 1;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const ns = nodesRef.current;
    const cx = w / 2;
    const cy = h / 2;
    const mr = Math.min(cx, cy) * 0.95;
    const di = dragIdxRef.current;
    const hi = hoverIdxRef.current;
    const isDrag = draggingRef.current;
    const selId = useAppStore.getState().selectedNodeId;
    const helpers = useAppStore.getState().showNodeHelpers;

    // Pre-compute positions
    const pos = ns.map((n) => nodeXY(n, cx, cy, mr));
    const hom = ns.map((n) => homeXY(n, cx, cy, mr));

    // 1. ── Mesh fill (40 triangles) ──────────────────────────────────────
    for (const [ai, bi, ci] of TRIS) {
      const ax = pos[ai][0], ay = pos[ai][1];
      const bx = pos[bi][0], by = pos[bi][1];
      const ccx = pos[ci][0], ccy = pos[ci][1];

      // Centroid color
      const mx = (ax + bx + ccx) / 3;
      const my = (ay + by + ccy) / 3;
      const { hue, saturation: sat } = hueSatAt(mx, my, cx, cy, mr);
      const [r, g, b] = hslToRgb(hue, sat, 50);

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(ccx, ccy);
      ctx.closePath();
      ctx.fillStyle = `rgba(${r},${g},${b},0.15)`;
      ctx.fill();
    }

    // 2. ── Mesh connections (64 lines) ───────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.75;
    for (const [ai, bi] of CONNS) {
      ctx.beginPath();
      ctx.moveTo(pos[ai][0], pos[ai][1]);
      ctx.lineTo(pos[bi][0], pos[bi][1]);
      ctx.stroke();
    }

    // 3. ── Helper lines (home → current when offset exists) ──────────────
    if (helpers) {
      for (let i = 0; i < ns.length; i++) {
        if (ns[i].offsetX === 0 && ns[i].offsetY === 0) continue;
        const isSel = ns[i].id === selId;
        ctx.beginPath();
        ctx.moveTo(hom[i][0], hom[i][1]);
        ctx.lineTo(pos[i][0], pos[i][1]);
        ctx.strokeStyle = isSel
          ? 'rgba(255,255,255,0.7)'
          : 'rgba(255,255,255,0.35)';
        ctx.lineWidth = isSel ? 1.5 : 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Home position dot
        ctx.beginPath();
        ctx.arc(hom[i][0], hom[i][1], 2.5, 0, TWO_PI);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fill();
      }
    }

    // 4. ── Nodes (25 total) ──────────────────────────────────────────────
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i];
      const nx = pos[i][0];
      const ny = pos[i][1];
      const isCenter = n.ring === 0;
      const isSel = n.id === selId;
      const isHov = i === hi;
      const isDrg = i === di && isDrag;
      const hasOff = n.offsetX !== 0 || n.offsetY !== 0;
      const baseR = isCenter ? CENTER_RADIUS : NODE_RADIUS;
      const r = isDrg ? baseR + 1.5 : baseR;

      // Glow
      const needsGlow = isSel || isHov || isDrg || isCenter;
      if (needsGlow) {
        const gr = r + 8;
        ctx.beginPath();
        ctx.arc(nx, ny, gr, 0, TWO_PI);
        const gd = ctx.createRadialGradient(nx, ny, r, nx, ny, gr);
        if (isDrg) {
          gd.addColorStop(0, 'rgba(255,255,255,0.3)');
          gd.addColorStop(1, 'rgba(255,255,255,0)');
        } else if (isSel || isCenter) {
          gd.addColorStop(0, 'rgba(255,191,64,0.5)');
          gd.addColorStop(1, 'rgba(255,191,64,0)');
        } else {
          // Hovered
          gd.addColorStop(0, 'rgba(255,255,255,0.3)');
          gd.addColorStop(1, 'rgba(255,255,255,0)');
        }
        ctx.fillStyle = gd;
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, TWO_PI);
      ctx.fillStyle = isSel ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Inner offset dot
      if (hasOff && !isCenter) {
        ctx.beginPath();
        ctx.arc(nx, ny, 2, 0, TWO_PI);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fill();
      }
    }
  }, []);

  /** Schedule an overlay redraw via requestAnimationFrame (debounced). */
  const sched = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(drawOl);
  }, [drawOl]);

  // ══════════════════════════════════════════════════════════════════════════
  // Resize handling
  // ══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        const h = Math.floor(entry.contentRect.height);
        if (w < 1 || h < 1) continue;

        sizeRef.current = { w, h };
        setCssSize({ w, h });

        // Cancel any in-progress drag on resize
        draggingRef.current = false;
        dragIdxRef.current = -1;
        dragStartRef.current = null;
        setTip(null);

        // Clamp offsets to new max distance
        const md = w * MAX_DRAG_FRAC;
        const ns = nodesRef.current;
        for (let i = 0; i < ns.length; i++) {
          ns[i] = {
            ...ns[i],
            offsetX: clamp(ns[i].offsetX, -md, md),
            offsetY: clamp(ns[i].offsetY, -md, md),
          };
        }

        // Redraw background at new size
        drawBg(w, h);

        syncToStore();

        // Size the overlay canvas
        const ol = olRef.current;
        if (ol) {
          const dpr = window.devicePixelRatio || 1;
          ol.width = w * dpr;
          ol.height = h * dpr;
          ol.style.width = `${w}px`;
          ol.style.height = `${h}px`;
        }

        sched();
      }
    });

    obs.observe(el);
    return () => {
      obs.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [drawBg, sched]);

  // ══════════════════════════════════════════════════════════════════════════
  // Subscribe to store changes that affect overlay rendering
  // ══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const unsub = useAppStore.subscribe((s, p) => {
      if (
        s.selectedNodeId !== p.selectedNodeId ||
        s.showNodeHelpers !== p.showNodeHelpers
      ) {
        sched();
      }
    });
    return unsub;
  }, [sched]);

  /** Throttled version of syncToStore — fires at most every 16ms (~60fps) during drag. */
  const throttledSync = useCallback(() => {
    const now = performance.now();
    if (now - lastSyncRef.current < 16) return;
    lastSyncRef.current = now;
    syncToStore();
  }, [syncToStore]);

  // ══════════════════════════════════════════════════════════════════════════
  // Global mouseup — properly end drag even if pointer leaves the canvas
  // ══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const onGlobalUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        dragIdxRef.current = -1;
        dragStartRef.current = null;
        syncToStore();
        sched();
      }
    };
    window.addEventListener('mouseup', onGlobalUp);
    return () => window.removeEventListener('mouseup', onGlobalUp);
  }, [sched]);

  // ══════════════════════════════════════════════════════════════════════════
  // Mouse helpers
  // ══════════════════════════════════════════════════════════════════════════

  const mouseXY = useCallback(
    (e: React.MouseEvent) => {
      const rect = olRef.current?.getBoundingClientRect();
      return rect
        ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
        : { x: 0, y: 0 };
    },
    [],
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Mouse event handlers
  // ══════════════════════════════════════════════════════════════════════════

  const onDown = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = mouseXY(e);
      const { w, h } = sizeRef.current;
      const cx = w / 2;
      const cy = h / 2;
      const mr = Math.min(cx, cy) * 0.95;
      const idx = hitTest(nodesRef.current, cx, cy, mr, x, y);

      if (idx < 0) {
        setSelectedNodeId(null);
        setTip(null);
        return;
      }

      const n = nodesRef.current[idx];
      setSelectedNodeId(n.id);
      draggingRef.current = true;
      dragIdxRef.current = idx;

      // Snapshot every node's current offset as the drag base
      const ns = nodesRef.current;
      const bases = new Float64Array(ns.length * 2);
      for (let i = 0; i < ns.length; i++) {
        bases[i * 2] = ns[i].offsetX;
        bases[i * 2 + 1] = ns[i].offsetY;
      }
      dragStartRef.current = { mx: x, my: y, bases };

      // Show tooltip at drag start
      const [nx, ny] = nodeXY(n, cx, cy, mr);
      const hs = hueSatAt(nx, ny, cx, cy, mr);
      setTip({
        x,
        y,
        hue: hs.hue,
        saturation: hs.saturation,
        offsetX: n.offsetX,
        offsetY: n.offsetY,
        isDragging: true,
      });

      olRef.current?.style.setProperty('cursor', 'grabbing');
      sched();
    },
    [mouseXY, setSelectedNodeId, sched],
  );

  const onMove = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = mouseXY(e);
      const { w, h } = sizeRef.current;
      const cx = w / 2;
      const cy = h / 2;
      const mr = Math.min(cx, cy) * 0.95;
      const md = w * MAX_DRAG_FRAC;

      if (draggingRef.current && dragIdxRef.current >= 0 && dragStartRef.current) {
        // ── Dragging ────────────────────────────────────────────────────
        const di = dragIdxRef.current;
        const st = dragStartRef.current;
        const ns = nodesRef.current;
        const dx = x - st.mx;
        const dy = y - st.my;

        // Clamped offset for the dragged node
        const newOx = clamp(st.bases[di * 2] + dx, -md, md);
        const newOy = clamp(st.bases[di * 2 + 1] + dy, -md, md);
        ns[di] = { ...ns[di], offsetX: newOx, offsetY: newOy };

        // Effective delta (may differ from raw dx/dy due to clamping)
        const edx = newOx - st.bases[di * 2];
        const edy = newOy - st.bases[di * 2 + 1];

        if (ns[di].ring === 0) {
          // Center node → affects ALL branches with ring-distance falloff
          for (let i = 1; i < ns.length; i++) {
            const rd = ns[i].ring;
            const f = Math.exp(-(rd * rd) / (2 * SIGMA * SIGMA));
            ns[i] = {
              ...ns[i],
              offsetX: clamp(st.bases[i * 2] + edx * f, -md, md),
              offsetY: clamp(st.bases[i * 2 + 1] + edy * f, -md, md),
            };
          }
        } else {
          // Branch node → affects same-branch nodes + center
          const branch = ns[di].branch;
          for (let i = 0; i < ns.length; i++) {
            if (i === di) continue;
            const n = ns[i];
            let rd: number;
            let affect: boolean;
            if (n.ring === 0) {
              rd = ns[di].ring; // center is at ring distance = dragged ring
              affect = true;
            } else if (n.branch === branch) {
              rd = Math.abs(n.ring - ns[di].ring);
              affect = true;
            } else {
              affect = false;
              rd = 0;
            }
            if (affect) {
              const f = Math.exp(-(rd * rd) / (2 * SIGMA * SIGMA));
              ns[i] = {
                ...ns[i],
                offsetX: clamp(st.bases[i * 2] + edx * f, -md, md),
                offsetY: clamp(st.bases[i * 2 + 1] + edy * f, -md, md),
              };
            }
          }
        }

        // Update tooltip
        const hs = hueSatAt(x, y, cx, cy, mr);
        setTip({
          x,
          y,
          hue: hs.hue,
          saturation: hs.saturation,
          offsetX: Math.round(newOx * 10) / 10,
          offsetY: Math.round(newOy * 10) / 10,
          isDragging: true,
        });

        throttledSync();
        sched();
      } else {
        // ── Hovering ────────────────────────────────────────────────────
        const idx = hitTest(nodesRef.current, cx, cy, mr, x, y);
        hoverIdxRef.current = idx;

        if (idx >= 0) {
          const n = nodesRef.current[idx];
          const [nx, ny] = nodeXY(n, cx, cy, mr);
          const hs = hueSatAt(nx, ny, cx, cy, mr);
          setTip({
            x,
            y,
            hue: hs.hue,
            saturation: hs.saturation,
            offsetX: Math.round(n.offsetX * 10) / 10,
            offsetY: Math.round(n.offsetY * 10) / 10,
            isDragging: false,
          });
          olRef.current?.style.setProperty('cursor', 'grab');
        } else {
          setTip(null);
          olRef.current?.style.setProperty('cursor', 'default');
        }

        sched();
      }
    },
    [mouseXY, sched, throttledSync],
  );

  const onUp = useCallback(() => {
    if (draggingRef.current) {
      draggingRef.current = false;
      dragIdxRef.current = -1;
      dragStartRef.current = null;
      syncToStore();
      olRef.current?.style.setProperty('cursor', 'grab');
    }
  }, []);

  const onLeave = useCallback(() => {
    hoverIdxRef.current = -1;
    setTip(null);
    if (draggingRef.current) {
      draggingRef.current = false;
      dragIdxRef.current = -1;
      dragStartRef.current = null;
    }
    olRef.current?.style.setProperty('cursor', 'default');
    sched();
  }, [sched]);

  const onDbl = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = mouseXY(e);
      const { w, h } = sizeRef.current;
      const cx = w / 2;
      const cy = h / 2;
      const mr = Math.min(cx, cy) * 0.95;
      const idx = hitTest(nodesRef.current, cx, cy, mr, x, y);
      if (idx < 0) return;

      const ns = nodesRef.current;
      const n = ns[idx];

      if (n.ring === 0) {
        // Center → reset all 25 nodes
        for (let i = 0; i < ns.length; i++) {
          ns[i] = { ...ns[i], offsetX: 0, offsetY: 0 };
        }
      } else {
        // Reset entire branch (center + all same-branch nodes)
        for (let i = 0; i < ns.length; i++) {
          if (ns[i].ring === 0 || ns[i].branch === n.branch) {
            ns[i] = { ...ns[i], offsetX: 0, offsetY: 0 };
          }
        }
      }

      syncToStore();
      sched();
    },
    [mouseXY, sched],
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <motion.div
      className={`relative overflow-hidden rounded-xl border border-white/[0.08] bg-neutral-950 shadow-2xl shadow-black/40 ${className}`}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-amber-400/80" />
          <span className="text-[11px] font-medium tracking-wider text-white/40 uppercase">
            Hue / Saturation
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-white/25">
          <span>Drag nodes to adjust</span>
          <span className="text-white/10">|</span>
          <span>Dbl-click to reset branch</span>
        </div>
      </div>

      {/* ── Canvas container ─────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="relative aspect-square w-full"
        style={{ minHeight: 250 }}
      >
        {/* Background canvas — hue wheel + grid (redrawn only on resize) */}
        <canvas
          ref={bgRef}
          className="absolute inset-0 rounded-b-[11px]"
          style={{ display: 'block' }}
        />

        {/* Overlay canvas — mesh, nodes, helpers (redrawn on interaction) */}
        <canvas
          ref={olRef}
          className="absolute inset-0 rounded-b-[11px]"
          style={{ display: 'block' }}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onLeave}
          onDoubleClick={onDbl}
        />

        {/* ── Tooltip ────────────────────────────────────────────────────── */}
        {tip && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-white/10 bg-neutral-900/90 px-2.5 py-1.5 text-[10px] text-white/70 shadow-lg backdrop-blur-sm"
            style={{
              left: Math.min(tip.x + 16, cssSize.w - 150),
              top: Math.max(tip.y - 52, 4),
            }}
          >
            <div className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-sm border border-white/20"
                style={{
                  backgroundColor: `hsl(${tip.hue}, ${tip.saturation}%, 50%)`,
                }}
              />
              <span className="font-medium text-white/90">
                H: {Math.round(tip.hue)}° S: {Math.round(tip.saturation)}%
              </span>
            </div>
            {(Math.abs(tip.offsetX) > 0.1 || Math.abs(tip.offsetY) > 0.1) && (
              <div className="mt-0.5 pl-5 text-white/40">
                Offset: {tip.offsetX.toFixed(1)} / {tip.offsetY.toFixed(1)}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
