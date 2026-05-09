---
Task ID: 1
Agent: main
Task: Restore Chroma Forge app visibility — dev server and page rendering

Work Log:
- Read page.tsx — confirmed it renders HomeScreen/Workspace with ThemeProvider
- Read HomeScreen.tsx — full hero page with "Chroma Forge" branding, feature cards, guided modes
- Read Workspace.tsx — full workspace layout with TopBar, ImageViewer, ABGrid/CLGrid, ScopesPanel, and 13+ right panels
- Read useAppStore.ts — Zustand store with viewMode defaulting to 'home' (correct)
- Found dev server was not running in sandbox environment
- Created keepalive.sh script to auto-restart dev server when sandbox kills it
- Started dev server successfully — port 3000 listening, GET / returned 200

Stage Summary:
- App code is intact and correct — page.tsx renders Chroma Forge HomeScreen by default
- Dev server running via keepalive.sh (PID 7867) at port 3000
- Analysed lut-engine.ts (1784 lines) for colour engine bug:
  - AB Grid correctly preserves OKLAB L (uses pxL in gamutMapOkLCh)
  - CL Grid correctly modifies L (by design: newL = pxL * (1 + lumShift/100))
  - Early exit returns original pixels when no changes active
  - Proper sRGB → linear → OKLAB → transform → linear → sRGB pipeline
  - The previously reported luminance corruption bug appears to already be fixed in current code
- Key remaining tasks: fix lint errors, UI polish
