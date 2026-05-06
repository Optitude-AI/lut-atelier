'use client';

import { useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Upload,
  Image,
  Sparkles,
  Layers,
  Camera,
  Film,
  Palette,
  ArrowRight,
  Clock,
  Star,
  FolderOpen,
  Monitor,
  Cpu,
  Zap,
  Grid3X3,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAppStore, type ImageInfo } from '@/store/useAppStore';
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

const featureCards = [
  {
    icon: Grid3X3,
    title: 'A/B Hue Grid',
    description: 'Precisely bend hue and saturation with an interactive grid editor.',
    gradient: 'from-amber-500/20 to-orange-600/20',
    iconColor: 'text-amber-400',
  },
  {
    icon: SlidersHorizontal,
    title: 'C/L Chroma-Luminance',
    description: 'Control chroma vs luminance curves for tonal precision.',
    gradient: 'from-emerald-500/20 to-teal-600/20',
    iconColor: 'text-emerald-400',
  },
  {
    icon: Sparkles,
    title: 'AI Reference Match',
    description: 'Load a reference photo and let AI propose the initial grade.',
    gradient: 'from-rose-500/20 to-pink-600/20',
    iconColor: 'text-rose-400',
  },
  {
    icon: Palette,
    title: 'LUT Browser',
    description: 'Browse, preview, and organize your LUT library with thumbnails.',
    gradient: 'from-violet-500/20 to-purple-600/20',
    iconColor: 'text-violet-400',
  },
  {
    icon: Layers,
    title: 'Non-Destructive Stack',
    description: 'Build looks as editable adjustment layers, bake to LUT later.',
    gradient: 'from-cyan-500/20 to-blue-600/20',
    iconColor: 'text-cyan-400',
  },
  {
    icon: Camera,
    title: 'Adobe & C1 Integration',
    description: 'Seamless round-trip with Photoshop, Lightroom, and Capture One.',
    gradient: 'from-teal-500/20 to-green-600/20',
    iconColor: 'text-teal-400',
  },
];

const guidedModes = [
  { icon: Film, label: 'Film-Style Look', desc: 'Create a film look from a reference' },
  { icon: Palette, label: 'Convert LR Preset', desc: 'Turn a Lightroom preset into a LUT' },
  { icon: Star, label: 'Skin-Friendly Portrait', desc: 'Build a LUT that protects skin tones' },
  { icon: Image, label: 'Match Reference', desc: 'AI-match colors from any photo' },
];

const recentLooks = [
  { name: 'Golden Hour', category: 'Warm', time: '2 hours ago' },
  { name: 'Teal & Orange', category: 'Cinematic', time: 'Yesterday' },
  { name: 'Film Fade', category: 'Film', time: '3 days ago' },
  { name: 'Matte Noir', category: 'B&W', time: 'Last week' },
];

