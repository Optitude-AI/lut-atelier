/**
 * LUT Engine - Core utilities for LUT generation and color grading
 * Shared between .cube export and image export API routes.
 *
 * Color space: OKLAB (perceptually uniform, Björn Ottosson 2020)
 * Grid operations use OKLCh (polar form) for hue/chroma manipulation.
 *
 * Grid interpolation: Inverse-distance weighted (IDW) from actual node positions.
 * This works with ANY node layout — octagonal, rectangular, irregular, etc.
 *
 * Includes gamut mapping and ordered dithering for output quality.
 *
 * CRITICAL DESIGN RULES:
 * 1. AB Grid MUST preserve L — only modifies hue and chroma, never OKLAB L.
 * 2. CL Grid CAN modify L — that is its purpose (chroma/luminance control).
 * 3. AB saturation shift is MULTIPLICATIVE: newC = pxC * (1 + satShift / 100).
 *    This preserves zero chroma as zero, scales existing chroma proportionally.
 * 4. Identity curve detection uses a shared singleton for reference equality.
 * 5. When no effective changes exist, the pipeline returns original pixels unchanged.
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

// ─── Legacy mesh table types (kept for API compatibility; no longer used internally) ───

/** @deprecated No longer used — IDW interpolation works directly with node arrays */
export interface ABMeshTable {
  grid: Float64Array;
  cols: number;
  rows: number;
  hueStep: number;
  satMin: number;
  satStep: number;
}

