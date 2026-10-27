// "Realistic Mode": per-page phone-photo effects (tilt, overscan, light, vignette, grain).
// Ported from reference EditorPage.js 2484-2780 (spec §6). Seeded per page + background URL.
import { PAGE_WIDTH } from '../data/catalog';
import { hash01 } from './rand';

const urlSums = new Map<string, number>(); // uploaded photos are multi-MB data URLs: hash each once

export function pageSeed(pageIndex: number, bgUrl?: string | null): number {
  let s = 4242;
  if (bgUrl) {
    const hit = urlSums.get(bgUrl);
    if (hit !== undefined) s = hit;
    else {
      s = 0;
      for (let i = 0; i < bgUrl.length; i++) s += bgUrl.charCodeAt(i) * (i + 1);
      if (urlSums.size > 50) urlSums.clear();
      urlSums.set(bgUrl, s);
    }
  }
  return (pageIndex + 1) * 7919 + (s % 65537);
}

export interface PageTransform { rotation: number; offsetX: number; offsetY: number; scaleOverscan: number; skewX: number; skewY: number }
export const IDENTITY_TRANSFORM: PageTransform = { rotation: 0, offsetX: 0, offsetY: 0, scaleOverscan: 1, skewX: 0, skewY: 0 };

const TILTS = [0.45, -0.68, 0.32, -0.55, 0.72, -0.38, 0.58, -0.75, 0.4, -0.62];

export function pageTransform(pageIndex: number, seed: number): PageTransform {
  return {
    rotation: Number((TILTS[pageIndex % TILTS.length] + (hash01(seed + 1) - 0.5) * 0.18).toFixed(2)),
    offsetX: (hash01(seed + 2) - 0.5) * 24,
    offsetY: (hash01(seed + 3) - 0.5) * 30,
    scaleOverscan: 1.032 + (hash01(seed + 4) - 0.5) * 0.008,
    skewX: (hash01(seed + 5) - 0.5) * 0.006,
    skewY: (hash01(seed + 6) - 0.5) * 0.004,
  };
}

const grainCache = new Map<number, HTMLCanvasElement>();
function grainTile(seed: number): HTMLCanvasElement | null {
  const key = seed % 6;
  const hit = grainCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  let k = key * 100 + 100;
  const rnd = () => { k = (k * 9301 + 49297) % 233280; return k / 233280; };
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 195 + rnd() * 60;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 9 + Math.round(rnd() * 4);
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(0,0,0,0.035)';
  g.lineWidth = 0.5;
  for (let i = 0; i < 35; i++) {
    g.beginPath();
    const x = rnd() * 256, y = rnd() * 256, len = 2 + rnd() * 9, a = rnd() * Math.PI * 2;
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.025)';
  for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(rnd() * 256, rnd() * 256, rnd() * 0.7, 0, Math.PI * 2); g.fill(); }
  grainCache.set(key, c);
  return c;
}

const overlayCache = new Map<string, HTMLCanvasElement>();

/** Lighting/vignette/grain overlay sized 750px wide, drawn on top of the page at full page size. */
export function realismOverlay(pageIndex: number, seed: number, pageH: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const key = `${seed}-${Math.round(pageH)}`;
  const hit = overlayCache.get(key);
  if (hit) return hit;
  const at = PAGE_WIDTH, S = pageH;
  const spots = [{ x: 0.38, y: 0.18 }, { x: 0.58, y: 0.22 }, { x: 0.46, y: 0.15 }, { x: 0.62, y: 0.2 }, { x: 0.42, y: 0.25 }, { x: 0.52, y: 0.18 }];
  const ee = spots[pageIndex % spots.length];
  const lightX = at * (ee.x + (hash01(seed + 10) - 0.5) * 0.06);
  const lightY = S * (ee.y + (hash01(seed + 11) - 0.5) * 0.05);
  const lightR = at * (1.15 + hash01(seed + 12) * 0.22);
  const hiA = 0.07 + hash01(seed + 13) * 0.03;
  const vigA = 0.14 + hash01(seed + 14) * 0.05;
  const ang = (100 + ((pageIndex * 31) % 60) + hash01(seed + 15) * 12) * (Math.PI / 180);
  const g0 = { x: lightX - Math.cos(ang) * (at * 0.5), y: lightY - Math.sin(ang) * (S * 0.5) };
  const g1 = { x: lightX + Math.cos(ang) * (at * 0.7), y: lightY + Math.sin(ang) * (S * 0.7) };
  const shadows = [{ x: at * 0.96, y: S * 0.95 }, { x: at * 0.04, y: S * 0.94 }, { x: at * 0.5, y: S * 0.98 }, { x: at * 0.94, y: S * 0.06 }, { x: at * 0.88, y: S * 0.88 }];
  const sh = shadows[pageIndex % shadows.length];
  const tints = ['rgba(255, 247, 228, 0.032)', 'rgba(244, 248, 255, 0.022)', 'rgba(255, 250, 235, 0.028)', 'rgba(255, 245, 222, 0.035)', 'rgba(248, 249, 252, 0.018)'];

  const c = document.createElement('canvas');
  const K = 750, Q = Math.max(100, Math.round(K * (S / at)));
  c.width = K;
  c.height = Q;
  const u = c.getContext('2d');
  if (!u) return null;
  const sx = K / at, sy = Q / S;
  u.fillStyle = tints[pageIndex % tints.length];
  u.fillRect(0, 0, K, Q);
  const rad = u.createRadialGradient(lightX * sx, lightY * sy, 0, lightX * sx, lightY * sy, lightR * sx);
  rad.addColorStop(0, `rgba(255, 252, 240, ${hiA})`);
  rad.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
  rad.addColorStop(1, `rgba(0, 0, 0, ${vigA})`);
  u.fillStyle = rad;
  u.fillRect(0, 0, K, Q);
  const lin = u.createLinearGradient(g0.x * sx, g0.y * sy, g1.x * sx, g1.y * sy);
  lin.addColorStop(0, 'rgba(255, 253, 245, 0.035)');
  lin.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  lin.addColorStop(1, 'rgba(0, 0, 0, 0.055)');
  u.fillStyle = lin;
  u.fillRect(0, 0, K, Q);
  const shd = u.createRadialGradient(sh.x * sx, sh.y * sy, 0, sh.x * sx, sh.y * sy, at * 0.85 * sx);
  shd.addColorStop(0, 'rgba(20, 15, 10, 0.045)');
  shd.addColorStop(0.65, 'rgba(20, 15, 10, 0.015)');
  shd.addColorStop(1, 'rgba(0, 0, 0, 0)');
  u.fillStyle = shd;
  u.fillRect(0, 0, K, Q);
  const tile = grainTile(seed);
  const pat = tile && u.createPattern(tile, 'repeat');
  if (pat) { u.globalAlpha = 0.55; u.fillStyle = pat; u.fillRect(0, 0, K, Q); u.globalAlpha = 1; }
  overlayCache.set(key, c);
  return c;
}