export default function HomeScreen() {
  const { setViewMode, setActiveLutId, setCurrentImage, lutItems } = useAppStore();
  const { toast } = useToast();

  const handleOpenDemo = () => {
    setViewMode('workspace');
    // Don't auto-activate any LUT — start with clean/no-filter view
    setActiveLutId(null);
  };

  const handleImportPhoto = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const info = await readImageFile(file);
        setCurrentImage(info);
        setViewMode('workspace');
        setActiveLutId(null); // Start with no LUT filter
        toast({
          title: 'Image imported',
          description: `${info.name} (${info.width}×${info.height})`,
        });
      } catch {
        toast({
          title: 'Failed to import',
          description: 'Please select a valid image file.',
          variant: 'destructive',
        });
      }
    };
    input.click();
  }, [setCurrentImage, setViewMode, setActiveLutId, toast]);

  const handleGuidedMode = (mode: string) => {
    setViewMode('workspace');
    toast({
      title: `Starting: ${mode}`,
      description: 'Guided mode activated. Follow the on-screen instructions.',
    });
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-950/40 via-zinc-950 to-violet-950/30" />
        <div className="absolute inset-0">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-6xl mx-auto px-6 py-20 lg:py-32">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="text-center"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm mb-8">
              <Cpu className="w-4 h-4" />
              AI-Powered Color Science
            </div>

            <h1 className="text-5xl lg:text-7xl font-bold tracking-tight mb-6">
              <span className="bg-gradient-to-r from-amber-300 via-orange-200 to-rose-300 bg-clip-text text-transparent">
                LUT Atelier
              </span>
            </h1>

            <p className="text-xl lg:text-2xl text-zinc-400 max-w-3xl mx-auto mb-4 leading-relaxed">
              Next-generation color grading for still photographers.
              <br />
              <span className="text-zinc-300">Precision grids. AI matching. Seamless integration.</span>
            </p>

            <p className="text-sm text-zinc-500 mb-10">
              Photoshop · Lightroom · Camera Raw · Capture One
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button
                onClick={handleOpenDemo}
                size="lg"
                className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white px-8 h-12 text-base shadow-lg shadow-amber-500/20"
              >
                Open Workspace
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 px-8 h-12 text-base"
                onClick={handleImportPhoto}
              >
                <Upload className="w-4 h-4 mr-2" />
                Import Photo
              </Button>
            </div>
          </motion.div>

          {/* Tech badges */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="flex flex-wrap items-center justify-center gap-6 mt-16 text-xs text-zinc-500"
          >
            <div className="flex items-center gap-1.5">
              <Monitor className="w-3.5 h-3.5" />
              Windows & macOS
            </div>
            <div className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              GPU Accelerated
            </div>
            <div className="flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" />
              On-Device AI
            </div>
            <div className="flex items-center gap-1.5">
              <Grid3X3 className="w-3.5 h-3.5" />
              16/32-bit Pipeline
            </div>
          </motion.div>
        </div>
      </section>

      {/* Feature Cards */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mb-12"
        >
          <h2 className="text-2xl font-bold text-zinc-100 mb-2">Core Features</h2>
          <p className="text-zinc-400">Everything you need for professional color grading.</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {featureCards.map((card, index) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1, duration: 0.5 }}
            >
              <Card className="bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 transition-all duration-300 hover:shadow-lg hover:shadow-black/20 h-full cursor-pointer group"
                onClick={handleOpenDemo}
              >
                <CardHeader className="pb-3">
                  <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br ${card.gradient} mb-3`}>
                    <card.icon className={`w-5 h-5 ${card.iconColor}`} />
                  </div>
                  <CardTitle className="text-base text-zinc-100 group-hover:text-white transition-colors">
                    {card.title}
                  </CardTitle>
                  <CardDescription className="text-zinc-400 text-sm">
                    {card.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Guided Modes */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mb-8"
        >
          <h2 className="text-2xl font-bold text-zinc-100 mb-2">Quick Start Guides</h2>
          <p className="text-zinc-400">Step-by-step workflows to get you grading fast.</p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {guidedModes.map((mode, index) => (
            <motion.div
              key={mode.label}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
            >
              <Card
                className="bg-zinc-900/50 border-zinc-800 hover:border-amber-500/30 transition-all cursor-pointer group"
                onClick={() => handleGuidedMode(mode.label)}
              >
                <CardContent className="p-5">
                  <mode.icon className="w-6 h-6 text-zinc-400 group-hover:text-amber-400 transition-colors mb-3" />
                  <h3 className="text-sm font-semibold text-zinc-200 mb-1">{mode.label}</h3>
                  <p className="text-xs text-zinc-500">{mode.desc}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Recent Looks */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-zinc-100 mb-2">Recent Looks</h2>
            <p className="text-zinc-400">Jump back into your latest work.</p>
          </div>
          <Button variant="ghost" className="text-zinc-400 hover:text-zinc-200" onClick={handleOpenDemo}>
            <FolderOpen className="w-4 h-4 mr-2" />
            Browse All
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {recentLooks.map((look, index) => (
            <motion.div
              key={look.name}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.08 }}
            >
              <Card
                className="bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 transition-all cursor-pointer group overflow-hidden"
                onClick={handleOpenDemo}
              >
                <div className="h-28 bg-gradient-to-br from-zinc-800 to-zinc-900 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-amber-600/20 via-zinc-900 to-violet-600/20 group-hover:from-amber-600/30 group-hover:to-violet-600/30 transition-all" />
                </div>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-medium text-zinc-200">{look.name}</h3>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-zinc-800 text-zinc-400">
                      {look.category}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-zinc-500">
                    <Clock className="w-3 h-3" />
                    {look.time}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50 mt-16">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Grid3X3 className="w-4 h-4" />
            <span className="font-medium text-zinc-400">LUT Atelier</span>
            <span>· Built for Photographers</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-zinc-600">
            <span>v1.0.0</span>
            <span>·</span>
            <span>Stills Only</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
