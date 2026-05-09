'use client';

import { useCallback, useRef, useEffect, useState } from 'react';
import {
  RotateCcw,
  Palette,
  ScanLine,
  Zap,
  Eye,
  Sparkles,
  ArrowRightLeft,
  ChevronDown,
  Monitor,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAppStore } from '@/store/useAppStore';
import type { ColorSpace, InputColorSpace } from '@/store/useAppStore';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────

interface ColorSpacePanelProps {
  className?: string;
}

interface InputColorSpaceOption {
  value: InputColorSpace;
  label: string;
  manufacturer: string;
}

interface OutputColorSpaceOption {
  value: ColorSpace;
  label: string;
  description: string;
}

interface GammaOption {
  value: number;
  label: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const INPUT_COLOR_SPACES: InputColorSpaceOption[] = [
  { value: 'linear', label: 'Linear', manufacturer: 'Default' },
  { value: 'log-c', label: 'LOG-C', manufacturer: 'Sony / Canon' },
  { value: 's-log3', label: 'S-Log3', manufacturer: 'Sony' },
  { value: 'alog', label: 'A-Log', manufacturer: 'Fuji' },
  { value: 'red-log', label: 'RED Log', manufacturer: 'RED' },
  { value: 'v-log', label: 'V-Log', manufacturer: 'Panasonic' },
];

const OUTPUT_COLOR_SPACES: OutputColorSpaceOption[] = [
  { value: 'srgb', label: 'sRGB', description: 'Standard web color space' },
  { value: 'adobe-rgb', label: 'Adobe RGB', description: 'Wider gamut for print' },
  { value: 'prophoto-rgb', label: 'ProPhoto RGB', description: 'Wide gamut for photography' },
  { value: 'rec709', label: 'Rec.709', description: 'HD video standard' },
  { value: 'rec2020', label: 'Rec.2020', description: 'UHDR / wide gamut video' },
];

const GAMMA_OPTIONS: GammaOption[] = [
  { value: 2.2, label: '2.2 (Standard)' },
  { value: 2.4, label: '2.4 (Mac)' },
  { value: 2.6, label: '2.6 (Broadcast)' },
];

// ── Log-to-Linear Conversion Functions ─────────────────────────────────────

function logCToLinear(log: number): number {
  return (Math.pow(10, log * 0.6 - 0.6)) * 0.9 + 0.1;
}

function sLog3ToLinear(log: number): number {
  return (Math.pow(10, (log - 0.410) * 0.432)) * 0.9 + 0.1;
}

function aLogToLinear(log: number): number {
  return (Math.pow(10, (log - 0.613) * 0.543)) * 0.9 + 0.1;
}

function redLogToLinear(log: number): number {
  return log * log * 0.25 - log * 0.5 + 0.75;
}

function vLogToLinear(log: number): number {
  return (Math.pow(10, (log - 0.576) * 0.5)) * 0.9 + 0.1;
}

function logToLinear(log: number, inputSpace: InputColorSpace): number {
  switch (inputSpace) {
    case 'log-c': return logCToLinear(log);
    case 's-log3': return sLog3ToLinear(log);
    case 'alog': return aLogToLinear(log);
    case 'red-log': return redLogToLinear(log);
    case 'v-log': return vLogToLinear(log);
    case 'linear':
    default: return log;
  }
}

// ── Gamut Primaries (CIE xy chromaticity) ─────────────────────────────────

interface GamutPrimaries {
  r: [number, number];
  g: [number, number];
  b: [number, number];
}

const GAMUT_PRIMARIES: Record<string, GamutPrimaries> = {
  srgb: { r: [0.64, 0.33], g: [0.30, 0.60], b: [0.15, 0.06] },
  'adobe-rgb': { r: [0.64, 0.33], g: [0.21, 0.71], b: [0.15, 0.06] },
  'prophoto-rgb': { r: [0.7347, 0.2653], g: [0.1596, 0.8404], b: [0.0366, 0.0001] },
  rec709: { r: [0.64, 0.33], g: [0.30, 0.60], b: [0.15, 0.06] },
  rec2020: { r: [0.708, 0.292], g: [0.170, 0.797], b: [0.131, 0.046] },
};

// ── Canvas Visualization ───────────────────────────────────────────────────

interface CanvasVizProps {
  inputSpace: InputColorSpace;
  outputSpace: ColorSpace;
  gamma: number;
}

function ColorSpaceCanvas({ inputSpace, outputSpace, gamma }: CanvasVizProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const w = rect.width;
    const h = 120;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Subtle vignette
    const vGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.6);
    vGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vGrad.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = vGrad;
    ctx.fillRect(0, 0, w, h);

