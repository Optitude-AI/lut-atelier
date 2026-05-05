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
  row: number;       // 0-6 (chroma level index)
  col: number;       // 0-8 (luminance level index)
  homeX: number;     // pixel home X
  homeY: number;     // pixel home Y
  currentX: number;  // pixel current X (= homeX + offsetX)
  currentY: number;  // pixel current Y (= homeY + offsetY)
  offsetX: number;   // pixel offset X from home
  offsetY: number;   // pixel offset Y from home
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
const NODE_HIT_RADIUS = 12;
const ROWS = 7;
const COLS = 9;
const CL_BG_HUE = 25; // warm-neutral hue

// 7 chroma levels: 0%, 15%, 30%, 45%, 60%, 80%, 100%
const CHROMA_LEVELS = [0, 15, 30, 45, 60, 80, 100];
// 9 luminance levels: 0%, 12.5%, 25%, 37.5%, 50%, 62.5%, 75%, 87.5%, 100%
const LUM_LEVELS = [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];

const FALLOFF_SIGMA = 1.8;        // Gaussian falloff in column units
const MAX_DRAG_FRACTION = 0.12;   // max drag as fraction of canvas dimension
const DATA_PAD = 6;               // inner padding for the data area

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compute pixel home position from row/col and canvas size */
function getHomePos(row: number, col: number, w: number, h: number) {
  const lumFrac = LUM_LEVELS[col] / 100;
  const chromaFrac = CHROMA_LEVELS[row] / 100;
  return {
    x: DATA_PAD + lumFrac * (w - 2 * DATA_PAD),
    y: DATA_PAD + (1 - chromaFrac) * (h - 2 * DATA_PAD),
  };
}

