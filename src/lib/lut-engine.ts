/**
 * LUT Engine - Core utilities for LUT generation and color grading
 * Shared between .cube export and image export API routes.
 *
 * Color space: OKLAB (perceptually uniform, Björn Ottosson 2020)
 * Grid operations use OKLCh (polar form) for hue/chroma manipulation.
 *
 * Grid interpolation: Bilinear control mesh (replaces former Gaussian-weighted).
 * Includes gamut mapping and ordered dithering for output quality.
 */

// ─── Types (mirrored from useAppStore for server-side use) ───

export interface CurvePoint {
  id: string;
  x: number; // 0-255 input
  y: number; // 0-255 output
}

export interface CurveData {
  channel: string;
  type: string;
  points: CurvePoint[];
  isLocked: boolean;
}

export interface ChannelData {
  enabled: boolean;
  gain: number;   // -100 to 100
  gamma: number;  // 0.1 to 5.0
  lift: number;   // -100 to 100
  offset: number; // -100 to 100
}

export interface GridNode {
  id: string;
  hue: number;
  saturation: number;
  lightness: number;
  offsetX: number;
  offsetY: number;
}

export interface CLGridNode {
  id: string;
  chroma: number;
  luminance: number;
  offsetX: number;
  offsetY: number;
}

// ─── Fast-path types ───

/** Pre-processed AB grid node data stored in flat typed arrays for cache-friendly iteration */
export interface ABNodeArrays {
  hues: Float64Array;
  sats: Float64Array;
  lums: Float64Array;
  offsetXs: Float64Array;
  offsetYs: Float64Array;
  count: number;
}

/** Pre-processed CL grid node data stored in flat typed arrays for cache-friendly iteration */
export interface CLNodeArrays {
  chromas: Float64Array;
  lums: Float64Array;
  offsetXs: Float64Array;
  offsetYs: Float64Array;
  count: number;
}

// ─── Bilinear mesh table types ───

/** Pre-built 2D lookup table for AB bilinear control mesh (12 hue cols × 3 sat rows) */
export interface ABMeshTable {
  grid: Float64Array; // [(row * cols + col) * 2 + 0/1] = offsetX/offsetY
  cols: number;       // 12
  rows: number;       // 3
  hueStep: number;    // 30
  satMin: number;     // 25
  satStep: number;    // 25
}

/** Pre-built 2D lookup table for CL bilinear control mesh (6 chroma cols × 6 lum rows) */
export interface CLMeshTable {
  grid: Float64Array;
  cols: number;       // 6
  rows: number;       // 6
  chromaMin: number;  // 10
  chromaStep: number; // 15
  lumMin: number;     // 10
  lumStep: number;    // 15
}

/** Parameters for the fast pixel processing path using pre-built LUTs and typed arrays */
export interface FastGradeParams {
  masterLUT: Uint8Array;
  rLUT: Uint8Array;
  gLUT: Uint8Array;
  bLUT: Uint8Array;
  lumLUT: Uint8Array;
  channelData: Record<string, ChannelData>;
  abNodes: ABNodeArrays;
  clNodes: CLNodeArrays;
  globalIntensity: number;
  neutralProtection: boolean;
  clAxis: string;
  abMesh: ABMeshTable | null;
  clMesh: CLMeshTable | null;
}

// ─── OKLAB Color Space Conversions ───

/** sRGB gamma decode: 0-1 sRGB -> 0-1 linear */
function srgbGammaToLinear(c: number): number {
  if (c <= 0.04045) return c / 12.92;
  return Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear to sRGB gamma encode: 0-1 linear -> 0-1 sRGB */
function linearToSrgbGamma(c: number): number {
  if (c <= 0.0031308) return c * 12.92;
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * Linear sRGB to OKLAB (perceptually uniform color space, Bjorn Ottosson 2020)
 * Input: r, g, b in 0-1 (linear sRGB)
 * Output: [L, a, b] where L in [0,1], a in [-0.5,0.5], b in [-0.5,0.5]
 */
export function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l_ = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m_ = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s_ = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l = Math.cbrt(l_);
  const m = Math.cbrt(m_);
  const s = Math.cbrt(s_);

  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/**
 * OKLAB to linear sRGB
 * Input: L, a, b (same ranges as above)
 * Output: [r, g, b] in 0-1 (linear sRGB)
 */
export function oklabToLinearRgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

/**
 * OKLAB to OKLCh (polar form)
 * Input: L, a, b from OKLAB
 * Output: [L, C, h] where L=lightness [0,1], C=chroma [0,~0.5], h=hue [0,360]
 */
export function oklabToOklch(L: number, a: number, b: number): [number, number, number] {
  const C = Math.sqrt(a * a + b * b);
  let h = Math.atan2(b, a) * (180 / Math.PI);
  if (h < 0) h += 360;
  return [L, C, h];
}

/**
 * OKLCh to OKLAB
 * Input: L, C, h
 * Output: [L, a, b]
 */
export function oklchToOklab(L: number, C: number, h: number): [number, number, number] {
  const hRad = h * (Math.PI / 180);
  return [L, C * Math.cos(hRad), C * Math.sin(hRad)];
}

/**
 * Convert sRGB (0-255 per channel) to OKLAB
 * Applies gamma decode (sRGB -> linear) before OKLAB conversion
 */
export function srgbToOklab(r255: number, g255: number, b255: number): [number, number, number] {
  const r = srgbGammaToLinear(r255 / 255);
  const g = srgbGammaToLinear(g255 / 255);
  const b = srgbGammaToLinear(b255 / 255);
  return linearRgbToOklab(r, g, b);
}

/**
 * Convert OKLAB to sRGB (0-255 per channel)
 * Applies gamma encode (linear -> sRGB) after OKLAB conversion
 */
export function oklabToSrgb(L: number, a: number, bv: number): [number, number, number] {
  let [r, g, b] = oklabToLinearRgb(L, a, bv);
  r = Math.max(0, Math.min(1, r));
  g = Math.max(0, Math.min(1, g));
  b = Math.max(0, Math.min(1, b));
  return [
    Math.round(linearToSrgbGamma(r) * 255),
    Math.round(linearToSrgbGamma(g) * 255),
    Math.round(linearToSrgbGamma(b) * 255),
  ];
}

/**
 * Convert sRGB 0-1 to OKLCh (L, C, h)
 * Convenience function: sRGB (0-1) -> OKLAB -> OKLCh
 */
export function srgb01ToOklch(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbGammaToLinear(r);
  const lg = srgbGammaToLinear(g);
  const lb = srgbGammaToLinear(b);
  const [L, a, bv] = linearRgbToOklab(lr, lg, lb);
  return oklabToOklch(L, a, bv);
}

/**
 * Convert OKLCh (L, C, h) to sRGB 0-1
 * Convenience function: OKLCh -> OKLAB -> linear sRGB -> sRGB 0-1
 */
export function oklchToSrgb01(L: number, C: number, h: number): [number, number, number] {
  const [oa, ob] = oklchToOklab(L, C, h).slice(1) as [number, number];
  const [lr, lg, lb] = oklabToLinearRgb(L, oa, ob);
  return [
    linearToSrgbGamma(Math.max(0, Math.min(1, lr))),
    linearToSrgbGamma(Math.max(0, Math.min(1, lg))),
    linearToSrgbGamma(Math.max(0, Math.min(1, lb))),
  ];
}

// ─── HSL Conversions (kept for backward compatibility / grid canvas rendering) ───

/**
 * Convert HSL (h: 0-360, s: 0-100, l: 0-100) to RGB (0-1 each).
 * Retained for use by grid canvas rendering; NOT used in pixel processing pipeline.
 */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hNorm = h / 360;
  const sNorm = s / 100;
  const lNorm = l / 100;

  if (sNorm === 0) {
    return [lNorm, lNorm, lNorm];
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
  const p = 2 * lNorm - q;

  return [
    hue2rgb(p, q, hNorm + 1 / 3),
    hue2rgb(p, q, hNorm),
    hue2rgb(p, q, hNorm - 1 / 3),
  ];
}

/**
 * Convert RGB (0-1 each) to HSL (h: 0-360, s: 0-100, l: 0-100).
 * Retained for backward compatibility; NOT used in pixel processing pipeline.
 */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l * 100];
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    case b: h = ((r - g) / d + 4) / 6; break;
  }

  return [h * 360, s * 100, l * 100];
}

