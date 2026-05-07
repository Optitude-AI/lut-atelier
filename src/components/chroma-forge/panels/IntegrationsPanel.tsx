'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layers,
  Camera,
  Aperture,
  ArrowRight,
  ExternalLink,
  Check,
  Loader2,
  Settings,
  ImagePlus,
  ArrowUpRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { toast } from 'sonner';

// --- Integration config ---
interface IntegrationStep {
  label: string;
  detail: string;
}

interface IntegrationConfig {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
  accentBorderLight: string;
  dotColor: string;
  steps: IntegrationStep[];
  buttons: {
    label: string;
    icon: React.ElementType;
    actionId: string;
  }[];
  note: string;
}

const integrations: IntegrationConfig[] = [
  {
    id: 'photoshop',
    title: 'Photoshop Integration',
    subtitle: 'Seamless round-trip color grading with Photoshop',
    icon: Layers,
    accentColor: 'text-amber-400',
    accentBg: 'bg-amber-500/10',
    accentBorder: 'border-amber-500/30',
    accentBorderLight: 'border-amber-500/15',
    dotColor: 'bg-amber-500',
    steps: [
      {
        label: 'Send from Photoshop',
        detail: 'Select your image in Photoshop, then use Edit In > Chroma Forge to send the current layer for grading.',
      },
      {
        label: 'Grade in Chroma Forge',
        detail: 'Apply your color adjustments using the A/B Grid, C/L Grid, curves, and other tools.',
      },
      {
        label: 'Send back as LUT',
        detail: 'Export as a .cube file and apply via Layer > New Adjustment Layer > Color Lookup.',
      },
    ],
    buttons: [
      {
        label: 'Send Image from PS',
        icon: ImagePlus,
        actionId: 'ps-send-image',
      },
      {
        label: 'Send LUT to PS',
        icon: ArrowUpRight,
        actionId: 'ps-send-lut',
      },
    ],
    note: 'Photoshop supports 3D LUT files via Color Lookup adjustment layers. The exported .cube file can be applied non-destructively with adjustable opacity.',
  },
  {
    id: 'lightroom',
    title: 'Lightroom / Camera Raw',
    subtitle: 'Create profiles and presets for Adobe Lightroom',
    icon: Camera,
    accentColor: 'text-emerald-400',
    accentBg: 'bg-emerald-500/10',
    accentBorder: 'border-emerald-500/30',
    accentBorderLight: 'border-emerald-500/15',
    dotColor: 'bg-emerald-500',
    steps: [
      {
        label: 'Export from Lightroom',
        detail: 'Right-click your image in Lightroom and choose Edit In > Chroma Forge to start editing.',
      },
      {
        label: 'Grade in Chroma Forge',
        detail: 'Fine-tune colors using the professional grading tools and real-time preview.',
      },
      {
        label: 'Import preset/profile',
        detail: 'Import the generated .xmp or .lrtemplate file into Lightroom via Edit > Presets > Import.',
      },
    ],
    buttons: [
      {
        label: 'Export from Lightroom',
        icon: ExternalLink,
        actionId: 'lr-export',
      },
      {
        label: 'Create LR Preset',
        icon: ArrowUpRight,
        actionId: 'lr-create-preset',
      },
    ],
    note: 'Camera Raw Profiles (.xmp) work with both Lightroom CC and Camera Raw in Photoshop. Lightroom Presets (.lrtemplate) are for Lightroom Classic only. Both preserve your RAW workflow.',
  },
  {
    id: 'captureone',
    title: 'Capture One Integration',
    subtitle: 'Configure as an external editor for Capture One Pro',
    icon: Aperture,
    accentColor: 'text-teal-400',
    accentBg: 'bg-teal-500/10',
    accentBorder: 'border-teal-500/30',
    accentBorderLight: 'border-teal-500/15',
    dotColor: 'bg-teal-500',
    steps: [
      {
        label: 'Configure external editor',
        detail: 'In Capture One, go to Edit > Preferences > External Editors and add Chroma Forge as an external application.',
      },
      {
        label: 'Grade in Chroma Forge',
        detail: 'Images sent from Capture One open directly in Chroma Forge for color grading.',
      },
      {
        label: 'Return to Capture One',
        detail: 'Save your edits and the graded image returns automatically as a TIFF variant in Capture One.',
      },
    ],
    buttons: [
      {
        label: 'Configure as External Editor',
        icon: Settings,
        actionId: 'c1-configure',
      },
      {
        label: 'Export for C1',
        icon: ArrowUpRight,
        actionId: 'c1-export',
      },
    ],
    note: 'Capture One Pro 23+ supports 3D LUT application via Styles. Export as .txt + .cube bundle for full compatibility with Capture One\'s LUT system.',
  },
];

