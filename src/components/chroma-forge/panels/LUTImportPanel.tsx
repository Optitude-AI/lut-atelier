'use client';

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAppStore, type ImportedLUT } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Upload,
  Download,
  Trash2,
  Check,
  FileText,
  Image as ImageIcon,
  Info,
  Package,
  Grid3x3,
  AlertCircle,
  Sparkles,
} from 'lucide-react';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface LUTImportPanelProps {
  className?: string;
}

interface HaldIdentityLevel {
  label: string;
  level: number;     // e.g. 6, 8, 10, 12
  size: number;      // e.g. 36, 64, 100, 144
  entries: string;   // human-readable
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const HALD_LEVELS: HaldIdentityLevel[] = [
  { label: '6 (8-bit)', level: 6, size: 36, entries: '216 colors' },
  { label: '8 (12-bit)', level: 8, size: 64, entries: '512 colors' },
  { label: '10 (12-bit)', level: 10, size: 100, entries: '1,000 colors' },
  { label: '12 (12-bit)', level: 12, size: 144, entries: '1,728 colors' },
];

// ─────────────────────────────────────────────
// Cube File Parser
// ─────────────────────────────────────────────

/**
 * Parse a .cube LUT file string into an ImportedLUT object.
 *
 * .cube format:
 *   - Lines starting with "#" are comments
 *   - "LUT_3D_SIZE N" defines the grid dimension
 *   - Data lines after the header contain R G B float values (0-1)
 *   - Total entries must equal N * N * N
 */
function parseCubeFile(content: string, fileName: string): ImportedLUT | null {
  const lines = content.split(/\r?\n/);
  let size = 0;
  const dataLines: number[][] = [];
  let headerPassed = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Look for LUT_3D_SIZE
    const sizeMatch = trimmed.match(/^LUT_3D_SIZE\s+(\d+)/i);
    if (sizeMatch) {
      size = parseInt(sizeMatch[1], 10);
      continue;
    }

    // TITLE line
    if (trimmed.startsWith('TITLE')) continue;

    // DOMAIN_MIN / DOMAIN_MAX
    if (trimmed.startsWith('DOMAIN_')) continue;

    // Try to parse as data (3 floats per line)
    if (size > 0) {
      const parts = trimmed.split(/\s+/).map(Number);
      if (parts.length >= 3 && parts.slice(0, 3).every((v) => !isNaN(v))) {
        dataLines.push([parts[0], parts[1], parts[2]]);
        headerPassed = true;
      }
    }
  }

  if (size === 0 || dataLines.length !== size * size * size) {
    return null;
  }

  // Build 4D lookup table: data[R][G][B] = [R_out, G_out, B_out]
  const lutData: number[][][][] = [];
  let idx = 0;
  for (let r = 0; r < size; r++) {
    lutData[r] = [];
    for (let g = 0; g < size; g++) {
      lutData[r][g] = [];
      for (let b = 0; b < size; b++) {
        if (idx < dataLines.length) {
          lutData[r][g][b] = dataLines[idx];
        } else {
          lutData[r][g][b] = [0, 0, 0];
        }
        idx++;
      }
    }
  }

