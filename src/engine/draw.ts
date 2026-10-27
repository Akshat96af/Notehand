// Handwriting renderer: glyph metrics, pens, highlights, strikes. Ported from reference
// EditorPage.js 452-2190 (see reference/02-rendering-engine-spec.md §3-5). Pure canvas 2D code.
import { resolvePen, type PenType } from '../data/catalog';
import { looksLikeLatex, latexToUnicode, MATH_SYMBOLS, SUB_CHARS, SUPER_CHARS } from './latex';
import { initialMarkupState, parseWord, resolveHighlight, hexToRgba, stripMarkup, type StrikeStyle } from './markup';
import { hash01, idSeed, rng } from './rand';

type Ctx = CanvasRenderingContext2D;

export interface TextStyle {
  fontSize: number;
  fontFamily: string;
  secondaryFontFamily?: string;
  isCombinedFont?: boolean;
  fill: string;
  penType?: PenType;
  lineHeight: number;
  letterSpacing: number;
  wordSpacing: number;
  opacity: number;
  align: 'left' | 'center' | 'right';
  rotation?: number;
  strikeStyle?: StrikeStyle;
  isStrikethrough?: boolean;
  strikeColor?: string;
  isHighlighted?: boolean;
  highlightColor?: string;
}

export interface TextNode extends TextStyle {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  rotation: number;
  paragraphIndex?: number;
  lineIndex?: number;
  wordIndex?: number;
}

export type BlockOverride = Partial<TextStyle> & { x?: number; y?: number; rotation?: number; width?: number; hidden?: boolean };
export type Overrides = Record<string, BlockOverride>;

export const MATH_STACK = '"Cambria Math", "Latin Modern Math", "STIX Two Math", "Segoe UI Symbol", "Apple Symbols", "Liberation Serif", sans-serif';
export const INDIC_STACK = '"Kalam", "Noto Sans Devanagari", "Mangal", "Devanagari Sangam MN", "Kohinoor Devanagari", "Devanagari MT", "Nirmala UI", "Utsaah", "Kokila", sans-serif';

const COMPLEX_SCRIPT = new RegExp(
  '[\\u0900-\\u097F\\uA8E0-\\uA8FF\\u0980-\\u09FF\\u0A00-\\u0A7F\\u0A80-\\u0AFF\\u0B00-\\u0B7F\\u0B80-\\u0BFF\\u0C00-\\u0C7F\\u0C80-\\u0CFF\\u0D00-\\u0D7F\\u0D80-\\u0DFF\\u0E00-\\u0E7F\\u0E80-\\u0EFF\\u0F00-\\u0FFF\\u1000-\\u109F\\u1780-\\u17FF\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF\\u0590-\\u05FF]|\\p{M}',
  'u',
);

/** Scripts with shaping/ligatures are measured and drawn as whole words, never per character. */
export const isComplexScript = (t: string) => !!t && COMPLEX_SCRIPT.test(t);

export function isIndicFont(name?: string): boolean {
  if (!name) return false;
  const u = name.toLowerCase();
  return u.includes('devanagari') || u.includes('kalam') || u.includes('hindi') || u.includes('mangal') || u.includes('kokila');
}

export function fontStack(family: string, size: number, complex = false): string {
  return complex || isIndicFont(family) ? `${size}px "${family}", ${INDIC_STACK}` : `${size}px "${family}", ${MATH_STACK}`;
}

export interface GlyphMetric { width: number; fontSize: number; fontStack: string; yOffset: number }
const metricCache = new Map<string, GlyphMetric>();

/** Drop cached glyph widths for one font family (or all). Keys look like "ch|size|family". */
export function clearMetricsCache(family?: string) {
  if (!family) { metricCache.clear(); return; }
  const suffix = `|${family}`;
  for (const k of metricCache.keys()) if (k.endsWith(suffix)) metricCache.delete(k);
}

/** Width and draw parameters for one character (reference `rn`). */
export function glyphMetrics(ctx: Ctx, ch: string, size: number, family: string): GlyphMetric {
  const key = `${ch}|${size}|${family}`;
  const hit = metricCache.get(key);
  if (hit) return hit;
  const complex = isComplexScript(ch) || isIndicFont(family);
  let fs = size;
  let stack = complex ? `${size}px "${family}", ${INDIC_STACK}` : `${size}px "${family}", cursive, sans-serif`;
  let yOffset = 0;
  if (SUPER_CHARS.has(ch)) {
    fs = size * 0.65;
    yOffset = -size * 0.38;
    stack = `${fs}px "${family}", ${MATH_STACK}`;
  } else if (SUB_CHARS.has(ch)) {
    fs = size * 0.65;
    yOffset = size * 0.18;
    stack = `${fs}px "${family}", ${MATH_STACK}`;
  } else if (MATH_SYMBOLS.has(ch)) {
    stack = `${fs}px "${family}", ${MATH_STACK}`;
  }
  ctx.font = stack;
  const m: GlyphMetric = { width: ctx.measureText(ch).width, fontSize: fs, fontStack: stack, yOffset };
  if (metricCache.size > 10000) metricCache.clear();
  // Only cache once the font is really available, otherwise we'd freeze fallback-font widths.
  const loaded = typeof document === 'undefined' || !document.fonts || document.fonts.check(`${size}px "${family}"`);
  if (loaded) metricCache.set(key, m);
  return m;
}

const colorCache = new Map<string, { r: number; g: number; b: number }>();
export function parseColor(c: string) {
  const hit = colorCache.get(c);
  if (hit) return hit;
  let r = 0, g = 0, b = 102;
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h, 16);
    if (!isNaN(n) && h.length === 6) { r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; }
  } else if (c.startsWith('rgb')) {
    const m = c.match(/\d+/g);
    if (m && m.length >= 3) { r = +m[0]; g = +m[1]; b = +m[2]; }
  }
  const v = { r, g, b };
  colorCache.set(c, v);
  return v;
}

/* ------------------------------------------------------------------ highlighter (reference `dl`) */
interface SpanOpts { x: number; y: number; width: number; fontSize: number; seed: number; isRealistic?: boolean; isStartOfSpan?: boolean; isEndOfSpan?: boolean }

