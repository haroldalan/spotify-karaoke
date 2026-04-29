// Port of: lyric-test/modules/background/color.js

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    r = hue2rgb(h + 1 / 3);
    g = hue2rgb(h);
    b = hue2rgb(h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export async function extractImageColor(imageUrl: string): Promise<string | null> {
  if (!imageUrl) return null;
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(64, 64);
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    ctx.drawImage(imageBitmap, 0, 0, 64, 64);

    const imageData = ctx.getImageData(0, 0, 64, 64);
    const data = imageData.data;

    const buckets: Record<string, number> = {};
    let maxCount = 0;
    let dominantBucket: { r: number; g: number; b: number } | null = null;

    for (let i = 0; i < data.length; i += 16) {
      const r = data[i], g = data[i + 1], b = data[i + 2];

      if (r > 200 && g > 200 && b > 200) continue;
      if (r < 30 && g < 30 && b < 30) continue;
      if (Math.abs(r - g) < 15 && Math.abs(g - b) < 15) continue;

      const br = Math.floor(r / 32) * 32;
      const bg = Math.floor(g / 32) * 32;
      const bb = Math.floor(b / 32) * 32;
      const key = `${br},${bg},${bb}`;

      buckets[key] = (buckets[key] || 0) + 1;
      if (buckets[key] > maxCount) {
        maxCount = buckets[key];
        dominantBucket = { r: br + 16, g: bg + 16, b: bb + 16 };
      }
    }

    let fr: number, fg: number, fb: number;
    if (!dominantBucket) {
      fr = 0; fg = 0; fb = 0; let total = 0;
      for (let i = 0; i < data.length; i += 32) {
        fr += data[i]; fg += data[i + 1]; fb += data[i + 2]; total++;
      }
      fr = Math.floor(fr / total); fg = Math.floor(fg / total); fb = Math.floor(fb / total);
    } else {
      fr = dominantBucket.r; fg = dominantBucket.g; fb = dominantBucket.b;
    }

    let [h, s, l] = rgbToHsl(fr, fg, fb);

    if (l > 0.18) l = 0.18;
    if (l < 0.10) l = 0.10;
    if (s > 0.60) s = 0.60;

    [fr, fg, fb] = hslToRgb(h, s, l);
    return `rgb(${fr}, ${fg}, ${fb})`;
  } catch (e) {
    console.error('[sly] Color Extraction Failed:', e);
    return null;
  }
}
