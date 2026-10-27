// One renderer for screen and export: the on-screen Konva layer calls renderPage() inside a Shape, and
// export calls it on an offscreen canvas at the target resolution. Same code path = identical output.
import type { jsPDF } from 'jspdf';
import { PAGE_WIDTH } from '../data/catalog';
import { drawTextNode, type Overrides, type TextNode } from '../engine/draw';
import { loadFont } from '../engine/fontLoader';
import { IDENTITY_TRANSFORM, pageSeed, pageTransform, realismOverlay, type PageTransform } from '../engine/realism';
import { rng, idSeed } from '../engine/rand';
import { RESOLUTION_WIDTH, pageBackground, pageHeightFor, resolveDiagrams, useStore, type Diagram, type DocState, type Resolution } from '../state/store';

/* ------------------------------------------------------------------ image cache */
const images = new Map<string, Promise<HTMLImageElement>>();
const ready = new Map<string, HTMLImageElement>();

export function getImage(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      if (!url.startsWith('data:') && !url.startsWith('blob:')) img.crossOrigin = 'anonymous';
      img.onload = () => { ready.set(url, img); resolve(img); };
      img.onerror = () => { images.delete(url); reject(new Error(`Could not load image ${url.slice(0, 60)}`)); };
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}
export const getReadyImage = (url?: string | null) => (url ? ready.get(url) : undefined);

/* ------------------------------------------------------------------ transforms */

/** Konva-compatible group transform: translate → rotate → skew → scale → translate(-offset). */
export function applyPageTransform(ctx: CanvasRenderingContext2D, outW: number, outH: number, pageH: number, t: PageTransform) {
  const k = outW / PAGE_WIDTH;
  ctx.translate(outW / 2 + t.offsetX * k, outH / 2 + t.offsetY * k);
  if (t.rotation) ctx.rotate((t.rotation * Math.PI) / 180);
  if (t.skewX || t.skewY) ctx.transform(1, t.skewY, t.skewX, 1, 0, 0);
  ctx.scale(k * t.scaleOverscan, k * t.scaleOverscan);
  ctx.translate(-PAGE_WIDTH / 2, -pageH / 2);
}

/** Realistic-mode micro offsets of a text node (reference 1476-1488). */
export function nodeJitter(id: string, pageIndex: number, realistic: boolean) {
  if (!realistic) return { x: 0, y: 0, rotation: 0 };
  const d = idSeed(id) + pageIndex * 7919;
  return { x: (rng(d) - 0.5) * 2, y: (rng(d + 1) - 0.5) * 2, rotation: (rng(d + 2) - 0.5) * 2 };
}

export interface PageRenderArgs {
  pageIndex: number;
  nodes: TextNode[];
  bg: HTMLImageElement | undefined;
  bgUrl: string | null;
  pageH: number;
  outW: number;
  outH: number;
  realistic: boolean;
  charVariance: boolean;
  overrides: Overrides;
  diagrams: Diagram[];
  /** node ids to skip (e.g. while a block is being dragged its live copy is drawn instead) */
  hidden?: Set<string>;
  calibrating?: boolean;
}

export function pageTransformFor(a: Pick<PageRenderArgs, 'pageIndex' | 'bgUrl' | 'realistic' | 'calibrating' | 'bg'>): PageTransform {
  if (!a.realistic || a.calibrating || !a.bg) return IDENTITY_TRANSFORM;
  return pageTransform(a.pageIndex, pageSeed(a.pageIndex, a.bgUrl));
}

