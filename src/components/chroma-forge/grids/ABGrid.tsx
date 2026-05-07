'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/useAppStore';
import { oklabToRGB8 } from '@/lib/oklab';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface MeshNode {
  id: string;
  ring: number;       // 0 = center, 1–4 = ring index
  index: number;      // 0 for center, 0–15 for outer rings
  branch: number;     // 0–15 angular branch (-1 = center, belongs to all)
  angleRad: number;   // home angle (radians, clockwise from top)
  radiusFrac: number; // home radius as fraction of maxR
  offsetX: number;    // pixel offset from home position
  offsetY: number;
  sigmaMult: number;  // per-node falloff multiplier (Feature 5)
  pinned: boolean;    // node pinning (Feature 8)
}

interface TooltipData {
  x: number;
  y: number;
  hue: number;
  saturation: number;
  offsetX: number;
  offsetY: number;
  isDragging: boolean;
  modifier?: string;  // "HUE ONLY" | "SAT ONLY" (Feature 1)
  sigmaMult?: number; // display when != 1.0 (Feature 5)
  pinned?: boolean;   // display when pinned (Feature 8)
}

interface Snapshot {
  offsets: { offsetX: number; offsetY: number; pinned: boolean }[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const NODE_RADIUS = 4.5;
const CENTER_RADIUS = 7;
const HIT_RADIUS = 13;
const MAX_DRAG_FRAC = 0.25;
const SIGMA = 3.5;
const TWO_PI = Math.PI * 2;
const INV_TWO_PI = 1 / TWO_PI;
const MAX_UNDO = 50;
const SPRING_DURATION = 300;
const N = 16; // number of branches per ring

// ═══════════════════════════════════════════════════════════════════════════════
// OKLAB Perceptual Color Space — Inline matrix constants
// ═══════════════════════════════════════════════════════════════════════════════

// OKLAB → LMS' (inverse M2)
const MI2_00 = 1.0, MI2_01 = 0.3963377774, MI2_02 = 0.2158037573;
const MI2_10 = 1.0, MI2_11 = -0.1055613458, MI2_12 = -0.0638541728;
const MI2_20 = 1.0, MI2_21 = -0.0894841775, MI2_22 = -1.2914855480;
// LMS → Linear sRGB (inverse M1)
const MI1_00 = +4.0767416621, MI1_01 = -3.3077115913, MI1_02 = +0.2309699292;
const MI1_10 = -1.2684380046, MI1_11 = +2.6097574011, MI1_12 = -0.3413193965;
const MI1_20 = -0.0041960863, MI1_21 = -0.7034186147, MI1_22 = +1.7076147010;

// Module-level gamut boundary cache for L=0.5 (360 entries, one per degree)
let gamutBoundary = new Float32Array(360);

/** Pre-compute max in-gamut chroma at L=0.5 for each degree 0-359 via binary search. */
function computeGamutBoundary(): Float32Array {
  const gb = new Float32Array(360);
  for (let deg = 0; deg < 360; deg++) {
    const hRad = deg * Math.PI / 180;
    const cosH = Math.cos(hRad);
    const sinH = Math.sin(hRad);
    let lo = 0, hi = 0.5;
    for (let gi = 0; gi < 20; gi++) {
      const mid = (lo + hi) * 0.5;
      const a = mid * cosH, b = mid * sinH;
      const l_ = MI2_00 * 0.5 + MI2_01 * a + MI2_02 * b;
      const m_ = MI2_10 * 0.5 + MI2_11 * a + MI2_12 * b;
      const s_ = MI2_20 * 0.5 + MI2_21 * a + MI2_22 * b;
      const l = l_ * l_ * l_, m = m_ * m_ * m_, sv = s_ * s_ * s_;
      const r = MI1_00 * l + MI1_01 * m + MI1_02 * sv;
      const g = MI1_10 * l + MI1_11 * m + MI1_12 * sv;
      const bv = MI1_20 * l + MI1_21 * m + MI1_22 * sv;
      if (r < -0.0001 || r > 1.0001 || g < -0.0001 || g > 1.0001 || bv < -0.0001 || bv > 1.0001) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    gb[deg] = lo;
  }
  return gb;
}

/** Convert OKLAB (L, a, b) to sRGB uint8 with hard gamut clip. Uses imported oklabToRGB8. */
function oklabHueSatToRGB8(hueDeg: number, satScaled: number): [number, number, number] {
  const hueRad = hueDeg * Math.PI / 180;
  const deg = ((Math.round(hueDeg) % 360) + 360) % 360;
  const maxC = gamutBoundary[deg];
  const chroma = (satScaled / 100) * maxC;
  return oklabToRGB8(0.5, chroma * Math.cos(hueRad), chroma * Math.sin(hueRad), 'hard');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mesh topology — 65 nodes (center + 4 rings × 16), 176 connections,
// 112 fill triangles. (Feature 4: 16-Branch Topology)
// ═══════════════════════════════════════════════════════════════════════════════

const INITIAL_NODES: MeshNode[] = (() => {
  const out: MeshNode[] = [];
  // Ring 0 — center
  out.push({
    id: 'ab-c', ring: 0, index: 0, branch: -1,
    angleRad: 0, radiusFrac: 0,
    offsetX: 0, offsetY: 0, sigmaMult: 1.0, pinned: false,
  });
  // Ring 1 — 16 nodes at 0.22 radius
  for (let i = 0; i < N; i++) {
    out.push({
      id: `ab-1-${i}`, ring: 1, index: i, branch: i,
      angleRad: (i / N) * TWO_PI, radiusFrac: 0.22,
      offsetX: 0, offsetY: 0, sigmaMult: 1.0, pinned: false,
    });
  }
  // Ring 2 — 16 nodes at 0.44 radius, offset by 11.25° (π/16)
  for (let i = 0; i < N; i++) {
    out.push({
      id: `ab-2-${i}`, ring: 2, index: i, branch: i,
      angleRad: (i / N) * TWO_PI + Math.PI / N, radiusFrac: 0.44,
      offsetX: 0, offsetY: 0, sigmaMult: 1.0, pinned: false,
    });
  }
  // Ring 3 — 16 nodes at 0.70 radius, same angles as Ring 1
  for (let i = 0; i < N; i++) {
    out.push({
      id: `ab-3-${i}`, ring: 3, index: i, branch: i,
      angleRad: (i / N) * TWO_PI, radiusFrac: 0.70,
      offsetX: 0, offsetY: 0, sigmaMult: 1.0, pinned: false,
    });
  }
  // Ring 4 — 16 nodes at 1.0 radius, same angles as Ring 2
  for (let i = 0; i < N; i++) {
    out.push({
      id: `ab-4-${i}`, ring: 4, index: i, branch: i,
      angleRad: (i / N) * TWO_PI + Math.PI / N, radiusFrac: 1.0,
      offsetX: 0, offsetY: 0, sigmaMult: 1.0, pinned: false,
    });
  }
  return out;
})();

// Node-array index offsets
const C = 0;    // center
const R1 = 1;   // ring-1 start  (1..16)
const R2 = 17;  // ring-2 start  (17..32)
const R3 = 33;  // ring-3 start  (33..48)
const R4 = 49;  // ring-4 start  (49..64)

// ── 176 connections ─────────────────────────────────────────────────────────

const CONNS: [number, number][] = [
  // center → ring-1  (16)
  ...Array.from({ length: N }, (_, i) => [C, R1 + i] as [number, number]),
  // ring-1 circumferential  (16)
  ...Array.from({ length: N }, (_, i) => [R1 + i, R1 + (i + 1) % N] as [number, number]),
  // ring-2 circumferential  (16)
  ...Array.from({ length: N }, (_, i) => [R2 + i, R2 + (i + 1) % N] as [number, number]),
  // ring-3 circumferential  (16)
  ...Array.from({ length: N }, (_, i) => [R3 + i, R3 + (i + 1) % N] as [number, number]),
  // ring-4 circumferential  (16)
  ...Array.from({ length: N }, (_, i) => [R4 + i, R4 + (i + 1) % N] as [number, number]),
  // ring-1 → ring-2  (32: 16 straight + 16 cross)
  ...Array.from({ length: N }, (_, i) => [R1 + i, R2 + i] as [number, number]),
  ...Array.from({ length: N }, (_, i) => [R1 + i, R2 + (i + N - 1) % N] as [number, number]),
  // ring-2 → ring-3  (32: 16 straight + 16 cross)
  ...Array.from({ length: N }, (_, i) => [R2 + i, R3 + i] as [number, number]),
  ...Array.from({ length: N }, (_, i) => [R2 + i, R3 + (i + 1) % N] as [number, number]),
  // ring-3 → ring-4  (32: 16 straight + 16 cross)
  ...Array.from({ length: N }, (_, i) => [R3 + i, R4 + i] as [number, number]),
  ...Array.from({ length: N }, (_, i) => [R3 + i, R4 + (i + 1) % N] as [number, number]),
];

// ── 112 fill triangles ──────────────────────────────────────────────────────

const TRIS: [number, number, number][] = [
  // center → ring-1  (16 sectors)
  ...Array.from({ length: N }, (_, i) => [C, R1 + i, R1 + (i + 1) % N] as [number, number, number]),
  // ring-1 → ring-2  (32 triangles)
  ...Array.from({ length: N }, (_, i) => [R1 + i, R2 + (i + N - 1) % N, R2 + i] as [number, number, number]),
  ...Array.from({ length: N }, (_, i) => [R1 + i, R2 + i, R1 + (i + 1) % N] as [number, number, number]),
  // ring-2 → ring-3  (32 triangles)
  ...Array.from({ length: N }, (_, i) => [R2 + i, R3 + i, R3 + (i + 1) % N] as [number, number, number]),
  ...Array.from({ length: N }, (_, i) => [R2 + i, R3 + (i + 1) % N, R2 + (i + 1) % N] as [number, number, number]),
  // ring-3 → ring-4  (32 triangles)
  ...Array.from({ length: N }, (_, i) => [R3 + i, R4 + i, R4 + (i + 1) % N] as [number, number, number]),
  ...Array.from({ length: N }, (_, i) => [R3 + i, R4 + (i + 1) % N, R3 + (i + 1) % N] as [number, number, number]),
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

  // ── Undo/Redo refs (Feature 3) ──────────────────────────────────────────
  const undoStackRef = useRef<Snapshot[]>([]);
  const redoStackRef = useRef<Snapshot[]>([]);
  const schedFnRef = useRef<() => void>(() => {});

  // ── Spring animation ref (Feature 10) ───────────────────────────────────
  const springRef = useRef<{
    rafId: number;
    startTime: number;
    startOffsets: Float64Array;
    nodeIndices: number[];
  } | null>(null);

  // ── React state (only for tooltip + CSS-size-dependent JSX) ─────────────
  const [cssSize, setCssSize] = useState({ w: 0, h: 0 });
  const [tip, setTip] = useState<TooltipData | null>(null);

  // ── Store ───────────────────────────────────────────────────────────────
  const setSelectedNodeId = useAppStore((s) => s.setSelectedNodeId);

  // ══════════════════════════════════════════════════════════════════════════
  // syncToStore — converts mesh node offsets → Zustand store
  // ══════════════════════════════════════════════════════════════════════════

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
      offsetX: Math.round((n.offsetX / maxR) * 500) / 10,
      offsetY: Math.round(-(n.offsetY / maxR) * 250) / 10,
      sigmaMult: n.sigmaMult,
      pinned: n.pinned,
      abHueSigma: 0,
      abSatSigma: 0,
    }));

    useAppStore.getState().setABNodes(storeNodes);
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // Undo/Redo helpers (Feature 3)
  // ══════════════════════════════════════════════════════════════════════════

  const takeSnapshot = useCallback((): Snapshot => {
    const ns = nodesRef.current;
    return {
      offsets: ns.map((n) => ({
        offsetX: n.offsetX,
        offsetY: n.offsetY,
        pinned: n.pinned,
      })),
    };
  }, []);

  const restoreSnapshot = useCallback(
    (snap: Snapshot) => {
      const ns = nodesRef.current;
      for (let i = 0; i < ns.length && i < snap.offsets.length; i++) {
        ns[i] = {
          ...ns[i],
          offsetX: snap.offsets[i].offsetX,
          offsetY: snap.offsets[i].offsetY,
          pinned: snap.offsets[i].pinned,
        };
      }
      syncToStore();
      schedFnRef.current();
    },
    [syncToStore],
  );

  const pushUndo = useCallback(() => {
    const snap = takeSnapshot();
    undoStackRef.current.push(snap);
    if (undoStackRef.current.length > MAX_UNDO) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
  }, [takeSnapshot]);

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

    // Pre-compute OKLAB gamut boundary at L=0.5 for each degree
    gamutBoundary = computeGamutBoundary();

    // Build sRGB gamma LUT (linear 0-1 → uint8 0-255) for fast pixel rendering
    const GAMMA_LUT = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const c = i / 255;
      GAMMA_LUT[i] = c >= 0.0031308
        ? (1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255 + 0.5 | 0
        : (12.92 * c) * 255 + 0.5 | 0;
    }

    // Pixel-by-pixel OKLAB perceptual hue wheel via ImageData
    for (let py = 0; py < ih; py++) {
      const dy = py - cy;
      const dy2 = dy * dy;
      for (let px = 0; px < iw; px++) {
        const dx = px - cx;
        const dist2 = dx * dx + dy2;
        const idx = (py * iw + px) << 2;

        if (dist2 <= mr2) {
          const dist = Math.sqrt(dist2);
          let angle = Math.atan2(dx, -dy);
          if (angle < 0) angle += TWO_PI;

          // Look up max gamut chroma at this OKLAB hue
          const deg = ((angle * 180 / Math.PI) % 360 + 360) % 360;
          const maxC = gamutBoundary[deg | 0];
          const chroma = (dist / mr) * maxC;

          // Compute OKLAB a,b from polar (canvas angle = OKLAB hue)
          const okA = chroma * Math.cos(angle);
          const okB = chroma * Math.sin(angle);
          const L = 0.5;

          // Inline OKLAB → LMS'
          const l_ = MI2_00 * L + MI2_01 * okA + MI2_02 * okB;
          const m_ = MI2_10 * L + MI2_11 * okA + MI2_12 * okB;
          const s_ = MI2_20 * L + MI2_21 * okA + MI2_22 * okB;
          // LMS' → LMS (cube)
          const l = l_ * l_ * l_;
          const m = m_ * m_ * m_;
          const sv = s_ * s_ * s_;
          // LMS → Linear sRGB
          let lr = MI1_00 * l + MI1_01 * m + MI1_02 * sv;
          let lg = MI1_10 * l + MI1_11 * m + MI1_12 * sv;
          let lb = MI1_20 * l + MI1_21 * m + MI1_22 * sv;
          // Hard clip at gamut boundary
          if (lr < 0) lr = 0; else if (lr > 1) lr = 1;
          if (lg < 0) lg = 0; else if (lg > 1) lg = 1;
          if (lb < 0) lb = 0; else if (lb > 1) lb = 1;

          // Apply subtle vignette
          const vig = 1 - (dist / mr) * (dist / mr) * 0.35;
          d[idx]     = (GAMMA_LUT[(lr * 255 + 0.5) | 0] * vig) | 0;
          d[idx + 1] = (GAMMA_LUT[(lg * 255 + 0.5) | 0] * vig) | 0;
          d[idx + 2] = (GAMMA_LUT[(lb * 255 + 0.5) | 0] * vig) | 0;
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

    // ── Feature 7: Skin Tone Overlay ────────────────────────────────────
    ctx.save();
    ctx.scale(dpr, dpr);
    const scx = w / 2;
    const scy = h / 2;
    const smr = Math.min(scx, scy) * 0.95;

    // OKLAB skin tones are at hue 40°–100° (orange-yellow range in OKLAB)
    const SKIN_HUE_START = (40 / 360) * TWO_PI;
    const SKIN_HUE_END = (100 / 360) * TWO_PI;
    ctx.beginPath();
    ctx.moveTo(scx, scy);
    ctx.arc(scx, scy, smr, SKIN_HUE_START - Math.PI / 2, SKIN_HUE_END - Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 180, 120, 0.08)';
    ctx.fill();

    // Skin tone label
    const labelAngle = (70 / 360) * TWO_PI - Math.PI / 2; // midpoint of 40°–100°
    const labelR = smr * 0.55;
    ctx.font = '9px system-ui';
    ctx.fillStyle = 'rgba(255, 200, 160, 0.4)';
    ctx.textAlign = 'center';
    ctx.fillText('Skin Tones', scx + Math.cos(labelAngle) * labelR, scy + Math.sin(labelAngle) * labelR);

    // ── Grid overlay lines ─────────────────────────────────────────────
    // 16 radial lines at 22.5° intervals
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TWO_PI;
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

    // 1. ── Mesh fill (112 triangles) ─────────────────────────────────────
    for (const [ai, bi, ci] of TRIS) {
      const ax = pos[ai][0], ay = pos[ai][1];
      const bx = pos[bi][0], by = pos[bi][1];
      const ccx = pos[ci][0], ccy = pos[ci][1];

      // Centroid color
      const mx = (ax + bx + ccx) / 3;
      const my = (ay + by + ccy) / 3;
      const { hue, saturation: sat } = hueSatAt(mx, my, cx, cy, mr);
      const [r, g, b] = oklabHueSatToRGB8(hue, sat);

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(ccx, ccy);
      ctx.closePath();
      ctx.fillStyle = `rgba(${r},${g},${b},0.15)`;
      ctx.fill();
    }

    // 2. ── Mesh connections (176 lines) ──────────────────────────────────
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

    // 4. ── Nodes (65 total) ─────────────────────────────────────────────
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

      // ── Feature 8: Pinned node indicator ────────────────────────────
      if (n.pinned) {
        ctx.save();
        ctx.translate(nx, ny - r - 5);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
        ctx.fillRect(-2.5, -2.5, 5, 5);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(-2.5, -2.5, 5, 5);
        ctx.restore();
      }
    }

    // 5. ── Feature 9: Before/After Color Swatch on Selected Node ───────
    if (selId) {
      const si = ns.findIndex((n) => n.id === selId);
      if (si >= 0) {
        const sn = ns[si];
        const snx = pos[si][0];
        const sny = pos[si][1];
        const hasOffset = sn.offsetX !== 0 || sn.offsetY !== 0;

        if (hasOffset) {
          // Original color at home position
          const origHue = ((sn.angleRad / TWO_PI) * 360 + 360) % 360;
          const origSat = sn.radiusFrac * 100;
          const [or, og, ob] = oklabHueSatToRGB8(origHue, origSat);

          // Current color at offset position
          const { hue: curHue, saturation: curSat } = hueSatAt(snx, sny, cx, cy, mr);
          const [cr, cg, cb] = oklabHueSatToRGB8(curHue, curSat);

          // Draw split swatch (10×8 px)
          const sw = 10;
          const sh = 8;
          const sx = snx + 14;
          const sy = sny - 14;

          // Left half (original)
          ctx.fillStyle = `rgb(${or},${og},${ob})`;
          ctx.fillRect(sx - sw / 2, sy - sh / 2, sw / 2, sh);

          // Right half (shifted)
          ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
          ctx.fillRect(sx, sy - sh / 2, sw / 2, sh);

          // Border
          ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(sx - sw / 2, sy - sh / 2, sw, sh);
        }
      }
    }
  }, []);

  /** Schedule an overlay redraw via requestAnimationFrame (debounced). */
  const sched = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(drawOl);
  }, [drawOl]);

  // Keep schedFnRef in sync with the latest sched callback
  useEffect(() => {
    schedFnRef.current = sched;
  }, [sched]);

  /** Throttled version of syncToStore — fires at most every 16ms (~60fps) during drag. */
  const throttledSync = useCallback(() => {
    const now = performance.now();
    if (now - lastSyncRef.current < 16) return;
    lastSyncRef.current = now;
    syncToStore();
  }, [syncToStore]);

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

        // Cancel spring animation on resize
        if (springRef.current) {
          cancelAnimationFrame(springRef.current.rafId);
          springRef.current = null;
        }

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
  }, [drawBg, sched, syncToStore]);

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

  // ══════════════════════════════════════════════════════════════════════════
  // Global pointer up — end drag even if pointer leaves the canvas
  // (Feature 2: pointer events)
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
    window.addEventListener('pointerup', onGlobalUp);
    window.addEventListener('pointercancel', onGlobalUp);
    return () => {
      window.removeEventListener('pointerup', onGlobalUp);
      window.removeEventListener('pointercancel', onGlobalUp);
    };
  }, [sched, syncToStore]);

  // ══════════════════════════════════════════════════════════════════════════
  // Undo/Redo keyboard shortcuts (Feature 3)
  // ══════════════════════════════════════════════════════════════════════════

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const snap = undoStackRef.current.pop()!;
    redoStackRef.current.push(takeSnapshot());
    if (redoStackRef.current.length > MAX_UNDO) {
      redoStackRef.current.shift();
    }
    restoreSnapshot(snap);
  }, [takeSnapshot, restoreSnapshot]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const snap = redoStackRef.current.pop()!;
    undoStackRef.current.push(takeSnapshot());
    if (undoStackRef.current.length > MAX_UNDO) {
      undoStackRef.current.shift();
    }
    restoreSnapshot(snap);
  }, [takeSnapshot, restoreSnapshot]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Only handle when the grid container contains the target
      if (!containerRef.current?.contains(e.target as Node)) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  // ══════════════════════════════════════════════════════════════════════════
  // Ctrl+Scroll → adjust sigmaMult (Feature 5)
  // ══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const el = olRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const { w, h } = sizeRef.current;
      const cx = w / 2;
      const cy = h / 2;
      const mr = Math.min(cx, cy) * 0.95;
      const idx = hitTest(nodesRef.current, cx, cy, mr, x, y);
      if (idx < 0) return;

      const ns = nodesRef.current;
      const n = ns[idx];
      if (n.ring === 0) return; // Don't adjust sigmaMult for center

      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newMult = clamp(n.sigmaMult + delta, 0.2, 3.0);
      ns[idx] = { ...ns[idx], sigmaMult: Math.round(newMult * 10) / 10 };

      // Update tooltip
      hoverIdxRef.current = idx;
      const [nx, ny] = nodeXY(ns[idx], cx, cy, mr);
      const hs = hueSatAt(nx, ny, cx, cy, mr);
      setTip({
        x, y, hue: hs.hue, saturation: hs.saturation,
        offsetX: Math.round(ns[idx].offsetX * 10) / 10,
        offsetY: Math.round(ns[idx].offsetY * 10) / 10,
        isDragging: false,
        sigmaMult: ns[idx].sigmaMult,
        pinned: ns[idx].pinned,
      });

      syncToStore();
      sched();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [sched, syncToStore]);

  // ══════════════════════════════════════════════════════════════════════════
  // Spring animation cleanup on unmount (Feature 10)
  // ══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    return () => {
      if (springRef.current) {
        cancelAnimationFrame(springRef.current.rafId);
      }
    };
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // Pointer helpers (Feature 2)
  // ══════════════════════════════════════════════════════════════════════════

  const pointerXY = useCallback(
    (e: React.PointerEvent) => {
      const rect = olRef.current?.getBoundingClientRect();
      return rect
        ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
        : { x: 0, y: 0 };
    },
    [],
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Pointer event handlers (Feature 2: replace mouse with pointer events)
  // ══════════════════════════════════════════════════════════════════════════

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Feature 2: pointer capture for reliable tracking
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      // Feature 10: cancel spring animation on new interaction
      if (springRef.current) {
        cancelAnimationFrame(springRef.current.rafId);
        springRef.current = null;
      }

      const { x, y } = pointerXY(e);
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

      // Feature 3: push undo snapshot on drag start
      pushUndo();

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
        pinned: n.pinned,
        sigmaMult: n.ring === 0 ? undefined : n.sigmaMult,
      });

      olRef.current?.style.setProperty('cursor', 'grabbing');
      sched();
    },
    [pointerXY, setSelectedNodeId, sched, pushUndo],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const { x, y } = pointerXY(e);
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
        let dx = x - st.mx;
        let dy = y - st.my;

        // ── Feature 1: Constrained Drag ─────────────────────────────────
        const angle = ns[di].angleRad;
        // Radial direction (from center to node home): (sin(angle), -cos(angle))
        const radX = Math.sin(angle);
        const radY = -Math.cos(angle);
        // Tangential direction (perpendicular, increasing angle): (cos(angle), sin(angle))
        const tanX = Math.cos(angle);
        const tanY = Math.sin(angle);

        let modifier: string | undefined;
        if (e.shiftKey) {
          // Hue only: project onto tangential direction
          const proj = dx * tanX + dy * tanY;
          dx = proj * tanX;
          dy = proj * tanY;
          modifier = 'HUE ONLY';
        } else if (e.ctrlKey || e.metaKey) {
          // Saturation only: project onto radial direction
          const proj = dx * radX + dy * radY;
          dx = proj * radX;
          dy = proj * radY;
          modifier = 'SAT ONLY';
        }

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
            // Feature 8: skip pinned nodes (except the dragged node)
            if (ns[i].pinned && i !== di) continue;
            const rd = ns[i].ring;
            // Feature 5: per-node falloff via sigmaMult
            const effSigma = SIGMA * ns[i].sigmaMult;
            const f = Math.exp(-(rd * rd) / (2 * effSigma * effSigma));
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
            // Feature 8: skip pinned nodes (except the dragged node)
            if (ns[i].pinned && i !== di) continue;
            const n = ns[i];
            let rd: number;
            let affect: boolean;
            if (n.ring === 0) {
              rd = ns[di].ring;
              affect = true;
            } else if (n.branch === branch) {
              rd = Math.abs(n.ring - ns[di].ring);
              affect = true;
            } else {
              affect = false;
              rd = 0;
            }
            if (affect) {
              // Feature 5: per-node falloff via sigmaMult
              const effSigma = SIGMA * n.sigmaMult;
              const f = Math.exp(-(rd * rd) / (2 * effSigma * effSigma));
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
          modifier,
          pinned: ns[di].pinned,
          sigmaMult: ns[di].ring === 0 ? undefined : ns[di].sigmaMult,
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
            pinned: n.pinned,
            sigmaMult: n.ring === 0 ? undefined : n.sigmaMult,
          });
          olRef.current?.style.setProperty('cursor', 'grab');
        } else {
          setTip(null);
          olRef.current?.style.setProperty('cursor', 'default');
        }

        sched();
      }
    },
    [pointerXY, sched, throttledSync],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (draggingRef.current) {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        draggingRef.current = false;
        dragIdxRef.current = -1;
        dragStartRef.current = null;
        syncToStore();
        olRef.current?.style.setProperty('cursor', 'grab');
      }
    },
    [syncToStore],
  );

  const onPointerLeave = useCallback(
    (e: React.PointerEvent) => {
      hoverIdxRef.current = -1;
      setTip(null);
      if (draggingRef.current) {
        syncToStore();
        draggingRef.current = false;
        dragIdxRef.current = -1;
        dragStartRef.current = null;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      }
      olRef.current?.style.setProperty('cursor', 'default');
      sched();
    },
    [sched, syncToStore],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      hoverIdxRef.current = -1;
      setTip(null);
      if (draggingRef.current) {
        syncToStore();
        draggingRef.current = false;
        dragIdxRef.current = -1;
        dragStartRef.current = null;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      }
      olRef.current?.style.setProperty('cursor', 'default');
      sched();
    },
    [sched, syncToStore],
  );

  // ── Feature 8: Right-click to toggle pinned state ──────────────────────
  const onContextMenu = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const { x, y } = pointerXY(e);
      const { w, h } = sizeRef.current;
      const cx = w / 2;
      const cy = h / 2;
      const mr = Math.min(cx, cy) * 0.95;
      const idx = hitTest(nodesRef.current, cx, cy, mr, x, y);
      if (idx < 0) return;

      const ns = nodesRef.current;
      const n = ns[idx];
      if (n.ring === 0) return; // Can't pin center node

      ns[idx] = { ...ns[idx], pinned: !ns[idx].pinned };

      // Update tooltip to reflect new pinned state
      const [nx, ny] = nodeXY(ns[idx], cx, cy, mr);
      const hs = hueSatAt(nx, ny, cx, cy, mr);
      setTip({
        x, y, hue: hs.hue, saturation: hs.saturation,
        offsetX: Math.round(ns[idx].offsetX * 10) / 10,
        offsetY: Math.round(ns[idx].offsetY * 10) / 10,
        isDragging: false,
        pinned: ns[idx].pinned,
        sigmaMult: ns[idx].sigmaMult,
      });

      syncToStore();
      sched();
    },
    [pointerXY, sched, syncToStore],
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Feature 10: Spring Reset Animation (double-click)
  // ══════════════════════════════════════════════════════════════════════════

  const onDblClick = useCallback(
    (e: React.PointerEvent) => {
      const { x, y } = pointerXY(e);
      const { w, h } = sizeRef.current;
      const cx = w / 2;
      const cy = h / 2;
      const mr = Math.min(cx, cy) * 0.95;
      const idx = hitTest(nodesRef.current, cx, cy, mr, x, y);
      if (idx < 0) return;

      const ns = nodesRef.current;
      const n = ns[idx];

      // Cancel any ongoing spring animation
      if (springRef.current) {
        cancelAnimationFrame(springRef.current.rafId);
        springRef.current = null;
      }

      // Determine which nodes to reset
      const resetIndices: number[] = [];
      if (n.ring === 0) {
        for (let i = 0; i < ns.length; i++) resetIndices.push(i);
      } else {
        for (let i = 0; i < ns.length; i++) {
          if (ns[i].ring === 0 || ns[i].branch === n.branch) {
            resetIndices.push(i);
          }
        }
      }

      // Store start offsets
      const startOffsets = new Float64Array(ns.length * 2);
      for (let i = 0; i < ns.length; i++) {
        startOffsets[i * 2] = ns[i].offsetX;
        startOffsets[i * 2 + 1] = ns[i].offsetY;
      }

      const startTime = performance.now();

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / SPRING_DURATION, 1);
        // Ease-out cubic
        const t = 1 - Math.pow(1 - progress, 3);

        const curNs = nodesRef.current;
        for (const i of resetIndices) {
          curNs[i] = {
            ...curNs[i],
            offsetX: startOffsets[i * 2] * (1 - t),
            offsetY: startOffsets[i * 2 + 1] * (1 - t),
          };
        }

        syncToStore();
        sched();

        if (progress < 1) {
          springRef.current!.rafId = requestAnimationFrame(animate);
        } else {
          springRef.current = null;
          syncToStore(); // Final sync
        }
      };

      springRef.current = {
        rafId: requestAnimationFrame(animate),
        startTime,
        startOffsets,
        nodeIndices: resetIndices,
      };
    },
    [pointerXY, syncToStore, sched],
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
          <span>Shift = hue, Ctrl = sat</span>
          <span className="text-white/10">|</span>
          <span>Right-click = pin</span>
        </div>
      </div>

      {/* ── Canvas container ─────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="relative aspect-square w-full"
        style={{ minHeight: 250, touchAction: 'none' }}
      >
        {/* Background canvas — hue wheel + skin tone overlay + grid (redrawn only on resize) */}
        <canvas
          ref={bgRef}
          className="absolute inset-0 rounded-b-[11px]"
          style={{ display: 'block' }}
        />

        {/* Overlay canvas — mesh, nodes, helpers (redrawn on interaction)
            Feature 2: Pointer events replace mouse events */}
        <canvas
          ref={olRef}
          className="absolute inset-0 rounded-b-[11px]"
          style={{ display: 'block' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          onPointerCancel={onPointerCancel}
          onContextMenu={onContextMenu}
          onDoubleClick={onDblClick}
        />

        {/* ── Tooltip ────────────────────────────────────────────────────── */}
        {tip && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-white/10 bg-neutral-900/90 px-2.5 py-1.5 text-[10px] text-white/70 shadow-lg backdrop-blur-sm"
            style={{
              left: Math.min(tip.x + 16, cssSize.w - 160),
              top: Math.max(tip.y - 60, 4),
            }}
          >
            <div className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-sm border border-white/20"
                style={{
                  backgroundColor: (() => {
                    const [r, g, b] = oklabHueSatToRGB8(tip.hue, tip.saturation);
                    return `rgb(${r},${g},${b})`;
                  })(),
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
            {tip.modifier && (
              <div className="mt-0.5 pl-5 font-medium text-amber-400/80">
                {tip.modifier}
              </div>
            )}
            {tip.pinned && (
              <div className="mt-0.5 pl-5 font-medium text-red-400/80">PINNED</div>
            )}
            {tip.sigmaMult != null && tip.sigmaMult !== 1.0 && (
              <div className="mt-0.5 pl-5 text-white/40">
                σ ×{tip.sigmaMult.toFixed(1)}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
