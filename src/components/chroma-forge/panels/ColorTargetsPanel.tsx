'use client';

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAppStore, type ColorTarget } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Plus,
  Trash2,
  ArrowRight,
  RotateCcw,
  Wand2,
  Target,
  Loader2,
  Check,
  Pipette,
  Eye,
} from 'lucide-react';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface ColorTargetsPanelProps {
  className?: string;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Extract dominant colors from an image using a simple k-means approach.
 * Returns the top N colors as RGB arrays.
 */
function extractDominantColors(imageDataUrl: string, numColors: number = 6): Promise<[number, number, number][]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const sampleSize = 100; // downsample for speed
      canvas.width = sampleSize;
      canvas.height = sampleSize;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
      const pixelData = ctx.getImageData(0, 0, sampleSize, sampleSize).data;

      // Collect pixel colors
      const pixels: [number, number, number][] = [];
      for (let i = 0; i < pixelData.length; i += 4) {
        const a = pixelData[i + 3];
        if (a < 128) continue; // skip transparent
        pixels.push([pixelData[i], pixelData[i + 1], pixelData[i + 2]]);
      }

      if (pixels.length === 0) {
        resolve([]);
        return;
      }

      // Simple k-means clustering
      const k = Math.min(numColors, pixels.length);
      // Initialize centroids from evenly spaced samples
      const centroids: [number, number, number][] = [];
      for (let i = 0; i < k; i++) {
        const idx = Math.floor((i / k) * pixels.length);
        centroids.push([...pixels[idx]]);
      }

      // Run k-means iterations
      for (let iter = 0; iter < 10; iter++) {
        // Assign pixels to nearest centroid
        const clusters: [number, number, number][][] = Array.from({ length: k }, () => []);

        for (const pixel of pixels) {
          let minDist = Infinity;
          let minIdx = 0;
          for (let c = 0; c < k; c++) {
            const dist = colorDistance(pixel, centroids[c]);
            if (dist < minDist) {
              minDist = dist;
              minIdx = c;
            }
          }
          clusters[minIdx].push(pixel);
        }

        // Update centroids
        for (let c = 0; c < k; c++) {
          if (clusters[c].length === 0) continue;
          const sum: [number, number, number] = [0, 0, 0];
          for (const p of clusters[c]) {
            sum[0] += p[0];
            sum[1] += p[1];
            sum[2] += p[2];
          }
          centroids[c] = [
            Math.round(sum[0] / clusters[c].length),
            Math.round(sum[1] / clusters[c].length),
            Math.round(sum[2] / clusters[c].length),
          ];
        }
      }

      // Sort by cluster size (approximate) and filter similar colors
      const filtered: [number, number, number][] = [];
      for (const centroid of centroids) {
        const isDuplicate = filtered.some(
          (existing) => colorDistance(existing, centroid) < 40,
        );
        if (!isDuplicate) {
          filtered.push(centroid);
        }
      }

      resolve(filtered.slice(0, numColors));
    };
    img.onerror = () => resolve([]);
    img.src = imageDataUrl;
  });
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

/** Styled native color picker input */
function ColorPickerInput({
  value,
  onChange,
  label,
}: {
  value: [number, number, number];
  onChange: (rgb: [number, number, number]) => void;
  label: string;
}) {
  const hex = rgbToHex(value[0], value[1], value[2]);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2">
          <button
            onClick={() => inputRef.current?.click()}
            className={cn(
              'w-8 h-8 rounded-lg border-2 transition-all flex-shrink-0',
              'border-white/15 hover:border-white/30 hover:scale-105',
              'shadow-sm cursor-pointer',
            )}
            style={{ backgroundColor: hex }}
            aria-label={label}
          />
          <input
            ref={inputRef}
            type="color"
            value={hex}
            onChange={(e) => onChange(hexToRgb(e.target.value))}
            className="sr-only"
            tabIndex={-1}
          />
          <span className="text-[10px] font-mono text-zinc-500 uppercase">
            {hex}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
        {label}: {hex}
      </TooltipContent>
    </Tooltip>
  );
}

