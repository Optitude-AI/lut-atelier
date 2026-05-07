---
Task ID: 1-a/1-b/1-c
Agent: Full-Stack Developer
Task: Implement 10 AB Grid improvements for Chroma Forge

Work Log:
- Read all source files: worklog.md, ABGrid.tsx (~925 lines), useAppStore.ts (~620 lines), lut-engine.ts (reference only)
- Updated useAppStore.ts with store-level changes (Feature 4, 6)
- Completely rewrote ABGrid.tsx with all 10 features

### Feature 1: Constrained Drag (Shift/Ctrl modifiers)
- Added tangential/radial projection in onPointerMove drag handler
- Shift = hue only (project onto tangential direction)
- Ctrl/Cmd = saturation only (project onto radial direction)
- Added `modifier` field to TooltipData; shows "HUE ONLY" / "SAT ONLY" in tooltip

### Feature 2: Pointer Events (Touch Support)
- Replaced all mouse events with pointer events: onPointerDown, onPointerMove, onPointerUp, onPointerLeave, onPointerCancel
- Added setPointerCapture in onPointerDown for reliable tracking
- Added releasePointerCapture in onPointerUp/onPointerLeave/onPointerCancel
- Added `touch-action: none` style to canvas container div
- Added onContextMenu to prevent context menu on long press
- Updated pointerXY to work with React.PointerEvent
- Global listeners use pointerup + pointercancel

### Feature 3: Undo/Redo
- Added undoStackRef and redoStackRef (max 50 entries each)
- Snapshot type: { offsetX, offsetY, pinned }[] for all 65 nodes
- On drag start (pointerdown on node), push snapshot to undoStack, clear redoStack
- Ctrl+Z = undo, Ctrl+Shift+Z / Ctrl+Y = redo
- Keyboard listener only fires when grid container contains the event target
- After undo/redo: restoreSnapshot calls syncToStore + sched

### Feature 4: 16-Branch Topology (65 nodes)
- Replaced 33-node mesh (4 rings × 8) with 65-node mesh (4 rings × 16)
- Ring offsets: C=0, R1=1, R2=17, R3=33, R4=49
- 176 connections (5 circumferential groups × 16 + 3 inter-ring groups × 32)
- 112 fill triangles (16 center sectors + 3 × 32 inter-ring)
- Updated generateDefaultABNodes() to use 16 hues × 3 sats = 48 store nodes
- Branch propagation in onMove uses 16 branches (0-15)

### Feature 5: Per-Node Falloff (Sigma Multiplier)
- Added sigmaMult field to MeshNode interface (default 1.0)
- Falloff formula: SIGMA * targetNode.sigmaMult used as effective sigma
- Ctrl+Scroll on hovered node adjusts sigmaMult (0.2 to 3.0, step 0.1)
- Uses native wheel event listener with { passive: false } for preventDefault
- Shows "σ ×N" in tooltip when sigmaMult != 1.0

### Feature 6: Store changes for anisotropic falloff
- Added abHueSigma: number and abSatSigma: number to AppSettings (defaults: 65, 65)
- Added sigmaMult: number, pinned: boolean, abHueSigma: number, abSatSigma: number to GridNode interface
- Updated generateDefaultABNodes() to include new fields
- Updated settings defaults

### Feature 7: Skin Tone Overlay
- Added skin tone arc overlay in drawBg after pixel hue wheel, before grid lines
- Covers 15° to 45° hue range with rgba(255,180,120,0.08) fill
- Includes "Skin Tones" label at 30° hue position

### Feature 8: Node Pinning
- Added pinned: boolean to MeshNode (default false)
- In drag handler, skip pinned nodes: `if (ns[i].pinned && i !== di) continue`
- Right-click (contextmenu) on hovered node toggles pinned state
- Visual indicator: small red filled diamond above pinned nodes
- Shows "PINNED" in tooltip when hovering pinned node
- Center node cannot be pinned

### Feature 9: Before/After Color Swatch on Selected Node
- After drawing nodes in drawOl, checks if selected node has non-zero offset
- Draws 10×8 split swatch: left half = original color (home position), right half = shifted color (current position)
- Uses hslToRgb to compute colors from hue/sat at home and current positions
- Positioned 14px right and 14px up from node center
- White border (0.5px) around swatch

### Feature 10: Spring Reset Animation
- Replaced instant offset reset with requestAnimationFrame-based spring animation
- Ease-out cubic curve: t = 1 - (1 - progress)^3, duration = 300ms
- Stores start offsets and node indices in springRef
- Cancel ongoing animation on new double-click, drag start, or resize
- Calls syncToStore + sched during animation frames
- Final syncToStore() after animation completes

Stage Summary:
- Modified 2 files: useAppStore.ts (MultiEdit, 4 edits), ABGrid.tsx (complete rewrite)
- All 10 features implemented and working
- Compilation clean (no new errors/warnings)
- Lint clean for both modified files
- Fixed React hooks ordering issue using schedFnRef pattern
- No changes to lut-engine.ts (reference only)
