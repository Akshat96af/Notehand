// "Allow Claude": a WebSocket link from this editor to the local Notehand MCP server (mcp/server.mjs).
// Claude calls MCP tools → the server forwards {id, method, params} here → we edit the document through
// the same store actions the UI uses and reply {id, result | error}. Only connects while the user has
// switched it on, and only to 127.0.0.1.
import { useEffect } from 'react';
import { create } from 'zustand';
import { ALL_FONTS, INKS, PAPERS, PENS, defaultBoundaryFor, type Boundary } from '../data/catalog';
import { PAPER_STYLES, type PaperStyleId } from '../data/generatedPapers';
import { DEFAULT_INK_OPTIONS, inkifyCanvas, loadImage } from '../engine/diagramInk';
import type { BlockOverride, Overrides } from '../engine/draw';
import { customFonts, findFont, fontData, registerCustomFont } from '../engine/fontLoader';
import { DIAGRAM_MARKER } from '../engine/layout';
import {
  RESOLUTION_WIDTH, applyBoundaryToAll, isAnchored, pageBackground, saveBoundary, selectPaper, shiftParagraphOverrides,
  uploadPaper, useGeneratedPaper, useStore, type Diagram, type Resolution,
} from '../state/store';
import { buildExport, renderPageCanvas } from './exportDoc';

export const DEFAULT_BRIDGE_PORT = 4823;
const PREF_KEY = 'notehand.claude.v1';

type Status = 'off' | 'waiting' | 'connected';
interface LogEntry { at: number; method: string; ok: boolean; note: string }
interface BridgeState { enabled: boolean; port: number; status: Status; busy: boolean; log: LogEntry[] }

function loadPrefs(): Pick<BridgeState, 'enabled' | 'port'> {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') as Partial<BridgeState>;
    return { enabled: !!p.enabled, port: Number(p.port) || DEFAULT_BRIDGE_PORT };
  } catch { return { enabled: false, port: DEFAULT_BRIDGE_PORT }; }
}

export const useBridge = create<BridgeState>(() => ({ ...loadPrefs(), status: 'off', busy: false, log: [] }));

export function setBridgePrefs(p: Partial<Pick<BridgeState, 'enabled' | 'port'>>) {
  useBridge.setState(p);
  const { enabled, port } = useBridge.getState();
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ enabled, port })); } catch { /* preference only */ }
}

const log = (method: string, ok: boolean, note: string) =>
  useBridge.setState((s) => ({ log: [{ at: Date.now(), method, ok, note: note.slice(0, 160) }, ...s.log].slice(0, 60) }));

/* ------------------------------------------------------------------ helpers */

type Params = Record<string, unknown>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Wait until the editor has re-laid-out after a change (text is debounced 300ms). */
async function settle() {
  await sleep(380);
  for (let i = 0; i < 200 && useStore.getState().layoutBusy; i++) await sleep(50);
  await sleep(30);
}

/** "#123456", an ink name ("Carbon Ballpoint Black") or a plain word ("black", "blue"). */
export function resolveInk(v: string): string {
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  const q = v.trim().toLowerCase();
  const ink = INKS.find((i) => i.name.toLowerCase() === q) || INKS.find((i) => i.name.toLowerCase().includes(q));
  if (!ink) throw new Error(`Unknown ink "${v}". Use a hex colour or one of: ${INKS.map((i) => i.name).join(', ')}`);
  return ink.value;
}

function checkFont(id: unknown) {
  if (id === undefined) return;
  if (typeof id !== 'string' || !findFont(id)) throw new Error(`Unknown font "${String(id)}". Call list_options for font ids.`);
}

const STYLE_KEYS = ['fontFamily', 'secondaryFontFamily', 'isCombinedFont', 'fontSize', 'fill', 'penType', 'lineHeight', 'letterSpacing', 'wordSpacing', 'opacity', 'align', 'rotation', 'isHighlighted', 'highlightColor', 'isStrikethrough', 'strikeStyle', 'strikeColor'] as const;

