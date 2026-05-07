import { create } from 'zustand';

// Types
export type ViewMode = 'home' | 'workspace';
export type GridType = 'ab' | 'cl';
export type CompareMode = 'off' | 'split' | 'side-by-side' | 'three-way';
export type ScopeType = 'histogram' | 'vectorscope' | 'parade' | 'waveform';
export type CurveChannel = 'master' | 'r' | 'g' | 'b' | 'luminance';
export type CurveType = 'custom' | 's-curve' | 'contrast' | 'fade' | 'linear-contrast' | 'negative' | 'cross-process' | 'bleach-bypass';
export type ColorSpace = 'srgb' | 'adobe-rgb' | 'prophoto-rgb' | 'rec709' | 'rec2020' | 'log-c' | 's-log3' | 'alog';
export type InputColorSpace = 'linear' | 'log-c' | 's-log3' | 'alog' | 'red-log' | 'v-log';
export type MaskType = 'luminance' | 'color-range' | 'hue-range' | 'saturation-range';
export type BatchStatus = 'idle' | 'processing' | 'completed' | 'error';

export interface GridNode {
  id: string;
  hue: number;
  saturation: number;
  lightness: number;
  offsetX: number;
  offsetY: number;
  originalOffsetX?: number;
  originalOffsetY?: number;
  sigmaMult: number;
  pinned: boolean;
  abHueSigma: number;
  abSatSigma: number;
}

export interface CLGridNode {
  id: string;
  chroma: number;
  luminance: number;
  offsetX: number;
  offsetY: number;
}

export interface CurvePoint {
  id: string;
  x: number; // 0-255 input
  y: number; // 0-255 output
}

export interface CurveData {
  channel: CurveChannel;
  type: CurveType;
  points: CurvePoint[];
  isLocked: boolean;
}

export interface ChannelData {
  enabled: boolean;
  gain: number;      // -100 to 100
  gamma: number;     // 0.1 to 5.0
  lift: number;      // -100 to 100
  offset: number;    // -100 to 100
}

export interface MaskData {
  id: string;
  name: string;
  type: MaskType;
  enabled: boolean;
  invert: boolean;
  feather: number;   // 0-100
  opacity: number;   // 0-100
  params: Record<string, number>;
}

export interface ColorTarget {
  id: string;
  sourceColor: [number, number, number]; // RGB
  targetColor: [number, number, number]; // RGB
  tolerance: number; // 0-100
  strength: number;  // 0-100
}

export interface BatchItem {
  id: string;
  file: File;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  preview?: string;
}

export interface ImportedLUT {
  id: string;
  name: string;
  format: 'cube' | 'hald';
  size: number;      // grid size (e.g., 33 for 33x33x33)
  data: number[][][][]; // [R][G][B] -> [R_out, G_out, B_out]
  thumbnail?: string;
}

export interface AdjustmentLayer {
  id: string;
  name: string;
  type: 'ai-match' | 'grid-ab' | 'grid-cl' | 'curves' | 'selective-color' | 'hue-sat' | 'levels' | 'channel' | 'mask' | 'lut-import' | 'color-target';
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

export interface SavedLook {
  id: string;
  name: string;
  description?: string;
  category: string;
  thumbnail?: string;
  favorite: boolean;
  data: LookData;
  createdAt: string;
  updatedAt: string;
}

export interface LookData {
  curves: CurveData[];
  channels: ChannelData;
  abNodes: GridNode[];
  clNodes: CLGridNode[];
  masks: MaskData[];
  globalIntensity: number;
  colorSpace: ColorSpace;
  inputColorSpace: InputColorSpace;
}

export interface ImageInfo {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
}

export interface AppSettings {
  colorSpace: ColorSpace;
  inputColorSpace: InputColorSpace;
  bitDepth: '8' | '16' | '32';
  gridSize: 17 | 33 | 65 | 129;
  max3DLUTSize: 17 | 33 | 65 | 129;
  showSkinToneLine: boolean;
  showGamutWarnings: boolean;
  curveResolution: number;
  interpolationMode: 'linear' | 'cubic' | 'smoothstep';
  abHueSigma: number;
  abSatSigma: number;
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

  // Curves
  curveData: CurveData[];
  setCurveData: (data: CurveData[]) => void;
  updateCurvePoints: (channel: CurveChannel, points: CurvePoint[]) => void;
  updateCurveType: (channel: CurveChannel, type: CurveType) => void;
  updateCurvePoint: (channel: CurveChannel, pointId: string, x: number, y: number) => void;
  addCurvePoint: (channel: CurveChannel, x: number, y: number) => void;
  removeCurvePoint: (channel: CurveChannel, pointId: string) => void;
  resetCurve: (channel: CurveChannel) => void;

  // Channels
  channelData: Record<string, ChannelData>;
  updateChannel: (channel: string, data: Partial<ChannelData>) => void;
  resetChannels: () => void;

