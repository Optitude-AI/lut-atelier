'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye,
  EyeOff,
  GripVertical,
  Plus,
  Trash2,
  Sparkles,
  Grid3x3,
  Grid2x2,
  TrendingUp,
  Palette,
  Droplets,
  SlidersHorizontal,
  Layers,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
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
import type { AdjustmentLayer } from '@/store/useAppStore';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────

interface AdjustmentStackProps {
  className?: string;
}

type AdjustmentType = AdjustmentLayer['type'];

// ── Layer Type Configuration ───────────────────────────────────────────────

interface LayerTypeConfig {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accentColor: string;        // Tailwind class for left border
  accentBg: string;           // Tailwind class for subtle bg tint
  accentText: string;         // Tailwind class for icon color
  dropdownIcon: React.ComponentType<{ size?: number; className?: string }>;
}

const LAYER_TYPE_CONFIG: Record<AdjustmentType, LayerTypeConfig> = {
  'ai-match': {
    label: 'AI Color Match',
    icon: Sparkles,
    accentColor: 'border-l-amber-500',
    accentBg: 'bg-amber-500/[0.06]',
    accentText: 'text-amber-400',
    dropdownIcon: Sparkles,
  },
  'grid-ab': {
    label: 'A/B Hue Grid',
    icon: Grid3x3,
    accentColor: 'border-l-orange-500',
    accentBg: 'bg-orange-500/[0.06]',
    accentText: 'text-orange-400',
    dropdownIcon: Grid3x3,
  },
  'grid-cl': {
    label: 'C/L Chroma-Luminance Grid',
    icon: Grid2x2,
    accentColor: 'border-l-emerald-500',
    accentBg: 'bg-emerald-500/[0.06]',
    accentText: 'text-emerald-400',
    dropdownIcon: Grid2x2,
  },
  'curves': {
    label: 'Curves',
    icon: TrendingUp,
    accentColor: 'border-l-cyan-500',
    accentBg: 'bg-cyan-500/[0.06]',
    accentText: 'text-cyan-400',
    dropdownIcon: TrendingUp,
  },
  'selective-color': {
    label: 'Selective Color',
    icon: Palette,
    accentColor: 'border-l-violet-500',
    accentBg: 'bg-violet-500/[0.06]',
    accentText: 'text-violet-400',
    dropdownIcon: Palette,
  },
  'hue-sat': {
    label: 'Hue/Saturation',
    icon: Droplets,
    accentColor: 'border-l-rose-500',
    accentBg: 'bg-rose-500/[0.06]',
    accentText: 'text-rose-400',
    dropdownIcon: Droplets,
  },
  'levels': {
    label: 'Levels',
    icon: SlidersHorizontal,
    accentColor: 'border-l-sky-500',
    accentBg: 'bg-sky-500/[0.06]',
    accentText: 'text-sky-400',
    dropdownIcon: SlidersHorizontal,
  },
};

// Dropdown menu items (ordered)
const ADDABLE_TYPES: AdjustmentType[] = [
  'ai-match',
  'grid-ab',
  'grid-cl',
  'curves',
  'selective-color',
  'hue-sat',
  'levels',
];

// ── Inline Edit Name ───────────────────────────────────────────────────────

interface EditableNameProps {
  name: string;
  onRename: (newName: string) => void;
  isDisabled: boolean;
}

function EditableName({ name, onRename, isDisabled }: EditableNameProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) {
      onRename(trimmed);
    } else {
      setEditValue(name);
    }
    setIsEditing(false);
  }, [editValue, name, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        setEditValue(name);
        setIsEditing(false);
      }
    },
    [commitRename, name],
  );

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={commitRename}
        onKeyDown={handleKeyDown}
        className={cn(
          'w-full h-5 px-1 text-xs font-medium rounded',
          'bg-zinc-800 border border-zinc-600 text-white',
          'outline-none focus:border-zinc-400',
          'transition-colors',
        )}
        aria-label="Rename layer"
      />
    );
  }

  return (
    <span
      onDoubleClick={() => {
        if (!isDisabled) {
          setEditValue(name);
          setIsEditing(true);
        }
      }}
      className={cn(
        'text-xs font-medium truncate cursor-default select-none',
        'transition-colors',
        isDisabled ? 'text-zinc-600' : 'text-zinc-200 hover:text-white',
        !isDisabled && 'cursor-text',
      )}
      title={isDisabled ? undefined : 'Double-click to rename'}
    >
      {name}
    </span>
  );
}

// ── Adjustment Layer Row ───────────────────────────────────────────────────

interface AdjustmentLayerRowProps {
  layer: AdjustmentLayer;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onRemove: (id: string) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onRename: (id: string, name: string) => void;
}

