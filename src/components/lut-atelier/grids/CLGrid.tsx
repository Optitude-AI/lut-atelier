'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/useAppStore';
import { hslToRgb } from '@/lib/colorUtils';

// ─── Props ───────────────────────────────────────────────────────────────────
interface CLGridProps {
  className?: string;
}

// ─── Mesh Node ───────────────────────────────────────────────────────────────
interface CLMeshNode {
  id: string;
  ring: number;           // 0 (center), 1, 2, 3
  index: number;          // 0-7 for rings 1-3, 0 for center
  branch: number;         // 0-7 branch assignment, -1 for center
  homeAngle: number;      // radians from top, clockwise
  homeRadiusFrac: number; // fraction of circle radius (0–1)
  homeX: number;
  homeY: number;
  currentX: number;
  currentY: number;
  offsetX: number;
  offsetY: number;
  chroma: number;         // 0-100 based on radius fraction
  luminance: number;      // 0-100 based on angle
}

// ─── Connection ──────────────────────────────────────────────────────────────
interface Connection {
  fromIdx: number;
  toIdx: number;
}

// ─── Triangle Cell ───────────────────────────────────────────────────────────
interface TriCell {
  a: number;
  b: number;
  c: number;
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────
interface TooltipData {
  x: number;
  y: number;
  chroma: number;
  luminance: number;
  offsetX: number;
  offsetY: number;
  isDragging: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const NODE_RADIUS = 5;
const CENTER_NODE_RADIUS = 8;
const NODE_HIT_RADIUS = 12;
const CENTER_HIT_RADIUS = 16;
const RING_RADIUS_FRACS = [0, 0.24, 0.50, 0.78];
const NUM_SPOKES = 8;
const FALLOFF_SIGMA = 1.5;
const MAX_DRAG_FRACTION = 0.15;
const CL_BG_HUE = 30;
const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Polar (angle from top clockwise, radius fraction) → canvas pixel coords */
function polarToCanvas(
  angle: number,
  radiusFrac: number,
  cx: number,
  cy: number,
  circleR: number,
): { x: number; y: number } {
  const x = cx + radiusFrac * circleR * Math.sin(angle);
  const y = cy - radiusFrac * circleR * Math.cos(angle);
  return { x, y };
}

function distPt(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Gaussian falloff: 1.0 at distance 0, decays toward 0 */
function gaussFalloff(distance: number, sigma: number): number {
  return Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

/** Index helpers for the flat 25-node array:
 *  0          = center
 *  1..8       = Ring 1 (R1[0]..R1[7])
 *  9..16      = Ring 2 (R2[0]..R2[7])
 *  17..24     = Ring 3 (R3[0]..R3[7])
 */
const R1 = (i: number) => 1 + i;
const R2 = (i: number) => 9 + i;
const R3 = (i: number) => 17 + i;

/** Generate all 25 nodes */
function generateNodes(cx: number, cy: number, circleR: number): CLMeshNode[] {
  const nodes: CLMeshNode[] = [];

  // Ring 0 — Center
  nodes.push({
    id: 'cl-center',
    ring: 0,
    index: 0,
    branch: -1,
    homeAngle: 0,
    homeRadiusFrac: 0,
    homeX: cx,
    homeY: cy,
    currentX: cx,
    currentY: cy,
    offsetX: 0,
    offsetY: 0,
    chroma: 0,
    luminance: 0,
  });

  // Ring 1 — 8 nodes at 0°, 45°, …, 315°
  for (let i = 0; i < NUM_SPOKES; i++) {
    const angle = i * 45 * DEG;
    const rFrac = RING_RADIUS_FRACS[1];
    const { x, y } = polarToCanvas(angle, rFrac, cx, cy, circleR);
    nodes.push({
      id: `cl-r1-${i}`,
      ring: 1,
      index: i,
      branch: i,
      homeAngle: angle,
      homeRadiusFrac: rFrac,
      homeX: x,
      homeY: y,
      currentX: x,
      currentY: y,
      offsetX: 0,
      offsetY: 0,
      chroma: rFrac * 100,
      luminance: (angle / TWO_PI) * 100,
    });
  }

  // Ring 2 — 8 nodes at 22.5°, 67.5°, …, 337.5° (offset by 22.5°)
  for (let i = 0; i < NUM_SPOKES; i++) {
    const angle = (i * 45 + 22.5) * DEG;
    const rFrac = RING_RADIUS_FRACS[2];
    const { x, y } = polarToCanvas(angle, rFrac, cx, cy, circleR);
    nodes.push({
      id: `cl-r2-${i}`,
      ring: 2,
      index: i,
      branch: i,
      homeAngle: angle,
      homeRadiusFrac: rFrac,
      homeX: x,
      homeY: y,
      currentX: x,
      currentY: y,
      offsetX: 0,
      offsetY: 0,
      chroma: rFrac * 100,
      luminance: (angle / TWO_PI) * 100,
    });
  }

  // Ring 3 — 8 nodes at 0°, 45°, …, 315°
  for (let i = 0; i < NUM_SPOKES; i++) {
    const angle = i * 45 * DEG;
    const rFrac = RING_RADIUS_FRACS[3];
    const { x, y } = polarToCanvas(angle, rFrac, cx, cy, circleR);
    nodes.push({
      id: `cl-r3-${i}`,
      ring: 3,
      index: i,
      branch: i,
      homeAngle: angle,
      homeRadiusFrac: rFrac,
      homeX: x,
      homeY: y,
      currentX: x,
      currentY: y,
      offsetX: 0,
      offsetY: 0,
      chroma: rFrac * 100,
      luminance: (angle / TWO_PI) * 100,
    });
  }

  return nodes;
}

/** Build the 64 static mesh connections */
function buildConnections(): Connection[] {
  const c: Connection[] = [];

  // Center → each Ring 1 (8 radial)
  for (let i = 0; i < NUM_SPOKES; i++) {
    c.push({ fromIdx: 0, toIdx: R1(i) });
  }

  // Ring 1[i] → Ring 2[i]  AND  Ring 1[i] → Ring 2[(i+7)%8]
  for (let i = 0; i < NUM_SPOKES; i++) {
    c.push({ fromIdx: R1(i), toIdx: R2(i) });
    c.push({ fromIdx: R1(i), toIdx: R2((i + 7) % NUM_SPOKES) });
  }

  // Ring 2[i] → Ring 3[i]  AND  Ring 2[i] → Ring 3[(i+1)%8]
  for (let i = 0; i < NUM_SPOKES; i++) {
    c.push({ fromIdx: R2(i), toIdx: R3(i) });
    c.push({ fromIdx: R2(i), toIdx: R3((i + 1) % NUM_SPOKES) });
  }

  // Circumferential — Ring 1, Ring 2, Ring 3
  for (let i = 0; i < NUM_SPOKES; i++) {
    c.push({ fromIdx: R1(i), toIdx: R1((i + 1) % NUM_SPOKES) });
    c.push({ fromIdx: R2(i), toIdx: R2((i + 1) % NUM_SPOKES) });
    c.push({ fromIdx: R3(i), toIdx: R3((i + 1) % NUM_SPOKES) });
  }

  return c; // 8 + 16 + 16 + 24 = 64
}

/** Build triangular cells for mesh fill (40 triangles) */
function buildTriCells(): TriCell[] {
  const cells: TriCell[] = [];

  // Center sectors: (Center, R1[i], R1[(i+1)%8])
  for (let i = 0; i < NUM_SPOKES; i++) {
    cells.push({ a: 0, b: R1(i), c: R1((i + 1) % NUM_SPOKES) });
  }

  // Ring 1 → Ring 2
  for (let i = 0; i < NUM_SPOKES; i++) {
    cells.push({ a: R1(i), b: R2((i + 7) % NUM_SPOKES), c: R2(i) });
    cells.push({ a: R1(i), b: R2(i), c: R1((i + 1) % NUM_SPOKES) });
  }

  // Ring 2 → Ring 3
  for (let i = 0; i < NUM_SPOKES; i++) {
    cells.push({ a: R2(i), b: R3(i), c: R3((i + 1) % NUM_SPOKES) });
    cells.push({ a: R2(i), b: R3((i + 1) % NUM_SPOKES), c: R2((i + 1) % NUM_SPOKES) });
  }

  return cells; // 8 + 16 + 16 = 40
}

// Pre-computed static topology
const CONNECTIONS = buildConnections();
const TRI_CELLS = buildTriCells();

// ─── Component ───────────────────────────────────────────────────────────────
export default function CLGrid({ className = '' }: CLGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<CLMeshNode[]>([]);
  const rafRef = useRef<number>(0);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // High-frequency interaction state — keep in refs to avoid re-renders during drag
  const isDraggingRef = useRef(false);
  const hoverNodeIdRef = useRef<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);

  // Drag tracking
  const dragInfoRef = useRef<{
    nodeId: string;
    branch: number;
    isCenter: boolean;
    startMouseX: number;
    startMouseY: number;
    startOffsets: Map<string, { offsetX: number; offsetY: number }>;
  } | null>(null);

  // Zustand store
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useAppStore((s) => s.setSelectedNodeId);
  const showNodeHelpers = useAppStore((s) => s.showNodeHelpers);

  // ─── Circle geometry helper ────────────────────────────────────────────
  const getCircleGeom = useCallback(
    (w: number, h: number) => {
      const cx = w / 2;
      const cy = h / 2;
      const circleR = (Math.min(w, h) / 2) * 0.88;
      return { cx, cy, circleR };
    },
    [],
  );

  // ─── Render background (circular C/L gradient) ─────────────────────────
  const renderBackground = useCallback(
    (w: number, h: number) => {
      const canvas = bgCanvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      const { cx, cy, circleR } = getCircleGeom(w, h);

      // Dark base fill
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);

      // Pixel-by-pixel circular chroma-luminance gradient
      const imageData = ctx.createImageData(w, h);
      const data = imageData.data;
      const r2 = circleR * circleR;

      for (let py = 0; py < h; py++) {
        const dy = py - cy;
        const dy2 = dy * dy;
        for (let px = 0; px < w; px++) {
          const dx = px - cx;
          const dist2 = dx * dx + dy2;
          const idx = (py * w + px) * 4;

          if (dist2 <= r2) {
            const dist = Math.sqrt(dist2);
            const chroma = (dist / circleR) * 100;
            // Angle from top, clockwise → atan2(dx, -dy)
            let angle = Math.atan2(dx, -dy);
            if (angle < 0) angle += TWO_PI;
            const luminance = (angle / TWO_PI) * 100;
            const [r, g, b] = hslToRgb(CL_BG_HUE, chroma, luminance);
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
          } else {
            data[idx] = 10;
            data[idx + 1] = 10;
            data[idx + 2] = 10;
            data[idx + 3] = 255;
          }
        }
      }
      ctx.putImageData(imageData, 0, 0);

      // Vignette
      const vigGrad = ctx.createRadialGradient(cx, cy, circleR * 0.45, cx, cy, circleR * 1.05);
      vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
      vigGrad.addColorStop(0.65, 'rgba(0,0,0,0)');
      vigGrad.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = vigGrad;
      ctx.fillRect(0, 0, w, h);

      // Subtle grid lines — 8 radial at 45° intervals
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 0.75;
      for (let i = 0; i < NUM_SPOKES; i++) {
        const angle = i * 45 * DEG;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + circleR * Math.sin(angle), cy - circleR * Math.cos(angle));
        ctx.stroke();
      }

      // 4 concentric circles
      for (let r = 1; r <= 4; r++) {
        ctx.beginPath();
        ctx.arc(cx, cy, circleR * (r / 4), 0, TWO_PI);
        ctx.stroke();
      }
    },
    [getCircleGeom],
  );

