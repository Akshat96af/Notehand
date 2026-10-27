// Static catalogs (fonts, pens, inks, papers). JSON files were extracted from the reference bundles
// (see claude/context/REFERENCE_MAP.md); everything is unlocked (OWNER_OVERRIDES O2/O3).
import { asset } from '../config';
import classicFontsJson from './classicFonts.json';
import scriptFontsJson from './scriptFonts.json';
import pensJson from './pens.json';
import inksJson from './inks.json';
import languagesJson from './languages.json';

export type PenType = 'ballpoint' | 'gel' | 'ink';

export interface FontDef {
  id: string;
  name: string;
  url: string;
  category: string; // Cursive | Script | Print (classic) or latin | multilingual | east-asian | devanagari | arabic
  scripts: string[];
  group: 'classic' | 'script' | 'custom';
}

export interface Pen { id: PenType; name: string; label: string; icon: string; tag: string; description: string; textureNote: string }
export interface Ink { name: string; value: string; category: PenType; description: string; badge: string; undertone: string }
export interface Language { id: string; name: string; nativeName: string; script: string; aliases: string[]; flag: string; samplePhrase: string; popular?: boolean }

export const CLASSIC_FONTS: FontDef[] = (classicFontsJson as { id: string; name: string; file: string; category: string }[]).map((f) => ({
  id: f.id,
  name: f.name,
  url: asset(`fonts/${f.file}`),
  category: f.category,
  scripts: ['latin'],
  group: 'classic',
}));

export const SCRIPT_FONTS: FontDef[] = (scriptFontsJson as { id: string; name: string; file: string; category: string; scripts: string[] }[]).map((f) => ({
  id: f.id,
  name: f.name,
  url: asset(`fonts/Scripts/${f.category}/v1/${f.file}`),
  category: f.category,
  scripts: f.scripts,
  group: 'script',
}));

export const ALL_FONTS: FontDef[] = [...CLASSIC_FONTS, ...SCRIPT_FONTS];
export const DEFAULT_FONT = 'cursive_real';

export const PENS = pensJson as Pen[];
export const INKS = inksJson as Ink[];
export const LANGUAGES = languagesJson as Language[];
export const inksForPen = (pen: PenType) => INKS.filter((i) => i.category === pen);

const GEL_HEX = new Set(['#001f5c', '#0047cc', '#0a0a0d', '#0033cc']);
const INK_HEX = new Set(['#1d3b94', '#142238', '#18181b', '#4a2e18', '#5c1626', '#0f4c5c']);

/** Pen type for a color when none is stored (reference `Zr`). */
export function resolvePen(fill?: string, pen?: string): PenType {
  if (pen === 'ballpoint' || pen === 'gel' || pen === 'ink') return pen;
  if (!fill) return 'ballpoint';
  const hit = INKS.find((i) => i.value.toLowerCase() === fill.toLowerCase());
  if (hit) return hit.category;
  const s = fill.toLowerCase();
  return GEL_HEX.has(s) ? 'gel' : INK_HEX.has(s) ? 'ink' : 'ballpoint';
}

export interface Point { x: number; y: number }
export interface Boundary { topLeft: Point; topRight: Point; bottomLeft: Point; bottomRight: Point }

export interface Paper {
  id: string;
  name: string;
  tag: string;
  description: string;
  url: string;
  width: number; // natural size after EXIF orientation
  height: number;
  boundary: Boundary;
}

/** Built-in notebook photos with their calibrated writing quads (3000-unit page space). */
export const PAPERS: Paper[] = [
  {
    id: 'classic',
    name: 'Classic White',
    tag: 'RULED',
    description: 'Standard white lined page with left vertical margin',
    url: asset('pages/notebook/20260329_012336.jpg'),
    width: 3000,
    height: 4000,
    boundary: {
      topLeft: { x: 178.2318325077294, y: 153.59342915811087 },
      topRight: { x: 2821.768167492271, y: 139.87130222843672 },
      bottomLeft: { x: 132.933427950491, y: 3875.104694615757 },
      bottomRight: { x: 2795.999968617206, y: 3936.1921097770155 },
    },
  },
  {
    id: 'natural',
    name: 'Natural Paper',
    tag: 'KRAFT',
    description: 'Warm aesthetic kraft paper with authentic grain',
    url: asset('pages/notebook/20260328_235536.jpg'),
    width: 3000,
    height: 4000,
    boundary: {
      topLeft: { x: 670.2855932377923, y: 489.1938250428818 },
      topRight: { x: 2878.285656003382, y: 496.0548885077187 },
      bottomLeft: { x: 663.4284526222776, y: 3716.6380789022296 },
      bottomRight: { x: 2871.4285153878664, y: 3723.4991423670667 },
    },
  },
];

export const PAGE_WIDTH = 3000;

/** Default writing quad for an image without a calibrated boundary: 10% inset (reference `Mt`). */
export function defaultBoundaryFor(width: number, height: number, inset = 0.1): Boundary {
  const h = Math.round(height * (PAGE_WIDTH / width));
  const r = (v: number) => Math.round(v);
  return {
    topLeft: { x: r(PAGE_WIDTH * inset), y: r(h * inset) },
    topRight: { x: r(PAGE_WIDTH * (1 - inset)), y: r(h * inset) },
    bottomLeft: { x: r(PAGE_WIDTH * inset), y: r(h * (1 - inset)) },
    bottomRight: { x: r(PAGE_WIDTH * (1 - inset)), y: r(h * (1 - inset)) },
  };
}

export const FALLBACK_BOUNDARY: Boundary = {
  topLeft: { x: 259.6, y: 365 },
  topRight: { x: 2051.6, y: 365 },
  bottomRight: { x: 2051.6, y: 2945 },
  bottomLeft: { x: 259.6, y: 2945 },
};

export const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
