// Editor state (zustand). Document state is undoable and autosaved to localStorage; UI state is not.
import { create } from 'zustand';
import { DEFAULT_FONT, PAPERS, defaultBoundaryFor, type Boundary } from '../data/catalog';
import { makePaper, type PaperStyleId } from '../data/generatedPapers';
import type { BlockOverride, Overrides, TextNode, TextStyle } from '../engine/draw';
import type { MoveMode } from '../engine/layout';
import type { StrikeStyle } from '../engine/markup';

export interface Diagram {
  id: string;
  src: string; // inked PNG data URL
  title: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  /** When the text contains `[[diagram:<id>]]` the diagram is anchored there; dx/dy = user nudge from that spot. */
  dx?: number;
  dy?: number;
}

export interface CustomPaper { id: string; name: string; url: string; width: number; height: number; boundary?: Boundary }

export type Resolution = 'low' | 'normal' | 'high';
export const RESOLUTION_WIDTH: Record<Resolution, number> = { low: 1024, normal: 1600, high: 2400 };

export interface DocState {
  text: string;
  template: TextStyle;
  paperUrl: string | null;
  paperSizes: Record<string, { width: number; height: number }>;
  boundary: Boundary | null;
  pageBoundaries: Record<number, Boundary>;
  pageBackgrounds: Record<number, string>;
  customPapers: CustomPaper[];
  moveMode: MoveMode;
  overrides: Overrides;
  pageOffsets: Record<number, { x: number; y: number }>;
  strikeRate: number;
  autoStrikeStyle: StrikeStyle;
  realistic: boolean;
  charVariance: boolean;
  resolution: Resolution;
  diagrams: Diagram[];
}

export const DEFAULT_TEMPLATE: TextStyle = {
  fontSize: 96,
  fontFamily: DEFAULT_FONT,
  fill: '#000066',
  penType: 'ballpoint',
  lineHeight: 1.2,
  letterSpacing: 0,
  wordSpacing: 0,
  opacity: 0.8,
  align: 'left',
  rotation: 0,
  strikeStyle: 'wavy',
};

export const SAMPLE_TEXT = `Name: Student Name | Date: October 2026
Subject: Physics & Mechanics Assignment

Question 1: State Newton's Three Laws of Motion.
Answer:
1. An object at rest stays at rest unless acted upon by an external force.
2. Force equals mass multiplied by acceleration (F = m × a).
3. For every action, there is an equal and opposite reaction.`;

export const emptyDoc = (): DocState => ({
  text: '',
  template: { ...DEFAULT_TEMPLATE },
  paperUrl: null,
  paperSizes: Object.fromEntries(PAPERS.map((p) => [p.url, { width: p.width, height: p.height }])),
  boundary: null,
  pageBoundaries: {},
  pageBackgrounds: {},
  customPapers: [],
  moveMode: 'single',
  overrides: {},
  pageOffsets: {},
  strikeRate: 1,
  autoStrikeStyle: 'wavy',
  realistic: false,
  charVariance: false,
  resolution: 'normal',
  diagrams: [],
});

export type Modal = null | 'export' | 'background' | 'diagram' | 'guide' | 'welcome' | 'filename' | 'claude';

interface UiState {
  pages: TextNode[][];
  layoutBusy: boolean;
  selectedIds: string[];
  selectedDiagramId: string | null;
  currentPage: number;
  calibratingPage: number | null;
  backgroundTarget: number | null; // page index the background modal edits (null = all/default)
  modal: Modal;
  pendingExport: 'pdf' | 'image' | null;
  exportProgress: { page: number; total: number; message: string } | null;
  mobileTab: 'canvas' | 'text' | 'settings';
  fontsVersion: number;
  /** Where each `[[diagram:id]]` block landed in the last layout (derived, not saved). */
  blockPositions: Record<string, { page: number; x: number; y: number; width: number }>;
}

interface History { past: DocState[]; future: DocState[]; lastKey: string; lastAt: number }