export function drawHighlight(t: Ctx, o: SpanOpts & { colorKey?: string }) {
  const { x, y, width, fontSize: m, seed: h, isRealistic: v = true, isStartOfSpan: i = true, isEndOfSpan: f = true } = o;
  if (width <= 0) return;
  const C = resolveHighlight(o.colorKey);
  const z = hash01(h + 41), D = hash01(h + 42), G = hash01(h + 43), ce = hash01(h + 44), ye = hash01(h + 45), d = hash01(h + 46);
  const re = m * (0.92 + z * 0.16);
  const he = y + (-m * 0.74 + (D - 0.5) * (m * 0.08));
  const I = he + re;
  const X = i ? 5 + G * 8 : 2;
  const te = f ? 6 + ce * 10 : 2;
  const y0 = x - X, P = x + width + te, H = P - y0;
  const V = v ? (ye - 0.45) * 0.022 : 0;
  const $ = v ? (d - 0.5) * 3 : 0;
  t.save();
  t.fillStyle = C.rgba;
  t.beginPath();
  const de = Math.max(3, Math.min(8, Math.round(H / (m * 0.8))));
  t.moveTo(y0, he + $);
  for (let k = 1; k <= de; k++) {
    const ne = y0 + H * (k / de);
    const Fe = v ? (hash01(h + 100 + k * 7) - 0.5) * (m * 0.035) : 0;
    const Le = he + V * H * (k / de) + Fe;
    if (k === 1) t.lineTo(ne, Le);
    else {
      const dt = (k - 0.5) / de;
      const Pe = he + V * H * dt + (v ? (hash01(h + 150 + k * 7) - 0.5) * (m * 0.04) : 0);
      t.quadraticCurveTo(y0 + H * dt, Pe, ne, Le);
    }
  }
  const ae = v ? (hash01(h + 80) - 0.3) * (m * 0.12) : 0;
  t.lineTo(P + ae, I + V * H);
  for (let k = de; k >= 0; k--) {
    const ne = y0 + H * (k / de);
    const Fe = v ? (hash01(h + 200 + k * 9) - 0.5) * (m * 0.038) : 0;
    const Le = I + V * H * (k / de) + Fe;
    if (k === de) t.lineTo(ne, Le);
    else {
      const dt = (k + 0.5) / de;
      const Pe = I + V * H * dt + (v ? (hash01(h + 250 + k * 9) - 0.5) * (m * 0.04) : 0);
      t.quadraticCurveTo(y0 + H * dt, Pe, ne, Le);
    }
  }
  t.closePath();
  t.fill();
  if (v && f) {
    const w = Math.max(3, m * (0.08 + hash01(h + 90) * 0.08));
    t.fillStyle = hexToRgba(C.borderHex, 0.16 + hash01(h + 91) * 0.14);
    t.beginPath();
    t.rect(P - w * 0.8, he + V * H, w, re);
    t.fill();
  }
  t.restore();
}