// ─── CL Axis Types ───

export type CLAxisType = 'red-cyan' | 'green-magenta' | 'blue-yellow' | 'all';

/** Each axis maps to an OKLCh hue angle for color-opponent axis rotation */
export const CL_AXIS_DIRECTIONS: Record<CLAxisType, { a: number; b: number; hue: number }> = {
  'red-cyan':      { a: 0.15, b: 0, hue: 25 },
  'green-magenta': { a: -0.08, b: -0.12, hue: 140 },
  'blue-yellow':   { a: -0.04, b: 0.15, hue: 260 },
  'all':           { a: 0, b: 0, hue: 0 },
};

// ─── Curve LUT Builder ───

/**
 * Pre-compute a 256-entry lookup table from curve control points.
 * Replaces per-pixel cubicInterpolate calls with O(1) array lookups.
 *
 * @param points - Curve control points (x: 0-255, y: 0-255)
 * @returns Uint8Array of 256 entries mapping input value to output value
 */
export function buildCurveLUT(points: CurvePoint[]): Uint8Array {
  const lut = new Uint8Array(256);
  if (!points || points.length === 0) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  for (let x = 0; x < 256; x++) {
    lut[x] = Math.round(Math.max(0, Math.min(255, cubicInterpolate(points, x))));
  }
  return lut;
}

// ─── AB Node Array Builder ───

/**
 * Convert GridNode[] into flat typed arrays for cache-friendly iteration.
 * Only includes nodes with non-zero offsets to skip inactive nodes entirely.
 */
export function buildABNodeArrays(nodes: GridNode[]): ABNodeArrays {
  if (!nodes || nodes.length === 0) {
    return {
      hues: new Float64Array(0),
      sats: new Float64Array(0),
      lums: new Float64Array(0),
      offsetXs: new Float64Array(0),
      offsetYs: new Float64Array(0),
      count: 0,
    };
  }

  // Pre-count active nodes
  let activeCount = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.offsetX !== 0 || n.offsetY !== 0) activeCount++;
  }

  const hues = new Float64Array(activeCount);
  const sats = new Float64Array(activeCount);
  const lums = new Float64Array(activeCount);
  const offsetXs = new Float64Array(activeCount);
  const offsetYs = new Float64Array(activeCount);

  let idx = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.offsetX !== 0 || n.offsetY !== 0) {
      hues[idx] = n.hue;
      sats[idx] = n.saturation;
      lums[idx] = n.lightness;
      offsetXs[idx] = n.offsetX;
      offsetYs[idx] = n.offsetY;
      idx++;
    }
  }

  return { hues, sats, lums, offsetXs, offsetYs, count: activeCount };
}

// ─── CL Node Array Builder ───

/**
 * Convert CLGridNode[] into flat typed arrays for cache-friendly iteration.
 * Only includes nodes with non-zero offsets.
 */
export function buildCLNodeArrays(nodes: CLGridNode[]): CLNodeArrays {
  if (!nodes || nodes.length === 0) {
    return {
      chromas: new Float64Array(0),
      lums: new Float64Array(0),
      offsetXs: new Float64Array(0),
      offsetYs: new Float64Array(0),
      count: 0,
    };
  }

  // Pre-count active nodes
  let activeCount = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.offsetX !== 0 || n.offsetY !== 0) activeCount++;
  }

  const chromas = new Float64Array(activeCount);
  const lums = new Float64Array(activeCount);
  const offsetXs = new Float64Array(activeCount);
  const offsetYs = new Float64Array(activeCount);

  let idx = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.offsetX !== 0 || n.offsetY !== 0) {
      chromas[idx] = n.chroma;
      lums[idx] = n.luminance;
      offsetXs[idx] = n.offsetX;
      offsetYs[idx] = n.offsetY;
      idx++;
    }
  }

  return { chromas, lums, offsetXs, offsetYs, count: activeCount };
}

// ─── AB/CL Mesh Table Builders ───

/**
 * Build a 2D bilinear lookup table from AB grid nodes.
 * Grid: 12 hue columns (0°–330°, step 30) × 3 saturation rows (25%, 50%, 75%).
 * Each cell stores [offsetX, offsetY] = [hue shift degrees, sat shift %].
 */
export function buildABMeshTable(nodes: GridNode[]): ABMeshTable {
  const COLS = 12, ROWS = 3, HUE_STEP = 30, SAT_MIN = 25, SAT_STEP = 25;
  const grid = new Float64Array(COLS * ROWS * 2);
  for (const node of nodes) {
    const col = Math.round(node.hue / HUE_STEP) % COLS;
    const row = Math.round((node.saturation - SAT_MIN) / SAT_STEP);
    if (col >= 0 && col < COLS && row >= 0 && row < ROWS) {
      grid[(row * COLS + col) * 2] = node.offsetX;
      grid[(row * COLS + col) * 2 + 1] = node.offsetY;
    }
  }
  return { grid, cols: COLS, rows: ROWS, hueStep: HUE_STEP, satMin: SAT_MIN, satStep: SAT_STEP };
}

/**
 * Build a 2D bilinear lookup table from CL grid nodes.
 * Grid: 6 chroma columns (10%–85%, step 15) × 6 luminance rows (10%–85%, step 15).
 * Each cell stores [offsetX, offsetY] = [chroma shift %, luminance shift %].
 */
export function buildCLMeshTable(nodes: CLGridNode[]): CLMeshTable {
  const COLS = 6, ROWS = 6, C_MIN = 10, C_STEP = 15, L_MIN = 10, L_STEP = 15;
  const grid = new Float64Array(COLS * ROWS * 2);
  for (const node of nodes) {
    const col = Math.round((node.chroma - C_MIN) / C_STEP);
    const row = Math.round((node.luminance - L_MIN) / L_STEP);
    if (col >= 0 && col < COLS && row >= 0 && row < ROWS) {
      grid[(row * COLS + col) * 2] = node.offsetX;
      grid[(row * COLS + col) * 2 + 1] = node.offsetY;
    }
  }
  return { grid, cols: COLS, rows: ROWS, chromaMin: C_MIN, chromaStep: C_STEP, lumMin: L_MIN, lumStep: L_STEP };
}

// ─── Cubic Spline Interpolation ───

/**
 * Cubic spline interpolation through curve control points.
 * Returns the interpolated Y value (0-255) for a given X (0-255).
 * Falls back to linear interpolation when fewer than 2 points exist.
 */
export function cubicInterpolate(points: CurvePoint[], x: number): number {
  if (!points || points.length === 0) return x;
  if (points.length === 1) return points[0].y;

  // Sort points by x
  const sorted = [...points].sort((a, b) => a.x - b.x);

  // Clamp x to point range
  const xMin = sorted[0].x;
  const xMax = sorted[sorted.length - 1].x;
  const xc = Math.max(xMin, Math.min(xMax, x));

  // Find the two bracketing points
  let k = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (xc >= sorted[i].x && xc <= sorted[i + 1].x) {
      k = i;
      break;
    }
  }

  const p0 = sorted[Math.max(0, k - 1)];
  const p1 = sorted[k];
  const p2 = sorted[Math.min(sorted.length - 1, k + 1)];
  const p3 = sorted[Math.min(sorted.length - 1, k + 2)];

  const dx = p2.x - p1.x;
  if (dx === 0) return p1.y;

  // Normalize t to [0, 1] within the current segment
  const t = (xc - p1.x) / dx;

  // Catmull-Rom spline (a type of cubic Hermite spline)
  const tension = 0.5;
  const t2 = t * t;
  const t3 = t2 * t;

  const m0x = tension * (p2.x - p0.x);
  const m0y = tension * (p2.y - p0.y);
  const m1x = tension * (p3.x - p1.x);
  const m1y = tension * (p3.y - p1.y);

  const a = 2 * t3 - 3 * t2 + 1;
  const b = t3 - 2 * t2 + t;
  const c = -2 * t3 + 3 * t2;
  const d = t3 - t2;

  return a * p1.y + b * m0y + c * p2.y + d * m1y;
}