interface Store extends UiState {
  doc: DocState;
  history: History;
  /** Update the document. Changes with the same `key` within 700ms collapse into one undo step. */
  update: (patch: Partial<DocState> | ((d: DocState) => Partial<DocState>), key?: string) => void;
  ui: (patch: Partial<UiState>) => void;
  undo: () => void;
  redo: () => void;
  resetDoc: () => void;
}

const STORAGE_KEY = 'notehand.doc.v1';

function loadSaved(): DocState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDoc();
    const parsed = JSON.parse(raw) as { doc: Partial<DocState> };
    return { ...emptyDoc(), ...parsed.doc, template: { ...DEFAULT_TEMPLATE, ...(parsed.doc.template || {}) } };
  } catch {
    return emptyDoc();
  }
}

/* Big images (uploaded pages, diagrams) are data URLs of several MB: they live in IndexedDB and the
   localStorage copy of the document only holds `idb:<key>` references. */
const ASSET_DB = 'notehand-assets', ASSET_STORE = 'assets';
const isBig = (s?: string | null): s is string => !!s && s.startsWith('data:') && s.length > 20000;

function assetDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const req = indexedDB.open(ASSET_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(ASSET_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function assetKey(s: string): string {
  // ponytail: sampled FNV hash; collisions need equal length + equal samples, fine for a personal app
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 61) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${s.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

/** Apply `fn` to every image-URL slot of the document (including paperSizes keys). */
function mapImageUrls(doc: DocState, fn: (s: string) => string): DocState {
  const m = (s: string | null) => (s ? fn(s) : s);
  return {
    ...doc,
    paperUrl: m(doc.paperUrl),
    paperSizes: Object.fromEntries(Object.entries(doc.paperSizes).map(([k, v]) => [fn(k), v])),
    pageBackgrounds: Object.fromEntries(Object.entries(doc.pageBackgrounds).map(([k, v]) => [k, fn(v)])),
    customPapers: doc.customPapers.map((p) => ({ ...p, url: fn(p.url) })),
    diagrams: doc.diagrams.map((d) => ({ ...d, src: fn(d.src) })),
  };
}

const storedAssets = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(doc: DocState) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const big = new Map<string, string>();
    const slim = mapImageUrls(doc, (s) => {
      if (!isBig(s)) return s;
      const k = assetKey(s);
      big.set(k, s);
      return `idb:${k}`;
    });
    const fresh = [...big].filter(([k]) => !storedAssets.has(k));
    let ok = true;
    if (fresh.length) {
      const db = await assetDb();
      ok = !!db && (await new Promise<boolean>((resolve) => {
        try {
          const tx = db.transaction(ASSET_STORE, 'readwrite');
          for (const [k, v] of fresh) tx.objectStore(ASSET_STORE).put(v, k);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        } catch { resolve(false); }
      }));
      if (ok) fresh.forEach(([k]) => storedAssets.add(k)); // only mark as stored when the write committed
    }
    const write = (d: DocState) => localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), doc: d }));
    try {
      // If IndexedDB failed, try to keep the images inline instead of saving refs that point nowhere.
      write(ok ? slim : mapImageUrls(slim, (s) => (s.startsWith('idb:') && !storedAssets.has(s.slice(4)) ? big.get(s.slice(4)) || s : s)));
    } catch {
      try { write(slim); } catch { /* text + settings are small; if even this fails there is nothing more to do */ }
    }
  }, 400);
}

