import { create } from 'zustand';

// Types
export type ViewMode = 'home' | 'workspace';
export type GridType = 'ab' | 'cl';
export type CompareMode = 'off' | 'split' | 'side-by-side' | 'three-way';
export type ScopeType = 'histogram' | 'vectorscope' | 'parade' | 'waveform';

export interface GridNode {
  id: string;
  hue: number;      // 0-360
  saturation: number; // 0-100
  lightness: number;  // 0-100
  offsetX: number;    // -100 to 100
  offsetY: number;    // -100 to 100
  originalOffsetX?: number;
  originalOffsetY?: number;
}

export interface CLGridNode {
  id: string;
  chroma: number;    // 0-100
  luminance: number; // 0-100
  offsetX: number;   // -100 to 100
  offsetY: number;   // -100 to 100
}

export interface AdjustmentLayer {
  id: string;
  name: string;
  type: 'ai-match' | 'grid-ab' | 'grid-cl' | 'curves' | 'selective-color' | 'hue-sat' | 'levels';
  enabled: boolean;
  opacity: number;
  params: Record<string, unknown>;
}

export interface LUTItem {
  id: string;
  name: string;
  tags: string[];
  category: 'warm' | 'cool' | 'cinematic' | 'pastel' | 'high-contrast' | 'film' | 'portrait' | 'wedding' | 'landscape' | 'bw';
  thumbnail?: string;
  createdAt: string;
  intensity: number;
  favorite: boolean;
}

export interface ReferenceImage {
  id: string;
  name: string;
  url: string;
  dominantColors: string[];
  palette: string[];
}

export interface ImageInfo {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
}

export interface AppSettings {
  colorSpace: 'srgb' | 'adobe-rgb' | 'prophoto-rgb';
  bitDepth: '8' | '16' | '32';
  gridSize: 17 | 33 | 65;
  showSkinToneLine: boolean;
  showGamutWarnings: boolean;
}

export interface AppStore {
  // Navigation
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  // Current image
  currentImage: ImageInfo | null;
  setCurrentImage: (info: ImageInfo | null) => void;
  imageHistory: ImageInfo[];

  // Compare
  compareMode: CompareMode;
  setCompareMode: (mode: CompareMode) => void;
  splitPosition: number;
  setSplitPosition: (pos: number) => void;

  // Grid editors
  activeGridType: GridType;
  setActiveGridType: (type: GridType) => void;
  abNodes: GridNode[];
  setABNodes: (nodes: GridNode[]) => void;
  updateABNode: (id: string, offsetX: number, offsetY: number) => void;
  clNodes: CLGridNode[];
  setCLNodes: (nodes: CLGridNode[]) => void;
  updateCLNode: (id: string, offsetX: number, offsetY: number) => void;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  showNodeHelpers: boolean;
  setShowNodeHelpers: (show: boolean) => void;

  // LUT browser
  lutItems: LUTItem[];
  setLUTItems: (items: LUTItem[]) => void;
  activeLutId: string | null;
  setActiveLutId: (id: string | null) => void;
  lutIntensity: number;
  setLutIntensity: (intensity: number) => void;
  lutFilterTags: string[];
  setLutFilterTags: (tags: string[]) => void;

  // Reference matching
  referenceImages: ReferenceImage[];
  setReferenceImages: (images: ReferenceImage[]) => void;
  activeReferenceId: string | null;
  setActiveReferenceId: (id: string | null) => void;
  matchInfluence: {
    contrast: number;
    saturation: number;
    colorBalance: number;
    skinTones: number;
    luminanceRollOff: number;
  };
  setMatchInfluence: (influence: Partial<AppStore['matchInfluence']>) => void;
  isMatching: boolean;
  setIsMatching: (matching: boolean) => void;

  // Adjustment stack
  adjustmentStack: AdjustmentLayer[];
  addAdjustment: (layer: AdjustmentLayer) => void;
  removeAdjustment: (id: string) => void;
  toggleAdjustment: (id: string) => void;
  updateAdjustmentOpacity: (id: string, opacity: number) => void;
  updateAdjustmentName: (id: string, name: string) => void;
  reorderAdjustments: (layers: AdjustmentLayer[]) => void;

  // Scopes
  activeScopeType: ScopeType;
  setActiveScopeType: (type: ScopeType) => void;
  showScopes: boolean;
  setShowScopes: (show: boolean) => void;