/** Keep only style fields; `ink` is accepted as an alias of `fill` and resolved to a colour. */
function cleanStyle(raw: unknown): BlockOverride {
  const s = (raw || {}) as Params;
  const out: Params = {};
  for (const k of STYLE_KEYS) if (s[k] !== undefined) out[k] = s[k];
  if (typeof s.ink === 'string') out.fill = s.ink;
  if (typeof out.fill === 'string') out.fill = resolveInk(out.fill);
  if (typeof out.strikeColor === 'string') out.strikeColor = resolveInk(out.strikeColor);
  checkFont(out.fontFamily);
  checkFont(out.secondaryFontFamily);
  return out as BlockOverride;
}

function ensurePaper() {
  if (!useStore.getState().doc.paperUrl) selectPaper(PAPERS[0].url, null);
}

/** Render an SVG string or image data URL to a diagram image (pen-inked unless keepColors). */
async function diagramImage(p: Params): Promise<{ src: string; aspect: number }> {
  const target = 1800;
  let url: string;
  if (typeof p.svg === 'string') {
    const parsed = new DOMParser().parseFromString(p.svg, 'image/svg+xml');
    const el = parsed.documentElement;
    if (el.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) throw new Error('svg is not valid SVG markup.');
    if (!el.getAttribute('xmlns')) el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const dim = (a: string | null) => (a && !a.includes('%') ? parseFloat(a) : NaN);
    const vb = el.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const w = dim(el.getAttribute('width')) || vb?.[2] || 800;
    const h = dim(el.getAttribute('height')) || vb?.[3] || 600;
    if (!vb) el.setAttribute('viewBox', `0 0 ${w} ${h}`);
    // Labels in the handwriting font: an SVG drawn as an image can't see page fonts, so embed the font file.
    const font = p.handwritten !== false && el.querySelector('text') ? findFont(str(p.fontFamily) || useStore.getState().doc.template.fontFamily) : undefined;
    if (font?.url && !font.url.startsWith('blob:')) {
      const b64 = await blobToBase64(new Blob([await fontData(font.url)]));
      const css = parsed.createElementNS('http://www.w3.org/2000/svg', 'style');
      css.textContent = `@font-face{font-family:"nh-hand";src:url(data:application/octet-stream;base64,${b64})}text,tspan{font-family:"nh-hand"!important}`;
      el.insertBefore(css, el.firstChild);
    }
    el.setAttribute('width', String(target));
    el.setAttribute('height', String(Math.round((target * h) / w)));
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(el))}`;
  } else if (typeof p.dataUrl === 'string' && p.dataUrl.startsWith('data:image/')) {
    url = p.dataUrl;
  } else throw new Error('Pass svg (markup) or dataUrl (data:image/...).');
  const img = await loadImage(url).catch(() => { throw new Error('The diagram image could not be decoded.'); });
  const k = Math.min(1, target / (img.naturalWidth || target));
  const c = document.createElement('canvas');
  c.width = Math.round((img.naturalWidth || target) * k);
  c.height = Math.round((img.naturalHeight || target * 0.6) * k);
  const ctx = c.getContext('2d')!;
  if (p.keepColors) { ctx.drawImage(img, 0, 0, c.width, c.height); return { src: c.toDataURL('image/png'), aspect: c.height / c.width }; }
  ctx.fillStyle = '#fff'; // inkify keys on dark-vs-light; transparent SVG backgrounds must read as paper
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const src = inkifyCanvas(c, {
    ...DEFAULT_INK_OPTIONS,
    inkColor: resolveInk(str(p.inkColor) || str(p.ink) || '#000066'),
    roughness: num(p.roughness) ?? 1,
    lineThickness: num(p.lineThickness) ?? 2.6, // vector strokes are thin and anti-aliased: ink them boldly
  });
  return { src, aspect: c.height / c.width };
}

async function makeDiagram(p: Params): Promise<Diagram> {
  const { src, aspect } = await diagramImage(p);
  const width = Math.max(200, Math.min(2800, num(p.width) ?? 1500));
  return {
    id: `dg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    src, title: str(p.title) || 'Diagram', pageIndex: num(p.page) ?? 0,
    x: num(p.x) ?? (3000 - width) / 2, y: num(p.y) ?? 400,
    width, height: width * aspect, rotation: num(p.rotation) ?? 0, opacity: num(p.opacity) ?? 0.95,
  };
}

const blobToBase64 = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(new Error('Could not read the exported file.'));
  r.readAsDataURL(b);
});

