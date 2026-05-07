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
  console.log('[SKaraoke:Color] Extracting color from:', imageUrl);
  try {
    const response = await fetch(imageUrl, { mode: 'cors' });
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);

    if (typeof OffscreenCanvas === 'undefined') {
      console.warn('[SKaraoke:Color] OffscreenCanvas not supported in this context (Firefox?). Falling back.');
      return null;
    }

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

      // BUG-TT FIX: Quantise first, then filter, to avoid boundary smearing.
      const br = Math.floor(r / 32) * 32;
      const bg = Math.floor(g / 32) * 32;
      const bb = Math.floor(b / 32) * 32;

      if (br > 200 && bg > 200 && bb > 200) continue;
      if (br < 30 && bg < 30 && bb < 30) continue;
      // BUG-TT FIX: Use <= for stricter gray exclusion
      if (Math.abs(br - bg) <= 15 && Math.abs(bg - bb) <= 15) continue;

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
      // BUG-UU FIX: Apply same filters to fallback average
      for (let i = 0; i < data.length; i += 32) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r > 230 && g > 230 && b > 230) continue; // white filter
        if (r < 20 && g < 20 && b < 20) continue; // black filter
        fr += r; fg += g; fb += b; total++;
      }
      if (total === 0) return '#121212';
      fr = Math.floor(fr / total); fg = Math.floor(fg / total); fb = Math.floor(fb / total);
    } else {
      fr = dominantBucket.r; fg = dominantBucket.g; fb = dominantBucket.b;
    }

    // BUG-EEE FIX: Use perceived luminance (luma) for clamping instead of HSL L.
    // This provides a much more consistent dark background for all hues.
    const getLuma = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    let luma = getLuma(fr, fg, fb);
    
    // Target luma: 0.08 - 0.15 (dark but readable)
    if (luma > 0.15) {
      const scale = 0.15 / luma;
      fr = Math.floor(fr * scale);
      fg = Math.floor(fg * scale);
      fb = Math.floor(fb * scale);
    } else if (luma < 0.08) {
      const boost = 0.08 / Math.max(luma, 0.01);
      fr = Math.min(255, Math.floor(fr * boost));
      fg = Math.min(255, Math.floor(fg * boost));
      fb = Math.min(255, Math.floor(fb * boost));
    }

    return `rgb(${fr}, ${fg}, ${fb})`;
  } catch (e) {
    console.error('[sly] Color Extraction Failed:', e);
    return null;
  }
}
