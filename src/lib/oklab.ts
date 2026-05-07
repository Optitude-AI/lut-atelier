/**
 * OKLAB Perceptual Color Space Engine
 * Based on Björn Ottosson's "A perceptual color space for image processing"
 * https://bottosson.github.io/posts/oklab/
 *
 * Core principles:
 * - Perceptually uniform: equal ΔE OKLAB ≈ equal perceived difference
 * - Hue linearity: hue rotation preserves chroma and lightness
 * - Chroma correlates with perceived saturation
 * - Lightness (L) correlates with perceived brightness
 *
 * Architecture:
 *   sRGB (0-1) ──gamma──► Linear RGB ──M1──► LMS ──cbrt──► LMS' ──M2──► OKLAB (L,a,b)
 *   OKLAB (L,a,b) ──M2⁻¹──► LMS' ──cube──► LMS ──M1⁻¹──► Linear RGB ──gamma──► sRGB (0-1)
 *
 * Axes in the a-b plane:
 *   +a = red,   -a = green
 *   +b = yellow, -b = blue
 *   hue = atan2(b, a)  →  0°=red, ~90°=yellow, ~135°=green, ~270°=blue
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Transformation Matrices
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// sRGB Gamma Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Remove sRGB gamma (0-1 → linear 0-1) */
export function srgbGammaToLinear(c: number): number {
  return c >= 0.04045
    ? Math.pow((c + 0.055) / 1.055, 2.4)
    : c / 12.92;
}

