'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ArrowLeftRight,
  ChevronDown,
  Crosshair,
  Droplets,
  Palette,
  SunDim,
  Feather,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAppStore } from '@/store/useAppStore';
import type { MaskData, MaskType } from '@/store/useAppStore';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────

interface MasksPanelProps {
  className?: string;
}

interface MaskTypeConfig {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accentColor: string;
  accentBg: string;
  accentText: string;
  description: string;
}

// ── Mask Type Configuration ────────────────────────────────────────────────

const MASK_TYPE_CONFIG: Record<MaskType, MaskTypeConfig> = {
  luminance: {
    label: 'Luminance Range',
    icon: SunDim,
    accentColor: 'border-l-amber-500',
    accentBg: 'bg-amber-500/[0.06]',
    accentText: 'text-amber-400',
    description: 'Mask by brightness range',
  },
  'color-range': {
    label: 'Color Range',
    icon: Palette,
    accentColor: 'border-l-violet-500',
    accentBg: 'bg-violet-500/[0.06]',
    accentText: 'text-violet-400',
    description: 'Mask by specific color',
  },
  'hue-range': {
    label: 'Hue Range',
    icon: Crosshair,
    accentColor: 'border-l-rose-500',
    accentBg: 'bg-rose-500/[0.06]',
    accentText: 'text-rose-400',
    description: 'Mask by hue angle range',
  },
  'saturation-range': {
    label: 'Saturation Range',
    icon: Droplets,
    accentColor: 'border-l-cyan-500',
    accentBg: 'bg-cyan-500/[0.06]',
    accentText: 'text-cyan-400',
    description: 'Mask by saturation range',
  },
};

const MASK_TYPES: MaskType[] = ['luminance', 'color-range', 'hue-range', 'saturation-range'];

// Default params for each mask type
function getDefaultParams(type: MaskType): Record<string, number> {
  switch (type) {
    case 'luminance':
      return { min: 0, max: 100, feather: 10 };
    case 'color-range':
      return { hue: 0, hueRange: 30, satRange: 50, tolerance: 25 };
    case 'hue-range':
      return { minHue: 0, maxHue: 60, softness: 15 };
    case 'saturation-range':
      return { minSat: 20, maxSat: 80, softness: 10 };
    default:
      return {};
  }
}

// ── Mask Preview Canvas ────────────────────────────────────────────────────

interface MaskPreviewProps {
  mask: MaskData;
  className?: string;
}