function AdjustmentLayerRow({
  layer,
  isSelected,
  onSelect,
  onToggleVisibility,
  onRemove,
  onOpacityChange,
  onRename,
}: AdjustmentLayerRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const config = LAYER_TYPE_CONFIG[layer.type];
  const TypeIcon = config.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -12, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 12, scale: 0.95, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onSelect(layer.id)}
      className={cn(
        'group relative flex items-stretch rounded-lg border-l-[3px] cursor-pointer',
        'transition-all duration-150',
        config.accentColor,
        isSelected
          ? cn(config.accentBg, 'bg-opacity-100 ring-1 ring-white/[0.08]')
          : 'hover:bg-white/[0.03]',
        !layer.enabled && 'opacity-50',
      )}
    >
      {/* Main content row */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 flex-1 min-w-0">
        {/* Drag handle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'flex-shrink-0 p-0.5 rounded transition-colors',
                'text-zinc-600 hover:text-zinc-400',
                !layer.enabled && 'pointer-events-none',
              )}
              aria-label="Drag to reorder"
            >
              <GripVertical size={12} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
            Drag to reorder
          </TooltipContent>
        </Tooltip>

        {/* Visibility toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisibility(layer.id);
              }}
              className={cn(
                'flex-shrink-0 p-1 rounded transition-colors',
                layer.enabled
                  ? 'text-zinc-400 hover:text-zinc-200'
                  : 'text-zinc-700 hover:text-zinc-500',
              )}
              aria-label={layer.enabled ? 'Hide layer' : 'Show layer'}
            >
              {layer.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
            {layer.enabled ? 'Hide' : 'Show'}
          </TooltipContent>
        </Tooltip>

        {/* Type icon */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn('flex-shrink-0 p-1 rounded', config.accentText)}>
              <TypeIcon size={13} />
            </div>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
            {config.label}
          </TooltipContent>
        </Tooltip>

        {/* Layer name */}
        <div className="flex-1 min-w-0 px-1">
          <EditableName
            name={layer.name}
            onRename={(newName) => onRename(layer.id, newName)}
            isDisabled={!layer.enabled}
          />
        </div>

        {/* Opacity slider (always visible) */}
        <div className="flex items-center gap-1.5 flex-shrink-0 w-[100px]">
          <Slider
            value={[layer.opacity]}
            min={0}
            max={100}
            step={1}
            onValueChange={(val) => onOpacityChange(layer.id, val[0])}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              '[&_[data-slot=slider-track]]:h-1',
              '[&_[data-slot=slider-range]]:bg-zinc-400',
              '[&_[data-slot=slider-thumb]]:size-2.5',
              '[&_[data-slot=slider-thumb]]:border-zinc-300',
              '[&_[data-slot=slider-thumb]]:bg-zinc-100',
              '[&_[data-slot=slider-thumb]]:shadow-none',
              '[&_[data-slot=slider-thumb]]:hover:border-white',
            )}
          />
          <span className="text-[10px] text-zinc-500 tabular-nums w-6 text-right flex-shrink-0 select-none">
            {layer.opacity}
          </span>
        </div>

        {/* Delete button (visible on hover) */}
        <AnimatePresence>
          {isHovered && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.1 }}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(layer.id);
              }}
              className={cn(
                'flex-shrink-0 p-1 rounded transition-colors',
                'text-zinc-600 hover:text-red-400 hover:bg-red-500/10',
              )}
              aria-label="Delete layer"
            >
              <Trash2 size={12} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Selected indicator line */}
      {isSelected && (
        <motion.div
          layoutId="selected-layer-line"
          className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-white/20 via-white/10 to-transparent"
        />
      )}
    </motion.div>
  );
}

// ── Add Layer Menu ─────────────────────────────────────────────────────────