/* ------------------------------------------------------------------ pen strike (reference `ul`) */
export function drawStrike(t: Ctx, o: SpanOpts & { fill: string; style?: StrikeStyle; penType?: PenType }) {
  const { x: o0, y: N, width: j, fontSize: m, fill: x, style: h = 'wavy', seed: i, isRealistic: f = true, isStartOfSpan: C = true, isEndOfSpan: z = true } = o;
  if (j <= 0) return;
  const D = o.penType || resolvePen(x);
  const { r: G, g: ce, b: ye } = parseColor(x);
  const d = hash01(i + 11), re = hash01(i + 12), ke = hash01(i + 13), he = hash01(i + 14), I = hash01(i + 15), X = hash01(i + 16), te = hash01(i + 17), yv = hash01(i + 18);
  const P = N - m * (0.32 + (d - 0.5) * 0.12);
  const H = C ? 4 + re * 14 : 1;
  const V = z ? 6 + ke * 18 : 1;
  const $ = o0 - H;
  const de = o0 + j + V;
  const ae = de - $;
  const tr = Math.min(255, Math.round(G + (255 - G) * 0.32));
  const tg = Math.min(255, Math.round(ce + (255 - ce) * 0.32));
  const tb = Math.min(255, Math.round(ye + (255 - ye) * 0.32));
  const tint = (a: number) => `rgba(${tr}, ${tg}, ${tb}, ${Math.min(1, Math.max(0, a))})`;
  const Le = Math.max(0, Math.round(G * 0.62 - 14)), dt = Math.max(0, Math.round(ce * 0.62 - 14)), We = Math.max(0, Math.round(ye * 0.62 - 14));
  const pool = `rgb(${Le}, ${dt}, ${We})`;
  const sheen = `rgb(${Math.min(255, Le + 25)}, ${Math.min(255, dt + 25)}, ${Math.min(255, We + 35)})`;
  let Ne: number, E: number;
  if (D === 'gel') { Ne = Math.max(1.85, m * (0.07 + he * 0.016)); E = Math.min(0.99, 0.95 + X * 0.04); }
  else if (D === 'ink') { Ne = Math.max(1.8, m * (0.066 + he * 0.022)); E = Math.min(0.96, 0.84 + X * 0.12); }
  else { Ne = Math.max(1.65, m * (0.058 + he * 0.016)); E = Math.min(0.92, 0.78 + X * 0.16); }
  t.save();
  t.lineCap = 'round';
  t.lineJoin = 'round';

  const tail = (Y: number, B: number, l: number, widthMul: number, alpha: number, color: string, spread: number, base: number) => {
    const S = Math.max(base, m * (spread + hash01(i + 30) * (base === 2 ? 0.07 : 0.09)));
    const w = (Y - B) / Math.max(1, de - l);
    const b = Math.atan(w) + (hash01(i + 31) - 0.38) * (D === 'gel' ? 0.6 : 0.7);
    t.beginPath();
    t.moveTo(de, Y);
    t.lineTo(de + Math.cos(b) * S, Y + Math.sin(b) * S);
    t.lineWidth = Ne * widthMul;
    t.strokeStyle = color;
    t.globalAlpha = alpha;
    t.stroke();
  };

  if (h === 'single') {
    const fe = Math.floor(te * 5);
    let O = P, Y = P, q = $ + ae * 0.33, $e = P, l = $ + ae * 0.67, B = P;
    if (fe === 0) {
      const S = m * (0.1 + yv * 0.14);
      O = P + S * 0.5; Y = P - S * 0.5;
      const w = (hash01(i + 21) - 0.35) * (m * 0.05);
      $e = O - S * 0.35 + w; B = Y + S * 0.3 + w;
    } else if (fe === 1) {
      const S = m * (0.06 + yv * 0.1), w = (I - 0.5) * (m * 0.06);
      O = P - w; Y = P + w * 0.8; $e = P + S; B = P + S * 0.95;
    } else if (fe === 2) {
      const S = m * (0.05 + yv * 0.08), w = (I - 0.45) * (m * 0.06);
      O = P + S * 0.3 - w; Y = P + S * 0.2 + w; $e = P - S; B = P - S * 0.8;
    } else if (fe === 3) {
      const S = (I - 0.5) * (m * 0.035);
      O = P - S; Y = P + S;
      const w = (hash01(i + 22) - 0.5) * (m * 0.04);
      $e = P - w; B = P + w;
    } else {
      const S = m * (0.07 + yv * 0.1);
      O = P - S * 0.5; Y = P + S * 0.5;
      const w = (hash01(i + 23) - 0.5) * (m * 0.05);
      $e = O + S * 0.3 + w; B = Y - S * 0.25 + w;
    }
    q += (hash01(i + 24) - 0.5) * (m * 0.1);
    l += (hash01(i + 25) - 0.5) * (m * 0.1);
    const path = () => { t.beginPath(); t.moveTo($, O); t.bezierCurveTo(q, $e, l, B, de, Y); };
    if (D === 'ink') {
      if (f) { path(); t.lineWidth = Ne * 1.38; t.strokeStyle = tint((0.2 + X * 0.08) * E); t.globalAlpha = 1; t.stroke(); }
      path(); t.lineWidth = Ne; t.strokeStyle = x; t.globalAlpha = E; t.stroke();
      if (C && f) {
        const S = Ne * (0.85 + hash01(i + 35) * 0.35);
        t.beginPath(); t.arc($, O, S, 0, Math.PI * 2); t.fillStyle = pool; t.globalAlpha = Math.min(1, E * 1.05); t.fill();
        t.beginPath(); t.arc($, O, S * 1.45, 0, Math.PI * 2); t.fillStyle = tint(0.18 * E); t.fill();
        t.beginPath(); t.arc($ - 0.2, O - 0.2, S * 0.35, 0, Math.PI * 2); t.fillStyle = sheen; t.globalAlpha = 0.28 * E; t.fill();
      }
      if (z && f) tail(Y, B, l, 0.8, E * 0.9, pool, 0.04, 2.5);
    } else if (D === 'gel') {
      path(); t.lineWidth = Ne; t.strokeStyle = x; t.globalAlpha = E; t.stroke();
      if (C && f) { t.beginPath(); t.arc($, O, Ne * 0.58, 0, Math.PI * 2); t.fillStyle = x; t.globalAlpha = 0.98; t.fill(); }
      if (z && f) tail(Y, B, l, 0.9, 0.96, x, 0.035, 2);
    } else {
      path(); t.lineWidth = Ne; t.strokeStyle = x; t.globalAlpha = E; t.stroke();
      if (C && f) {
        if (hash01(i + 26) > 0.6) {
          const w = Math.max(1.5, m * (0.03 + hash01(i + 27) * 0.04)), b = Math.PI * (0.75 + hash01(i + 28) * 0.3);
          t.beginPath(); t.moveTo($, O); t.lineTo($ + Math.cos(b) * w, O + Math.sin(b) * w); t.lineWidth = Ne; t.strokeStyle = x; t.globalAlpha = E; t.stroke();
        } else {
          const w = Ne * (0.52 + hash01(i + 29) * 0.3);
          t.beginPath(); t.arc($, O, w, 0, Math.PI * 2); t.fillStyle = x; t.globalAlpha = Math.min(1, E * 1.15); t.fill();
        }
      }
      if (z && f) tail(Y, B, l, 0.7, E * 0.75, x, 0.04, 2.5);
    }
  } else if (h === 'double') {
    const fe = m * (0.1 + te * 0.06);
    const O = (hash01(i + 40) - 0.5) * (m * 0.06);
    const Y = -fe * 0.55, q = fe * 0.55;
    const $e = (I - 0.45) * (m * 0.09);
    const l = $ - hash01(i + 41) * 4, B = de + hash01(i + 42) * 4, xe = B - l;
    const S = (hash01(i + 43) - 0.48) * (m * 0.06);
    const first = () => { t.beginPath(); t.moveTo(l, P + Y - $e); t.bezierCurveTo(l + xe * 0.35, P + Y - $e * 0.3 + S, l + xe * 0.65, P + Y + $e * 0.3 + S, B, P + Y + $e); };
    const b = (hash01(i + 45) - 0.48) * (m * 0.11);
    const ee = $ + (hash01(i + 46) - 0.5) * 6, K = de + (hash01(i + 47) - 0.5) * 8, Q = K - ee;
    const U = (hash01(i + 48) - 0.5) * (m * 0.07);
    const second = () => { t.beginPath(); t.moveTo(ee, P + q + O - b); t.bezierCurveTo(ee + Q * 0.32, P + q + O * 0.5 - b * 0.3 + U, ee + Q * 0.68, P + q + O * 0.2 + b * 0.3 + U, K, P + q + b); };
    if (D === 'ink') {
      if (f) { first(); t.lineWidth = Ne * 1.35; t.strokeStyle = tint(0.2 * E); t.globalAlpha = 1; t.stroke(); }
      first(); t.lineWidth = Ne * (0.92 + hash01(i + 44) * 0.14); t.strokeStyle = x; t.globalAlpha = E; t.stroke();
      second(); t.lineWidth = Math.max(1.35, Ne * (0.84 + hash01(i + 49) * 0.16)); t.strokeStyle = x; t.globalAlpha = Math.max(0.7, E * 0.9); t.stroke();
      if (C && f) { t.beginPath(); t.arc(l, P + Y - $e, Ne * 0.75, 0, Math.PI * 2); t.fillStyle = pool; t.globalAlpha = E; t.fill(); }
    } else if (D === 'gel') {
      first(); t.lineWidth = Ne * (0.94 + hash01(i + 44) * 0.12); t.strokeStyle = x; t.globalAlpha = E; t.stroke();
      second(); t.lineWidth = Math.max(1.4, Ne * (0.86 + hash01(i + 49) * 0.14)); t.strokeStyle = x; t.globalAlpha = Math.max(0.88, E * 0.95); t.stroke();
    } else {
      first(); t.lineWidth = Ne * (0.92 + hash01(i + 44) * 0.14); t.strokeStyle = x; t.globalAlpha = E; t.stroke();
      second(); t.lineWidth = Math.max(1.3, Ne * (0.84 + hash01(i + 49) * 0.16)); t.strokeStyle = x; t.globalAlpha = Math.max(0.7, E * 0.9); t.stroke();
    }
  } else if (h === 'wavy') {
    const fe = 0.32 + hash01(i + 60) * 0.18;
    const O = Math.max(2, Math.min(8, Math.round(ae / (m * fe))));
    const Y = m * (0.07 + hash01(i + 61) * 0.05);
    const q = (I - 0.45) * (m * 0.08);
    const segs: { cp1x: number; cp1y: number; cp2x: number; cp2y: number; ex: number; ey: number }[] = [];
    for (let B = 0; B < O; B++) {
      const xe = ae / O, S = (B + 0.5) / O, amp = Y * (0.7 + 0.6 * Math.sin(S * Math.PI));
      segs.push({
        cp1x: $ + B * xe + xe * 0.28,
        cp1y: P + (B % 2 === 0 ? -amp : amp) + q * (S - 0.5) + (hash01(i + 62 + B) - 0.5) * 3,
        cp2x: $ + B * xe + xe * 0.72,
        cp2y: P + (B % 2 === 0 ? amp : -amp) + q * (S - 0.5) + (hash01(i + 72 + B) - 0.5) * 3,
        ex: $ + (B + 1) * xe,
        ey: P + q * ((B + 1) / O - 0.5) + (hash01(i + 82 + B) - 0.5) * 2,
      });
    }
    const path = () => { t.beginPath(); t.moveTo($, P - q); for (const s of segs) t.bezierCurveTo(s.cp1x, s.cp1y, s.cp2x, s.cp2y, s.ex, s.ey); };
    if (D === 'ink') {
      if (f) { path(); t.lineWidth = Ne * 1.35; t.strokeStyle = tint(0.18 * E); t.globalAlpha = 1; t.stroke(); }
      path(); t.lineWidth = Ne; t.strokeStyle = x; t.globalAlpha = E; t.stroke();
      if (f) { t.fillStyle = pool; t.globalAlpha = E * 0.75; for (const s of segs) { t.beginPath(); t.arc(s.ex, s.ey, Ne * 0.48, 0, Math.PI * 2); t.fill(); } }
    } else {
      path(); t.lineWidth = D === 'gel' ? Ne * 1.05 : Ne; t.strokeStyle = x; t.globalAlpha = E; t.stroke();
    }
  } else if (h === 'scratch') {
    const fe = Math.max(4, Math.min(12, Math.round(ae / (m * 0.2))));
    const O = m * (0.28 + hash01(i + 90) * 0.12);
    const Y = (hash01(i + 91) - 0.25) * (m * 0.12);
    const pts: { cpx: number; cpy: number; tx: number; ty: number }[] = [];
    for (let l = 0; l < fe; l++) {
      const B = (l + 1) / fe, S = O + (hash01(i + 92 + l) - 0.5) * (O * 0.35), w = l % 2 === 0;
      const b = $ + ae * B + (w ? Y : -Y * 0.3);
      const ee = P + (w ? S * 0.5 : -S * 0.5) + (hash01(i + 102 + l) - 0.5) * 3;
      const K = $ + ae * (l / fe);
      const Q = P + (w ? -S * 0.45 : S * 0.45);
      pts.push({ cpx: (K + b) * 0.5 + (hash01(i + 112 + l) - 0.5) * 4, cpy: (Q + ee) * 0.5, tx: b, ty: ee });
    }
    const path = () => { t.beginPath(); t.moveTo($, P - O * 0.45); for (const p of pts) t.quadraticCurveTo(p.cpx, p.cpy, p.tx, p.ty); };
    if (D === 'ink') {
      if (f) { path(); t.lineWidth = Ne * 1.25; t.strokeStyle = tint(0.2 * E); t.globalAlpha = 1; t.stroke(); }
      path(); t.lineWidth = Math.max(1.4, Ne * 0.88); t.strokeStyle = x; t.globalAlpha = E; t.stroke();
      if (f) { t.fillStyle = pool; t.globalAlpha = E * 0.68; for (const p of pts) { t.beginPath(); t.arc(p.tx, p.ty, Ne * 0.5, 0, Math.PI * 2); t.fill(); } }
    } else {
      path(); t.lineWidth = D === 'gel' ? Math.max(1.5, Ne * 0.92) : Math.max(1.35, Ne * 0.88); t.strokeStyle = x; t.globalAlpha = E; t.stroke();
    }
  }
  t.restore();
}

