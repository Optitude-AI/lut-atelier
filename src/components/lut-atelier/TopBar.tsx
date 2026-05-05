'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  Home,
  ImagePlus,
  Undo2,
  Redo2,
  Download,
  Grid3X3,
  Eye,
  EyeOff,
  Settings,
  ChevronDown,
  Layers,
  Sparkles,
  BookOpen,
  Spline,
  SlidersHorizontal,
  ShieldCheck,
  Bookmark,
  FolderOpen,
  Target,
  FileUp,
  Save,
  Palette,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { useAppStore, type ImageInfo, type AppStore } from '@/store/useAppStore';
import { useTheme } from 'next-themes';
import { useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

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

export default function TopBar() {
  const {
    viewMode,
    setViewMode,
    compareMode,
    setCompareMode,
    showScopes,
    setShowScopes,
    rightPanel,
    setRightPanel,
    isExportOpen,
    setIsExportOpen,
    globalIntensity,
    activeLutId,
    lutItems,
    currentImage,
  } = useAppStore();
  const { toast } = useToast();
  const setCurrentImage = useAppStore((s) => s.setCurrentImage);

  const handleOpenImage = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const info = await readImageFile(file);
        setCurrentImage(info);
        toast({
          title: 'Image imported',
          description: `${info.name} (${info.width}×${info.height})`,
        });
      } catch {
        toast({
          title: 'Failed to import image',
          description: 'Please select a valid image file.',
          variant: 'destructive',
        });
      }
    };
    input.click();
  }, [setCurrentImage, toast]);

  const handleSaveImage = useCallback(() => {
    if (!currentImage) {
      toast({ title: 'No image loaded', variant: 'destructive' });
      return;
    }
    // Create a temporary link to download the current image
    const link = document.createElement('a');
    link.href = currentImage.dataUrl;
    link.download = currentImage.name.replace(/\.[^.]+$/, '_processed.png');
    link.click();
    toast({ title: 'Image saved', description: 'Downloaded to your default folder.' });
  }, [currentImage, toast]);

  const togglePanel = useCallback((panel: AppStore['rightPanel']) => {
    setRightPanel(rightPanel === panel ? null : panel);
  }, [rightPanel, setRightPanel]);

  const activeLut = lutItems.find(l => l.id === activeLutId);

  const panelButtons: { id: AppStore['rightPanel']; icon: React.ElementType; label: string; shortcut?: string }[] = [
    { id: 'curves', icon: Spline, label: 'Curves Editor', shortcut: '⌘⇧C' },
    { id: 'channels', icon: SlidersHorizontal, label: 'Channels', shortcut: '⌘⇧H' },
    { id: 'masks', icon: ShieldCheck, label: 'Masks', shortcut: '⌘⇧M' },
    { id: 'lut-browser', icon: Layers, label: 'LUT Browser', shortcut: '⌘L' },
    { id: 'reference', icon: Sparkles, label: 'AI Reference Match', shortcut: '⌘R' },
    { id: 'look-manager', icon: Bookmark, label: 'Look Manager', shortcut: '⌘⇧B' },
    { id: 'color-targets', icon: Target, label: 'Color Targets' },
    { id: 'lut-import', icon: FileUp, label: 'LUT Import' },
    { id: 'batch', icon: FolderOpen, label: 'Batch Process' },
    { id: 'adjustments', icon: Settings, label: 'Adjustments', shortcut: '⌘⇧A' },
    { id: 'integrations', icon: Grid3X3, label: 'Integrations' },
  ];

  return (
    <TooltipProvider delayDuration={300}>
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center h-12 px-2 bg-zinc-950/95 backdrop-blur-md border-b border-zinc-800/80 gap-0.5"
      >
        {/* Logo */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 mr-1 text-zinc-300 hover:text-white"
          onClick={() => setViewMode('home')}
        >
          <Grid3X3 className="w-4 h-4 mr-1.5 text-amber-400" />
          <span className="text-sm font-semibold tracking-tight hidden sm:inline">LUT Atelier</span>
        </Button>

        <div className="w-px h-6 bg-zinc-800 mx-0.5" />

        {/* File operations */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-zinc-400 hover:text-white"
              onClick={handleOpenImage}
            >
              <ImagePlus className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Open Image</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-zinc-400 hover:text-white"
              onClick={handleSaveImage}
            >
              <Save className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Save Image</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-zinc-400 hover:text-white">
              <Undo2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Undo</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-zinc-400 hover:text-white">
              <Redo2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Redo</TooltipContent>
        </Tooltip>

        <div className="w-px h-6 bg-zinc-800 mx-0.5" />

        {/* Compare controls */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={compareMode !== 'off' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-8 px-2 text-zinc-400 hover:text-white"
                >
                  <Eye className="w-4 h-4 mr-1" />
                  <span className="text-xs hidden md:inline">Compare</span>
                  <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">Comparison Mode</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuItem onClick={() => setCompareMode('off')}>
              <EyeOff className="w-3.5 h-3.5 mr-2 text-zinc-400" />
              Off
              {compareMode === 'off' && <Badge variant="secondary" className="ml-auto text-[10px]">Active</Badge>}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCompareMode('split')}>
              <div className="w-3.5 h-3.5 mr-2 border-l-2 border-r-2 border-zinc-400 border-r-amber-400" />
              Split View
              {compareMode === 'split' && <Badge variant="secondary" className="ml-auto text-[10px]">Active</Badge>}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCompareMode('side-by-side')}>
              <Layers className="w-3.5 h-3.5 mr-2 text-zinc-400" />
              Side by Side
              {compareMode === 'side-by-side' && <Badge variant="secondary" className="ml-auto text-[10px]">Active</Badge>}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Scopes toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={showScopes ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 px-2 text-zinc-400 hover:text-white"
              onClick={() => setShowScopes(!showScopes)}
            >
              <BookOpen className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {showScopes ? 'Hide Scopes' : 'Show Scopes'}
          </TooltipContent>
        </Tooltip>

        <div className="w-px h-6 bg-zinc-800 mx-0.5" />

        {/* Right panel dropdown - shows most used + "More" */}
        <div className="hidden md:flex items-center gap-0.5">
          {/* Primary panels always visible */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={rightPanel === 'curves' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 px-2 text-zinc-400 hover:text-white"
                onClick={() => togglePanel('curves')}
              >
                <Spline className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">Curves</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={rightPanel === 'channels' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 px-2 text-zinc-400 hover:text-white"
                onClick={() => togglePanel('channels')}
              >
                <SlidersHorizontal className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">Channels</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={rightPanel === 'masks' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 px-2 text-zinc-400 hover:text-white"
                onClick={() => togglePanel('masks')}
              >
                <ShieldCheck className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">Masks</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={rightPanel === 'lut-browser' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 px-2 text-zinc-400 hover:text-white"
                onClick={() => togglePanel('lut-browser')}
              >
                <Layers className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">LUT Browser</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={rightPanel === 'reference' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 px-2 text-zinc-400 hover:text-white"
                onClick={() => togglePanel('reference')}
              >
                <Sparkles className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">AI Match</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={rightPanel === 'look-manager' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 px-2 text-zinc-400 hover:text-white"
                onClick={() => togglePanel('look-manager')}
              >
                <Bookmark className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">Looks</TooltipContent>
          </Tooltip>
        </div>

        {/* More panels dropdown for overflow */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={rightPanel && !['curves', 'channels', 'masks', 'lut-browser', 'reference', 'look-manager'].includes(rightPanel) ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-8 px-1.5 text-zinc-400 hover:text-white"
                >
                  <Settings className="w-4 h-4" />
                  <ChevronDown className="w-2.5 h-2.5 ml-0.5" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">More Panels</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel className="text-[10px] text-zinc-500 uppercase tracking-wider">Panels</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {panelButtons.map((panel) => {
              const Icon = panel.icon;
              return (
                <DropdownMenuItem
                  key={panel.id}
                  onClick={() => togglePanel(panel.id)}
                  className="flex items-center gap-2"
                >
                  <Icon className={`w-3.5 h-3.5 ${rightPanel === panel.id ? 'text-amber-400' : 'text-zinc-400'}`} />
                  <span className="text-sm">{panel.label}</span>
                  {panel.shortcut && (
                    <span className="ml-auto text-[10px] text-zinc-600">{panel.shortcut}</span>
                  )}
                  {rightPanel === panel.id && (
                    <Badge variant="secondary" className="ml-auto text-[10px] px-1">Active</Badge>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Active LUT indicator */}
        <AnimatePresence>
          {activeLut && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex items-center gap-2 mr-2"
            >
              <Badge
                variant="outline"
                className="text-[10px] px-2 py-0.5 border-amber-500/30 text-amber-300 bg-amber-500/5"
              >
                {activeLut.name}
              </Badge>
              <span className="text-[10px] text-zinc-500">{globalIntensity}%</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Export button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              className="h-8 px-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300"
              onClick={() => setIsExportOpen(true)}
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              <span className="text-xs hidden sm:inline">Export</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Export LUT / Preset</TooltipContent>
        </Tooltip>
      </motion.header>
    </TooltipProvider>
  );
}
