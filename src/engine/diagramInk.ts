// Turn a diagram image into "ink on paper": dark pixels → pen color with soft alpha, light → transparent.
// Ported from reference EditorPage.js 6495-6596 (`jl`). Roughness redraws use a seeded jitter instead of
// Math.random() so re-inserting the same diagram gives the same result.
import { parseColor } from './draw';
import { hash01 } from './rand';

export interface InkOptions {
  inkColor: string;
  lineThickness: number; // 0.2..3
  lineOpacity: number; // 0.05..1
  roughness: number; // 0..10
  contrastThreshold: number; // 0..255
  invert: boolean;
  transparent: boolean;
}

export const DEFAULT_INK_OPTIONS: InkOptions = {
  inkColor: '#0033cc',
  lineThickness: 1.5,
  lineOpacity: 0.95,
  roughness: 2,
  contrastThreshold: 210,
  invert: false,
  transparent: true,
};

export function inkifyCanvas(src: HTMLCanvasElement, o: InkOptions): string {
  const w = src.width, h = src.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const oc = out.getContext('2d')!;
  const data = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const img = oc.createImageData(w, h);
  const px = img.data;
  // parseColor, not `parseInt(..) || default`: a 0 channel (navy #000066, black) is valid, not missing.
  const { r, g, b } = parseColor(o.inkColor);
  const thr = o.contrastThreshold;
  const gamma = 1 / Math.max(0.2, o.lineThickness);
  const op = Math.max(0.05, Math.min(1, o.lineOpacity));
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) { px[i + 3] = 0; continue; }
    let R = data[i], G = data[i + 1], B = data[i + 2];
    if (o.invert) { R = 255 - R; G = 255 - G; B = 255 - B; }
    const lum = 0.299 * R + 0.587 * G + 0.114 * B;
    if (lum < thr) {
      const a = Math.min(1, Math.pow((thr - lum) / thr, gamma));
      const alpha = Math.min(1, a * (0.85 + Math.sin(i * 0.01) * 0.15));
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = Math.round(alpha * 255 * op);
    } else if (o.transparent) px[i + 3] = 0;
    else { px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 255; }
  }
  oc.putImageData(img, 0, 0);
  if (o.roughness <= 0) return out.toDataURL('image/png');
  const rough = document.createElement('canvas');
  rough.width = w;
  rough.height = h;
  const rc = rough.getContext('2d')!;
  const passes = Math.min(3, 1 + Math.floor(o.roughness / 2));
  const amp = o.roughness * 0.8;
  for (let p = 0; p < passes; p++) {
    rc.globalAlpha = p === 0 ? 0.85 : 0.4 / p;
    rc.drawImage(out, (hash01(p * 13 + 1) - 0.5) * amp, (hash01(p * 13 + 7) - 0.5) * amp);
  }
  return rough.toDataURL('image/png');
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function inkifyImage(src: string, o: InkOptions): Promise<string> {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || 800;
  c.height = img.naturalHeight || 600;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return inkifyCanvas(c, o);
}