  // ─── Update / generate node positions ──────────────────────────────────
  const updateNodesForSize = useCallback(
    (w: number, h: number, preserveOffsets = false) => {
      const oldW = sizeRef.current.w;
      const { cx, cy, circleR } = getCircleGeom(w, h);

      if (preserveOffsets && oldW > 0 && nodesRef.current.length > 0) {
        const oldGeom = getCircleGeom(oldW, sizeRef.current.h);
        const scale = circleR / oldGeom.circleR;
        for (const node of nodesRef.current) {
          node.offsetX *= scale;
          node.offsetY *= scale;
          const pos = polarToCanvas(node.homeAngle, node.homeRadiusFrac, cx, cy, circleR);
          node.homeX = pos.x;
          node.homeY = pos.y;
          node.currentX = pos.x + node.offsetX;
          node.currentY = pos.y + node.offsetY;
        }
      } else {
        nodesRef.current = generateNodes(cx, cy, circleR);
      }
    },
    [getCircleGeom],
  );

  // ─── Draw overlay (mesh fill + lines + helpers + nodes) ────────────────
  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    const bgCanvas = bgCanvasRef.current;
    if (!canvas || !bgCanvas) return;

    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const nodes = nodesRef.current;
    if (nodes.length === 0) return;

    const { cx, cy, circleR } = getCircleGeom(w, h);

