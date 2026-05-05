'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useAppStore, type CLGridNode } from '@/store/useAppStore';
import { hslToRgb, hslString } from '@/lib/colorUtils';

// ─── Props ───────────────────────────────────────────────────────────────────
interface CLGridProps {
  className?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const NODE_RADIUS = 7;
const NODE_HIT_RADIUS = 14;
const PADDING = 0;
const LUM_OFFSET_SCALE = 0.5; // offsetX maps to ±50% luminance shift
const CHROMA_OFFSET_SCALE = 0.5; // offsetY maps to ±50% chroma shift
const CL_BG_HUE = 25; // warm-neutral hue for the background gradient

// ─── Types ───────────────────────────────────────────────────────────────────
interface TooltipData {
  x: number;
  y: number;
  chroma: number;
  luminance: number;
  offsetX: number;
  offsetY: number;
  isDragging: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert luminance (0-100) and chroma (0-100) to canvas pixel coordinates */
function chromaLumToCanvas(
  luminance: number,
  chroma: number,
  w: number,
  h: number
): { x: number; y: number } {
  return {
    x: PADDING + (luminance / 100) * (w - 2 * PADDING),
    y: PADDING + (1 - chroma / 100) * (h - 2 * PADDING), // top = 100% chroma, bottom = 0%
  };
}

/** Convert canvas pixel coordinates to luminance/chroma */
function canvasToChromaLum(
  cx: number,
  cy: number,
  w: number,
  h: number
): { luminance: number; chroma: number } {
  const luminance = ((cx - PADDING) / (w - 2 * PADDING)) * 100;
  const chroma = (1 - (cy - PADDING) / (h - 2 * PADDING)) * 100;
  return {
    luminance: Math.max(0, Math.min(100, luminance)),
    chroma: Math.max(0, Math.min(100, chroma)),
  };
}

/** Compute the offset in chroma/lum units from a pixel delta */
function pixelDeltaToCLDelta(dx: number, dy: number, w: number, h: number) {
  return {
    dlum: (dx / (w - 2 * PADDING)) * 100,
    dchroma: -(dy / (h - 2 * PADDING)) * 100,
  };
}

/** Get distance between two points */
function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function CLGrid({ className = '' }: CLGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Interaction state
  const [isDragging, setIsDragging] = useState(false);
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    nodeChroma: number;
    nodeLum: number;
    origOffsetX: number;
    origOffsetY: number;
  } | null>(null);

  // Zustand store
  const clNodes = useAppStore((s) => s.clNodes);
  const updateCLNode = useAppStore((s) => s.updateCLNode);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useAppStore((s) => s.setSelectedNodeId);
  const showNodeHelpers = useAppStore((s) => s.showNodeHelpers);

  // ─── Node map for quick lookup ───────────────────────────────────────────
  const nodeMap = useMemo(() => {
    const map = new Map<string, CLGridNode>();
    for (const node of clNodes) map.set(node.id, node);
    return map;
  }, [clNodes]);

  // ─── Nodes grouped by chroma for bezier curves ──────────────────────────
  const nodesByChroma = useMemo(() => {
    const groups = new Map<number, CLGridNode[]>();
    for (const node of clNodes) {
      const c = node.chroma;
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c)!.push(node);
    }
    // Sort each group by luminance
    for (const [, nodes] of groups) {
      nodes.sort((a, b) => a.luminance - b.luminance);
    }
    return groups;
  }, [clNodes]);

  // ─── Render the background chroma-luminance gradient ────────────────────
  const renderBackground = useCallback(
    (w: number, h: number) => {
      const bgCanvas = bgCanvasRef.current;
      if (!bgCanvas) return;
      bgCanvas.width = w * window.devicePixelRatio;
      bgCanvas.height = h * window.devicePixelRatio;
      bgCanvas.style.width = `${w}px`;
      bgCanvas.style.height = `${h}px`;
      const bgCtx = bgCanvas.getContext('2d');
      if (!bgCtx) return;
      bgCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

      // Use ImageData for fast pixel-by-pixel rendering
      const imageData = bgCtx.createImageData(w, h);
      const data = imageData.data;

      for (let y = 0; y < h; y++) {
        const chromaRatio = 1 - y / h; // top = 100% chroma, bottom = 0%
        for (let x = 0; x < w; x++) {
          const lum = (x / w) * 100;
          const chroma = chromaRatio * 100;
          // Use a warm-neutral hue to visualize chroma range
          const [r, g, b] = hslToRgb(CL_BG_HUE, chroma, lum);
          const idx = (y * w + x) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 255;
        }
      }

      bgCtx.putImageData(imageData, 0, 0);
    },
    []
  );

  // ─── Main draw function ──────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
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

