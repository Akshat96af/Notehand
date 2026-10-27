// Handwriting-font loading. Layout must wait for the fonts it uses (ARCHITECTURE invariant 3), so this is
// on the critical path. Speed rules:
//  1. one network fetch per font file (one FontFace under the font id; the old code registered two faces
//     per font and downloaded every file twice);
//  2. font files are kept in Cache Storage, so after the first visit they load without the network;
//  3. callers await only the fonts they need (never `document.fonts.ready`, which also waits for every
//     preview font the picker is loading);
//  4. preview/prefetch loads are 'low' priority and capped at 3 at a time, so a font you pick jumps the queue.
import { ALL_FONTS, DEFAULT_FONT, type FontDef } from '../data/catalog';
import { clearMetricsCache } from './draw';

const loaded = new Set<string>();
const pending = new Map<string, Promise<boolean>>();
const custom = new Map<string, FontDef>();
/** Listeners get the font id that changed (undefined = custom fonts restored). */
type Listener = (id?: string) => void;
const listeners = new Set<Listener>();

export const onFontsChanged = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };
const emit = (id?: string) => listeners.forEach((l) => { try { l(id); } catch { /* ignore */ } });
const failed = new Set<string>(); // never retry a font that failed 3 times (avoids relayout loops)

export function findFont(id?: string): FontDef | undefined {
  if (!id) return undefined;
  return custom.get(id) || ALL_FONTS.find((f) => f.id === id || f.name === id || f.id === id.replace(/_/g, '-'));
}

export const isFontLoaded = (id: string) => loaded.has(id);
export const isFontLoading = (id: string) => pending.has(id) && !queuedLow.has(id);

/** Faces declared in index.css (loaded through the <link rel=preload> response, no extra fetch). */
const CSS_FACES = new Set([DEFAULT_FONT]);
const CACHE = 'notehand-fonts-v1';

export async function fontData(url: string): Promise<ArrayBuffer> {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null;
  const hit = cache && (await cache.match(url).catch(() => undefined));
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font ${url}: ${res.status}`);
  if (cache) cache.put(url, res.clone()).catch(() => undefined);
  return res.arrayBuffer();
}

async function fetchAndRegister(def: FontDef): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (CSS_FACES.has(def.id)) await document.fonts.load(`16px "${def.id}"`);
      else {
        const face = new FontFace(def.id, await fontData(def.url));
        await face.load();
        document.fonts.add(face);
      }
      loaded.add(def.id);
      clearMetricsCache(def.id);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return false;
}

/* low-priority queue (previews, prefetch) */
const queuedLow = new Map<string, () => void>(); // id → start function
let lowRunning = 0;
const LOW_CONCURRENCY = 3;
function pumpLow() {
  while (lowRunning < LOW_CONCURRENCY && queuedLow.size) {
    const [id, start] = queuedLow.entries().next().value as [string, () => void];
    queuedLow.delete(id);
    lowRunning++;
    start();
  }
}

/**
 * Load a font by id. Resolves true when it can be drawn. 'high' (default) starts now; 'low' waits in a
 * small queue. Asking for a queued font with 'high' promotes it.
 */
export function loadFont(id: string = DEFAULT_FONT, priority: 'high' | 'low' = 'high'): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(true);
  if (loaded.has(id)) return Promise.resolve(true);
  if (failed.has(id)) return Promise.resolve(false);
  const existing = pending.get(id);
  if (existing) {
    const start = queuedLow.get(id);
    if (start && priority === 'high') { queuedLow.delete(id); lowRunning++; start(); emit(id); }
    return existing;
  }
  const def = findFont(id);
  if (!def) return Promise.resolve(false);
  let release = () => {};
  const p = new Promise<boolean>((resolve) => {
    const start = () => {
      fetchAndRegister(def).then(resolve, () => resolve(false)).finally(() => { release(); });
    };
    if (priority === 'low') {
      release = () => { lowRunning--; pumpLow(); };
      queuedLow.set(id, start);
      pumpLow();
    } else start();
  }).then((ok) => { if (!ok) failed.add(id); return ok; }).finally(() => { pending.delete(id); emit(id); });
  pending.set(id, p);
  if (priority === 'high') emit(id);
  return p;
}

/** Warm the cache for fonts the user is likely to try next, without competing with real work. */
export function prefetchFonts(ids: string[]) {
  const run = () => ids.forEach((id) => loadFont(id, 'low'));
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (ric) ric(run); else setTimeout(run, 1500);
}

/* Uploaded fonts persist in IndexedDB so documents using them still render after a reload. */
const DB = 'notehand-fonts', STORE = 'fonts';
function db(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function addFace(id: string, name: string, data: ArrayBuffer): Promise<FontDef> {
  const face = new FontFace(id, data.slice(0));
  await face.load();
  document.fonts.add(face);
  const def: FontDef = { id, name, url: '', category: 'Custom', scripts: ['latin'], group: 'custom' };
  custom.set(id, def);
  loaded.add(id);
  clearMetricsCache(id);
  emit(id);
  return def;
}

/** Register a user-uploaded font file and remember it in IndexedDB. */
export async function registerCustomFont(name: string, data: ArrayBuffer): Promise<FontDef> {
  const id = `custom-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  const def = await addFace(id, name, data);
  const d = await db();
  d?.transaction(STORE, 'readwrite').objectStore(STORE).put({ id, name, data });
  return def;
}

/** Restore previously uploaded fonts (called once at startup). */
export async function restoreCustomFonts() {
  const d = await db();
  if (!d) return;
  const rows = await new Promise<{ id: string; name: string; data: ArrayBuffer }[]>((resolve) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
  await Promise.all(rows.map((r) => addFace(r.id, r.name, r.data).catch(() => undefined)));
}

export const customFonts = () => [...custom.values()];
