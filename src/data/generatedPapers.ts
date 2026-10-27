// Generated paper styles (blank, ruled, grid, dotted, parchment). The reference app's pricing page
// advertised "ruled, blank, college grid, vintage parchment" backgrounds but the editor only shipped two
// photos; here they are drawn on demand. Ruled lines are 115.2 page units apart = default font size 96 ×
// line height 1.2, so the default text sits on the lines. Everything is in 3000-unit page space.
import { PAGE_WIDTH, type Boundary } from './catalog';
import { hash01 } from '../engine/rand';

export type PaperStyleId = 'blank' | 'ruled' | 'grid' | 'dotted' | 'parchment';

export interface PaperStyle { id: PaperStyleId; name: string; tag: string; description: string }

export const PAPER_STYLES: PaperStyle[] = [
  { id: 'ruled', name: 'Ruled notebook', tag: 'RULED', description: 'Blue lines with a red margin. Matches the default font size and line spacing.' },
  { id: 'blank', name: 'Blank paper', tag: 'BLANK', description: 'Clean off-white sheet with a soft paper grain.' },
  { id: 'grid', name: 'Graph paper', tag: 'GRID', description: 'Square grid for maths, diagrams and tables.' },
  { id: 'dotted', name: 'Dotted journal', tag: 'DOTS', description: 'Dot grid for notes and bullet journals.' },
  { id: 'parchment', name: 'Vintage parchment', tag: 'VINTAGE', description: 'Warm aged paper with darkened edges.' },
];

const PAGE_H = 4000;
const STEP = 115.2; // default font 96 × 1.2
const FIRST_LINE = 392.8; // = boundary top (300) + node inset (10) + baseline (0.8 × 96) + 6 for descenders
const MARGIN_X = 420;

export const GENERATED_BOUNDARY: Boundary = {
  topLeft: { x: 480, y: 300 },
  topRight: { x: 2860, y: 300 },
  bottomLeft: { x: 480, y: 3900 },
  bottomRight: { x: 2860, y: 3900 },
};

export interface GeneratedPaper { id: string; name: string; url: string; width: number; height: number; boundary: Boundary }

const cache = new Map<string, string>();

/** Draw one paper style at `width` px wide (3:4 portrait). Cached by style and width. */
export function paperDataUrl(style: PaperStyleId, width: number): string {
  const key = `${style}@${width}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const k = width / PAGE_WIDTH;
  const c = document.createElement('canvas');
  c.width = Math.round(width);
  c.height = Math.round(PAGE_H * k);
  const g = c.getContext('2d')!;
  g.scale(k, k);

  // base sheet
  g.fillStyle = style === 'parchment' ? '#efdfb8' : '#fbfaf6';
  g.fillRect(0, 0, PAGE_WIDTH, PAGE_H);

  if (style === 'parchment') {
    const r = g.createRadialGradient(PAGE_WIDTH / 2, PAGE_H / 2, 600, PAGE_WIDTH / 2, PAGE_H / 2, 2600);
    r.addColorStop(0, 'rgba(255,244,214,0.55)');
    r.addColorStop(0.7, 'rgba(0,0,0,0)');
    r.addColorStop(1, 'rgba(94,58,16,0.38)');
    g.fillStyle = r;
    g.fillRect(0, 0, PAGE_WIDTH, PAGE_H);
    for (let i = 0; i < 14; i++) { // soft stains
      const x = hash01(i * 7 + 1) * PAGE_WIDTH, y = hash01(i * 7 + 2) * PAGE_H, rad = 150 + hash01(i * 7 + 3) * 420;
      const s = g.createRadialGradient(x, y, 0, x, y, rad);
      s.addColorStop(0, 'rgba(150,100,40,0.10)');
      s.addColorStop(1, 'rgba(150,100,40,0)');
      g.fillStyle = s;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }

  // paper grain (every style)
  const grains = Math.round(2400 * Math.min(1, k * 2));
  g.fillStyle = 'rgba(80,70,50,0.05)';
  for (let i = 0; i < grains; i++) g.fillRect(hash01(i * 3 + 11) * PAGE_WIDTH, hash01(i * 3 + 12) * PAGE_H, 3 + hash01(i * 3 + 13) * 5, 3);

  const line = (x1: number, y1: number, x2: number, y2: number, color: string, w: number) => {
    g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  };

  if (style === 'ruled') {
    for (let y = FIRST_LINE; y < PAGE_H - 120; y += STEP) line(0, y, PAGE_WIDTH, y, 'rgba(70,120,200,0.55)', 3);
    line(MARGIN_X, 0, MARGIN_X, PAGE_H, 'rgba(220,70,70,0.7)', 4);
    line(MARGIN_X + 14, 0, MARGIN_X + 14, PAGE_H, 'rgba(220,70,70,0.35)', 2);
  } else if (style === 'grid') {
    const cell = STEP / 2;
    for (let y = FIRST_LINE % cell; y < PAGE_H; y += cell) line(0, y, PAGE_WIDTH, y, 'rgba(90,140,170,0.35)', 2);
    for (let x = MARGIN_X % cell; x < PAGE_WIDTH; x += cell) line(x, 0, x, PAGE_H, 'rgba(90,140,170,0.35)', 2);
  } else if (style === 'dotted') {
    const cell = STEP / 2;
    g.fillStyle = 'rgba(70,80,100,0.5)';
    for (let y = FIRST_LINE % cell; y < PAGE_H; y += cell) for (let x = MARGIN_X % cell; x < PAGE_WIDTH; x += cell) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
  }

  // faint edge shading so the sheet doesn't look like a flat rectangle
  const e = g.createLinearGradient(0, 0, PAGE_WIDTH, 0);
  e.addColorStop(0, 'rgba(0,0,0,0.06)'); e.addColorStop(0.04, 'rgba(0,0,0,0)'); e.addColorStop(0.96, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,0.06)');
  g.fillStyle = e;
  g.fillRect(0, 0, PAGE_WIDTH, PAGE_H);

  const url = c.toDataURL('image/jpeg', 0.92);
  cache.set(key, url);
  return url;
}

/** Full-size page for use as a background (1500 px wide: sharp enough for 2400 px exports, small to store). */
export function makePaper(style: PaperStyleId): GeneratedPaper {
  const meta = PAPER_STYLES.find((s) => s.id === style)!;
  const width = 1500;
  return { id: `gen-${style}`, name: meta.name, url: paperDataUrl(style, width), width, height: Math.round(PAGE_H * (width / PAGE_WIDTH)), boundary: GENERATED_BOUNDARY };
}