// ─── Gamut Mapping ───

/**
 * Gamut mapping: reduce chroma iteratively until RGB is within [0,1].
 * Preserves hue and lightness; only reduces chroma.
 * Uses binary search for efficiency (max 12 iterations).
 */
function gamutMapOkLCh(L: number, C: number, h: number): [number, number, number] {
  // Try original chroma first
  const [a, b] = oklchToOklab(L, C, h).slice(1) as [number, number];
  const [r, g, bv] = oklabToLinearRgb(L, a, b);
  if (r >= -0.001 && r <= 1.001 && g >= -0.001 && g <= 1.001 && bv >= -0.001 && bv <= 1.001) {
    return [L, C, h]; // Already in gamut
  }
  // Binary search for max chroma within gamut
  let lo = 0, hi = C;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const [ma, mb] = oklchToOklab(L, mid, h).slice(1) as [number, number];
    const [mr, mg, mbv] = oklabToLinearRgb(L, ma, mb);
    if (mr >= -0.001 && mr <= 1.001 && mg >= -0.001 && mg <= 1.001 && mbv >= -0.001 && mbv <= 1.001) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return [L, lo, h];
}

// ─── Ordered Dithering ───

// 4×4 Bayer matrix for ordered dithering
const BAYER_4X4 = new Float64Array([
  0,  8,  2, 10,
  12, 4, 14,  6,
  3, 11,  1,  9,
  15, 7, 13,  5,
]);

/**
 * Apply ordered dithering to final 8-bit output.
 * Prevents color banding in smooth gradients.
 */
function dither(r: number, g: number, b: number, x: number, y: number): [number, number, number] {
  const bx = x & 3; // % 4
  const by = y & 3; // % 4
  const threshold = (BAYER_4X4[by * 4 + bx] / 16 - 0.5) / 255;
  return [
    Math.max(0, Math.min(255, (r + 0.5) | 0 + (threshold > 0 ? 1 : 0))),
    Math.max(0, Math.min(255, (g + 0.5) | 0 + (threshold > 0 ? 1 : 0))),
    Math.max(0, Math.min(255, (b + 0.5) | 0 + (threshold > 0 ? 1 : 0))),
  ];
}

// ─── A/B Grid Interpolation — Bilinear Control Mesh ───

/**
 * Interpolate hue/saturation shift from A/B grid using bilinear control mesh.
 * Grid: 12 hues (0–330, step 30) × 3 saturations (25%, 50%, 75%).
 * Hue wraps circularly; saturation clamps to [25, 75].
 * Returns [hueShift (degrees), satShift (%), 0].
 */
export function interpolateABGrid(
  nodes: GridNode[],
  pixelR: number, pixelG: number, pixelB: number,
  neutralProtection: boolean = false,
): [number, number, number] {
  // Convert pixel to OKLCh
  const [L, C, h] = srgb01ToOklch(pixelR, pixelG, pixelB);

  // Skip near-neutral pixels
  if (neutralProtection && C < 0.005) return [0, 0, 0];
  if (C < 0.005 || L < 0.02 || L > 0.98) return [0, 0, 0];

  // Convert OKLCh chroma to UI saturation %
  const satPercent = (C / 0.37) * 100;
  const satC = satPercent < 25 ? 25 : satPercent > 75 ? 75 : satPercent;

  // Find cell — hue is circular (wraps at 360)
  const colF = h / 30;
  const colIdx = Math.floor(colF) % 12;
  const u = colF - Math.floor(colF);
  const nextColIdx = (colIdx + 1) % 12;

  // Row — saturation (non-wrapping)
  const rowF = (satC - 25) / 25;
  const rowIdx = rowF < 0 ? 0 : rowF > 1 ? 1 : Math.floor(rowF);
  const v = rowF - rowIdx;
  const vC = v < 0 ? 0 : v > 1 ? 1 : v;

  // Lookup helper: find node by hue/saturation with tolerance
  const findNode = (targetHue: number, targetSat: number): GridNode | null => {
    for (const node of nodes) {
      if (Math.abs(node.hue - targetHue) < 0.1 && Math.abs(node.saturation - targetSat) < 0.1) {
        return node;
      }
    }
    return null;
  };

  // Get 4 corner nodes
  const h0 = colIdx * 30;
  const h1 = nextColIdx * 30;
  const s0 = 25 + rowIdx * 25;
  const s1 = 25 + (rowIdx + 1) * 25;

  const n00 = findNode(h0, s0);
  const n10 = findNode(h1, s0);
  const n01 = findNode(h0, s1);
  const n11 = findNode(h1, s1);

  // Fallback: if any corner is missing, return zero
  if (!n00 || !n10 || !n01 || !n11) return [0, 0, 0];

  // Bilinear interpolation of offsets
  const w00 = (1 - u) * (1 - vC);
  const w10 = u * (1 - vC);
  const w01 = (1 - u) * vC;
  const w11 = u * vC;

  const dx = w00 * n00.offsetX + w10 * n10.offsetX + w01 * n01.offsetX + w11 * n11.offsetX;
  const dy = w00 * n00.offsetY + w10 * n10.offsetY + w01 * n01.offsetY + w11 * n11.offsetY;

  return [dx, dy, 0]; // hue shift degrees, sat shift %
}

// ─── C/L Grid Interpolation — Bilinear Control Mesh ───

/**
 * Interpolate chroma/luminance shift from C/L grid using bilinear control mesh.
 * Grid: 6 chroma (10%–85%, step 15) × 6 luminance (10%–85%, step 15).
 * Returns [chromaShift (%), luminanceShift (%)].
 */
export function interpolateCLGrid(
  nodes: CLGridNode[],
  pixelR: number, pixelG: number, pixelB: number,
  axis: CLAxisType = 'all',
  neutralProtection: boolean = false,
): [number, number] {
  // Convert pixel to OKLCh
  const [L, C, h] = srgb01ToOklch(pixelR, pixelG, pixelB);

  // Skip near-neutral pixels
  if (neutralProtection && C < 0.005) return [0, 0];
  if (C < 0.005) return [0, 0];

  // Convert OKLCh chroma to %, lightness to %
  const chromaPercent = (C / 0.37) * 100;
  const lumPercent = L * 100;

  // Clamp to grid bounds
  const chromaC = chromaPercent < 10 ? 10 : chromaPercent > 85 ? 85 : chromaPercent;
  const lumC = lumPercent < 10 ? 10 : lumPercent > 85 ? 85 : lumPercent;

  // Find cell
  const colF = (chromaC - 10) / 15;
  const colIdx = colF < 0 ? 0 : colF > 4 ? 4 : Math.floor(colF);
  const u = colF - colIdx;

  const rowF = (lumC - 10) / 15;
  const rowIdx = rowF < 0 ? 0 : rowF > 4 ? 4 : Math.floor(rowF);
  const v = rowF - rowIdx;

  // Lookup helper: find CL node by chroma/luminance with tolerance
  const findNode = (targetChroma: number, targetLum: number): CLGridNode | null => {
    for (const node of nodes) {
      if (Math.abs(node.chroma - targetChroma) < 0.1 && Math.abs(node.luminance - targetLum) < 0.1) {
        return node;
      }
    }
    return null;
  };

  // Get 4 corner nodes
  const c0 = 10 + colIdx * 15;
  const c1 = 10 + (colIdx + 1) * 15;
  const l0 = 10 + rowIdx * 15;
  const l1 = 10 + (rowIdx + 1) * 15;

  const n00 = findNode(c0, l0);
  const n10 = findNode(c1, l0);
  const n01 = findNode(c0, l1);
  const n11 = findNode(c1, l1);

  // Fallback: if any corner is missing, return zero
  if (!n00 || !n10 || !n01 || !n11) return [0, 0];

  // Bilinear interpolation of offsets
  const w00 = (1 - u) * (1 - v);
  const w10 = u * (1 - v);
  const w01 = (1 - u) * v;
  const w11 = u * v;

  let chromaShift = w00 * n00.offsetX + w10 * n10.offsetX + w01 * n01.offsetX + w11 * n11.offsetX;
  const lumShift = w00 * n00.offsetY + w10 * n10.offsetY + w01 * n01.offsetY + w11 * n11.offsetY;

  // If clAxis !== 'all': multiply chroma shift by cos(pixelHue - axisHue) for hue alignment
  if (axis !== 'all') {
    const axisInfo = CL_AXIS_DIRECTIONS[axis];
    const hRad = h * Math.PI / 180;
    const axRad = axisInfo.hue * Math.PI / 180;
    const hueAlignment = Math.cos(hRad - axRad);
    chromaShift *= Math.max(0, hueAlignment);
  }

  return [chromaShift, lumShift]; // chroma shift %, luminance shift %
}

