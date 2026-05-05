'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart,
  Search,
  SlidersHorizontal,
  Star,
  X,
  Info,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAppStore } from '@/store/useAppStore';
import type { LUTItem } from '@/store/useAppStore';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────

interface LUTBrowserProps {
  className?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const FILTER_TAGS = [
  'All',
  'Warm',
  'Cool',
  'Cinematic',
  'Pastel',
  'Film',
  'Portrait',
  'Wedding',
  'Landscape',
  'B&W',
] as const;

type FilterTag = (typeof FILTER_TAGS)[number];

const TAG_LABEL_MAP: Record<string, string> = {
  'high-contrast': 'High Contrast',
};

function formatTag(tag: string): string {
  return TAG_LABEL_MAP[tag] ?? tag.charAt(0).toUpperCase() + tag.slice(1);
}

// ── Gradient Generator ─────────────────────────────────────────────────────

/**
 * Simple deterministic hash from a string. Returns 0‑1.
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = (hash << 5) - hash + ch;
    hash |= 0; // convert to 32‑bit int
  }
  return Math.abs(hash) / 0xffffffff;
}

/**
 * Build a unique CSS gradient based on LUT name, category, and tags.
 * Each LUT within the same category still looks distinct thanks to the
 * name‑based hash offset.
 */
function generateLUTGradient(lut: LUTItem): string {
  const h = hashString(lut.name);
  const h2 = hashString(lut.id + 'salt');

  switch (lut.category) {
    // ── Warm: oranges, golds, ambers ──────────────────────────────────
    case 'warm': {
      const baseHue = 25 + h * 30; // 25‑55
      const angle = 135 + h2 * 90;
      return `linear-gradient(${angle}deg,
        hsl(${baseHue}, 85%, 55%),
        hsl(${baseHue + 15}, 90%, 45%),
        hsl(${baseHue + 30}, 80%, 35%))`;
    }

    // ── Cool: blues, teals ────────────────────────────────────────────
    case 'cool': {
      const baseHue = 190 + h * 40; // 190‑230
      const angle = 160 + h2 * 60;
      return `linear-gradient(${angle}deg,
        hsl(${baseHue}, 75%, 45%),
        hsl(${baseHue + 15}, 70%, 55%),
        hsl(${baseHue - 10}, 80%, 30%))`;
    }

    // ── Cinematic: teal & orange split ────────────────────────────────
    case 'cinematic': {
      const tealHue = 180 + h * 20;
      const orangeHue = 20 + h2 * 20;
      const splitPos = 35 + h * 30; // 35‑65%
      return `linear-gradient(135deg,
        hsl(${tealHue}, 70%, 35%) 0%,
        hsl(${tealHue}, 60%, 45%) ${splitPos}%,
        hsl(${orangeHue}, 85%, 50%) ${splitPos + 5}%,
        hsl(${orangeHue + 10}, 90%, 40%) 100%)`;
    }

    // ── Pastel: soft muted ────────────────────────────────────────────
    case 'pastel': {
      const hue1 = h * 360;
      const hue2 = (hue1 + 60 + h2 * 60) % 360;
      return `linear-gradient(145deg,
        hsl(${hue1}, 45%, 75%),
        hsl(${(hue1 + hue2) / 2}, 40%, 80%),
        hsl(${hue2}, 50%, 72%))`;
    }

    // ── Film: desaturated with slight color cast ───────────────────────
    case 'film': {
      const baseHue = 30 + h * 40; // warm cast
      const angle = 180 + h2 * 45;
      return `linear-gradient(${angle}deg,
        hsl(${baseHue}, 20%, 55%),
        hsl(${baseHue + 10}, 15%, 45%),
        hsl(${baseHue - 5}, 25%, 35%))`;
    }

    // ── Portrait: warm pink / peach tones ─────────────────────────────
    case 'portrait': {
      const baseHue = 5 + h * 25; // 5‑30
      const angle = 140 + h2 * 80;
      return `linear-gradient(${angle}deg,
        hsl(${baseHue}, 60%, 70%),
        hsl(${baseHue + 10}, 55%, 62%),
        hsl(${baseHue + 20}, 50%, 55%))`;
    }

    // ── Wedding: soft whites, blush, champagne ────────────────────────
    case 'wedding': {
      const baseHue = 330 + h * 30;
      return `linear-gradient(150deg,
        hsl(${baseHue}, 30%, 85%),
        hsl(${(baseHue + 20) % 360}, 25%, 78%),
        hsl(40, 35%, 72%))`;
    }

    // ── Landscape: greens, earth tones ────────────────────────────────
    case 'landscape': {
      const baseHue = 80 + h * 60; // 80‑140
      const angle = 160 + h2 * 50;
      return `linear-gradient(${angle}deg,
        hsl(${baseHue}, 50%, 40%),
        hsl(${baseHue + 20}, 45%, 50%),
        hsl(${baseHue - 10}, 55%, 30%))`;
    }

    // ── B&W: grayscale ────────────────────────────────────────────────
    case 'bw': {
      const baseL = 20 + h * 40; // 20‑60
      return `linear-gradient(${145 + h2 * 40}deg,
        hsl(0, 0%, ${baseL + 30}%),
        hsl(0, 0%, ${baseL + 15}%),
        hsl(0, 0%, ${baseL}%))`;
    }

    // ── High‑contrast: vibrant saturated ──────────────────────────────
    case 'high-contrast': {
      const hue1 = h * 360;
      const hue2 = (hue1 + 180) % 360;
      return `linear-gradient(135deg,
        hsl(${hue1}, 90%, 50%),
        hsl(${hue2}, 85%, 40%),
        hsl(${hue1}, 80%, 25%))`;
    }

    // ── Fallback ──────────────────────────────────────────────────────
    default: {
      const hue = h * 360;
      return `linear-gradient(135deg,
        hsl(${hue}, 60%, 50%),
        hsl(${(hue + 60) % 360}, 55%, 45%))`;
    }
  }
}

// ── Category color accent (for border on active cards) ────────────────────

const CATEGORY_ACCENT: Record<string, string> = {
  warm: 'border-amber-500/70',
  cool: 'border-sky-500/70',
  cinematic: 'border-teal-500/70',
  pastel: 'border-pink-300/70',
  film: 'border-yellow-600/70',
  portrait: 'border-rose-400/70',
  wedding: 'border-rose-300/70',
  landscape: 'border-emerald-500/70',
  bw: 'border-neutral-400/70',
  'high-contrast': 'border-violet-500/70',
};

// ── LUT Card Component ─────────────────────────────────────────────────────

interface LUTCardProps {
  lut: LUTItem;
  isActive: boolean;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onApply: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onIntensityChange: (id: string, value: number) => void;
}

function LUTCard({
  lut,
  isActive,
  isSelected,
  onSelect,
  onApply,
  onToggleFavorite,
  onIntensityChange,
}: LUTCardProps) {
  const gradient = useMemo(() => generateLUTGradient(lut), [lut]);
  const [isHovered, setIsHovered] = useState(false);
  const [isSliderVisible, setIsSliderVisible] = useState(false);

  const accentBorder = CATEGORY_ACCENT[lut.category] ?? 'border-primary/70';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => {
        setIsHovered(true);
        setIsSliderVisible(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsSliderVisible(false);
      }}
      onClick={() => onSelect(lut.id)}
      onDoubleClick={() => onApply(lut.id)}
      className={cn(
        'group relative flex flex-col rounded-xl overflow-hidden cursor-pointer',
        'bg-zinc-900/80 border border-zinc-800/60',
        'transition-all duration-200',
        isActive && [
          'ring-2 ring-offset-2 ring-offset-zinc-950',
          accentBorder,
        ],
        !isActive && isHovered && 'border-zinc-700/80',
        isSelected && !isActive && 'ring-1 ring-zinc-600/50',
      )}
    >
      {/* Thumbnail */}
      <div
        className="relative w-full aspect-[4/3] flex-shrink-0"
        style={{ background: gradient }}
      >
        {/* Favorite button */}
        <motion.button
          whileTap={{ scale: 0.85 }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(lut.id);
          }}
          className={cn(
            'absolute top-2 right-2 z-10 p-1.5 rounded-full backdrop-blur-sm',
            'transition-colors duration-150',
            lut.favorite
              ? 'bg-rose-500/20 text-rose-400'
              : 'bg-black/20 text-white/50 hover:text-white/80',
          )}
          aria-label={lut.favorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart
            size={16}
            className={cn(
              'transition-transform duration-200',
              lut.favorite && 'fill-rose-400',
            )}
          />
        </motion.button>

        {/* Active indicator */}
        {isActive && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute top-2 left-2 z-10"
          >
            <div className="flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-semibold text-white uppercase tracking-wide backdrop-blur-sm">
              <Star size={10} className="fill-white" />
              Active
            </div>
          </motion.div>
        )}