/* ------------------------------------------------------------------ whole-word slice wobble (reference `Gr`) */
let scratch: { canvas: HTMLCanvasElement; ctx: Ctx } | null = null;
function scratchCanvas(w: number, h: number) {
  if (typeof document === 'undefined') return null;
  if (!scratch) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    scratch = { canvas, ctx };
  }
  const W = Math.max(512, Math.ceil(w)), H = Math.max(256, Math.ceil(h));
  if (scratch.canvas.width < W || scratch.canvas.height < H) {
    scratch.canvas.width = Math.max(scratch.canvas.width, W);
    scratch.canvas.height = Math.max(scratch.canvas.height, H);
  }
  return scratch;
}

interface BlitOpts {
  word: string; wordWidth: number; destX: number; destY: number; fontSize: number; fontStack: string; fill: string;
  charSeed: number; opacity: number; strokeWidth?: number; strokeColor?: string; poolOpacity?: number; poolColor?: string;
  sheenOpacity?: number; sheenColor?: string;
}

export function blitWord(t: Ctx, o: BlitOpts): boolean {
  if (!o.word) return false;
  const x = o.fontSize;
  const d = Math.ceil(x * 0.45), re = Math.max(1, o.wordWidth), ke = Math.ceil(re + d * 2), he = Math.ceil(x * 2.4), I = Math.ceil(x * 1.4);
  const sc = scratchCanvas(ke, he);
  if (!sc) return false;
  const y = sc.ctx;
  y.clearRect(0, 0, ke, he);
  y.font = o.fontStack;
  y.textBaseline = 'alphabetic';
  y.textAlign = 'left';
  y.globalAlpha = 1;
  if (o.strokeWidth && o.strokeWidth > 0) {
    y.lineWidth = o.strokeWidth; y.strokeStyle = o.strokeColor || o.fill; y.lineCap = 'round'; y.lineJoin = 'round';
    y.strokeText(o.word, d, I);
  }
  y.fillStyle = o.fill;
  y.fillText(o.word, d, I);
  if (o.poolOpacity && o.poolOpacity > 0 && o.poolColor) { y.save(); y.globalAlpha = Math.min(1, o.poolOpacity); y.fillStyle = o.poolColor; y.fillText(o.word, d + 0.18, I + 0.22); y.restore(); }
  if (o.sheenOpacity && o.sheenOpacity > 0 && o.sheenColor) { y.save(); y.globalAlpha = Math.min(1, o.sheenOpacity); y.fillStyle = o.sheenColor; y.fillText(o.word, d - 0.15, I - 0.15); y.restore(); }
  const P = Math.min(1, Math.max(0.35, re / (x * 2.6)));
  const A1 = rng(o.charSeed + 11) - 0.48, V = x * 0.048 * P;
  const A2 = rng(o.charSeed + 13) - 0.5, de = x * 0.034 * P;
  const ax = o.destX - d, ay = o.destY - I;
  t.save();
  t.globalAlpha = o.opacity;
  for (let ne = 0; ne < ke; ne += 2) {
    const tt = Math.max(0, Math.min(1, (ne - d) / re));
    const wobble = (tt - 0.5) * (A1 * 2 * V) + Math.sin(tt * Math.PI) * (A2 * 2 * de) + Math.sin(tt * Math.PI * 3.2 + (o.charSeed % 11)) * (x * 0.007);
    const F = Math.min(2, ke - ne);
    t.drawImage(sc.canvas, ne, 0, F, he, ax + ne, ay + wobble, F, he);
  }
  t.restore();
  return true;
}