    // 1. Clear and draw background
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bgCanvas, 0, 0, w, h);

    // 2. Subtle vignette overlay for depth
    const vigGrad = ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.75);
    vigGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vigGrad.addColorStop(1, 'rgba(0, 0, 0, 0.15)');
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, w, h);

    // 3. Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;

    // Vertical lines (luminance divisions — every 10%)
    for (let i = 0; i <= 10; i++) {
      const lum = i * 10;
      const { x } = chromaLumToCanvas(lum, 0, w, h);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Horizontal lines (chroma divisions — every 10%)
    for (let i = 0; i <= 10; i++) {
      const chroma = i * 10;
      const { y } = chromaLumToCanvas(0, chroma, w, h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Highlight the 25%, 50%, 75% grid lines slightly more
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;

    // Vertical highlights at 25, 50, 75 luminance
    for (const lum of [25, 50, 75]) {
      const { x } = chromaLumToCanvas(lum, 0, w, h);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Horizontal highlights at 25, 50, 75 chroma
    for (const chroma of [25, 50, 75]) {
      const { y } = chromaLumToCanvas(0, chroma, w, h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 4. Bezier curves connecting nodes per chroma row
    for (const [, chromaNodes] of nodesByChroma) {
      if (chromaNodes.length < 2) continue;

      // Draw the reference curve through original node positions
      ctx.beginPath();
      const first = chromaNodes[0];
      const firstPos = chromaLumToCanvas(first.luminance, first.chroma, w, h);
      ctx.moveTo(firstPos.x, firstPos.y);

      for (let i = 1; i < chromaNodes.length; i++) {
        const prev = chromaNodes[i - 1];
        const curr = chromaNodes[i];
        const prevPos = chromaLumToCanvas(prev.luminance, prev.chroma, w, h);
        const currPos = chromaLumToCanvas(curr.luminance, curr.chroma, w, h);
        const cpx = (prevPos.x + currPos.x) / 2;
        ctx.quadraticCurveTo(prevPos.x, prevPos.y, cpx, (prevPos.y + currPos.y) / 2);
      }
      const lastNode = chromaNodes[chromaNodes.length - 1];
      const lastPos = chromaLumToCanvas(lastNode.luminance, lastNode.chroma, w, h);
      ctx.lineTo(lastPos.x, lastPos.y);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw the offset curve (showing the tonal bend)
      ctx.beginPath();
      const firstOffsetLum = first.luminance + first.offsetX * LUM_OFFSET_SCALE;
      const firstOffsetChroma = Math.max(0, Math.min(100, first.chroma + first.offsetY * CHROMA_OFFSET_SCALE));
      const firstOff = chromaLumToCanvas(firstOffsetLum, firstOffsetChroma, w, h);
      ctx.moveTo(firstOff.x, firstOff.y);

      for (let i = 1; i < chromaNodes.length; i++) {
        const prev = chromaNodes[i - 1];
        const curr = chromaNodes[i];
        const prevOffLum = prev.luminance + prev.offsetX * LUM_OFFSET_SCALE;
        const prevOffChroma = Math.max(0, Math.min(100, prev.chroma + prev.offsetY * CHROMA_OFFSET_SCALE));
        const currOffLum = curr.luminance + curr.offsetX * LUM_OFFSET_SCALE;
        const currOffChroma = Math.max(0, Math.min(100, curr.chroma + curr.offsetY * CHROMA_OFFSET_SCALE));
        const prevOff = chromaLumToCanvas(prevOffLum, prevOffChroma, w, h);
        const currOff = chromaLumToCanvas(currOffLum, currOffChroma, w, h);
        const cpx = (prevOff.x + currOff.x) / 2;
        ctx.quadraticCurveTo(prevOff.x, prevOff.y, cpx, (prevOff.y + currOff.y) / 2);
      }
      const lastOffLum = lastNode.luminance + lastNode.offsetX * LUM_OFFSET_SCALE;
      const lastOffChroma = Math.max(0, Math.min(100, lastNode.chroma + lastNode.offsetY * CHROMA_OFFSET_SCALE));
      const lastOff = chromaLumToCanvas(lastOffLum, lastOffChroma, w, h);
      ctx.lineTo(lastOff.x, lastOff.y);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 5. Draw helper lines and nodes
    for (const node of clNodes) {
      const basePos = chromaLumToCanvas(node.luminance, node.chroma, w, h);
      const offsetLum = node.luminance + node.offsetX * LUM_OFFSET_SCALE;
      const offsetChroma = Math.max(0, Math.min(100, node.chroma + node.offsetY * CHROMA_OFFSET_SCALE));
      const offsetPos = chromaLumToCanvas(offsetLum, offsetChroma, w, h);

      const isSelected = node.id === selectedNodeId;
      const isHovered = node.id === hoverNodeId;
      const isBeingDragged = node.id === dragNodeId && isDragging;
      const hasOffset = node.offsetX !== 0 || node.offsetY !== 0;

      // Helper line from original to offset position
      if (showNodeHelpers && hasOffset) {
        ctx.beginPath();
        ctx.moveTo(basePos.x, basePos.y);
        ctx.lineTo(offsetPos.x, offsetPos.y);
        ctx.strokeStyle = isSelected
          ? 'rgba(255, 255, 255, 0.7)'
          : 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Origin dot (small)
        ctx.beginPath();
        ctx.arc(basePos.x, basePos.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fill();
      }

      // Glow effect for selected or hovered
      if (isSelected || isHovered || isBeingDragged) {
        ctx.beginPath();
        ctx.arc(offsetPos.x, offsetPos.y, NODE_RADIUS + 6, 0, Math.PI * 2);
        const glowGrad = ctx.createRadialGradient(
          offsetPos.x, offsetPos.y, NODE_RADIUS,
          offsetPos.x, offsetPos.y, NODE_RADIUS + 6
        );
        if (isSelected) {
          glowGrad.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
          glowGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        } else {
          glowGrad.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
          glowGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        }
        ctx.fillStyle = glowGrad;
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(offsetPos.x, offsetPos.y, isBeingDragged ? NODE_RADIUS + 2 : NODE_RADIUS, 0, Math.PI * 2);

      // Fill with the neutral color at the offset position
      const [nr, ng, nb] = hslToRgb(CL_BG_HUE, node.chroma, node.luminance);
      ctx.fillStyle = `rgb(${nr}, ${ng}, ${nb})`;
      ctx.fill();

      // White border
      ctx.strokeStyle = isSelected
        ? 'rgba(255, 255, 255, 1)'
        : isHovered
          ? 'rgba(255, 255, 255, 0.85)'
          : 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = isSelected ? 2.5 : 2;
      ctx.stroke();

      // Dark border for contrast (outside white border)
      ctx.beginPath();
      ctx.arc(offsetPos.x, offsetPos.y, isBeingDragged ? NODE_RADIUS + 3.5 : NODE_RADIUS + 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = isSelected
        ? 'rgba(0, 0, 0, 0.5)'
        : isHovered
          ? 'rgba(0, 0, 0, 0.35)'
          : 'rgba(0, 0, 0, 0.25)';
      ctx.lineWidth = isSelected ? 1.5 : 1;
      ctx.stroke();

      // Inner dot (offset indicator)
      if (hasOffset) {
        ctx.beginPath();
        ctx.arc(offsetPos.x, offsetPos.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fill();
      }
    }

    // 6. Axis labels
    ctx.save();
    ctx.font = '9px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';

    // Luminance labels along the bottom
    const lumLabels = [0, 25, 50, 75, 100];
    for (const lum of lumLabels) {
      const { x } = chromaLumToCanvas(lum, 0, w, h);
      ctx.textAlign = 'center';
      ctx.fillText(`${lum}%`, x, h - 4);
    }

    // Chroma labels along the left side
    const chromaLabels = [100, 75, 50, 25, 0];
    for (const chroma of chromaLabels) {
      const { y } = chromaLumToCanvas(0, chroma, w, h);
      ctx.textAlign = 'left';
      ctx.fillText(`${chroma}%`, 3, y - 3);
    }
    ctx.restore();

    // 7. Axis titles (small, subtle)
    ctx.save();
    ctx.font = '8px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';

    // X-axis title (Luminance)
    ctx.textAlign = 'center';
    ctx.fillText('LUMINANCE', w / 2, h - 14);

    // Y-axis title (Chroma) — rotated
    ctx.save();
    ctx.translate(14, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('CHROMA', 0, 0);
    ctx.restore();

    ctx.restore();
  }, [
    clNodes,
    selectedNodeId,
    hoverNodeId,
    dragNodeId,
    isDragging,
    showNodeHelpers,
    nodesByChroma,
  ]);

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
          setCanvasReady(true);
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(draw);
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [renderBackground, draw]);

  // ─── Redraw when dependencies change ─────────────────────────────────────
  useEffect(() => {
    if (!canvasReady) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw, canvasReady]);

  // ─── Find node under cursor ──────────────────────────────────────────────
  const findNodeAt = useCallback(
    (cx: number, cy: number): string | null => {
      const { w, h } = sizeRef.current;
      let closestId: string | null = null;
      let closestDist = Infinity;

      for (const node of clNodes) {
        const offsetLum = node.luminance + node.offsetX * LUM_OFFSET_SCALE;
        const offsetChroma = Math.max(0, Math.min(100, node.chroma + node.offsetY * CHROMA_OFFSET_SCALE));
        const pos = chromaLumToCanvas(offsetLum, offsetChroma, w, h);
        const d = dist(cx, cy, pos.x, pos.y);
        if (d < NODE_HIT_RADIUS && d < closestDist) {
          closestDist = d;
          closestId = node.id;
        }
      }
      return closestId;
    },
    [clNodes]
  );

  // ─── Mouse event handlers ────────────────────────────────────────────────
  const getCanvasCoords = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getCanvasCoords(e);
      const nodeId = findNodeAt(x, y);

      if (nodeId) {
        const node = nodeMap.get(nodeId);
        if (node) {
          setSelectedNodeId(nodeId);
          setIsDragging(true);
          setDragNodeId(nodeId);
          dragStartRef.current = {
            x,
            y,
            nodeChroma: node.chroma,
            nodeLum: node.luminance,
            origOffsetX: node.offsetX,
            origOffsetY: node.offsetY,
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
        }
      } else {
        setSelectedNodeId(null);
        setTooltip(null);
      }
    },
    [findNodeAt, nodeMap, setSelectedNodeId, getCanvasCoords]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getCanvasCoords(e);

      if (isDragging && dragNodeId && dragStartRef.current) {
        const start = dragStartRef.current;
        const { w, h } = sizeRef.current;
        const dx = x - start.x;
        const dy = y - start.y;
        const { dlum, dchroma } = pixelDeltaToCLDelta(dx, dy, w, h);

        // Scale pixel deltas to offset range (-100..100)
        const newOffsetX = start.origOffsetX + (dlum / 100) * 100;
        const newOffsetY = start.origOffsetY + (dchroma / 100) * 100;

        const clampedX = Math.max(-100, Math.min(100, newOffsetX));
        const clampedY = Math.max(-100, Math.min(100, newOffsetY));

        updateCLNode(dragNodeId, clampedX, clampedY);

        const node = nodeMap.get(dragNodeId);
        if (node) {
          setTooltip({
            x,
            y,
            chroma: node.chroma,
            luminance: node.luminance,
            offsetX: Math.round(clampedX * 10) / 10,
            offsetY: Math.round(clampedY * 10) / 10,
            isDragging: true,
          });
        }
      } else {
        // Hover detection
        const nodeId = findNodeAt(x, y);
        setHoverNodeId(nodeId);

        if (nodeId) {
          const node = nodeMap.get(nodeId);
          if (node) {
            setTooltip({
              x,
              y,
              chroma: node.chroma,
              luminance: node.luminance,
              offsetX: node.offsetX,
              offsetY: node.offsetY,
              isDragging: false,
            });
            canvasRef.current?.style.setProperty('cursor', 'grab');
          }
        } else {
          setTooltip(null);
          canvasRef.current?.style.setProperty('cursor', 'default');
        }
      }
    },
    [
      isDragging,
      dragNodeId,
      findNodeAt,
      updateCLNode,
      nodeMap,
      getCanvasCoords,
    ]
  );

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      setDragNodeId(null);
      dragStartRef.current = null;
    }
  }, [isDragging]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getCanvasCoords(e);
      const nodeId = findNodeAt(x, y);
      if (nodeId) {
        updateCLNode(nodeId, 0, 0);
      }
    },
    [findNodeAt, updateCLNode, getCanvasCoords]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverNodeId(null);
    setTooltip(null);
    if (isDragging) {
      setIsDragging(false);
      setDragNodeId(null);
      dragStartRef.current = null;
    }
  }, [isDragging]);

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
          <span>Drag to bend</span>
          <span className="text-white/10">|</span>
          <span>Double-click to reset</span>
        </div>
      </div>

      {/* Canvas container */}
      <div
        ref={containerRef}
        className="relative aspect-[16/10] w-full"
        style={{ minHeight: 200 }}
      >
        {/* Background canvas (only redrawn on resize) */}
        <canvas
          ref={bgCanvasRef}
          className="absolute inset-0 rounded-b-[11px]"
          style={{ display: 'block' }}
        />

        {/* Overlay canvas (redrawn on every interaction) */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 rounded-b-[11px]"
          style={{ display: 'block' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onDoubleClick={handleDoubleClick}
        />

        {/* Tooltip */}
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
                  backgroundColor: hslString(CL_BG_HUE, tooltip.chroma, tooltip.luminance),
                }}
              />
              <span className="font-medium text-white/90">
                L: {Math.round(tooltip.luminance)}% C: {Math.round(tooltip.chroma)}%
              </span>
            </div>
            {(tooltip.offsetX !== 0 || tooltip.offsetY !== 0) && (
              <div className="mt-0.5 pl-5 text-white/40">
                Offset: {tooltip.offsetX.toFixed(1)}L / {tooltip.offsetY.toFixed(1)}C
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