/** Apply sRGB gamma (linear 0-1 → 0-1) */
export function linearToSrgbGamma(c: number): number {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  return c >= 0.0031308
    ? 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055
    : 12.92 * c;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Core OKLAB Conversions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Linear sRGB (0-1) → OKLAB (L, a, b)
 * L: lightness ≈ 0 (black) to 1 (white)
 * a: green(-) to red(+)
 * b: blue(-) to yellow(+)
 */
export function linearRGBToOKLAB(
  r: number, g: number, b: number,
): [number, number, number] {
  // Step 1: Linear sRGB → LMS cone responses
  const l = M1_00 * r + M1_01 * g + M1_02 * b;
  const m = M1_10 * r + M1_11 * g + M1_12 * b;
  const s = M1_20 * r + M1_21 * g + M1_22 * b;

  // Step 2: Non-linear compression (cube root)
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  // Step 3: LMS' → OKLAB
  const L = M2_00 * l_ + M2_01 * m_ + M2_02 * s_;
  const a = M2_10 * l_ + M2_11 * m_ + M2_12 * s_;
  const B = M2_20 * l_ + M2_21 * m_ + M2_22 * s_;

  return [L, a, B];
}

/**
 * OKLAB (L, a, b) → Linear sRGB (0-1)
 * May produce values outside [0,1] — use gamutClip to contain.
 */
export function oklabToLinearRGB(
  L: number, a: number, b: number,
): [number, number, number] {
  // Step 1: OKLAB → LMS'
  const l_ = MI2_00 * L + MI2_01 * a + MI2_02 * b;
  const m_ = MI2_10 * L + MI2_11 * a + MI2_12 * b;
  const s_ = MI2_20 * L + MI2_21 * a + MI2_22 * b;

  // Step 2: Reverse compression (cube)
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  // Step 3: LMS → Linear sRGB
  const r = MI1_00 * l + MI1_01 * m + MI1_02 * s;
  const g = MI1_10 * l + MI1_11 * m + MI1_12 * s;
  const bVal = MI1_20 * l + MI1_21 * m + MI1_22 * s;

  return [r, g, bVal];
}

/**
 * sRGB (0-1, gamma-encoded) → OKLAB
 */
export function srgbToOKLAB(
  r: number, g: number, b: number,
): [number, number, number] {
  return linearRGBToOKLAB(
    srgbGammaToLinear(r),
    srgbGammaToLinear(g),
    srgbGammaToLinear(b),
  );
}

/**
 * OKLAB → sRGB (0-1, gamma-encoded)
 * WARNING: may produce values outside [0,1] — gamut clip first!
 */
export function oklabToSRGB(
  L: number, a: number, b: number,
): [number, number, number] {
  const [lr, lg, lb] = oklabToLinearRGB(L, a, b);
  return [linearToSrgbGamma(lr), linearToSrgbGamma(lg), linearToSrgbGamma(lb)];
}

// ═══════════════════════════════════════════════════════════════════════════════
// OKLAB ↔ Polar (Hue, Chroma, Lightness)
// ═══════════════════════════════════════════════════════════════════════════════

/** OKLAB → OKHCL (Hue 0-360, Chroma, Lightness 0-1) */
export function oklabToHCL(
  L: number, a: number, b: number,
): { h: number; c: number; L: number } {
  const c = Math.sqrt(a * a + b * b);
  let h = Math.atan2(b, a) * (180 / Math.PI);
  if (h < 0) h += 360;
  return { h, c, L };
}

/** OKHCL → OKLAB (Hue 0-360, Chroma, Lightness 0-1) */
export function hclToOKLAB(
  h: number, c: number, L: number,
): [number, number, number] {
  const hRad = h * (Math.PI / 180);
  return [L, c * Math.cos(hRad), c * Math.sin(hRad)];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Gamut Boundary & Clipping
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find the maximum in-gamut chroma at a given OKLAB hue and lightness
 * for the sRGB gamut. Uses binary search — O(log n) precision.
 */
export function maxGamutChroma(
  h: number,
  L: number,
  maxSearchChroma: number = 0.5,
): number {
  const hRad = h * (Math.PI / 180);
  const cosH = Math.cos(hRad);
  const sinH = Math.sin(hRad);

  let lo = 0;
  let hi = maxSearchChroma;

  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) * 0.5;
    const a = mid * cosH;
    const b = mid * sinH;

    // Inline LMS' → Linear sRGB to avoid function call overhead
    const l_ = MI2_00 * L + MI2_01 * a + MI2_02 * b;
    const m_ = MI2_10 * L + MI2_11 * a + MI2_12 * b;
    const s_ = MI2_20 * L + MI2_21 * a + MI2_22 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const sv = s_ * s_ * s_;
    const r = MI1_00 * l + MI1_01 * m + MI1_02 * sv;
    const g = MI1_10 * l + MI1_11 * m + MI1_12 * sv;
    const bv = MI1_20 * l + MI1_21 * m + MI1_22 * sv;

    if (r < -0.0001 || r > 1.0001 || g < -0.0001 || g > 1.0001 || bv < -0.0001 || bv > 1.0001) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return lo;
}

/**
 * Test if an OKLAB color is within the sRGB gamut.
 * Inline-friendly (no function calls).
 */
export function isInGamut(
  L: number, a: number, b: number,
): boolean {
  const l_ = MI2_00 * L + MI2_01 * a + MI2_02 * b;
  const m_ = MI2_10 * L + MI2_11 * a + MI2_12 * b;
  const s_ = MI2_20 * L + MI2_21 * a + MI2_22 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const sv = s_ * s_ * s_;
  const r = MI1_00 * l + MI1_01 * m + MI1_02 * sv;
  const g = MI1_10 * l + MI1_11 * m + MI1_12 * sv;
  const bv = MI1_20 * l + MI1_21 * m + MI1_22 * sv;
  return r >= -0.0001 && r <= 1.0001 && g >= -0.0001 && g <= 1.0001 && bv >= -0.0001 && bv <= 1.0001;
}

/**
 * Soft gamut clip — compress out-of-gamut OKLAB colors toward gamut boundary.
 * Uses perceptually-motivated compression: preserves hue, reduces chroma.
 *
 * @param L     OKLAB lightness
 * @param a     OKLAB a (green-red)
 * @param b     OKLAB b (blue-yellow)
 * @param mode  'soft' = gradual compression, 'hard' = binary clip
 * @returns     Clipped OKLAB [L, a, b]
 */
export function gamutClipOKLAB(
  L: number, a: number, b: number,
  mode: 'soft' | 'hard' = 'soft',
): [number, number, number] {
  // Fast path: already in gamut
  const l_ = MI2_00 * L + MI2_01 * a + MI2_02 * b;
  const m_ = MI2_10 * L + MI2_11 * a + MI2_12 * b;
  const s_ = MI2_20 * L + MI2_21 * a + MI2_22 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const sv = s_ * s_ * s_;
  const r = MI1_00 * l + MI1_01 * m + MI1_02 * sv;
  const g = MI1_10 * l + MI1_11 * m + MI1_12 * sv;
  const bv = MI1_20 * l + MI1_21 * m + MI1_22 * sv;

  if (r >= -0.0001 && r <= 1.0001 && g >= -0.0001 && g <= 1.0001 && bv >= -0.0001 && bv <= 1.0001) {
    return [L, a, b];
  }

  // Compute current hue and chroma
  const c = Math.sqrt(a * a + b * b);
  if (c < 0.0001) return [L, 0, 0]; // achromatic

  const h = Math.atan2(b, a);
  const cosH = Math.cos(h);
  const sinH = Math.sin(h);

  // Binary search for maximum in-gamut chroma
  let lo = 0;
  let hi = c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) * 0.5;
    const na = mid * cosH;
    const nb = mid * sinH;
    const nl_ = MI2_00 * L + MI2_01 * na + MI2_02 * nb;
    const nm_ = MI2_10 * L + MI2_11 * na + MI2_12 * nb;
    const ns_ = MI2_20 * L + MI2_21 * na + MI2_22 * nb;
    const nl = nl_ * nl_ * nl_;
    const nm = nm_ * nm_ * nm_;
    const nsv = ns_ * nsv * nsv;
    const nr = MI1_00 * nl + MI1_01 * nm + MI1_02 * nsv;
    const ng = MI1_10 * nl + MI1_11 * nm + MI1_12 * nsv;
    const nbv = MI1_20 * nl + MI1_21 * nm + MI1_22 * nsv;

    if (nr < -0.0001 || nr > 1.0001 || ng < -0.0001 || ng > 1.0001 || nbv < -0.0001 || nbv > 1.0001) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  const maxC = lo;

  if (mode === 'hard') {
    return [L, maxC * cosH, maxC * sinH];
  }

  // Soft compression: use a smooth curve that gradually compresses near boundary
  // C(hat) = maxC × (2 × c / (c + maxC))
  // This gives C(hat) → maxC as c → ∞, with smooth approach
  const compressedC = maxC * (2 * c / (c + maxC + 0.0001));

  return [L, compressedC * cosH, compressedC * sinH];
}