function MaskPreview({ mask, className }: MaskPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Draw checkerboard background for transparency indication
    const checkSize = 4;
    for (let y = 0; y < h; y += checkSize) {
      for (let x = 0; x < w; x += checkSize) {
        const isLight = ((x / checkSize) + (y / checkSize)) % 2 === 0;
        ctx.fillStyle = isLight ? '#27272a' : '#1c1c1f';
        ctx.fillRect(x, y, checkSize, checkSize);
      }
    }

    // Draw mask visualization
    const type = mask.type;

    if (type === 'luminance') {
      const min = mask.params.min ?? 0;
      const max = mask.params.max ?? 100;
      const feather = mask.params.feather ?? 0;
      const gradient = ctx.createLinearGradient(0, h, 0, 0);
      const lowEdge = Math.max(0, (min - feather) / 100);
      const lowMid = min / 100;
      const highMid = max / 100;
      const highEdge = Math.min(1, (max + feather) / 100);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(lowEdge, 'rgba(255,255,255,0)');
      gradient.addColorStop(lowMid, 'rgba(255,255,255,0.85)');
      gradient.addColorStop(highMid, 'rgba(255,255,255,0.85)');
      gradient.addColorStop(highEdge, 'rgba(255,255,255,0)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    } else if (type === 'hue-range') {
      const minHue = mask.params.minHue ?? 0;
      const maxHue = mask.params.maxHue ?? 60;
      const softness = mask.params.softness ?? 0;
      const imgData = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const hue = (x / w) * 360;
          let dist = 0;
          if (minHue <= maxHue) {
            if (hue >= minHue && hue <= maxHue) {
              dist = Math.min(hue - minHue, maxHue - hue);
            } else {
              dist = Math.min(
                Math.abs(hue - minHue),
                Math.abs(hue - maxHue),
                360 - Math.abs(hue - minHue),
                360 - Math.abs(hue - maxHue),
              );
            }
          } else {
            // Wrapping range
            if (hue >= minHue || hue <= maxHue) {
              dist = Math.min(
                hue >= minHue ? hue - minHue : 360 - minHue + hue,
                hue <= maxHue ? maxHue - hue : 360 - hue + maxHue,
              );
            } else {
              dist = Math.min(Math.abs(hue - minHue), Math.abs(hue - maxHue));
            }
          }
          const alpha = Math.max(0, 1 - dist / Math.max(1, softness));
          const idx = (y * w + x) * 4;
          imgData.data[idx] = 255;
          imgData.data[idx + 1] = 255;
          imgData.data[idx + 2] = 255;
          imgData.data[idx + 3] = Math.round(alpha * 200);
        }
      }
      ctx.putImageData(imgData, 0, 0);
    } else if (type === 'saturation-range') {
      const minSat = mask.params.minSat ?? 0;
      const maxSat = mask.params.maxSat ?? 100;
      const softness = mask.params.softness ?? 0;
      const gradient = ctx.createLinearGradient(0, 0, w, 0);
      const lowEdge = Math.max(0, (minSat - softness) / 100);
      const lowMid = minSat / 100;
      const highMid = maxSat / 100;
      const highEdge = Math.min(1, (maxSat + softness) / 100);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(lowEdge, 'rgba(255,255,255,0)');
      gradient.addColorStop(lowMid, 'rgba(255,255,255,0.85)');
      gradient.addColorStop(highMid, 'rgba(255,255,255,0.85)');
      gradient.addColorStop(highEdge, 'rgba(255,255,255,0)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    } else if (type === 'color-range') {
      const hue = mask.params.hue ?? 0;
      const sat = mask.params.satRange ?? 50;
      const center = ((hue / 360) * w);
      const radius = (sat / 100) * (w / 2);
      const gradient = ctx.createRadialGradient(center, h / 2, 0, center, h / 2, radius);
      gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
      gradient.addColorStop(0.7, 'rgba(255,255,255,0.5)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }

    // Invert overlay
    if (mask.invert) {
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }

    // Opacity overlay
    ctx.globalAlpha = 1 - mask.opacity / 100;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }, [mask]);

  return (
    <canvas
      ref={canvasRef}
      width={160}
      height={60}
      className={cn(
        'w-full h-[60px] rounded-md border border-zinc-800',
        'bg-zinc-900',
        className,
      )}
    />
  );
}

// ── Param Slider ───────────────────────────────────────────────────────────

interface ParamSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  disabled: boolean;
  onChange: (val: number) => void;
}

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  disabled,
  onChange,
}: ParamSliderProps) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-[10px] text-zinc-500 font-medium w-[72px] flex-shrink-0 truncate">
        {label}
      </span>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        disabled={disabled}
        className={cn(
          'flex-1 [&_[data-slot=slider-track]]:h-1',
          `[&_[data-slot=slider-range]]:bg-emerald-500`,
          '[&_[data-slot=slider-thumb]]:size-2.5',
          '[&_[data-slot=slider-thumb]]:border-emerald-400',
          '[&_[data-slot=slider-thumb]]:bg-zinc-900',
          '[&_[data-slot=slider-thumb]]:shadow-none',
          disabled && 'opacity-40',
        )}
      />
      <span
        className={cn(
          'text-[10px] tabular-nums w-[34px] text-right flex-shrink-0 select-none',
          disabled ? 'text-zinc-600' : 'text-zinc-400',
        )}
      >
        {step < 1 ? value.toFixed(1) : Math.round(value)}{suffix}
      </span>
    </div>
  );
}

// ── Mask Card ──────────────────────────────────────────────────────────────

interface MaskCardProps {
  mask: MaskData;
  onUpdate: (id: string, data: Partial<MaskData>) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
}

