'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useAppStore, type GridNode } from '@/store/useAppStore';
import { hslToRgb, isSkinToneHue, hslString } from '@/lib/colorUtils';

// ─── Props ───────────────────────────────────────────────────────────────────
interface ABGridProps {
  className?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const NODE_RADIUS = 7;
const NODE_HIT_RADIUS = 14;
const SKIN_TONE_HUE_MIN = 10;
const SKIN_TONE_HUE_MAX = 50;
const GRID_LINE_HUES = 12; // lines every 30°
const GRID_LINE_SATS = 4;  // lines at 25%, 50%, 75%
const PADDING = 0; // internal canvas padding

// ─── Types ───────────────────────────────────────────────────────────────────
interface TooltipData {
  x: number;
  y: number;
  hue: number;
  saturation: number;
  offsetX: number;
  offsetY: number;
  isDragging: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a hue (0-360) and saturation (0-100) to canvas pixel coordinates */
function hueSatToCanvas(
  hue: number,
  saturation: number,
  w: number,
  h: number
): { x: number; y: number } {
  return {
    x: PADDING + (hue / 360) * (w - 2 * PADDING),
    y: PADDING + (1 - saturation / 100) * (h - 2 * PADDING), // top = 100%, bottom = 0%
  };
}

/** Convert canvas pixel coordinates to hue/saturation */
function canvasToHueSat(
  cx: number,
  cy: number,
  w: number,
  h: number
): { hue: number; saturation: number } {
  const hue = ((cx - PADDING) / (w - 2 * PADDING)) * 360;
  const saturation = (1 - (cy - PADDING) / (h - 2 * PADDING)) * 100;
  return {
    hue: Math.max(0, Math.min(360, hue)),
    saturation: Math.max(0, Math.min(100, saturation)),
  };
}

/** Compute the offset in hue/sat units from a pixel delta */
function pixelDeltaToHueSatDelta(dx: number, dy: number, w: number, h: number) {
  return {
    dhue: (dx / (w - 2 * PADDING)) * 360,
    dsat: -(dy / (h - 2 * PADDING)) * 100,
  };
}

/** Get distance between two points */
function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function ABGrid({ className = '' }: ABGridProps) {
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
  const dragStartRef = useRef<{ x: number; y: number; nodeHue: number; nodeSat: number; origOffsetX: number; origOffsetY: number } | null>(null);

  // Zustand store
  const abNodes = useAppStore((s) => s.abNodes);
  const updateABNode = useAppStore((s) => s.updateABNode);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useAppStore((s) => s.setSelectedNodeId);
  const showNodeHelpers = useAppStore((s) => s.showNodeHelpers);
  const showSkinToneLine = useAppStore((s) => s.settings.showSkinToneLine);

  // ─── Node map for quick lookup ───────────────────────────────────────────
  const nodeMap = useMemo(() => {
    const map = new Map<string, GridNode>();
    for (const node of abNodes) map.set(node.id, node);
    return map;
  }, [abNodes]);

  // ─── Nodes grouped by saturation for bezier curves ───────────────────────
  const nodesBySat = useMemo(() => {
    const groups = new Map<number, GridNode[]>();
    for (const node of abNodes) {
      const sat = node.saturation;
      if (!groups.has(sat)) groups.set(sat, []);
      groups.get(sat)!.push(node);
    }
    // Sort each group by hue
    for (const [, nodes] of groups) {
      nodes.sort((a, b) => a.hue - b.hue);
    }
    return groups;
  }, [abNodes]);

  // ─── Render the background hue-saturation spectrum ───────────────────────
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
        const satRatio = 1 - y / h; // top = 100%, bottom = 0%
        for (let x = 0; x < w; x++) {
          const hue = (x / w) * 360;
          const sat = satRatio * 100;
          const [r, g, b] = hslToRgb(hue, sat, 50);
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

    // 2. Skin tone indicator
    if (showSkinToneLine) {
      const x1 = hueSatToCanvas(SKIN_TONE_HUE_MIN, 0, w, h).x;
      const x2 = hueSatToCanvas(SKIN_TONE_HUE_MAX, 0, w, h).x;

      // Subtle warm overlay
      const grad = ctx.createLinearGradient(x1, 0, x2, 0);
      grad.addColorStop(0, 'rgba(255, 180, 120, 0)');
      grad.addColorStop(0.15, 'rgba(255, 180, 120, 0.08)');
      grad.addColorStop(0.5, 'rgba(255, 180, 120, 0.12)');
      grad.addColorStop(0.85, 'rgba(255, 180, 120, 0.08)');
      grad.addColorStop(1, 'rgba(255, 180, 120, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x1, 0, x2 - x1, h);

      // Edge lines
      ctx.strokeStyle = 'rgba(255, 200, 150, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x1, 0);
      ctx.lineTo(x1, h);
      ctx.moveTo(x2, 0);
      ctx.lineTo(x2, h);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      ctx.save();
      ctx.font = '10px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = 'rgba(255, 220, 180, 0.6)';
      ctx.textAlign = 'center';
      ctx.fillText('SKIN', (x1 + x2) / 2, 14);
      ctx.restore();
    }

    // 3. Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;

    // Vertical lines (hue divisions)
    for (let i = 0; i <= GRID_LINE_HUES; i++) {
      const hue = (i / GRID_LINE_HUES) * 360;
      const { x } = hueSatToCanvas(hue, 0, w, h);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Horizontal lines (saturation divisions)
    for (let i = 1; i <= GRID_LINE_SATS; i++) {
      const sat = (i / (GRID_LINE_SATS + 1)) * 100;
      const { y } = hueSatToCanvas(0, sat, w, h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 4. Bezier curves connecting nodes (showing color "bend")
    for (const [, satNodes] of nodesBySat) {
      if (satNodes.length < 2) continue;

      // Draw the curve through nodes (original positions)
      ctx.beginPath();
      const first = satNodes[0];
      const firstPos = hueSatToCanvas(first.hue, first.saturation, w, h);
      ctx.moveTo(firstPos.x, firstPos.y);

      for (let i = 1; i < satNodes.length; i++) {
        const prev = satNodes[i - 1];
        const curr = satNodes[i];
        const prevPos = hueSatToCanvas(prev.hue, prev.saturation, w, h);
        const currPos = hueSatToCanvas(curr.hue, curr.saturation, w, h);
        const cpx = (prevPos.x + currPos.x) / 2;
        ctx.quadraticCurveTo(prevPos.x, prevPos.y, cpx, (prevPos.y + currPos.y) / 2);
      }
      // Final point
      const lastNode = satNodes[satNodes.length - 1];
      const lastPos = hueSatToCanvas(lastNode.hue, lastNode.saturation, w, h);
      ctx.lineTo(lastPos.x, lastPos.y);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw the offset curves (showing the bend)
      ctx.beginPath();
      const firstOff = hueSatToCanvas(
        first.hue + first.offsetX * 0.6,
        Math.max(0, Math.min(100, first.saturation + first.offsetY * 0.3)),
        w,
        h
      );
      ctx.moveTo(firstOff.x, firstOff.y);

      for (let i = 1; i < satNodes.length; i++) {
        const prev = satNodes[i - 1];
        const curr = satNodes[i];
        const prevOff = hueSatToCanvas(
          prev.hue + prev.offsetX * 0.6,
          Math.max(0, Math.min(100, prev.saturation + prev.offsetY * 0.3)),
          w,
          h
        );
        const currOff = hueSatToCanvas(
          curr.hue + curr.offsetX * 0.6,
          Math.max(0, Math.min(100, curr.saturation + curr.offsetY * 0.3)),
          w,
          h
        );
        const cpx = (prevOff.x + currOff.x) / 2;
        ctx.quadraticCurveTo(prevOff.x, prevOff.y, cpx, (prevOff.y + currOff.y) / 2);
      }
      const lastOff = hueSatToCanvas(
        lastNode.hue + lastNode.offsetX * 0.6,
        Math.max(0, Math.min(100, lastNode.saturation + lastNode.offsetY * 0.3)),
        w,
        h
      );
      ctx.lineTo(lastOff.x, lastOff.y);

      // Color the offset curve based on the saturation level
      const satColor = hslString(0, 0, 100, 0.3);
      ctx.strokeStyle = satColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 5. Draw helper lines and nodes
    for (const node of abNodes) {
      const basePos = hueSatToCanvas(node.hue, node.saturation, w, h);
      const offsetHue = node.hue + node.offsetX * 0.6;
      const offsetSat = Math.max(0, Math.min(100, node.saturation + node.offsetY * 0.3));
      const offsetPos = hueSatToCanvas(offsetHue, offsetSat, w, h);

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

      // Fill with the color at the offset position
      const [nr, ng, nb] = hslToRgb(offsetHue, node.saturation, 50);
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

    // Hue labels
    const hueLabels = [0, 60, 120, 180, 240, 300];
    for (const hue of hueLabels) {
      const { x } = hueSatToCanvas(hue, 0, w, h);
      ctx.textAlign = 'center';
      ctx.fillText(`${hue}°`, x, h - 4);
    }

    // Saturation labels
    const satLabels = [100, 75, 50, 25, 0];
    for (const sat of satLabels) {
      const { y } = hueSatToCanvas(0, sat, w, h);
      ctx.textAlign = 'left';
      ctx.fillText(`${sat}%`, 3, y - 3);
    }
    ctx.restore();
  }, [
    abNodes,
    selectedNodeId,
    hoverNodeId,
    dragNodeId,
    isDragging,
    showNodeHelpers,
    showSkinToneLine,
    nodesBySat,
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

      for (const node of abNodes) {
        const offsetHue = node.hue + node.offsetX * 0.6;
        const offsetSat = Math.max(0, Math.min(100, node.saturation + node.offsetY * 0.3));
        const pos = hueSatToCanvas(offsetHue, offsetSat, w, h);
        const d = dist(cx, cy, pos.x, pos.y);
        if (d < NODE_HIT_RADIUS && d < closestDist) {
          closestDist = d;
          closestId = node.id;
        }
      }
      return closestId;
    },
    [abNodes]
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
            nodeHue: node.hue,
            nodeSat: node.saturation,
            origOffsetX: node.offsetX,
            origOffsetY: node.offsetY,
          };
          setTooltip({
            x,
            y,
            hue: node.hue,
            saturation: node.saturation,
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
        const { dhue, dsat } = pixelDeltaToHueSatDelta(dx, dy, w, h);

        // Scale offsets to -100..100 range
        const newOffsetX = start.origOffsetX + (dhue / 360) * 100;
        const newOffsetY = start.origOffsetY + (dsat / 100) * 100;

        const clampedX = Math.max(-100, Math.min(100, newOffsetX));
        const clampedY = Math.max(-100, Math.min(100, newOffsetY));

        updateABNode(dragNodeId, clampedX, clampedY);

        const node = nodeMap.get(dragNodeId);
        if (node) {
          setTooltip({
            x,
            y,
            hue: node.hue,
            saturation: node.saturation,
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
              hue: node.hue,
              saturation: node.saturation,
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
      updateABNode,
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
        updateABNode(nodeId, 0, 0);
      }
    },
    [findNodeAt, updateABNode, getCanvasCoords]
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
          <div className="h-2 w-2 rounded-full bg-amber-400/80" />
          <span className="text-[11px] font-medium tracking-wider text-white/40 uppercase">
            A/B Hue–Saturation
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
                  left: Math.min(tooltip.x + 16, canvasSize.w - 140),
              top: Math.max(tooltip.y - 52, 4),
            }}
          >
            <div className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-sm border border-white/20"
                style={{
                  backgroundColor: hslString(tooltip.hue, tooltip.saturation, 50),
                }}
              />
              <span className="font-medium text-white/90">
                H: {Math.round(tooltip.hue)}° S: {Math.round(tooltip.saturation)}%
              </span>
            </div>
            {(tooltip.offsetX !== 0 || tooltip.offsetY !== 0) && (
              <div className="mt-0.5 pl-5 text-white/40">
                Offset: {tooltip.offsetX.toFixed(1)}° / {tooltip.offsetY.toFixed(1)}%
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