  // Settings
  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => void;

  // UI state
  rightPanel: 'lut-browser' | 'reference' | 'adjustments' | 'export' | 'integrations' | null;
  setRightPanel: (panel: AppStore['rightPanel']) => void;
  leftPanel: 'tools' | 'adjustments' | 'history' | null;
  setLeftPanel: (panel: AppStore['leftPanel']) => void;
  isExportOpen: boolean;
  setIsExportOpen: (open: boolean) => void;

  // Global LUT intensity
  globalIntensity: number;
  setGlobalIntensity: (intensity: number) => void;
}

// Generate default AB grid nodes (17x17 grid subset for key hues/saturations)
function generateDefaultABNodes(): GridNode[] {
  const nodes: GridNode[] = [];
  const keyHues = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  const keySats = [25, 50, 75];

  for (const hue of keyHues) {
    for (const sat of keySats) {
      nodes.push({
        id: `ab-${hue}-${sat}`,
        hue,
        saturation: sat,
        lightness: 50,
        offsetX: 0,
        offsetY: 0,
        originalOffsetX: 0,
        originalOffsetY: 0,
      });
    }
  }
  return nodes;
}

function generateDefaultCLNodes(): CLGridNode[] {
  const nodes: CLGridNode[] = [];
  const keyChroma = [10, 25, 40, 55, 70, 85];
  const keyLum = [10, 25, 40, 55, 70, 85];

  for (const chroma of keyChroma) {
    for (const lum of keyLum) {
      nodes.push({
        id: `cl-${chroma}-${lum}`,
        chroma,
        luminance: lum,
        offsetX: 0,
        offsetY: 0,
      });
    }
  }
  return nodes;
}

// Sample LUTs for the browser
const sampleLUTs: LUTItem[] = [
  { id: '1', name: 'Golden Hour', tags: ['warm', 'portrait', 'wedding'], category: 'warm', createdAt: '2024-01-15', intensity: 100, favorite: true },
  { id: '2', name: 'Teal & Orange', tags: ['cinematic', 'high-contrast', 'portrait'], category: 'cinematic', createdAt: '2024-01-20', intensity: 100, favorite: true },
  { id: '3', name: 'Film Fade', tags: ['film', 'pastel', 'wedding'], category: 'film', createdAt: '2024-02-01', intensity: 100, favorite: false },
  { id: '4', name: 'Arctic Blue', tags: ['cool', 'landscape'], category: 'cool', createdAt: '2024-02-10', intensity: 100, favorite: false },
  { id: '5', name: 'Matte Noir', tags: ['bw', 'high-contrast', 'cinematic'], category: 'bw', createdAt: '2024-02-15', intensity: 100, favorite: true },
  { id: '6', name: 'Vintage Rose', tags: ['warm', 'pastel', 'portrait'], category: 'pastel', createdAt: '2024-03-01', intensity: 100, favorite: false },
  { id: '7', name: 'Desert Sun', tags: ['warm', 'landscape', 'wedding'], category: 'warm', createdAt: '2024-03-05', intensity: 100, favorite: false },
  { id: '8', name: 'Midnight', tags: ['cool', 'cinematic', 'high-contrast'], category: 'cool', createdAt: '2024-03-10', intensity: 100, favorite: false },
  { id: '9', name: 'Soft Peach', tags: ['warm', 'pastel', 'portrait'], category: 'portrait', createdAt: '2024-03-15', intensity: 100, favorite: true },
  { id: '10', name: 'Chrome', tags: ['bw', 'high-contrast'], category: 'bw', createdAt: '2024-03-20', intensity: 100, favorite: false },
  { id: '11', name: 'Autumn Harvest', tags: ['warm', 'landscape'], category: 'warm', createdAt: '2024-04-01', intensity: 100, favorite: false },
  { id: '12', name: 'Frost', tags: ['cool', 'pastel', 'portrait'], category: 'cool', createdAt: '2024-04-05', intensity: 100, favorite: false },
];

