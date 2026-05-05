'use client';

import React, { useCallback, useRef, useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye,
  EyeOff,
  Columns2,
  SplitSquareVertical,
  ZoomIn,
  ZoomOut,
  Maximize2,
  MonitorDot,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  X,
} from 'lucide-react';
import { useAppStore, type CompareMode, type LUTItem } from '@/store/useAppStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';

interface ImageViewerProps {
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*  LUT → CSS filter mapping                                                  */
/* -------------------------------------------------------------------------- */

interface CSSFilterValues {
  hueRotate: number;
  saturate: number;
  contrast: number;
  brightness: number;
  sepia: number;
  grayscale: number;
}

const CATEGORY_FILTERS: Record<LUTItem['category'], CSSFilterValues> = {
  warm:          { hueRotate: 12,  saturate: 1.25, contrast: 1.08, brightness: 1.02, sepia: 0.18, grayscale: 0 },
  cool:          { hueRotate: -15, saturate: 0.88, contrast: 1.06, brightness: 1.05, sepia: 0,    grayscale: 0 },
  cinematic:     { hueRotate: -5,  saturate: 0.82, contrast: 1.18, brightness: 0.94, sepia: 0.06, grayscale: 0 },
  pastel:        { hueRotate: 3,   saturate: 0.65, contrast: 0.92, brightness: 1.12, sepia: 0.05, grayscale: 0 },
  'high-contrast': { hueRotate: 0, saturate: 1.1,  contrast: 1.35, brightness: 1.0,  sepia: 0,    grayscale: 0 },
  film:          { hueRotate: 8,   saturate: 0.85, contrast: 1.12, brightness: 0.96, sepia: 0.15, grayscale: 0 },
  portrait:      { hueRotate: 6,   saturate: 1.12, contrast: 1.05, brightness: 1.06, sepia: 0.08, grayscale: 0 },
  wedding:       { hueRotate: 4,   saturate: 0.88, contrast: 0.95, brightness: 1.1,  sepia: 0.08, grayscale: 0 },
  landscape:     { hueRotate: 5,   saturate: 1.22, contrast: 1.1,  brightness: 1.02, sepia: 0.05, grayscale: 0 },
  bw:            { hueRotate: 0,   saturate: 0,    contrast: 1.25, brightness: 1.0,  sepia: 0,    grayscale: 1 },
};

function interpolateFilter(
  base: CSSFilterValues,
  intensity: number // 0..100
): string {
  const t = intensity / 100;
  const hueRotate = base.hueRotate * t;
  const saturate = 1 + (base.saturate - 1) * t;
  const contrast = 1 + (base.contrast - 1) * t;
  const brightness = 1 + (base.brightness - 1) * t;
  const sepia = base.sepia * t;
  const grayscale = base.grayscale * t;
  return [
    `hue-rotate(${hueRotate}deg)`,
    `saturate(${saturate.toFixed(3)})`,
    `contrast(${contrast.toFixed(3)})`,
    `brightness(${brightness.toFixed(3)})`,
    `sepia(${sepia.toFixed(3)})`,
    `grayscale(${grayscale.toFixed(3)})`,
  ].join(' ');
}

/* -------------------------------------------------------------------------- */
/*  Color space badge config                                                  */
/* -------------------------------------------------------------------------- */

const COLOR_SPACE_CONFIG = {
  srgb:        { label: 'sRGB',        color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  'adobe-rgb': { label: 'Adobe RGB',   color: 'bg-sky-500/20 text-sky-400 border-sky-500/30' },
  'prophoto-rgb': { label: 'ProPhoto RGB', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
} as const;

/* -------------------------------------------------------------------------- */
/*  Demo gradient image (simulates a colorful landscape photograph)           */
/* -------------------------------------------------------------------------- */

function DemoImage({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={className}
      style={{
        ...style,
        background: `
          radial-gradient(ellipse 80% 50% at 65% 25%, rgba(255,180,100,0.5) 0%, transparent 60%),
          radial-gradient(ellipse 60% 40% at 30% 35%, rgba(255,120,80,0.3) 0%, transparent 50%),
          radial-gradient(ellipse 50% 30% at 80% 20%, rgba(255,220,150,0.4) 0%, transparent 50%),
          linear-gradient(180deg,
            #1a0533 0%,
            #2d1b69 8%,
            #6b2fa0 14%,
            #c94e4e 20%,
            #e8834a 26%,
            #f2b840 32%,
            #f7d76a 38%,
            #6b8f3a 40%,
            #4a7a2e 44%,
            #3d6328 52%,
            #2d4a1e 60%,
            #1e3518 70%,
            #162e14 80%,
            #0d1f0d 90%,
            #081208 100%
          )
        `,
      }}
    >
      {/* "Subject" silhouette for visual interest */}
      <div
        style={{
          position: 'absolute',
          bottom: '0%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '30%',
          height: '55%',
          background: `
            radial-gradient(ellipse 50% 40% at 50% 100%, rgba(10,15,5,0.85) 0%, transparent 70%),
            radial-gradient(ellipse 120% 30% at 50% 100%, rgba(15,25,8,0.7) 0%, transparent 60%)
          `,
        }}
      />
      {/* Sun glow */}
      <div
        style={{
          position: 'absolute',
          top: '24%',
          left: '62%',
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,245,220,0.95) 0%, rgba(255,200,100,0.6) 30%, rgba(255,150,60,0.2) 60%, transparent 80%)',
          boxShadow: '0 0 60px 30px rgba(255,200,100,0.3)',
        }}
      />
      {/* Cloud wisps */}
      <div
        style={{
          position: 'absolute',
          top: '10%',
          left: '10%',
          width: '45%',
          height: '15%',
          background: 'radial-gradient(ellipse 100% 100% at 50% 50%, rgba(180,120,160,0.25) 0%, transparent 60%)',
          filter: 'blur(12px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '6%',
          left: '45%',
          width: '35%',
          height: '12%',
          background: 'radial-gradient(ellipse 100% 100% at 40% 50%, rgba(200,140,120,0.2) 0%, transparent 55%)',
          filter: 'blur(10px)',
        }}
      />
      {/* Water reflection at bottom */}
      <div
        style={{
          position: 'absolute',
          bottom: '0%',
          left: '0%',
          width: '100%',
          height: '18%',
          background: 'linear-gradient(180deg, rgba(245,215,106,0.15) 0%, rgba(200,100,50,0.1) 40%, rgba(30,50,20,0.3) 100%)',
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Checkerboard pattern                                                      */
/* -------------------------------------------------------------------------- */

function CheckerboardPattern() {
  return (
    <div
      className="absolute inset-0"
      style={{
        backgroundImage: `
          linear-gradient(45deg, #2a2a2a 25%, transparent 25%),
          linear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #2a2a2a 75%),
          linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)
        `,
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
        opacity: 0.5,
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Compare mode labels                                                       */
/* -------------------------------------------------------------------------- */

function ImageLabel({ text, side }: { text: string; side: 'left' | 'right' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`
        absolute top-3 z-20 rounded-md bg-black/60 px-2.5 py-1
        text-[11px] font-medium uppercase tracking-wider text-white/80
        backdrop-blur-sm border border-white/10
        ${side === 'left' ? 'left-3' : 'right-3'}
      `}
    >
      {text}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                            */
/* -------------------------------------------------------------------------- */

export default function ImageViewer({ className }: ImageViewerProps) {
  const {
    compareMode,
    setCompareMode,
    splitPosition,
    setSplitPosition,
    globalIntensity,
    lutItems,
    activeLutId,
    settings,
  } = useAppStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const splitLineRef = useRef<HTMLDivElement>(null);
  const isDraggingSplit = useRef(false);

  const [isBefore, setIsBefore] = useState(false);
  const [zoom, setZoom] = useState<'fit' | '100' | '200'>('fit');

  /* ----- Derived state ----- */

  const activeLut = useMemo(
    () => lutItems.find((l) => l.id === activeLutId) ?? null,
    [lutItems, activeLutId],
  );

  const gradedFilter = useMemo(() => {
    if (!activeLut) return 'none';
    const base = CATEGORY_FILTERS[activeLut.category] ?? CATEGORY_FILTERS.warm;
    return interpolateFilter(base, globalIntensity);
  }, [activeLut, globalIntensity]);

  const colorSpaceInfo = COLOR_SPACE_CONFIG[settings.colorSpace];

  const showComparison = compareMode !== 'off';

  /* ----- Before/After press-and-hold ----- */

  const handleBeforePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setIsBefore(true);
    },
    [],
  );

  const handleBeforePointerUp = useCallback(() => {
    setIsBefore(false);
  }, []);

  /* ----- Split line dragging ----- */

  const handleSplitPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingSplit.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const handleSplitPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingSplit.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(2, Math.min(98, (x / rect.width) * 100));
      setSplitPosition(pct);
    },
    [setSplitPosition],
  );

  const handleSplitPointerUp = useCallback(() => {
    isDraggingSplit.current = false;
  }, []);

  /* ----- Compare mode cycle ----- */

  const cycleCompareMode = useCallback(() => {
    const modes: CompareMode[] = ['off', 'split', 'side-by-side'];
    const idx = modes.indexOf(compareMode);
    const next = modes[(idx + 1) % modes.length];
    setCompareMode(next);
  }, [compareMode, setCompareMode]);

  /* ----- Zoom controls ----- */

  const cycleZoom = useCallback(() => {
    const levels: Array<'fit' | '100' | '200'> = ['fit', '100', '200'];
    const idx = levels.indexOf(zoom);
    setZoom(levels[(idx + 1) % levels.length]);
  }, [zoom]);

  const zoomScale = zoom === 'fit' ? 1 : zoom === '100' ? 1 : 2;

  /* ----- Compare mode icons ----- */

  const CompareIcon = useMemo(() => {
    switch (compareMode) {
      case 'split':
        return SplitSquareVertical;
      case 'side-by-side':
        return Columns2;
      default:
        return EyeOff;
    }
  }, [compareMode]);

  const compareLabel = useMemo(() => {
    switch (compareMode) {
      case 'split': return 'Split';
      case 'side-by-side': return 'Side by Side';
      default: return 'Compare Off';
    }
  }, [compareMode]);

  /* ----- Image wrapper style ----- */

  const imageWrapperStyle = useMemo((): React.CSSProperties => {
    if (zoom === 'fit') return {};
    return {
      transform: `scale(${zoomScale})`,
      transformOrigin: 'center center',
    };
  }, [zoom, zoomScale]);

  /* ----- Effective filter (respects isBefore toggle) ----- */

  const effectiveFilter = isBefore ? 'none' : gradedFilter;

  /* ----- Global pointer up listener for split drag ----- */

  useEffect(() => {
    const onUp = () => { isDraggingSplit.current = false; };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, []);

  /* ======================================================================== */
  /*  Render                                                                  */
  /* ======================================================================== */

  return (
    <div
      ref={containerRef}
      className={`relative flex h-full w-full select-none flex-col overflow-hidden ${className ?? ''}`}
      style={{ backgroundColor: '#1a1a1a' }}
    >
      {/* ----- Workspace area ----- */}
      <div className="relative flex flex-1 items-center justify-center overflow-auto p-4">
        <CheckerboardPattern />

        <motion.div
          className="relative z-10"
          style={{ ...imageWrapperStyle, maxWidth: '100%', maxHeight: '100%' }}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          {/* -------- OFF / Single view -------- */}
          {compareMode === 'off' && (
            <div className="relative" style={{ width: '640px', height: '427px' }}>
              <DemoImage
                className="absolute inset-0 rounded-lg shadow-2xl shadow-black/50"
                style={{ filter: effectiveFilter, transition: 'filter 0.3s ease' }}
              />
              <AnimatePresence>
                {isBefore && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="absolute inset-0 flex items-center justify-center rounded-lg"
                  >
                    <Badge variant="outline" className="border-white/20 bg-black/60 text-xs text-white backdrop-blur-sm">
                      Original
                    </Badge>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* -------- SPLIT view -------- */}
          {compareMode === 'split' && (
            <div
              className="relative overflow-hidden rounded-lg shadow-2xl shadow-black/50"
              style={{ width: '640px', height: '427px' }}
            >
              {/* Original (left side) — clipped to split position */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${splitPosition}%` }}
              >
                <DemoImage
                  className="absolute inset-0"
                  style={{
                    width: '640px',
                    maxWidth: 'none',
                    filter: 'none',
                  }}
                />
              </div>

              {/* Graded (right side) — clipped from split position */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{
                  left: `${splitPosition}%`,
                  width: `${100 - splitPosition}%`,
                }}
              >
                <DemoImage
                  className="absolute inset-0"
                  style={{
                    width: '640px',
                    maxWidth: 'none',
                    left: `-${splitPosition}%`,
                    filter: isBefore ? 'none' : gradedFilter,
                    transition: 'filter 0.3s ease',
                  }}
                />
              </div>

              {/* Labels */}
              <ImageLabel text="Before" side="left" />
              <ImageLabel text="After" side="right" />

              {/* Split line */}
              <div
                ref={splitLineRef}
                className="absolute top-0 z-30 flex h-full cursor-col-resize flex-col items-center"
                style={{ left: `${splitPosition}%`, transform: 'translateX(-50%)' }}
                onPointerDown={handleSplitPointerDown}
                onPointerMove={handleSplitPointerMove}
                onPointerUp={handleSplitPointerUp}
              >
                {/* Gradient line */}
                <div
                  className="h-full w-[2px]"
                  style={{
                    background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 15%, rgba(255,255,255,0.9) 85%, rgba(255,255,255,0) 100%)',
                  }}
                />
                {/* Handle */}
                <div className="absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-0.5">
                  <div
                    className="flex h-10 w-6 items-center justify-center rounded-full border border-white/30"
                    style={{
                      background: 'linear-gradient(135deg, rgba(80,80,80,0.9) 0%, rgba(40,40,40,0.95) 100%)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                    }}
                  >
                    <GripVertical className="h-4 w-4 text-white/70" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* -------- SIDE-BY-SIDE view -------- */}
          {compareMode === 'side-by-side' && (
            <div className="flex gap-3">
              {/* Original */}
              <div className="relative">
                <ImageLabel text="Original" side="left" />
                <DemoImage
                  className="rounded-lg shadow-2xl shadow-black/50"
                  style={{ width: '400px', height: '267px', filter: 'none' }}
                />
              </div>
              {/* Graded */}
              <div className="relative">
                <ImageLabel text="Graded" side="right" />
                <DemoImage
                  className="rounded-lg shadow-2xl shadow-black/50"
                  style={{
                    width: '400px',
                    height: '267px',
                    filter: isBefore ? 'none' : gradedFilter,
                    transition: 'filter 0.3s ease',
                  }}
                />
              </div>
            </div>
          )}

          {/* -------- Zoomed overflow indicators -------- */}
          {zoom !== 'fit' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute -top-8 left-1/2 -translate-x-1/2 rounded-md bg-black/60 px-2.5 py-1 text-[11px] text-white/70 backdrop-blur-sm"
            >
              {zoom === '100' ? '100%' : '200%'}
            </motion.div>
          )}
        </motion.div>
      </div>

      {/* ================================================================== */}
      {/*  Floating Toolbar                                                  */}
      {/* ================================================================== */}
      <motion.div
        className="pointer-events-none absolute bottom-5 left-1/2 z-50 -translate-x-1/2"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4, ease: 'easeOut' }}
      >
        <div
          className="pointer-events-auto flex items-center gap-1 rounded-xl border border-white/[0.08] px-2 py-1.5 shadow-2xl shadow-black/40"
          style={{
            background: 'rgba(28, 28, 30, 0.75)',
            backdropFilter: 'blur(20px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(20px) saturate(1.5)',
          }}
        >
          {/* Before/After button — press and hold */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 transition-all hover:bg-white/10 hover:text-white/90 active:scale-95"
                onPointerDown={handleBeforePointerDown}
                onPointerUp={handleBeforePointerUp}
                onPointerLeave={handleBeforePointerUp}
                onContextMenu={(e) => e.preventDefault()}
                aria-label="Hold to view original"
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={isBefore ? 'before' : 'after'}
                    initial={{ opacity: 0, scale: 0.7, rotate: -90 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.7, rotate: 90 }}
                    transition={{ duration: 0.2 }}
                  >
                    {isBefore ? (
                      <EyeOff className="h-[18px] w-[18px]" />
                    ) : (
                      <Eye className="h-[18px] w-[18px]" />
                    )}
                  </motion.div>
                </AnimatePresence>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="border-white/10 bg-zinc-900 text-xs text-zinc-300">
              Hold to view original
            </TooltipContent>
          </Tooltip>

          {/* Separator */}
          <div className="mx-1 h-5 w-px bg-white/[0.08]" />

          {/* Compare mode switcher */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-white/60 transition-all hover:bg-white/10 hover:text-white/90 active:scale-95"
                onClick={cycleCompareMode}
                aria-label={`Comparison mode: ${compareLabel}. Click to change.`}
              >
                <CompareIcon className="h-[18px] w-[18px]" />
                <span className="text-[11px] font-medium tracking-wide">{compareLabel}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="border-white/10 bg-zinc-900 text-xs text-zinc-300">
              Cycle comparison mode
            </TooltipContent>
          </Tooltip>

          {/* Separator */}
          <div className="mx-1 h-5 w-px bg-white/[0.08]" />

          {/* Zoom controls */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 transition-all hover:bg-white/10 hover:text-white/90 active:scale-95"
                onClick={() => {
                  const levels: Array<'fit' | '100' | '200'> = ['200', '100', 'fit'];
                  const idx = levels.indexOf(zoom);
                  setZoom(levels[(idx + 1) % levels.length]);
                }}
                aria-label="Zoom out"
              >
                <ZoomOut className="h-[18px] w-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="border-white/10 bg-zinc-900 text-xs text-zinc-300">
              Zoom out
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex h-9 min-w-[3rem] items-center justify-center rounded-lg px-2 text-[11px] font-medium tabular-nums text-white/60 transition-all hover:bg-white/10 hover:text-white/90 active:scale-95"
                onClick={cycleZoom}
                aria-label="Cycle zoom level"
              >
                {zoom === 'fit' ? (
                  <Maximize2 className="h-4 w-4" />
                ) : (
                  <span>{zoom}%</span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="border-white/10 bg-zinc-900 text-xs text-zinc-300">
              {zoom === 'fit' ? 'Fit to view' : `Zoom: ${zoom}%`}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 transition-all hover:bg-white/10 hover:text-white/90 active:scale-95"
                onClick={() => {
                  const levels: Array<'fit' | '100' | '200'> = ['fit', '100', '200'];
                  const idx = levels.indexOf(zoom);
                  setZoom(levels[(idx + 1) % levels.length]);
                }}
                aria-label="Zoom in"
              >
                <ZoomIn className="h-[18px] w-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="border-white/10 bg-zinc-900 text-xs text-zinc-300">
              Zoom in
            </TooltipContent>
          </Tooltip>

          {/* Separator */}
          <div className="mx-1 h-5 w-px bg-white/[0.08]" />

          {/* Color space badge */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10px] font-semibold uppercase tracking-widest ${colorSpaceInfo.color}`}
              >
                <MonitorDot className="h-3 w-3" />
                {colorSpaceInfo.label}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="border-white/10 bg-zinc-900 text-xs text-zinc-300">
              Color space: {colorSpaceInfo.label}
            </TooltipContent>
          </Tooltip>
        </div>
      </motion.div>

      {/* ================================================================== */}
      {/*  Active LUT indicator (top-right)                                  */}
      {/* ================================================================== */}
      <AnimatePresence>
        {activeLut && (
          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ delay: 0.5, duration: 0.3 }}
            className="pointer-events-none absolute right-4 top-4 z-40"
          >
            <div
              className="flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 shadow-lg"
              style={{
                background: 'rgba(28, 28, 30, 0.7)',
                backdropFilter: 'blur(12px)',
              }}
            >
              {/* Mini gradient swatch */}
              <div
                className="h-5 w-5 rounded-md"
                style={{
                  background: getMiniSwatchGradient(activeLut),
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }}
              />
              <div className="flex flex-col">
                <span className="text-xs font-medium text-white/80">{activeLut.name}</span>
                <span className="text-[10px] text-white/40">
                  {globalIntensity}% · {activeLut.category}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helper: generate a tiny gradient for the active LUT badge swatch          */
/* -------------------------------------------------------------------------- */

function getMiniSwatchGradient(lut: LUTItem): string {
  const hueMap: Record<string, string> = {
    warm: 'linear-gradient(135deg, #f97316, #eab308)',
    cool: 'linear-gradient(135deg, #06b6d4, #6366f1)',
    cinematic: 'linear-gradient(135deg, #0d9488, #f97316)',
    pastel: 'linear-gradient(135deg, #fda4af, #c4b5fd)',
    'high-contrast': 'linear-gradient(135deg, #18181b, #fafafa)',
    film: 'linear-gradient(135deg, #a8763e, #78716c)',
    portrait: 'linear-gradient(135deg, #fb923c, #fda4af)',
    wedding: 'linear-gradient(135deg, #fef3c7, #fce7f3)',
    landscape: 'linear-gradient(135deg, #65a30d, #16a34a)',
    bw: 'linear-gradient(135deg, #27272a, #e4e4e7)',
  };
  return hueMap[lut.category] ?? hueMap.warm;
}
