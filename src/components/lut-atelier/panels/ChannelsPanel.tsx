'use client';

import { useCallback } from 'react';
import {
  RotateCcw,
  Sun,
  CircleDot,
  Moon,
  ArrowDownUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAppStore } from '@/store/useAppStore';
import type { ChannelData } from '@/store/useAppStore';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────

interface ChannelsPanelProps {
  className?: string;
}

interface ChannelConfig {
  key: string;
  label: string;
  accentColor: string;       // border-left color
  accentBg: string;          // subtle bg tint
  accentRange: string;       // slider range color
  accentDot: string;         // dot shadow color
  accentText: string;        // text/icon color
  thumbBorder: string;       // slider thumb border
}

// ── Channel Configuration ──────────────────────────────────────────────────

const CHANNEL_CONFIGS: ChannelConfig[] = [
  {
    key: 'master',
    label: 'Master',
    accentColor: 'border-l-zinc-400',
    accentBg: 'bg-zinc-400/[0.06]',
    accentRange: 'bg-zinc-400',
    accentDot: 'shadow-[0_0_6px_rgba(161,161,170,0.5)]',
    accentText: 'text-zinc-300',
    thumbBorder: 'border-zinc-400',
  },
  {
    key: 'r',
    label: 'Red',
    accentColor: 'border-l-red-500',
    accentBg: 'bg-red-500/[0.06]',
    accentRange: 'bg-red-500',
    accentDot: 'shadow-[0_0_6px_rgba(239,68,68,0.5)]',
    accentText: 'text-red-400',
    thumbBorder: 'border-red-500',
  },
  {
    key: 'g',
    label: 'Green',
    accentColor: 'border-l-green-500',
    accentBg: 'bg-green-500/[0.06]',
    accentRange: 'bg-green-500',
    accentDot: 'shadow-[0_0_6px_rgba(34,197,94,0.5)]',
    accentText: 'text-green-400',
    thumbBorder: 'border-green-500',
  },
  {
    key: 'b',
    label: 'Blue',
    accentColor: 'border-l-blue-500',
    accentBg: 'bg-blue-500/[0.06]',
    accentRange: 'bg-blue-500',
    accentDot: 'shadow-[0_0_6px_rgba(59,130,246,0.5)]',
    accentText: 'text-blue-400',
    thumbBorder: 'border-blue-500',
  },
];

const DEFAULT_CHANNEL_DATA: ChannelData = {
  enabled: true,
  gain: 0,
  gamma: 1.0,
  lift: 0,
  offset: 0,
};

// ── Slider Row ─────────────────────────────────────────────────────────────

interface ChannelSliderProps {
  label: string;
  icon: React.ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  accentRange: string;
  thumbBorder: string;
  onChange: (val: number) => void;
  disabled: boolean;
}

function ChannelSlider({
  label,
  icon,
  value,
  min,
  max,
  step,
  displayValue,
  accentRange,
  thumbBorder,
  onChange,
  disabled,
}: ChannelSliderProps) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 w-[88px] flex-shrink-0">
            <span className="text-zinc-500 flex-shrink-0">{icon}</span>
            <span className="text-[11px] font-medium text-zinc-400 truncate">
              {label}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
          {label}
        </TooltipContent>
      </Tooltip>

      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        disabled={disabled}
        className={cn(
          'flex-1 [&_[data-slot=slider-track]]:h-1',
          `[&_[data-slot=slider-range]]:${accentRange}`,
          '[&_[data-slot=slider-thumb]]:size-3',
          `[&_[data-slot=slider-thumb]]:${thumbBorder}`,
          '[&_[data-slot=slider-thumb]]:bg-zinc-900',
          '[&_[data-slot=slider-thumb]]:shadow-none',
          '[&_[data-slot=slider-thumb]]:hover:bg-zinc-800',
          disabled && 'opacity-40',
        )}
      />

      <span
        className={cn(
          'text-[10px] tabular-nums w-[38px] text-right flex-shrink-0 select-none font-medium',
          disabled ? 'text-zinc-600' : 'text-zinc-400',
        )}
      >
        {displayValue}
      </span>
    </div>
  );
}

// ── Channel Section ────────────────────────────────────────────────────────

interface ChannelSectionProps {
  config: ChannelConfig;
  data: ChannelData;
  onUpdate: (key: string, data: Partial<ChannelData>) => void;
}

