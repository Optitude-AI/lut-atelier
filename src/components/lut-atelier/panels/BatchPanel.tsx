'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAppStore, type BatchItem } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Upload,
  Play,
  X,
  Trash2,
  Check,
  AlertCircle,
  Loader2,
  Settings,
  FolderOpen,
  Image as ImageIcon,
  RotateCcw,
  Download,
  Clock,
  Layers,
} from 'lucide-react';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface BatchPanelProps {
  className?: string;
}

type ExportFormat = 'png' | 'jpeg' | 'tiff';

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

/** Status badge for a batch item */
function StatusBadge({ status }: { status: BatchItem['status'] }) {
  switch (status) {
    case 'pending':
      return (
        <Badge
          variant="secondary"
          className="text-[9px] px-1.5 py-0 h-4 font-medium bg-zinc-800 text-zinc-400 border-zinc-700/50"
        >
          Pending
        </Badge>
      );
    case 'processing':
      return (
        <Badge
          variant="secondary"
          className="text-[9px] px-1.5 py-0 h-4 font-medium bg-amber-500/15 text-amber-300 border border-amber-500/20"
        >
          <Loader2 size={9} className="animate-spin mr-1" />
          Processing
        </Badge>
      );
    case 'completed':
      return (
        <Badge
          variant="secondary"
          className="text-[9px] px-1.5 py-0 h-4 font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/20"
        >
          <Check size={9} className="mr-0.5" />
          Done
        </Badge>
      );
    case 'error':
      return (
        <Badge
          variant="secondary"
          className="text-[9px] px-1.5 py-0 h-4 font-medium bg-red-500/15 text-red-300 border border-red-500/20"
        >
          <AlertCircle size={9} className="mr-0.5" />
          Error
        </Badge>
      );
  }
}

/** Single batch item row */
function BatchItemRow({
  item,
  onRemove,
}: {
  item: BatchItem;
  onRemove: (id: string) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'group relative flex items-center gap-3 px-3 py-2 rounded-lg transition-all',
        item.status === 'processing' && 'bg-amber-500/5 ring-1 ring-amber-500/10',
        item.status === 'completed' && 'bg-emerald-500/5',
        item.status === 'error' && 'bg-red-500/5',
        item.status === 'pending' && 'hover:bg-white/[0.03]',
      )}
    >
      {/* Thumbnail or placeholder */}
      <div className="flex-shrink-0 w-9 h-9 rounded-md overflow-hidden ring-1 ring-white/10 bg-zinc-800">
        {item.preview ? (
          <img
            src={item.preview}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        ) : item.status === 'processing' ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 size={14} className="text-amber-400 animate-spin" />
          </div>
        ) : item.status === 'completed' ? (
          <div className="w-full h-full flex items-center justify-center bg-emerald-500/10">
            <Check size={14} className="text-emerald-400" />
          </div>
        ) : item.status === 'error' ? (
          <div className="w-full h-full flex items-center justify-center bg-red-500/10">
            <AlertCircle size={14} className="text-red-400" />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon size={14} className="text-zinc-600" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'text-xs font-medium truncate',
            item.status === 'completed'
              ? 'text-emerald-200'
              : item.status === 'error'
                ? 'text-red-200'
                : item.status === 'processing'
                  ? 'text-amber-200'
                  : 'text-zinc-300',
          )}
        >
          {item.name}
        </p>
        <p className="text-[10px] text-zinc-600 truncate">
          {item.file.type || 'image'} · {(item.file.size / 1024).toFixed(1)} KB
        </p>
      </div>

      {/* Status badge */}
      <StatusBadge status={item.status} />

      {/* Delete button */}
      <AnimatePresence>
        {isHovered && item.status !== 'processing' && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.1 }}
            onClick={() => onRemove(item.id)}
            className="flex-shrink-0 p-1 rounded transition-colors text-zinc-600 hover:text-red-400 hover:bg-red-500/10"
            aria-label="Remove image"
          >
            <Trash2 size={12} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Progress bar component */
