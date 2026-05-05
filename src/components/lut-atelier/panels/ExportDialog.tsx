'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  FileImage,
  Palette,
  Camera,
  Layers,
  Loader2,
  Check,
  Box,
  ArrowRight,
  Info,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/store/useAppStore';
import { toast } from 'sonner';

// --- Format definitions ---
interface ExportFormat {
  id: string;
  title: string;
  description: string;
  formatBadge: string;
  icon: React.ElementType;
  accentColor: string;
  bgColor: string;
  borderColor: string;
}

const exportFormats: ExportFormat[] = [
  {
    id: 'photoshop-lut',
    title: 'Photoshop LUT',
    description: 'For Color Lookup adjustment layers in Photoshop',
    formatBadge: '.cube',
    icon: Layers,
    accentColor: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
  },
  {
    id: 'camera-raw-profile',
    title: 'Camera Raw Profile',
    description: 'For Adobe Camera Raw and Lightroom CC',
    formatBadge: '.xmp',
    icon: Palette,
    accentColor: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/30',
  },
  {
    id: 'lightroom-preset',
    title: 'Lightroom Preset',
    description: 'For Lightroom Classic adjustments',
    formatBadge: '.lrtemplate',
    icon: Camera,
    accentColor: 'text-sky-400',
    bgColor: 'bg-sky-500/10',
    borderColor: 'border-sky-500/30',
  },
  {
    id: 'capture-one-recipe',
    title: 'Capture One Recipe',
    description: 'For Capture One Pro styles and LUTs',
    formatBadge: '.txt + .cube',
    icon: FileImage,
    accentColor: 'text-teal-400',
    bgColor: 'bg-teal-500/10',
    borderColor: 'border-teal-500/30',
  },
  {
    id: 'generic-3dlut',
    title: 'Generic 3D LUT',
    description: 'Universal format for DaVinci Resolve, FCPX, etc.',
    formatBadge: '.cube',
    icon: Box,
    accentColor: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
  },
];

// --- Integration notes per format ---
const integrationNotes: Record<string, { title: string; steps: string[] }> = {
  'photoshop-lut': {
    title: 'Photoshop Integration',
    steps: [
      'Apply via Layer > New Adjustment Layer > Color Lookup',
      'Select your exported .cube file from the 3D LUT File dropdown',
      'Adjust the opacity of the adjustment layer for intensity control',
    ],
  },
  'camera-raw-profile': {
    title: 'Camera Raw / Lightroom CC',
    steps: [
      'Import profile via Edit > Presets > Import Profiles & Presets',
      'Place the .xmp file in the Camera Profiles folder',
      'Access via the Profile Browser in the Basic panel',
    ],
  },
  'lightroom-preset': {
    title: 'Lightroom Classic',
    steps: [
      'Import preset via Edit > Presets > Import Develop Presets',
      'Place the .lrtemplate file in the Develop Presets folder',
      'Apply from the Presets panel on the left sidebar',
    ],
  },
  'capture-one-recipe': {
    title: 'Capture One Pro',
    steps: [
      'Load LUT via Edit > Styles > Import',
      'Select both the .txt recipe and .cube LUT file',
      'Apply from the Styles & Presets panel',
    ],
  },
  'generic-3dlut': {
    title: 'Universal Usage',
    steps: [
      'Compatible with DaVinci Resolve, Final Cut Pro X, Premiere Pro',
      'Import through the color management / LUT settings',
      'Works in any application supporting .cube format',
    ],
  },
};

// --- Step transitions ---
const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 80 : -80,
    opacity: 0,
  }),
};

// --- Auto-generate LUT name ---
function generateLUTName(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
  return `LUT_Atelier_${dateStr}_${timeStr}`;
}

