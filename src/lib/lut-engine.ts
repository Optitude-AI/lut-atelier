/**
 * Chroma Forge — Perceptual Color Grading Engine
 *
 * Architecture:
 *   sRGB ──gamma──► Linear RGB ──curves+channels──► OKLAB ──AB grid deform──► OKLAB' ──CL grid──► OKLAB'' ──gamut clip──► Linear RGB ──gamma──► sRGB
 *
 * The AB grid operates in OKLAB perceptual color space (Hue-Chroma-Lightness):
 *   - Equal hue steps = equal perceived hue differences
 *   - Equal chroma steps = equal perceived saturation differences
 *   - No hue shift when adjusting chroma (unlike HSL)
 *   - Gamut boundary awareness prevents clipping artefacts
 *
 * The CL grid operates in OKLAB chroma/luminance space.
 */

import {
  linearRGBToOKLAB,
  oklabToLinearRGB,
  gamutClipOKLAB,
  srgbGammaToLinear,
  linearToSrgbGamma,
} from './oklab';

// ─── Inlined OKLAB matrix constants (hot-loop performance) ───
// Duplicated from oklab.ts to avoid function-call overhead in per-pixel loops.

/** sRGB linear → LMS (cone responses, based on Hunt-Pointer-Estévez) */
const M1_00 = 0.4122214708, M1_01 = 0.5363325363, M1_02 = 0.0514459929;
const M1_10 = 0.2119034982, M1_11 = 0.6806995451, M1_12 = 0.1073969566;
const M1_20 = 0.0883024619, M1_21 = 0.2817188376, M1_22 = 0.6299787005;

/** LMS' → OKLAB */
const M2_00 = 0.2104542553, M2_01 = 0.7936177850, M2_02 = -0.0040720468;
const M2_10 = 1.9779984951, M2_11 = -2.4285922050, M2_12 = 0.4505937099;
const M2_20 = 0.0259040371, M2_21 = 0.7827717662, M2_22 = -0.8086757660;

/** OKLAB → LMS' (inverse of M2) */
const MI2_00 = 1.0, MI2_01 = 0.3963377774, MI2_02 = 0.2158037573;
const MI2_10 = 1.0, MI2_11 = -0.1055613458, MI2_12 = -0.0638541728;
const MI2_20 = 1.0, MI2_21 = -0.0894841775, MI2_22 = -1.2914855480;

/** LMS → sRGB linear (inverse of M1) */
const MI1_00 = +4.0767416621, MI1_01 = -3.3077115913, MI1_02 = +0.2309699292;
const MI1_10 = -1.2684380046, MI1_11 = +2.6097574011, MI1_12 = -0.3413193965;
const MI1_20 = -0.0041960863, MI1_21 = -0.7034186147, MI1_22 = +1.7076147010;

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
  hueSigma?: number;   // per-node hue sigma override (0 = use global)
  satSigma?: number;    // per-node sat sigma override (0 = use global)
  sigmaMult?: number;   // per-node sigma multiplier (default 1.0)
  pinned?: boolean;     // per-node pin flag
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
  hueSigmas: Float64Array;  // per-node hue sigma (0 = use global)
  satSigmas: Float64Array;  // per-node sat sigma (0 = use global)
  sigmaMults: Float64Array; // per-node sigma multiplier
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
  abGlobalHueSigma?: number;  // global AB hue sigma (default 65)
  abGlobalSatSigma?: number;  // global AB sat sigma (default 65)
}

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
      hueSigmas: new Float64Array(0),
      satSigmas: new Float64Array(0),
      sigmaMults: new Float64Array(0),
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
  const hueSigmas = new Float64Array(activeCount);
  const satSigmas = new Float64Array(activeCount);
  const sigmaMults = new Float64Array(activeCount);

  let idx = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.offsetX !== 0 || n.offsetY !== 0) {
      hues[idx] = n.hue;
      sats[idx] = n.saturation;
      lums[idx] = n.lightness;
      offsetXs[idx] = n.offsetX;
      offsetYs[idx] = n.offsetY;
      hueSigmas[idx] = n.hueSigma || n.abHueSigma || 0;   // 0 means "use global default"
      satSigmas[idx] = n.satSigma || n.abSatSigma || 0;    // 0 means "use global default"
      sigmaMults[idx] = n.sigmaMult || 1.0; // default multiplier
      idx++;
    }
  }

  return { hues, sats, lums, offsetXs, offsetYs, hueSigmas, satSigmas, sigmaMults, count: activeCount };
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