/** Arrow visual between source and target colors */
function ColorShiftArrow({
  sourceColor,
  targetColor,
  strength,
}: {
  sourceColor: [number, number, number];
  targetColor: [number, number, number];
  strength: number;
}) {
  const sourceHex = rgbToHex(sourceColor[0], sourceColor[1], sourceColor[2]);
  const targetHex = rgbToHex(targetColor[0], targetColor[1], targetColor[2]);

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <div
        className="w-3 h-3 rounded-sm ring-1 ring-white/10 transition-colors"
        style={{ backgroundColor: sourceHex }}
      />
      <div className="relative flex items-center justify-center w-6">
        {/* Gradient line */}
        <div
          className="absolute h-[2px] w-full rounded-full transition-opacity"
          style={{
            background: `linear-gradient(90deg, ${sourceHex}, ${targetHex})`,
            opacity: 0.3 + (strength / 100) * 0.7,
          }}
        />
        <ArrowRight
          size={10}
          className="relative text-zinc-600"
          style={{ opacity: 0.4 + (strength / 100) * 0.6 }}
        />
      </div>
      <div
        className="w-3 h-3 rounded-sm ring-1 ring-white/10 transition-colors"
        style={{ backgroundColor: targetHex }}
      />
    </div>
  );
}

/** Single color target row */
function ColorTargetRow({
  target,
  onUpdate,
  onDelete,
}: {
  target: ColorTarget;
  onUpdate: (id: string, data: Partial<ColorTarget>) => void;
  onDelete: (id: string) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 20, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group relative p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/50 hover:border-zinc-700/50 transition-all space-y-3"
    >
      {/* Header row: source → target with arrow */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider w-10 flex-shrink-0">
            Source
          </span>
          <ColorPickerInput
            value={target.sourceColor}
            onChange={(rgb) => onUpdate(target.id, { sourceColor: rgb })}
            label="Source color"
          />
        </div>

        <ColorShiftArrow
          sourceColor={target.sourceColor}
          targetColor={target.targetColor}
          strength={target.strength}
        />

        <div className="flex items-center gap-2 flex-1 justify-end">
          <ColorPickerInput
            value={target.targetColor}
            onChange={(rgb) => onUpdate(target.id, { targetColor: rgb })}
            label="Target color"
          />
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider w-10 flex-shrink-0 text-right">
            Target
          </span>
        </div>
      </div>

      {/* Sliders */}
      <div className="space-y-2.5">
        {/* Tolerance slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-500 font-medium">Tolerance</span>
            <span className="text-[10px] text-zinc-400 tabular-nums font-semibold">
              {target.tolerance}
            </span>
          </div>
          <div className="relative">
            <div
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full opacity-20"
              style={{
                background: `linear-gradient(90deg, #3b82f6 ${target.tolerance}%, transparent ${target.tolerance}%)`,
              }}
            />
            <Slider
              min={0}
              max={100}
              step={1}
              value={[target.tolerance]}
              onValueChange={([v]) => onUpdate(target.id, { tolerance: v })}
              className={cn(
                'relative z-10',
                '[&_[data-slot=slider-track]]:h-1',
                '[&_[data-slot=slider-range]]:bg-blue-500/70',
                '[&_[data-slot=slider-thumb]]:size-2.5',
                '[&_[data-slot=slider-thumb]]:border-blue-400',
                '[&_[data-slot=slider-thumb]]:bg-zinc-100',
                '[&_[data-slot=slider-thumb]]:shadow-none',
              )}
            />
          </div>
          <p className="text-[9px] text-zinc-700 leading-tight">
            How similar colors must be to match (higher = more inclusive)
          </p>
        </div>

        {/* Strength slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-500 font-medium">Strength</span>
            <span className="text-[10px] text-zinc-400 tabular-nums font-semibold">
              {target.strength}%
            </span>
          </div>
          <div className="relative">
            <div
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full opacity-20"
              style={{
                background: `linear-gradient(90deg, #f59e0b ${target.strength}%, transparent ${target.strength}%)`,
              }}
            />
            <Slider
              min={0}
              max={100}
              step={1}
              value={[target.strength]}
              onValueChange={([v]) => onUpdate(target.id, { strength: v })}
              className={cn(
                'relative z-10',
                '[&_[data-slot=slider-track]]:h-1',
                '[&_[data-slot=slider-range]]:bg-amber-500/70',
                '[&_[data-slot=slider-thumb]]:size-2.5',
                '[&_[data-slot=slider-thumb]]:border-amber-400',
                '[&_[data-slot=slider-thumb]]:bg-zinc-100',
                '[&_[data-slot=slider-thumb]]:shadow-none',
              )}
            />
          </div>
          <p className="text-[9px] text-zinc-700 leading-tight">
            How strongly to shift matched colors toward target
          </p>
        </div>
      </div>

      {/* Delete button */}
      <AnimatePresence>
        {isHovered && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.1 }}
            onClick={() => onDelete(target.id)}
            className="absolute top-2 right-2 p-1 rounded transition-colors text-zinc-700 hover:text-red-400 hover:bg-red-500/10"
            aria-label="Delete target"
          >
            <Trash2 size={12} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function ColorTargetsPanel({ className }: ColorTargetsPanelProps) {
  // ── Store ──
  const colorTargets = useAppStore((s) => s.colorTargets);
  const addColorTarget = useAppStore((s) => s.addColorTarget);
  const removeColorTarget = useAppStore((s) => s.removeColorTarget);
  const updateColorTarget = useAppStore((s) => s.updateColorTarget);
  const currentImage = useAppStore((s) => s.currentImage);

  // ── Local State ──
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzedColors, setAnalyzedColors] = useState<[number, number, number][] | null>(null);
  const [sourceHex, setSourceHex] = useState('#d4a373');
  const [targetHex, setTargetHex] = useState('#e07a5f');
  const [showAnalyzedColors, setShowAnalyzedColors] = useState(false);

  // ── Handlers ──

  const handleAddTarget = useCallback(() => {
    const newTarget: ColorTarget = {
      id: `ct-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sourceColor: hexToRgb(sourceHex),
      targetColor: hexToRgb(targetHex),
      tolerance: 30,
      strength: 80,
    };
    addColorTarget(newTarget);
  }, [sourceHex, targetHex, addColorTarget]);

  const handleAddFromAnalyzed = useCallback(
    (color: [number, number, number]) => {
      // Create a shifted target (slightly modify the hue)
      const hueShift: [number, number, number] = [
        Math.min(255, color[0] + 30),
        Math.max(0, color[1] - 15),
        Math.min(255, color[2] + 20),
      ];
      const newTarget: ColorTarget = {
        id: `ct-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sourceColor: color,
        targetColor: hueShift,
        tolerance: 25,
        strength: 70,
      };
      addColorTarget(newTarget);
    },
    [addColorTarget],
  );

  const handleAutoAnalyze = useCallback(async () => {
    if (!currentImage || isAnalyzing) return;

    setIsAnalyzing(true);
    setShowAnalyzedColors(true);

    try {
      const colors = await extractDominantColors(currentImage.dataUrl, 8);
      setAnalyzedColors(colors);
    } catch {
      setAnalyzedColors([]);
    }

    setIsAnalyzing(false);
  }, [currentImage, isAnalyzing]);

  const handleResetAll = useCallback(() => {
    // Remove all targets one by one (in reverse to avoid index issues)
    [...colorTargets].forEach((t) => removeColorTarget(t.id));
    setAnalyzedColors(null);
    setShowAnalyzedColors(false);
  }, [colorTargets, removeColorTarget]);

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
            <div className="w-1.5 h-1.5 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.5)]" />
            <h2 className="text-base font-semibold tracking-tight text-white">
              Color Targets
            </h2>
            {colorTargets.length > 0 && (
              <span className="text-[10px] text-zinc-500 tabular-nums font-medium bg-zinc-800/60 px-1.5 py-0.5 rounded-full">
                {colorTargets.length}
              </span>
            )}
          </div>

          {colorTargets.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetAll}
                  className="h-7 px-2 text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                >
                  <RotateCcw size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
                Reset all targets
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* ── Add Color Target Section ─────────────────────────────── */}
        <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/50 space-y-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
            Add Color Target
          </p>

          <div className="flex items-center gap-3">
            {/* Source color picker */}
            <div className="flex items-center gap-2 flex-1">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider flex-shrink-0">
                Src
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'color';
                    input.value = sourceHex;
                    input.addEventListener('input', (e) => {
                      setSourceHex((e.target as HTMLInputElement).value);
                    });
                    input.click();
                  }}
                  className="w-8 h-8 rounded-lg border-2 border-white/15 hover:border-white/30 hover:scale-105 transition-all cursor-pointer shadow-sm"
                  style={{ backgroundColor: sourceHex }}
                  aria-label="Source color"
                />
                <span className="text-[9px] font-mono text-zinc-600">
                  {sourceHex}
                </span>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex items-center justify-center">
              <ArrowRight size={14} className="text-zinc-600" />
            </div>

            {/* Target color picker */}
            <div className="flex items-center gap-2 flex-1 justify-end">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono text-zinc-600">
                  {targetHex}
                </span>
                <button
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'color';
                    input.value = targetHex;
                    input.addEventListener('input', (e) => {
                      setTargetHex((e.target as HTMLInputElement).value);
                    });
                    input.click();
                  }}
                  className="w-8 h-8 rounded-lg border-2 border-white/15 hover:border-white/30 hover:scale-105 transition-all cursor-pointer shadow-sm"
                  style={{ backgroundColor: targetHex }}
                  aria-label="Target color"
                />
              </div>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider flex-shrink-0">
                Tgt
              </span>
            </div>
          </div>

          <Button
            onClick={handleAddTarget}
            className={cn(
              'w-full h-8 gap-1.5 text-xs font-medium',
              'bg-rose-500/15 border border-rose-500/20',
              'hover:bg-rose-500/25 hover:border-rose-500/30',
              'text-rose-300 hover:text-rose-200 transition-all',
            )}
          >
            <Plus size={13} />
            Add Target
          </Button>
        </div>

        {/* ── Auto-Analyze Button ─────────────────────────────────── */}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleAutoAnalyze}
            disabled={!currentImage || isAnalyzing}
            className={cn(
              'h-8 gap-1.5 px-3 text-xs font-medium flex-1',
              'bg-zinc-800/60 border border-zinc-700/60',
              'hover:bg-zinc-700/60 hover:border-zinc-600/60',
              'text-zinc-300 hover:text-white transition-all',
              !currentImage && 'opacity-50 cursor-not-allowed',
            )}
          >
            {isAnalyzing ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Wand2 size={13} className="text-purple-400" />
            )}
            {isAnalyzing ? 'Analyzing...' : 'Auto-Analyze'}
          </Button>

          {!currentImage && (
            <p className="flex items-center text-[10px] text-zinc-600">
              <Eye size={10} className="mr-1" />
              Load an image first
            </p>
          )}
        </div>

        {/* ── Analyzed Colors Palette ──────────────────────────────── */}
        <AnimatePresence>
          {showAnalyzedColors && analyzedColors && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/50 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                    Detected Colors
                  </p>
                  <button
                    onClick={() => setShowAnalyzedColors(false)}
                    className="text-zinc-600 hover:text-zinc-400 text-[10px]"
                  >
                    Hide
                  </button>
                </div>

                {analyzedColors.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {analyzedColors.map((color, idx) => {
                      const hex = rgbToHex(color[0], color[1], color[2]);
                      return (
                        <Tooltip key={idx}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleAddFromAnalyzed(color)}
                              className="group/swatch flex items-center gap-1.5 p-1 rounded-md hover:bg-white/[0.06] transition-all"
                            >
                              <div
                                className="w-6 h-6 rounded-md ring-1 ring-white/10 group-hover/swatch:ring-white/20 group-hover/swatch:scale-110 transition-all cursor-pointer"
                                style={{ backgroundColor: hex }}
                              />
                              <Plus
                                size={10}
                                className="text-zinc-700 group-hover/swatch:text-zinc-400 transition-colors"
                              />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
                            {hex} — Click to add as target
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[10px] text-zinc-600">
                    No dominant colors detected. Try a different image.
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Target List ────────────────────────────────────────────── */}
      {colorTargets.length > 0 ? (
        <ScrollArea className="flex-1 px-3 pb-4">
          <div className="flex flex-col gap-2">
            <AnimatePresence mode="popLayout">
              {colorTargets.map((target) => (
                <ColorTargetRow
                  key={target.id}
                  target={target}
                  onUpdate={updateColorTarget}
                  onDelete={removeColorTarget}
                />
              ))}
            </AnimatePresence>
          </div>
        </ScrollArea>
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
                <Target size={22} className="text-zinc-700" />
              </div>
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center"
              >
                <Pipette size={10} className="text-zinc-500" />
              </motion.div>
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-500">No color targets</p>
              <p className="text-[11px] text-zinc-600 max-w-[200px] leading-relaxed mt-1">
                Add source → target color pairs to precisely match colors in your image
              </p>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Footer hint ────────────────────────────────────────────── */}
      {colorTargets.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2.5 border-t border-zinc-800/60">
          <p className="text-[10px] text-zinc-600 text-center">
            Targets are applied in order · Higher tolerance catches more similar colors
          </p>
        </div>
      )}
    </div>
  );
}