export default function ExportDialog() {
  const isExportOpen = useAppStore((s) => s.isExportOpen);
  const setIsExportOpen = useAppStore((s) => s.setIsExportOpen);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(0);
  const [selectedFormat, setSelectedFormat] = useState<string>('photoshop-lut');
  const [lutName, setLutName] = useState(generateLUTName());
  const [localColorSpace, setLocalColorSpace] = useState(settings.colorSpace);
  const [localGridSize, setLocalGridSize] = useState(String(settings.gridSize));
  const [localBitDepth, setLocalBitDepth] = useState(settings.bitDepth);
  const [isExporting, setIsExporting] = useState(false);
  const [exportComplete, setExportComplete] = useState(false);

  const totalSteps = 3;

  const goToStep = useCallback(
    (step: number) => {
      setDirection(step > currentStep ? 1 : -1);
      setCurrentStep(step);
    },
    [currentStep],
  );

  const handleNext = useCallback(() => {
    if (currentStep < totalSteps - 1) {
      setDirection(1);
      setCurrentStep((s) => s + 1);
    }
  }, [currentStep]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setDirection(-1);
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  const activeFormat = useMemo(
    () => exportFormats.find((f) => f.id === selectedFormat),
    [selectedFormat],
  );

  const activeNotes = useMemo(
    () => integrationNotes[selectedFormat],
    [selectedFormat],
  );

  const handleExport = useCallback(async () => {
    setIsExporting(true);

    // Sync settings back to store
    updateSettings({
      colorSpace: localColorSpace,
      gridSize: Number(localGridSize) as 17 | 33 | 65,
      bitDepth: localBitDepth as '8' | '16' | '32',
    });

    // Simulate export delay
    await new Promise((resolve) => setTimeout(resolve, 2000));

    setIsExporting(false);
    setExportComplete(true);

    const formatLabel = activeFormat?.formatBadge || '.cube';
    toast.success('LUT exported successfully!', {
      description: `${lutName}${formatLabel} has been saved.`,
      duration: 4000,
    });

    // Reset after showing success briefly
    setTimeout(() => {
      setExportComplete(false);
      setIsExportOpen(false);
      // Reset to step 0 for next time
      setCurrentStep(0);
      setLutName(generateLUTName());
    }, 1500);
  }, [
    activeFormat,
    lutName,
    localColorSpace,
    localGridSize,
    localBitDepth,
    updateSettings,
    setIsExportOpen,
  ]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsExportOpen(open);
      if (!open) {
        setCurrentStep(0);
        setExportComplete(false);
        setLutName(generateLUTName());
      }
    },
    [setIsExportOpen],
  );

  return (
    <Dialog open={isExportOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[560px] border-white/10 bg-zinc-950 p-0 gap-0 overflow-hidden"
        showCloseButton
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-white/[0.06]">
          <DialogHeader>
            <DialogTitle className="text-white text-lg flex items-center gap-2.5">
              <div className="flex items-center justify-center size-8 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/20">
                <Download className="size-4 text-amber-400" />
              </div>
              Export LUT
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-sm">
              Choose a format, configure settings, and export your color grade.
            </DialogDescription>
          </DialogHeader>

          {/* Step indicators */}
          <div className="flex items-center gap-1.5 mt-4">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <React.Fragment key={i}>
                <button
                  onClick={() => goToStep(i)}
                  className={`
                    flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all
                    ${
                      i === currentStep
                        ? 'bg-white/10 text-white'
                        : i < currentStep
                          ? 'text-zinc-400 hover:text-zinc-300 hover:bg-white/[0.04]'
                          : 'text-zinc-600 hover:text-zinc-500 hover:bg-white/[0.04]'
                    }
                  `}
                >
                  <span
                    className={`flex items-center justify-center size-5 rounded-full text-[10px] font-semibold
                      ${i === currentStep ? 'bg-amber-500 text-black' : i < currentStep ? 'bg-white/10 text-zinc-300' : 'bg-white/[0.06] text-zinc-500'}`}
                  >
                    {i < currentStep ? <Check className="size-3" /> : i + 1}
                  </span>
                  <span className="hidden sm:inline">
                    {['Format', 'Settings', 'Notes'][i]}
                  </span>
                </button>
                {i < totalSteps - 1 && (
                  <div
                    className={`h-px flex-1 transition-colors ${i < currentStep ? 'bg-white/20' : 'bg-white/[0.06]'}`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="relative min-h-[360px] overflow-hidden">
          <AnimatePresence initial={false} custom={direction} mode="wait">
            {/* Step 0: Choose Format */}
            {currentStep === 0 && (
              <motion.div
                key="step-format"
                custom={direction}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className="absolute inset-0 p-6 overflow-y-auto"
              >
                <h3 className="text-sm font-medium text-zinc-300 mb-3">
                  Choose Export Format
                </h3>
                <div className="space-y-2">
                  {exportFormats.map((format) => {
                    const Icon = format.icon;
                    const isSelected = selectedFormat === format.id;
                    return (
                      <motion.button
                        key={format.id}
                        onClick={() => setSelectedFormat(format.id)}
                        whileHover={{ scale: 1.005 }}
                        whileTap={{ scale: 0.995 }}
                        className={`
                          w-full flex items-start gap-3.5 p-3.5 rounded-xl border text-left transition-all
                          ${isSelected ? `${format.borderColor} ${format.bgColor} ring-1 ring-white/[0.08]` : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1]'}
                        `}
                      >
                        <div
                          className={`flex items-center justify-center size-10 rounded-lg shrink-0 ${format.bgColor} ${isSelected ? 'ring-1 ring-white/10' : ''}`}
                        >
                          <Icon className={`size-5 ${format.accentColor}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-zinc-300'}`}
                            >
                              {format.title}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 border-white/10 text-zinc-400"
                            >
                              {format.formatBadge}
                            </Badge>
                          </div>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            {format.description}
                          </p>
                        </div>
                        <div
                          className={`mt-1 size-4 rounded-full border-2 transition-all shrink-0
                            ${isSelected ? `${format.borderColor} flex items-center justify-center` : 'border-white/10'}
                          `}
                        >
                          {isSelected && (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className={`size-2 rounded-full bg-current ${format.accentColor}`}
                            />
                          )}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* Step 1: Settings */}
            {currentStep === 1 && (
              <motion.div
                key="step-settings"
                custom={direction}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className="absolute inset-0 p-6 overflow-y-auto"
              >
                <h3 className="text-sm font-medium text-zinc-300 mb-4">
                  Export Settings
                </h3>
                <div className="space-y-5">
                  {/* LUT Name */}
                  <div className="space-y-2">
                    <Label className="text-zinc-300 text-xs">
                      LUT Name
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        value={lutName}
                        onChange={(e) => setLutName(e.target.value)}
                        className="flex-1 h-9 bg-white/[0.04] border-white/10 text-white text-sm placeholder:text-zinc-600 focus:border-amber-500/50 focus:ring-amber-500/20"
                        placeholder="my-lut-name"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setLutName(generateLUTName())}
                        className="shrink-0 border-white/10 text-zinc-400 hover:text-white hover:bg-white/[0.06] text-xs"
                      >
                        Regenerate
                      </Button>
                    </div>
                  </div>

                  {/* Color Space */}
                  <div className="space-y-2">
                    <Label className="text-zinc-300 text-xs">
                      Color Space
                    </Label>
                    <Select value={localColorSpace} onValueChange={(v) => setLocalColorSpace(v as 'srgb' | 'adobe-rgb' | 'prophoto-rgb')}>
                      <SelectTrigger className="w-full h-9 bg-white/[0.04] border-white/10 text-white text-sm data-[placeholder]:text-zinc-600 focus:border-amber-500/50 focus:ring-amber-500/20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-white/10">
                        <SelectItem value="srgb" className="text-zinc-200 focus:bg-white/[0.06] focus:text-white">
                          sRGB — Standard web & display
                        </SelectItem>
                        <SelectItem value="adobe-rgb" className="text-zinc-200 focus:bg-white/[0.06] focus:text-white">
                          Adobe RGB — Wide gamut printing
                        </SelectItem>
                        <SelectItem value="prophoto-rgb" className="text-zinc-200 focus:bg-white/[0.06] focus:text-white">
                          ProPhoto RGB — Maximum gamut
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Grid Size & Bit Depth side by side */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-zinc-300 text-xs">
                        Grid Size
                      </Label>
                      <Select value={localGridSize} onValueChange={setLocalGridSize}>
                        <SelectTrigger className="w-full h-9 bg-white/[0.04] border-white/10 text-white text-sm data-[placeholder]:text-zinc-600 focus:border-amber-500/50 focus:ring-amber-500/20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-white/10">
                          <SelectItem value="17" className="text-zinc-200 focus:bg-white/[0.06] focus:text-white">
                            17 × 17 — Small, fast
                          </SelectItem>
                          <SelectItem value="33" className="text-zinc-200 focus:bg-white/[0.06] focus:text-white">
                            33 × 33 — Balanced
                          </SelectItem>
                          <SelectItem value="65" className="text-zinc-200 focus:bg-white/[0.06] focus:text-white">
                            65 × 65 — High precision
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-zinc-300 text-xs">
                        Bit Depth
                      </Label>
                      <Select value={localBitDepth} onValueChange={(v) => setLocalBitDepth(v as '8' | '16' | '32')}>
                        <SelectTrigger className="w-full h-9 bg-white/[0.04] border-white/10 text-white text-sm data-[placeholder]:text-zinc-600 focus:border-amber-500/50 focus:ring-amber-500/20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-white/10">
                          <SelectItem value="8" className="text-zinc-200 focus:bg-white/[0.06] focus:text-white">
                            8-bit — Compact
                          </SelectItem>
                          <SelectItem value="16" className="text-zinc-200 focus:bg-white/[0.06] focus:text-white">
                            16-bit — Standard
                          </SelectItem>
                          <SelectItem value="32" className="text-zinc-200 focus:bg-white/[0.06] focus:text-white">
                            32-bit float — HDR
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Quick summary */}
                  <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Info className="size-3.5 text-zinc-500" />
                      <span className="text-xs font-medium text-zinc-400">
                        Export Summary
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <span className="text-zinc-500">Format</span>
                      <span className="text-zinc-300">{activeFormat?.title}</span>
                      <span className="text-zinc-500">Output</span>
                      <span className="text-zinc-300">{lutName}{activeFormat?.formatBadge}</span>
                      <span className="text-zinc-500">Color Space</span>
                      <span className="text-zinc-300">
                        {localColorSpace === 'srgb' ? 'sRGB' : localColorSpace === 'adobe-rgb' ? 'Adobe RGB' : 'ProPhoto RGB'}
                      </span>
                      <span className="text-zinc-500">Grid</span>
                      <span className="text-zinc-300">{localGridSize}×{localGridSize}</span>
                      <span className="text-zinc-500">Depth</span>
                      <span className="text-zinc-300">{localBitDepth}-bit</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Step 2: Integration Notes */}
            {currentStep === 2 && (
              <motion.div
                key="step-notes"
                custom={direction}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className="absolute inset-0 p-6 overflow-y-auto"
              >
                <h3 className="text-sm font-medium text-zinc-300 mb-1">
                  Integration Notes
                </h3>
                <p className="text-xs text-zinc-500 mb-4">
                  How to use your exported LUT in {activeFormat?.title}.
                </p>

                {/* Format indicator */}
                {activeFormat && (
                  <div className={`flex items-center gap-3 p-3 rounded-xl border mb-5 ${activeFormat.bgColor} ${activeFormat.borderColor}`}>
                    <div className={`flex items-center justify-center size-10 rounded-lg ${activeFormat.bgColor}`}>
                      <activeFormat.icon className={`size-5 ${activeFormat.accentColor}`} />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white">
                        {activeFormat.title}
                      </div>
                      <div className="text-xs text-zinc-400">
                        {activeFormat.description}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="ml-auto text-[10px] px-1.5 py-0 border-white/10 text-zinc-400"
                    >
                      {activeFormat.formatBadge}
                    </Badge>
                  </div>
                )}

                {/* Steps */}
                <div className="space-y-3">
                  {activeNotes.steps.map((step, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="flex items-start gap-3"
                    >
                      <div
                        className={`flex items-center justify-center size-6 rounded-full shrink-0 text-[10px] font-bold
                          ${activeFormat?.bgColor} ${activeFormat?.accentColor}`}
                      >
                        {idx + 1}
                      </div>
                      <p className="text-sm text-zinc-300 pt-0.5 leading-relaxed">
                        {step}
                      </p>
                    </motion.div>
                  ))}
                </div>

                {/* Tip box */}
                <div className="mt-5 rounded-lg bg-amber-500/[0.06] border border-amber-500/20 p-3">
                  <div className="flex items-start gap-2">
                    <Info className="size-3.5 text-amber-400 mt-0.5 shrink-0" />
                    <div className="text-xs text-amber-200/70 leading-relaxed">
                      <strong className="text-amber-300">Pro tip:</strong>{' '}
                      For best results, ensure your source image color space matches the export color space. Use Adobe RGB or ProPhoto RGB for maximum color fidelity when working with RAW files.
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.06] flex items-center justify-between">
          <div>
            {currentStep > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="text-zinc-400 hover:text-white hover:bg-white/[0.06] text-sm"
              >
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {currentStep < totalSteps - 1 ? (
              <Button
                onClick={handleNext}
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-black font-medium text-sm"
              >
                Next
                <ArrowRight className="size-3.5" />
              </Button>
            ) : (
              <Button
                onClick={handleExport}
                disabled={isExporting || exportComplete}
                size="sm"
                className={`
                  min-w-[140px] font-medium text-sm
                  ${exportComplete
                    ? 'bg-emerald-500 hover:bg-emerald-500 text-white'
                    : 'bg-amber-500 hover:bg-amber-600 text-black'
                  }
                `}
              >
                <AnimatePresence mode="wait">
                  {isExporting ? (
                    <motion.span
                      key="exporting"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-2"
                    >
                      <Loader2 className="size-3.5 animate-spin" />
                      Exporting...
                    </motion.span>
                  ) : exportComplete ? (
                    <motion.span
                      key="complete"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-2"
                    >
                      <Check className="size-3.5" />
                      Complete!
                    </motion.span>
                  ) : (
                    <motion.span
                      key="idle"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-2"
                    >
                      <Download className="size-3.5" />
                      Export LUT
                    </motion.span>
                  )}
                </AnimatePresence>
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