// ─── Color Space Conversions (0-1 float) ───

/**
 * Convert HSL (h: 0-360, s: 0-100, l: 0-100) to RGB (0-1 each).
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

// ─── A/B Grid Interpolation ───

/**
 * Interpolate hue/saturation shift from A/B grid nodes.
 * Returns [hueShift, saturationShift] based on inverse-distance weighting.
 * Offsets in the A/B grid: X = hue shift (degrees), Y = saturation shift (% multiplicative).
 * saturationShift is applied as: newS = s * (1 + satShift / 100)
 * This makes changes proportional — low-sat pixels won't clamp to 0.
 */
export function interpolateABGrid(
  nodes: GridNode[],
  h: number,
  s: number,
  l: number,
  globalHueSigma: number = 25,
  globalSatSigma: number = 18,
): [number, number] {
  // Skip for very low saturation or lightness extremes
  if (s < 5 || l < 3 || l > 97) return [0, 0];

  let totalWeight = 0;
  let hueShift = 0;
  let satShift = 0;

  for (const node of nodes) {
    if (node.offsetX === 0 && node.offsetY === 0) continue;

    // Hue distance (circular, 0-180)
    let hueDist = Math.abs(h - node.hue);
    if (hueDist > 180) hueDist = 360 - hueDist;

    // Saturation distance
    const satDist = Math.abs(s - node.saturation);

    // Anisotropic falloff: separate hue and saturation sigma per node
    const effHueSigma = (node.hueSigma && node.hueSigma > 0 ? node.hueSigma : globalHueSigma) * (node.sigmaMult || 1.0);
    const effSatSigma = (node.satSigma && node.satSigma > 0 ? node.satSigma : globalSatSigma) * (node.sigmaMult || 1.0);

    const weight = Math.exp(
      -(hueDist * hueDist) / (2 * effHueSigma * effHueSigma)
      - (satDist * satDist) / (2 * effSatSigma * effSatSigma)
    );

    totalWeight += weight;
    hueShift += node.offsetX * weight;
    satShift += node.offsetY * weight;
  }

  if (totalWeight === 0) return [0, 0];

  return [hueShift / totalWeight, satShift / totalWeight];
}

// ─── C/L Grid Interpolation ───

/**
 * Interpolate chroma/luminance shift from C/L grid nodes.
 * Returns [chromaShift, luminanceShift] based on inverse-distance weighting.
 * Offsets in C/L grid: X = chroma shift (%), Y = luminance shift (%).
 */
export function interpolateCLGrid(
  nodes: CLGridNode[],
  h: number,
  s: number,
  l: number
): [number, number] {
  // Skip for very low saturation
  if (s < 3) return [0, 0];

  let totalWeight = 0;
  let chromaShift = 0;
  let lumShift = 0;

  for (const node of nodes) {
    if (node.offsetX === 0 && node.offsetY === 0) continue;

    // Chroma distance
    const chromaDist = Math.abs(s - node.chroma);

    // Luminance distance
    const lumDist = Math.abs(l - node.luminance);

    // Combined distance — chroma + luminance (correct for C/L grid)
    const dist = Math.sqrt(chromaDist * chromaDist + lumDist * lumDist);

    // Inverse distance weight with Gaussian falloff
    const sigma = 40; // Moderate-wide spread — chroma/lum shifts affect nearby tonal ranges
    const weight = Math.exp(-(dist * dist) / (2 * sigma * sigma));

    totalWeight += weight;
    chromaShift += node.offsetX * weight;
    lumShift += node.offsetY * weight;
  }

  if (totalWeight === 0) return [0, 0];

  return [chromaShift / totalWeight, lumShift / totalWeight];
}

// ─── Channel Adjustments ───

/**
 * Apply gain, gamma, lift, and offset adjustments to a single channel value (0-1).
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
}

/**
 * Apply the full color grading pipeline to a single RGB pixel (0-1 each).
 * Returns the graded [R, G, B] clamped to [0, 1].
 */