/** @deprecated No longer used — IDW interpolation works directly with node arrays */
export interface CLMeshTable {
  grid: Float64Array;
  cols: number;
  rows: number;
  chromaMin: number;
  chromaStep: number;
  lumMin: number;
  lumStep: number;
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
  neutralProtection?: boolean;
  clAxis?: string;
  /** When true, validates that AB grid preserves L and logs violations */
 debugLog?: boolean;
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

// ─── Identity LUT Singleton ───

/**
 * Shared identity LUT: lut[i] = i for all i in 0..255.
 * Used as a sentinel to detect identity curves via reference equality.
 */
const IDENTITY_LUT = (() => {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = i;
  return lut;
})();

// ─── Curve LUT Builder ───

/**
 * Check if a set of curve points represents an identity transform.
 * Identity = only (0,0) and (255,255), OR equivalent two-point line from bottom-left to top-right.
 */
function isCurveIdentity(points: CurvePoint[]): boolean {
  if (!points || points.length === 0) return true;
  if (points.length === 2) {
    const sorted = points[0].x < points[1].x ? points : [points[1], points[0]];
    return sorted[0].x === 0 && sorted[0].y === 0 &&
           sorted[1].x === 255 && sorted[1].y === 255;
  }
  // If more than 2 points, check if all lie on the y=x line
  for (const p of points) {
    if (p.x !== p.y) return false;
  }
  return true;
}

/**
 * Pre-compute a 256-entry lookup table from curve control points.
 * Replaces per-pixel cubicInterpolate calls with O(1) array lookups.
 *
 * Identity curves return the shared IDENTITY_LUT singleton, enabling
 * reference equality checks (lut === IDENTITY_LUT) to skip processing.
 *
 * @param points - Curve control points (x: 0-255, y: 0-255)
 * @returns Uint8Array of 256 entries mapping input value to output value
 */
export function buildCurveLUT(points: CurvePoint[]): Uint8Array {
  // Fast path: identity curve → return shared singleton
  if (isCurveIdentity(points)) return IDENTITY_LUT;

  const lut = new Uint8Array(256);
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

// ─── Legacy Mesh Table Builders (kept as no-ops for API compatibility) ───

/**
 * @deprecated No longer used internally — IDW interpolation works directly with ABNodeArrays.
 * Kept for backward compatibility with callers that still import it.
 */
export function buildABMeshTable(_nodes: GridNode[]): ABMeshTable {
  // Return empty mesh table; interpolation now uses ABNodeArrays directly
  return { grid: new Float64Array(0), cols: 0, rows: 0, hueStep: 30, satMin: 25, satStep: 25 };
}

/**
 * @deprecated No longer used internally — IDW interpolation works directly with CLNodeArrays.
 * Kept for backward compatibility with callers that still import it.
 */
export function buildCLMeshTable(_nodes: CLGridNode[]): CLMeshTable {
  // Return empty mesh table; interpolation now uses CLNodeArrays directly
  return { grid: new Float64Array(0), cols: 0, rows: 0, chromaMin: 10, chromaStep: 15, lumMin: 10, lumStep: 15 };
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
 *
 * FIXED: The original had broken operator precedence:
 *   (r + 0.5) | 0 + (threshold > 0 ? 1 : 0)
 *   = ((r + 0.5) | 0) + (0 or 1)   ← WRONG: adds 1 to 50% of pixels
 *
 * Now uses proper rounding with threshold-based dither offset.
 */
function dither(r: number, g: number, b: number, x: number, y: number): [number, number, number] {
  const bx = x & 3; // % 4
  const by = y & 3; // % 4
  // threshold ranges from approximately -0.5/255 to +0.5/255
  const threshold = (BAYER_4X4[by * 4 + bx] / 16 - 0.5) / 255;
  return [
    Math.max(0, Math.min(255, Math.round(r + threshold * 255))),
    Math.max(0, Math.min(255, Math.round(g + threshold * 255))),
    Math.max(0, Math.min(255, Math.round(b + threshold * 255))),
  ];
}

// ─── A/B Grid Interpolation — Inverse-Distance Weighted ───

/**
 * Interpolate hue/saturation shift from A/B grid using inverse-distance weighting.
 *
 * Instead of assuming a fixed rectangular grid layout, this works with ANY arrangement
 * of nodes on the polar hue-saturation wheel. Each active node's offset contributes
 * to the final shift weighted by 1/(distance² + ε), where distance combines:
 *   - Circular hue distance: min(|h1-h2|, 360-|h1-h2|) weighted ×2 for hue wrapping
 *   - Absolute saturation distance: |s1-s2|
 *
 * Returns [hueShift (degrees), satShift (%), 0].
 *
 * COLOUR SCIENCE: AB grid MUST preserve OKLAB L. The returned offsets are applied
 * as: newH = pxH + hueShift, newC = pxC * (1 + satShift/100). L is never modified.
 */
export function interpolateABGrid(
  nodes: GridNode[],
  pixelR: number, pixelG: number, pixelB: number,
  neutralProtection: boolean = false,
): [number, number, number] {
  // Convert pixel to OKLCh
  const [L, C, h] = srgb01ToOklch(pixelR, pixelG, pixelB);

  // Skip near-neutral or extreme-luminance pixels — no meaningful hue/sat to shift
  if (neutralProtection && C < 0.005) return [0, 0, 0];
  if (C < 0.005 || L < 0.02 || L > 0.98) return [0, 0, 0];

  // Convert pixel OKLCh chroma to UI saturation % for distance calculation
  // OKLCh chroma 0.37 ≈ 100% UI saturation (sRGB gamut boundary)
  const pixelSatPercent = (C / 0.37) * 100;

  // Inverse-distance weighted accumulation
  let totalWeight = 0;
  let weightedHueShift = 0;
  let weightedSatShift = 0;

  const EPSILON = 0.01;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    // Skip inactive nodes
    if (node.offsetX === 0 && node.offsetY === 0) continue;

    // Circular hue distance (wraps at 360°, weighted ×2 because hue is periodic)
    let hueDist = Math.abs(h - node.hue);
    if (hueDist > 180) hueDist = 360 - hueDist;
    const combinedHueDist = hueDist * 2;

    // Absolute saturation distance in %
    const satDist = Math.abs(pixelSatPercent - node.saturation);

    // Combined distance in polar hue-sat space
    const distance = combinedHueDist + satDist;

    // Inverse-distance weight: 1/(d² + ε)
    const weight = 1 / (distance * distance + EPSILON);

    totalWeight += weight;
    weightedHueShift += weight * node.offsetX;  // offsetX = hue shift in degrees
    weightedSatShift += weight * node.offsetY;  // offsetY = saturation shift in %
  }

  if (totalWeight === 0) return [0, 0, 0];

  return [weightedHueShift / totalWeight, weightedSatShift / totalWeight, 0];
}

// ─── C/L Grid Interpolation — Inverse-Distance Weighted ───

/**
 * Interpolate chroma/luminance shift from C/L grid using inverse-distance weighting.
 *
 * Works with ANY arrangement of nodes in the chroma-luminance 2D plane.
 * Each active node's offset contributes to the final shift weighted by 1/(distance² + ε),
 * where distance is Euclidean in the (chroma%, luminance%) space.
 *
 * If clAxis !== 'all': chroma shift is modulated by cos(pixelHue - axisHue) so that
 * only colors aligned with the selected opponent axis are affected.
 *
 * Returns [chromaShift (%), luminanceShift (%)].
 *
 * COLOUR SCIENCE: CL grid CAN modify OKLAB L — that is its design purpose.
 * The luminance shift is applied as: newL = pxL * (1 + lumShift/100).
 */
export function interpolateCLGrid(
  nodes: CLGridNode[],
  pixelR: number, pixelG: number, pixelB: number,
  axis: CLAxisType = 'all',
  neutralProtection: boolean = false,
): [number, number] {
  // Convert pixel to OKLCh
  const [L, C, h] = srgb01ToOklch(pixelR, pixelG, pixelB);

  // Skip near-neutral pixels — no meaningful chroma to shift
  if (neutralProtection && C < 0.005) return [0, 0];
  if (C < 0.005) return [0, 0];

  // Convert to % for distance calculation
  const pixelChromaPercent = (C / 0.37) * 100;
  const pixelLumPercent = L * 100;

  // Inverse-distance weighted accumulation
  let totalWeight = 0;
  let weightedChromaShift = 0;
  let weightedLumShift = 0;

  const EPSILON = 0.01;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    // Skip inactive nodes
    if (node.offsetX === 0 && node.offsetY === 0) continue;

    // Euclidean distance in (chroma%, luminance%) space
    const chromaDist = Math.abs(pixelChromaPercent - node.chroma);
    const lumDist = Math.abs(pixelLumPercent - node.luminance);
    const distance = Math.sqrt(chromaDist * chromaDist + lumDist * lumDist);

    // Inverse-distance weight: 1/(d² + ε)
    const weight = 1 / (distance * distance + EPSILON);

    totalWeight += weight;
    weightedChromaShift += weight * node.offsetX;  // offsetX = chroma shift in %
    weightedLumShift += weight * node.offsetY;       // offsetY = luminance shift in %
  }

  if (totalWeight === 0) return [0, 0];

  let chromaShift = weightedChromaShift / totalWeight;
  const lumShift = weightedLumShift / totalWeight;

  // If clAxis !== 'all': multiply chroma shift by cos(pixelHue - axisHue)
  // This ensures only colors aligned with the opponent axis are affected
  if (axis !== 'all') {
    const axisInfo = CL_AXIS_DIRECTIONS[axis];
    const hRad = h * Math.PI / 180;
    const axRad = axisInfo.hue * Math.PI / 180;
    const hueAlignment = Math.cos(hRad - axRad);
    chromaShift *= Math.max(0, hueAlignment);
  }

  return [chromaShift, lumShift];
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

  // ── Step 3: A/B grid hue/saturation shifts in OKLCh space (IDW interpolation) ──
  // CRITICAL: AB grid MUST preserve OKLAB L — only modifies hue and chroma.

  if (abNodes && abNodes.length > 0 && abNodes.some(n => n.offsetX !== 0 || n.offsetY !== 0)) {
    const [hueShift, satShift] = interpolateABGrid(
      abNodes, rOut, gOut, bOut, neutralProtection
    );

    if (hueShift !== 0 || satShift !== 0) {
      // Convert pixel to OKLCh
      let [pxL, pxC, pxH] = srgb01ToOklch(rOut, gOut, bOut);

      // Apply hue shift (degrees), wrapping at 360°
      let newH = pxH + hueShift;
      newH = ((newH % 360) + 360) % 360;

      // Apply saturation shift: MULTIPLICATIVE (not additive!)
      // This preserves zero chroma as zero, scales existing chroma proportionally.
      // satShift is in % units: -100 = fully desaturated, +100 = double chroma.
      let newC = pxC * (1 + satShift / 100);
      newC = Math.max(0, newC);

      // Gamut map to ensure RGB stays in [0,1]
      // gamutMapOkLCh preserves L and h, only reduces C if needed
      const [gmL, gmC, gmH] = gamutMapOkLCh(pxL, newC, newH);

      // Convert back to sRGB 0-1
      const [abR, abG, abB] = oklchToSrgb01(gmL, gmC, gmH);
      rOut = abR;
      gOut = abG;
      bOut = abB;
    }
  }

  // ── Step 4: C/L grid chroma/luminance shifts in OKLCh space (IDW interpolation) ──
  // CL grid CAN modify L — that is its purpose (chroma/luminance control).

  if (clNodes && clNodes.length > 0 && clNodes.some(n => n.offsetX !== 0 || n.offsetY !== 0)) {
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
      // CL grid is DESIGNED to modify luminance — this is intentional.
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

// ─── Image Pixel Processing (Standard path for export) ───

/**
 * Process raw pixel data (RGBA Uint8ClampedArray) through the color grading pipeline.
 * Modifies the pixel data in-place.
 * Uses IDW grid interpolation, gamut mapping, and ordered dithering.
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

  // Build curve LUTs — identity curves return IDENTITY_LUT singleton
  const masterLUT = (masterCurve && !masterCurve.isLocked)
    ? buildCurveLUT(masterCurve.points)
    : IDENTITY_LUT;
  const lumLUT = (lumCurve && !lumCurve.isLocked)
    ? buildCurveLUT(lumCurve.points)
    : IDENTITY_LUT;
  const rLUT = (rCurve && !rCurve.isLocked)
    ? buildCurveLUT(rCurve.points)
    : IDENTITY_LUT;
  const gLUT = (gCurve && !gCurve.isLocked)
    ? buildCurveLUT(gCurve.points)
    : IDENTITY_LUT;
  const bLUT = (bCurve && !bCurve.isLocked)
    ? buildCurveLUT(bCurve.points)
    : IDENTITY_LUT;

  // Identity detection via reference comparison with shared singleton
  const masterIsIdentity = masterLUT === IDENTITY_LUT;
  const lumIsIdentity = lumLUT === IDENTITY_LUT;
  const rIsIdentity = rLUT === IDENTITY_LUT;
  const gIsIdentity = gLUT === IDENTITY_LUT;
  const bIsIdentity = bLUT === IDENTITY_LUT;
  const allCurvesIdentity = masterIsIdentity && lumIsIdentity && rIsIdentity && gIsIdentity && bIsIdentity;

  // Pre-extract channel data to avoid repeated lookups
  const masterChannel = channelData['master'];
  const rChannel = channelData['r'];
  const gChannel = channelData['g'];
  const bChannel = channelData['b'];

  const hasMasterChannel = masterChannel && masterChannel.enabled;
  const hasRChannel = rChannel && rChannel.enabled;
  const hasGChannel = gChannel && gChannel.enabled;
  const hasBChannel = bChannel && bChannel.enabled;
  const hasAnyChannel = hasMasterChannel || hasRChannel || hasGChannel || hasBChannel;

  // Check if any grids have active nodes
  const hasActiveABNodes = abNodes && abNodes.length > 0 && abNodes.some(n => n.offsetX !== 0 || n.offsetY !== 0);
  const hasActiveCLNodes = clNodes && clNodes.length > 0 && clNodes.some(n => n.offsetX !== 0 || n.offsetY !== 0);

  // ── EARLY EXIT: If absolutely nothing would change the pixels, skip processing ──
  if (allCurvesIdentity && !hasAnyChannel && !hasActiveABNodes && !hasActiveCLNodes) {
    return; // Return original pixels unchanged — zero darkening, zero quantization
  }

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
    if (!masterIsIdentity) {
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
    if (!lumIsIdentity) {
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

    // Individual R, G, B curves via LUT (always apply — even identity LUTs are fine since lut[i]=i)
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
    if (hasMasterChannel) {
      rOut = applyChannelAdjustment(rOut, masterChannel);
      gOut = applyChannelAdjustment(gOut, masterChannel);
      bOut = applyChannelAdjustment(bOut, masterChannel);
    }
    if (hasRChannel) rOut = applyChannelAdjustment(rOut, rChannel);
    if (hasGChannel) gOut = applyChannelAdjustment(gOut, gChannel);
    if (hasBChannel) bOut = applyChannelAdjustment(bOut, bChannel);

    // ── Step 3: A/B grid hue/saturation shifts via IDW interpolation ──
    if (hasActiveABNodes) {
      const [hueShift, satShift] = interpolateABGrid(
        abNodes!, rOut, gOut, bOut, neutralProtection
      );

      if (hueShift !== 0 || satShift !== 0) {
        let [pxL, pxC, pxH] = srgb01ToOklch(rOut, gOut, bOut);

        let newH = pxH + hueShift;
        newH = ((newH % 360) + 360) % 360;

        // MULTIPLICATIVE saturation shift — preserves L, scales C proportionally
        let newC = pxC * (1 + satShift / 100);
        newC = Math.max(0, newC);

        // Gamut map (preserves pxL)
        const [gmL, gmC, gmH] = gamutMapOkLCh(pxL, newC, newH);

        const [abR, abG, abB] = oklchToSrgb01(gmL, gmC, gmH);
        rOut = abR;
        gOut = abG;
        bOut = abB;
      }
    }

    // ── Step 4: C/L grid chroma/luminance shifts via IDW interpolation ──
    if (hasActiveCLNodes) {
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

// ─── Color Debug Logger ───

/** Single log entry for the color debug logger */
interface ColorDebugEntry {
  timestamp: number;
  message: string;
  data?: Record<string, number | string>;
}

/** Circular buffer logger for color pipeline debug output (max 100 entries) */
class ColorDebugLoggerImpl {
  private buffer: ColorDebugEntry[] = [];
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  log(message: string, data?: Record<string, number | string>): void {
    this.buffer.push({
      timestamp: performance.now(),
      message,
      data,
    });
    // Keep only last maxSize entries
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  getLog(): ColorDebugEntry[] {
    return this.buffer.slice();
  }

  clear(): void {
    this.buffer.length = 0;
  }

  get size(): number {
    return this.buffer.length;
  }
}

/** Singleton debug logger instance shared across the pipeline */
const colorDebugLogger = new ColorDebugLoggerImpl(100);

/**
 * Create (or access) the shared color debug logger.
 * Returns a logger with `log(message, data)` and `getLog()` methods.
 * Keeps only the last 100 entries in a circular buffer.
 *
 * Usage:
 *   const logger = createColorDebugLogger();
 *   logger.log('AB grid applied', { originalL: 0.5, newL: 0.5001, delta: 0.0001 });
 *   const entries = logger.getLog();
 */
export function createColorDebugLogger(): typeof colorDebugLogger {
  return colorDebugLogger;
}

// ─── Inline gamut map for fast path (returns chroma only; L and h preserved) ───

/**
 * Inlined gamut mapping for the fast pixel loop.
 * Returns the maximum safe chroma value that keeps the color within sRGB gamut.
 * Preserves lightness (L) and hue (h).
 */
function gamutMapOkLChInline(L: number, C: number, h: number): number {
  const hRad = h * (Math.PI / 180);
  const cosH = Math.cos(hRad);
  const sinH = Math.sin(hRad);

  const a = C * cosH;
  const b = C * sinH;

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const lll = l_ * l_ * l_;
  const lmm = m_ * m_ * m_;
  const lss = s_ * s_ * s_;

  const r = +4.0767416621 * lll - 3.3077115913 * lmm + 0.2309699292 * lss;
  const g = -1.2684380046 * lll + 2.6097574011 * lmm - 0.3413193965 * lss;
  const bv = -0.0041960863 * lll - 0.7034186147 * lmm + 1.7076147010 * lss;

  if (r >= -0.001 && r <= 1.001 && g >= -0.001 && g <= 1.001 && bv >= -0.001 && bv <= 1.001) {
    return C;
  }

  // Binary search for max chroma within gamut
  let lo = 0, hi = C;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const ma = mid * cosH;
    const mb = mid * sinH;

    const ml_ = L + 0.3963377774 * ma + 0.2158037573 * mb;
    const mm_ = L - 0.1055613458 * ma - 0.0638541728 * mb;
    const ms_ = L - 0.0894841775 * ma - 1.2914855480 * mb;

    const mll = ml_ * ml_ * ml_;
    const mmm = mm_ * mm_ * mm_;
    const mss = ms_ * ms_ * ms_;

    const mr = +4.0767416621 * mll - 3.3077115913 * mmm + 0.2309699292 * mss;
    const mg = -1.2684380046 * mll + 2.6097574011 * mmm - 0.3413193965 * mss;
    const mbv = -0.0041960863 * mll - 0.7034186147 * mmm + 1.7076147010 * mss;

    if (mr >= -0.001 && mr <= 1.001 && mg >= -0.001 && mg <= 1.001 && mbv >= -0.001 && mbv <= 1.001) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

// ─── Fast Image Pixel Processing (Primary preview path) ───

/**
 * Optimized pixel processing using pre-built curve LUTs and typed array node data.
 * This is the HIGH-PERFORMANCE path used by ImageViewer for real-time previews.
 *
 * Key fixes in this version:
 * 1. IDW grid interpolation works with ANY node layout (no more broken rectangular grid assumptions)
 * 2. AB saturation shift is MULTIPLICATIVE: newC = pxC * (1 + satShift/100) — no more additive crushing
 * 3. AB grid preserves OKLAB L — only modifies hue and chroma
 * 4. Identity curve detection via shared IDENTITY_LUT singleton — enables early exit
 * 5. Dithering uses proper Math.round() — no more broken operator precedence
 * 6. Entire pipeline skipped when no effective changes exist — no more quantization darkening
 *
 * Performance characteristics:
 * - O(1) curve lookups via pre-built Uint8Array LUTs
 * - O(N) IDW grid interpolation where N = active nodes (max ~25)
 * - Inline OKLAB conversions to avoid function call overhead
 * - Gamut mapping inline with binary search (max 12 iterations)
 * - Early exit when all adjustments are identity
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
  const neutralProtection = params.neutralProtection ?? false;
  const clAxis = (params.clAxis ?? 'all') as CLAxisType;
  const doDebugLog = params.debugLog ?? false;

  const intensity = Math.max(0, Math.min(1, params.globalIntensity / 100));
  const invIntensity = 1 - intensity;

  // Pre-extract channel data
  const masterChannel = channelData['master'];
  const rChannel = channelData['r'];
  const gChannel = channelData['g'];
  const bChannel = channelData['b'];

  // Channel adjustment flags
  const hasMaster = !!(masterChannel && masterChannel.enabled);
  const hasR = !!(rChannel && rChannel.enabled);
  const hasG = !!(gChannel && gChannel.enabled);
  const hasB = !!(bChannel && bChannel.enabled);
  const hasAnyChannel = hasMaster || hasR || hasG || hasB;

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

  // AB/CL node arrays (typed arrays for cache-friendly iteration)
  const abNodes = params.abNodes;
  const clNodes = params.clNodes;
  const hasAB = abNodes.count > 0;
  const hasCL = clNodes.count > 0;

  // Pre-extract AB typed arrays
  const abHues = abNodes.hues;
  const abSats = abNodes.sats;
  const abOffsetXs = abNodes.offsetXs;
  const abOffsetYs = abNodes.offsetYs;
  const abCount = abNodes.count;

  // Pre-extract CL typed arrays
  const clChromas = clNodes.chromas;
  const clLums = clNodes.lums;
  const clOffsetXs = clNodes.offsetXs;
  const clOffsetYs = clNodes.offsetYs;
  const clCount = clNodes.count;

  // Pre-compute CL axis hue for axis rotation
  const clAxisHue = CL_AXIS_DIRECTIONS[clAxis]?.hue ?? 0;
  const clAxisHueRad = clAxisHue * Math.PI / 180;
  const clIsAllAxis = clAxis === 'all';

  // Identity detection via reference comparison with shared singleton
  const masterIsIdentity = masterLUT === IDENTITY_LUT;
  const lumIsIdentity = lumLUT === IDENTITY_LUT;
  const rIsIdentity = rLUT === IDENTITY_LUT;
  const gIsIdentity = gLUT === IDENTITY_LUT;
  const bIsIdentity = bLUT === IDENTITY_LUT;
  const allCurvesIdentity = masterIsIdentity && lumIsIdentity && rIsIdentity && gIsIdentity && bIsIdentity;

  // Check if any grid processing is needed
  const needsOKLCh = hasAB || hasCL;

  // ── EARLY EXIT: If nothing would change the pixels, skip processing entirely ──
  // This prevents the subtle darkening caused by quantization through a no-op pipeline
  if (allCurvesIdentity && !hasAnyChannel && !needsOKLCh) {
    return; // Original pixels unchanged — zero darkening
  }

  const totalPixels = pixels.length;
  const inv255 = 1 / 255;

  // Debug counter for luminance lock violations (logged, not thrown)
  let debugViolationCount = 0;

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

    // ── Step 3 & 4: Grid shifts via IDW interpolation ──
    if (needsOKLCh) {
      // Convert sRGB 0-1 to OKLCh (inlined for performance)
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

      // ── AB grid: IDW interpolation from typed arrays ──
      // Hoist AB state so CL grid can check if AB modified the pixel
      let abTotalWeight = 0;
      let abModified = false;

      if (hasAB && pxC >= 0.005 && oL >= 0.02 && oL <= 0.98) {
        // Pixel saturation in UI % units
        const pixelSatP = (pxC / 0.37) * 100;

        let abWeightedHueShift = 0;
        let abWeightedSatShift = 0;
        const AB_EPS = 0.01;

        for (let n = 0; n < abCount; n++) {
          // Circular hue distance (weighted ×2 for periodicity)
          let hueDist = Math.abs(pxH - abHues[n]);
          if (hueDist > 180) hueDist = 360 - hueDist;

          // Absolute saturation distance
          const satDist = Math.abs(pixelSatP - abSats[n]);

          // Combined distance
          const dist = hueDist * 2 + satDist;
          const w = 1 / (dist * dist + AB_EPS);

          abTotalWeight += w;
          abWeightedHueShift += w * abOffsetXs[n];
          abWeightedSatShift += w * abOffsetYs[n];
        }

        if (abTotalWeight > 0) {
          const abHueShift = abWeightedHueShift / abTotalWeight;
          const abSatShift = abWeightedSatShift / abTotalWeight;

          if (abHueShift !== 0 || abSatShift !== 0) {
            let newH = pxH + abHueShift;
            newH = newH % 360;
            if (newH < 0) newH += 360;

            // MULTIPLICATIVE saturation shift — preserves L, scales C
            let newC = pxC * (1 + abSatShift / 100);
            if (newC < 0) newC = 0;

            // Gamut map (preserves oL)
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
            abModified = true;

            // ── Luminance lock validation (debug mode only) ──
            // Verify that AB grid preserved L as required by design.
            // If debugLog is enabled, log violations where L drifted beyond tolerance.
            // NOTE: This re-derives L from the output sRGB, which incurs gamma round-trip,
            // so a tolerance of 0.01 is used (gamut mapping + gamma quantization can shift L slightly).
            if (doDebugLog && debugViolationCount < 20) {
              const dbgLR = srgbGammaToLinear(rOut);
              const dbgLG = srgbGammaToLinear(gOut);
              const dbgLB = srgbGammaToLinear(bOut);
              const dbgL_ = 0.4122214708 * dbgLR + 0.5363325363 * dbgLG + 0.0514459929 * dbgLB;
              const dbgm_ = 0.2119034982 * dbgLR + 0.6806995451 * dbgLG + 0.1073969566 * dbgLB;
              const dbs_ = 0.0883024619 * dbgLR + 0.2817188376 * dbgLG + 0.6299787005 * dbgLB;
              const dbgNewL = 0.2104542553 * Math.cbrt(dbgL_) + 0.7936177850 * Math.cbrt(dbgm_) - 0.0040720468 * Math.cbrt(dbs_);
              const lDelta = Math.abs(dbgNewL - oL);
              if (lDelta > 0.01) {
                colorDebugLogger.log('AB grid L drift detected', {
                  originalL: +oL.toFixed(6),
                  afterRoundTripL: +dbgNewL.toFixed(6),
                  delta: +lDelta.toFixed(6),
                  pixel: `${origR},${origG},${origB}`,
                });
                debugViolationCount++;
              }
            }
          }
        }
      }

      // ── CL grid: IDW interpolation from typed arrays ──
      if (hasCL) {
        // Re-derive OKLCh if AB grid modified values
        let curL: number;
        let curC: number;
        let curH: number;

        if (abModified) {
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
          const pixelChromaP = (curC / 0.37) * 100;
          const pixelLumP = curL * 100;

          let clTotalWeight = 0;
          let clWeightedChromaShift = 0;
          let clWeightedLumShift = 0;
          const CL_EPS = 0.01;

          for (let n = 0; n < clCount; n++) {
            // Euclidean distance in (chroma%, luminance%) space
            const chromaDist = Math.abs(pixelChromaP - clChromas[n]);
            const lumDist = Math.abs(pixelLumP - clLums[n]);
            const dist = Math.sqrt(chromaDist * chromaDist + lumDist * lumDist);
            const w = 1 / (dist * dist + CL_EPS);

            clTotalWeight += w;
            clWeightedChromaShift += w * clOffsetXs[n];
            clWeightedLumShift += w * clOffsetYs[n];
          }

          if (clTotalWeight > 0) {
            let cDx = clWeightedChromaShift / clTotalWeight;
            const cDy = clWeightedLumShift / clTotalWeight;

            // Axis rotation for hue alignment
            if (!clIsAllAxis) {
              const hRad = curH * Math.PI / 180;
              const hueAlignment = Math.cos(hRad - clAxisHueRad);
              cDx *= hueAlignment > 0 ? hueAlignment : 0;
            }

            if (cDx !== 0 || cDy !== 0) {
              let newC = curC * (1 + cDx / 100);
              if (newC < 0) newC = 0;

              // CL grid CAN modify L — that is its design purpose
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
