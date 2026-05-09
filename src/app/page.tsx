'use client';

import { ThemeProvider } from 'next-themes';
import HomeScreen from '@/components/lut-atelier/home/HomeScreen';
import Workspace from '@/components/lut-atelier/Workspace';
import { useAppStore } from '@/store/useAppStore';
import { AnimatePresence, motion } from 'framer-motion';

function AppContent() {
  const viewMode = useAppStore((s) => s.viewMode);

  return (
    <AnimatePresence mode="wait">
      {viewMode === 'home' ? (
        <motion.div
          key="home"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <HomeScreen />
        </motion.div>
      ) : (
        <motion.div
          key="workspace"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Workspace />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function Home() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" disableTransitionOnChange>
      <AppContent />
    </ThemeProvider>
  );
}