async function exportFiles(p: Params) {
  await settle();
  const { doc, pages } = useStore.getState();
  if (!pages.length) throw new Error('Nothing to export: the document has no pages yet (add text first).');
  const files = await buildExport({
    doc, pages,
    format: p.format === 'image' ? 'image' : 'pdf',
    resolution: (str(p.resolution) as Resolution) in RESOLUTION_WIDTH ? (p.resolution as Resolution) : doc.resolution,
    fileName: str(p.fileName) || doc.text.split('\n').find((l) => l.trim() && !DIAGRAM_MARKER.test(l.trim()))?.slice(0, 60) || 'assignment',
  });
  if (!files) throw new Error('Export was cancelled.');
  return Promise.all(files.map(async (f) => ({ name: f.name, mime: f.blob.type || 'application/octet-stream', base64: await blobToBase64(f.blob) })));
}

function summary() {
  const { doc, pages, currentPage } = useStore.getState();
  const paperId = PAPERS.find((p) => p.url === doc.paperUrl)?.id || doc.customPapers.find((p) => p.url === doc.paperUrl)?.name || (doc.paperUrl ? 'custom' : null);
  return {
    pages: pages.length,
    currentPage,
    paper: paperId,
    paragraphs: doc.text.split('\n').map((t, i) => {
      const s = doc.overrides[`p${i}`];
      return { index: i, text: t.length > 140 ? `${t.slice(0, 140)}…` : t, ...(s ? { style: s } : {}) };
    }),
    template: doc.template,
    options: { moveMode: doc.moveMode, realistic: doc.realistic, charVariance: doc.charVariance, strikeRate: doc.strikeRate, autoStrikeStyle: doc.autoStrikeStyle, resolution: doc.resolution },
    diagrams: doc.diagrams.map((d) => ({ id: d.id, title: d.title, width: Math.round(d.width), height: Math.round(d.height), anchored: isAnchored(doc, d.id), page: d.pageIndex })),
    lineOverrides: Object.keys(doc.overrides).filter((k) => k.includes('-l')).length,
    canUndo: useStore.getState().history.past.length > 0,
  };
}

/* ------------------------------------------------------------------ commands */