function BatchProgressBar({
  completed,
  total,
  status,
}: {
  completed: number;
  total: number;
  status: string;
}) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-500 font-medium">Progress</span>
        <span className="text-[10px] text-zinc-400 tabular-nums font-semibold">
          {completed}/{total} ({percent}%)
        </span>
      </div>

      <div className="relative h-2 rounded-full bg-zinc-800 overflow-hidden">
        {/* Background track */}
        <div className="absolute inset-0 rounded-full bg-zinc-800" />

        {/* Animated progress fill */}
        <motion.div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-colors',
            status === 'error'
              ? 'bg-red-500'
              : status === 'processing'
                ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                : 'bg-gradient-to-r from-emerald-500 to-teal-500',
          )}
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />

        {/* Shimmer overlay during processing */}
        {status === 'processing' && percent > 0 && percent < 100 && (
          <motion.div
            className="absolute inset-y-0 bg-gradient-to-r from-transparent via-white/15 to-transparent"
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function BatchPanel({ className }: BatchPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  // ── Store ──
  const batchItems = useAppStore((s) => s.batchItems);
  const addBatchItems = useAppStore((s) => s.addBatchItems);
  const removeBatchItem = useAppStore((s) => s.removeBatchItem);
  const updateBatchItem = useAppStore((s) => s.updateBatchItem);
  const clearBatchItems = useAppStore((s) => s.clearBatchItems);
  const batchStatus = useAppStore((s) => s.batchStatus);
  const setBatchStatus = useAppStore((s) => s.setBatchStatus);

  // ── Local State ──
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [jpegQuality, setJpegQuality] = useState(92);
  const [namingPattern, setNamingPattern] = useState('{name}_graded');
  const [showSettings, setShowSettings] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // ── Derived ──
  const pendingItems = batchItems.filter((i) => i.status === 'pending');
  const completedItems = batchItems.filter((i) => i.status === 'completed');
  const errorItems = batchItems.filter((i) => i.status === 'error');
  const isProcessing = batchStatus === 'processing';

  // ── File handling ──

  const createPreview = useCallback((file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files) return;

      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) return;

      const newItems: BatchItem[] = await Promise.all(
        imageFiles.map(async (file, idx) => {
          let preview: string | undefined;
          try {
            preview = await createPreview(file);
          } catch {
            // preview stays undefined
          }
          return {
            id: `batch-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
            file,
            name: file.name.replace(/\.[^.]+$/, ''),
            status: 'pending' as const,
            preview,
          };
        }),
      );

      addBatchItems(newItems);
    },
    [addBatchItems, createPreview],
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
      e.target.value = '';
    },
    [handleFiles],
  );

  // ── Batch processing ──

  const handleStartBatch = useCallback(async () => {
    if (isProcessing || pendingItems.length === 0) return;

    cancelRef.current = false;
    setBatchStatus('processing');

    for (const item of pendingItems) {
      if (cancelRef.current) break;

      // Mark as processing
      updateBatchItem(item.id, { status: 'processing' });

      // Simulate processing with setTimeout
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            if (cancelRef.current) {
              resolve();
            } else {
              // Simulate occasional error (10% chance)
              if (Math.random() < 0.1) {
                reject(new Error('Simulated processing error'));
              } else {
                resolve();
              }
            }
          }, 800 + Math.random() * 1200); // 0.8-2s per image
        });

        updateBatchItem(item.id, { status: 'completed' });
      } catch {
        updateBatchItem(item.id, { status: 'error' });
      }
    }

    if (!cancelRef.current) {
      setBatchStatus('completed');
    }
  }, [isProcessing, pendingItems, updateBatchItem, setBatchStatus]);

  const handleCancel = useCallback(() => {
    cancelRef.current = true;
    setBatchStatus('idle');
    // Reset any processing items back to pending
    batchItems
      .filter((i) => i.status === 'processing')
      .forEach((i) => updateBatchItem(i.id, { status: 'pending' }));
  }, [batchItems, updateBatchItem, setBatchStatus]);

  const handleClearAll = useCallback(() => {
    if (isProcessing) return;
    clearBatchItems();
  }, [isProcessing, clearBatchItems]);

  // ── Apply naming pattern ──
  const resolveName = useCallback(
    (name: string) => {
      return namingPattern.replace('{name}', name);
    },
    [namingPattern],
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
            <div className="w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.5)]" />
            <h2 className="text-base font-semibold tracking-tight text-white">
              Batch Process
            </h2>
            {batchItems.length > 0 && (
              <span className="text-[10px] text-zinc-500 tabular-nums font-medium bg-zinc-800/60 px-1.5 py-0.5 rounded-full">
                {batchItems.length}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {batchItems.length > 0 && !isProcessing && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearAll}
                    className="h-7 px-2 text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                  >
                    <RotateCcw size={13} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
                  Clear all images
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* ── Drop Zone ────────────────────────────────────────────── */}
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
            'relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 transition-all cursor-pointer',
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
                'h-6 w-6 transition-colors',
                isDragOver ? 'text-amber-400' : 'text-white/30',
              )}
            />
          </motion.div>
          <div className="text-center">
            <p className="text-xs font-medium text-white/50">
              Drop images here or click to browse
            </p>
            <p className="text-[10px] text-white/25 mt-0.5">
              Supports JPG, PNG, TIFF, WebP · Multiple files
            </p>
          </div>
        </div>

        {/* ── Quick Stats ──────────────────────────────────────────── */}
        {batchItems.length > 0 && (
          <div className="flex items-center gap-3 px-1">
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <div className="w-2 h-2 rounded-full bg-zinc-600" />
              <span>Pending: <span className="text-zinc-300 tabular-nums font-medium">{pendingItems.length}</span></span>
            </div>
            {completedItems.length > 0 && (
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>Done: <span className="text-emerald-300 tabular-nums font-medium">{completedItems.length}</span></span>
              </div>
            )}
            {errorItems.length > 0 && (
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span>Errors: <span className="text-red-300 tabular-nums font-medium">{errorItems.length}</span></span>
              </div>
            )}
          </div>
        )}

        {/* ── Settings Toggle ──────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
            className={cn(
              'h-8 gap-1.5 px-3 text-xs font-medium flex-1',
              'bg-zinc-800/60 border border-zinc-700/60',
              'hover:bg-zinc-700/60 hover:border-zinc-600/60',
              'text-zinc-300 hover:text-white transition-all',
            )}
          >
            <Settings size={13} className="text-zinc-400" />
            Export Settings
            <motion.div
              animate={{ rotate: showSettings ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              className="text-zinc-600 ml-1"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M3 4L5 6L7 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.div>
          </Button>
        </div>

        {/* ── Settings Panel ───────────────────────────────────────── */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/50 space-y-4">
                {/* Export Format */}
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold block">
                    Export Format
                  </label>
                  <Select
                    value={exportFormat}
                    onValueChange={(v) => setExportFormat(v as ExportFormat)}
                  >
                    <SelectTrigger className="h-8 text-xs bg-zinc-800/60 border-zinc-700/60 text-zinc-300 focus:border-zinc-600 focus:ring-zinc-700/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-800 shadow-xl shadow-black/40">
                      <SelectItem value="png" className="text-xs text-zinc-300 focus:text-white focus:bg-zinc-800">
                        PNG (Lossless)
                      </SelectItem>
                      <SelectItem value="jpeg" className="text-xs text-zinc-300 focus:text-white focus:bg-zinc-800">
                        JPEG (Lossy)
                      </SelectItem>
                      <SelectItem value="tiff" className="text-xs text-zinc-300 focus:text-white focus:bg-zinc-800">
                        TIFF (Lossless)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Quality slider (JPEG only) */}
                <AnimatePresence>
                  {exportFormat === 'jpeg' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                            JPEG Quality
                          </label>
                          <span className="text-[10px] text-zinc-400 tabular-nums font-semibold">
                            {jpegQuality}%
                          </span>
                        </div>
                        <div className="relative">
                          <div
                            className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full opacity-20"
                            style={{
                              background: `linear-gradient(90deg, #f59e0b ${jpegQuality}%, transparent ${jpegQuality}%)`,
                            }}
                          />
                          <Slider
                            min={1}
                            max={100}
                            step={1}
                            value={[jpegQuality]}
                            onValueChange={([v]) => setJpegQuality(v)}
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
                        <div className="flex justify-between text-[9px] text-zinc-700">
                          <span>Small file</span>
                          <span>Best quality</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Naming pattern */}
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold block">
                    Output Naming
                  </label>
                  <Input
                    value={namingPattern}
                    onChange={(e) => setNamingPattern(e.target.value)}
                    placeholder="{name}_graded"
                    className="h-8 text-xs bg-zinc-800/60 border-zinc-700/60 text-zinc-300 placeholder:text-zinc-600 focus-visible:border-zinc-600 focus-visible:ring-zinc-700/50"
                  />
                  <p className="text-[9px] text-zinc-700">
                    Use {'{name}'} for original filename
                  </p>
                  {batchItems.length > 0 && pendingItems.length > 0 && (
                    <p className="text-[9px] text-zinc-600 font-mono truncate">
                      Example: {resolveName(pendingItems[0].name)}.{exportFormat === 'jpeg' ? 'jpg' : exportFormat}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Progress Bar ─────────────────────────────────────────── */}
        {(isProcessing || batchStatus === 'completed') && (
          <BatchProgressBar
            completed={completedItems.length}
            total={batchItems.length}
            status={batchStatus}
          />
        )}

        {/* ── Control Buttons ──────────────────────────────────────── */}
        {batchItems.length > 0 && (
          <div className="flex gap-2">
            {isProcessing ? (
              <Button
                onClick={handleCancel}
                variant="ghost"
                size="sm"
                className={cn(
                  'h-9 gap-1.5 px-3 text-xs font-medium flex-1',
                  'bg-red-500/10 border border-red-500/20',
                  'hover:bg-red-500/20 hover:border-red-500/30',
                  'text-red-300 hover:text-red-200 transition-all',
                )}
              >
                <X size={13} />
                Cancel
              </Button>
            ) : (
              <>
                <Button
                  onClick={handleStartBatch}
                  disabled={pendingItems.length === 0}
                  className={cn(
                    'h-9 gap-1.5 px-3 text-xs font-semibold flex-1',
                    'bg-gradient-to-r from-amber-500 to-orange-500',
                    'hover:from-amber-400 hover:to-orange-400',
                    'text-white shadow-lg shadow-amber-500/20 transition-all',
                    pendingItems.length === 0 && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  <Play size={13} />
                  Start Batch ({pendingItems.length})
                </Button>

                {completedItems.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-9 gap-1.5 px-3 text-xs font-medium',
                      'bg-emerald-500/10 border border-emerald-500/20',
                      'hover:bg-emerald-500/20 hover:border-emerald-500/30',
                      'text-emerald-300 hover:text-emerald-200 transition-all',
                    )}
                  >
                    <Download size={13} />
                    Export
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Image Queue ────────────────────────────────────────────── */}
      {batchItems.length > 0 ? (
        <ScrollArea className="flex-1 px-3 pb-4">
          <div className="flex flex-col gap-1">
            <AnimatePresence mode="popLayout">
              {batchItems.map((item) => (
                <BatchItemRow
                  key={item.id}
                  item={item}
                  onRemove={removeBatchItem}
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
                <Layers size={22} className="text-zinc-700" />
              </div>
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center"
              >
                <FolderOpen size={10} className="text-zinc-500" />
              </motion.div>
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-500">No images queued</p>
              <p className="text-[11px] text-zinc-600 max-w-[200px] leading-relaxed mt-1">
                Drop images above to queue them for batch LUT processing
              </p>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────────── */}
      {batchItems.length > 0 && !isProcessing && (
        <div className="flex-shrink-0 px-4 py-2.5 border-t border-zinc-800/60">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-zinc-600">
              <Clock size={9} className="inline mr-1" />
              Est. {((pendingItems.length * 1.4)).toFixed(0)}s remaining
            </p>
            <p className="text-[10px] text-zinc-600">
              Format: {exportFormat.toUpperCase()}
              {exportFormat === 'jpeg' && ` · Quality: ${jpegQuality}%`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