    // Dynamic store values (read inside draw, never used as dependency)
    const currentSelectedId = useAppStore.getState().selectedNodeId;
    const helpersVisible = useAppStore.getState().showNodeHelpers;
    const isDragging = isDraggingRef.current;
    const dragNodeId = dragInfoRef.current?.nodeId ?? null;
    const currentHoverId = hoverNodeIdRef.current;

    // ── 1. Background ────────────────────────────────────────────────────
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bgCanvas, 0, 0, w, h);

    // ── 2. Mesh fill (triangular cells) ──────────────────────────────────
    for (const cell of TRI_CELLS) {
      const na = nodes[cell.a];
      const nb = nodes[cell.b];
      const nc = nodes[cell.c];

      // Centroid of the three current positions
      const centX = (na.currentX + nb.currentX + nc.currentX) / 3;
      const centY = (na.currentY + nb.currentY + nc.currentY) / 3;

      // Map centroid back to polar → chroma & luminance
      const dx = centX - cx;
      const dy = -(centY - cy);
      const dist = Math.sqrt(dx * dx + dy * dy);
      let angle = Math.atan2(dx, dy);
      if (angle < 0) angle += TWO_PI;

      const chromaSample = clamp((dist / circleR) * 100, 0, 100);
      const lumSample = clamp((angle / TWO_PI) * 100, 0, 100);
      const [fr, fg, fb] = hslToRgb(CL_BG_HUE, chromaSample, lumSample);

      ctx.beginPath();
      ctx.moveTo(na.currentX, na.currentY);
      ctx.lineTo(nb.currentX, nb.currentY);
      ctx.lineTo(nc.currentX, nc.currentY);
      ctx.closePath();
      ctx.fillStyle = `rgba(${fr},${fg},${fb},0.15)`;
      ctx.fill();
    }