const handlers: Record<string, (p: Params) => Promise<unknown>> = {
  async get_state() { await settle(); return summary(); },

  async list_options() {
    return {
      fonts: [...ALL_FONTS, ...customFonts()].map((f) => ({ id: f.id, name: f.name, category: f.category })),
      inks: INKS.map((i) => ({ name: i.name, value: i.value, pen: i.category })),
      pens: PENS.map((p) => p.id),
      papers: [...PAPERS.map((p) => ({ id: p.id, name: p.name, kind: 'photo' })), ...PAPER_STYLES.map((p) => ({ id: p.id, name: p.name, kind: 'generated' }))],
      strikeStyles: ['wavy', 'single', 'double', 'scribble', 'scratch', 'diagonal'],
      highlightColors: ['yellow', 'green', 'pink', 'blue', 'orange', 'purple'],
      resolutions: Object.keys(RESOLUTION_WIDTH),
      markup: { strike: '~~word~~ or ~~wavy:word~~', highlight: '==word== or ==green:word==', diagram: 'a line containing only [[diagram:ID]]', pageBreak: 'a line containing only [[pagebreak]]', math: 'LaTeX like $x^2$ / \\alpha is turned into symbols' },
    };
  },

  async set_text(p) {
    const text = str(p.text);
    if (text === undefined) throw new Error('text is required.');
    ensurePaper();
    useStore.getState().update((d) => ({ text, overrides: p.keepStyles ? d.overrides : {} }));
    await settle();
    return summary();
  },

  async append_text(p) {
    const text = str(p.text);
    if (!text) throw new Error('text is required.');
    ensurePaper();
    useStore.getState().update((d) => ({ text: d.text ? `${d.text}\n${text}` : text }));
    await settle();
    return summary();
  },

  async write_assignment(p) {
    const items = Array.isArray(p.items) ? (p.items as Params[]) : [];
    if (!items.length) throw new Error('items must contain at least one {question, answer}.');
    const qInk = resolveInk(str(p.questionInk) || 'black');
    const aInk = resolveInk(str(p.answerInk) || 'blue');
    const replace = p.replace !== false;
    if (p.paper) await handlers.set_paper({ paper: p.paper });
    ensurePaper();
    const { doc } = useStore.getState();
    const out: string[] = replace || !doc.text ? [] : doc.text.split('\n');
    const overrides: Overrides = replace ? {} : { ...doc.overrides };
    const diagrams: Diagram[] = replace ? [] : [...doc.diagrams];
    const push = (text: string, fill?: string) => { if (fill && text.trim()) overrides[`p${out.length}`] = { fill }; out.push(text); };
    if (out.length) push('');
    for (const t of String(p.title || '').split('\n').filter((l) => l.trim())) push(t, qInk);
    if (p.title) push('');
    for (const [i, it] of items.entries()) {
      if (i > 0 && p.spacing !== false) push('');
      const q = String(it.question || '').trim();
      if (!q) throw new Error(`items[${i}].question is empty.`);
      const label = p.numbered === false ? '' : `${str(p.questionPrefix) ?? 'Q'}${i + 1}. `;
      q.split('\n').forEach((l, j) => push(j === 0 ? label + l : l, qInk));
      const a = String(it.answer || '').trim();
      if (a) a.split('\n').forEach((l, j) => push(j === 0 && p.answerPrefix ? `${p.answerPrefix} ${l}` : l, aInk));
      const dg = it.diagram as Params | undefined;
      if (dg && (dg.svg || dg.dataUrl)) {
        const d = await makeDiagram({ inkColor: aInk, ...dg });
        diagrams.push(d);
        push(`[[diagram:${d.id}]]`);
      }
      if (it.pageBreakAfter) push('[[pagebreak]]');
    }
    useStore.getState().update({ text: out.join('\n'), overrides, diagrams });
    await settle();
    const result: Params = { ...summary() };
    if (p.savePdf || p.saveImages) result.files = await exportFiles({ format: p.saveImages ? 'image' : 'pdf', fileName: p.fileName, resolution: p.resolution });
    return result;
  },

  async set_paragraph_style(p) {
    const from = num(p.from) ?? num(p.paragraph);
    if (from === undefined) throw new Error('from (paragraph index) is required. get_state lists paragraphs.');
    const to = num(p.to) ?? from;
    const style = cleanStyle(p.style);
    const overrides = { ...useStore.getState().doc.overrides };
    for (let i = from; i <= to; i++) overrides[`p${i}`] = p.merge === false ? style : { ...(overrides[`p${i}`] || {}), ...style };
    useStore.getState().update({ overrides });
    await settle();
    return { styled: to - from + 1 };
  },

  async clear_paragraph_styles(p) {
    const from = num(p.from) ?? 0, to = num(p.to) ?? Infinity;
    const overrides = Object.fromEntries(Object.entries(useStore.getState().doc.overrides).filter(([k]) => {
      const m = k.match(/^p(\d+)/);
      return !m || +m[1] < from || +m[1] > to || (p.keepPositions !== false && k.includes('-l'));
    }));
    useStore.getState().update({ overrides });
    await settle();
    return { remaining: Object.keys(overrides).length };
  },

  async set_style(p) {
    const style = cleanStyle(p.style ?? p);
    useStore.getState().update((d) => ({ template: { ...d.template, ...style } }));
    await settle();
    return { template: useStore.getState().doc.template };
  },

  async set_paper(p) {
    const id = String(p.paper || '').toLowerCase();
    const page = num(p.page) ?? null;
    const photo = PAPERS.find((x) => x.id === id || x.name.toLowerCase() === id);
    if (photo) selectPaper(photo.url, page);
    else if (PAPER_STYLES.some((x) => x.id === id)) useGeneratedPaper(id as PaperStyleId, page);
    else throw new Error(`Unknown paper "${p.paper}". Use one of: ${[...PAPERS.map((x) => x.id), ...PAPER_STYLES.map((x) => x.id)].join(', ')}`);
    await settle();
    return { paper: id, page: page ?? 'all' };
  },

  async upload_page_photo(p) {
    const dataUrl = str(p.dataUrl);
    if (!dataUrl?.startsWith('data:image/')) throw new Error('dataUrl (data:image/...) is required.');
    const blob = await (await fetch(dataUrl)).blob();
    await uploadPaper(new File([blob], str(p.name) || 'page.jpg', { type: blob.type }), num(p.page) ?? null);
    useStore.getState().ui({ calibratingPage: null }); // Claude sets the area with set_writing_area instead of the guide
    await settle();
    return { ok: true, hint: 'Text uses a default writing area (10% inset). Call set_writing_area to fit the page lines.' };
  },

  async set_writing_area(p) {
    let b = p.boundary as Boundary | undefined;
    const page = num(p.page) ?? 0;
    if (!b && num(p.inset) !== undefined) {
      const { doc } = useStore.getState();
      const url = pageBackground(doc, page);
      const s = url ? doc.paperSizes[url] || doc.customPapers.find((c) => c.url === url) : null;
      b = defaultBoundaryFor(s?.width || 3000, s?.height || 4000, num(p.inset));
    }
    const ok = (q?: { x?: unknown; y?: unknown }) => q && num(q.x) !== undefined && num(q.y) !== undefined;
    if (!b || !ok(b.topLeft) || !ok(b.topRight) || !ok(b.bottomLeft) || !ok(b.bottomRight)) throw new Error('Pass boundary {topLeft,topRight,bottomLeft,bottomRight} with {x,y} in page units (page is 3000 wide), or inset (0-0.4).');
    if (p.allPages) applyBoundaryToAll(b); else saveBoundary(page, b);
    await settle();
    return { ok: true };
  },

  async set_options(p) {
    const patch: Params = {};
    for (const k of ['realistic', 'charVariance'] as const) if (typeof p[k] === 'boolean') patch[k] = p[k];
    if (num(p.strikeRate) !== undefined) patch.strikeRate = Math.max(0, Math.min(25, p.strikeRate as number));
    if (str(p.autoStrikeStyle)) patch.autoStrikeStyle = p.autoStrikeStyle;
    if (['single', 'words', 'all'].includes(String(p.moveMode))) patch.moveMode = p.moveMode;
    if (String(p.resolution) in RESOLUTION_WIDTH) patch.resolution = p.resolution;
    useStore.getState().update(patch);
    await settle();
    return summary().options;
  },

  async add_diagram(p) {
    ensurePaper();
    const d = await makeDiagram(p);
    const free = num(p.page) !== undefined && p.afterParagraph === undefined;
    const { doc, update } = useStore.getState();
    if (free) {
      update({ diagrams: [...doc.diagrams, d] });
    } else {
      const ls = doc.text ? doc.text.split('\n') : [];
      const at = Math.min(ls.length, (num(p.afterParagraph) ?? ls.length - 1) + 1);
      ls.splice(at, 0, `[[diagram:${d.id}]]`);
      update({ text: ls.join('\n'), overrides: shiftParagraphOverrides(doc.overrides, at, 1), diagrams: [...doc.diagrams, d] });
    }
    await settle();
    const placed = useStore.getState().blockPositions[d.id];
    return { id: d.id, width: Math.round(d.width), height: Math.round(d.height), page: placed?.page ?? d.pageIndex, anchored: !free };
  },

  async update_diagram(p) {
    const { doc, update } = useStore.getState();
    const d = doc.diagrams.find((x) => x.id === p.id);
    if (!d) throw new Error(`No diagram "${String(p.id)}".`);
    const next: Diagram = { ...d };
    if (num(p.width)) { next.height = (d.height / d.width) * (p.width as number); next.width = p.width as number; }
    for (const k of ['x', 'y', 'dx', 'dy', 'rotation', 'opacity', 'page'] as const) if (num(p[k]) !== undefined) (next as unknown as Params)[k === 'page' ? 'pageIndex' : k] = p[k];
    if (str(p.title)) next.title = p.title as string;
    if (p.svg || p.dataUrl) {
      const fresh = await makeDiagram({ ...p, width: next.width });
      next.src = fresh.src;
      next.height = fresh.height;
    }
    update({ diagrams: doc.diagrams.map((x) => (x.id === d.id ? next : x)) });
    await settle();
    return { id: d.id, width: Math.round(next.width), height: Math.round(next.height) };
  },

  async remove_diagram(p) {
    const { doc, update } = useStore.getState();
    if (!doc.diagrams.some((x) => x.id === p.id)) throw new Error(`No diagram "${String(p.id)}".`);
    const ls = doc.text.split('\n');
    const at = ls.findIndex((l) => l.trim() === `[[diagram:${p.id}]]`);
    let { overrides } = doc;
    if (at >= 0) { ls.splice(at, 1); overrides = shiftParagraphOverrides(doc.overrides, at + 1, -1); }
    update({ text: ls.join('\n'), overrides, diagrams: doc.diagrams.filter((x) => x.id !== p.id) });
    await settle();
    return { removed: p.id };
  },

  async render_page(p) {
    await settle();
    const { doc, pages } = useStore.getState();
    if (!pages.length) throw new Error('No pages to render yet (add text first).');
    const page = Math.max(0, Math.min(pages.length - 1, num(p.page) ?? 0));
    const c = await renderPageCanvas(doc, pages, page, Math.max(400, Math.min(2400, num(p.width) ?? 1100)));
    return { page, pages: pages.length, mime: 'image/jpeg', base64: c.toDataURL('image/jpeg', 0.82).split(',')[1] };
  },

  async export(p) { return { files: await exportFiles(p) }; },

  async upload_font(p) {
    const name = str(p.name), b64 = str(p.base64);
    if (!name || !b64) throw new Error('name and base64 are required.');
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const def = await registerCustomFont(name, buf.buffer);
    return { id: def.id, name: def.name };
  },

  async undo() { useStore.getState().undo(); await settle(); return summary(); },
  async redo() { useStore.getState().redo(); await settle(); return summary(); },
  async reset_document() { useStore.getState().resetDoc(); await settle(); return { ok: true }; },
};