/** Replace `idb:` references from the saved document with the real images. Call before first render. */
export async function hydrateSavedAssets() {
  const { doc } = useStore.getState();
  const keys = new Set<string>();
  mapImageUrls(doc, (s) => { if (s.startsWith('idb:')) keys.add(s.slice(4)); return s; });
  if (!keys.size) return;
  const db = await assetDb();
  const found = new Map<string, string>();
  if (db) {
    await Promise.all([...keys].map((k) => new Promise<void>((resolve) => {
      const req = db.transaction(ASSET_STORE, 'readonly').objectStore(ASSET_STORE).get(k);
      req.onsuccess = () => { if (typeof req.result === 'string') { found.set(k, req.result); storedAssets.add(k); } resolve(); };
      req.onerror = () => resolve();
    })));
  }
  let next = mapImageUrls(doc, (s) => (s.startsWith('idb:') ? found.get(s.slice(4)) || '' : s));
  // drop anything that could not be restored instead of showing a broken image
  next = { ...next, paperUrl: next.paperUrl || null, customPapers: next.customPapers.filter((p) => p.url), diagrams: next.diagrams.filter((d) => d.src),
    pageBackgrounds: Object.fromEntries(Object.entries(next.pageBackgrounds).filter(([, v]) => v)) };
  useStore.setState({ doc: next });
}

export const useStore = create<Store>((set, get) => ({
  doc: loadSaved(),
  history: { past: [], future: [], lastKey: '', lastAt: 0 },
  pages: [],
  layoutBusy: false,
  selectedIds: [],
  selectedDiagramId: null,
  currentPage: 0,
  calibratingPage: null,
  backgroundTarget: null,
  modal: null,
  pendingExport: null,
  exportProgress: null,
  mobileTab: 'canvas',
  fontsVersion: 0,
  blockPositions: {},

  update: (patch, key = '') => {
    const { doc, history } = get();
    const p = typeof patch === 'function' ? patch(doc) : patch;
    const next = { ...doc, ...p };
    const now = Date.now();
    const coalesce = key !== '' && key === history.lastKey && now - history.lastAt < 700;
    set({
      doc: next,
      history: {
        past: coalesce ? history.past : [...history.past.slice(-79), doc],
        future: [],
        lastKey: key,
        lastAt: now,
      },
    });
    scheduleSave(next);
  },
  ui: (patch) => set(patch),
  undo: () => {
    const { doc, history } = get();
    const prev = history.past[history.past.length - 1];
    if (!prev) return;
    set({ doc: prev, selectedIds: [], history: { past: history.past.slice(0, -1), future: [doc, ...history.future], lastKey: '', lastAt: 0 } });
    scheduleSave(prev);
  },
  redo: () => {
    const { doc, history } = get();
    const next = history.future[0];
    if (!next) return;
    set({ doc: next, selectedIds: [], history: { past: [...history.past, doc], future: history.future.slice(1), lastKey: '', lastAt: 0 } });
    scheduleSave(next);
  },
  resetDoc: () => {
    const { doc, history } = get();
    const fresh = emptyDoc();
    set({ doc: fresh, pages: [], selectedIds: [], selectedDiagramId: null, currentPage: 0, history: { past: [...history.past, doc], future: [], lastKey: '', lastAt: 0 } });
    scheduleSave(fresh);
  },
}));

// Dev-only handle for debugging in the browser console / Playwright (not included in production builds).
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __nh: typeof useStore }).__nh = useStore;

/* ------------------------------------------------------------------ selectors & helpers */

export function paperBoundary(doc: DocState, url: string | null | undefined): Boundary | null {
  if (!url) return null;
  const builtin = PAPERS.find((p) => p.url === url);
  if (builtin) return builtin.boundary;
  const custom = doc.customPapers.find((p) => p.url === url);
  if (custom?.boundary) return custom.boundary;
  const size = doc.paperSizes[url] || (custom ? { width: custom.width, height: custom.height } : null);
  return size ? defaultBoundaryFor(size.width, size.height) : null;
}

export function pageBackground(doc: DocState, page: number): string | null {
  return doc.pageBackgrounds[page] || doc.paperUrl;
}

export function boundaryForPage(doc: DocState, page: number): Boundary | null {
  if (doc.pageBoundaries[page]) return doc.pageBoundaries[page];
  const bg = doc.pageBackgrounds[page];
  if (bg && bg !== doc.paperUrl) return paperBoundary(doc, bg);
  return doc.boundary || paperBoundary(doc, doc.paperUrl);
}

