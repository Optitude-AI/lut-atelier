// Color space conversion utilities for LUT Atelier

// HSL to RGB conversion
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = h / 360;
  s = s / 100;
  l = l / 100;

  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// RGB to HSL conversion
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let h = 0, s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

// RGB to HCL (for vectorscope-like visualization)
export function rgbToHcl(r: number, g: number, b: number): { h: number; c: number; l: number } {
  const [h, s, l] = rgbToHsl(r, g, b);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const c = max - min;
  return { h, c: c * 100, l };
}

// Generate HSL color string
export function hslString(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

// Generate skin tone hue range (roughly 15-45 degrees in HSL)
export function isSkinToneHue(hue: number): boolean {
  return (hue >= 10 && hue <= 50);
}

// Generate a hue-based color for a position on the A/B grid
export function getABGridColor(hue: number, saturation: number): string {
  return hslString(hue, saturation, 50);
}

// Generate a color for C/L grid position
export function getCLGridColor(chroma: number, luminance: number): string {
  return hslString(0, chroma, luminance);
}

// Interpolate between two colors
export function interpolateColor(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
  t: number
): [number, number, number] {
  return [
    Math.round(r1 + (r2 - r1) * t),
    Math.round(g1 + (g2 - g1) * t),
    Math.round(b1 + (b2 - b1) * t),
  ];
}

// Generate gradient for skin tone line
export function getSkinToneColor(alpha = 0.6): string {
  return hslString(30, 60, 55, alpha);
}

// Generate histogram data from image data
export function generateHistogram(imageData: ImageData): {
  r: number[];
  g: number[];
  b: number[];
  luma: number[];
} {
  const r = new Array(256).fill(0);
  const g = new Array(256).fill(0);
  const b = new Array(256).fill(0);
  const luma = new Array(256).fill(0);

  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const rv = data[i];
    const gv = data[i + 1];
    const bv = data[i + 2];
    r[rv]++;
    g[gv]++;
    b[bv]++;
    luma[Math.round(0.299 * rv + 0.587 * gv + 0.114 * bv)]++;
  }

  return { r, g, b, luma };
}

// Generate vectorscope data from image data
export function generateVectorscope(imageData: ImageData): Array<{ u: number; v: number; r: number; g: number; b: number }> {
  const points: Array<{ u: number; v: number; r: number; g: number; b: number }> = [];
  const data = imageData.data;

  // Sample every 4th pixel for performance
  for (let i = 0; i < data.length; i += 16) {
    const rv = data[i] / 255;
    const gv = data[i + 1] / 255;
    const bv = data[i + 2] / 255;

    // YUV conversion
    const u = -0.14713 * rv - 0.28886 * gv + 0.436 * bv;
    const v = 0.615 * rv - 0.51499 * gv - 0.10001 * bv;

    if (Math.abs(u) > 0.02 || Math.abs(v) > 0.02) {
      points.push({
        u: u * 100,
        v: v * 100,
        r: data[i],
        g: data[i + 1],
        b: data[i + 2],
      });
    }
  }

  return points;
}

// Apply a simple color grade filter to canvas (CSS filter simulation for demo)
export function applyColorGrade(
  canvas: HTMLCanvasElement,
  intensity: number,
  hueRotate: number = 0,
  saturate: number = 100,
  contrast: number = 100,
  brightness: number = 100,
  sepia: number = 0,
  warmth: number = 0
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const filterStr = [
    `hue-rotate(${hueRotate}deg)`,
    `saturate(${saturate}%)`,
    `contrast(${contrast}%)`,
    `brightness(${brightness}%)`,
    `sepia(${sepia}%)`,
    intensity < 100 ? `opacity(${intensity}%)` : '',
  ].filter(Boolean).join(' ');

  ctx.filter = filterStr;
}