/* ------------------------------------------------------------------ connection */

let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let wanted = false;
let delay = 2000; // reconnect backoff: 2s doubling to 30s while no server is running (each failed attempt logs a browser error)

function connect() {
  clearTimeout(retry);
  if (!wanted || socket) return;
  const { port } = useBridge.getState();
  useBridge.setState({ status: 'waiting' });
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  socket = ws;
  ws.onopen = () => {
    delay = 2000;
    useBridge.setState({ status: 'connected' });
    ws.send(JSON.stringify({ hello: 'notehand', version: 1 }));
    log('connect', true, 'Claude connected');
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    if (useBridge.getState().status === 'connected') log('disconnect', true, 'Claude disconnected');
    useBridge.setState({ status: wanted ? 'waiting' : 'off', busy: false });
    if (wanted) { retry = setTimeout(connect, delay); delay = Math.min(30000, delay * 2); }
  };
  ws.onerror = () => { /* onclose follows and schedules the retry */ };
  ws.onmessage = async (ev) => {
    let msg: { id?: number; method?: string; params?: Params };
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    if (msg.id === undefined || !msg.method) return;
    const fn = Object.prototype.hasOwnProperty.call(handlers, msg.method) ? handlers[msg.method] : undefined;
    useBridge.setState({ busy: true });
    try {
      if (!fn) throw new Error(`Unknown command ${msg.method}`);
      const result = await fn(msg.params || {});
      ws.send(JSON.stringify({ id: msg.id, result }));
      log(msg.method, true, describe(msg.method, msg.params));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      ws.send(JSON.stringify({ id: msg.id, error }));
      log(msg.method, false, error);
    } finally {
      useBridge.setState({ busy: false });
    }
  };
}

function describe(method: string, p?: Params) {
  if (method === 'write_assignment') return `Wrote ${(p?.items as unknown[])?.length ?? 0} question(s)${p?.savePdf ? ' and saved a PDF' : ''}`;
  if (method === 'add_diagram') return `Added diagram "${p?.title || 'Diagram'}"`;
  if (method === 'export') return `Exported ${p?.format === 'image' ? 'images' : 'PDF'}`;
  return method.replace(/_/g, ' ');
}

/** Mounted by the editor: keeps the link open while "Allow Claude" is on. */
export function useClaudeBridge() {
  const enabled = useBridge((s) => s.enabled);
  const port = useBridge((s) => s.port);
  useEffect(() => {
    wanted = enabled;
    delay = 2000;
    if (enabled) connect();
    // coming back to the tab (e.g. after starting Claude) retries at once instead of waiting out the backoff
    const onFocus = () => { if (wanted && !socket) { delay = 2000; connect(); } };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      wanted = false;
      clearTimeout(retry);
      socket?.close();
      socket = null;
      useBridge.setState({ status: 'off', busy: false });
    };
  }, [enabled, port]);
}