// --- Simulated action handler ---
function useActionHandler() {
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const handleAction = (actionId: string, label: string) => {
    setActiveAction(actionId);

    // Simulate action with loading state
    setTimeout(() => {
      setActiveAction(null);
      toast.success(`${label} — Ready!`, {
        description: 'This is a simulated action. Connect the real integration to enable this feature.',
        duration: 3000,
      });
    }, 1200);
  };

  return { activeAction, handleAction };
}

export default function IntegrationsPanel() {
  const { activeAction, handleAction } = useActionHandler();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center size-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/20">
          <ExternalLink className="size-4 text-violet-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">
            Integrations
          </h2>
          <p className="text-xs text-zinc-500">
            Connect with your favorite photo editors
          </p>
        </div>
      </div>

      {/* Accordion */}
      <Accordion type="multiple" defaultValue={['photoshop']} className="space-y-2">
        {integrations.map((integration) => {
          const Icon = integration.icon;

          return (
            <AccordionItem
              key={integration.id}
              value={integration.id}
              className={`
                rounded-xl border overflow-hidden transition-colors
                ${integration.accentBorderLight} 
                bg-white/[0.02] hover:bg-white/[0.03]
                data-[state=open]:bg-white/[0.03]
              `}
            >
              {/* Custom trigger */}
              <AccordionTrigger className="px-4 py-3.5 hover:no-underline hover:bg-white/[0.02] rounded-xl">
                <div className="flex items-center gap-3">
                  <div className={`flex items-center justify-center size-9 rounded-lg ${integration.accentBg}`}>
                    <Icon className={`size-4.5 ${integration.accentColor}`} />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-medium text-white">
                      {integration.title}
                    </div>
                    <div className="text-[11px] text-zinc-500 leading-snug">
                      {integration.subtitle}
                    </div>
                  </div>
                </div>
              </AccordionTrigger>

              <AccordionContent className="px-4 pb-4">
                {/* Workflow Steps */}
                <div className="space-y-3 mb-5">
                  {integration.steps.map((step, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.08 }}
                      className="flex items-start gap-3"
                    >
                      {/* Step number */}
                      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                        <div
                          className={`flex items-center justify-center size-6 rounded-full ${integration.dotColor} text-[10px] font-bold text-black`}
                        >
                          {idx + 1}
                        </div>
                        {idx < integration.steps.length - 1 && (
                          <div className={`w-px h-5 bg-white/[0.08] ml-3`} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-zinc-200">
                          {step.label}
                        </p>
                        <p className="text-[11px] text-zinc-500 leading-relaxed mt-0.5">
                          {step.detail}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {integration.buttons.map((btn) => {
                    const BtnIcon = btn.icon;
                    const isLoading = activeAction === btn.actionId;

                    return (
                      <Button
                        key={btn.actionId}
                        variant="outline"
                        size="sm"
                        onClick={() => handleAction(btn.actionId, btn.label)}
                        disabled={isLoading}
                        className={`
                          h-8 text-xs font-medium gap-1.5
                          border-white/10 text-zinc-300 hover:text-white hover:bg-white/[0.06]
                          disabled:opacity-60
                          ${isLoading ? 'pointer-events-none' : ''}
                        `}
                      >
                        <AnimatePresence mode="wait">
                          {isLoading ? (
                            <motion.span
                              key="loading"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="flex items-center gap-1.5"
                            >
                              <Loader2 className="size-3 animate-spin" />
                              Connecting...
                            </motion.span>
                          ) : (
                            <motion.span
                              key="idle"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="flex items-center gap-1.5"
                            >
                              <BtnIcon className="size-3" />
                              {btn.label}
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </Button>
                    );
                  })}
                </div>

                {/* Note */}
                <div className={`rounded-lg ${integration.accentBg} border ${integration.accentBorderLight} p-3`}>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    {integration.note}
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* Bottom hint */}
      <div className="flex items-center gap-2 px-1">
        <ArrowRight className="size-3 text-zinc-600" />
        <p className="text-[11px] text-zinc-600">
          Click &ldquo;Send Image&rdquo; buttons to transfer photos between applications
        </p>
      </div>
    </div>
  );
}
