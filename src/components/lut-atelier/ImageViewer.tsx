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
  GripVertical,
  Upload,
  ImagePlus,
} from 'lucide-react';
import { useAppStore, type CompareMode, type LUTItem, type ImageInfo } from '@/store/useAppStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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
  'high-contrast': { hueRotate: 0, saturate: 1.1, contrast: 1.35, brightness: 1.0,  sepia: 0,    grayscale: 0 },
  film:          { hueRotate: 8,   saturate: 0.85, contrast: 1.12, brightness: 0.96, sepia: 0.15, grayscale: 0 },
  portrait:      { hueRotate: 6,   saturate: 1.12, contrast: 1.05, brightness: 1.06, sepia: 0.08, grayscale: 0 },
  wedding:       { hueRotate: 4,   saturate: 0.88, contrast: 0.95, brightness: 1.1,  sepia: 0.08, grayscale: 0 },
  landscape:     { hueRotate: 5,   saturate: 1.22, contrast: 1.1,  brightness: 1.02, sepia: 0.05, grayscale: 0 },
  bw:            { hueRotate: 0,   saturate: 0,    contrast: 1.25, brightness: 1.0,  sepia: 0,    grayscale: 1 },
};

function interpolateFilter(
  base: CSSFilterValues,
  intensity: number
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
/*  Image file reader utility                                                 */
/* -------------------------------------------------------------------------- */

function readImageFile(file: File): Promise<ImageInfo> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Not an image file'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new window.Image();
      img.onload = () => {
        resolve({
          dataUrl,
          name: file.name,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/* -------------------------------------------------------------------------- */
/*  Drop zone (shown when no image is loaded)                                 */
/* -------------------------------------------------------------------------- */

function DropZone({ onImageLoad }: { onImageLoad: (info: ImageInfo) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const info = await readImageFile(files[0]);
      onImageLoad(info);
    } catch {
      // silently ignore invalid files
    }
  }, [onImageLoad]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      className="flex h-full w-full items-center justify-center p-8"
    >
      <div
        className={`
          relative flex flex-col items-center justify-center gap-6
          w-full max-w-lg rounded-2xl border-2 border-dashed
          transition-all duration-300 cursor-pointer
          ${isDragging
            ? 'border-amber-400/60 bg-amber-500/5 scale-[1.02]'
            : 'border-zinc-700/60 bg-zinc-900/30 hover:border-zinc-600 hover:bg-zinc-900/50'
          }
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className={`flex items-center justify-center w-16 h-16 rounded-2xl transition-colors duration-300 ${isDragging ? 'bg-amber-500/10' : 'bg-zinc-800'}`}>
          <Upload className={`w-8 h-8 transition-colors duration-300 ${isDragging ? 'text-amber-400' : 'text-zinc-500'}`} />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-zinc-300 mb-1">
            {isDragging ? 'Drop your photo here' : 'Import a Photo'}
          </p>
          <p className="text-xs text-zinc-500">
            Drag & drop an image, or click to browse
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-600 uppercase tracking-wider">
          <span>JPG</span>
          <span className="w-1 h-1 rounded-full bg-zinc-700" />
          <span>TIFF</span>
          <span className="w-1 h-1 rounded-full bg-zinc-700" />
          <span>PNG</span>
          <span className="w-1 h-1 rounded-full bg-zinc-700" />
          <span>WebP</span>
          <span className="w-1 h-1 rounded-full bg-zinc-700" />
          <span>PSD</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
        >
          <ImagePlus className="w-4 h-4 mr-2" />
          Browse Files
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                            */
/* -------------------------------------------------------------------------- */

export default function ImageViewer({ className }: ImageViewerProps) {
  const {
    currentImage,
    setCurrentImage,
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const splitLineRef = useRef<HTMLDivElement>(null);
  const isDraggingSplit = useRef(false);

  const [isBefore, setIsBefore] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100); // always a number, 100 = actual pixels
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [isDragOver, setIsDragOver] = useState(false);

  /* ----- Observe container size ----- */
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          w: entry.contentRect.width,
          h: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* ----- Reset zoom when image changes ----- */
  const prevImageUrlRef = useRef(currentImage?.dataUrl ?? '');
  useEffect(() => {
    const url = currentImage?.dataUrl ?? '';
    if (url !== prevImageUrlRef.current) {
      prevImageUrlRef.current = url;
      setZoomLevel(0); // 0 means "fit"
    }
  }, [currentImage?.dataUrl]);

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
  const hasImage = currentImage !== null;

  // Calculate the "fit to container" zoom percentage
  const fitZoomPercent = useMemo(() => {
    if (!hasImage || containerSize.w === 0 || containerSize.h === 0) return 100;
    const img = currentImage!;
    const padding = 32;
    const availW = containerSize.w - padding;
    const availH = containerSize.h - padding;
    if (availW <= 0 || availH <= 0) return 100;
    return Math.round((Math.min(availW / img.width, availH / img.height)) * 100);
  }, [hasImage, currentImage, containerSize]);

  // 0 means "fit to view", otherwise it's the actual zoom %
  const isFitMode = zoomLevel === 0;
  const effectiveZoom = isFitMode ? fitZoomPercent : zoomLevel;

  // Calculate display dimensions
  const displayDims = useMemo(() => {
    if (!hasImage || !currentImage) return { w: 0, h: 0 };
    const scale = effectiveZoom / 100;
    return {
      w: Math.round(currentImage.width * scale),
      h: Math.round(currentImage.height * scale),
    };
  }, [hasImage, currentImage, effectiveZoom]);

  // Is the image larger than the container? (need scrolling)
  const needsScroll = displayDims.w > containerSize.w - 32 || displayDims.h > containerSize.h - 32;

  /* ----- Zoom controls ----- */

  const zoomIn = useCallback(() => {
    setZoomLevel(prev => {
      const current = prev === 0 ? fitZoomPercent : prev;
      return Math.min(current + 25, 800);
    });
  }, [fitZoomPercent]);

  const zoomOut = useCallback(() => {
    setZoomLevel(prev => {
      const current = prev === 0 ? fitZoomPercent : prev;
      if (current - 25 <= fitZoomPercent) return 0;
      return Math.max(current - 25, 5);
    });
  }, [fitZoomPercent]);

  const cycleZoom = useCallback(() => {
    setZoomLevel(prev => {
      const current = prev === 0 ? fitZoomPercent : prev;
      if (current <= fitZoomPercent + 1) return 100;
      if (current <= 125) return 200;
      if (current <= 250) return 400;
      return 0; // back to fit
    });
  }, [fitZoomPercent]);

  /* ----- Scroll-wheel zoom ----- */
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        if (e.deltaY < 0) {
          zoomIn();
        } else {
          zoomOut();
        }
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', handleWheel, { capture: true });
  }, [zoomIn, zoomOut]);

  /* ----- Image load handler ----- */

  const handleImageLoad = useCallback((info: ImageInfo) => {
    setCurrentImage(info);
  }, [setCurrentImage]);

  /* ----- Drop to replace image ----- */

  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleContainerDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleContainerDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    try {
      const info = await readImageFile(files[0]);
      setCurrentImage(info);
    } catch {
      // silently ignore
    }
  }, [setCurrentImage]);

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

  /* ----- Effective filter (respects isBefore toggle) ----- */

  const effectiveFilter = isBefore ? 'none' : gradedFilter;

  /* ----- Global pointer up listener for split drag ----- */

  useEffect(() => {
    const onUp = () => { isDraggingSplit.current = false; };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, []);

  /* ======================================================================== */
  /*  Render — No image: show Drop Zone                                       */
  /* ======================================================================== */

  if (!hasImage) {
    return (
      <div
        className={`relative flex h-full w-full select-none flex-col overflow-hidden ${className ?? ''}`}
        style={{ backgroundColor: '#1a1a1a' }}
      >
        <DropZone onImageLoad={handleImageLoad} />
      </div>
    );
  }

  /* ======================================================================== */
  /*  Render — With image                                                      */
  /* ======================================================================== */

  const img = currentImage!;

  // CSS for the image element: always explicit pixel dimensions
  const imgStyle: React.CSSProperties = {
    width: displayDims.w,
    height: displayDims.h,
    filter: effectiveFilter !== 'none' ? effectiveFilter : undefined,
    transition: 'filter 0.3s ease',
    userSelect: 'none',
    objectFit: 'fill',
    borderRadius: 8,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
  };

  // Checkerboard background CSS (tiled)
  const checkerBg: React.CSSProperties = {
    backgroundImage: `
      linear-gradient(45deg, #2a2a2a 25%, transparent 25%),
      linear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #2a2a2a 75%),
      linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)
    `,
    backgroundSize: '20px 20px',
    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
    opacity: 0.5,
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex h-full w-full select-none flex-col overflow-hidden ${className ?? ''}`}
      style={{ backgroundColor: '#1a1a1a' }}
      onDragOver={handleContainerDragOver}
      onDragLeave={handleContainerDragLeave}
      onDrop={handleContainerDrop}
    >
      {/* Drag overlay */}
      <AnimatePresence>
        {isDragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-3 text-white">
              <Upload className="w-10 h-10 text-amber-400" />
              <p className="text-sm font-medium">Drop to replace image</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image info badge (top-left) */}
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.3 }}
        className="absolute left-3 top-3 z-40 pointer-events-none"
      >
        <div className="flex items-center gap-2 rounded-lg bg-black/50 backdrop-blur-sm px-2.5 py-1.5 border border-white/[0.06]">
          <span className="text-[11px] text-white/70 font-medium truncate max-w-[200px]">{img.name}</span>
          <span className="text-[10px] text-white/40 font-mono">{img.width}×{img.height}</span>
        </div>
      </motion.div>

      {/* Zoom indicator (top center, shown when not at fit) */}
      <AnimatePresence>
        {!isFitMode && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-3 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
          >
            <div className="rounded-md bg-black/70 px-3 py-1.5 text-[11px] font-medium tabular-nums text-white/80 backdrop-blur-sm border border-white/10">
              {effectiveZoom}%
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== SCROLLABLE IMAGE AREA ===== */}
      <div
        ref={scrollContainerRef}
        className="relative flex-1"
        style={{
          overflow: needsScroll ? 'auto' : 'hidden',
        }}
      >
        {/* Checkerboard background - fixed to scroll area */}
        <div className="absolute inset-0" style={checkerBg} />

        {/* Centering wrapper - flex center when fit, top-left when scrollable */}
        <div
          className="relative z-10"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: needsScroll ? displayDims.w + 32 : '100%',
            minHeight: needsScroll ? displayDims.h + 32 : '100%',
            padding: 16,
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            style={{ position: 'relative', flexShrink: 0 }}
          >
            {/* -------- OFF / Single view -------- */}
            {compareMode === 'off' && (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  draggable={false}
                  style={imgStyle}
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
                style={{ width: displayDims.w, height: displayDims.h }}
              >
                {/* Original (before) - full image */}
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  draggable={false}
                  style={{
                    ...imgStyle,
                    width: displayDims.w,
                    height: displayDims.h,
                    borderRadius: 0,
                    filter: 'none',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                  }}
                />

                {/* Graded (after) - clipped from split position */}
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{
                    left: `${splitPosition}%`,
                    width: `${100 - splitPosition}%`,
                  }}
                >
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    draggable={false}
                    style={{
                      width: displayDims.w,
                      height: displayDims.h,
                      filter: effectiveFilter !== 'none' ? effectiveFilter : undefined,
                      transition: 'filter 0.3s ease',
                      userSelect: 'none',
                      objectFit: 'fill',
                      marginLeft: `-${splitPosition}%`,
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
                  <div
                    className="h-full w-[2px]"
                    style={{
                      background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 15%, rgba(255,255,255,0.9) 85%, rgba(255,255,255,0) 100%)',
                    }}
                  />
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
              <div className="flex gap-3" style={{ width: displayDims.w + 12 }}>
                <div style={{ position: 'relative', flexShrink: 0, width: (displayDims.w - 12) / 2 }}>
                  <ImageLabel text="Original" side="left" />
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    draggable={false}
                    style={{
                      ...imgStyle,
                      width: (displayDims.w - 12) / 2,
                      height: displayDims.h,
                      filter: 'none',
                    }}
                  />
                </div>
                <div style={{ position: 'relative', flexShrink: 0, width: (displayDims.w - 12) / 2 }}>
                  <ImageLabel text="Graded" side="right" />
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    draggable={false}
                    style={imgStyle}
                  />
                </div>
              </div>
            )}
          </motion.div>
        </div>
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
          {/* Before/After button */}
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

          <div className="mx-1 h-5 w-px bg-white/[0.08]" />

          {/* Compare mode switcher */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-white/60 transition-all hover:bg-white/10 hover:text-white/90 active:scale-95"
                onClick={cycleCompareMode}
                aria-label={`Comparison mode: ${compareLabel}`}
              >
                <CompareIcon className="h-[18px] w-[18px]" />
                <span className="text-[11px] font-medium tracking-wide">{compareLabel}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="border-white/10 bg-zinc-900 text-xs text-zinc-300">
              Cycle comparison mode
            </TooltipContent>
          </Tooltip>

          <div className="mx-1 h-5 w-px bg-white/[0.08]" />

          {/* Zoom out button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 transition-all hover:bg-white/10 hover:text-white/90 active:scale-95"
                onClick={zoomOut}
                aria-label="Zoom out"
              >
                <ZoomOut className="h-[18px] w-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="border-white/10 bg-zinc-900 text-xs text-zinc-300">
              Zoom out (Ctrl+Scroll)
            </TooltipContent>
          </Tooltip>

          {/* Zoom percentage / Fit button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex h-9 min-w-[3.5rem] items-center justify-center rounded-lg px-2 text-[11px] font-medium tabular-nums text-white/60 transition-all hover:bg-white/10 hover:text-white/90 active:scale-95"
                onClick={cycleZoom}
                aria-label="Cycle zoom level"
              >
                {isFitMode ? (
                  <Maximize2 className="h-4 w-4" />
                ) : (
                  <span>{effectiveZoom}%</span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="border-white/10 bg-zinc-900 text-xs text-zinc-300">
              {isFitMode ? `Fit to view (${fitZoomPercent}%) — Click to set 100%` : `Zoom: ${effectiveZoom}% — Click to cycle`}
            </TooltipContent>
          </Tooltip>

          {/* Zoom in button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 transition-all hover:bg-white/10 hover:text-white/90 active:scale-95"
                onClick={zoomIn}
                aria-label="Zoom in"
              >
                <ZoomIn className="h-[18px] w-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="border-white/10 bg-zinc-900 text-xs text-zinc-300">
              Zoom in (Ctrl+Scroll)
            </TooltipContent>
          </Tooltip>

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