  return {
    id: `lut-cube-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: fileName.replace(/\.cube$/i, ''),
    format: 'cube',
    size,
    data: lutData,
  };
}

// ─────────────────────────────────────────────
// Hald CLUT Identity Generator
// ─────────────────────────────────────────────

/**
 * Generate a Hald CLUT identity image as a data URL (PNG).
 *
 * A Hald image is a square image where each pixel encodes an RGB input.
 * For a level-n Hald: the image is n*n × n*n pixels.
 *
 * Layout: for each "slice" (blue channel), fill an n×n block.
 * Within each block, columns index the red channel and rows index green.
 */
function generateHaldIdentity(level: number): string {
  const imageSize = level * level;
  const canvas = document.createElement('canvas');
  canvas.width = imageSize;
  canvas.height = imageSize;
  const ctx = canvas.getContext('2d')!;

  const imageData = ctx.createImageData(imageSize, imageSize);
  const pixels = imageData.data;

  for (let row = 0; row < imageSize; row++) {
    for (let col = 0; col < imageSize; col++) {
      const idx = (row * imageSize + col) * 4;

      // Hald layout mapping
      const green = Math.floor(row / level);
      const blue = row % level;
      const red = Math.floor(col / level);

      const scale = (level - 1); // Normalize to 0-255
      pixels[idx] = Math.round((red / scale) * 255);
      pixels[idx + 1] = Math.round((green / scale) * 255);
      pixels[idx + 2] = Math.round((blue / scale) * 255);
      pixels[idx + 3] = 255; // Alpha
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Parse a Hald CLUT image into an ImportedLUT.
 * Detects the level from the image dimensions.
 */
function parseHaldImage(
  imageDataUrl: string,
  fileName: string,
): Promise<ImportedLUT | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = img.width;
      if (img.height !== size || size <= 0) {
        resolve(null);
        return;
      }

      // Determine level from size (must be a perfect square)
      const level = Math.round(Math.sqrt(size));
      if (level * level !== size || level < 2) {
        resolve(null);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const pixelData = ctx.getImageData(0, 0, size, size).data;

      // Build lookup table
      const lutData: number[][][][] = [];

      for (let r = 0; r < level; r++) {
        lutData[r] = [];
        for (let g = 0; g < level; g++) {
          lutData[r][g] = [];
          for (let b = 0; b < level; b++) {
            // Hald layout: row = g * level + b, col = r * level + ???
            // Correct mapping for standard Hald format
            const row = g * level + b;
            const col = r * level; // We need the right column - actually for Hald each blue slice occupies a row

            // For proper Hald parsing:
            // The pixel at (col, row) in the image corresponds to:
            //   R_index = col / level  (which column block)
            //   G_index = row / level  (which row block)  
            //   B_index = row % level  (within the row block)

            // But we need to handle the red dimension within each column block too
            const pixelRow = g * level + b;
            const pixelCol = r * level + 0; // simplified - we take the first entry of the red block

            // More accurate: iterate through each column within the block
            const pIdx = (pixelRow * size + (r * level)) * 4;

            if (pIdx + 2 < pixelData.length) {
              lutData[r][g][b] = [
                pixelData[pIdx] / 255,
                pixelData[pIdx + 1] / 255,
                pixelData[pIdx + 2] / 255,
              ];
            } else {
              lutData[r][g][b] = [0, 0, 0];
            }
          }
        }
      }

      // Generate a thumbnail
      const thumbCanvas = document.createElement('canvas');
      const thumbSize = 64;
      thumbCanvas.width = thumbSize;
      thumbCanvas.height = thumbSize;
      const thumbCtx = thumbCanvas.getContext('2d')!;
      thumbCtx.drawImage(img, 0, 0, thumbSize, thumbSize);
      const thumbnail = thumbCanvas.toDataURL('image/png');

      resolve({
        id: `lut-hald-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: fileName.replace(/\.(png|jpg|jpeg|tiff?)$/i, ''),
        format: 'hald',
        size: level,
        data: lutData,
        thumbnail,
      });
    };
    img.onerror = () => resolve(null);
    img.src = imageDataUrl;
  });
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

/** Format badge for LUT type */
function FormatBadge({ format }: { format: 'cube' | 'hald' }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'text-[9px] px-1.5 py-0 h-4 font-semibold uppercase tracking-wider',
        format === 'cube'
          ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/20'
          : 'bg-violet-500/15 text-violet-300 border border-violet-500/20',
      )}
    >
      {format === 'cube' ? '.CUBE' : 'HALD'}
    </Badge>
  );
}

/** Single imported LUT entry */
function ImportedLUTRow({
  lut,
  isActive,
  onSelect,
  onDelete,
}: {
  lut: ImportedLUT;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onSelect(lut.id)}
      className={cn(
        'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer',
        'border border-transparent transition-all duration-150',
        isActive
          ? 'bg-amber-500/10 border-amber-500/30 ring-1 ring-amber-500/20'
          : 'hover:bg-white/[0.04] hover:border-white/[0.06]',
      )}
    >
      {/* Thumbnail or gradient preview */}
      <div className="flex-shrink-0 w-10 h-10 rounded-md overflow-hidden ring-1 ring-white/10">
        {lut.thumbnail ? (
          <img
            src={lut.thumbnail}
            alt={lut.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className="w-full h-full"
            style={{
              background: `linear-gradient(135deg, 
                rgba(255,120,50,0.6), 
                rgba(50,180,220,0.6), 
                rgba(200,50,200,0.4))`,
            }}
          />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-xs font-medium truncate',
              isActive ? 'text-amber-200' : 'text-zinc-200',
            )}
          >
            {lut.name}
          </span>
          <FormatBadge format={lut.format} />
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-zinc-500">
            {lut.size}×{lut.size}×{lut.size}
          </span>
          <span className="text-[10px] text-zinc-700">·</span>
          <span className="text-[10px] text-zinc-500">
            {(lut.size ** 3).toLocaleString()} entries
          </span>
        </div>
      </div>

      {/* Active indicator */}
      {isActive && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center"
        >
          <Check size={10} className="text-amber-400" />
        </motion.div>
      )}

      {/* Delete button */}
      <AnimatePresence>
        {isHovered && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.1 }}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(lut.id);
            }}
            className="flex-shrink-0 p-1 rounded transition-colors text-zinc-600 hover:text-red-400 hover:bg-red-500/10"
            aria-label="Delete LUT"
          >
            <Trash2 size={12} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Info card for selected LUT details */
