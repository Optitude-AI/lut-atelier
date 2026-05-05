'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  PanelRightClose,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppStore } from '@/store/useAppStore';

import TopBar from './TopBar';
import ImageViewer from './ImageViewer';
import ABGrid from './grids/ABGrid';
import CLGrid from './grids/CLGrid';
import ScopesPanel from './scopes/ScopesPanel';
import LUTBrowser from './panels/LUTBrowser';
import ReferenceMatch from './panels/ReferenceMatch';
import AdjustmentStack from './panels/AdjustmentStack';
import ExportDialog from './panels/ExportDialog';
import IntegrationsPanel from './panels/IntegrationsPanel';

export default function Workspace() {
  const {
    rightPanel,
    setRightPanel,
    showScopes,
    activeGridType,
    setActiveGridType,
    showNodeHelpers,
    setShowNodeHelpers,
    globalIntensity,
    setGlobalIntensity,
  } = useAppStore();

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
        {/* Top Bar */}
        <TopBar />

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Center Panel - Image Viewer */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Image Viewer */}
            <div className="flex-1 relative overflow-hidden">
              <ImageViewer />
            </div>

            {/* Scopes Panel (bottom) */}
            <AnimatePresence>
              {showScopes && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 180, opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="border-t border-zinc-800/80 overflow-hidden"
                >
                  <ScopesPanel className="h-full" />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Bottom Bar - Global Controls */}
            <div className="h-11 flex items-center px-3 gap-3 bg-zinc-950/95 border-t border-zinc-800/80">
              {/* Grid Type Toggle */}
              <div className="flex items-center bg-zinc-900 rounded-lg p-0.5">
                <Button
                  variant={activeGridType === 'ab' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 px-2.5 text-[11px]"
                  onClick={() => setActiveGridType('ab')}
                >
                  A/B
                </Button>
                <Button
                  variant={activeGridType === 'cl' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 px-2.5 text-[11px]"
                  onClick={() => setActiveGridType('cl')}
                >
                  C/L
                </Button>
              </div>

              {/* Node Helpers Toggle */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={showNodeHelpers ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-6 px-2 text-zinc-400"
                    onClick={() => setShowNodeHelpers(!showNodeHelpers)}
                  >
                    <Eye className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[10px]">Show Node Helpers</TooltipContent>
              </Tooltip>

              <div className="w-px h-5 bg-zinc-800" />

              {/* Global Intensity Slider */}
              <div className="flex items-center gap-2 flex-1 max-w-xs">
                <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider whitespace-nowrap">Intensity</span>
                <Slider
                  value={[globalIntensity]}
                  onValueChange={(v) => setGlobalIntensity(v[0])}
                  min={0}
                  max={100}
                  step={1}
                  className="flex-1"
                />
                <span className="text-[11px] text-zinc-400 font-mono w-8 text-right">{globalIntensity}%</span>
              </div>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Quick color space badge */}
              <div className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider">
                sRGB · 16-bit
              </div>
            </div>
          </div>

          {/* Right Panel */}
          <AnimatePresence mode="wait">
            {rightPanel && (
              <motion.div
                key={rightPanel}
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 320, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="border-l border-zinc-800/80 overflow-hidden flex-shrink-0"
              >
                <div className="w-80 h-full flex flex-col bg-zinc-950/50">
                  {/* Panel Header */}
                  <div className="flex items-center justify-between h-10 px-3 border-b border-zinc-800/80 flex-shrink-0">
                    <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                      {rightPanel === 'lut-browser' && 'LUT Browser'}
                      {rightPanel === 'reference' && 'AI Reference Match'}
                      {rightPanel === 'adjustments' && 'Adjustments'}
                      {rightPanel === 'integrations' && 'Integrations'}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-zinc-500 hover:text-zinc-300"
                      onClick={() => setRightPanel(null)}
                    >
                      <PanelRightClose className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  {/* Panel Content */}
                  <div className="flex-1 overflow-hidden">
                    {rightPanel === 'lut-browser' && <LUTBrowser />}
                    {rightPanel === 'reference' && <ReferenceMatch />}
                    {rightPanel === 'adjustments' && <AdjustmentStack />}
                    {rightPanel === 'integrations' && <IntegrationsPanel />}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Grid Editor Panel (always visible on desktop) */}
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 360, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="border-l border-zinc-800/80 overflow-hidden flex-shrink-0 hidden lg:flex"
          >
            <div className="w-[360px] h-full flex flex-col bg-zinc-950/50">
              {/* Grid Header */}
              <div className="flex items-center justify-between h-10 px-3 border-b border-zinc-800/80 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                    {activeGridType === 'ab' ? 'A/B Hue–Saturation' : 'C/L Chroma–Luminance'}
                  </span>
                </div>
                <Tabs
                  value={activeGridType}
                  onValueChange={(v) => setActiveGridType(v as 'ab' | 'cl')}
                  className="hidden sm:block"
                >
                  <TabsList className="h-6 bg-zinc-900 p-0.5">
                    <TabsTrigger value="ab" className="h-5 px-2 text-[10px] data-[state=active]:bg-zinc-700">
                      A/B
                    </TabsTrigger>
                    <TabsTrigger value="cl" className="h-5 px-2 text-[10px] data-[state=active]:bg-zinc-700">
                      C/L
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {/* Grid Content */}
              <div className="flex-1 p-3 overflow-auto">
                <AnimatePresence mode="wait">
                  {activeGridType === 'ab' ? (
                    <motion.div
                      key="ab"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ABGrid />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="cl"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.2 }}
                    >
                      <CLGrid />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Export Dialog */}
        <ExportDialog />
      </div>
    </TooltipProvider>
  );
}