function MaskCard({ mask, onUpdate, onRemove, onToggle }: MaskCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const config = MASK_TYPE_CONFIG[mask.type];
  const TypeIcon = config.icon;

  const handleParamChange = useCallback(
    (paramKey: string, value: number) => {
      onUpdate(mask.id, {
        params: { ...mask.params, [paramKey]: value },
      });
    },
    [mask.id, mask.params, onUpdate],
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'group rounded-lg border-l-[3px] overflow-hidden',
        'bg-zinc-900/60',
        config.accentColor,
        !mask.enabled && 'opacity-50',
      )}
    >
      {/* ── Card Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        {/* Enable toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onToggle(mask.id)}
              className={cn(
                'flex-shrink-0 p-1 rounded transition-colors',
                mask.enabled
                  ? 'text-zinc-400 hover:text-zinc-200'
                  : 'text-zinc-700 hover:text-zinc-500',
              )}
              aria-label={mask.enabled ? 'Disable mask' : 'Enable mask'}
            >
              {mask.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
            {mask.enabled ? 'Disable' : 'Enable'}
          </TooltipContent>
        </Tooltip>

        {/* Type icon */}
        <div className={cn('flex-shrink-0', config.accentText)}>
          <TypeIcon size={14} />
        </div>

        {/* Name */}
        <span className="text-[11px] font-medium text-zinc-200 truncate flex-1 select-none">
          {mask.name}
        </span>

        {/* Type badge */}
        <span
          className={cn(
            'text-[9px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0',
            config.accentBg,
            config.accentText,
          )}
        >
          {config.label}
        </span>

        {/* Expand toggle */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            'flex-shrink-0 p-0.5 rounded transition-all duration-200',
            'text-zinc-600 hover:text-zinc-400',
            isExpanded && 'rotate-180',
          )}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          <ChevronDown size={13} />
        </button>

        {/* Delete */}
        <AnimatePresence>
          {isHovered && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.1 }}
              onClick={() => onRemove(mask.id)}
              className={cn(
                'flex-shrink-0 p-1 rounded transition-colors',
                'text-zinc-600 hover:text-red-400 hover:bg-red-500/10',
              )}
              aria-label="Delete mask"
            >
              <Trash2 size={12} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* ── Card Body (expandable) ───────────────────────────────── */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 space-y-3">
              {/* Mask preview */}
              <MaskPreview mask={mask} />

              {/* Feather & Opacity (common controls) */}
              <div className="flex flex-col gap-0.5">
                <ParamSlider
                  label="Feather"
                  value={mask.feather}
                  min={0}
                  max={100}
                  step={1}
                  suffix="%"
                  disabled={!mask.enabled}
                  onChange={(val) => onUpdate(mask.id, { feather: val })}
                />
                <ParamSlider
                  label="Opacity"
                  value={mask.opacity}
                  min={0}
                  max={100}
                  step={1}
                  suffix="%"
                  disabled={!mask.enabled}
                  onChange={(val) => onUpdate(mask.id, { opacity: val })}
                />
              </div>

              {/* Type-specific params */}
              {mask.type === 'luminance' && (
                <div className="flex flex-col gap-0.5 pt-1 border-t border-zinc-800/40">
                  <ParamSlider
                    label="Min Luminance"
                    value={mask.params.min ?? 0}
                    min={0}
                    max={100}
                    step={1}
                    disabled={!mask.enabled}
                    onChange={(val) => handleParamChange('min', val)}
                  />
                  <ParamSlider
                    label="Max Luminance"
                    value={mask.params.max ?? 100}
                    min={0}
                    max={100}
                    step={1}
                    disabled={!mask.enabled}
                    onChange={(val) => handleParamChange('max', val)}
                  />
                  <ParamSlider
                    label="Feather"
                    value={mask.params.feather ?? 10}
                    min={0}
                    max={50}
                    step={1}
                    disabled={!mask.enabled}
                    onChange={(val) => handleParamChange('feather', val)}
                  />
                </div>
              )}

              {mask.type === 'color-range' && (
                <div className="flex flex-col gap-0.5 pt-1 border-t border-zinc-800/40">
                  <ParamSlider
                    label="Target Hue"
                    value={mask.params.hue ?? 0}
                    min={0}
                    max={360}
                    step={1}
                    suffix="°"
                    disabled={!mask.enabled}
                    onChange={(val) => handleParamChange('hue', val)}
                  />
                  <ParamSlider
                    label="Hue Range"
                    value={mask.params.hueRange ?? 30}
                    min={0}
                    max={180}
                    step={1}
                    suffix="°"
                    disabled={!mask.enabled}
                    onChange={(val) => handleParamChange('hueRange', val)}
                  />
                  <ParamSlider
                    label="Sat Range"
                    value={mask.params.satRange ?? 50}
                    min={0}
                    max={100}
                    step={1}
                    disabled={!mask.enabled}
                    onChange={(val) => handleParamChange('satRange', val)}
                  />
                  <ParamSlider
                    label="Tolerance"
                    value={mask.params.tolerance ?? 25}
                    min={0}
                    max={100}
                    step={1}
                    disabled={!mask.enabled}
                    onChange={(val) => handleParamChange('tolerance', val)}
                  />
                </div>
              )}

              {mask.type === 'hue-range' && (
                <div className="flex flex-col gap-0.5 pt-1 border-t border-zinc-800/40">
                  <ParamSlider
                    label="Min Hue"
                    value={mask.params.minHue ?? 0}
                    min={0}
                    max={360}
                    step={1}
                    suffix="°"
                    disabled={!mask.enabled}
                    onChange={(val) => handleParamChange('minHue', val)}
                  />
                  <ParamSlider
                    label="Max Hue"
                    value={mask.params.maxHue ?? 60}
                    min={0}
                    max={360}
                    step={1}
                    suffix="°"
                    disabled={!mask.enabled}
                    onChange={(val) => handleParamChange('maxHue', val)}
                  />
                  <ParamSlider
                    label="Softness"
                    value={mask.params.softness ?? 15}
                    min={0}
                    max={60}
                    step={1}
                    disabled={!mask.enabled}
                    onChange={(val) => handleParamChange('softness', val)}
                  />
                </div>
              )}

              {mask.type === 'saturation-range' && (
                <div className="flex flex-col gap-0.5 pt-1 border-t border-zinc-800/40">
                  <ParamSlider
                    label="Min Sat"
                    value={mask.params.minSat ?? 20}
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    disabled={!mask.enabled}
                    onChange={(val) => handleParamChange('minSat', val)}
                  />
                  <ParamSlider
                    label="Max Sat"
                    value={mask.params.maxSat ?? 80}
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    disabled={!mask.enabled}
                    onChange={(val) => handleParamChange('maxSat', val)}
                  />
                  <ParamSlider
                    label="Softness"
                    value={mask.params.softness ?? 10}
                    min={0}
                    max={50}
                    step={1}
                    disabled={!mask.enabled}
                    onChange={(val) => handleParamChange('softness', val)}
                  />
                </div>
              )}

              {/* Invert toggle */}
              <div className="flex items-center justify-between pt-2 border-t border-zinc-800/40">
                <div className="flex items-center gap-1.5">
                  <ArrowLeftRight size={12} className="text-zinc-500" />
                  <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
                    Invert Mask
                  </span>
                </div>
                <Switch
                  checked={mask.invert}
                  onCheckedChange={(checked) => onUpdate(mask.id, { invert: checked })}
                  disabled={!mask.enabled}
                  className="data-[state=checked]:bg-emerald-600 data-[state=unchecked]:bg-zinc-800"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-12 px-4 gap-3"
    >
      <div className="relative">
        <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
          <Feather size={22} className="text-zinc-700" />
        </div>
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center"
        >
          <Plus size={10} className="text-zinc-500" />
        </motion.div>
      </div>
      <div className="text-center space-y-1.5">
        <p className="text-sm font-medium text-zinc-500">No masks yet</p>
        <p className="text-[11px] text-zinc-600 max-w-[180px] leading-relaxed">
          Add a mask to apply selective color adjustments to specific regions
        </p>
      </div>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function MasksPanel({ className }: MasksPanelProps) {
  const masks = useAppStore((s) => s.masks);
  const addMask = useAppStore((s) => s.addMask);
  const removeMask = useAppStore((s) => s.removeMask);
  const updateMask = useAppStore((s) => s.updateMask);
  const toggleMask = useAppStore((s) => s.toggleMask);

  const counterRef = useRef<Record<MaskType, number>>({
    luminance: 0,
    'color-range': 0,
    'hue-range': 0,
    'saturation-range': 0,
  });

  // Sync counters from existing masks
  useEffect(() => {
    const counters: Record<MaskType, number> = {
      luminance: 0,
      'color-range': 0,
      'hue-range': 0,
      'saturation-range': 0,
    };
    for (const mask of masks) {
      counters[mask.type]++;
    }
    counterRef.current = counters;
  }, [masks]);

  const handleAddMask = useCallback(
    (type: MaskType) => {
      counterRef.current[type]++;
      const count = counterRef.current[type];
      const typeConfig = MASK_TYPE_CONFIG[type];

      const newMask: MaskData = {
        id: `mask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: `${typeConfig.label} ${count}`,
        type,
        enabled: true,
        invert: false,
        feather: 10,
        opacity: 100,
        params: getDefaultParams(type),
      };

      addMask(newMask);
    },
    [addMask],
  );

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-zinc-950 text-zinc-100',
        className,
      )}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
            <h2 className="text-base font-semibold tracking-tight text-white">
              Masks
            </h2>
            {masks.length > 0 && (
              <span className="text-[10px] text-zinc-500 tabular-nums font-medium bg-zinc-800/60 px-1.5 py-0.5 rounded-full">
                {masks.length}
              </span>
            )}
          </div>

          {/* Add mask dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 gap-1.5 px-2.5 text-xs font-medium',
                      'bg-zinc-800/60 border border-zinc-700/60',
                      'hover:bg-zinc-700/60 hover:border-zinc-600/60',
                      'text-zinc-300 hover:text-white',
                      'transition-all duration-150',
                    )}
                  >
                    <Plus size={13} />
                    Add Mask
                    <ChevronDown size={11} className="text-zinc-500 ml-0.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
                Add a new mask
              </TooltipContent>
            </Tooltip>

            <DropdownMenuContent
              side="bottom"
              align="end"
              className="w-52 bg-zinc-900 border-zinc-800 shadow-xl shadow-black/40"
            >
              <DropdownMenuLabel className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold px-2 py-1.5">
                Mask Types
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-zinc-800" />

              {MASK_TYPES.map((type, index) => {
                const typeConfig = MASK_TYPE_CONFIG[type];
                const MenuIcon = typeConfig.icon;

                return (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => handleAddMask(type)}
                    className={cn(
                      'gap-2.5 px-2.5 py-2 rounded-md',
                      'text-zinc-300 hover:text-white',
                      'hover:bg-white/[0.06]',
                      'focus:bg-white/[0.06] focus:text-white',
                      'cursor-pointer transition-colors duration-100',
                      index === 0 && 'mt-0.5',
                    )}
                  >
                    <div className={cn('flex items-center justify-center w-5 h-5 rounded', typeConfig.accentBg)}>
                      <MenuIcon size={13} className={typeConfig.accentText} />
                    </div>
                    <div className="flex flex-col gap-0">
                      <span className="text-xs font-medium">{typeConfig.label}</span>
                      <span className="text-[9px] text-zinc-600 leading-tight">
                        {typeConfig.description}
                      </span>
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Mask List ──────────────────────────────────────────────── */}
      {masks.length > 0 ? (
        <ScrollArea className="flex-1 px-3 pb-4">
          <div className="flex flex-col gap-2">
            <AnimatePresence mode="popLayout">
              {masks.map((mask) => (
                <MaskCard
                  key={mask.id}
                  mask={mask}
                  onUpdate={updateMask}
                  onRemove={removeMask}
                  onToggle={toggleMask}
                />
              ))}
            </AnimatePresence>
          </div>
        </ScrollArea>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState />
        </div>
      )}

      {/* ── Footer hint ────────────────────────────────────────────── */}
      {masks.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2.5 border-t border-zinc-800/60">
          <p className="text-[10px] text-zinc-600 text-center">
            Masks restrict adjustments to selected regions &middot; Hover to delete
          </p>
        </div>
      )}
    </div>
  );
}