        {/* Hover overlay with info */}
        <AnimatePresence>
          {isHovered && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 bg-black/30 backdrop-blur-[1px] flex items-center justify-center"
            >
              <span className="text-white/90 text-xs font-medium tracking-wide bg-black/40 px-3 py-1.5 rounded-full border border-white/10">
                Double‑click to apply
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Info section */}
      <div className="flex flex-col gap-2 p-3">
        {/* Name */}
        <div className="flex items-start justify-between gap-2">
          <h3
            className={cn(
              'text-sm font-semibold leading-tight truncate',
              isActive ? 'text-white' : 'text-zinc-200',
            )}
          >
            {lut.name}
          </h3>

          {/* Tooltip trigger */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="flex-shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
                aria-label="LUT info"
              >
                <Info size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="left"
              className="bg-zinc-900 border-zinc-700 text-zinc-200 text-xs max-w-[200px]"
            >
              <div className="flex flex-col gap-1">
                <span className="font-semibold text-white">{lut.name}</span>
                <span className="text-zinc-400 capitalize">{lut.category}</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {lut.tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0 h-4 bg-zinc-800 border-zinc-700 text-zinc-300"
                    >
                      {formatTag(tag)}
                    </Badge>
                  ))}
                </div>
                <span className="text-zinc-500 mt-1">
                  Created {lut.createdAt}
                </span>
                <span className="text-zinc-500">
                  Intensity: {lut.intensity}%
                </span>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1">
          {lut.tags.slice(0, 3).map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="text-[10px] px-1.5 py-0 h-4 bg-zinc-800/70 border-zinc-700/50 text-zinc-400 hover:text-zinc-300"
            >
              {formatTag(tag)}
            </Badge>
          ))}
          {lut.tags.length > 3 && (
            <span className="text-[10px] text-zinc-500 leading-4">
              +{lut.tags.length - 3}
            </span>
          )}
        </div>

        {/* Intensity Slider (visible on hover / active) */}
        <AnimatePresence>
          {(isSliderVisible || isActive) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 pt-1">
                <SlidersHorizontal size={12} className="text-zinc-500 flex-shrink-0" />
                <Slider
                  value={[lut.intensity]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(val) => onIntensityChange(lut.id, val[0])}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-range]]:bg-zinc-400 [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-zinc-300 [&_[data-slot=slider-thumb]]:bg-zinc-100 [&_[data-slot=slider-thumb]]:shadow-none"
                />
                <span className="text-[10px] text-zinc-500 tabular-nums w-7 text-right flex-shrink-0">
                  {lut.intensity}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Main LUTBrowser Component ──────────────────────────────────────────────

export default function LUTBrowser({ className }: LUTBrowserProps) {
  // Store state
  const lutItems = useAppStore((s) => s.lutItems);
  const setLUTItems = useAppStore((s) => s.setLUTItems);
  const activeLutId = useAppStore((s) => s.activeLutId);
  const setActiveLutId = useAppStore((s) => s.setActiveLutId);
  const lutIntensity = useAppStore((s) => s.lutIntensity);
  const setLutIntensity = useAppStore((s) => s.setLutIntensity);
  const lutFilterTags = useAppStore((s) => s.lutFilterTags);
  const setLutFilterTags = useAppStore((s) => s.setLutFilterTags);

  // Local UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedLutId, setSelectedLutId] = useState<string | null>(null);

  // ── Filtering logic ─────────────────────────────────────────────────

  const normalizedFilter = useMemo(
    () => lutFilterTags.map((t) => t.toLowerCase()),
    [lutFilterTags],
  );

  const filteredLUTs = useMemo(() => {
    let items = lutItems;

    // Filter by tags
    if (normalizedFilter.length > 0) {
      items = items.filter((lut) =>
        normalizedFilter.some(
          (tag) =>
            lut.category === tag ||
            lut.tags.some((t) => t.toLowerCase() === tag),
        ),
      );
    }

    // Filter by favorites
    if (favoritesOnly) {
      items = items.filter((lut) => lut.favorite);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter((lut) => lut.name.toLowerCase().includes(q));
    }

    return items;
  }, [lutItems, normalizedFilter, favoritesOnly, searchQuery]);

  // ── Handlers ────────────────────────────────────────────────────────

  const handleTagClick = useCallback(
    (tag: FilterTag) => {
      if (tag === 'All') {
        setLutFilterTags([]);
      } else {
        const tagLower = tag.toLowerCase();
        setLutFilterTags(
          normalizedFilter.includes(tagLower)
            ? normalizedFilter.filter((t) => t !== tagLower)
            : [...normalizedFilter, tagLower],
        );
      }
    },
    [normalizedFilter, setLutFilterTags],
  );

  const handleSelectLut = useCallback(
    (id: string) => {
      setSelectedLutId((prev) => (prev === id ? null : id));
    },
    [],
  );

  const handleApplyLut = useCallback(
    (id: string) => {
      setActiveLutId(id);
      const lut = lutItems.find((l) => l.id === id);
      if (lut) {
        setLutIntensity(lut.intensity);
      }
    },
    [lutItems, setActiveLutId, setLutIntensity],
  );

  const handleToggleFavorite = useCallback(
    (id: string) => {
      setLUTItems(
        lutItems.map((lut) =>
          lut.id === id ? { ...lut, favorite: !lut.favorite } : lut,
        ),
      );
    },
    [lutItems, setLUTItems],
  );

  const handleIntensityChange = useCallback(
    (id: string, value: number) => {
      setLUTItems(
        lutItems.map((lut) =>
          lut.id === id ? { ...lut, intensity: value } : lut,
        ),
      );
      // If this is the active LUT, also update global intensity
      if (id === activeLutId) {
        setLutIntensity(value);
      }
    },
    [lutItems, setLUTItems, activeLutId, setLutIntensity],
  );

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-zinc-950 text-zinc-100',
        className,
      )}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 space-y-3">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight text-white">
            LUT Browser
          </h2>
          <span className="text-xs text-zinc-500 tabular-nums">
            {filteredLUTs.length} of {lutItems.length}
          </span>
        </div>

        {/* Search & favorites toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
            />
            <Input
              placeholder="Search LUTs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-8 text-xs bg-zinc-900/60 border-zinc-800 text-zinc-200 placeholder:text-zinc-600 focus-visible:border-zinc-600 focus-visible:ring-zinc-700/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Heart
              size={13}
              className={cn(
                'transition-colors',
                favoritesOnly ? 'text-rose-400' : 'text-zinc-500',
              )}
            />
            <Switch
              checked={favoritesOnly}
              onCheckedChange={setFavoritesOnly}
              className="data-[state=checked]:bg-rose-500/80 data-[state=unchecked]:bg-zinc-800"
            />
          </div>
        </div>

        {/* Tag filter buttons */}
        <div className="flex flex-wrap gap-1.5">
          {FILTER_TAGS.map((tag) => {
            const isActive =
              tag === 'All'
                ? normalizedFilter.length === 0
                : normalizedFilter.includes(tag.toLowerCase());

            return (
              <Button
                key={tag}
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleTagClick(tag)}
                className={cn(
                  'h-6 px-2.5 text-[11px] font-medium rounded-full transition-all',
                  isActive
                    ? 'bg-zinc-200 text-zinc-950 hover:bg-zinc-300 shadow-none border-0'
                    : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/50',
                )}
              >
                {tag}
              </Button>
            );
          })}
        </div>
      </div>

      {/* ── Grid ────────────────────────────────────────────────────── */}
      <ScrollArea className="flex-1 px-4 pb-4">
        {filteredLUTs.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pb-2">
            <AnimatePresence mode="popLayout">
              {filteredLUTs.map((lut) => (
                <LUTCard
                  key={lut.id}
                  lut={lut}
                  isActive={lut.id === activeLutId}
                  isSelected={lut.id === selectedLutId}
                  onSelect={handleSelectLut}
                  onApply={handleApplyLut}
                  onToggleFavorite={handleToggleFavorite}
                  onIntensityChange={handleIntensityChange}
                />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-600"
          >
            <Search size={32} className="text-zinc-700" />
            <p className="text-sm font-medium">No LUTs found</p>
            <p className="text-xs text-zinc-600 max-w-[200px] text-center">
              Try adjusting your search or filter criteria
            </p>
            {(searchQuery || normalizedFilter.length > 0 || favoritesOnly) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setLutFilterTags([]);
                  setFavoritesOnly(false);
                }}
                className="mt-1 text-xs text-zinc-500 hover:text-zinc-300"
              >
                Clear all filters
              </Button>
            )}
          </motion.div>
        )}
      </ScrollArea>
    </div>
  );
}