/* ------------------------------------------------------------------ text node (reference sceneFunc 1607-2182) */
const PUNCT = new Set(['.', ',', ':', ';', '!', '?', '•', '·', '-', '_', '~', '`', "'", '"', '(', ')', '[', ']', '{', '}', '/', '\\']);
const ASCENDERS = new Set('bdfghjklpqtyBDFGHJKLMPQRTY0123456789'.split(''));

interface Glyph { char: string; charWidth: number; fontStack: string; yOffset: number; charSeed: number; isComplexWord?: boolean }

export interface DrawOptions { isRealistic: boolean; isCharVariance: boolean; pageIndex: number; overrides?: Overrides }

export function drawTextNode(ctx: Ctx, t: TextNode, opts: DrawOptions) {
  const raw = t.text || '';
  const words = (looksLikeLatex(raw) ? latexToUnicode(raw) : raw).split(' ');
  const X = t.fontSize || 24;
  const te = t.fontFamily || 'cursive_real';
  const secondary = t.secondaryFontFamily || te;
  const combined = !!t.isCombinedFont;
  const H = t.fill || '#000000';
  const V = t.letterSpacing || 0;
  const width = t.width || 200;
  const f = opts.isRealistic, C = opts.isCharVariance;
  const ae = t.opacity || 1;
  const we = idSeed(t.id);
  ctx.fillStyle = H;
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = ae;

  let state = initialMarkupState('wavy');
  const parsed = words.map((w) => { const r = parseWord(w, state); state = r.next; return r.parsed; });
  const ov = (B: number): BlockOverride =>
    opts.overrides && t.paragraphIndex !== undefined && t.lineIndex !== undefined && t.wordIndex === undefined
      ? opts.overrides[`p${t.paragraphIndex}-l${t.lineIndex}-w${B}`] || {}
      : {};

  // pass 1: measure
  let counter = 0, lineW = 0;
  const glyphs: Glyph[][] = [];
  const widths = words.map((_, B) => {
    const clean = parsed[B].cleanWord, S = ov(B);
    const w = S.fontSize || X, b = S.fontFamily || te, ee = S.secondaryFontFamily || secondary;
    const K = S.isCombinedFont !== undefined ? S.isCombinedFont : combined;
    const Q = S.letterSpacing !== undefined ? S.letterSpacing : V;
    const complex = isComplexScript(clean) || isIndicFont(b);
    let Z = 0;
    const list: Glyph[] = [];
    if (complex) {
      const stack = fontStack(b, w, true);
      ctx.font = stack;
      Z = ctx.measureText(clean).width;
      list.push({ char: clean, charWidth: Z, fontStack: stack, yOffset: 0, charSeed: we + counter, isComplexWord: true });
      counter += clean.length;
    } else {
      for (let k = 0; k < clean.length; k++) {
        const ch = clean[k];
        const seed = we + counter + ch.charCodeAt(0);
        const fam = K && rng(seed + 100) > 0.5 ? ee : b;
        const m = glyphMetrics(ctx, ch, w, fam);
        list.push({ char: ch, charWidth: m.width, fontStack: m.fontStack, yOffset: m.yOffset, charSeed: seed });
        Z += m.width + Q;
        counter++;
      }
    }
    glyphs.push(list);
    lineW += Z;
    if (B < words.length - 1) {
      ctx.font = `${w}px "${b}", ${INDIC_STACK}`;
      lineW += ctx.measureText(' ').width + Q + (S.wordSpacing !== undefined ? S.wordSpacing : t.wordSpacing || 0) * 10;
      counter++;
    }
    return Z;
  });

  // pass 2: positions
  let cursor = t.align === 'center' ? (width - lineW) / 2 : t.align === 'right' ? width - lineW : 0;
  const strikeAll = !!t.isStrikethrough, strikeStyleAll = t.strikeStyle || 'wavy', strikeColor = t.strikeColor;
  const hlAll = !!t.isHighlighted, hlColorAll = t.highlightColor || 'yellow';
  // Realistic mode: handwriting is never machine-straight. Words ride a slowly wandering baseline, the
  // line drifts a little up or down, pen pressure varies per word and gaps are uneven (all seeded).
  const phase = rng(we + 41) * Math.PI * 2, slope = f ? (rng(we + 43) - 0.5) * 0.012 : 0;
  const items = words.map((_, B) => {
    const S = ov(B);
    const fill = S.fill || H, w = S.fontSize || X, b = S.fontFamily || te;
    const ls = S.letterSpacing !== undefined ? S.letterSpacing : V;
    const ws = (S.wordSpacing !== undefined ? S.wordSpacing : t.wordSpacing || 0) * 10;
    let ix = cursor, iy = 0;
    if (S.x !== undefined && S.y !== undefined) {
      const p = S.x - t.x, a = S.y - t.y, A = ((t.rotation || 0) * Math.PI) / 180;
      ix = p * Math.cos(A) + a * Math.sin(A);
      iy = -p * Math.sin(A) + a * Math.cos(A);
    } else if (f) {
      const gi = (t.wordIndex ?? 0) + B;
      iy = w * (0.026 * Math.sin(gi * 0.9 + phase) + 0.018 * (rng(we + B * 7 + 3) - 0.5)) + slope * ix;
    }
    const rot = S.rotation !== undefined ? ((S.rotation - (t.rotation || 0)) * Math.PI) / 180 : 0;
    const pw = parsed[B];
    const sFill = S.strikeColor || strikeColor || fill;
    const item = {
      x: ix, y: iy, w: widths[B], fontSize: w, fill, rotationRad: rot,
      hasHighlight: hlAll || !!S.isHighlighted || pw.hasHighlight,
      highlightColor: S.highlightColor || (pw.hasHighlight ? pw.highlightColor : hlColorAll),
      hasStrike: strikeAll || pw.hasStrike || !!S.isStrikethrough,
      strikeStyle: (S.strikeStyle || (pw.hasStrike ? pw.strikeStyle : strikeAll ? strikeStyleAll : 'wavy')) as StrikeStyle,
      strikeFill: sFill,
      penType: resolvePen(sFill, S.penType || t.penType),
      seed: we + B * 499 + (opts.pageIndex || 0) * 1117,
      opacity: (S.opacity !== undefined ? S.opacity : 1) * (f ? 0.9 + rng(we + B * 13 + 9) * 0.1 : 1),
      pen: resolvePen(fill, S.penType || t.penType),
    };
    cursor += widths[B];
    if (B < words.length - 1) {
      ctx.font = `${w}px "${b}", ${INDIC_STACK}`;
      cursor += (ctx.measureText(' ').width + ls + ws) * (f ? 0.88 + rng(we + B * 17 + 11) * 0.24 : 1);
    }
    return item;
  });

  const withRotation = (it: { x: number; y: number; rotationRad: number }, fn: () => void) => {
    if (it.rotationRad !== 0) { ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(it.rotationRad); ctx.translate(-it.x, -it.y); }
    fn();
    if (it.rotationRad !== 0) ctx.restore();
  };

  // highlights (merged runs)
  let q = -1;
  for (let l = 0; l <= items.length; l++) {
    const cur = l < items.length ? items[l] : null;
    const on = cur ? cur.hasHighlight : false;
    const same = q !== -1 && cur && cur.highlightColor === items[q].highlightColor && cur.rotationRad === items[q].rotationRad;
    if (q !== -1 && (!on || !same)) {
      const first = items[q], last = items[l - 1];
      withRotation(first, () =>
        drawHighlight(ctx, { x: first.x, y: first.y + first.fontSize * 0.8, width: last.x + last.w - first.x, fontSize: first.fontSize, colorKey: first.highlightColor, seed: first.seed + 101, isRealistic: f }),
      );
      q = -1;
    }
    if (on && q === -1) q = l;
  }

  // glyphs
  items.forEach((it, B) => {
    const ls = ov(B).letterSpacing !== undefined ? (ov(B).letterSpacing as number) : V;
    const K = it.opacity, w = it.fill, b = it.fontSize;
    let U = it.x;
    const Ce = it.y;
    const list = glyphs[B] || [];
    withRotation(it, () => {
      if (it.pen === 'ballpoint') drawBallpoint();
      else if (it.pen === 'gel') drawGel();
      else drawInk();
    });

    function drawBallpoint() {
      ctx.shadowBlur = 0;
      for (const g of list) {
        ctx.font = g.fontStack;
        let p = U, a = Ce + b * 0.8 + g.yOffset;
        if (g.isComplexWord) {
          const A = rng(g.charSeed + 5);
          let pe = 0.88, Ee = 0;
          if (C) { p += (rng(g.charSeed) - 0.5) * (b * 0.025); a += (rng(g.charSeed + 1) - 0.5) * (b * 0.025); pe = 0.76 + A * 0.22; Ee = A > 0.74 ? (A - 0.74) * (b * 0.012) : 0; }
          else if (f) pe = 0.84 + A * 0.14;
          const ok = blitWord(ctx, { word: g.char, wordWidth: g.charWidth, destX: p, destY: a, fontSize: b, fontStack: g.fontStack, fill: w, charSeed: g.charSeed, opacity: pe * ae * K, strokeWidth: Ee > 0 ? Ee : undefined, strokeColor: w, poolOpacity: f && A > 0.7 ? (A - 0.7) * 0.2 * ae : undefined, poolColor: w });
          if (!ok) { ctx.fillStyle = w; ctx.fillText(g.char, p, a); }
          U += g.charWidth;
          continue;
        }
        if (C) {
          p += (rng(g.charSeed) - 0.5) * (b * 0.04);
          a += (rng(g.charSeed + 1) - 0.5) * (b * 0.04);
          const rot = (rng(g.charSeed + 2) - 0.5) * 0.08, sc = 0.98 + rng(g.charSeed + 3) * 0.04, sk = (rng(g.charSeed + 4) - 0.5) * 0.1;
          const kt = rng(g.charSeed + 5), al = 0.76 + kt * 0.22, sw = kt > 0.74 ? (kt - 0.74) * (b * 0.012) : 0;
          ctx.save();
          ctx.translate(p, a);
          if (rot !== 0) ctx.rotate(rot);
          if (sc !== 1) ctx.scale(sc, sc);
          if (sk !== 0) ctx.transform(1, 0, sk, 1, 0, 0);
          ctx.globalAlpha = al * ae * K;
          if (sw > 0) { ctx.lineWidth = sw; ctx.strokeStyle = w; ctx.strokeText(g.char, 0, 0); }
          ctx.fillStyle = w;
          ctx.fillText(g.char, 0, 0);
          if (f && kt > 0.7) { ctx.globalAlpha = (kt - 0.7) * 0.2 * ae; ctx.fillText(g.char, 0.15, 0.15); }
          ctx.restore();
        } else {
          ctx.globalAlpha = (f ? 0.84 + rng(g.charSeed + 5) * 0.14 : 1) * ae * K;
          ctx.fillStyle = w;
          ctx.fillText(g.char, p, a);
        }
        U += g.charWidth + ls;
      }
    }

    function drawGel() {
      const lw = Math.max(0.68, b * 0.022);
      ctx.lineWidth = lw; ctx.strokeStyle = w; ctx.fillStyle = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowBlur = 0;
      for (const g of list) {
        ctx.font = g.fontStack;
        let a = U, A = Ce + b * 0.8 + g.yOffset;
        if (g.isComplexWord) {
          const pe = rng(g.charSeed + 5);
          let Ee = 0.97;
          if (C) { a += (rng(g.charSeed) - 0.5) * (b * 0.025); A += (rng(g.charSeed + 1) - 0.5) * (b * 0.025); Ee = 0.95 + pe * 0.04; }
          const ok = blitWord(ctx, { word: g.char, wordWidth: g.charWidth, destX: a, destY: A, fontSize: b, fontStack: g.fontStack, fill: w, charSeed: g.charSeed, opacity: Ee * ae * K, strokeWidth: lw, strokeColor: w, poolOpacity: pe > 0.72 ? (pe - 0.72) * 0.2 * ae * K : undefined, poolColor: w });
          if (!ok) { ctx.strokeText(g.char, a, A); ctx.fillText(g.char, a, A); }
          U += g.charWidth;
          continue;
        }
        if (C) {
          a += (rng(g.charSeed) - 0.5) * (b * 0.038);
          A += (rng(g.charSeed + 1) - 0.5) * (b * 0.038);
          const rot = (rng(g.charSeed + 2) - 0.5) * 0.08, sc = 0.98 + rng(g.charSeed + 3) * 0.04, sk = (rng(g.charSeed + 4) - 0.5) * 0.1;
          ctx.save();
          ctx.translate(a, A);
          if (rot !== 0) ctx.rotate(rot);
          if (sc !== 1) ctx.scale(sc, sc);
          if (sk !== 0) ctx.transform(1, 0, sk, 1, 0, 0);
          const r = rng(g.charSeed + 5);
          ctx.globalAlpha = (0.95 + r * 0.04) * ae * K;
          ctx.strokeText(g.char, 0, 0);
          ctx.fillText(g.char, 0, 0);
          if (r > 0.72) { ctx.globalAlpha = (r - 0.72) * 0.2 * ae * K; ctx.fillText(g.char, 0.15, 0.15); }
          ctx.restore();
        } else {
          ctx.globalAlpha = 0.97 * ae * K;
          ctx.strokeText(g.char, a, A);
          ctx.fillText(g.char, a, A);
        }
        U += g.charWidth + ls;
      }
    }

    function drawInk() {
      const { r: ue, g: se, b: oe } = parseColor(w);
      const Ir = Math.min(255, Math.round(ue + (255 - ue) * 0.3)), Ig = Math.min(255, Math.round(se + (255 - se) * 0.3)), Ib = Math.min(255, Math.round(oe + (255 - oe) * 0.3));
      const pr = Math.max(0, Math.round(ue * 0.62 - 14)), pg = Math.max(0, Math.round(se * 0.62 - 14)), pb = Math.max(0, Math.round(oe * 0.62 - 14));
      const pool = `rgb(${pr}, ${pg}, ${pb})`;
      const sheen = `rgb(${Math.min(255, pr + 25)}, ${Math.min(255, pg + 25)}, ${Math.min(255, pb + 35)})`;
      ctx.shadowBlur = 0; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      list.forEach((g, Ee) => {
        ctx.font = g.fontStack;
        let $t = U, Ot = Ce + b * 0.8 + g.yOffset;
        const st = PUNCT.has(g.char), Yt = !g.isComplexWord && ASCENDERS.has(g.char);
        const first = Ee === 0, last = Ee === list.length - 1;
        const Ua = 0.5 + 0.38 * Math.sin(Ee * 0.92 + (we % 17) * 0.3);
        let Ft = Ua * 0.42 + rng(g.charSeed + 7) * 0.58;
        if (first) Ft = Math.min(1, Ft * 0.72 + 0.32);
        if (last || st) Ft = Math.min(1, Ft * 0.68 + 0.36);
        let mt = rng(g.charSeed + 5);
        if (Yt) mt = Math.min(1, mt * 0.65 + 0.38);
        if (st) mt = Math.min(1, mt * 0.5 + 0.48);
        if (f) mt = Math.min(1, mt * 1.08);
        const Rt = Math.max(0.1, Math.min(1, 0.22 + 0.78 * (mt * 0.55 + Ft * 0.45)));
        const cr = Math.max(0, Math.min(255, Math.round(Ir + (ue - Ir) * Rt)));
        const cg = Math.max(0, Math.min(255, Math.round(Ig + (se - Ig) * Rt)));
        const cb = Math.max(0, Math.min(255, Math.round(Ib + (oe - Ib) * Rt)));
        const Qt = `rgb(${cr}, ${cg}, ${cb})`;
        const Et = Math.min(0.98, 0.74 + mt * 0.14 + Ft * 0.1);
        const heavy = mt > 0.32;
        const Ts = heavy ? Math.max(0.45, (mt - 0.28) * (b * 0.03)) : Math.max(0.65, b * 0.024 * (0.75 + Ft * 0.55));
        const light = `rgba(${cr}, ${cg}, ${cb}, ${(0.18 + Ft * 0.12) * ae * K})`;
        if (g.isComplexWord) {
          if (C) { $t += (rng(g.charSeed) - 0.5) * (b * 0.025); Ot += (rng(g.charSeed + 1) - 0.5) * (b * 0.025); }
          const Gt = Math.min(0.48, (mt > 0.52 ? (mt - 0.52) * 0.42 : 0) + (Ft > 0.6 ? (Ft - 0.6) * 0.32 : 0) + (last ? 0.16 : 0));
          const ok = blitWord(ctx, {
            word: g.char, wordWidth: g.charWidth, destX: $t, destY: Ot, fontSize: b, fontStack: g.fontStack, fill: Qt, charSeed: g.charSeed,
            opacity: Math.min(1, Et * ae * K), strokeWidth: Ts, strokeColor: heavy ? Qt : light,
            poolOpacity: Gt > 0.04 ? Math.min(1, Gt * ae * K) : undefined, poolColor: pool,
            sheenOpacity: f && mt > 0.66 && !st ? (mt - 0.66) * 0.2 * ae * K : undefined, sheenColor: sheen,
          });
          if (!ok) { ctx.lineWidth = Ts; ctx.strokeStyle = Qt; ctx.strokeText(g.char, $t, Ot); ctx.fillStyle = Qt; ctx.fillText(g.char, $t, Ot); }
          U += g.charWidth;
          return;
        }
        if (C) {
          $t += (rng(g.charSeed) - 0.5) * (b * 0.04);
          Ot += (rng(g.charSeed + 1) - 0.5) * (b * 0.04);
          const rot = (rng(g.charSeed + 2) - 0.5) * 0.08, sc = 0.98 + rng(g.charSeed + 3) * 0.04, sk = (rng(g.charSeed + 4) - 0.5) * 0.1;
          ctx.save();
          ctx.translate($t, Ot);
          if (rot !== 0) ctx.rotate(rot);
          if (sc !== 1) ctx.scale(sc, sc);
          if (sk !== 0) ctx.transform(1, 0, sk, 1, 0, 0);
          ctx.lineWidth = Ts;
          ctx.strokeStyle = heavy ? Qt : light;
          ctx.globalAlpha = heavy ? Math.min(1, Et * 0.96 * ae * K) : ae * K;
          ctx.strokeText(g.char, 0, 0);
          ctx.fillStyle = Qt;
          ctx.globalAlpha = Math.min(1, Et * ae * K);
          ctx.fillText(g.char, 0, 0);
          if (mt > 0.52 || Ft > 0.6 || last || st) {
            const js = Math.min(0.48, (mt > 0.52 ? (mt - 0.52) * 0.42 : 0) + (Ft > 0.6 ? (Ft - 0.6) * 0.32 : 0) + (last ? 0.16 : 0) + (st ? 0.32 : 0));
            if (js > 0.04) { ctx.globalAlpha = Math.min(1, js * ae * K); ctx.fillStyle = pool; ctx.fillText(g.char, st ? 0 : 0.22, st ? 0 : 0.28); }
          }
          if (f && mt > 0.66 && !st) { ctx.globalAlpha = (mt - 0.66) * 0.2 * ae * K; ctx.fillStyle = sheen; ctx.fillText(g.char, -0.15, -0.15); }
          ctx.restore();
        } else {
          ctx.lineWidth = Ts;
          ctx.strokeStyle = heavy ? Qt : light;
          ctx.globalAlpha = heavy ? Math.min(1, Et * 0.96 * ae * K) : ae * K;
          ctx.strokeText(g.char, $t, Ot);
          ctx.fillStyle = Qt;
          ctx.globalAlpha = Math.min(1, Et * ae * K);
          ctx.fillText(g.char, $t, Ot);
          if (f && mt > 0.66 && !st) { ctx.globalAlpha = (mt - 0.66) * 0.2 * ae * K; ctx.fillStyle = sheen; ctx.fillText(g.char, $t - 0.15, Ot - 0.15); }
        }
        U += g.charWidth + ls;
      });
    }
  });

  // strikes (merged runs)
  let s0 = -1;
  for (let l = 0; l <= items.length; l++) {
    const cur = l < items.length ? items[l] : null;
    const on = cur ? cur.hasStrike : false;
    const ref = s0 !== -1 ? items[s0] : null;
    const same = !!ref && !!cur && cur.strikeStyle === ref.strikeStyle && cur.strikeFill === ref.strikeFill && cur.penType === ref.penType && cur.rotationRad === ref.rotationRad;
    if (ref && (!on || !same)) {
      const last = items[l - 1];
      const K = last.x + last.w - ref.x;
      const seed = Math.abs((ref.seed * 37 + Math.round(ref.x * 23) + Math.round(ref.y * 41) + Math.round(K * 17) + (opts.pageIndex || 0) * 31337 + s0 * 101) | 0);
      withRotation(ref, () =>
        drawStrike(ctx, { x: ref.x, y: ref.y + ref.fontSize * 0.8, width: K, fontSize: ref.fontSize, fill: ref.strikeFill, style: ref.strikeStyle, penType: ref.penType, seed, isRealistic: f }),
      );
      s0 = -1;
    }
    if (on && s0 === -1) s0 = l;
  }
}