    // ── 3. Mesh connections ──────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.75;
    for (const conn of CONNECTIONS) {
      const from = nodes[conn.fromIdx];
      const to = nodes[conn.toIdx];
      ctx.beginPath();
      ctx.moveTo(from.currentX, from.currentY);
      ctx.lineTo(to.currentX, to.currentY);
      ctx.stroke();
    }

    // ── 4. Helper lines (dashed home→current) ────────────────────────────
    if (helpersVisible) {
      ctx.setLineDash([3, 3]);
      for (const node of nodes) {
        if (node.offsetX === 0 && node.offsetY === 0) continue;
        const isSel = node.id === currentSelectedId;

        ctx.beginPath();
        ctx.moveTo(node.homeX, node.homeY);
        ctx.lineTo(node.currentX, node.currentY);
        ctx.strokeStyle = isSel ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.25)';
        ctx.lineWidth = isSel ? 1.2 : 0.8;
        ctx.stroke();

        // Small dot at home
        ctx.beginPath();
        ctx.arc(node.homeX, node.homeY, 2.5, 0, TWO_PI);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fill();
      }
      ctx.setLineDash([]);
    }

    // ── 5. Nodes ─────────────────────────────────────────────────────────
    for (const node of nodes) {
      const isCenter = node.ring === 0;
      const isSelected = node.id === currentSelectedId;
      const isHovered = node.id === currentHoverId;
      const isBeingDragged = isDragging && node.id === dragNodeId;
      const hasOffset = node.offsetX !== 0 || node.offsetY !== 0;
      const px = node.currentX;
      const py = node.currentY;
      const baseR = isCenter ? CENTER_NODE_RADIUS : NODE_RADIUS;
      const radius = isBeingDragged ? baseR + 1.5 : baseR;

      // Glow — selected / hovered / dragged
      if (isSelected || isHovered || isBeingDragged) {
        const glowR = radius + 7;
        const glowGrad = ctx.createRadialGradient(px, py, radius, px, py, glowR);
        if (isCenter) {
          glowGrad.addColorStop(
            0,
            isSelected ? 'rgba(255,191,64,0.6)' : 'rgba(255,191,64,0.35)',
          );
          glowGrad.addColorStop(1, 'rgba(255,191,64,0)');
        } else if (isSelected) {
          glowGrad.addColorStop(0, 'rgba(255,191,64,0.5)');
          glowGrad.addColorStop(1, 'rgba(255,191,64,0)');
        } else if (isBeingDragged) {
          glowGrad.addColorStop(0, 'rgba(255,255,255,0.35)');
          glowGrad.addColorStop(1, 'rgba(255,255,255,0)');
        } else {
          glowGrad.addColorStop(0, 'rgba(255,255,255,0.2)');
          glowGrad.addColorStop(1, 'rgba(255,255,255,0)');
        }
        ctx.beginPath();
        ctx.arc(px, py, glowR, 0, TWO_PI);
        ctx.fillStyle = glowGrad;
        ctx.fill();
      }

      // Center always gets a subtle ambient amber glow
      if (isCenter && !isSelected && !isHovered && !isBeingDragged) {
        const glowR = radius + 5;
        const glowGrad = ctx.createRadialGradient(px, py, radius, px, py, glowR);
        glowGrad.addColorStop(0, 'rgba(255,191,64,0.2)');
        glowGrad.addColorStop(1, 'rgba(255,191,64,0)');
        ctx.beginPath();
        ctx.arc(px, py, glowR, 0, TWO_PI);
        ctx.fillStyle = glowGrad;
        ctx.fill();
      }

      // Circle fill & stroke
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, TWO_PI);
      ctx.fillStyle = isSelected ? 'rgba(255,248,230,0.95)' : 'rgba(255,255,255,0.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Inner dot when offset
      if (hasOffset) {
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, TWO_PI);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fill();
      }
    }

    // ── 6. Edge circle ───────────────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(cx, cy, circleR, 0, TWO_PI);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [getCircleGeom]);

  // ─── Schedule draw ──────────────────────────────────────────────────────
  const scheduleDraw = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(drawOverlay);
  }, [drawOverlay]);

  // ─── Resize handling ─────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          const w = Math.floor(width);
          const h = Math.floor(height);
          sizeRef.current = { w, h };
          setCanvasSize({ w, h });
          renderBackground(w, h);
          updateNodesForSize(w, h, nodesRef.current.length > 0);
          setCanvasReady(true);
          scheduleDraw();
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [renderBackground, updateNodesForSize, scheduleDraw]);

  // ─── Redraw on store changes ────────────────────────────────────────────
  useEffect(() => {
    if (!canvasReady) return;
    scheduleDraw();
  }, [canvasReady, scheduleDraw, selectedNodeId, showNodeHelpers]);

  // ─── Find node under cursor ──────────────────────────────────────────────
  const findNodeAt = useCallback((mx: number, my: number): CLMeshNode | null => {
    const nodes = nodesRef.current;
    let closest: CLMeshNode | null = null;
    let closestDist = Infinity;

    for (const node of nodes) {
      const hitR = node.ring === 0 ? CENTER_HIT_RADIUS : NODE_HIT_RADIUS;
      const d = distPt(mx, my, node.currentX, node.currentY);
      if (d < hitR && d < closestDist) {
        closestDist = d;
        closest = node;
      }
    }
    return closest;
  }, []);

  // ─── Canvas coords from mouse event ─────────────────────────────────────
  const getCoords = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // ─── Get affected nodes for a given dragged node ────────────────────────
  const getAffectedNodeIds = useCallback((node: CLMeshNode): Set<string> => {
    const ids = new Set<string>();
    if (node.ring === 0) {
      // Center → affects every node
      for (const n of nodesRef.current) ids.add(n.id);
    } else {
      // Non-center → same branch only
      for (const n of nodesRef.current) {
        if (n.branch === node.branch) ids.add(n.id);
      }
    }
    return ids;
  }, []);

  // ─── Apply drag delta with branch Gaussian falloff ──────────────────────
  const applyDragDelta = useCallback(
    (
      draggedNode: CLMeshNode,
      deltaX: number,
      deltaY: number,
      startOffsets: Map<string, { offsetX: number; offsetY: number }>,
    ) => {
      const { w } = sizeRef.current;
      const maxDrag = w * MAX_DRAG_FRACTION;
      const draggedRing = draggedNode.ring;

      for (const node of nodesRef.current) {
        const start = startOffsets.get(node.id);
        if (!start) continue;

        const ringDist = Math.abs(node.ring - draggedRing);
        const influence = gaussFalloff(ringDist, FALLOFF_SIGMA);

        // eslint-disable-next-line react-hooks/immutability -- intentionally mutating ref-stored objects for canvas perf
        node.offsetX = clamp(start.offsetX + deltaX * influence, -maxDrag, maxDrag);
        node.offsetY = clamp(start.offsetY + deltaY * influence, -maxDrag, maxDrag);
        node.currentX = node.homeX + node.offsetX;
        node.currentY = node.homeY + node.offsetY;
      }
    },
    [],
  );

  // ─── Mouse: Down ────────────────────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getCoords(e);
      const node = findNodeAt(x, y);

      if (node) {
        setSelectedNodeId(node.id);
        isDraggingRef.current = true;

        // Snapshot offsets for all affected nodes
        const affected = getAffectedNodeIds(node);
        const startOffsets = new Map<string, { offsetX: number; offsetY: number }>();
        for (const n of nodesRef.current) {
          if (affected.has(n.id)) {
            startOffsets.set(n.id, { offsetX: n.offsetX, offsetY: n.offsetY });
          }
        }

        dragInfoRef.current = {
          nodeId: node.id,
          branch: node.branch,
          isCenter: node.ring === 0,
          startMouseX: x,
          startMouseY: y,
          startOffsets,
        };

        setTooltip({
          x,
          y,
          chroma: node.chroma,
          luminance: node.luminance,
          offsetX: node.offsetX,
          offsetY: node.offsetY,
          isDragging: true,
        });

        overlayCanvasRef.current?.style.setProperty('cursor', 'grabbing');
      } else {
        setSelectedNodeId(null);
        setTooltip(null);
      }
    },
    [findNodeAt, getCoords, setSelectedNodeId, getAffectedNodeIds],
  );

  // ─── Mouse: Move ────────────────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getCoords(e);

      if (isDraggingRef.current && dragInfoRef.current) {
        const info = dragInfoRef.current;
        const deltaX = x - info.startMouseX;
        const deltaY = y - info.startMouseY;
        const draggedNode = nodesRef.current.find((n) => n.id === info.nodeId);

        if (draggedNode) {
          applyDragDelta(draggedNode, deltaX, deltaY, info.startOffsets);
          scheduleDraw();

          setTooltip({
            x,
            y,
            chroma: draggedNode.chroma,
            luminance: draggedNode.luminance,
            offsetX: Math.round(draggedNode.offsetX * 10) / 10,
            offsetY: Math.round(draggedNode.offsetY * 10) / 10,
            isDragging: true,
          });
        }
      } else {
        const node = findNodeAt(x, y);
        const newHoverId = node?.id ?? null;

        if (newHoverId !== hoverNodeIdRef.current) {
          hoverNodeIdRef.current = newHoverId;
          scheduleDraw();
        }

        if (node) {
          setTooltip({
            x,
            y,
            chroma: node.chroma,
            luminance: node.luminance,
            offsetX: Math.round(node.offsetX * 10) / 10,
            offsetY: Math.round(node.offsetY * 10) / 10,
            isDragging: false,
          });
          overlayCanvasRef.current?.style.setProperty('cursor', 'grab');
        } else {
          setTooltip(null);
          overlayCanvasRef.current?.style.setProperty('cursor', 'default');
        }
      }
    },
    [findNodeAt, getCoords, applyDragDelta, scheduleDraw],
  );

  // ─── Mouse: Up ──────────────────────────────────────────────────────────
  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      dragInfoRef.current = null;
      overlayCanvasRef.current?.style.setProperty('cursor', 'grab');
      scheduleDraw();
    }
  }, [scheduleDraw]);

  // ─── Mouse: Double-click (reset entire branch) ──────────────────────────
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getCoords(e);
      const node = findNodeAt(x, y);
      if (node) {
        const affected = getAffectedNodeIds(node);
        for (const n of nodesRef.current) {
          if (affected.has(n.id)) {
            // eslint-disable-next-line react-hooks/immutability -- intentionally mutating ref-stored objects for canvas perf
            n.offsetX = 0;
            n.offsetY = 0;
            n.currentX = n.homeX;
            n.currentY = n.homeY;
          }
        }
        scheduleDraw();

        setTooltip({
          x,
          y,
          chroma: node.chroma,
          luminance: node.luminance,
          offsetX: 0,
          offsetY: 0,
          isDragging: false,
        });
      }
    },
    [findNodeAt, getCoords, scheduleDraw, getAffectedNodeIds],
  );

  // ─── Mouse: Leave ───────────────────────────────────────────────────────
  const handleMouseLeave = useCallback(() => {
    if (hoverNodeIdRef.current !== null) {
      hoverNodeIdRef.current = null;
      scheduleDraw();
    }
    setTooltip(null);
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      dragInfoRef.current = null;
    }
    overlayCanvasRef.current?.style.setProperty('cursor', 'default');
  }, [scheduleDraw]);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <motion.div
      className={`relative overflow-hidden rounded-xl border border-white/[0.08] bg-neutral-950 shadow-2xl shadow-black/40 ${className}`}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-400/80" />
          <span className="text-[11px] font-medium tracking-wider text-white/40 uppercase">
            Chroma / Luminance
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-white/25">
          <span>Drag nodes to adjust</span>
          <span className="text-white/10">|</span>
          <span>Dbl-click to reset branch</span>
        </div>
      </div>

      {/* Canvas container — square aspect ratio */}
      <div
        ref={containerRef}
        className="relative aspect-square w-full"
        style={{ minHeight: 250 }}
      >
        {/* Background canvas — gradient, only redrawn on resize */}
        <canvas
          ref={bgCanvasRef}
          className="absolute inset-0"
          style={{ display: 'block' }}
        />

        {/* Overlay canvas — mesh fill, lines, helpers, nodes */}
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0"
          style={{ display: 'block' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onDoubleClick={handleDoubleClick}
        />

        {/* Tooltip overlay */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-white/10 bg-neutral-900/90 px-2.5 py-1.5 text-[10px] text-white/70 shadow-lg backdrop-blur-sm"
            style={{
              left: Math.min(tooltip.x + 16, canvasSize.w - 160),
              top: Math.max(tooltip.y - 52, 4),
            }}
          >
            <div className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-sm border border-white/20"
                style={{
                  backgroundColor: `hsl(${CL_BG_HUE}, ${tooltip.chroma}%, ${tooltip.luminance}%)`,
                }}
              />
              <span className="font-medium text-white/90">
                L: {Math.round(tooltip.luminance)}%&nbsp; C:{' '}
                {Math.round(tooltip.chroma)}%
              </span>
            </div>
            {(Math.abs(tooltip.offsetX) > 0.05 || Math.abs(tooltip.offsetY) > 0.05) && (
              <div className="mt-0.5 pl-5 text-white/40">
                Offset: {tooltip.offsetX.toFixed(1)} / {tooltip.offsetY.toFixed(1)}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