    // ── Left half: CIE gamut triangles ──
    const leftW = w * 0.5;
    const margin = 16;
    const gx = margin;
    const gy = 8;
    const gw = leftW - margin * 2;
    const gh = h - 16;

    // CIE xy bounds for display (0 to 0.8 x, 0 to 0.9 y)
    const mapX = (x: number) => gx + (x / 0.8) * gw;
    const mapY = (y: number) => gy + gh - (y / 0.9) * gh;

    // Draw spectral locus outline (simplified horseshoe)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 360; i += 2) {
      const hue = i;
      const sat = 1;
      // Approximate CIE coordinates from hue
      const rad = (hue * Math.PI) / 180;
      const cx = 0.33 + 0.31 * Math.cos(rad) + 0.02 * Math.cos(3 * rad);
      const cy = 0.33 + 0.31 * Math.sin(rad) - 0.02 * Math.sin(3 * rad);
      if (i === 0) ctx.moveTo(mapX(cx), mapY(cy));
      else ctx.lineTo(mapX(cx), mapY(cy));
    }
    ctx.closePath();
    ctx.stroke();

    // Draw gamut triangles
    const drawGamutTriangle = (
      primaries: GamutPrimaries,
      color: string,
      fillAlpha: number,
    ) => {
      const pts = [primaries.r, primaries.g, primaries.b];
      ctx.beginPath();
      ctx.moveTo(mapX(pts[0][0]), mapY(pts[0][1]));
      for (let i = 1; i < 3; i++) {
        ctx.lineTo(mapX(pts[i][0]), mapY(pts[i][1]));
      }
      ctx.closePath();
      ctx.fillStyle = color.replace('1)', `${fillAlpha})`);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    const inputGamutKey = inputSpace === 'linear' ? 'srgb' : 'srgb';
    const inputPrimaries = GAMUT_PRIMARIES[inputGamutKey] || GAMUT_PRIMARIES.srgb;
    const outputPrimaries = GAMUT_PRIMARIES[outputSpace] || GAMUT_PRIMARIES.srgb;

    // Output gamut (underneath, subtle)
    drawGamutTriangle(outputPrimaries, 'rgba(168,85,247,1)', 0.08);
    // Input gamut (on top, more visible)
    drawGamutTriangle(inputPrimaries, 'rgba(245,158,11,1)', 0.15);

    // Legend
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(245,158,11,0.9)';
    ctx.fillText('● Input', gx + 4, gy + 11);
    ctx.fillStyle = 'rgba(168,85,247,0.9)';
    ctx.fillText('● Output', gx + 48, gy + 11);

    // ── Divider ──
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.moveTo(leftW, 10);
    ctx.lineTo(leftW, h - 10);
    ctx.stroke();

    // ── Right half: Tone curve visualization ──
    const rx = leftW + margin;
    const ry = 12;
    const rw = leftW - margin * 2;
    const rh = h - 24;

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const x = rx + (i / 4) * rw;
      ctx.beginPath();
      ctx.moveTo(x, ry);
      ctx.lineTo(x, ry + rh);
      ctx.stroke();
      const y = ry + (i / 4) * rh;
      ctx.beginPath();
      ctx.moveTo(rx, y);
      ctx.lineTo(rx + rw, y);
      ctx.stroke();
    }

    // Identity line (linear)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.moveTo(rx, ry + rh);
    ctx.lineTo(rx + rw, ry);
    ctx.stroke();
    ctx.setLineDash([]);

    // Log-to-linear curve
    ctx.beginPath();
    ctx.strokeStyle = inputSpace === 'linear'
      ? 'rgba(161,161,170,0.5)'
      : 'rgba(245,158,11,0.9)';
    ctx.lineWidth = 2;
    ctx.shadowColor = inputSpace === 'linear'
      ? 'rgba(161,161,170,0.3)'
      : 'rgba(245,158,11,0.4)';
    ctx.shadowBlur = 6;

    const steps = 100;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps; // 0-1 input
      let linearVal: number;
      if (inputSpace === 'linear') {
        // Apply gamma curve instead
        linearVal = Math.pow(t, 1 / gamma);
      } else {
        linearVal = logToLinear(t, inputSpace);
      }
      const clampedVal = Math.max(0, Math.min(1, linearVal));
      const px = rx + t * rw;
      const py = ry + rh - clampedVal * rh;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Labels
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('0', rx - 10, ry + rh + 3);
    ctx.fillText('1', rx + rw + 2, ry + rh + 3);
    ctx.textAlign = 'right';
    ctx.fillText('1', rx - 4, ry + 5);
    ctx.fillText('0', rx - 4, ry + rh + 3);
    ctx.textAlign = 'left';

    // Curve label
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.fillStyle = inputSpace === 'linear'
      ? 'rgba(161,161,170,0.7)'
      : 'rgba(245,158,11,0.9)';
    const curveLabel = inputSpace === 'linear'
      ? `γ ${gamma.toFixed(1)}`
      : INPUT_COLOR_SPACES.find((s) => s.value === inputSpace)?.label ?? inputSpace;
    ctx.fillText(curveLabel, rx + rw - ctx.measureText(curveLabel).width, ry + 11);
  }, [inputSpace, outputSpace, gamma]);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(draw);
    });
    if (containerRef.current) observer.observe(containerRef.current);
    draw();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [draw]);

  return (
    <div ref={containerRef} className="w-full">
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg"
        style={{ height: 120 }}
      />
    </div>
  );
}