export function applyColorGradePixel(
  r: number,
  g: number,
  b: number,
  params: ColorGradeParams
): [number, number, number] {
  const { curveData, channelData, abNodes, clNodes, globalIntensity } = params;

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

  // ── Step 2: Channel adjustments (gain, gamma, lift, offset) ──

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

  // ── Step 3: A/B grid — perceptual hue/chroma shifts in OKLAB ──
  if (abNodes && abNodes.length > 0) {
    const [okL, okA, okB] = linearRGBToOKLAB(rOut, gOut, bOut);
    const okChroma = Math.sqrt(okA * okA + okB * okB);
    const okLPct = okL * 100;

    if (okChroma > 0.003 && okLPct > 2 && okLPct < 98) {
      let okHueDeg = Math.atan2(okB, okA) * (180 / Math.PI);
      if (okHueDeg < 0) okHueDeg += 360;
      const okChromaPct = okChroma * 500;

      // Convert GridNode[] offsets to compatible format for interpolateABGrid
      // Node hues are in OKLAB degrees, saturations are OKLAB chroma × 500
      const [hueShift, chromaShift] = interpolateABGrid(abNodes, okHueDeg, okChromaPct, okLPct);

      let newHueRad = (okHueDeg + hueShift) * (Math.PI / 180);
      let newChroma = okChroma * (1 + chromaShift / 100);
      if (newChroma < 0) newChroma = 0;

      let newA = newChroma * Math.cos(newHueRad);
      let newB = newChroma * Math.sin(newHueRad);

      // Gamut clip
      [newA, newB] = gamutClipOKLAB(okL, newA, newB, 'soft');

      const [abR, abG, abB] = oklabToLinearRGB(okL, newA, newB);
      rOut = abR;
      gOut = abG;
      bOut = abB;
    }
  }

  // ── Step 4: C/L grid — chroma/luminance shaping in OKLAB ──
  if (clNodes && clNodes.length > 0) {
    const [okL, okA, okB] = linearRGBToOKLAB(rOut, gOut, bOut);
    const okChroma = Math.sqrt(okA * okA + okB * okB);
    const okLPct = okL * 100;
    const okChromaPct = okChroma * 500;

    if (okChromaPct >= 1.5) {
      const [chromaShift, lumShift] = interpolateCLGrid(clNodes, 0, okChromaPct, okLPct);

      let newCLChroma = okChroma + chromaShift * 0.004;
      if (newCLChroma < 0) newCLChroma = 0;

      let newCLLum = okL + lumShift * 0.01;
      if (newCLLum < 0) newCLLum = 0;
      if (newCLLum > 1) newCLLum = 1;

      const hueAngle = Math.atan2(okB, okA);
      const finalCLA = newCLChroma * Math.cos(hueAngle);
      const finalCLB = newCLChroma * Math.sin(hueAngle);

      const [clR, clG, clB] = oklabToLinearRGB(newCLLum, finalCLA, finalCLB);
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
 * Optimized internally to use curve LUTs for O(1) lookups instead of per-pixel cubic interpolation.
 */
export function processImagePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  params: ColorGradeParams
): void {
  // ── Pre-build curve LUTs ──
  const { curveData, channelData, abNodes, clNodes, globalIntensity } = params;

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

  // Check if any grids have active nodes (to skip HSL conversions)
  const hasActiveABNodes = abNodes && abNodes.length > 0 && abNodes.some(n => n.offsetX !== 0 || n.offsetY !== 0);
  const hasActiveCLNodes = clNodes && clNodes.length > 0 && clNodes.some(n => n.offsetX !== 0 || n.offsetY !== 0);

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
      const avgRound = (avg + 0.5) | 0; // Fast round
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

    // ── Step 3 & 4: Perceptual colour deformation in OKLAB ──
    if (hasActiveABNodes || hasActiveCLNodes) {
      // sRGB → Linear (required before OKLAB)
      rOut = srgbGammaToLinear(rOut);
      gOut = srgbGammaToLinear(gOut);
      bOut = srgbGammaToLinear(bOut);

      const [okL, okA, okB] = linearRGBToOKLAB(rOut, gOut, bOut);
      const okChroma = Math.sqrt(okA * okA + okB * okB);
      const okLPct = okL * 100;

      if (okChroma > 0.003 && okLPct > 2 && okLPct < 98) {
        let okHueDeg = Math.atan2(okB, okA) * (180 / Math.PI);
        if (okHueDeg < 0) okHueDeg += 360;
        const okChromaPct = okChroma * 500;

        if (hasActiveABNodes) {
          const [hueShift, chromaShift] = interpolateABGrid(abNodes!, okHueDeg, okChromaPct, okLPct);
          let newHueRad = (okHueDeg + hueShift) * (Math.PI / 180);
          let newChroma = okChroma * (1 + chromaShift / 100);
          if (newChroma < 0) newChroma = 0;

          let newA = newChroma * Math.cos(newHueRad);
          let newB = newChroma * Math.sin(newHueRad);

          const [cA, cB] = gamutClipOKLAB(okL, newA, newB, 'soft');
          const [abR, abG, abB] = oklabToLinearRGB(okL, cA, cB);
          rOut = abR;
          gOut = abG;
          bOut = abB;
        }

        if (hasActiveCLNodes) {
          // Re-derive OKLAB if AB grid modified values
          let curL: number, curA: number, curB: number, curChroma: number;
          if (hasActiveABNodes) {
            [curL, curA, curB] = linearRGBToOKLAB(rOut, gOut, bOut);
            curChroma = Math.sqrt(curA * curA + curB * curB);
          } else {
            curL = okL; curA = okA; curB = okB; curChroma = okChroma;
          }

          const curChromaPct = curChroma * 500;
          const curLPct = curL * 100;

          if (curChromaPct >= 1.5) {
            const [chromaShift, lumShift] = interpolateCLGrid(clNodes!, 0, curChromaPct, curLPct);
            let newCLChroma = curChroma + chromaShift * 0.004;
            if (newCLChroma < 0) newCLChroma = 0;
            let newCLLum = curL + lumShift * 0.01;
            if (newCLLum < 0) newCLLum = 0;
            if (newCLLum > 1) newCLLum = 1;

            const hueAngle = Math.atan2(curB, curA);
            const finalCLA = newCLChroma * Math.cos(hueAngle);
            const finalCLB = newCLChroma * Math.sin(hueAngle);

            const [clR, clG, clB] = oklabToLinearRGB(newCLLum, finalCLA, finalCLB);
            rOut = clR;
            gOut = clG;
            bOut = clB;
          }
        }
      }

      // Linear → sRGB (convert back after OKLAB processing)
      rOut = linearToSrgbGamma(rOut);
      gOut = linearToSrgbGamma(gOut);
      bOut = linearToSrgbGamma(bOut);
    }

    // ── Step 5: Intensity blending ──
    rOut = (origR / 255) * invIntensity + rOut * intensity;
    gOut = (origG / 255) * invIntensity + gOut * intensity;
    bOut = (origB / 255) * invIntensity + bOut * intensity;

    // ── Step 6: Clamp and write back ──
    pixels[i] = (rOut * 255 + 0.5) | 0;
    pixels[i + 1] = (gOut * 255 + 0.5) | 0;
    pixels[i + 2] = (bOut * 255 + 0.5) | 0;
  }
}

// ─── Fast Image Pixel Processing ───

/**
 * Optimized pixel processing using pre-built curve LUTs and typed array node data.
 * This is the high-performance path for real-time previews and batch processing.
 *
 * Key optimizations over processImagePixels:
 * - O(1) curve lookups via pre-built Uint8Array LUTs
 * - Flat typed arrays for grid node data (cache-friendly)
 * - Skips AB grid entirely when no active nodes
 * - Skips CL grid and second HSL conversion when no active CL nodes
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
  const abData = params.abNodes;
  const clData = params.clNodes;

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

  // AB node typed arrays
  const hasAB = abData.count > 0;
  const abHues = abData.hues;
  const abSats = abData.sats;
  const abLums = abData.lums;
  const abOffX = abData.offsetXs;
  const abOffY = abData.offsetYs;
  const abHueSigmas = abData.hueSigmas;
  const abSatSigmas = abData.satSigmas;
  const abSigmaMults = abData.sigmaMults;
  const abCount = abData.count;

  // CL node typed arrays
  const hasCL = clData.count > 0;
  const clChromas = clData.chromas;
  const clLums = clData.lums;
  const clOffX = clData.offsetXs;
  const clOffY = clData.offsetYs;
  const clCount = clData.count;

  // Pre-compute 1/(2*sigma^2) for CL grid (AB uses per-node anisotropic sigma)
  const CL_INV_2SIGMA2 = 1 / (2 * 40 * 40); // sigma = 40

  // AB global sigma: use params if provided, otherwise reasonable defaults
  // 25° hue sigma gives good selectivity between 22.5° branches
  // 18% sat sigma gives good selectivity between ring positions
  const AB_GLOBAL_HUE_SIGMA = params.abGlobalHueSigma || 25;
  const AB_GLOBAL_SAT_SIGMA = params.abGlobalSatSigma || 18;

  // Check if LUTs are identity (avoid unnecessary work)
  const hasMasterCurve = masterLUT !== rLUT; // heuristic: if they differ, master was custom-built
  // More robust: check if any entry differs from identity
  let masterIsIdentity = true;
  let lumIsIdentity = true;
  for (let q = 0; q < 256; q++) {
    if (masterLUT[q] !== q) { masterIsIdentity = false; break; }
  }
  for (let q = 0; q < 256; q++) {
    if (lumLUT[q] !== q) { lumIsIdentity = false; break; }
  }

  // Check if any grid processing is needed at all
  const needsHSL = hasAB || hasCL;

  const totalPixels = pixels.length;
  const inv255 = 1 / 255;

  // ── sRGB gamma ↔ linear LUTs (4096 entries for 12-bit precision) ──
  const SRGB_TO_LIN = new Float64Array(4096);
  const LIN_TO_SRGB_U8 = new Uint8Array(4096);
  for (let _gi = 0; _gi < 4096; _gi++) {
    const _c = _gi / 4095;
    SRGB_TO_LIN[_gi] = _c >= 0.04045
      ? Math.pow((_c + 0.055) / 1.055, 2.4)
      : _c / 12.92;
    const _g = _c >= 0.0031308
      ? 1.055 * Math.pow(_c, 1.0 / 2.4) - 0.055
      : 12.92 * _c;
    LIN_TO_SRGB_U8[_gi] = Math.min(255, Math.max(0, (_g * 255 + 0.5) | 0));
  }

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
    // Clamp to 0-255
    rIn = rLUT[rIdx < 0 ? 0 : rIdx > 255 ? 255 : rIdx];
    gIn = gLUT[gIdx < 0 ? 0 : gIdx > 255 ? 255 : gIdx];
    bIn = bLUT[bIdx < 0 ? 0 : bIdx > 255 ? 255 : bIdx];

    // Convert to 0-1
    let rOut = rIn * inv255;
    let gOut = gIn * inv255;
    let bOut = bIn * inv255;

    // ── Step 2: Channel adjustments (inlined for speed) ──
    if (hasMaster) {
      // Lift
      if (mLift !== 0) {
        rOut = rOut + mLift * (1 - rOut);
        gOut = gOut + mLift * (1 - gOut);
        bOut = bOut + mLift * (1 - bOut);
      }
      // Gain
      if (mGain !== 0) {
        rOut = rOut * (1 + mGain);
        gOut = gOut * (1 + mGain);
        bOut = bOut * (1 + mGain);
      }
      // Gamma
      if (mGamma > 0 && mGamma !== 1) {
        rOut = Math.pow(rOut > 0 ? rOut : 0, 1 / mGamma);
        gOut = Math.pow(gOut > 0 ? gOut : 0, 1 / mGamma);
        bOut = Math.pow(bOut > 0 ? bOut : 0, 1 / mGamma);
      }
      // Offset
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

    // ── Step 3 & 4: Perceptual colour deformation in OKLAB ──
    if (needsHSL) {
      // ════════════════════════════════════════════════════════════════════════
      // sRGB → Linear RGB (required before OKLAB conversion)
      // ════════════════════════════════════════════════════════════════════════
      let _liR = (rOut * 4095 + 0.5) | 0;
      let _liG = (gOut * 4095 + 0.5) | 0;
      let _liB = (bOut * 4095 + 0.5) | 0;
      if (_liR < 0) _liR = 0; else if (_liR > 4095) _liR = 4095;
      if (_liG < 0) _liG = 0; else if (_liG > 4095) _liG = 4095;
      if (_liB < 0) _liB = 0; else if (_liB > 4095) _liB = 4095;
      const pLinR = SRGB_TO_LIN[_liR];
      const pLinG = SRGB_TO_LIN[_liG];
      const pLinB = SRGB_TO_LIN[_liB];

      // ════════════════════════════════════════════════════════════════════════
      // Inline Linear RGB → OKLAB (no function calls, ~50 FLOPs)
      // ════════════════════════════════════════════════════════════════════════
      const lms_l = M1_00 * pLinR + M1_01 * pLinG + M1_02 * pLinB;
      const lms_m = M1_10 * pLinR + M1_11 * pLinG + M1_12 * pLinB;
      const lms_s = M1_20 * pLinR + M1_21 * pLinG + M1_22 * pLinB;
      const lms_l_ = Math.cbrt(lms_l);
      const lms_m_ = Math.cbrt(lms_m);
      const lms_s_ = Math.cbrt(lms_s);
      const okL = M2_00 * lms_l_ + M2_01 * lms_m_ + M2_02 * lms_s_;
      const okA = M2_10 * lms_l_ + M2_11 * lms_m_ + M2_12 * lms_s_;
      const okB = M2_20 * lms_l_ + M2_21 * lms_m_ + M2_22 * lms_s_;

      // OKLAB → polar (hue, chroma)
      const okChroma = Math.sqrt(okA * okA + okB * okB);

      // Only process coloured pixels (skip near-achromatic and extreme lightness)
      const okLPct = okL * 100;
      if (okChroma > 0.003 && okLPct > 2 && okLPct < 98) {
        const okHueDeg = Math.atan2(okB, okA) * (180 / Math.PI);
        const okHueWrap = okHueDeg < 0 ? okHueDeg + 360 : okHueDeg;
        const okChromaPct = okChroma * 500; // Scale chroma to 0-100 range for grid compatibility
        let rgbModified = false;

        // ── Step 3: A/B Grid — Hue / Chroma deformation ─────────────────────
        if (hasAB) {
          let totalWeight = 0;
          let hueShift = 0;
          let chromaShift = 0;

          for (let n = 0; n < abCount; n++) {
            // Circular hue distance (0-180)
            let hueDist = okHueWrap - abHues[n];
            if (hueDist < 0) hueDist = -hueDist;
            if (hueDist > 180) hueDist = 360 - hueDist;

            // Chroma distance (scaled to match grid units)
            const chromaDist = okChromaPct - abSats[n];
            const absChromaDist = chromaDist < 0 ? -chromaDist : chromaDist;

            // Anisotropic Gaussian falloff with per-node sigma
            const nodeHueSigma = abHueSigmas[n] > 0 ? abHueSigmas[n] : AB_GLOBAL_HUE_SIGMA;
            const nodeChromaSigma = abSatSigmas[n] > 0 ? abSatSigmas[n] : AB_GLOBAL_SAT_SIGMA;
            const effHueSigma = nodeHueSigma * abSigmaMults[n];
            const effChromaSigma = nodeChromaSigma * abSigmaMults[n];

            const weight = Math.exp(
              -(hueDist * hueDist) / (2 * effHueSigma * effHueSigma)
              - (absChromaDist * absChromaDist) / (2 * effChromaSigma * effChromaSigma)
            );

            totalWeight += weight;
            hueShift += abOffX[n] * weight;
            chromaShift += abOffY[n] * weight;
          }

          if (totalWeight > 0) {
            hueShift /= totalWeight;
            chromaShift /= totalWeight;

            // Apply hue rotation (degrees → radians, add to current angle)
            let newHueRad = (okHueWrap + hueShift) * (Math.PI / 180);

            // Apply chroma shift (multiplicative for proportional changes)
            let newChroma = okChroma * (1 + chromaShift / 100);
            if (newChroma < 0) newChroma = 0;

            // Convert back to Cartesian OKLAB
            const newA = newChroma * Math.cos(newHueRad);
            const newB = newChroma * Math.sin(newHueRad);

            // ── Gamut-aware soft clipping ──
            // Check if the shifted colour is in gamut
            const nl_ = MI2_00 * okL + MI2_01 * newA + MI2_02 * newB;
            const nm_ = MI2_10 * okL + MI2_11 * newA + MI2_12 * newB;
            const ns_ = MI2_20 * okL + MI2_21 * newA + MI2_22 * newB;
            const nl = nl_ * nl_ * nl_;
            const nm = nm_ * nm_ * nm_;
            const nv = ns_ * ns_ * ns_;
            const nr = MI1_00 * nl + MI1_01 * nm + MI1_02 * nv;
            const ng = MI1_10 * nl + MI1_11 * nm + MI1_12 * nv;
            const nb = MI1_20 * nl + MI1_21 * nm + MI1_22 * nv;

            let finalA = newA;
            let finalB = newB;

            if (nr < -0.001 || nr > 1.001 || ng < -0.001 || ng > 1.001 || nb < -0.001 || nb > 1.001) {
              // Out of gamut — compress chroma toward boundary
              let lo = 0;
              let hi = newChroma;
              for (let gi = 0; gi < 20; gi++) {
                const mid = (lo + hi) * 0.5;
                const ca = mid * Math.cos(newHueRad);
                const cb = mid * Math.sin(newHueRad);
                const gl_ = MI2_00 * okL + MI2_01 * ca + MI2_02 * cb;
                const gm_ = MI2_10 * okL + MI2_11 * ca + MI2_12 * cb;
                const gs_ = MI2_20 * okL + MI2_21 * ca + MI2_22 * cb;
                const gl = gl_ * gl_ * gl_;
                const gm = gm_ * gm_ * gm_;
                const gv = gs_ * gs_ * gs_;
                const gr = MI1_00 * gl + MI1_01 * gm + MI1_02 * gv;
                const gg = MI1_10 * gl + MI1_11 * gm + MI1_12 * gv;
                const gb = MI1_20 * gl + MI1_21 * gm + MI1_22 * gv;

                if (gr < -0.0001 || gr > 1.0001 || gg < -0.0001 || gg > 1.0001 || gb < -0.0001 || gb > 1.0001) {
                  hi = mid;
                } else {
                  lo = mid;
                }
              }

              // Soft compression: use perceptual curve
              const maxC = lo;
              if (maxC > 0.0001) {
                const compressed = maxC * (2 * newChroma / (newChroma + maxC));
                finalA = compressed * Math.cos(newHueRad);
                finalB = compressed * Math.sin(newHueRad);
              } else {
                finalA = 0;
                finalB = 0;
              }
            }

            // Inline OKLAB → Linear RGB
            const fl_ = MI2_00 * okL + MI2_01 * finalA + MI2_02 * finalB;
            const fm_ = MI2_10 * okL + MI2_11 * finalA + MI2_12 * finalB;
            const fs_ = MI2_20 * okL + MI2_21 * finalA + MI2_22 * finalB;
            const fl = fl_ * fl_ * fl_;
            const fm = fm_ * fm_ * fm_;
            const fsv = fs_ * fs_ * fs_;
            rOut = MI1_00 * fl + MI1_01 * fm + MI1_02 * fsv;
            gOut = MI1_10 * fl + MI1_11 * fm + MI1_12 * fsv;
            bOut = MI1_20 * fl + MI1_21 * fm + MI1_22 * fsv;
            rgbModified = true;
          }
        }

        // ── Step 4: C/L Grid — Chroma / Luminance shaping ──────────────────
        if (hasCL) {
          // Re-derive OKLAB if AB grid modified values
          let curA: number, curB: number, curL: number, curChroma: number;

          if (hasAB && totalWeight > 0) {
            // Already in modified OKLAB space from AB grid
            // Re-derive from current rOut, gOut, bOut
            const rl = M1_00 * rOut + M1_01 * gOut + M1_02 * bOut;
            const rm = M1_10 * rOut + M1_11 * gOut + M1_12 * bOut;
            const rs = M1_20 * rOut + M1_21 * gOut + M1_22 * bOut;
            const rl_ = Math.cbrt(rl);
            const rm_ = Math.cbrt(rm);
            const rs_ = Math.cbrt(rs);
            curL = M2_00 * rl_ + M2_01 * rm_ + M2_02 * rs_;
            curA = M2_10 * rl_ + M2_11 * rm_ + M2_12 * rs_;
            curB = M2_20 * rl_ + M2_21 * rm_ + M2_22 * rs_;
            curChroma = Math.sqrt(curA * curA + curB * curB);
          } else {
            curL = okL;
            curA = okA;
            curB = okB;
            curChroma = okChroma;
          }

          const curChromaPct = curChroma * 500; // Scale to grid units
          const curLPct = curL * 100;

          if (curChromaPct >= 1.5) { // Skip near-achromatic
            let clTotalWeight = 0;
            let clChromaShift = 0;
            let clLumShift = 0;

            for (let n = 0; n < clCount; n++) {
              const chromaDist = curChromaPct - clChromas[n];
              const absChromaDist = chromaDist < 0 ? -chromaDist : chromaDist;
              const lumDist = curLPct - clLums[n];
              const absLumDist = lumDist < 0 ? -lumDist : lumDist;

              const distSq = absChromaDist * absChromaDist + absLumDist * absLumDist;
              const weight = Math.exp(-distSq * CL_INV_2SIGMA2);

              clTotalWeight += weight;
              clChromaShift += clOffX[n] * weight;
              clLumShift += clOffY[n] * weight;
            }

            if (clTotalWeight > 0) {
              clChromaShift /= clTotalWeight;
              clLumShift /= clTotalWeight;

              // Apply chroma shift (additive in OKLAB chroma space)
              let newCLChroma = curChroma + clChromaShift * 0.004; // Scale back from grid units
              if (newCLChroma < 0) newCLChroma = 0;

              // Apply luminance shift
              let newCLLum = curL + clLumShift * 0.01;
              if (newCLLum < 0) newCLLum = 0;
              if (newCLLum > 1) newCLLum = 1;

              // Preserve hue direction from current a,b
              const hueAngle = Math.atan2(curB, curA);
              const finalCLA = newCLChroma * Math.cos(hueAngle);
              const finalCLB = newCLChroma * Math.sin(hueAngle);

              // Inline OKLAB → Linear RGB
              const cl_l_ = MI2_00 * newCLLum + MI2_01 * finalCLA + MI2_02 * finalCLB;
              const cl_m_ = MI2_10 * newCLLum + MI2_11 * finalCLA + MI2_12 * finalCLB;
              const cl_s_ = MI2_20 * newCLLum + MI2_21 * finalCLA + MI2_22 * finalCLB;
              const cl_l = cl_l_ * cl_l_ * cl_l_;
              const cl_m = cl_m_ * cl_m_ * cl_m_;
              const cl_s = cl_s_ * cl_s_ * cl_s_;
              const clR = MI1_00 * cl_l + MI1_01 * cl_m + MI1_02 * cl_s;
              const clG = MI1_10 * cl_l + MI1_11 * cl_m + MI1_12 * cl_s;
              const clB = MI1_20 * cl_l + MI1_21 * cl_m + MI1_22 * cl_s;

              // Soft gamut clip for CL result
              rOut = clR < 0 ? clR * 0.1 : clR > 1 ? 1 + (clR - 1) * 0.1 : clR;
              gOut = clG < 0 ? clG * 0.1 : clG > 1 ? 1 + (clG - 1) * 0.1 : clG;
              bOut = clB < 0 ? clB * 0.1 : clB > 1 ? 1 + (clB - 1) * 0.1 : clB;
              rgbModified = true;
            }
          }
        }

      // Convert linear RGB back to sRGB gamma if OKLAB processing modified values
      if (rgbModified) {
        let _loR = rOut * 4095 + 0.5;
        if (_loR < 0) _loR = 0; else if (_loR > 4095) _loR = 4095;
        rOut = LIN_TO_SRGB_U8[_loR | 0] * inv255;

        let _loG = gOut * 4095 + 0.5;
        if (_loG < 0) _loG = 0; else if (_loG > 4095) _loG = 4095;
        gOut = LIN_TO_SRGB_U8[_loG | 0] * inv255;

        let _loB = bOut * 4095 + 0.5;
        if (_loB < 0) _loB = 0; else if (_loB > 4095) _loB = 4095;
        bOut = LIN_TO_SRGB_U8[_loB | 0] * inv255;
      }
      }
    }

    // ── Step 5: Intensity blending ──
    rOut = origR * inv255 * invIntensity + rOut * intensity;
    gOut = origG * inv255 * invIntensity + gOut * intensity;
    bOut = origB * inv255 * invIntensity + bOut * intensity;

    // ── Step 6: Clamp to [0, 255] and write back using bitwise rounding ──
    let outR = (rOut * 255 + 0.5) | 0;
    let outG = (gOut * 255 + 0.5) | 0;
    let outB = (bOut * 255 + 0.5) | 0;

    // Clamp (bitwise approach for 0-255 range)
    if (outR < 0) outR = 0; else if (outR > 255) outR = 255;
    if (outG < 0) outG = 0; else if (outG > 255) outG = 255;
    if (outB < 0) outB = 0; else if (outB > 255) outB = 255;

    pixels[i] = outR;
    pixels[i + 1] = outG;
    pixels[i + 2] = outB;
  }
}
// trigger