/** Euclidean distance */
function distPt(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Gaussian falloff: 1.0 at distance 0, decays to ~0 at distance ~3*sigma */
function gaussFalloff(distance: number, sigma: number): number {
  return Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

/** Generate the full grid of mesh nodes */
function generateNodes(w: number, h: number): CLMeshNode[] {
  const nodes: CLMeshNode[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const { x, y } = getHomePos(r, c, w, h);
      nodes.push({
        id: `cl-${r}-${c}`,
        row: r,
        col: c,
        homeX: x,
        homeY: y,
        currentX: x,
        currentY: y,
        offsetX: 0,
        offsetY: 0,
      });
    }
  }
  return nodes;
}

/** Get a node from the flat array by row/col (row-major order) */
function getNode(nodes: CLMeshNode[], row: number, col: number): CLMeshNode {
  return nodes[row * COLS + col];
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function CLGrid({ className = '' }: CLGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<CLMeshNode[]>([]);
  const rafRef = useRef<number>(0);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Interaction state (use refs for high-frequency values to avoid re-creating drawOverlay)
  const isDraggingRef = useRef(false);
  const hoverNodeIdRef = useRef<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);

  // Drag tracking
  const dragInfoRef = useRef<{
    nodeId: string;
    row: number;
    col: number;
    startMouseX: number;
    startMouseY: number;
    startOffsets: Map<number, { offsetX: number; offsetY: number }>;
  } | null>(null);

  // Zustand store (for selectedNodeId, showNodeHelpers)
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useAppStore((s) => s.setSelectedNodeId);
  const showNodeHelpers = useAppStore((s) => s.showNodeHelpers);

  // ─── Render background gradient ──────────────────────────────────────────
  // Warm-neutral gradient: X = luminance (0→100), Y = chroma (100→0 from top to bottom)
  const renderBackground = useCallback((w: number, h: number) => {
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

    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;
    for (let y = 0; y < h; y++) {
      const chromaRatio = 1 - y / h; // top=100% chroma, bottom=0%
      const chroma = chromaRatio * 100;
      for (let x = 0; x < w; x++) {
        const lum = (x / w) * 100;
        const [r, g, b] = hslToRgb(CL_BG_HUE, chroma, lum);
        const idx = (y * w + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, []);

  // ─── Update node home positions on resize ────────────────────────────────
  const updateNodesForSize = useCallback(
    (w: number, h: number, preserveOffsets = false) => {
      const oldW = sizeRef.current.w;
      const oldH = sizeRef.current.h;

      if (preserveOffsets && oldW > 0 && oldH > 0 && nodesRef.current.length > 0) {
        const scaleX = w / oldW;
        const scaleY = h / oldH;
        for (const node of nodesRef.current) {
          const pos = getHomePos(node.row, node.col, w, h);
          node.offsetX *= scaleX;
          node.offsetY *= scaleY;
          node.homeX = pos.x;
          node.homeY = pos.y;
          node.currentX = pos.x + node.offsetX;
          node.currentY = pos.y + node.offsetY;
        }
      } else {
        nodesRef.current = generateNodes(w, h);
      }
    },
    []
  );

  // ─── Draw overlay (mesh fill + mesh lines + helpers + nodes + labels) ────
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

    // Read dynamic values from refs/store
    const currentSelectedId = useAppStore.getState().selectedNodeId;
    const helpersVisible = useAppStore.getState().showNodeHelpers;
    const isDragging = isDraggingRef.current;
    const dragNodeId = dragInfoRef.current?.nodeId ?? null;
    const currentHoverId = hoverNodeIdRef.current;

    // ── 1. Background ────────────────────────────────────────────────────
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bgCanvas, 0, 0, w, h);

    // Subtle vignette for depth
    const vigGrad = ctx.createRadialGradient(
      w / 2, h / 2, w * 0.25,
      w / 2, h / 2, w * 0.8
    );
    vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vigGrad.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, w, h);

    // ── 2. Colored mesh fill (each cell filled with warm color) ───────────
    for (let r = 0; r < ROWS - 1; r++) {
      for (let c = 0; c < COLS - 1; c++) {
        const tl = getNode(nodes, r, c);
        const tr = getNode(nodes, r, c + 1);
        const bl = getNode(nodes, r + 1, c);
        const br = getNode(nodes, r + 1, c + 1);

        // Centroid for color sampling
        const cx = (tl.currentX + tr.currentX + bl.currentX + br.currentX) / 4;
        const cy = (tl.currentY + tr.currentY + bl.currentY + br.currentY) / 4;

        // Map centroid back to chroma/luminance
        const lumSample = clamp(((cx - DATA_PAD) / (w - 2 * DATA_PAD)) * 100, 0, 100);
        const chromaSample = clamp(
          (1 - (cy - DATA_PAD) / (h - 2 * DATA_PAD)) * 100,
          0,
          100
        );
        const [fr, fg, fb] = hslToRgb(CL_BG_HUE, chromaSample, lumSample);
        const fillColor = `rgba(${fr},${fg},${fb},0.35)`;

        // Triangle 1: top-left, bottom-left, top-right
        ctx.beginPath();
        ctx.moveTo(tl.currentX, tl.currentY);
        ctx.lineTo(bl.currentX, bl.currentY);
        ctx.lineTo(tr.currentX, tr.currentY);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();

        // Triangle 2: top-right, bottom-left, bottom-right
        ctx.beginPath();
        ctx.moveTo(tr.currentX, tr.currentY);
        ctx.lineTo(bl.currentX, bl.currentY);
        ctx.lineTo(br.currentX, br.currentY);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
      }
    }

    // ── 3. Mesh lines (connecting adjacent nodes) ────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.75;

    // Horizontal lines (across columns for each row)
    for (let r = 0; r < ROWS; r++) {
      ctx.beginPath();
      const first = getNode(nodes, r, 0);
      ctx.moveTo(first.currentX, first.currentY);
      for (let c = 1; c < COLS; c++) {
        const node = getNode(nodes, r, c);
        ctx.lineTo(node.currentX, node.currentY);
      }
      ctx.stroke();
    }

    // Vertical lines (across rows for each column)
    for (let c = 0; c < COLS; c++) {
      ctx.beginPath();
      const first = getNode(nodes, 0, c);
      ctx.moveTo(first.currentX, first.currentY);
      for (let r = 1; r < ROWS; r++) {
        const node = getNode(nodes, r, c);
        ctx.lineTo(node.currentX, node.currentY);
      }
      ctx.stroke();
    }

    // ── 4. Helper lines (dashed from home to current position) ───────────
    if (helpersVisible) {
      ctx.setLineDash([3, 3]);
      for (const node of nodes) {
        if (node.offsetX === 0 && node.offsetY === 0) continue;
        const isSel = node.id === currentSelectedId;

        ctx.beginPath();
        ctx.moveTo(node.homeX, node.homeY);
        ctx.lineTo(node.currentX, node.currentY);
        ctx.strokeStyle = isSel
          ? 'rgba(255,255,255,0.6)'
          : 'rgba(255,255,255,0.25)';
        ctx.lineWidth = isSel ? 1.2 : 0.8;
        ctx.stroke();

        // Small origin dot at home position
        ctx.beginPath();
        ctx.arc(node.homeX, node.homeY, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fill();
      }
      ctx.setLineDash([]);
    }

    // ── 5. Draw nodes ────────────────────────────────────────────────────
    for (const node of nodes) {
      const isSelected = node.id === currentSelectedId;
      const isHovered = node.id === currentHoverId;
      const isBeingDragged = isDragging && node.id === dragNodeId;
      const hasOffset = node.offsetX !== 0 || node.offsetY !== 0;
      const px = node.currentX;
      const py = node.currentY;
      const radius = isBeingDragged ? NODE_RADIUS + 1.5 : NODE_RADIUS;

      // Glow for selected / hovered / dragged
      if (isSelected || isHovered || isBeingDragged) {
        const glowR = radius + 7;
        const glowGrad = ctx.createRadialGradient(
          px, py, radius,
          px, py, glowR
        );
        if (isSelected) {
          // Amber glow for selected
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
        ctx.arc(px, py, glowR, 0, Math.PI * 2);
        ctx.fillStyle = glowGrad;
        ctx.fill();
      }

      // Node circle — white fill, dark border
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = isSelected
        ? 'rgba(255,248,230,0.95)'
        : 'rgba(255,255,255,0.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Inner dot to indicate offset
      if (hasOffset) {
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fill();
      }
    }

    // ── 6. Axis labels ──────────────────────────────────────────────────
    ctx.save();
    ctx.font = '9px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';

    // Luminance labels along bottom
    const lumLabels = [0, 25, 50, 75, 100];
    for (const lum of lumLabels) {
      const x = DATA_PAD + (lum / 100) * (w - 2 * DATA_PAD);
      ctx.textAlign = 'center';
      ctx.fillText(`${lum}%`, x, h - 3);
    }

    // Chroma labels along left
    const chromaLabels = [100, 75, 50, 25, 0];
    for (const chroma of chromaLabels) {
      const y = DATA_PAD + (1 - chroma / 100) * (h - 2 * DATA_PAD);
      ctx.textAlign = 'left';
      ctx.fillText(`${chroma}%`, 3, y - 4);
    }
    ctx.restore();

    // ── 7. Axis titles ──────────────────────────────────────────────────
    ctx.save();
    ctx.font = '8px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.2)';

    // X-axis title
    ctx.textAlign = 'center';
    ctx.fillText('LUMINANCE', w / 2, h - 13);

    // Y-axis title (rotated)
    ctx.save();
    ctx.translate(14, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('CHROMA', 0, 0);
    ctx.restore();

    ctx.restore();
  }, []);

  // ─── Schedule a draw on next animation frame ──────────────────────────────
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

  // ─── Redraw on store changes (selectedNodeId, showNodeHelpers) ──────────
  useEffect(() => {
    if (!canvasReady) return;
    scheduleDraw();
  }, [canvasReady, scheduleDraw, selectedNodeId, showNodeHelpers]);

  // ─── Find node under cursor ──────────────────────────────────────────────
  const findNodeAt = useCallback(
    (cx: number, cy: number): CLMeshNode | null => {
      const nodes = nodesRef.current;
      let closest: CLMeshNode | null = null;
      let closestDist = NODE_HIT_RADIUS;

      for (const node of nodes) {
        const d = distPt(cx, cy, node.currentX, node.currentY);
        if (d < closestDist) {
          closestDist = d;
          closest = node;
        }
      }
      return closest;
    },
    []
  );

  // ─── Canvas coords from mouse event ─────────────────────────────────────
  const getCoords = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    []
  );

  // ─── Apply drag delta to a row with falloff ─────────────────────────────
  const applyDragDelta = useCallback(
    (
      row: number,
      dragCol: number,
      deltaX: number,
      deltaY: number,
      startOffsets: Map<number, { offsetX: number; offsetY: number }>
    ) => {
      const { w, h } = sizeRef.current;
      const maxX = w * MAX_DRAG_FRACTION;
      const maxY = h * MAX_DRAG_FRACTION;
      const nodes = nodesRef.current;

      for (let c = 0; c < COLS; c++) {
        const node = getNode(nodes, row, c);
        const start = startOffsets.get(c);
        if (!start) continue;

        const distance = Math.abs(c - dragCol);
        const influence = gaussFalloff(distance, FALLOFF_SIGMA);

        node.offsetX = clamp(start.offsetX + deltaX * influence, -maxX, maxX);
        node.offsetY = clamp(start.offsetY + deltaY * influence, -maxY, maxY);
        node.currentX = node.homeX + node.offsetX;
        node.currentY = node.homeY + node.offsetY;
      }
    },
    []
  );

  // ─── Mouse: Down ────────────────────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getCoords(e);
      const node = findNodeAt(x, y);

      if (node) {
        setSelectedNodeId(node.id);
        isDraggingRef.current = true;

        // Snapshot all offsets on this row
        const startOffsets = new Map<
          number,
          { offsetX: number; offsetY: number }
        >();
        const nodes = nodesRef.current;
        for (let c = 0; c < COLS; c++) {
          const rn = getNode(nodes, node.row, c);
          startOffsets.set(c, { offsetX: rn.offsetX, offsetY: rn.offsetY });
        }

        dragInfoRef.current = {
          nodeId: node.id,
          row: node.row,
          col: node.col,
          startMouseX: x,
          startMouseY: y,
          startOffsets,
        };

        setTooltip({
          x,
          y,
          chroma: CHROMA_LEVELS[node.row],
          luminance: LUM_LEVELS[node.col],
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
    [findNodeAt, getCoords, setSelectedNodeId]
  );

  // ─── Mouse: Move ────────────────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getCoords(e);

      if (isDraggingRef.current && dragInfoRef.current) {
        const info = dragInfoRef.current;
        const deltaX = x - info.startMouseX;
        const deltaY = y - info.startMouseY;

        applyDragDelta(info.row, info.col, deltaX, deltaY, info.startOffsets);
        scheduleDraw();

        const node = getNode(nodesRef.current, info.row, info.col);
        setTooltip({
          x,
          y,
          chroma: CHROMA_LEVELS[info.row],
          luminance: LUM_LEVELS[info.col],
          offsetX: Math.round(node.offsetX * 10) / 10,
          offsetY: Math.round(node.offsetY * 10) / 10,
          isDragging: true,
        });
      } else {
        const node = findNodeAt(x, y);
        const newHoverId = node?.id ?? null;

        // Update hover ref and schedule redraw for glow
        if (newHoverId !== hoverNodeIdRef.current) {
          hoverNodeIdRef.current = newHoverId;
          scheduleDraw();
        }

        if (node) {
          setTooltip({
            x,
            y,
            chroma: CHROMA_LEVELS[node.row],
            luminance: LUM_LEVELS[node.col],
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
    [findNodeAt, getCoords, applyDragDelta, scheduleDraw]
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

  // ─── Mouse: Double-click (reset entire row) ─────────────────────────────
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getCoords(e);
      const node = findNodeAt(x, y);
      if (node) {
        const nodes = nodesRef.current;
        for (let c = 0; c < COLS; c++) {
          const rn = getNode(nodes, node.row, c);
          rn.offsetX = 0;
          rn.offsetY = 0;
          rn.currentX = rn.homeX;
          rn.currentY = rn.homeY;
        }
        scheduleDraw();

        // Update tooltip
        setTooltip({
          x,
          y,
          chroma: CHROMA_LEVELS[node.row],
          luminance: LUM_LEVELS[node.col],
          offsetX: 0,
          offsetY: 0,
          isDragging: false,
        });
      }
    },
    [findNodeAt, getCoords, scheduleDraw]
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
            C/L Chroma–Luminance
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-white/25">
          <span>Drag to deform mesh</span>
          <span className="text-white/10">|</span>
          <span>Dbl-click row to reset</span>
        </div>
      </div>

      {/* Canvas container */}
      <div
        ref={containerRef}
        className="relative aspect-[16/10] w-full"
        style={{ minHeight: 200 }}
      >
        {/* Background canvas — gradient, only redrawn on resize */}
        <canvas
          ref={bgCanvasRef}
          className="absolute inset-0"
          style={{ display: 'block' }}
        />

        {/* Overlay canvas — mesh fill, lines, helpers, nodes, labels */}
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
              left: Math.min(tooltip.x + 16, canvasSize.w - 175),
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
            {(Math.abs(tooltip.offsetX) > 0.05 ||
              Math.abs(tooltip.offsetY) > 0.05) && (
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