function ChannelSection({ config, data, onUpdate }: ChannelSectionProps) {
  const handleSliderChange = useCallback(
    (field: keyof ChannelData) => (val: number) => {
      onUpdate(config.key, { [field]: val });
    },
    [config.key, onUpdate],
  );

  return (
    <AccordionItem
      value={config.key}
      className={cn(
        'border-l-[3px] rounded-lg overflow-hidden',
        'bg-zinc-900/40',
        config.accentColor,
      )}
    >
      <AccordionTrigger
        className={cn(
          'px-3 py-2.5 hover:no-underline hover:bg-white/[0.02] transition-colors',
          '[&[data-state=open]>svg]:rotate-180',
        )}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              'w-2 h-2 rounded-full',
              config.accentRange,
              data.enabled ? config.accentDot : 'opacity-30',
            )}
          />
          <span className={cn('text-xs font-semibold', config.accentText)}>
            {config.label}
          </span>
          {!data.enabled && (
            <span className="text-[9px] text-zinc-600 font-medium uppercase tracking-wider">
              Off
            </span>
          )}
        </div>
      </AccordionTrigger>

      <AccordionContent className="px-3 pb-3 pt-0">
        <div className="flex flex-col gap-0.5 mt-1">
          {/* Gain */}
          <ChannelSlider
            label="Gain"
            icon={<Sun size={12} />}
            value={data.gain}
            min={-100}
            max={100}
            step={1}
            displayValue={`${data.gain > 0 ? '+' : ''}${data.gain}`}
            accentRange={config.accentRange}
            thumbBorder={config.thumbBorder}
            onChange={handleSliderChange('gain')}
            disabled={!data.enabled}
          />

          {/* Gamma */}
          <ChannelSlider
            label="Gamma"
            icon={<CircleDot size={12} />}
            value={data.gamma}
            min={0.1}
            max={5.0}
            step={0.1}
            displayValue={data.gamma.toFixed(1)}
            accentRange={config.accentRange}
            thumbBorder={config.thumbBorder}
            onChange={handleSliderChange('gamma')}
            disabled={!data.enabled}
          />

          {/* Lift */}
          <ChannelSlider
            label="Lift"
            icon={<Moon size={12} />}
            value={data.lift}
            min={-100}
            max={100}
            step={1}
            displayValue={`${data.lift > 0 ? '+' : ''}${data.lift}`}
            accentRange={config.accentRange}
            thumbBorder={config.thumbBorder}
            onChange={handleSliderChange('lift')}
            disabled={!data.enabled}
          />

          {/* Offset */}
          <ChannelSlider
            label="Offset"
            icon={<ArrowDownUp size={12} />}
            value={data.offset}
            min={-100}
            max={100}
            step={1}
            displayValue={`${data.offset > 0 ? '+' : ''}${data.offset}`}
            accentRange={config.accentRange}
            thumbBorder={config.thumbBorder}
            onChange={handleSliderChange('offset')}
            disabled={!data.enabled}
          />
        </div>

        {/* Channel enable switch */}
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-zinc-800/60">
          <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
            Enable Channel
          </span>
          <Switch
            checked={data.enabled}
            onCheckedChange={(checked) =>
              onUpdate(config.key, { enabled: checked })
            }
            className={cn(
              'data-[state=checked]:bg-zinc-600 data-[state=unchecked]:bg-zinc-800',
              'data-[state=checked]:border-zinc-500',
            )}
          />
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function ChannelsPanel({ className }: ChannelsPanelProps) {
  const channelData = useAppStore((s) => s.channelData);
  const updateChannel = useAppStore((s) => s.updateChannel);
  const resetChannels = useAppStore((s) => s.resetChannels);

  const hasModifications = useCallback(() => {
    for (const config of CHANNEL_CONFIGS) {
      const data = channelData[config.key];
      if (!data) continue;
      if (
        data.gain !== DEFAULT_CHANNEL_DATA.gain ||
        data.gamma !== DEFAULT_CHANNEL_DATA.gamma ||
        data.lift !== DEFAULT_CHANNEL_DATA.lift ||
        data.offset !== DEFAULT_CHANNEL_DATA.offset
      ) {
        return true;
      }
    }
    return false;
  }, [channelData]);

  const canReset = hasModifications();

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
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 shadow-[0_0_6px_rgba(161,161,170,0.5)]" />
            <h2 className="text-base font-semibold tracking-tight text-white">
              Channels
            </h2>
            <span className="text-[10px] text-zinc-500 tabular-nums font-medium bg-zinc-800/60 px-1.5 py-0.5 rounded-full">
              RGB
            </span>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetChannels}
                disabled={!canReset}
                className={cn(
                  'h-7 gap-1.5 px-2.5 text-xs font-medium',
                  'bg-zinc-800/60 border border-zinc-700/60',
                  'hover:bg-zinc-700/60 hover:border-zinc-600/60',
                  'text-zinc-300 hover:text-white',
                  'transition-all duration-150',
                  !canReset && 'opacity-40 pointer-events-none',
                )}
              >
                <RotateCcw size={12} />
                Reset
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-300">
              Reset all channels to defaults
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ── Channel Accordion ─────────────────────────────────────── */}
      <ScrollArea className="flex-1 px-3 pb-4">
        <Accordion
          type="multiple"
          defaultValue={['master', 'r', 'g', 'b']}
          className="flex flex-col gap-2"
        >
          {CHANNEL_CONFIGS.map((config) => {
            const data = channelData[config.key];
            if (!data) return null;

            return (
              <ChannelSection
                key={config.key}
                config={config}
                data={data}
                onUpdate={updateChannel}
              />
            );
          })}
        </Accordion>
      </ScrollArea>

      {/* ── Footer hint ────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 py-2.5 border-t border-zinc-800/60">
        <p className="text-[10px] text-zinc-600 text-center">
          Gain: highlights &middot; Gamma: midtones &middot; Lift: shadows &middot; Offset: global shift
        </p>
      </div>
    </div>
  );
}