// ─── Channel Adjustments ───

/**
 * Apply gain, gamma, lift, and offset adjustments to a single channel value (0-1).
 * Operates in linear RGB space; color-space agnostic.
 */
export function applyChannelAdjustment(
  value: number,
  channel: ChannelData
): number {
  if (!channel || !channel.enabled) return value;

  // Apply lift (shadows): lift shifts the bottom of the curve
  let v = value + (channel.lift / 100) * (1 - value);

  // Apply gain (highlights): gain shifts the top of the curve
  v = v * (1 + channel.gain / 100);

  // Apply gamma: v^gamma correction
  if (channel.gamma > 0 && channel.gamma !== 1) {
    // Normalize to avoid 0^gamma issues
    v = Math.pow(Math.max(0, v), 1 / channel.gamma);
  }

  // Apply offset: simple addition
  v += channel.offset / 100;

  return v;
}

// ─── Full Color Grade Pipeline ───

export interface ColorGradeParams {
  curveData: CurveData[];
  channelData: Record<string, ChannelData>;
  abNodes: GridNode[];
  clNodes: CLGridNode[];
  globalIntensity: number;
  neutralProtection?: boolean;
  clAxis?: CLAxisType;
}

/**
 * Apply the full color grading pipeline to a single RGB pixel (0-1 each).
 * Returns the graded [R, G, B] clamped to [0, 1].
 * Uses OKLAB/OKLCh for grid operations, RGB for channel adjustments.
 * Includes gamut mapping after grid shifts. No dithering (needs spatial position).
 */
export function applyColorGradePixel(
  r: number,
  g: number,
  b: number,
  params: ColorGradeParams
): [number, number, number] {
  const {
    curveData, channelData, abNodes, clNodes, globalIntensity,
    neutralProtection = false,
    clAxis = 'all',
  } = params;

  // ── Step 1: Curve transformations ──

  // Convert 0-1 to 0-255 for curve lookup
  let rIn = r * 255;
  let gIn = g * 255;
  let bIn = b * 255;

  // Apply master curve first
  const masterCurve = curveData.find(c => c.channel === 'master');
  if (masterCurve && !masterCurve.isLocked) {
    const masterOut = cubicInterpolate(masterCurve.points, (rIn + gIn + bIn) / 3);
    const avgIn = (rIn + gIn + bIn) / 3;
    if (avgIn > 0) {
      const ratio = masterOut / avgIn;
      rIn *= ratio;
      gIn *= ratio;
      bIn *= ratio;
    }
  }

  // Apply luminance curve
  const lumCurve = curveData.find(c => c.channel === 'luminance');
  if (lumCurve && !lumCurve.isLocked) {
    const luma = 0.299 * rIn + 0.587 * gIn + 0.114 * bIn;
    const lumOut = cubicInterpolate(lumCurve.points, luma);
    if (luma > 0) {
      const ratio = lumOut / luma;
      rIn *= ratio;
      gIn *= ratio;
      bIn *= ratio;
    }
  }

  // Apply individual R, G, B curves
  const rCurve = curveData.find(c => c.channel === 'r');
  const gCurve = curveData.find(c => c.channel === 'g');
  const bCurve = curveData.find(c => c.channel === 'b');

  if (rCurve && !rCurve.isLocked) rIn = cubicInterpolate(rCurve.points, rIn);
  if (gCurve && !gCurve.isLocked) gIn = cubicInterpolate(gCurve.points, gIn);
  if (bCurve && !bCurve.isLocked) bIn = cubicInterpolate(bCurve.points, bIn);

  // Convert back to 0-1
  let rOut = rIn / 255;
  let gOut = gIn / 255;
  let bOut = bIn / 255;

  // ── Step 2: Channel adjustments (gain, gamma, lift, offset) in RGB space ──

  // Master channel first
  const masterChannel = channelData['master'];
  if (masterChannel && masterChannel.enabled) {
    rOut = applyChannelAdjustment(rOut, masterChannel);
    gOut = applyChannelAdjustment(gOut, masterChannel);
    bOut = applyChannelAdjustment(bOut, masterChannel);
  }

  // Individual channels
  const rChannel = channelData['r'];
  const gChannel = channelData['g'];
  const bChannel = channelData['b'];

  if (rChannel && rChannel.enabled) rOut = applyChannelAdjustment(rOut, rChannel);
  if (gChannel && gChannel.enabled) gOut = applyChannelAdjustment(gOut, gChannel);
  if (bChannel && bChannel.enabled) bOut = applyChannelAdjustment(bOut, bChannel);

  // ── Step 3: A/B grid hue/saturation shifts in OKLCh space (bilinear mesh) ──

  if (abNodes && abNodes.length > 0) {
    const [hueShift, satShift] = interpolateABGrid(
      abNodes, rOut, gOut, bOut, neutralProtection
    );

    // Convert pixel to OKLCh
    let [pxL, pxC, pxH] = srgb01ToOklch(rOut, gOut, bOut);

    if (hueShift !== 0 || satShift !== 0) {
      // Apply hue shift (degrees)
      let newH = pxH + hueShift;
      newH = ((newH % 360) + 360) % 360;

      // Apply saturation shift: satShift is in % units of UI saturation
      // Convert current chroma to %, apply shift, convert back
      let satP = (pxC / 0.37) * 100;
      satP = satP + satShift;
      let newC = (satP / 100) * 0.37;
      newC = Math.max(0, newC);

      // Gamut map to ensure RGB stays in [0,1]
      const [gmL, gmC, gmH] = gamutMapOkLCh(pxL, newC, newH);

      // Convert back to sRGB 0-1
      const [abR, abG, abB] = oklchToSrgb01(gmL, gmC, gmH);
      rOut = abR;
      gOut = abG;
      bOut = abB;
    }
  }

  // ── Step 4: C/L grid chroma/luminance shifts in OKLCh space (bilinear mesh) ──

  if (clNodes && clNodes.length > 0) {
    const [chromaShift, lumShift] = interpolateCLGrid(
      clNodes, rOut, gOut, bOut, clAxis, neutralProtection
    );

    if (chromaShift !== 0 || lumShift !== 0) {
      // Convert current pixel to OKLCh
      let [pxL, pxC, pxH] = srgb01ToOklch(rOut, gOut, bOut);

      // Apply chroma shift (proportional %)
      let newC = pxC * (1 + chromaShift / 100);
      newC = Math.max(0, newC);

      // Apply luminance shift (proportional %)
      let newL = pxL * (1 + lumShift / 100);
      newL = Math.max(0, newL);

      // Gamut map
      const [gmL, gmC, gmH] = gamutMapOkLCh(newL, newC, pxH);

      // Convert back to sRGB 0-1
      const [clR, clG, clB] = oklchToSrgb01(gmL, gmC, gmH);
      rOut = clR;
      gOut = clG;
      bOut = clB;
    }
  }

  // ── Step 5: Global intensity blending ──
  const intensity = Math.max(0, Math.min(1, globalIntensity / 100));
  rOut = r * (1 - intensity) + rOut * intensity;
  gOut = g * (1 - intensity) + gOut * intensity;
  bOut = b * (1 - intensity) + bOut * intensity;

  // ── Step 6: Clamp to 0-1 ──
  return [
    Math.max(0, Math.min(1, rOut)),
    Math.max(0, Math.min(1, gOut)),
    Math.max(0, Math.min(1, bOut)),
  ];
}