export const isAnchored = (doc: DocState, id: string) => doc.text.includes(`[[diagram:${id}]]`);

/** Diagrams with anchored ones moved to where their `[[diagram:id]]` block landed (centred in the line). */
export function resolveDiagrams(doc: DocState, blocks: UiState['blockPositions']): (Diagram & { anchorX?: number; anchorY?: number })[] {
  return doc.diagrams.map((d) => {
    const b = blocks[d.id];
    if (!b || !isAnchored(doc, d.id)) return d;
    const anchorX = b.x + Math.max(0, (b.width - d.width) / 2);
    return { ...d, pageIndex: b.page, x: anchorX + (d.dx || 0), y: b.y + (d.dy || 0), anchorX, anchorY: b.y };
  });
}

/** Paragraph indices shift when lines are inserted/removed; move `p{N}…` overrides with them. */
export function shiftParagraphOverrides(overrides: Overrides, fromPara: number, delta: number): Overrides {
  const out: Overrides = {};
  for (const [k, v] of Object.entries(overrides)) {
    const m = k.match(/^p(\d+)(.*)$/);
    if (!m || +m[1] < fromPara) { out[k] = v; continue; }
    const n = +m[1] + delta;
    if (n >= 0) out[`p${n}${m[2]}`] = v;
  }
  return out;
}

export function pageHeightFor(doc: DocState, page: number): number {
  const url = pageBackground(doc, page);
  const s = url ? doc.paperSizes[url] : null;
  return s ? 3000 * (s.height / s.width) : 4000;
}

export const overrideKey = (n: Pick<TextNode, 'paragraphIndex' | 'lineIndex' | 'wordIndex'>) =>
  n.wordIndex !== undefined ? `p${n.paragraphIndex}-l${n.lineIndex}-w${n.wordIndex}` : `p${n.paragraphIndex}-l${n.lineIndex}`;

export function findNode(pages: TextNode[][], id: string): TextNode | undefined {
  for (const p of pages) for (const n of p) if (n.id === id) return n;
  return undefined;
}

/** Style shown/edited by the toolbar: the first selected block, or the global template. */
export function useEffectiveStyle(): { style: TextStyle; target: 'template' | 'selection' } {
  const doc = useStore((s) => s.doc);
  const pages = useStore((s) => s.pages);
  const selectedIds = useStore((s) => s.selectedIds);
  if (doc.moveMode !== 'all' && selectedIds.length > 0) {
    const n = findNode(pages, selectedIds[0]);
    if (n) return { style: n, target: 'selection' };
  }
  return { style: doc.template, target: 'template' };
}

/** Apply a style patch to the selection (as block overrides) or to the global template. */
export function applyStyle(patch: BlockOverride, key = 'style') {
  const { doc, pages, selectedIds, update } = useStore.getState();
  if (doc.moveMode === 'all' || selectedIds.length === 0) {
    // the template only takes style fields (position/hidden only make sense per block)
    const { x: _x, y: _y, width: _w, hidden: _h, ...style } = patch;
    void _x; void _y; void _w; void _h;
    update({ template: { ...doc.template, ...style } }, `template:${key}`);
    return;
  }
  const overrides = { ...doc.overrides };
  for (const id of selectedIds) {
    const n = findNode(pages, id);
    if (!n) continue;
    const k = overrideKey(n);
    overrides[k] = { ...(overrides[k] || {}), ...patch };
  }
  update({ overrides }, `sel:${key}`);
}

/* ------------------------------------------------------------------ paper actions */