export const useAppStore = create<AppStore>((set) => ({
  // Navigation
  viewMode: 'home',
  setViewMode: (mode) => set({ viewMode: mode }),

  // Current image
  currentImage: null,
  setCurrentImage: (info) => set((state) => ({
    currentImage: info,
    imageHistory: info ? [info, ...state.imageHistory.filter(h => h.dataUrl !== info.dataUrl)].slice(0, 20) : state.imageHistory,
  })),
  imageHistory: [],

  // Compare
  compareMode: 'off',
  setCompareMode: (mode) => set({ compareMode: mode }),
  splitPosition: 50,
  setSplitPosition: (pos) => set({ splitPosition: pos }),

  // Grid editors
  activeGridType: 'ab',
  setActiveGridType: (type) => set({ activeGridType: type }),
  abNodes: generateDefaultABNodes(),
  setABNodes: (nodes) => set({ abNodes: nodes }),
  updateABNode: (id, offsetX, offsetY) => set((state) => ({
    abNodes: state.abNodes.map(n => n.id === id ? { ...n, offsetX, offsetY } : n),
  })),
  clNodes: generateDefaultCLNodes(),
  setCLNodes: (nodes) => set({ clNodes: nodes }),
  updateCLNode: (id, offsetX, offsetY) => set((state) => ({
    clNodes: state.clNodes.map(n => n.id === id ? { ...n, offsetX, offsetY } : n),
  })),
  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  showNodeHelpers: true,
  setShowNodeHelpers: (show) => set({ showNodeHelpers: show }),

  // LUT browser
  lutItems: sampleLUTs,
  setLUTItems: (items) => set({ lutItems: items }),
  activeLutId: null,
  setActiveLutId: (id) => set({ activeLutId: id }),
  lutIntensity: 100,
  setLutIntensity: (intensity) => set({ lutIntensity: intensity }),
  lutFilterTags: [],
  setLutFilterTags: (tags) => set({ lutFilterTags: tags }),

  // Reference matching
  referenceImages: [],
  setReferenceImages: (images) => set({ referenceImages: images }),
  activeReferenceId: null,
  setActiveReferenceId: (id) => set({ activeReferenceId: id }),
  matchInfluence: {
    contrast: 70,
    saturation: 80,
    colorBalance: 60,
    skinTones: 90,
    luminanceRollOff: 50,
  },
  setMatchInfluence: (influence) => set((state) => ({
    matchInfluence: { ...state.matchInfluence, ...influence },
  })),
  isMatching: false,
  setIsMatching: (matching) => set({ isMatching: matching }),

  // Adjustment stack
  adjustmentStack: [],
  addAdjustment: (layer) => set((state) => ({
    adjustmentStack: [...state.adjustmentStack, layer],
  })),
  removeAdjustment: (id) => set((state) => ({
    adjustmentStack: state.adjustmentStack.filter(l => l.id !== id),
  })),
  toggleAdjustment: (id) => set((state) => ({
    adjustmentStack: state.adjustmentStack.map(l =>
      l.id === id ? { ...l, enabled: !l.enabled } : l
    ),
  })),
  updateAdjustmentOpacity: (id, opacity) => set((state) => ({
    adjustmentStack: state.adjustmentStack.map(l =>
      l.id === id ? { ...l, opacity } : l
    ),
  })),
  updateAdjustmentName: (id, name) => set((state) => ({
    adjustmentStack: state.adjustmentStack.map(l =>
      l.id === id ? { ...l, name } : l
    ),
  })),
  reorderAdjustments: (layers) => set({ adjustmentStack: layers }),

  // Scopes
  activeScopeType: 'histogram',
  setActiveScopeType: (type) => set({ activeScopeType: type }),
  showScopes: true,
  setShowScopes: (show) => set({ showScopes: show }),

  // Settings
  settings: {
    colorSpace: 'srgb',
    bitDepth: '16',
    gridSize: 33,
    showSkinToneLine: true,
    showGamutWarnings: true,
  },
  updateSettings: (settings) => set((state) => ({
    settings: { ...state.settings, ...settings },
  })),

  // UI state
  rightPanel: null,
  setRightPanel: (panel) => set({ rightPanel: panel }),
  leftPanel: null,
  setLeftPanel: (panel) => set({ leftPanel: panel }),
  isExportOpen: false,
  setIsExportOpen: (open) => set({ isExportOpen: open }),

  // Global intensity
  globalIntensity: 100,
  setGlobalIntensity: (intensity) => set({ globalIntensity: intensity }),
}));
