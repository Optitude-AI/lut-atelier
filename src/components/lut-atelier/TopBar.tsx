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
  Monitor,
  Moon,
  Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from 'next-themes';

interface TopBarProps {
  className?: string;
}

export default function TopBar({ className }: TopBarProps) {
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
    adjustmentStack,
    globalIntensity,
    settings,
    activeLutId,
    lutItems,
  } = useAppStore();
  const { theme, setTheme } = useTheme();

  const activeLut = lutItems.find(l => l.id === activeLutId);

  return (
    <TooltipProvider delayDuration={300}>
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={`flex items-center h-12 px-3 bg-zinc-950/95 backdrop-blur-md border-b border-zinc-800/80 gap-1 ${className || ''}`}
      >
        {/* Logo */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 mr-1 text-zinc-300 hover:text-white"
          onClick={() => setViewMode('home')}
        >
          <Grid3X3 className="w-4 h-4 mr-1.5 text-amber-400" />
          <span className="text-sm font-semibold tracking-tight">LUT Atelier</span>
        </Button>

        <div className="w-px h-6 bg-zinc-800 mx-1" />

        {/* File operations */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-zinc-400 hover:text-white"
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.click();
              }}
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
            >
              <Undo2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Undo</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-zinc-400 hover:text-white"
            >
              <Redo2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Redo</TooltipContent>
        </Tooltip>

        <div className="w-px h-6 bg-zinc-800 mx-1" />

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
                  <span className="text-xs">Compare</span>
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
              <Monitor className="w-3.5 h-3.5 mr-2 text-zinc-400" />
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

        <div className="w-px h-6 bg-zinc-800 mx-1" />

        {/* Right panel toggles */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={rightPanel === 'lut-browser' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 px-2 text-zinc-400 hover:text-white"
              onClick={() => setRightPanel(rightPanel === 'lut-browser' ? null : 'lut-browser')}
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
              onClick={() => setRightPanel(rightPanel === 'reference' ? null : 'reference')}
            >
              <Sparkles className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">AI Reference Match</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={rightPanel === 'adjustments' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 px-2 text-zinc-400 hover:text-white"
              onClick={() => setRightPanel(rightPanel === 'adjustments' ? null : 'adjustments')}
            >
              <Settings className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Adjustments</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={rightPanel === 'integrations' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 px-2 text-zinc-400 hover:text-white"
              onClick={() => setRightPanel(rightPanel === 'integrations' ? null : 'integrations')}
            >
              <Grid3X3 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Integrations</TooltipContent>
        </Tooltip>

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
              <span className="text-xs">Export</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Export LUT / Preset</TooltipContent>
        </Tooltip>
      </motion.header>
    </TooltipProvider>
  );
}