  // Masks
  masks: MaskData[];
  addMask: (mask: MaskData) => void;
  removeMask: (id: string) => void;
  updateMask: (id: string, data: Partial<MaskData>) => void;
  toggleMask: (id: string) => void;

  // Color Targets
  colorTargets: ColorTarget[];
  addColorTarget: (target: ColorTarget) => void;
  removeColorTarget: (id: string) => void;
  updateColorTarget: (id: string, data: Partial<ColorTarget>) => void;

  // LUT browser
  lutItems: LUTItem[];
  setLUTItems: (items: LUTItem[]) => void;
  activeLutId: string | null;
  setActiveLutId: (id: string | null) => void;
  lutIntensity: number;
  setLutIntensity: (intensity: number) => void;
  lutFilterTags: string[];
  setLutFilterTags: (tags: string[]) => void;

  // Imported LUTs
  importedLUTs: ImportedLUT[];
  addImportedLUT: (lut: ImportedLUT) => void;
  removeImportedLUT: (id: string) => void;
  activeImportedLutId: string | null;
  setActiveImportedLutId: (id: string | null) => void;

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

  // Saved Looks
  savedLooks: SavedLook[];
  setSavedLooks: (looks: SavedLook[]) => void;
  addSavedLook: (look: SavedLook) => void;
  removeSavedLook: (id: string) => void;
  toggleLookFavorite: (id: string) => void;

  // Batch Processing
  batchItems: BatchItem[];
  addBatchItems: (items: BatchItem[]) => void;
  removeBatchItem: (id: string) => void;
  updateBatchItem: (id: string, data: Partial<BatchItem>) => void;
  clearBatchItems: () => void;
  batchStatus: BatchStatus;
  setBatchStatus: (status: BatchStatus) => void;

  // Settings
  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => void;

  // UI state
  rightPanel: 'lut-browser' | 'reference' | 'adjustments' | 'export' | 'integrations' | 'curves' | 'channels' | 'masks' | 'look-manager' | 'batch' | 'color-targets' | 'lut-import' | 'color-space' | null;
  setRightPanel: (panel: AppStore['rightPanel']) => void;
  leftPanel: 'tools' | 'adjustments' | 'history' | null;
  setLeftPanel: (panel: AppStore['leftPanel']) => void;
  isExportOpen: boolean;
  setIsExportOpen: (open: boolean) => void;

  // Graded image URL (for live scopes)
  gradedUrl: string | null;
  setGradedUrl: (url: string | null) => void;

  // Global LUT intensity
  globalIntensity: number;
  setGlobalIntensity: (intensity: number) => void;

