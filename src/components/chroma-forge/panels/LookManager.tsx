'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Star,
  Search,
  X,
  Plus,
  Download,
  Upload,
  Trash2,
  Copy,
  FolderOpen,
  Bookmark,
  MoreHorizontal,
  Save,
  Layers,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAppStore } from '@/store/useAppStore';
import type {
  SavedLook,
  LookData,
  CurveData,
  CurvePoint,
} from '@/store/useAppStore';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────

interface LookManagerProps {
  className?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  'All',
  'Custom',
  'Film',
  'Portrait',
  'Landscape',
  'Street',
  'Editorial',
] as const;

type CategoryFilter = (typeof CATEGORIES)[number];

const CATEGORY_ICONS: Record<string, string> = {
  Custom: '🎨',
  Film: '🎬',
  Portrait: '📷',
  Landscape: '🏔️',
  Street: '🏙️',
  Editorial: '📰',
};

const CATEGORY_COLORS: Record<string, string> = {
  Custom: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  Film: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Portrait: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  Landscape: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Street: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  Editorial: 'bg-zinc-400/15 text-zinc-300 border-zinc-400/30',
};

// ── Gradient Generator ─────────────────────────────────────────────────────

/**
 * Derive a representative CSS gradient from a SavedLook's curve data.
 * Analyzes the R, G, B curve points to determine color tone shifts and
 * generates a unique gradient that visually represents the grade.
 */
function generateLookGradient(look: SavedLook): string {
  const { curves, globalIntensity } = look.data;

  // Find R, G, B curve data
  const redCurve = curves.find((c) => c.channel === 'r');
  const greenCurve = curves.find((c) => c.channel === 'g');
  const blueCurve = curves.find((c) => c.channel === 'b');
  const masterCurve = curves.find((c) => c.channel === 'master');

  // Calculate midpoint shift for each channel (0-255 normal)
  const mid = 128;
  const getMidShift = (curve: CurveData | undefined): number => {
    if (!curve || curve.points.length < 2) return 0;
    // Interpolate curve at midpoint
    const sorted = [...curve.points].sort((a, b) => a.x - b.x);
    let low = sorted[0];
    let high = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].x <= mid && sorted[i + 1].x >= mid) {
        low = sorted[i];
        high = sorted[i + 1];
        break;
      }
    }
    if (high.x === low.x) return 0;
    const t = (mid - low.x) / (high.x - low.x);
    return low.y + t * (high.y - low.y) - mid;
  };

  // Also get endpoint shifts (shadows and highlights)
  const getEndpointShift = (
    curve: CurveData | undefined,
    position: 'start' | 'end',
  ): number => {
    if (!curve || curve.points.length < 2) return 0;
    const sorted = [...curve.points].sort((a, b) => a.x - b.x);
    if (position === 'start') return sorted[0].y - sorted[0].x;
    return sorted[sorted.length - 1].y - sorted[sorted.length - 1].x;
  };

  const rShift = getMidShift(redCurve);
  const gShift = getMidShift(greenCurve);
  const bShift = getMidShift(blueCurve);

  // Shadow/highlight color shifts
  const rShadowShift = getEndpointShift(redCurve, 'start');
  const gShadowShift = getEndpointShift(greenCurve, 'start');
  const bShadowShift = getEndpointShift(blueCurve, 'start');
  const rHighShift = getEndpointShift(redCurve, 'end');
  const gHighShift = getEndpointShift(greenCurve, 'end');
  const bHighShift = getEndpointShift(blueCurve, 'end');

  // Master curve contrast
  const masterMidShift = getMidShift(masterCurve);
  const contrastFactor = 1 + Math.abs(masterMidShift) / 255;

  // Apply intensity
  const intensity = globalIntensity / 100;

  // Convert channel shifts to RGB percentages (0-100)
  const applyShift = (base: number, shift: number) => {
    const val = Math.round(
      Math.min(100, Math.max(0, base + (shift / 128) * 50 * intensity)),
    );
    return val;
  };

  // Shadow color (dark region)
  const shadowR = applyShift(15 + rShadowShift * 0.2, rShift * 0.6);
  const shadowG = applyShift(12 + gShadowShift * 0.2, gShift * 0.6);
  const shadowB = applyShift(18 + bShadowShift * 0.2, bShift * 0.6);

  // Midtone color
  const midR = applyShift(45, rShift);
  const midG = applyShift(42, gShift);
  const midB = applyShift(50, bShift);

  // Highlight color (bright region)
  const highR = applyShift(
    85 + rHighShift * 0.15,
    rShift * 0.4,
  );
  const highG = applyShift(
    82 + gHighShift * 0.15,
    gShift * 0.4,
  );
  const highB = applyShift(
    88 + bHighShift * 0.15,
    bShift * 0.4,
  );

  // Apply contrast factor to shadows and highlights
  const darkenShadow = (v: number) =>
    Math.round(Math.min(100, v / contrastFactor));
  const brightenHigh = (v: number) =>
    Math.round(Math.min(100, v * contrastFactor));

  return `linear-gradient(145deg,
    rgb(${darkenShadow(shadowR)}, ${darkenShadow(shadowG)}, ${darkenShadow(shadowB)}),
    rgb(${midR}, ${midG}, ${midB}) 50%,
    rgb(${brightenHigh(highR)}, ${brightenHigh(highG)}, ${brightenHigh(highB)}))`;
}

