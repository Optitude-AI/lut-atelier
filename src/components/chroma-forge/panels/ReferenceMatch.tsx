'use client';

import React, { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAppStore, type ReferenceImage } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Upload,
  Image as ImageIcon,
  Sparkles,
  Check,
  Loader2,
} from 'lucide-react';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface ReferenceMatchProps {
  className?: string;
}

interface FakeToneData {
  shadows: number;
  midtones: number;
  highlights: number;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function generateFakeDominantColors(): string[] {
  const palettes = [
    ['#D4A373', '#CCD5AE', '#E9EDC9', '#FEFAE0', '#FAEDCD'],
    ['#264653', '#2A9D8F', '#E9C46A', '#F4A261', '#E76F51'],
    ['#606C38', '#283618', '#FEFAE0', '#DDA15E', '#BC6C25'],
    ['#0B132B', '#1C2541', '#3A506B', '#5BC0BE', '#6FFFE9'],
    ['#CB997E', '#DDBEA9', '#FFE8D6', '#B7B7A4', '#A5A58D'],
    ['#582F0E', '#7F4F24', '#936639', '#A68A64', '#B6AD90'],
    ['#3D405B', '#81B29A', '#F2CC8F', '#E07A5F', '#F4F1DE'],
    ['#03071E', '#370617', '#6A040F', '#9D0208', '#D00000'],
    ['#F8F9FA', '#E9ECEF', '#DEE2E6', '#CED4DA', '#ADB5BD'],
    ['#2B2D42', '#8D99AE', '#EDF2F4', '#EF233C', '#D90429'],
  ];
  return palettes[Math.floor(Math.random() * palettes.length)];
}

function generateFakeToneData(): FakeToneData {
  return {
    shadows: Math.floor(Math.random() * 40) + 10,
    midtones: Math.floor(Math.random() * 30) + 40,
    highlights: Math.floor(Math.random() * 30) + 20,
  };
}

function generateFakePalette(): string[] {
  const colors = generateFakeDominantColors();
  // Slightly shift to simulate a "palette" separate from dominant
  return colors.slice(0, 3).concat([
    `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`,
    `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`,
  ]);
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

/** Pulsing-dot loading animation for the AI analyzing state. */
function AnalyzingAnimation() {
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.span
          key={i}
          className="inline-block h-2 w-2 rounded-full bg-amber-400"
          animate={{
            scale: [1, 1.6, 1],
            opacity: [0.4, 1, 0.4],
          }}
          transition={{
            duration: 1,
            repeat: Infinity,
            delay: i * 0.15,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

/** Rounded color swatch with subtle shadow. */
function ColorSwatch({ color, size = 'md' }: { color: string; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'h-5 w-5' : 'h-8 w-8';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-block rounded-md shadow-sm ring-1 ring-white/10 cursor-default transition-transform hover:scale-110',
            sizeClass,
          )}
          style={{ backgroundColor: color }}
        />
      </TooltipTrigger>
      <TooltipContent side="top" className="font-mono text-[10px]">
        {color.toUpperCase()}
      </TooltipContent>
    </Tooltip>
  );
}

/** Mini bar chart showing shadows / midtones / highlights distribution. */
function ToneDistribution({ data }: { data: FakeToneData }) {
  const bars: { label: string; value: number; color: string }[] = [
    { label: 'Shadows', value: data.shadows, color: '#6366F1' },
    { label: 'Midtones', value: data.midtones, color: '#A855F7' },
    { label: 'Highlights', value: data.highlights, color: '#F59E0B' },
  ];

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-white/40 font-medium">
        Tone Distribution
      </p>
      <div className="flex items-end gap-2 h-16">
        {bars.map((bar) => (
          <div key={bar.label} className="flex flex-col items-center gap-1 flex-1">
            <motion.div
              className="w-full rounded-t-sm"
              style={{ backgroundColor: bar.color }}
              initial={{ height: 0 }}
              animate={{ height: `${bar.value}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
            <span className="text-[9px] text-white/40 tabular-nums">{bar.value}%</span>
            <span className="text-[8px] text-white/25">{bar.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Single influence slider row. */
function InfluenceSlider({
  label,
  value,
  accentColor,
  tooltip,
  onChange,
}: {
  label: string;
  value: number;
  accentColor: string;
  tooltip: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-white/70">{label}</span>
        <span
          className="text-xs tabular-nums font-semibold"
          style={{ color: accentColor }}
        >
          {value}
        </span>
      </div>
      <div className="relative">
        {/* Accent bar behind the slider track */}
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full opacity-30"
          style={{
            background: `linear-gradient(90deg, ${accentColor} ${value}%, transparent ${value}%)`,
          }}
        />
        <Slider
          min={0}
          max={100}
          step={1}
          value={[value]}
          onValueChange={([v]) => onChange(v)}
          className="relative z-10"
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function ReferenceMatch({ className }: ReferenceMatchProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Store ──
  const referenceImages = useAppStore((s) => s.referenceImages);
  const setReferenceImages = useAppStore((s) => s.setReferenceImages);
  const activeReferenceId = useAppStore((s) => s.activeReferenceId);
  const setActiveReferenceId = useAppStore((s) => s.setActiveReferenceId);
  const matchInfluence = useAppStore((s) => s.matchInfluence);
  const setMatchInfluence = useAppStore((s) => s.setMatchInfluence);
  const isMatching = useAppStore((s) => s.isMatching);
  const setIsMatching = useAppStore((s) => s.setIsMatching);
  const addAdjustment = useAppStore((s) => s.addAdjustment);

  // ── Local State ──
  const [isDragOver, setIsDragOver] = useState(false);
  const [hasMatched, setHasMatched] = useState(false);

  // ── Derived ──
  const activeReference = referenceImages.find((r) => r.id === activeReferenceId) ?? null;

  // ── File handling ──
  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const newImages: ReferenceImage[] = [];
      const existingCount = referenceImages.length;

      Array.from(files)
        .filter((f) => f.type.startsWith('image/'))
        .forEach((file, idx) => {
          const url = URL.createObjectURL(file);
          const id = `ref-${Date.now()}-${idx}`;
          newImages.push({
            id,
            name: file.name,
            url,
            dominantColors: generateFakeDominantColors(),
            palette: generateFakePalette(),
          });
        });

      if (newImages.length === 0) return;

      const updated = [...referenceImages, ...newImages];
      setReferenceImages(updated);

      // Auto-select the first new image
      if (newImages.length > 0) {
        setActiveReferenceId(newImages[0].id);
        setHasMatched(false);
      }
    },
    [referenceImages, setReferenceImages, setActiveReferenceId],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [handleFiles],
  );

  // ── Remove reference ──
  const removeReference = useCallback(
    (id: string) => {
      const updated = referenceImages.filter((r) => r.id !== id);
      setReferenceImages(updated);
      if (activeReferenceId === id) {
        setActiveReferenceId(updated.length > 0 ? updated[0].id : null);
        setHasMatched(false);
      }
    },
    [referenceImages, activeReferenceId, setReferenceImages, setActiveReferenceId],
  );

  // ── Fake AI match ──
  const handleAnalyze = useCallback(async () => {
    if (!activeReferenceId || isMatching) return;
    setIsMatching(true);
    setHasMatched(false);

    // Simulate 2-second AI processing
    await new Promise((resolve) => setTimeout(resolve, 2000));

    setIsMatching(false);
    setHasMatched(true);
  }, [activeReferenceId, isMatching, setIsMatching]);

  // ── Apply as editable look ──
  const handleApply = useCallback(() => {
    if (!activeReference) return;

    addAdjustment({
      id: `adj-ai-${Date.now()}`,
      name: `AI Match — ${activeReference.name}`,
      type: 'ai-match',
      enabled: true,
      opacity: 100,
      params: {
        referenceId: activeReference.id,
        influence: { ...matchInfluence },
        dominantColors: activeReference.dominantColors,
        palette: activeReference.palette,
      },
    });

    setHasMatched(false);
  }, [activeReference, matchInfluence, addAdjustment]);

  // ── Slider config ──
  const sliderConfigs: {
    key: keyof typeof matchInfluence;
    label: string;
    color: string;
    tooltip: string;
  }[] = [
    {
      key: 'contrast',
      label: 'Contrast',
      color: '#F97316',
      tooltip: 'Controls the overall contrast range applied from the reference',
    },
    {
      key: 'saturation',
      label: 'Saturation',
      color: '#EC4899',
      tooltip: 'How much of the reference saturation profile is transferred',
    },
    {
      key: 'colorBalance',
      label: 'Color Balance',
      color: '#8B5CF6',
      tooltip: 'Shifts the color temperature and tint toward the reference',
    },
    {
      key: 'skinTones',
      label: 'Skin Tones',
      color: '#F59E0B',
      tooltip: 'Preserves natural skin tone rendering while matching',
    },
    {
      key: 'luminanceRollOff',
      label: 'Luminance Roll-off',
      color: '#06B6D4',
      tooltip: 'Controls highlight compression and shadow lifting curve',
    },
  ];

  // ── Fake tone data (derived from active reference for display) ──
  const fakeToneData: FakeToneData = {
    shadows: 25 + Math.round((matchInfluence.contrast / 100) * 15),
    midtones: 55 - Math.round((matchInfluence.saturation / 100) * 10),
    highlights: 30 + Math.round((matchInfluence.luminanceRollOff / 100) * 20),
  };

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <div className={cn('w-full max-w-md space-y-4', className)}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        {/* ── Title ── */}
        <div className="mb-4 flex items-center gap-2">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-amber-500/15">
            <Sparkles className="h-4 w-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white/90">AI Reference Match</h2>
            <p className="text-[11px] text-white/40">Drop a photo and let AI match the color grade</p>
          </div>
        </div>

        {/* ── 1. Drop Zone ── */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
          }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={cn(
            'relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 transition-all cursor-pointer',
            isDragOver
              ? 'border-amber-400/60 bg-amber-400/5 scale-[1.01]'
              : 'border-white/15 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]',
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onFileInput}
          />

          <motion.div
            animate={isDragOver ? { scale: 1.15, y: -4 } : { scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Upload
              className={cn(
                'h-8 w-8 transition-colors',
                isDragOver ? 'text-amber-400' : 'text-white/30',
              )}
            />
          </motion.div>
          <div className="text-center">
            <p className="text-xs font-medium text-white/50">
              Drop reference photo here or click to browse
            </p>
            <p className="text-[10px] text-white/25 mt-1">Supports JPG, PNG, WebP</p>
          </div>
        </div>

        {/* ── 2. Reference Gallery (when multiple) ── */}
        <AnimatePresence>
          {referenceImages.length > 1 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
            >
              <ScrollArea className="w-full mt-3">
                <div className="flex gap-2 pb-2">
                  {referenceImages.map((ref) => (
                    <motion.button
                      key={ref.id}
                      onClick={() => {
                        setActiveReferenceId(ref.id);
                        setHasMatched(false);
                      }}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.97 }}
                      className={cn(
                        'relative flex-shrink-0 h-14 w-14 rounded-lg overflow-hidden ring-2 transition-shadow',
                        activeReferenceId === ref.id
                          ? 'ring-amber-400 shadow-lg shadow-amber-400/20'
                          : 'ring-white/10 hover:ring-white/25',
                      )}
                    >
                      <img
                        src={ref.url}
                        alt={ref.name}
                        className="h-full w-full object-cover"
                      />
                    </motion.button>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 3. Active Reference Preview ── */}
        <AnimatePresence mode="wait">
          {activeReference && (
            <motion.div
              key={activeReference.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
              <Card className="mt-4 border-white/10 bg-white/[0.03] py-0 gap-0 overflow-hidden">
                {/* Preview Image */}
                <div className="relative group">
                  <img
                    src={activeReference.url}
                    alt={activeReference.name}
                    className="w-full h-40 object-cover"
                  />
                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

                  {/* Remove button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeReference(activeReference.id);
                    }}
                    className="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/70"
                    aria-label="Remove reference"
                  >
                    <span className="text-white text-xs leading-none">&times;</span>
                  </button>

                  {/* Name badge */}
                  <div className="absolute bottom-2 left-3">
                    <p className="text-[11px] font-medium text-white/80 truncate max-w-[200px]">
                      {activeReference.name}
                    </p>
                  </div>
                </div>

                <CardContent className="p-4 space-y-4">
                  {/* Dominant Colors */}
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-widest text-white/40 font-medium">
                      Dominant Colors
                    </p>
                    <div className="flex gap-1.5">
                      {activeReference.dominantColors.map((color, idx) => (
                        <ColorSwatch key={idx} color={color} size="md" />
                      ))}
                    </div>
                  </div>

                  {/* Tone Distribution */}
                  <ToneDistribution data={fakeToneData} />
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 4. Influence Sliders ── */}
        <AnimatePresence>
          {activeReference && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="mt-4 space-y-4"
            >
              <Card className="border-white/10 bg-white/[0.03] py-0 gap-0">
                <CardContent className="p-4 space-y-5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <ImageIcon className="h-3.5 w-3.5 text-white/40" />
                    <p className="text-[10px] uppercase tracking-widest text-white/40 font-medium">
                      Match Influence
                    </p>
                  </div>

                  {sliderConfigs.map(({ key, label, color, tooltip }) => (
                    <Tooltip key={key}>
                      <TooltipTrigger asChild>
                        <div className="outline-none">
                          <InfluenceSlider
                            label={label}
                            value={matchInfluence[key]}
                            accentColor={color}
                            tooltip={tooltip}
                            onChange={(v) => setMatchInfluence({ [key]: v })}
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-[180px] text-[10px]">
                        {tooltip}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 5. Analyze & Match Button ── */}
        <AnimatePresence>
          {activeReference && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, delay: 0.15 }}
              className="mt-4"
            >
              <Button
                onClick={handleAnalyze}
                disabled={isMatching}
                className={cn(
                  'w-full h-11 text-sm font-semibold relative overflow-hidden transition-all',
                  isMatching
                    ? 'bg-amber-500/20 text-amber-300 cursor-wait'
                    : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white shadow-lg shadow-amber-500/20',
                )}
              >
                {/* Animated shimmer background while matching */}
                {isMatching && (
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                    animate={{ x: ['-100%', '100%'] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  />
                )}

                <AnimatePresence mode="wait">
                  {isMatching ? (
                    <motion.span
                      key="loading"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="flex items-center gap-2.5"
                    >
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Analyzing reference...</span>
                      <AnalyzingAnimation />
                    </motion.span>
                  ) : hasMatched ? (
                    <motion.span
                      key="success"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center gap-2"
                    >
                      <Check className="h-4 w-4" />
                      <span>Match Complete</span>
                    </motion.span>
                  ) : (
                    <motion.span
                      key="idle"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="flex items-center gap-2"
                    >
                      <Sparkles className="h-4 w-4" />
                      <span>Analyze & Match</span>
                    </motion.span>
                  )}
                </AnimatePresence>
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 6. Apply as Editable Look Button ── */}
        <AnimatePresence>
          {hasMatched && !isMatching && activeReference && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.35, type: 'spring', stiffness: 200, damping: 20 }}
              className="mt-3"
            >
              <Button
                onClick={handleApply}
                variant="outline"
                className="w-full h-10 text-xs font-medium border-amber-400/30 bg-amber-400/5 text-amber-200 hover:bg-amber-400/10 hover:border-amber-400/50 hover:text-amber-100"
              >
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Apply as Editable Look
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Empty state hint ── */}
        {!activeReference && referenceImages.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-4 flex items-center justify-center gap-2 text-white/20 text-[11px]"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span>Load a reference photo to begin AI matching</span>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