/** Use `url` as background for one page (`page`) or as the default for all pages (`page === null`). */
export function selectPaper(url: string, page: number | null, size?: { width: number; height: number }) {
  const { doc, update } = useStore.getState();
  const paperSizes = size ? { ...doc.paperSizes, [url]: size } : doc.paperSizes;
  if (page === null || !doc.paperUrl) {
    update({ paperUrl: url, paperSizes, boundary: null, pageBackgrounds: {}, pageBoundaries: {} }, 'paper');
  } else {
    const pageBoundaries = { ...doc.pageBoundaries };
    delete pageBoundaries[page];
    update({ paperSizes, pageBackgrounds: { ...doc.pageBackgrounds, [page]: url }, pageBoundaries }, 'paper');
  }
}

const readAsDataUrl = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(new Error('Could not read that file.')); r.readAsDataURL(f); });

/** Load a photo, downscale very large ones (keeps autosave and canvas memory sane), return data URL + size. */
export async function prepareUpload(file: File, maxSide = 3200): Promise<{ url: string; width: number; height: number }> {
  const src = await readAsDataUrl(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not open that image. Use JPG, PNG or WEBP (iPhone HEIC photos need converting).')); i.src = src; });
  const w = img.naturalWidth, h = img.naturalHeight;
  const k = Math.min(1, maxSide / Math.max(w, h));
  if (k === 1 && file.size < 2_500_000) return { url: src, width: w, height: h };
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return { url: c.toDataURL('image/jpeg', 0.9), width: c.width, height: c.height };
}

export async function uploadPaper(file: File, page: number | null) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a JPG, PNG or WEBP photo.');
  const { url, width, height } = await prepareUpload(file);
  const { doc, update, ui } = useStore.getState();
  const paper: CustomPaper = { id: `custom_${Date.now().toString(36)}`, name: file.name.replace(/\.[^.]+$/, '') || 'Custom page', url, width, height };
  update({ customPapers: [paper, ...doc.customPapers].slice(0, 8) }, 'paper-upload');
  selectPaper(url, page, { width, height });
  ui({ calibratingPage: page ?? 0, modal: null });
}

/** Use a generated paper style (ruled, grid, …) for one page or all pages. */
export function useGeneratedPaper(style: PaperStyleId, page: number | null) {
  const paper = makePaper(style);
  const { doc, update } = useStore.getState();
  const entry: CustomPaper = { id: paper.id, name: paper.name, url: paper.url, width: paper.width, height: paper.height, boundary: paper.boundary };
  update({ customPapers: [entry, ...doc.customPapers.filter((p) => p.id !== entry.id)].slice(0, 12) }, 'paper-generated');
  selectPaper(paper.url, page, { width: paper.width, height: paper.height });
}

/** Save a calibrated boundary for one page (and remember it on the paper so reuse keeps it). */
export function saveBoundary(page: number, b: Boundary) {
  const { doc, update, pages } = useStore.getState();
  const url = pageBackground(doc, page);
  const customPapers = doc.customPapers.map((p) => (p.url === url ? { ...p, boundary: b } : p));
  if (pages.length <= 1 && !doc.pageBackgrounds[page]) update({ boundary: b, pageBoundaries: { ...doc.pageBoundaries, [page]: b }, customPapers }, `boundary:${page}`);
  else update({ pageBoundaries: { ...doc.pageBoundaries, [page]: b }, customPapers }, `boundary:${page}`);
}

export function applyBoundaryToAll(b: Boundary) {
  const { doc, update, pages } = useStore.getState();
  const pageBoundaries: Record<number, Boundary> = {};
  for (let i = 0; i < Math.max(1, pages.length); i++) pageBoundaries[i] = b;
  update({ boundary: b, pageBoundaries: { ...doc.pageBoundaries, ...pageBoundaries } }, 'boundary:all');
}

export function setOverride(node: TextNode, patch: BlockOverride, key = 'move') {
  const { doc, update } = useStore.getState();
  const k = overrideKey(node);
  update({ overrides: { ...doc.overrides, [k]: { ...(doc.overrides[k] || {}), ...patch } } }, `${key}:${k}`);
}