/**
 * Fallback gradient when look has no curves.
 */
function generateDefaultGradient(category: string): string {
  const gradients: Record<string, string> = {
    Custom: 'linear-gradient(145deg, #1a1a2e, #312e81, #1e1b4b)',
    Film: 'linear-gradient(145deg, #1c1410, #78350f, #1c1410)',
    Portrait: 'linear-gradient(145deg, #1c1017, #be123c, #fda4af)',
    Landscape: 'linear-gradient(145deg, #0c1a0c, #166534, #14532d)',
    Street: 'linear-gradient(145deg, #0c1421, #0369a1, #0c1929)',
    Editorial: 'linear-gradient(145deg, #18181b, #52525b, #27272a)',
  };
  return gradients[category] ?? gradients.Custom;
}

// ── Utility ────────────────────────────────────────────────────────────────

function generateId(): string {
  return `look-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Look Card Component ────────────────────────────────────────────────────

interface LookCardProps {
  look: SavedLook;
  onLoad: (look: SavedLook) => void;
  onDelete: (id: string) => void;
  onDuplicate: (look: SavedLook) => void;
  onToggleFavorite: (id: string) => void;
}

function LookCard({
  look,
  onLoad,
  onDelete,
  onDuplicate,
  onToggleFavorite,
}: LookCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const gradient = useMemo(() => {
    if (
      look.data?.curves &&
      look.data.curves.length > 0 &&
      look.data.curves.some((c) => c.points.length >= 2)
    ) {
      return generateLookGradient(look);
    }
    return generateDefaultGradient(look.category);
  }, [look]);

  const categoryStyle =
    CATEGORY_COLORS[look.category] ?? CATEGORY_COLORS.Custom;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'group relative flex flex-col rounded-xl overflow-hidden',
        'bg-zinc-900/80 border border-zinc-800/60',
        'transition-all duration-200',
        isHovered && 'border-zinc-700/80',
      )}
    >
      {/* Thumbnail */}
      <div
        className="relative w-full aspect-[3/2] flex-shrink-0 cursor-pointer"
        style={{ background: gradient }}
        onClick={() => onLoad(look)}
      >
        {/* Favorite button */}
        <motion.button
          whileTap={{ scale: 0.85 }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(look.id);
          }}
          className={cn(
            'absolute top-2 left-2 z-10 p-1.5 rounded-full backdrop-blur-sm',
            'transition-colors duration-150',
            look.favorite
              ? 'bg-amber-500/20 text-amber-400'
              : 'bg-black/20 text-white/50 hover:text-white/80',
          )}
          aria-label={look.favorite ? 'Unstar look' : 'Star look'}
        >
          <Star
            size={14}
            className={cn(
              'transition-transform duration-200',
              look.favorite && 'fill-amber-400',
            )}
          />
        </motion.button>

        {/* Actions dropdown */}
        <div className="absolute top-2 right-2 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <motion.button
                whileTap={{ scale: 0.85 }}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'p-1.5 rounded-full backdrop-blur-sm transition-all duration-150',
                  isHovered
                    ? 'bg-black/30 text-white/90'
                    : 'bg-black/0 text-white/0',
                )}
                aria-label="Look actions"
              >
                <MoreHorizontal size={14} />
              </motion.button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="bg-zinc-900 border-zinc-800 text-zinc-200 min-w-[160px]"
            >
              <DropdownMenuItem
                onClick={() => onLoad(look)}
                className="text-zinc-300 focus:bg-zinc-800 focus:text-white cursor-pointer"
              >
                <Layers size={14} className="mr-2" />
                Apply Look
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDuplicate(look)}
                className="text-zinc-300 focus:bg-zinc-800 focus:text-white cursor-pointer"
              >
                <Copy size={14} className="mr-2" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-zinc-800" />
              <DropdownMenuItem
                onClick={() => onDelete(look.id)}
                className="text-red-400 focus:bg-red-950/50 focus:text-red-300 cursor-pointer"
              >
                <Trash2 size={14} className="mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Hover overlay */}
        <AnimatePresence>
          {isHovered && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 bg-black/25 backdrop-blur-[1px] flex items-center justify-center"
            >
              <span className="text-white/90 text-xs font-medium tracking-wide bg-black/40 px-3 py-1.5 rounded-full border border-white/10">
                Click to apply
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Info section */}
      <div className="flex flex-col gap-1.5 p-3">
        {/* Name + category */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-tight truncate text-zinc-100">
            {look.name}
          </h3>
          <Badge
            variant="outline"
            className={cn(
              'flex-shrink-0 text-[10px] px-1.5 py-0 h-4 font-medium border',
              categoryStyle,
            )}
          >
            {CATEGORY_ICONS[look.category] ?? '🎨'} {look.category}
          </Badge>
        </div>

        {/* Description */}
        {look.description && (
          <p className="text-[11px] text-zinc-500 leading-relaxed line-clamp-2">
            {look.description}
          </p>
        )}

        {/* Date */}
        <p className="text-[10px] text-zinc-600 tabular-nums">
          {formatDate(look.createdAt)}
        </p>
      </div>
    </motion.div>
  );
}

// ── Main LookManager Component ─────────────────────────────────────────────

export default function LookManager({ className }: LookManagerProps) {
  // Store state
  const savedLooks = useAppStore((s) => s.savedLooks);
  const addSavedLook = useAppStore((s) => s.addSavedLook);
  const removeSavedLook = useAppStore((s) => s.removeSavedLook);
  const toggleLookFavorite = useAppStore((s) => s.toggleLookFavorite);

  // Current editing state (to capture when saving)
  const curveData = useAppStore((s) => s.curveData);
  const channelData = useAppStore((s) => s.channelData);
  const abNodes = useAppStore((s) => s.abNodes);
  const clNodes = useAppStore((s) => s.clNodes);
  const masks = useAppStore((s) => s.masks);
  const globalIntensity = useAppStore((s) => s.globalIntensity);
  const settings = useAppStore((s) => s.settings);

  // Store setters (to restore state when loading)
  const setCurveData = useAppStore((s) => s.setCurveData);
  const updateChannel = useAppStore((s) => s.updateChannel);
  const setABNodes = useAppStore((s) => s.setABNodes);
  const setCLNodes = useAppStore((s) => s.setCLNodes);
  const setGlobalIntensity = useAppStore((s) => s.setGlobalIntensity);
  const setSavedLooks = useAppStore((s) => s.setSavedLooks);
  const updateSettings = useAppStore((s) => s.updateSettings);

  // Local UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SavedLook | null>(null);

  // Save dialog form state
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saveCategory, setSaveCategory] = useState('Custom');

  // Import file ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Filtering logic ─────────────────────────────────────────────────

  const filteredLooks = useMemo(() => {
    let items = savedLooks;

    // Filter by category
    if (categoryFilter !== 'All') {
      items = items.filter((l) => l.category === categoryFilter);
    }

    // Filter by favorites
    if (favoritesOnly) {
      items = items.filter((l) => l.favorite);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          (l.description && l.description.toLowerCase().includes(q)) ||
          l.category.toLowerCase().includes(q),
      );
    }

    // Sort: favorites first, then by updatedAt descending
    return [...items].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [savedLooks, categoryFilter, favoritesOnly, searchQuery]);

  // ── Capture current state ───────────────────────────────────────────

  const captureCurrentLookData = useCallback((): LookData => {
    return {
      curves: JSON.parse(JSON.stringify(curveData)),
      channels: JSON.parse(JSON.stringify(channelData)),
      abNodes: JSON.parse(JSON.stringify(abNodes)),
      clNodes: JSON.parse(JSON.stringify(clNodes)),
      masks: JSON.parse(JSON.stringify(masks)),
      globalIntensity,
      colorSpace: settings.colorSpace,
      inputColorSpace: settings.inputColorSpace,
    };
  }, [curveData, channelData, abNodes, clNodes, masks, globalIntensity, settings]);

  // ── Save handler ────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    const trimmedName = saveName.trim();
    if (!trimmedName) return;

    const lookData = captureCurrentLookData();
    const now = new Date().toISOString();

    const newLook: SavedLook = {
      id: generateId(),
      name: trimmedName,
      description: saveDescription.trim() || undefined,
      category: saveCategory,
      favorite: false,
      data: lookData,
      createdAt: now,
      updatedAt: now,
    };

    addSavedLook(newLook);
    setShowSaveDialog(false);
    setSaveName('');
    setSaveDescription('');
    setSaveCategory('Custom');
  }, [
    saveName,
    saveDescription,
    saveCategory,
    captureCurrentLookData,
    addSavedLook,
  ]);

  // ── Load handler ────────────────────────────────────────────────────

  const handleLoad = useCallback(
    (look: SavedLook) => {
      // Restore curves
      if (look.data.curves) {
        setCurveData(look.data.curves);
      }

      // Restore channels
      if (look.data.channels) {
        const channels = look.data.channels as unknown as Record<
          string,
          {
            enabled: boolean;
            gain: number;
            gamma: number;
            lift: number;
            offset: number;
          }
        >;
        Object.entries(channels).forEach(([key, data]) => {
          updateChannel(key, data);
        });
      }

      // Restore AB nodes
      if (look.data.abNodes) {
        setABNodes(look.data.abNodes);
      }

      // Restore CL nodes
      if (look.data.clNodes) {
        setCLNodes(look.data.clNodes);
      }

      // Restore global intensity
      if (look.data.globalIntensity !== undefined) {
        setGlobalIntensity(look.data.globalIntensity);
      }

      // Restore color spaces
      if (look.data.colorSpace) {
        updateSettings({ colorSpace: look.data.colorSpace });
      }
      if (look.data.inputColorSpace) {
        updateSettings({ inputColorSpace: look.data.inputColorSpace });
      }
    },
    [
      setCurveData,
      updateChannel,
      setABNodes,
      setCLNodes,
      setGlobalIntensity,
      updateSettings,
    ],
  );

  // ── Delete handler ──────────────────────────────────────────────────

  const handleDelete = useCallback(() => {
    if (deleteTarget) {
      removeSavedLook(deleteTarget.id);
      setDeleteTarget(null);
    }
  }, [deleteTarget, removeSavedLook]);

  // ── Duplicate handler ───────────────────────────────────────────────

  const handleDuplicate = useCallback(
    (look: SavedLook) => {
      const now = new Date().toISOString();
      const duplicate: SavedLook = {
        ...JSON.parse(JSON.stringify(look)),
        id: generateId(),
        name: `${look.name} (Copy)`,
        favorite: false,
        createdAt: now,
        updatedAt: now,
      };
      addSavedLook(duplicate);
    },
    [addSavedLook],
  );

  // ── Export handler ──────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    if (savedLooks.length === 0) return;

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      looks: savedLooks,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chroma-forge-looks-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [savedLooks]);

  // ── Import handler ──────────────────────────────────────────────────

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const processImportFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result;
          if (typeof content !== 'string') return;

          const parsed = JSON.parse(content);

          // Support both wrapped format ({ looks: [...] }) and raw array
          let imported: SavedLook[];
          if (Array.isArray(parsed)) {
            imported = parsed;
          } else if (parsed.looks && Array.isArray(parsed.looks)) {
            imported = parsed.looks;
          } else {
            console.error('Invalid look file format');
            return;
          }

          // Validate basic structure and assign new IDs to avoid collisions
          const now = new Date().toISOString();
          const validLooks = imported
            .filter(
              (l: SavedLook) =>
                l.id &&
                l.name &&
                l.data &&
                typeof l.name === 'string',
            )
            .map((l: SavedLook) => ({
              ...l,
              id: generateId(),
              createdAt: l.createdAt || now,
              updatedAt: now,
            }));

          if (validLooks.length > 0) {
            setSavedLooks([...savedLooks, ...validLooks]);
          }
        } catch (err) {
          console.error('Failed to import looks:', err);
        }
      };
      reader.readAsText(file);
    },
    [savedLooks, setSavedLooks],
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
          <div className="flex items-center gap-2">
            <Bookmark size={16} className="text-amber-400" />
            <h2 className="text-base font-semibold tracking-tight text-white">
              Look Manager
            </h2>
          </div>
          <span className="text-xs text-zinc-500 tabular-nums">
            {filteredLooks.length} of {savedLooks.length}
          </span>
        </div>

        {/* Action buttons row */}
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSaveDialog(true)}
                className="h-8 gap-1.5 text-xs font-medium bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 hover:border-zinc-700"
              >
                <Plus size={14} />
                Save Current
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="bg-zinc-900 border-zinc-700 text-zinc-200 text-xs"
            >
              Save current editing state as a look
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={savedLooks.length === 0}
                className="h-8 gap-1.5 text-xs font-medium bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 hover:border-zinc-700 disabled:opacity-40 disabled:pointer-events-none"
              >
                <Download size={14} />
                Export
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="bg-zinc-900 border-zinc-700 text-zinc-200 text-xs"
            >
              Export all looks as JSON
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={handleImport}
                className="h-8 gap-1.5 text-xs font-medium bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 hover:border-zinc-700"
              >
                <Upload size={14} />
                Import
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="bg-zinc-900 border-zinc-700 text-zinc-200 text-xs"
            >
              Import looks from JSON file
            </TooltipContent>
          </Tooltip>

          {/* Hidden file input for import */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) processImportFile(file);
              e.target.value = '';
            }}
            className="hidden"
          />
        </div>

        {/* Search & favorites toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
            />
            <Input
              placeholder="Search looks..."
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
            <Star
              size={13}
              className={cn(
                'transition-colors',
                favoritesOnly ? 'text-amber-400' : 'text-zinc-500',
              )}
            />
            <Switch
              checked={favoritesOnly}
              onCheckedChange={setFavoritesOnly}
              className="data-[state=checked]:bg-amber-500/80 data-[state=unchecked]:bg-zinc-800"
            />
          </div>
        </div>

        {/* Category filter tabs */}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => {
            const isActive = cat === categoryFilter;

            return (
              <Button
                key={cat}
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  'h-6 px-2.5 text-[11px] font-medium rounded-full transition-all',
                  isActive
                    ? 'bg-zinc-200 text-zinc-950 hover:bg-zinc-300 shadow-none border-0'
                    : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/50',
                )}
              >
                {cat === 'All' ? (
                  cat
                ) : (
                  <span className="flex items-center gap-1">
                    {CATEGORY_ICONS[cat]} {cat}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      </div>

      <Separator className="bg-zinc-800/60" />

      {/* ── Grid ────────────────────────────────────────────────────── */}
      <ScrollArea className="flex-1 px-4 py-3">
        {filteredLooks.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 pb-2">
            <AnimatePresence mode="popLayout">
              {filteredLooks.map((look) => (
                <LookCard
                  key={look.id}
                  look={look}
                  onLoad={handleLoad}
                  onDelete={(id) => {
                    const target = savedLooks.find((l) => l.id === id);
                    if (target) setDeleteTarget(target);
                  }}
                  onDuplicate={handleDuplicate}
                  onToggleFavorite={toggleLookFavorite}
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
            <FolderOpen size={36} className="text-zinc-700" />
            <p className="text-sm font-medium text-zinc-400">
              {savedLooks.length === 0
                ? 'No saved looks yet'
                : 'No looks match your filters'}
            </p>
            <p className="text-xs text-zinc-600 max-w-[220px] text-center leading-relaxed">
              {savedLooks.length === 0
                ? 'Click "Save Current" to capture your editing state as a reusable look'
                : 'Try adjusting your search or category filter'}
            </p>
            {savedLooks.length === 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSaveDialog(true)}
                className="mt-2 text-xs text-zinc-500 hover:text-zinc-300 gap-1.5"
              >
                <Save size={13} />
                Save your first look
              </Button>
            )}
            {(searchQuery || categoryFilter !== 'All' || favoritesOnly) &&
              savedLooks.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('');
                    setCategoryFilter('All');
                    setFavoritesOnly(false);
                  }}
                  className="mt-2 text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Clear all filters
                </Button>
              )}
          </motion.div>
        )}
      </ScrollArea>

      {/* ── Save Dialog ────────────────────────────────────────────── */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-white">
              Save Current Look
            </DialogTitle>
            <DialogDescription className="text-sm text-zinc-500">
              Capture all current editing state (curves, grids, channels, masks)
              as a reusable look.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name */}
            <div className="space-y-1.5">
              <Label
                htmlFor="look-name"
                className="text-xs font-medium text-zinc-400"
              >
                Name
              </Label>
              <Input
                id="look-name"
                placeholder="My Custom Look"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                }}
                className="h-9 text-sm bg-zinc-800/60 border-zinc-700 text-zinc-200 placeholder:text-zinc-600 focus-visible:border-zinc-600 focus-visible:ring-zinc-700/50"
                autoFocus
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label
                htmlFor="look-description"
                className="text-xs font-medium text-zinc-400"
              >
                Description{' '}
                <span className="text-zinc-600">(optional)</span>
              </Label>
              <Textarea
                id="look-description"
                placeholder="Warm cinematic grade for golden hour..."
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
                rows={3}
                className="text-sm bg-zinc-800/60 border-zinc-700 text-zinc-200 placeholder:text-zinc-600 focus-visible:border-zinc-600 focus-visible:ring-zinc-700/50 resize-none"
              />
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <Label
                htmlFor="look-category"
                className="text-xs font-medium text-zinc-400"
              >
                Category
              </Label>
              <Select value={saveCategory} onValueChange={setSaveCategory}>
                <SelectTrigger className="h-9 text-sm bg-zinc-800/60 border-zinc-700 text-zinc-200 focus:ring-zinc-700/50 focus:ring-1">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200">
                  {CATEGORIES.filter((c) => c !== 'All').map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      <span className="flex items-center gap-1.5">
                        <span>{CATEGORY_ICONS[cat]}</span>
                        {cat}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSaveDialog(false)}
              className="text-xs bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!saveName.trim()}
              className="text-xs bg-zinc-200 text-zinc-950 hover:bg-zinc-300 disabled:opacity-40 disabled:pointer-events-none"
            >
              <Save size={13} className="mr-1.5" />
              Save Look
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ─────────────────────────────── */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold text-white">
              Delete Look
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-zinc-400">
              Are you sure you want to delete{' '}
              <span className="text-zinc-200 font-medium">
                &ldquo;{deleteTarget?.name}&rdquo;
              </span>
              ? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 pt-2">
            <AlertDialogCancel className="text-xs bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 hover:border-zinc-600">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="text-xs bg-red-600 text-white hover:bg-red-500 border-0 focus:ring-red-500/50"
            >
              <Trash2 size={13} className="mr-1.5" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