/* ------------------------------------------------------------------ measurement used by layout */
export interface Measurer {
  /** Width of `text` (may contain markup/LaTeX) in `style`; `seedId` = id of the node it will become. */
  measure(text: string, style: TextStyle, seedId: string): number;
  space(style: TextStyle): number;
}

export function createCanvasMeasurer(): Measurer {
  const ctx = document.createElement('canvas').getContext('2d')!;
  return {
    measure(text, style, seedId) {
      const size = style.fontSize || 96, fam = style.fontFamily || 'cursive_real', sec = style.secondaryFontFamily || fam;
      const ls = style.letterSpacing || 0, ws = (style.wordSpacing || 0) * 10;
      const q = latexToUnicode(stripMarkup(text));
      const complex = isComplexScript(q) || isIndicFont(fam);
      const stack = fontStack(fam, size, complex);
      const combined = !!style.isCombinedFont && !complex && sec !== fam;
      const base = idSeed(seedId);
      let total = 0, counter = 0;
      const parts = q.split(' ');
      parts.forEach((w, i) => {
        if (complex || isComplexScript(w)) { ctx.font = stack; total += ctx.measureText(w).width; counter += w.length; }
        else for (let k = 0; k < w.length; k++) {
          const ch = w[k];
          // Same per-character font choice as drawTextNode, so measured and drawn widths agree.
          const f = combined && rng(base + counter + ch.charCodeAt(0) + 100) > 0.5 ? sec : fam;
          total += glyphMetrics(ctx, ch, size, f).width + ls;
          counter++;
        }
        if (i < parts.length - 1) { ctx.font = stack; total += ctx.measureText(' ').width + ls + ws; counter++; }
      });
      return total;
    },
    space(style) {
      const size = style.fontSize || 96, fam = style.fontFamily || 'cursive_real';
      ctx.font = fontStack(fam, size);
      return ctx.measureText(' ').width + (style.letterSpacing || 0) + (style.wordSpacing || 0) * 10;
    },
  };
}