export function renderPage(ctx: CanvasRenderingContext2D, a: PageRenderArgs) {
  ctx.save();
  ctx.fillStyle = '#faf9f5';
  ctx.fillRect(0, 0, a.outW, a.outH);
  const t = pageTransformFor(a);
  applyPageTransform(ctx, a.outW, a.outH, a.pageH, t);
  if (a.bg) ctx.drawImage(a.bg, 0, 0, PAGE_WIDTH, a.pageH);
  // Ink is transparent dye, not paint: multiply it into the paper so shadows, grain and paper colour
  // show through the strokes (identical to normal blending on pure white).
  ctx.globalCompositeOperation = 'multiply';
  for (const n of a.nodes) {
    if (a.hidden?.has(n.id)) continue;
    const j = nodeJitter(n.id, a.pageIndex, a.realistic);
    ctx.save();
    ctx.translate(n.x + j.x, n.y + j.y);
    const rot = (n.rotation || 0) + j.rotation;
    if (rot) ctx.rotate((rot * Math.PI) / 180);
    drawTextNode(ctx, n, { isRealistic: a.realistic, isCharVariance: a.charVariance, pageIndex: a.pageIndex, overrides: a.overrides });
    ctx.restore();
  }
  for (const d of a.diagrams) {
    const img = getReadyImage(d.src);
    if (!img) continue;
    ctx.save();
    ctx.translate(d.x, d.y);
    if (d.rotation) ctx.rotate((d.rotation * Math.PI) / 180);
    ctx.globalAlpha = d.opacity ?? 0.95;
    ctx.drawImage(img, 0, 0, d.width, d.height);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
  if (a.realistic && a.bg && !a.calibrating) {
    const ov = realismOverlay(a.pageIndex, pageSeed(a.pageIndex, a.bgUrl), a.pageH);
    if (ov) ctx.drawImage(ov, 0, 0, PAGE_WIDTH, a.pageH);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ export */

export interface ExportProgress { page: number; total: number }

export async function renderPageCanvas(doc: DocState, pages: TextNode[][], pageIndex: number, width: number): Promise<HTMLCanvasElement> {
  const fams = new Set<string>();
  for (const n of pages[pageIndex] || []) { fams.add(n.fontFamily); if (n.isCombinedFont && n.secondaryFontFamily) fams.add(n.secondaryFontFamily); }
  for (const o of Object.values(doc.overrides)) if (o.fontFamily) fams.add(o.fontFamily);
  await Promise.all([...fams].map((f) => loadFont(f)));
  const bgUrl = pageBackground(doc, pageIndex);
  // A missing background must fail loudly: silently exporting text on a blank sheet is worse.
  const bg = bgUrl ? await getImage(bgUrl).catch(() => { throw new Error(`Page ${pageIndex + 1}: the page photo could not be loaded`); }) : undefined;
  const pageDiagrams = resolveDiagrams(doc, useStore.getState().blockPositions).filter((d) => d.pageIndex === pageIndex);
  await Promise.all(pageDiagrams.map((d) => getImage(d.src).catch(() => undefined)));
  const pageH = pageHeightFor(doc, pageIndex);
  const c = document.createElement('canvas');
  c.width = Math.round(width);
  c.height = Math.round(width * (pageH / PAGE_WIDTH));
  renderPage(c.getContext('2d')!, {
    pageIndex,
    nodes: pages[pageIndex] || [],
    bg,
    bgUrl,
    pageH,
    outW: c.width,
    outH: c.height,
    realistic: doc.realistic,
    charVariance: doc.charVariance,
    overrides: doc.overrides,
    diagrams: pageDiagrams,
  });
  return c;
}

export function safeFileName(name: string, fallback = 'handwritten-assignment') {
  const s = name.trim().replace(/\.(pdf|jpe?g|png)$/i, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80);
  return s || fallback;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 15000);
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Canvas export failed'))), 'image/jpeg', 0.85));

/** Render the document to files (one PDF, or one JPG per page) without downloading them. */
export async function buildExport(opts: {
  doc: DocState;
  pages: TextNode[][];
  format: 'pdf' | 'image';
  resolution: Resolution;
  fileName: string;
  onProgress?: (p: ExportProgress) => void;
  isCancelled?: () => boolean;
}): Promise<{ name: string; blob: Blob }[] | null> {
  const total = Math.max(1, opts.pages.length);
  const width = RESOLUTION_WIDTH[opts.resolution];
  const base = safeFileName(opts.fileName);
  const cancelled = () => !!opts.isCancelled?.();
  let pdf: jsPDF | null = null;
  const images: { blob: Blob; name: string }[] = [];
  for (let i = 0; i < total; i++) {
    if (cancelled()) return null;
    opts.onProgress?.({ page: i, total });
    const canvas = await renderPageCanvas(opts.doc, opts.pages, i, width);
    if (opts.format === 'pdf') {
      const data = canvas.toDataURL('image/jpeg', 0.85);
      const w = canvas.width, h = canvas.height;
      if (!pdf) { const { jsPDF: PDF } = await import('jspdf'); pdf = new PDF({ orientation: w > h ? 'landscape' : 'portrait', unit: 'px', format: [w, h], hotfixes: ['px_scaling'] }); }
      else pdf.addPage([w, h], w > h ? 'landscape' : 'portrait');
      pdf.addImage(data, 'JPEG', 0, 0, w, h, undefined, 'FAST');
    } else {
      images.push({ blob: await toBlob(canvas), name: total > 1 ? `${base}-page-${i + 1}.jpg` : `${base}.jpg` });
    }
    await new Promise((r) => setTimeout(r, 16));
  }
  if (cancelled()) return null;
  opts.onProgress?.({ page: total, total });
  return pdf ? [{ name: `${base}.pdf`, blob: pdf.output('blob') }] : images;
}

export async function exportDocument(opts: {
  doc: DocState;
  pages: TextNode[][];
  format: 'pdf' | 'image';
  resolution: Resolution;
  fileName: string;
  onProgress: (p: ExportProgress) => void;
  isCancelled: () => boolean;
}): Promise<{ files: number } | null> {
  const files = await buildExport(opts);
  if (!files) return null;
  // Browsers throttle bursts of downloads; space them out a little.
  files.forEach((f, i) => setTimeout(() => download(f.blob, f.name), i * 350));
  return { files: files.length };
}