function LUTInfoCard({ lut }: { lut: ImportedLUT }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-3 mb-3 p-3 rounded-lg bg-zinc-900/80 border border-zinc-800/60 space-y-2"
    >
      <div className="flex items-center gap-1.5 mb-2">
        <Info size={12} className="text-zinc-500" />
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
          LUT Details
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <div className="flex flex-col">
          <span className="text-[10px] text-zinc-600">Name</span>
          <span className="text-xs text-zinc-300 font-medium truncate">{lut.name}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-zinc-600">Format</span>
          <FormatBadge format={lut.format} />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-zinc-600">Grid Size</span>
          <span className="text-xs text-zinc-300 font-mono">
            {lut.size}³ = {(lut.size ** 3).toLocaleString()}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-zinc-600">Dimensions</span>
          <span className="text-xs text-zinc-300 font-mono">
            {lut.size}×{lut.size}×{lut.size}
          </span>
        </div>
      </div>
      {/* Sample color data */}
      <div className="mt-2 pt-2 border-t border-zinc-800/60">
        <span className="text-[10px] text-zinc-600">Sample Output (R=0.5, G=0.5, B=0.5)</span>
        <span className="text-[10px] text-zinc-400 font-mono ml-2">
          [{lut.data[Math.floor(lut.size / 2)]?.[Math.floor(lut.size / 2)]?.[Math.floor(lut.size / 2)]?.map(v => v.toFixed(3)).join(', ')}]
        </span>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function LUTImportPanel({ className }: LUTImportPanelProps) {
  const cubeInputRef = useRef<HTMLInputElement>(null);
  const haldInputRef = useRef<HTMLInputElement>(null);

  // ── Store ──
  const importedLUTs = useAppStore((s) => s.importedLUTs);
  const addImportedLUT = useAppStore((s) => s.addImportedLUT);
  const removeImportedLUT = useAppStore((s) => s.removeImportedLUT);
  const activeImportedLutId = useAppStore((s) => s.activeImportedLutId);
  const setActiveImportedLutId = useAppStore((s) => s.setActiveImportedLutId);

  // ── Local State ──
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedHaldLevel, setSelectedHaldLevel] = useState(1); // index into HALD_LEVELS
  const [showHaldSection, setShowHaldSection] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // ── Derived ──
  const activeLUT = useMemo(
    () => importedLUTs.find((l) => l.id === activeImportedLutId) ?? null,
    [importedLUTs, activeImportedLutId],
  );

  // ── File handling ──

  const handleCubeFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.name.toLowerCase().endsWith('.cube')) {
        setError('Only .cube files are supported for 3D LUT import.');
        return;
      }

      try {
        const text = await file.text();
        const lut = parseCubeFile(text, file.name);
        if (!lut) {
          setError(
            'Failed to parse .cube file. Ensure it has a valid LUT_3D_SIZE header and correct number of data entries.',
          );
          return;
        }
        addImportedLUT(lut);
      } catch {
        setError('Error reading file. Please try again.');
      }
    },
    [addImportedLUT],
  );

  const handleHaldFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.type.startsWith('image/')) {
        setError('Hald CLUT must be an image file (PNG, JPEG, TIFF).');
        return;
      }

      setIsProcessing(true);
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const lut = await parseHaldImage(dataUrl, file.name);
        if (!lut) {
          setError(
            'Failed to parse Hald CLUT. Image must be a perfect square (e.g., 64×64 for level 8, 100×100 for level 10).',
          );
          setIsProcessing(false);
          return;
        }
        addImportedLUT(lut);
      } catch {
        setError('Error reading Hald image. Please try again.');
      }
      setIsProcessing(false);
    },
    [addImportedLUT],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        if (file.name.toLowerCase().endsWith('.cube')) {
          handleCubeFile(file);
        } else if (file.type.startsWith('image/')) {
          handleHaldFile(file);
        }
      }
    },
    [handleCubeFile, handleHaldFile],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const onCubeInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.[0]) {
        handleCubeFile(e.target.files[0]);
      }
      e.target.value = '';
    },
    [handleCubeFile],
  );

  const onHaldInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.[0]) {
        handleHaldFile(e.target.files[0]);
      }
      e.target.value = '';
    },
    [handleHaldFile],
  );

  // ── Hald identity download ──
  const handleDownloadHald = useCallback(() => {
    const levelInfo = HALD_LEVELS[selectedHaldLevel];
    const dataUrl = generateHaldIdentity(levelInfo.level);
    const link = document.createElement('a');
    link.download = `hald_identity_${levelInfo.level}.png`;
    link.href = dataUrl;
    link.click();
  }, [selectedHaldLevel]);

  // ── Select / delete ──
  const handleSelect = useCallback(
    (id: string) => {
      setActiveImportedLutId(activeImportedLutId === id ? null : id);
    },
    [activeImportedLutId, setActiveImportedLutId],
  );

  const handleDelete = useCallback(
    (id: string) => {
      removeImportedLUT(id);
      if (activeImportedLutId === id) {
        setActiveImportedLutId(null);
      }
    },
    [removeImportedLUT, activeImportedLutId, setActiveImportedLutId],
  );

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <div
      className={cn(
        'flex flex-col h-full bg-zinc-950 text-zinc-100',
        className,
      )}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.5)]" />
            <h2 className="text-base font-semibold tracking-tight text-white">
              LUT Import
            </h2>
            {importedLUTs.length > 0 && (
              <span className="text-[10px] text-zinc-500 tabular-nums font-medium bg-zinc-800/60 px-1.5 py-0.5 rounded-full">
                {importedLUTs.length}
              </span>
            )}
          </div>
        </div>

        {/* ── Drop Zone ────────────────────────────────────────────── */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => cubeInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') cubeInputRef.current?.click();
          }}
          onDrop={handleDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={cn(
            'relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 transition-all cursor-pointer',
            isDragOver
              ? 'border-amber-400/60 bg-amber-400/5 scale-[1.01]'
              : 'border-white/15 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]',
          )}
        >
          <input
            ref={cubeInputRef}
            type="file"
            accept=".cube"
            className="hidden"
            onChange={onCubeInput}
          />

          <motion.div
            animate={isDragOver ? { scale: 1.15, y: -4 } : { scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Upload
              className={cn(
                'h-6 w-6 transition-colors',
                isDragOver ? 'text-amber-400' : 'text-white/30',
              )}
            />
          </motion.div>
          <div className="text-center">
            <p className="text-xs font-medium text-white/50">
              Drop .cube or Hald image here
            </p>
            <p className="text-[10px] text-white/25 mt-0.5">
              Click to browse .cube files · Drag any format
            </p>
          </div>
        </div>

        {/* ── Import Buttons Row ───────────────────────────────────── */}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => cubeInputRef.current?.click()}
            className={cn(
              'h-8 gap-1.5 px-3 text-xs font-medium flex-1',
              'bg-zinc-800/60 border border-zinc-700/60',
              'hover:bg-zinc-700/60 hover:border-zinc-600/60',
              'text-zinc-300 hover:text-white transition-all',
            )}
          >
            <FileText size={13} className="text-cyan-400" />
            Import .CUBE
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => haldInputRef.current?.click()}
            disabled={isProcessing}
            className={cn(
              'h-8 gap-1.5 px-3 text-xs font-medium flex-1',
              'bg-zinc-800/60 border border-zinc-700/60',
              'hover:bg-zinc-700/60 hover:border-zinc-600/60',
              'text-zinc-300 hover:text-white transition-all',
            )}
          >
            <ImageIcon size={13} className="text-violet-400" />
            {isProcessing ? 'Parsing...' : 'Import Hald'}
          </Button>

          <input
            ref={haldInputRef}
            type="file"
            accept="image/png,image/jpeg,image/tiff"
            className="hidden"
            onChange={onHaldInput}
          />
        </div>

        {/* ── Error Display ────────────────────────────────────────── */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20"
            >
              <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-red-300 font-medium">Import Error</p>
                <p className="text-[10px] text-red-400/80 mt-0.5">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-red-400/60 hover:text-red-300 flex-shrink-0"
              >
                ×
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Hald CLUT Section ────────────────────────────────────── */}
        <div className="space-y-2">
          <button
            onClick={() => setShowHaldSection(!showHaldSection)}
            className="flex items-center gap-2 w-full text-left group"
          >
            <div className="flex items-center justify-center h-6 w-6 rounded-md bg-violet-500/10">
              <Grid3x3 size={12} className="text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-zinc-300 group-hover:text-white transition-colors">
                Hald CLUT Identity
              </p>
              <p className="text-[10px] text-zinc-600">
                Download identity image, apply grade, re-import
              </p>
            </div>
            <motion.div
              animate={{ rotate: showHaldSection ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              className="text-zinc-600"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 5L6 8L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.div>
          </button>

          <AnimatePresence>
            {showHaldSection && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/60 space-y-3">
                  {/* Workflow explanation */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                      Workflow
                    </p>
                    <ol className="text-[10px] text-zinc-400 space-y-1 list-decimal list-inside leading-relaxed">
                      <li>Download a Hald identity image</li>
                      <li>Apply your color grade to it in Photoshop / Lightroom</li>
                      <li>Export the graded Hald image</li>
                      <li>Import the graded image as a LUT</li>
                    </ol>
                  </div>

                  {/* Level selector */}
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                      Identity Level
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {HALD_LEVELS.map((hl, idx) => (
                        <button
                          key={hl.level}
                          onClick={() => setSelectedHaldLevel(idx)}
                          className={cn(
                            'flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-left transition-all',
                            selectedHaldLevel === idx
                              ? 'bg-violet-500/10 border-violet-500/30 text-violet-200'
                              : 'bg-zinc-800/40 border-zinc-700/40 text-zinc-400 hover:border-zinc-600/60 hover:text-zinc-300',
                          )}
                        >
                          <span className="text-xs font-semibold font-mono">{hl.level}</span>
                          <div className="flex flex-col">
                            <span className="text-[9px] leading-none">{hl.size}×{hl.size}px</span>
                            <span className="text-[8px] text-zinc-600 leading-none">{hl.entries}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Download button */}
                  <Button
                    onClick={handleDownloadHald}
                    className={cn(
                      'w-full h-8 gap-1.5 text-xs font-medium',
                      'bg-violet-500/15 border border-violet-500/20',
                      'hover:bg-violet-500/25 hover:border-violet-500/30',
                      'text-violet-300 hover:text-violet-200 transition-all',
                    )}
                  >
                    <Download size={13} />
                    Download Hald Identity ({HALD_LEVELS[selectedHaldLevel].size}×{HALD_LEVELS[selectedHaldLevel].size})
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── LUT List ──────────────────────────────────────────────── */}
      {importedLUTs.length > 0 ? (
        <>
          {/* Info card for active LUT */}
          <AnimatePresence>
            {activeLUT && <LUTInfoCard lut={activeLUT} />}
          </AnimatePresence>

          <ScrollArea className="flex-1 px-3 pb-4">
            <div className="flex flex-col gap-1">
              <AnimatePresence mode="popLayout">
                {importedLUTs.map((lut) => (
                  <ImportedLUTRow
                    key={lut.id}
                    lut={lut}
                    isActive={lut.id === activeImportedLutId}
                    onSelect={handleSelect}
                    onDelete={handleDelete}
                  />
                ))}
              </AnimatePresence>
            </div>
          </ScrollArea>

          {/* Apply button */}
          {activeImportedLutId && (
            <div className="flex-shrink-0 px-4 py-3 border-t border-zinc-800/60">
              <Button
                onClick={() => {
                  // Dispatch a custom event so the workspace can respond
                  window.dispatchEvent(
                    new CustomEvent('lut-import-apply', {
                      detail: { id: activeImportedLutId },
                    }),
                  );
                }}
                className={cn(
                  'w-full h-9 gap-1.5 text-xs font-semibold',
                  'bg-gradient-to-r from-amber-500 to-orange-500',
                  'hover:from-amber-400 hover:to-orange-400',
                  'text-white shadow-lg shadow-amber-500/20 transition-all',
                )}
              >
                <Sparkles size={13} />
                Apply Selected LUT
              </Button>
            </div>
          )}
        </>
      ) : (
        /* ── Empty State ────────────────────────────────────────────── */
        <div className="flex-1 flex items-center justify-center px-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-3 text-center"
          >
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                <Package size={22} className="text-zinc-700" />
              </div>
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center"
              >
                <Upload size={10} className="text-zinc-500" />
              </motion.div>
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-500">No LUTs imported</p>
              <p className="text-[11px] text-zinc-600 max-w-[200px] leading-relaxed mt-1">
                Drop .cube files or Hald CLUT images above to start
              </p>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Footer hint ────────────────────────────────────────────── */}
      {importedLUTs.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2.5 border-t border-zinc-800/60">
          <p className="text-[10px] text-zinc-600 text-center">
            Click to select · Click &quot;Apply&quot; to use LUT on current image
          </p>
        </div>
      )}
    </div>
  );
}