function AddLayerMenu({ onAdd }: { onAdd: (type: AdjustmentType) => void }) {
  return (
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
              Add Layer
              <ChevronDown size={11} className="text-zinc-500 ml-0.5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
          Add a new adjustment layer
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        side="bottom"
        align="end"
        className="w-52 bg-zinc-900 border-zinc-800 shadow-xl shadow-black/40"
      >
        <DropdownMenuLabel className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold px-2 py-1.5">
          Adjustment Types
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-zinc-800" />

        {ADDABLE_TYPES.map((type, index) => {
          const config = LAYER_TYPE_CONFIG[type];
          const MenuIcon = config.dropdownIcon;

          return (
            <DropdownMenuItem
              key={type}
              onClick={() => onAdd(type)}
              className={cn(
                'gap-2.5 px-2.5 py-2 rounded-md',
                'text-zinc-300 hover:text-white',
                'hover:bg-white/[0.06]',
                'focus:bg-white/[0.06] focus:text-white',
                'cursor-pointer transition-colors duration-100',
                index === 1 && 'mt-0.5',
              )}
            >
              <div className={cn('flex items-center justify-center w-5 h-5 rounded', config.accentBg)}>
                <MenuIcon size={13} className={config.accentText} />
              </div>
              <span className="text-xs font-medium">{config.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
          <Layers size={22} className="text-zinc-700" />
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
        <p className="text-sm font-medium text-zinc-500">No adjustments yet</p>
        <p className="text-[11px] text-zinc-600 max-w-[180px] leading-relaxed">
          Click &quot;Add Layer&quot; to start building your non-destructive editing stack
        </p>
      </div>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function AdjustmentStack({ className }: AdjustmentStackProps) {
  // Store state
  const adjustmentStack = useAppStore((s) => s.adjustmentStack);
  const addAdjustment = useAppStore((s) => s.addAdjustment);
  const removeAdjustment = useAppStore((s) => s.removeAdjustment);
  const toggleAdjustment = useAppStore((s) => s.toggleAdjustment);
  const updateAdjustmentOpacity = useAppStore((s) => s.updateAdjustmentOpacity);
  const updateAdjustmentName = useAppStore((s) => s.updateAdjustmentName);

  // Local UI state
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  // Counter for auto-naming layers
  const countersRef = useRef<Record<AdjustmentType, number>>({
    'ai-match': 0,
    'grid-ab': 0,
    'grid-cl': 0,
    'curves': 0,
    'selective-color': 0,
    'hue-sat': 0,
    'levels': 0,
  });

  // Sync counters from existing stack on mount
  useEffect(() => {
    const counters: Record<AdjustmentType, number> = {
      'ai-match': 0,
      'grid-ab': 0,
      'grid-cl': 0,
      'curves': 0,
      'selective-color': 0,
      'hue-sat': 0,
      'levels': 0,
    };
    for (const layer of adjustmentStack) {
      counters[layer.type]++;
    }
    countersRef.current = counters;
  }, [adjustmentStack]);

  // ── Handlers ────────────────────────────────────────────────────────

  const handleAddLayer = useCallback(
    (type: AdjustmentType) => {
      countersRef.current[type]++;
      const count = countersRef.current[type];
      const config = LAYER_TYPE_CONFIG[type];
      const name = `${config.label} ${count}`;

      const newLayer: AdjustmentLayer = {
        id: `adj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        type,
        enabled: true,
        opacity: 100,
        params: {},
      };

      addAdjustment(newLayer);
      setSelectedLayerId(newLayer.id);
    },
    [addAdjustment],
  );

  const handleRemoveLayer = useCallback(
    (id: string) => {
      removeAdjustment(id);
      if (selectedLayerId === id) {
        setSelectedLayerId(null);
      }
    },
    [removeAdjustment, selectedLayerId],
  );

  const handleRenameLayer = useCallback(
    (id: string, name: string) => {
      updateAdjustmentName(id, name);
    },
    [updateAdjustmentName],
  );

  const handleSelectLayer = useCallback((id: string) => {
    setSelectedLayerId((prev) => (prev === id ? null : id));
  }, []);

  // ── Render ──────────────────────────────────────────────────────────

  // Display layers top-to-bottom (reverse the stack order so newest is on top)
  const displayLayers = [...adjustmentStack].reverse();

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
              Adjustments
            </h2>
            {adjustmentStack.length > 0 && (
              <span className="text-[10px] text-zinc-500 tabular-nums font-medium bg-zinc-800/60 px-1.5 py-0.5 rounded-full">
                {adjustmentStack.length}
              </span>
            )}
          </div>

          <AddLayerMenu onAdd={handleAddLayer} />
        </div>
      </div>

      {/* ── Layer List ─────────────────────────────────────────────── */}
      {adjustmentStack.length > 0 ? (
        <ScrollArea className="flex-1 px-3 pb-4">
          <div className="flex flex-col gap-1">
            <AnimatePresence mode="popLayout">
              {displayLayers.map((layer) => (
                <AdjustmentLayerRow
                  key={layer.id}
                  layer={layer}
                  isSelected={layer.id === selectedLayerId}
                  onSelect={handleSelectLayer}
                  onToggleVisibility={toggleAdjustment}
                  onRemove={handleRemoveLayer}
                  onOpacityChange={updateAdjustmentOpacity}
                  onRename={handleRenameLayer}
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
      {adjustmentStack.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2.5 border-t border-zinc-800/60">
          <p className="text-[10px] text-zinc-600 text-center">
            Layers are applied bottom → top &middot; Double-click name to rename
          </p>
        </div>
      )}
    </div>
  );
}