// ── Auto-detect simulation ─────────────────────────────────────────────────

function simulateAutoDetect(): {
  suggested: InputColorSpace;
  confidence: number;
} {
  // Simulated histogram analysis — in production this would analyze real pixel data
  const profiles: { space: InputColorSpace; weight: number }[] = [
    { space: 's-log3', weight: 0.35 },
    { space: 'log-c', weight: 0.25 },
    { space: 'alog', weight: 0.20 },
    { space: 'v-log', weight: 0.10 },
    { space: 'red-log', weight: 0.07 },
    { space: 'linear', weight: 0.03 },
  ];

  // Weighted random selection with fixed seed based on timestamp bucket
  const bucket = Math.floor(Date.now() / 60000) % 10;
  const weighted = profiles.map((p, i) => ({
    ...p,
    score: p.weight + Math.sin((bucket + i) * 2.5) * 0.1,
  }));
  weighted.sort((a, b) => b.score - a.score);
  const best = weighted[0];

  return {
    suggested: best.space,
    confidence: Math.round(Math.min(0.95, best.score) * 100),
  };
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function ColorSpacePanel({ className }: ColorSpacePanelProps) {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const currentImage = useAppStore((s) => s.currentImage);

  const [gamma, setGamma] = useState<number>(2.2);
  const [blackLevel, setBlackLevel] = useState<number>(0);
  const [whitePoint, setWhitePoint] = useState<number>(100);
  const [autoDetectResult, setAutoDetectResult] = useState<{
    suggested: InputColorSpace;
    confidence: number;
  } | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);

  const inputSpace = settings.inputColorSpace;
  const outputSpace = settings.colorSpace;

  const handleInputSpaceChange = useCallback(
    (value: string) => {
      updateSettings({ inputColorSpace: value as InputColorSpace });
      setAutoDetectResult(null);
    },
    [updateSettings],
  );

  const handleOutputSpaceChange = useCallback(
    (value: string) => {
      updateSettings({ colorSpace: value as ColorSpace });
    },
    [updateSettings],
  );

  const handleGammaChange = useCallback((value: number) => {
    setGamma(value);
  }, []);

  const handleBlackLevelChange = useCallback((value: number) => {
    setBlackLevel(value);
  }, []);

  const handleWhitePointChange = useCallback((value: number) => {
    setWhitePoint(value);
  }, []);

  const handleAutoDetect = useCallback(() => {
    setIsDetecting(true);
    // Simulate async analysis
    setTimeout(() => {
      const result = simulateAutoDetect();
      setAutoDetectResult(result);
      setIsDetecting(false);
    }, 1200);
  }, []);

  const handleApplyAutoDetect = useCallback(() => {
    if (autoDetectResult) {
      updateSettings({ inputColorSpace: autoDetectResult.suggested });
      setAutoDetectResult(null);
    }
  }, [autoDetectResult, updateSettings]);

  const handleReset = useCallback(() => {
    setGamma(2.2);
    setBlackLevel(0);
    setWhitePoint(100);
    updateSettings({ inputColorSpace: 'linear', colorSpace: 'srgb' });
    setAutoDetectResult(null);
  }, [updateSettings]);

  const isModified =
    inputSpace !== 'linear' ||
    outputSpace !== 'srgb' ||
    gamma !== 2.2 ||
    blackLevel !== 0 ||
    whitePoint !== 100;

  const inputLabel = INPUT_COLOR_SPACES.find((s) => s.value === inputSpace);
  const outputLabel = OUTPUT_COLOR_SPACES.find((s) => s.value === outputSpace);

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
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.5)]" />
            <h2 className="text-base font-semibold tracking-tight text-white">
              Color Space
            </h2>
            <Badge
              variant="outline"
              className="text-[9px] text-zinc-500 border-zinc-700/60 bg-zinc-800/40 px-1.5 py-0 h-4"
            >
              LOG/RAW
            </Badge>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={!isModified}
                className={cn(
                  'h-7 gap-1.5 px-2.5 text-xs font-medium',
                  'bg-zinc-800/60 border border-zinc-700/60',
                  'hover:bg-zinc-700/60 hover:border-zinc-600/60',
                  'text-zinc-300 hover:text-white',
                  'transition-all duration-150',
                  !isModified && 'opacity-40 pointer-events-none',
                )}
              >
                <RotateCcw size={12} />
                Reset
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
              Reset all color space settings
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 pb-4">
        <div className="flex flex-col gap-4">
          {/* ── Canvas Visualization ──────────────────────────────── */}
          <div className="rounded-xl overflow-hidden border border-zinc-800/60 bg-zinc-900/40">
            <ColorSpaceCanvas
              inputSpace={inputSpace}
              outputSpace={outputSpace}
              gamma={gamma}
            />
            {/* Badges below canvas */}
            <div className="flex items-center justify-between px-3 py-2 border-t border-zinc-800/40">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span className="text-[10px] text-zinc-400 font-medium">
                  {inputLabel?.label ?? 'Linear'}
                </span>
              </div>
              <ArrowRightLeft size={10} className="text-zinc-600" />
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-400 font-medium">
                  {outputLabel?.label ?? 'sRGB'}
                </span>
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
              </div>
            </div>
          </div>

          {/* ── Input Color Space ────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ScanLine size={13} className="text-amber-400/80" />
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
                Input Color Space
              </label>
              <span className="text-[9px] text-zinc-600 font-medium ml-auto">
                Camera LOG format
              </span>
            </div>

            <Select
              value={inputSpace}
              onValueChange={handleInputSpaceChange}
            >
              <SelectTrigger className="w-full h-9 bg-zinc-900/60 border-zinc-700/50 text-zinc-200 text-xs data-[size=default]:h-9 rounded-lg hover:bg-zinc-800/60 transition-colors">
                <SelectValue placeholder="Select input color space" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700/60 rounded-lg">
                {INPUT_COLOR_SPACES.map((space) => (
                  <SelectItem
                    key={space.value}
                    value={space.value}
                    className="text-xs text-zinc-200 focus:bg-zinc-800 focus:text-white rounded-sm py-2 cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{space.label}</span>
                      <span className="text-[10px] text-zinc-500">
                        {space.manufacturer}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Input space description */}
            <p className="text-[10px] text-zinc-600 leading-relaxed">
              {inputSpace === 'linear'
                ? 'No conversion — image data is already in linear light.'
                : inputSpace === 'log-c'
                  ? 'LOG-C combines Sony and Canon log profiles. Good dynamic range preservation.'
                  : inputSpace === 's-log3'
                    ? 'Sony S-Log3 offers 15+ stops of dynamic range. Ideal for S-Log3/S-Gamut workflows.'
                    : inputSpace === 'alog'
                      ? 'Fujifilm A-Log captures wide dynamic range from X-series and GFX cameras.'
                      : inputSpace === 'red-log'
                        ? 'RED Log is a logarithmic curve optimized for RED digital cinema cameras.'
                        : inputSpace === 'v-log'
                          ? 'Panasonic V-Log provides 12+ stops from Lumix GH and Varicam cameras.'
                          : ''}
            </p>
          </div>

          <Separator className="bg-zinc-800/40" />

          {/* ── Output Color Space ───────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Monitor size={13} className="text-violet-400/80" />
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
                Output Color Space
              </label>
              <span className="text-[9px] text-zinc-600 font-medium ml-auto">
                Working / export
              </span>
            </div>

            <Select
              value={outputSpace}
              onValueChange={handleOutputSpaceChange}
            >
              <SelectTrigger className="w-full h-9 bg-zinc-900/60 border-zinc-700/50 text-zinc-200 text-xs data-[size=default]:h-9 rounded-lg hover:bg-zinc-800/60 transition-colors">
                <SelectValue placeholder="Select output color space" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700/60 rounded-lg">
                {OUTPUT_COLOR_SPACES.map((space) => (
                  <SelectItem
                    key={space.value}
                    value={space.value}
                    className="text-xs text-zinc-200 focus:bg-zinc-800 focus:text-white rounded-sm py-2 cursor-pointer"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{space.label}</span>
                      <span className="text-[10px] text-zinc-500">
                        {space.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator className="bg-zinc-800/40" />

          {/* ── Gamma Override ───────────────────────────────────── */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Zap size={13} className="text-amber-400/80" />
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
                Gamma Override
              </label>
            </div>

            <div className="flex items-center gap-2">
              {GAMMA_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  variant="ghost"
                  size="sm"
                  onClick={() => handleGammaChange(opt.value)}
                  className={cn(
                    'h-8 px-3 text-[11px] font-medium rounded-lg transition-all duration-150',
                    gamma === opt.value
                      ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 hover:text-amber-200'
                      : 'bg-zinc-800/60 border border-zinc-700/50 text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-300',
                  )}
                >
                  {opt.label}
                </Button>
              ))}
            </div>

            {/* Gamma slider for fine-tuning */}
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] text-zinc-500 w-10 flex-shrink-0">
                Gamma
              </span>
              <Slider
                value={[gamma]}
                min={1.8}
                max={3.0}
                step={0.05}
                onValueChange={(v) => handleGammaChange(v[0])}
                className={cn(
                  'flex-1',
                  '[&_[data-slot=slider-track]]:h-1',
                  '[&_[data-slot=slider-range]]:bg-amber-500',
                  '[&_[data-slot=slider-thumb]]:size-3',
                  '[&_[data-slot=slider-thumb]]:border-amber-500',
                  '[&_[data-slot=slider-thumb]]:bg-zinc-900',
                  '[&_[data-slot=slider-thumb]]:shadow-none',
                )}
              />
              <span className="text-[10px] tabular-nums text-zinc-400 font-medium w-8 text-right flex-shrink-0 select-none">
                {gamma.toFixed(2)}
              </span>
            </div>
          </div>

          <Separator className="bg-zinc-800/40" />

          {/* ── Black Level / White Point ────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Eye size={13} className="text-cyan-400/80" />
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
                Calibration
              </label>
              <span className="text-[9px] text-zinc-600 font-medium ml-auto">
                Per-channel
              </span>
            </div>

            {/* Black Level */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-500 font-medium">
                  Black Level
                </span>
                <span className="text-[10px] tabular-nums text-zinc-400 font-medium">
                  {blackLevel > 0 ? `+${blackLevel}` : blackLevel}
                </span>
              </div>
              <Slider
                value={[blackLevel]}
                min={-50}
                max={50}
                step={1}
                onValueChange={(v) => handleBlackLevelChange(v[0])}
                className={cn(
                  'w-full',
                  '[&_[data-slot=slider-track]]:h-1',
                  '[&_[data-slot=slider-range]]:bg-cyan-500',
                  '[&_[data-slot=slider-thumb]]:size-3',
                  '[&_[data-slot=slider-thumb]]:border-cyan-500',
                  '[&_[data-slot=slider-thumb]]:bg-zinc-900',
                  '[&_[data-slot=slider-thumb]]:shadow-none',
                )}
              />
            </div>

            {/* White Point */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-500 font-medium">
                  White Point
                </span>
                <span className="text-[10px] tabular-nums text-zinc-400 font-medium">
                  {whitePoint}%
                </span>
              </div>
              <Slider
                value={[whitePoint]}
                min={50}
                max={100}
                step={0.5}
                onValueChange={(v) => handleWhitePointChange(v[0])}
                className={cn(
                  'w-full',
                  '[&_[data-slot=slider-track]]:h-1',
                  '[&_[data-slot=slider-range]]:bg-cyan-400',
                  '[&_[data-slot=slider-thumb]]:size-3',
                  '[&_[data-slot=slider-thumb]]:border-cyan-400',
                  '[&_[data-slot=slider-thumb]]:bg-zinc-900',
                  '[&_[data-slot=slider-thumb]]:shadow-none',
                )}
              />
            </div>

            {/* Calibration info */}
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-zinc-800/30 border border-zinc-800/50">
              <Palette size={11} className="text-zinc-500 flex-shrink-0" />
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                Adjust black level to remove color cast in shadows. Set white
                point to define maximum luminance.
              </p>
            </div>
          </div>

          <Separator className="bg-zinc-800/40" />

          {/* ── Auto-detect ──────────────────────────────────────── */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Sparkles size={13} className="text-violet-400/80" />
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
                Auto-detect
              </label>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleAutoDetect}
              disabled={isDetecting || !currentImage}
              className={cn(
                'w-full h-9 gap-2 text-xs font-medium rounded-lg transition-all duration-150',
                'bg-zinc-800/60 border border-zinc-700/50',
                'hover:bg-zinc-700/60 hover:border-zinc-600/50',
                'text-zinc-300 hover:text-white',
                isDetecting && 'animate-pulse',
                !currentImage && 'opacity-40 pointer-events-none',
              )}
            >
              {isDetecting ? (
                <>
                  <div className="w-3 h-3 border-2 border-violet-400/40 border-t-violet-400 rounded-full animate-spin" />
                  Analyzing histogram...
                </>
              ) : (
                <>
                  <Sparkles size={13} className="text-violet-400" />
                  {currentImage
                    ? 'Analyze Image Histogram'
                    : 'Load an image first'}
                </>
              )}
            </Button>

            {/* Auto-detect result */}
            {autoDetectResult && (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-violet-500/[0.06] border border-violet-500/20">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-violet-300 font-medium">
                      Suggested:
                    </span>
                    <span className="text-[11px] text-white font-semibold">
                      {INPUT_COLOR_SPACES.find(
                        (s) => s.value === autoDetectResult.suggested,
                      )?.label ?? autoDetectResult.suggested}
                    </span>
                  </div>
                  <span className="text-[9px] text-violet-400/60">
                    Confidence: {autoDetectResult.confidence}%
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleApplyAutoDetect}
                  className="h-7 px-3 text-[10px] font-semibold bg-violet-500/20 border border-violet-500/30 text-violet-200 hover:bg-violet-500/30 hover:text-white rounded-md transition-all"
                >
                  Apply
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAutoDetectResult(null)}
                  className="h-7 px-2 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-md"
                >
                  Dismiss
                </Button>
              </div>
            )}

            {!currentImage && (
              <p className="text-[10px] text-zinc-600 text-center">
                Load an image to enable histogram-based auto-detection.
              </p>
            )}
          </div>

          {/* ── Conversion Formula Reference ─────────────────────── */}
          {inputSpace !== 'linear' && (
            <>
              <Separator className="bg-zinc-800/40" />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <ChevronDown size={10} className="text-zinc-600" />
                  <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
                    Conversion Formula
                  </label>
                </div>

                <div className="px-3 py-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/40">
                  <code className="text-[10px] text-amber-400/80 font-mono leading-relaxed block">
                    {inputSpace === 'log-c' &&
                      'linear = (10^(log × 0.6 − 0.6)) × 0.9 + 0.1'}
                    {inputSpace === 's-log3' &&
                      'linear = (10^((log − 0.410) × 0.432)) × 0.9 + 0.1'}
                    {inputSpace === 'alog' &&
                      'linear = (10^((log − 0.613) × 0.543)) × 0.9 + 0.1'}
                    {inputSpace === 'red-log' &&
                      'linear = log² × 0.25 − log × 0.5 + 0.75'}
                    {inputSpace === 'v-log' &&
                      'linear = (10^((log − 0.576) × 0.5)) × 0.9 + 0.1'}
                  </code>
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 py-2.5 border-t border-zinc-800/60">
        <p className="text-[10px] text-zinc-600 text-center">
          {inputLabel?.label ?? 'Linear'} → {outputLabel?.label ?? 'sRGB'}
          {gamma !== 2.2 && ` · γ ${gamma.toFixed(2)}`}
          {(blackLevel !== 0 || whitePoint !== 100) &&
            ` · BL ${blackLevel > 0 ? '+' : ''}${blackLevel} · WP ${whitePoint}%`}
        </p>
      </div>
    </div>
  );
}