// ─── .cube LUT File Generation ───

/**
 * Generate a .cube format LUT file string.
 *
 * @param name - LUT name for the TITLE header
 * @param gridSize - Number of samples per axis (e.g., 17, 33, 65)
 * @param params - All color grading parameters
 * @returns The complete .cube file content as a string
 */
export function generateCubeLUT(
  name: string,
  gridSize: number,
  params: ColorGradeParams
): string {
  const lines: string[] = [];

  // Header
  lines.push('# Created by Chroma Forge');
  lines.push(`TITLE "${name.replace(/"/g, '\\"')}"`);
  lines.push('DOMAIN_MIN 0.0 0.0 0.0');
  lines.push('DOMAIN_MAX 1.0 1.0 1.0');
  lines.push(`LUT_3D_SIZE ${gridSize}`);

  // Generate all N*N*N entries
  for (let bIdx = 0; bIdx < gridSize; bIdx++) {
    for (let gIdx = 0; gIdx < gridSize; gIdx++) {
      for (let rIdx = 0; rIdx < gridSize; rIdx++) {
        // Convert grid indices to 0-1 float values
        const rIn = rIdx / (gridSize - 1);
        const gIn = gIdx / (gridSize - 1);
        const bIn = bIdx / (gridSize - 1);

        // Apply the full color grade pipeline
        const [rOut, gOut, bOut] = applyColorGradePixel(rIn, gIn, bIn, params);

        // Format as 6-decimal float values
        lines.push(`${rOut.toFixed(6)} ${gOut.toFixed(6)} ${bOut.toFixed(6)}`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

// ─── Image Pixel Processing (Original) ───

/**
 * Process raw pixel data (RGBA Uint8ClampedArray) through the color grading pipeline.
 * Modifies the pixel data in-place.
 * Uses bilinear control mesh interpolation, gamut mapping, and ordered dithering.
 */
export function processImagePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  params: ColorGradeParams
): void {
  // ── Pre-build curve LUTs ──
  const { curveData, channelData, abNodes, clNodes, globalIntensity,
    neutralProtection = false, clAxis = 'all' } = params;

  const masterCurve = curveData.find(c => c.channel === 'master');
  const lumCurve = curveData.find(c => c.channel === 'luminance');
  const rCurve = curveData.find(c => c.channel === 'r');
  const gCurve = curveData.find(c => c.channel === 'g');
  const bCurve = curveData.find(c => c.channel === 'b');

  // Identity LUTs for channels with no active curve
  const identityLUT = new Uint8Array(256);
  for (let i = 0; i < 256; i++) identityLUT[i] = i;

  const masterLUT = (masterCurve && !masterCurve.isLocked)
    ? buildCurveLUT(masterCurve.points)
    : identityLUT;
  const lumLUT = (lumCurve && !lumCurve.isLocked)
    ? buildCurveLUT(lumCurve.points)
    : identityLUT;
  const rLUT = (rCurve && !rCurve.isLocked)
    ? buildCurveLUT(rCurve.points)
    : identityLUT;
  const gLUT = (gCurve && !gCurve.isLocked)
    ? buildCurveLUT(gCurve.points)
    : identityLUT;
  const bLUT = (bCurve && !bCurve.isLocked)
    ? buildCurveLUT(bCurve.points)
    : identityLUT;

  // Pre-extract channel data to avoid repeated lookups
  const masterChannel = channelData['master'];
  const rChannel = channelData['r'];
  const gChannel = channelData['g'];
  const bChannel = channelData['b'];

  // Check if any grids have active nodes
  const hasActiveABNodes = abNodes && abNodes.length > 0 && abNodes.some(n => n.offsetX !== 0 || n.offsetY !== 0);
  const hasActiveCLNodes = clNodes && clNodes.length > 0 && clNodes.some(n => n.offsetX !== 0 || n.offsetY !== 0);

  // Pre-build bilinear mesh tables for faster lookup
  const abMesh = hasActiveABNodes ? buildABMeshTable(abNodes!) : null;
  const clMesh = hasActiveCLNodes ? buildCLMeshTable(clNodes!) : null;

  // Global intensity
  const intensity = Math.max(0, Math.min(1, globalIntensity / 100));
  const invIntensity = 1 - intensity;

  const totalPixels = pixels.length;

  for (let i = 0; i < totalPixels; i += 4) {
    const origR = pixels[i];
    const origG = pixels[i + 1];
    const origB = pixels[i + 2];

    let rIn = origR;
    let gIn = origG;
    let bIn = origB;

    // ── Step 1: Curve transformations via LUT lookup ──

    // Master curve
    if (masterLUT !== identityLUT) {
      const avg = (rIn + gIn + bIn) / 3;
      const avgRound = (avg + 0.5) | 0;
      const avgClamped = avgRound < 0 ? 0 : avgRound > 255 ? 255 : avgRound;
      const masterOut = masterLUT[avgClamped];
      if (avg > 0) {
        const ratio = masterOut / avg;
        rIn *= ratio;
        gIn *= ratio;
        bIn *= ratio;
      }
    }

    // Luminance curve
    if (lumLUT !== identityLUT) {
      const luma = 0.299 * rIn + 0.587 * gIn + 0.114 * bIn;
      const lumaRound = (luma + 0.5) | 0;
      const lumaClamped = lumaRound < 0 ? 0 : lumaRound > 255 ? 255 : lumaRound;
      const lumOut = lumLUT[lumaClamped];
      if (luma > 0) {
        const ratio = lumOut / luma;
        rIn *= ratio;
        gIn *= ratio;
        bIn *= ratio;
      }
    }

    // Individual R, G, B curves via LUT
    const rRound = (rIn + 0.5) | 0;
    const gRound = (gIn + 0.5) | 0;
    const bRound = (bIn + 0.5) | 0;
    rIn = rLUT[rRound < 0 ? 0 : rRound > 255 ? 255 : rRound];
    gIn = gLUT[gRound < 0 ? 0 : gRound > 255 ? 255 : gRound];
    bIn = bLUT[bRound < 0 ? 0 : bRound > 255 ? 255 : bRound];

    // Convert to 0-1
    let rOut = rIn / 255;
    let gOut = gIn / 255;
    let bOut = bIn / 255;

    // ── Step 2: Channel adjustments ──
    if (masterChannel && masterChannel.enabled) {
      rOut = applyChannelAdjustment(rOut, masterChannel);
      gOut = applyChannelAdjustment(gOut, masterChannel);
      bOut = applyChannelAdjustment(bOut, masterChannel);
    }
    if (rChannel && rChannel.enabled) rOut = applyChannelAdjustment(rOut, rChannel);
    if (gChannel && gChannel.enabled) gOut = applyChannelAdjustment(gOut, gChannel);
    if (bChannel && bChannel.enabled) bOut = applyChannelAdjustment(bOut, bChannel);

    // ── Step 3: A/B grid hue/saturation shifts via bilinear mesh ──
    if (hasActiveABNodes && abMesh) {
      const [hueShift, satShift] = interpolateABGrid(
        abNodes!, rOut, gOut, bOut, neutralProtection
      );

      if (hueShift !== 0 || satShift !== 0) {
        let [pxL, pxC, pxH] = srgb01ToOklch(rOut, gOut, bOut);

        let newH = pxH + hueShift;
        newH = ((newH % 360) + 360) % 360;

        let satP = (pxC / 0.37) * 100;
        satP = satP + satShift;
        let newC = (satP / 100) * 0.37;
        newC = Math.max(0, newC);

        // Gamut map
        const [gmL, gmC, gmH] = gamutMapOkLCh(pxL, newC, newH);

        const [abR, abG, abB] = oklchToSrgb01(gmL, gmC, gmH);
        rOut = abR;
        gOut = abG;
        bOut = abB;
      }
    }

    // ── Step 4: C/L grid chroma/luminance shifts via bilinear mesh ──
    if (hasActiveCLNodes && clMesh) {
      const [chromaShift, lumShift] = interpolateCLGrid(
        clNodes!, rOut, gOut, bOut, clAxis, neutralProtection
      );

      if (chromaShift !== 0 || lumShift !== 0) {
        let [pxL, pxC, pxH] = srgb01ToOklch(rOut, gOut, bOut);

        let newC = pxC * (1 + chromaShift / 100);
        newC = Math.max(0, newC);

        let newL = pxL * (1 + lumShift / 100);
        newL = Math.max(0, newL);

        // Gamut map
        const [gmL, gmC, gmH] = gamutMapOkLCh(newL, newC, pxH);

        const [clR, clG, clB] = oklchToSrgb01(gmL, gmC, gmH);
        rOut = clR;
        gOut = clG;
        bOut = clB;
      }
    }

    // ── Step 5: Intensity blending ──
    rOut = (origR / 255) * invIntensity + rOut * intensity;
    gOut = (origG / 255) * invIntensity + gOut * intensity;
    bOut = (origB / 255) * invIntensity + bOut * intensity;

    // ── Step 6: Dither and write back ──
    const px = (i / 4) % width;
    const py = (i / 4) / width | 0;
    const [dr, dg, db] = dither(rOut * 255, gOut * 255, bOut * 255, px, py);
    pixels[i] = dr;
    pixels[i + 1] = dg;
    pixels[i + 2] = db;
  }
}

// ─── Fast Image Pixel Processing (OKLAB) ───

/**
 * Optimized pixel processing using pre-built curve LUTs and typed array node data.
 * This is the high-performance path for real-time previews and batch processing.
 *
 * Key optimizations:
 * - O(1) curve lookups via pre-built Uint8Array LUTs
 * - Bilinear control mesh interpolation (replaces former Gaussian loops)
 * - Gamut mapping after grid shifts
 * - Ordered dithering on final output
 * - Skips AB grid entirely when no active nodes
 * - Skips CL grid when no active CL nodes
 * - Local variable extraction to avoid repeated object property access
 * - Bitwise rounding instead of Math.round
 */
export function processImagePixelsFast(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  params: FastGradeParams
): void {
  // ── Extract all params into local variables for tight loop optimization ──
  const masterLUT = params.masterLUT;
  const rLUT = params.rLUT;
  const gLUT = params.gLUT;
  const bLUT = params.bLUT;
  const lumLUT = params.lumLUT;
  const channelData = params.channelData;
  const neutralProtection = params.neutralProtection;
  const clAxis = params.clAxis as CLAxisType;

  const intensity = Math.max(0, Math.min(1, params.globalIntensity / 100));
  const invIntensity = 1 - intensity;

  // Pre-extract channel data
  const masterChannel = channelData['master'];
  const rChannel = channelData['r'];
  const gChannel = channelData['g'];
  const bChannel = channelData['b'];

  // Channel adjustment flags
  const hasMaster = masterChannel && masterChannel.enabled;
  const hasR = rChannel && rChannel.enabled;
  const hasG = gChannel && gChannel.enabled;
  const hasB = bChannel && bChannel.enabled;

  // Pre-extract channel values to avoid repeated object access in loop
  const mGain = hasMaster ? masterChannel.gain / 100 : 0;
  const mGamma = hasMaster ? masterChannel.gamma : 1;
  const mLift = hasMaster ? masterChannel.lift / 100 : 0;
  const mOffset = hasMaster ? masterChannel.offset / 100 : 0;

  const rGain = hasR ? rChannel.gain / 100 : 0;
  const rGamma = hasR ? rChannel.gamma : 1;
  const rLift = hasR ? rChannel.lift / 100 : 0;
  const rOffset = hasR ? rChannel.offset / 100 : 0;

  const gGain = hasG ? gChannel.gain / 100 : 0;
  const gGamma = hasG ? gChannel.gamma : 1;
  const gLift = hasG ? gChannel.lift / 100 : 0;
  const gOffset = hasG ? gChannel.offset / 100 : 0;

  const bGain = hasB ? bChannel.gain / 100 : 0;
  const bGamma = hasB ? bChannel.gamma : 1;
  const bLift = hasB ? bChannel.lift / 100 : 0;
  const bOffset = hasB ? bChannel.offset / 100 : 0;

  // AB/CL mesh tables (bilinear control mesh)
  const abMesh = params.abMesh;
  const clMesh = params.clMesh;
  const hasAB = abMesh !== null;
  const hasCL = clMesh !== null;

  // Pre-extract AB mesh data
  const abGrid = hasAB ? abMesh!.grid : null;
  const abCols = hasAB ? abMesh!.cols : 0;
  const abRows = hasAB ? abMesh!.rows : 0;
  const abHueStep = hasAB ? abMesh!.hueStep : 30;
  const abSatMin = hasAB ? abMesh!.satMin : 25;
  const abSatStep = hasAB ? abMesh!.satStep : 25;

  // Pre-extract CL mesh data
  const clGrid = hasCL ? clMesh!.grid : null;
  const clCols = hasCL ? clMesh!.cols : 0;
  const clRows = hasCL ? clMesh!.rows : 0;
  const clCMin = hasCL ? clMesh!.chromaMin : 10;
  const clCStep = hasCL ? clMesh!.chromaStep : 15;
  const clLMin = hasCL ? clMesh!.lumMin : 10;
  const clLStep = hasCL ? clMesh!.lumStep : 15;

  // Pre-compute CL axis hue for axis rotation
  const clAxisHue = CL_AXIS_DIRECTIONS[clAxis]?.hue ?? 0;
  const clAxisHueRad = clAxisHue * Math.PI / 180;
  const clIsAllAxis = clAxis === 'all';

  // Check if LUTs are identity (avoid unnecessary work)
  let masterIsIdentity = true;
  let lumIsIdentity = true;
  for (let q = 0; q < 256; q++) {
    if (masterLUT[q] !== q) { masterIsIdentity = false; break; }
  }
  for (let q = 0; q < 256; q++) {
    if (lumLUT[q] !== q) { lumIsIdentity = false; break; }
  }

  // Check if any grid processing is needed
  const needsOKLCh = hasAB || hasCL;

  const totalPixels = pixels.length;
  const inv255 = 1 / 255;

  for (let i = 0; i < totalPixels; i += 4) {
    const origR = pixels[i];
    const origG = pixels[i + 1];
    const origB = pixels[i + 2];

    let rIn = origR;
    let gIn = origG;
    let bIn = origB;

    // ── Step 1: Curve transformations via O(1) LUT lookup ──

    // Master curve
    if (!masterIsIdentity) {
      const avg = (rIn + gIn + bIn) * 0.3333333333333333;
      let avgIdx = (avg + 0.5) | 0;
      if (avgIdx < 0) avgIdx = 0;
      else if (avgIdx > 255) avgIdx = 255;
      const masterOut = masterLUT[avgIdx];
      if (avg > 0) {
        const ratio = masterOut / avg;
        rIn *= ratio;
        gIn *= ratio;
        bIn *= ratio;
      }
    }

    // Luminance curve
    if (!lumIsIdentity) {
      const luma = 0.299 * rIn + 0.587 * gIn + 0.114 * bIn;
      let lumaIdx = (luma + 0.5) | 0;
      if (lumaIdx < 0) lumaIdx = 0;
      else if (lumaIdx > 255) lumaIdx = 255;
      const lumOut = lumLUT[lumaIdx];
      if (luma > 0) {
        const ratio = lumOut / luma;
        rIn *= ratio;
        gIn *= ratio;
        bIn *= ratio;
      }
    }

    // Individual R, G, B curves via LUT lookup
    let rIdx = (rIn + 0.5) | 0;
    let gIdx = (gIn + 0.5) | 0;
    let bIdx = (bIn + 0.5) | 0;
    rIn = rLUT[rIdx < 0 ? 0 : rIdx > 255 ? 255 : rIdx];
    gIn = gLUT[gIdx < 0 ? 0 : gIdx > 255 ? 255 : gIdx];
    bIn = bLUT[bIdx < 0 ? 0 : bIdx > 255 ? 255 : bIdx];

    // Convert to 0-1
    let rOut = rIn * inv255;
    let gOut = gIn * inv255;
    let bOut = bIn * inv255;

    // ── Step 2: Channel adjustments (inlined for speed) ──
    if (hasMaster) {
      if (mLift !== 0) {
        rOut = rOut + mLift * (1 - rOut);
        gOut = gOut + mLift * (1 - gOut);
        bOut = bOut + mLift * (1 - bOut);
      }
      if (mGain !== 0) {
        rOut = rOut * (1 + mGain);
        gOut = gOut * (1 + mGain);
        bOut = bOut * (1 + mGain);
      }
      if (mGamma > 0 && mGamma !== 1) {
        rOut = Math.pow(rOut > 0 ? rOut : 0, 1 / mGamma);
        gOut = Math.pow(gOut > 0 ? gOut : 0, 1 / mGamma);
        bOut = Math.pow(bOut > 0 ? bOut : 0, 1 / mGamma);
      }
      if (mOffset !== 0) {
        rOut += mOffset;
        gOut += mOffset;
        bOut += mOffset;
      }
    }

    // R channel
    if (hasR) {
      if (rLift !== 0) rOut = rOut + rLift * (1 - rOut);
      if (rGain !== 0) rOut = rOut * (1 + rGain);
      if (rGamma > 0 && rGamma !== 1) rOut = Math.pow(rOut > 0 ? rOut : 0, 1 / rGamma);
      if (rOffset !== 0) rOut += rOffset;
    }

    // G channel
    if (hasG) {
      if (gLift !== 0) gOut = gOut + gLift * (1 - gOut);
      if (gGain !== 0) gOut = gOut * (1 + gGain);
      if (gGamma > 0 && gGamma !== 1) gOut = Math.pow(gOut > 0 ? gOut : 0, 1 / gGamma);
      if (gOffset !== 0) gOut += gOffset;
    }

    // B channel
    if (hasB) {
      if (bLift !== 0) bOut = bOut + bLift * (1 - bOut);
      if (bGain !== 0) bOut = bOut * (1 + bGain);
      if (bGamma > 0 && bGamma !== 1) bOut = Math.pow(bOut > 0 ? bOut : 0, 1 / bGamma);
      if (bOffset !== 0) bOut += bOffset;
    }

    // ── Step 3 & 4: Grid shifts via bilinear control mesh ──
    if (needsOKLCh) {
      // Convert sRGB 0-1 to OKLCh
      const lr = srgbGammaToLinear(rOut);
      const lg = srgbGammaToLinear(gOut);
      const lb = srgbGammaToLinear(bOut);

      // Inline linearRgbToOklab
      const l_ = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
      const m_ = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
      const s_ = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

      const cl = Math.cbrt(l_);
      const cm = Math.cbrt(m_);
      const cs = Math.cbrt(s_);

      const oL = 0.2104542553 * cl + 0.7936177850 * cm - 0.0040720468 * cs;
      const oA = 1.9779984951 * cl - 2.4285922050 * cm + 0.4505937099 * cs;
      const oB = 0.0259040371 * cl + 0.7827717662 * cm - 0.8086757660 * cs;

      // OKLAB to OKLCh
      const pxC = Math.sqrt(oA * oA + oB * oB);
      let pxH = Math.atan2(oB, oA) * (180 / Math.PI);
      if (pxH < 0) pxH += 360;

      // ── AB grid: bilinear mesh lookup ──
      if (hasAB && pxC >= 0.005 && oL >= 0.02 && oL <= 0.98) {
        // Convert OKLCh chroma to UI saturation % and clamp
        const satP = (pxC / 0.37) * 100;
        const satC = satP < abSatMin ? abSatMin : satP > 75 ? 75 : satP;

        // Find cell — hue wraps circularly
        const aColF = pxH / abHueStep;
        const aColI = Math.floor(aColF) % abCols;
        const aU = aColF - Math.floor(aColF);
        const aColNext = (aColI + 1) % abCols;

        // Row — saturation (non-wrapping, 2 cells)
        const aRowF = (satC - abSatMin) / abSatStep;
        const aRowI = aRowF < 0 ? 0 : aRowF > 1 ? 1 : Math.floor(aRowF);
        const aV = aRowF - aRowI;
        const aVc = aV < 0 ? 0 : aV > 1 ? 1 : aV;

        // Grid index helper
        const gi = (row: number, col: number) => (row * abCols + col) * 2;
        const aRowNext = aRowI < abRows - 1 ? aRowI + 1 : aRowI;

        // Bilinear interpolation of 4 corners
        const w00 = (1 - aU) * (1 - aVc);
        const w10 = aU * (1 - aVc);
        const w01 = (1 - aU) * aVc;
        const w11 = aU * aVc;

        const abDx = w00 * abGrid![gi(aRowI, aColI)] + w10 * abGrid![gi(aRowI, aColNext)]
                   + w01 * abGrid![gi(aRowNext, aColI)] + w11 * abGrid![gi(aRowNext, aColNext)];
        const abDy = w00 * abGrid![gi(aRowI, aColI) + 1] + w10 * abGrid![gi(aRowI, aColNext) + 1]
                   + w01 * abGrid![gi(aRowNext, aColI) + 1] + w11 * abGrid![gi(aRowNext, aColNext) + 1];

        if (abDx !== 0 || abDy !== 0) {
          let newH = pxH + abDx;
          newH = newH % 360;
          if (newH < 0) newH += 360;

          let newSatP = satP + abDy;
          let newC = (newSatP / 100) * 0.37;
          if (newC < 0) newC = 0;

          // Gamut map (preserves hue and lightness, returns max safe chroma)
          const gmC = gamutMapOkLChInline(oL, newC, newH);

          // Convert OKLCh back to sRGB 0-1 inline
          const nHr = newH * (Math.PI / 180);
          const nA = gmC * Math.cos(nHr);
          const nB = gmC * Math.sin(nHr);

          const nl_ = oL + 0.3963377774 * nA + 0.2158037573 * nB;
          const nm_ = oL - 0.1055613458 * nA - 0.0638541728 * nB;
          const ns_ = oL - 0.0894841775 * nA - 1.2914855480 * nB;

          const nll = nl_ * nl_ * nl_;
          const nlm = nm_ * nm_ * nm_;
          const nls = ns_ * ns_ * ns_;

          let nr = +4.0767416621 * nll - 3.3077115913 * nlm + 0.2309699292 * nls;
          let ng = -1.2684380046 * nll + 2.6097574011 * nlm - 0.3413193965 * nls;
          let nb = -0.0041960863 * nll - 0.7034186147 * nlm + 1.7076147010 * nls;

          rOut = linearToSrgbGamma(nr < 0 ? 0 : nr > 1 ? 1 : nr);
          gOut = linearToSrgbGamma(ng < 0 ? 0 : ng > 1 ? 1 : ng);
          bOut = linearToSrgbGamma(nb < 0 ? 0 : nb > 1 ? 1 : nb);
        }
      }

      // ── CL grid: bilinear mesh lookup ──
      if (hasCL) {
        // Re-derive OKLCh if AB grid modified values
        let curL: number;
        let curC: number;
        let curH: number;

        if (hasAB) {
          const clr = srgbGammaToLinear(rOut);
          const clg = srgbGammaToLinear(gOut);
          const clb = srgbGammaToLinear(bOut);

          const cl_ = 0.4122214708 * clr + 0.5363325363 * clg + 0.0514459929 * clb;
          const cm_ = 0.2119034982 * clr + 0.6806995451 * clg + 0.1073969566 * clb;
          const cs_ = 0.0883024619 * clr + 0.2817188376 * clg + 0.6299787005 * clb;

          curL = 0.2104542553 * Math.cbrt(cl_) + 0.7936177850 * Math.cbrt(cm_) - 0.0040720468 * Math.cbrt(cs_);
          const cA = 1.9779984951 * Math.cbrt(cl_) - 2.4285922050 * Math.cbrt(cm_) + 0.4505937099 * Math.cbrt(cs_);
          const cB = 0.0259040371 * Math.cbrt(cl_) + 0.7827717662 * Math.cbrt(cm_) - 0.8086757660 * Math.cbrt(cs_);

          curC = Math.sqrt(cA * cA + cB * cB);
          curH = Math.atan2(cB, cA) * (180 / Math.PI);
          if (curH < 0) curH += 360;
        } else {
          curL = oL;
          curC = pxC;
          curH = pxH;
        }

        // Neutral protection
        if (!(neutralProtection && curC < 0.005) && curC >= 0.005) {
          // Convert to % and clamp
          const chromaP = (curC / 0.37) * 100;
          const lumP = curL * 100;
          const chromaC = chromaP < clCMin ? clCMin : chromaP > (clCMin + (clCols - 1) * clCStep) ? (clCMin + (clCols - 1) * clCStep) : chromaP;
          const lumC = lumP < clLMin ? clLMin : lumP > (clLMin + (clRows - 1) * clLStep) ? (clLMin + (clRows - 1) * clLStep) : lumP;

          // Find cell
          const cColF = (chromaC - clCMin) / clCStep;
          const cColI = cColF < 0 ? 0 : cColF > clCols - 1 ? clCols - 1 : Math.floor(cColF);
          const cU = cColF - cColI;

          const cRowF = (lumC - clLMin) / clLStep;
          const cRowI = cRowF < 0 ? 0 : cRowF > clRows - 1 ? clRows - 1 : Math.floor(cRowF);
          const cV = cRowF - cRowI;

          const cColNext = cColI < clCols - 1 ? cColI + 1 : cColI;
          const cRowNext = cRowI < clRows - 1 ? cRowI + 1 : cRowI;

          // Grid index helper
          const gi = (row: number, col: number) => (row * clCols + col) * 2;

          // Bilinear interpolation
          const w00 = (1 - cU) * (1 - cV);
          const w10 = cU * (1 - cV);
          const w01 = (1 - cU) * cV;
          const w11 = cU * cV;

          let cDx = w00 * clGrid![gi(cRowI, cColI)] + w10 * clGrid![gi(cRowI, cColNext)]
                  + w01 * clGrid![gi(cRowNext, cColI)] + w11 * clGrid![gi(cRowNext, cColNext)];
          const cDy = w00 * clGrid![gi(cRowI, cColI) + 1] + w10 * clGrid![gi(cRowI, cColNext) + 1]
                    + w01 * clGrid![gi(cRowNext, cColI) + 1] + w11 * clGrid![gi(cRowNext, cColNext) + 1];

          // Axis rotation for hue alignment
          if (!clIsAllAxis) {
            const hRad = curH * Math.PI / 180;
            const hueAlignment = Math.cos(hRad - clAxisHueRad);
            cDx *= hueAlignment > 0 ? hueAlignment : 0;
          }

          if (cDx !== 0 || cDy !== 0) {
            let newC = curC * (1 + cDx / 100);
            if (newC < 0) newC = 0;

            let newL = curL * (1 + cDy / 100);
            if (newL < 0) newL = 0;

            // Gamut map
            const gmC = gamutMapOkLChInline(newL, newC, curH);

            // Convert OKLCh back to sRGB 0-1 inline
            const nHr = curH * (Math.PI / 180);
            const nA = gmC * Math.cos(nHr);
            const nB = gmC * Math.sin(nHr);

            const nl_ = newL + 0.3963377774 * nA + 0.2158037573 * nB;
            const nm_ = newL - 0.1055613458 * nA - 0.0638541728 * nB;
            const ns_ = newL - 0.0894841775 * nA - 1.2914855480 * nB;

            const nll = nl_ * nl_ * nl_;
            const nlm = nm_ * nm_ * nm_;
            const nls = ns_ * ns_ * ns_;

            let nr = +4.0767416621 * nll - 3.3077115913 * nlm + 0.2309699292 * nls;
            let ng = -1.2684380046 * nll + 2.6097574011 * nlm - 0.3413193965 * nls;
            let nb = -0.0041960863 * nll - 0.7034186147 * nlm + 1.7076147010 * nls;

            rOut = linearToSrgbGamma(nr < 0 ? 0 : nr > 1 ? 1 : nr);
            gOut = linearToSrgbGamma(ng < 0 ? 0 : ng > 1 ? 1 : ng);
            bOut = linearToSrgbGamma(nb < 0 ? 0 : nb > 1 ? 1 : nb);
          }
        }
      }
    }

    // ── Step 5: Intensity blending ──
    rOut = origR * inv255 * invIntensity + rOut * intensity;
    gOut = origG * inv255 * invIntensity + gOut * intensity;
    bOut = origB * inv255 * invIntensity + bOut * intensity;

    // ── Step 6: Dither and write back ──
    const px = (i / 4) % width;
    const py = (i / 4) / width | 0;
    const [dr, dg, db] = dither(rOut * 255, gOut * 255, bOut * 255, px, py);
    pixels[i] = dr;
    pixels[i + 1] = dg;
    pixels[i + 2] = db;
  }
}

// ─── Inline gamut map for fast path (returns chroma only; L and h preserved) ───
function gamutMapOkLChInline(L: number, C: number, h: number): number {
  // Try original chroma first
  const hRad = h * (Math.PI / 180);
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const r = +4.0767416621 * l_ * l_ * l_ - 3.3077115913 * m_ * m_ * m_ + 0.2309699292 * s_ * s_ * s_;
  const g = -1.2684380046 * l_ * l_ * l_ + 2.6097574011 * m_ * m_ * m_ - 0.3413193965 * s_ * s_ * s_;
  const bv = -0.0041960863 * l_ * l_ * l_ - 0.7034186147 * m_ * m_ * m_ + 1.7076147010 * s_ * s_ * s_;

  if (r >= -0.001 && r <= 1.001 && g >= -0.001 && g <= 1.001 && bv >= -0.001 && bv <= 1.001) {
    return C;
  }

  // Binary search
  let lo = 0, hi = C;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const ma = mid * Math.cos(hRad);
    const mb = mid * Math.sin(hRad);

    const ml_ = L + 0.3963377774 * ma + 0.2158037573 * mb;
    const mm_ = L - 0.1055613458 * ma - 0.0638541728 * mb;
    const ms_ = L - 0.0894841775 * ma - 1.2914855480 * mb;

    const mr = +4.0767416621 * ml_ * ml_ * ml_ - 3.3077115913 * mm_ * mm_ * mm_ + 0.2309699292 * ms_ * ms_ * ms_;
    const mg = -1.2684380046 * ml_ * ml_ * ml_ + 2.6097574011 * mm_ * mm_ * mm_ - 0.3413193965 * ms_ * ms_ * ms_;
    const mbv = -0.0041960863 * ml_ * ml_ * ml_ - 0.7034186147 * mm_ * mm_ * mm_ + 1.7076147010 * ms_ * ms_ * ms_;

    if (mr >= -0.001 && mr <= 1.001 && mg >= -0.001 && mg <= 1.001 && mbv >= -0.001 && mbv <= 1.001) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}
