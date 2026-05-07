/**
 * LUT Engine - Core utilities for LUT generation and color grading
 * Shared between .cube export and image export API routes.
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

  // ── Step 3: A/B grid hue-saturation shifts ──
  const [h, s, l] = rgbToHsl(rOut, gOut, bOut);

  if (abNodes && abNodes.length > 0) {
    const [hueShift, satShift] = interpolateABGrid(abNodes, h, s, l);
    let newH = h + hueShift;
    // Wrap hue to 0-360
    newH = ((newH % 360) + 360) % 360;
    // Multiplicative saturation: proportional change, preserves low-sat pixels
    const newS = Math.max(0, Math.min(100, s * (1 + satShift / 100)));

    // ── Lightness compensation ──
    // Reducing HSL saturation causes perceived darkening (Helmholtz-Kohlrausch effect).
    // When saturation decreases, bump lightness proportionally to maintain perceived brightness.
    let compL = l;
    if (newS < s && s > 1 && l > 2 && l < 98) {
      const satLossFrac = (s - newS) / s; // 0..1
      compL = Math.min(100, l + satLossFrac * 12);
    }

    const [abR, abG, abB] = hslToRgb(newH, newS, compL);
    rOut = abR;
    gOut = abG;
    bOut = abB;
  }

  // ── Step 4: C/L grid chroma-luminance shifts ──
  // Recalculate HSL after A/B shifts
  const [h2, s2, l2] = rgbToHsl(rOut, gOut, bOut);

  if (clNodes && clNodes.length > 0) {
    const [chromaShift, lumShift] = interpolateCLGrid(clNodes, h2, s2, l2);
    const newS2 = Math.max(0, Math.min(100, s2 + chromaShift));
    let newL2 = Math.max(0, Math.min(100, l2 + lumShift));

    // ── Lightness compensation when saturation decreases ──
    if (newS2 < s2 && s2 > 1 && newL2 > 2 && newL2 < 98) {
      const satLossFrac = (s2 - newS2) / s2;
      newL2 = Math.min(100, newL2 + satLossFrac * 12);
    }

    const [clR, clG, clB] = hslToRgb(h2, newS2, newL2);
    rOut = clR;
    gOut = clG;
    bOut = clB;
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

    // ── Step 3 & 4: Grid shifts (only if active nodes exist) ──
    if (hasActiveABNodes || hasActiveCLNodes) {
      const [h, s, l] = rgbToHsl(rOut, gOut, bOut);

      if (hasActiveABNodes) {
        const [hueShift, satShift] = interpolateABGrid(abNodes!, h, s, l);
        let newH = h + hueShift;
        newH = ((newH % 360) + 360) % 360;
        // Multiplicative saturation: proportional change
        const rawS = s * (1 + satShift / 100);
        const newS = rawS < 0 ? 0 : rawS > 100 ? 100 : rawS;

        // ── Lightness compensation when saturation decreases ──
        let abL = l;
        if (newS < s && s > 1 && l > 2 && l < 98) {
          const satLossFrac = (s - newS) / s;
          abL = Math.min(100, l + satLossFrac * 12);
        }

        const [abR, abG, abB] = hslToRgb(newH, newS, abL);
        rOut = abR;
        gOut = abG;
        bOut = abB;
      }

      if (hasActiveCLNodes) {
        // Only recompute HSL if AB grid modified the values
        let h2: number, s2: number, l2: number;
        if (hasActiveABNodes) {
          [h2, s2, l2] = rgbToHsl(rOut, gOut, bOut);
        } else {
          h2 = h;
          s2 = s;
          l2 = l;
        }

        const [chromaShift, lumShift] = interpolateCLGrid(clNodes!, h2, s2, l2);
        const newS2 = s2 + chromaShift < 0 ? 0 : s2 + chromaShift > 100 ? 100 : s2 + chromaShift;
        let newL2 = l2 + lumShift < 0 ? 0 : l2 + lumShift > 100 ? 100 : l2 + lumShift;

        // ── Lightness compensation when saturation decreases ──
        if (newS2 < s2 && s2 > 1 && newL2 > 2 && newL2 < 98) {
          const satLossFrac = (s2 - newS2) / s2;
          newL2 = Math.min(100, newL2 + satLossFrac * 12);
        }

        const [clR, clG, clB] = hslToRgb(h2, newS2, newL2);
        rOut = clR;
        gOut = clG;
        bOut = clB;
      }
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

    // ── Step 3 & 4: Grid shifts ──
    if (needsHSL) {
      // Inline RGB to HSL
      const cMax = rOut > gOut ? (rOut > bOut ? rOut : bOut) : (gOut > bOut ? gOut : bOut);
      const cMin = rOut < gOut ? (rOut < bOut ? rOut : bOut) : (gOut < bOut ? gOut : bOut);
      const l = (cMax + cMin) * 0.5;

      if (cMax !== cMin) {
        const d = cMax - cMin;
        const s = l > 0.5 ? d / (2 - cMax - cMin) : d / (cMax + cMin);

        let h: number;
        if (cMax === rOut) {
          h = ((gOut - bOut) / d + (gOut < bOut ? 6 : 0)) / 6;
        } else if (cMax === gOut) {
          h = ((bOut - rOut) / d + 2) / 6;
        } else {
          h = ((rOut - gOut) / d + 4) / 6;
        }
        const hDeg = h * 360;
        const sPct = s * 100;
        const lPct = l * 100;

        // AB grid (hue/sat shifts)
        if (hasAB && sPct >= 5 && lPct >= 3 && lPct <= 97) {
          let totalWeight = 0;
          let hueShift = 0;
          let satShift = 0;

          for (let n = 0; n < abCount; n++) {
            let hueDist = hDeg - abHues[n];
            if (hueDist < 0) hueDist = -hueDist;
            if (hueDist > 180) hueDist = 360 - hueDist;

            const satDist = sPct - abSats[n];
            const absSatDist = satDist < 0 ? -satDist : satDist;

            // Per-node anisotropic sigma with global fallback
            const nodeHueSigma = abHueSigmas[n] > 0 ? abHueSigmas[n] : AB_GLOBAL_HUE_SIGMA;
            const nodeSatSigma = abSatSigmas[n] > 0 ? abSatSigmas[n] : AB_GLOBAL_SAT_SIGMA;
            const nodeMult = abSigmaMults[n];
            const effHueSigma = nodeHueSigma * nodeMult;
            const effSatSigma = nodeSatSigma * nodeMult;
            const weight = Math.exp(
              -(hueDist * hueDist) / (2 * effHueSigma * effHueSigma)
              - (absSatDist * absSatDist) / (2 * effSatSigma * effSatSigma)
            );

            totalWeight += weight;
            hueShift += abOffX[n] * weight;
            satShift += abOffY[n] * weight;
          }

          if (totalWeight > 0) {
            hueShift /= totalWeight;
            satShift /= totalWeight;

            let newH = hDeg + hueShift;
            newH = newH % 360;
            if (newH < 0) newH += 360;

            // Multiplicative saturation: proportional change, preserves low-sat pixels
            let newS = sPct * (1 + satShift / 100);
            if (newS < 0) newS = 0;
            else if (newS > 100) newS = 100;

            // ── Lightness compensation when saturation decreases ──
            let compL = lPct;
            if (newS < sPct && sPct > 1 && lPct > 2 && lPct < 98) {
              const satLossFrac = (sPct - newS) / sPct;
              compL = Math.min(100, lPct + satLossFrac * 12);
            }

            // Inline HSL to RGB
            const hNorm = newH / 360;
            const sNorm = newS / 100;
            const lNorm = compL / 100;

            if (sNorm !== 0) {
              const q2 = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
              const p2 = 2 * lNorm - q2;

              let t1 = hNorm + 1 / 3;
              if (t1 < 0) t1 += 1;
              if (t1 > 1) t1 -= 1;
              if (t1 < 1 / 6) rOut = p2 + (q2 - p2) * 6 * t1;
              else if (t1 < 0.5) rOut = q2;
              else if (t1 < 2 / 3) rOut = p2 + (q2 - p2) * (2 / 3 - t1) * 6;
              else rOut = p2;

              let t2 = hNorm;
              if (t2 < 0) t2 += 1;
              if (t2 > 1) t2 -= 1;
              if (t2 < 1 / 6) gOut = p2 + (q2 - p2) * 6 * t2;
              else if (t2 < 0.5) gOut = q2;
              else if (t2 < 2 / 3) gOut = p2 + (q2 - p2) * (2 / 3 - t2) * 6;
              else gOut = p2;

              let t3 = hNorm - 1 / 3;
              if (t3 < 0) t3 += 1;
              if (t3 > 1) t3 -= 1;
              if (t3 < 1 / 6) bOut = p2 + (q2 - p2) * 6 * t3;
              else if (t3 < 0.5) bOut = q2;
              else if (t3 < 2 / 3) bOut = p2 + (q2 - p2) * (2 / 3 - t3) * 6;
              else bOut = p2;
            } else {
              rOut = lNorm;
              gOut = lNorm;
              bOut = lNorm;
            }
          }
        }

        // CL grid (chroma/lum shifts)
        if (hasCL && sPct >= 3) {
          // Re-derive HSL if AB grid modified values
          let curS: number;
          let curL: number;
          let curH: number;

          if (hasAB) {
            const cMax2 = rOut > gOut ? (rOut > bOut ? rOut : bOut) : (gOut > bOut ? gOut : bOut);
            const cMin2 = rOut < gOut ? (rOut < bOut ? rOut : bOut) : (gOut < bOut ? gOut : bOut);
            curL = (cMax2 + cMin2) * 0.5;

            if (cMax2 !== cMin2) {
              const d2 = cMax2 - cMin2;
              curS = curL > 0.5 ? d2 / (2 - cMax2 - cMin2) : d2 / (cMax2 + cMin2);
              if (cMax2 === rOut) curH = ((gOut - bOut) / d2 + (gOut < bOut ? 6 : 0)) / 6;
              else if (cMax2 === gOut) curH = ((bOut - rOut) / d2 + 2) / 6;
              else curH = ((rOut - gOut) / d2 + 4) / 6;
            } else {
              curS = 0;
              curH = 0;
            }
          } else {
            curH = h;
            curS = s;
            curL = l;
          }

          const curSPct = curS * 100;
          const curLPct = curL * 100;

          let totalWeight = 0;
          let chromaShift = 0;
          let lumShiftVal = 0;

          for (let n = 0; n < clCount; n++) {
            const chromaDist = curSPct - clChromas[n];
            const absChromaDist = chromaDist < 0 ? -chromaDist : chromaDist;

            const lumDist = curLPct - clLums[n];
            const absLumDist = lumDist < 0 ? -lumDist : lumDist;

            const distSq = absChromaDist * absChromaDist + absLumDist * absLumDist;
            const weight = Math.exp(-distSq * CL_INV_2SIGMA2);

            totalWeight += weight;
            chromaShift += clOffX[n] * weight;
            lumShiftVal += clOffY[n] * weight;
          }

          if (totalWeight > 0) {
            chromaShift /= totalWeight;
            lumShiftVal /= totalWeight;

            let newS2 = curSPct + chromaShift;
            if (newS2 < 0) newS2 = 0;
            else if (newS2 > 100) newS2 = 100;

            let newL2 = curLPct + lumShiftVal;
            if (newL2 < 0) newL2 = 0;
            else if (newL2 > 100) newL2 = 100;

            // ── Lightness compensation when saturation decreases ──
            if (newS2 < curSPct && curSPct > 1 && newL2 > 2 && newL2 < 98) {
              const satLossFrac = (curSPct - newS2) / curSPct;
              newL2 = Math.min(100, newL2 + satLossFrac * 12);
            }

            // Inline HSL to RGB for CL result
            const hDeg2 = curH * 360;
            const hNorm2 = hDeg2 / 360;
            const sNorm2 = newS2 / 100;
            const lNorm2 = newL2 / 100;

            if (sNorm2 !== 0) {
              const q2 = lNorm2 < 0.5 ? lNorm2 * (1 + sNorm2) : lNorm2 + sNorm2 - lNorm2 * sNorm2;
              const p2 = 2 * lNorm2 - q2;

              let t1 = hNorm2 + 1 / 3;
              if (t1 < 0) t1 += 1;
              if (t1 > 1) t1 -= 1;
              if (t1 < 1 / 6) rOut = p2 + (q2 - p2) * 6 * t1;
              else if (t1 < 0.5) rOut = q2;
              else if (t1 < 2 / 3) rOut = p2 + (q2 - p2) * (2 / 3 - t1) * 6;
              else rOut = p2;

              let t2 = hNorm2;
              if (t2 < 0) t2 += 1;
              if (t2 > 1) t2 -= 1;
              if (t2 < 1 / 6) gOut = p2 + (q2 - p2) * 6 * t2;
              else if (t2 < 0.5) gOut = q2;
              else if (t2 < 2 / 3) gOut = p2 + (q2 - p2) * (2 / 3 - t2) * 6;
              else gOut = p2;

              let t3 = hNorm2 - 1 / 3;
              if (t3 < 0) t3 += 1;
              if (t3 > 1) t3 -= 1;
              if (t3 < 1 / 6) bOut = p2 + (q2 - p2) * 6 * t3;
              else if (t3 < 0.5) bOut = q2;
              else if (t3 < 2 / 3) bOut = p2 + (q2 - p2) * (2 / 3 - t3) * 6;
              else bOut = p2;
            } else {
              rOut = lNorm2;
              gOut = lNorm2;
              bOut = lNorm2;
            }
          }
        }
      }
      // If cMax === cMin (grayscale), no grid processing needed
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