  // Volume
  volume: number;
  setVolume: (vol: number) => void;
}

// ─── Helper Functions ───

function generateDefaultABNodes(): GridNode[] {
  const nodes: GridNode[] = [];
  const keyHues = [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5, 180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5];
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
        sigmaMult: 1.0,
        pinned: false,
        abHueSigma: 0,
        abSatSigma: 0,
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

function generateDefaultCurves(): CurveData[] {
  const channels: CurveChannel[] = ['master', 'r', 'g', 'b', 'luminance'];
  return channels.map((channel) => ({
    channel,
    type: 'custom' as CurveType,
    points: [
      { id: `${channel}-0`, x: 0, y: 0 },
      { id: `${channel}-255`, x: 255, y: 255 },
    ],
    isLocked: false,
  }));
}

function generateDefaultChannels(): Record<string, ChannelData> {
  return {
    master: { enabled: true, gain: 0, gamma: 1.0, lift: 0, offset: 0 },
    r: { enabled: true, gain: 0, gamma: 1.0, lift: 0, offset: 0 },
    g: { enabled: true, gain: 0, gamma: 1.0, lift: 0, offset: 0 },
    b: { enabled: true, gain: 0, gamma: 1.0, lift: 0, offset: 0 },
  };
}

// ─── Sample LUTs ───

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

// ─── Store ───

export const useAppStore = create<AppStore>((set, get) => ({
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

  // Curves
  curveData: generateDefaultCurves(),
  setCurveData: (data) => set({ curveData: data }),
  updateCurvePoints: (channel, points) => set((state) => ({
    curveData: state.curveData.map(c => c.channel === channel ? { ...c, points, type: 'custom' } : c),
  })),
  updateCurveType: (channel, type) => set((state) => ({
    curveData: state.curveData.map(c => c.channel === channel ? { ...c, type } : c),
  })),
  updateCurvePoint: (channel, pointId, x, y) => set((state) => ({
    curveData: state.curveData.map(c => c.channel === channel ? {
      ...c,
      type: 'custom',
      points: c.points.map(p => p.id === pointId ? { ...p, x, y } : p),
    } : c),
  })),
  addCurvePoint: (channel, x, y) => set((state) => ({
    curveData: state.curveData.map(c => c.channel === channel ? {
      ...c,
      type: 'custom',
      points: [...c.points, { id: `${channel}-${x}`, x, y }].sort((a, b) => a.x - b.x),
    } : c),
  })),
  removeCurvePoint: (channel, pointId) => set((state) => ({
    curveData: state.curveData.map(c => c.channel === channel ? {
      ...c,
      type: 'custom',
      points: c.points.filter(p => p.id !== pointId),
    } : c),
  })),
  resetCurve: (channel) => set((state) => ({
    curveData: state.curveData.map(c => c.channel === channel ? {
      ...c,
      type: 'custom',
      points: [
        { id: `${channel}-0`, x: 0, y: 0 },
        { id: `${channel}-255`, x: 255, y: 255 },
      ],
    } : c),
  })),

  // Channels
  channelData: generateDefaultChannels(),
  updateChannel: (channel, data) => set((state) => ({
    channelData: {
      ...state.channelData,
      [channel]: { ...state.channelData[channel], ...data },
    },
  })),
  resetChannels: () => set({ channelData: generateDefaultChannels() }),

  // Masks
  masks: [],
  addMask: (mask) => set((state) => ({ masks: [...state.masks, mask] })),
  removeMask: (id) => set((state) => ({ masks: state.masks.filter(m => m.id !== id) })),
  updateMask: (id, data) => set((state) => ({
    masks: state.masks.map(m => m.id === id ? { ...m, ...data } : m),
  })),
  toggleMask: (id) => set((state) => ({
    masks: state.masks.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m),
  })),

  // Color Targets
  colorTargets: [],
  addColorTarget: (target) => set((state) => ({ colorTargets: [...state.colorTargets, target] })),
  removeColorTarget: (id) => set((state) => ({ colorTargets: state.colorTargets.filter(t => t.id !== id) })),
  updateColorTarget: (id, data) => set((state) => ({
    colorTargets: state.colorTargets.map(t => t.id === id ? { ...t, ...data } : t),
  })),

  // LUT browser
  lutItems: sampleLUTs,
  setLUTItems: (items) => set({ lutItems: items }),
  activeLutId: null,
  setActiveLutId: (id) => set({ activeLutId: id }),
  lutIntensity: 100,
  setLutIntensity: (intensity) => set({ lutIntensity: intensity }),
  lutFilterTags: [],
  setLutFilterTags: (tags) => set({ lutFilterTags: tags }),

  // Imported LUTs
  importedLUTs: [],
  addImportedLUT: (lut) => set((state) => ({ importedLUTs: [...state.importedLUTs, lut] })),
  removeImportedLUT: (id) => set((state) => ({ importedLUTs: state.importedLUTs.filter(l => l.id !== id) })),
  activeImportedLutId: null,
  setActiveImportedLutId: (id) => set({ activeImportedLutId: id }),

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

  // Saved Looks
  savedLooks: [],
  setSavedLooks: (looks) => set({ savedLooks: looks }),
  addSavedLook: (look) => set((state) => ({ savedLooks: [...state.savedLooks, look] })),
  removeSavedLook: (id) => set((state) => ({ savedLooks: state.savedLooks.filter(l => l.id !== id) })),
  toggleLookFavorite: (id) => set((state) => ({
    savedLooks: state.savedLooks.map(l => l.id === id ? { ...l, favorite: !l.favorite } : l),
  })),

  // Batch Processing
  batchItems: [],
  addBatchItems: (items) => set((state) => ({ batchItems: [...state.batchItems, ...items] })),
  removeBatchItem: (id) => set((state) => ({ batchItems: state.batchItems.filter(i => i.id !== id) })),
  updateBatchItem: (id, data) => set((state) => ({
    batchItems: state.batchItems.map(i => i.id === id ? { ...i, ...data } : i),
  })),
  clearBatchItems: () => set({ batchItems: [], batchStatus: 'idle' }),
  batchStatus: 'idle',
  setBatchStatus: (status) => set({ batchStatus: status }),

  // Settings
  settings: {
    colorSpace: 'srgb',
    inputColorSpace: 'linear',
    bitDepth: '16',
    gridSize: 33,
    max3DLUTSize: 65,
    showSkinToneLine: true,
    showGamutWarnings: true,
    curveResolution: 256,
    interpolationMode: 'cubic',
    abHueSigma: 40,
    abSatSigma: 30,
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

  // Graded image URL (for live scopes)
  gradedUrl: null as string | null,
  setGradedUrl: (url) => set({ gradedUrl: url }),

  // Global intensity
  globalIntensity: 100,
  setGlobalIntensity: (intensity) => set({ globalIntensity: intensity }),

  // Volume
  volume: 0,
  setVolume: (vol) => set({ volume: vol }),
}));