// ═══════════════════════════════════════════════════════════════════════════════
// OKLAB → sRGB uint8 (for canvas rendering)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * OKLAB → sRGB uint8 [0-255] with gamut clipping.
 * Returns integer values ready for ImageData or CSS.
 */
export function oklabToRGB8(
  L: number, a: number, b: number,
  clip: 'soft' | 'hard' = 'soft',
): [number, number, number] {
  let rL: number, gL: number, bL: number;

  if (clip === 'hard') {
    // Fast path: try without clipping first
    const l_ = MI2_00 * L + MI2_01 * a + MI2_02 * b;
    const m_ = MI2_10 * L + MI2_11 * a + MI2_12 * b;
    const s_ = MI2_20 * L + MI2_21 * a + MI2_22 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const sv = s_ * s_ * s_;
    rL = MI1_00 * l + MI1_01 * m + MI1_02 * sv;
    gL = MI1_10 * l + MI1_11 * m + MI1_12 * sv;
    bL = MI1_20 * l + MI1_21 * m + MI1_22 * sv;

    // Hard clamp
    if (rL < 0) rL = 0; else if (rL > 1) rL = 1;
    if (gL < 0) gL = 0; else if (gL > 1) gL = 1;
    if (bL < 0) bL = 0; else if (bL > 1) bL = 1;
  } else {
    const [cL, cA, cB] = gamutClipOKLAB(L, a, b, 'soft');
    [rL, gL, bL] = oklabToLinearRGB(cL, cA, cB);
  }

  return [
    (linearToSrgbGamma(rL) * 255 + 0.5) | 0,
    (linearToSrgbGamma(gL) * 255 + 0.5) | 0,
    (linearToSrgbGamma(bL) * 255 + 0.5) | 0,
  ];
}

/**
 * sRGB uint8 [0-255] → OKLAB
 */
export function rgb8ToOKLAB(
  r: number, g: number, b: number,
): [number, number, number] {
  return srgbToOKLAB(r / 255, g / 255, b / 255);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Skin Tone Detection in OKLAB
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Test if an OKLAB color falls within the perceptual skin tone region.
 * Skin tones cluster around:
 *   - OKLAB hue: ~60°–100° (orange-yellow-red in OKLAB)
 *   - Chroma: moderate (0.02–0.12)
 *   - Lightness: varies widely (0.15–0.80 for diverse skin)
 */
export function isSkinToneOKLAB(L: number, a: number, b: number): boolean {
  const c = Math.sqrt(a * a + b * b);
  if (c < 0.015 || c > 0.15) return false;
  if (L < 0.12 || L > 0.85) return false;

  let h = Math.atan2(b, a) * (180 / Math.PI);
  if (h < 0) h += 360;

  // Skin tone hue range (OKLAB coordinates)
  return h >= 40 && h <= 100;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Perceptual ΔE (OKLAB JzAzBz-inspired simple distance)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Perceptual color distance in OKLAB.
 * Simple Euclidean ΔE — adequate for most grading operations.
 * For more accuracy, use OKLAB ΔE2000 or HyAB variants.
 */
export function oklabDeltaE(
  L1: number, a1: number, b1: number,
  L2: number, a2: number, b2: number,
): number {
  const dL = L1 - L2;
  const da = a1 - a2;
  const db = b1 - b2;
  return Math.sqrt(dL * dL + da * da + db * db);
}
