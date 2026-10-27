#!/usr/bin/env node
// Notehand MCP server. Claude talks to this over stdio (MCP); the Notehand editor in the browser connects
// to it over a localhost WebSocket once the user switches on "Allow Claude" (src/lib/claudeBridge.ts).
// Every tool forwards to the editor, so Claude drives the real app: same layout, fonts, papers, export.
// stdout belongs to MCP: log to stderr only.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import { z } from 'zod';

const PORT = Number(process.env.NOTEHAND_BRIDGE_PORT) || 4823;
const OUT_DIR = process.env.NOTEHAND_OUTPUT_DIR || path.join(os.homedir(), 'Documents', 'Notehand');
const APP_URL = process.env.NOTEHAND_APP_URL || 'http://127.0.0.1:5173/editor';
const log = (...a) => console.error('[notehand-mcp]', ...a);

/* ------------------------------------------------------------------ bridge to the editor */

let app = null;
let bridgeError = null;
let seq = 0;
const waiting = new Map();
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const wss = new WebSocketServer({
  host: '127.0.0.1',
  port: PORT,
  maxPayload: 256 * 1024 * 1024,
  // only pages served from this machine may take commands (blocks random websites in the same browser)
  verifyClient: ({ origin }) => !!origin && LOCAL_ORIGIN.test(origin),
});
wss.on('listening', () => log(`waiting for the Notehand editor on ws://127.0.0.1:${PORT}`));
wss.on('error', (e) => {
  bridgeError = e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use (is another Notehand MCP server running?). Set NOTEHAND_BRIDGE_PORT to another port and use the same port in the editor's Claude panel.` : e.message;
  log(bridgeError);
});
wss.on('connection', (ws) => {
  if (app) app.close(4000, 'replaced by a newer editor tab');
  app = ws;
  log('editor connected');
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    clearTimeout(w.timer);
    if (msg.error) w.reject(new Error(msg.error));
    else w.resolve(msg.result);
  });
  ws.on('close', () => {
    if (app === ws) { app = null; log('editor disconnected'); }
    for (const [id, w] of waiting) if (w.ws === ws) { waiting.delete(id); clearTimeout(w.timer); w.reject(new Error('The Notehand editor disconnected before answering.')); }
  });
});

function call(method, params = {}, timeoutMs = 180_000) {
  if (!app || app.readyState !== 1) {
    return Promise.reject(new Error(bridgeError || `Notehand is not connected. Start the app (npm run dev), open ${APP_URL}, click "Claude" in the header and switch on "Allow Claude to control this editor".`));
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    waiting.set(id, { resolve, reject, timer, ws: app });
    app.send(JSON.stringify({ id, method, params }));
  });
}

/* ------------------------------------------------------------------ files */

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

/** Image file on disk → { svg } for .svg files, else { dataUrl }. */
async function readImage(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.svg') return { svg: await fs.readFile(file, 'utf8') };
  const mime = MIME[ext];
  if (!mime) throw new Error(`Unsupported image type ${ext || '(none)'}: use PNG, JPG, WEBP, GIF or SVG.`);
  return { dataUrl: `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}` };
}

async function uniquePath(dir, name) {
  const { name: stem, ext } = path.parse(path.basename(name));
  for (let i = 0; ; i++) {
    const p = path.join(dir, i ? `${stem}-${i}${ext}` : `${stem}${ext}`);
    try { await fs.access(p); } catch { return p; }
  }
}

/** Results carrying exported files ({name, base64}) are written to disk and replaced by their paths. */
async function saveFiles(result, outputDir) {
  if (!result || !Array.isArray(result.files)) return result;
  const dir = path.resolve(outputDir || OUT_DIR);
  await fs.mkdir(dir, { recursive: true });
  const files = [];
  for (const f of result.files) {
    const buf = Buffer.from(f.base64, 'base64');
    const p = await uniquePath(dir, f.name);
    await fs.writeFile(p, buf);
    files.push({ path: p, bytes: buf.length });
  }
  return { ...result, files };
}

/* ------------------------------------------------------------------ MCP */

const server = new McpServer(
  { name: 'notehand', version: '0.1.0' },
  {
    instructions: `Controls the Notehand editor (text → realistic handwritten notebook pages → PDF/JPG) running in the user's browser.
Typical assignment flow: write_assignment (questions in black, answers in blue by default; add a diagram per item as SVG) → render_page to look at the result → fix with set_paragraph_style / update_diagram / set_style → export (or pass savePdf:true to write_assignment). Files are saved to ${OUT_DIR} unless outputDir is given.
Text model: every line of the text is a paragraph (index = line number, see get_state). A line containing only [[diagram:ID]] reserves room for that diagram in the flow; [[pagebreak]] starts a new page. Markup: ~~typo~~ strikes out, ==word== highlights, LaTeX such as $x^2$ or \\alpha becomes symbols.
Diagrams: send clean SVG with a viewBox (about 800 wide), black strokes 5-6px on a transparent or white background, labels with font-size 40-50 (they render in the handwriting font). They are inked in the pen colour (keepColors:true keeps colours). Width is in page units: the page is 3000 wide, 1200-1800 suits most diagrams.
If a tool says Notehand is not connected, ask the user to open ${APP_URL}, click "Claude" in the header and switch on "Allow Claude".`,
  },
);

const style = z.object({
  fontFamily: z.string().describe('font id from list_options'),
  secondaryFontFamily: z.string(),
  isCombinedFont: z.boolean(),
  fontSize: z.number().min(20).max(400).describe('page units; default 96'),
  ink: z.string().describe('hex colour, ink name, or a word like black / blue / red / green'),
  fill: z.string(),
  penType: z.enum(['ballpoint', 'gel', 'ink']),
  lineHeight: z.number().min(0.6).max(4),
  letterSpacing: z.number(),
  wordSpacing: z.number(),
  opacity: z.number().min(0.05).max(1),
  align: z.enum(['left', 'center', 'right']),
  rotation: z.number(),
  isHighlighted: z.boolean(),
  highlightColor: z.string(),
  isStrikethrough: z.boolean(),
  strikeStyle: z.enum(['wavy', 'single', 'double', 'scribble', 'scratch', 'diagonal']),
  strikeColor: z.string(),
}).partial();

const diagramFields = {
  svg: z.string().optional().describe('SVG markup (preferred)'),
  imagePath: z.string().optional().describe('absolute path of a PNG/JPG/WEBP/SVG file instead of svg'),
  title: z.string().optional(),
  width: z.number().min(200).max(2800).optional().describe('page units (page is 3000 wide); default 1500'),
  inkColor: z.string().optional().describe('pen colour for the diagram; default: answer ink'),
  keepColors: z.boolean().optional().describe('keep original colours instead of inking'),
  roughness: z.number().min(0).max(10).optional().describe('hand-drawn wobble, default 1'),
  lineThickness: z.number().min(0.2).max(4).optional().describe('ink boldness, default 2.6'),
  handwritten: z.boolean().optional().describe('write SVG <text> labels in the handwriting font (default true)'),
  fontFamily: z.string().optional().describe('font id for labels; default: the document font'),
};
const paper = z.string().describe('classic | natural (photos) or ruled | blank | grid | dotted | parchment (generated)');
const resolution = z.enum(['low', 'normal', 'high']);
const outputDir = z.string().optional().describe(`folder for saved files; default ${OUT_DIR}`);

async function withImage(args) {
  if (!args.imagePath) return args;
  const { imagePath, ...rest } = args;
  return { ...rest, ...(await readImage(imagePath)) };
}

function tool(name, description, inputSchema, run = (a) => call(name, a)) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      const r = await run(args || {});
      if (r && Array.isArray(r.content)) return r;
      return { content: [{ type: 'text', text: JSON.stringify(r ?? { ok: true }, null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] };
    }
  });
}

tool('get_state', 'Current document: paragraphs (index, text, style), page count, paper, template style, options and diagrams.', {});
tool('list_options', 'Fonts (ids), inks, pens, papers, strike/highlight styles, resolutions and the text markup syntax.', {});

tool('write_assignment',
  'Write a whole assignment in one go: each item becomes a question (black by default) followed by its answer (blue by default) and an optional diagram placed right after the answer. Replaces the document unless replace:false. savePdf:true also saves the PDF and returns its path.',
  {
    items: z.array(z.object({
      question: z.string(),
      answer: z.string().optional().describe('use \\n for new lines; markup and LaTeX allowed'),
      diagram: z.object(diagramFields).optional(),
      pageBreakAfter: z.boolean().optional(),
    })).min(1),
    title: z.string().optional().describe('heading lines (name, subject…) written in the question ink'),
    replace: z.boolean().optional().describe('default true'),
    questionInk: z.string().optional().describe('default black'),
    answerInk: z.string().optional().describe('default blue'),
    numbered: z.boolean().optional().describe('prefix questions with Q1., Q2. … (default true)'),
    questionPrefix: z.string().optional().describe('default "Q"'),
    answerPrefix: z.string().optional().describe('e.g. "Ans." before each answer'),
    spacing: z.boolean().optional().describe('blank line between items (default true)'),
    paper: paper.optional(),
    savePdf: z.boolean().optional(),
    saveImages: z.boolean().optional().describe('save one JPG per page instead of a PDF'),
    fileName: z.string().optional(),
    resolution: resolution.optional(),
    outputDir,
  },
  async ({ outputDir: dir, ...a }) => {
    const items = await Promise.all(a.items.map(async (it) => (it.diagram ? { ...it, diagram: await withImage(it.diagram) } : it)));
    return saveFiles(await call('write_assignment', { ...a, items }, 600_000), dir);
  });

tool('set_text', 'Replace the whole text (clears per-paragraph styles unless keepStyles).', { text: z.string(), keepStyles: z.boolean().optional() });
tool('append_text', 'Append lines to the end of the text.', { text: z.string() });
tool('set_paragraph_style', 'Style paragraphs from..to (inclusive, line indices from get_state): ink, font, size, alignment, highlight…', {
  from: z.number().int().min(0), to: z.number().int().min(0).optional(), style, merge: z.boolean().optional().describe('merge with existing style (default true)'),
});
tool('clear_paragraph_styles', 'Remove paragraph styles in a range (all by default).', { from: z.number().int().optional(), to: z.number().int().optional(), keepPositions: z.boolean().optional() });
tool('set_style', 'Change the global handwriting style (default font, size, ink, pen, spacing) for all text without its own style.', { style });
tool('set_paper', 'Choose the page background for all pages, or one page.', { paper, page: z.number().int().min(0).optional() });
tool('upload_page_photo', 'Use a photo of a real notebook page (file on disk) as background for all pages or one page.', { path: z.string(), page: z.number().int().min(0).optional() },
  async ({ path: file, page }) => {
    const img = await readImage(file);
    if (!img.dataUrl) throw new Error('Use a JPG, PNG or WEBP photo.');
    return call('upload_page_photo', { dataUrl: img.dataUrl, name: path.basename(file), page });
  });
const pt = z.object({ x: z.number(), y: z.number() });
tool('set_writing_area', 'Set where text goes on the page: a quad in page units (3000 wide) or a uniform inset fraction.', {
  page: z.number().int().min(0).optional(), allPages: z.boolean().optional(),
  inset: z.number().min(0).max(0.4).optional(),
  boundary: z.object({ topLeft: pt, topRight: pt, bottomLeft: pt, bottomRight: pt }).optional(),
});
tool('set_options', 'Realism and behaviour options.', {
  realistic: z.boolean().optional().describe('photo-like lighting, tilt and ink texture'),
  charVariance: z.boolean().optional().describe('vary each letter slightly'),
  strikeRate: z.number().min(0).max(25).optional().describe('% of words with an auto crossed-out typo (0 = off)'),
  autoStrikeStyle: z.enum(['wavy', 'single', 'double', 'scribble', 'scratch', 'diagonal']).optional(),
  moveMode: z.enum(['single', 'words', 'all']).optional(),
  resolution: resolution.optional(),
});

tool('add_diagram', 'Add a diagram. By default it is anchored in the text after paragraph afterParagraph (or at the end) and flows with it; pass page (+x, y) instead to place it freely.', {
  ...diagramFields,
  afterParagraph: z.number().int().min(-1).optional(),
  page: z.number().int().min(0).optional(), x: z.number().optional(), y: z.number().optional(),
}, async (a) => call('add_diagram', await withImage(a)));
tool('update_diagram', 'Resize, nudge (dx/dy for anchored, x/y for free), rotate, re-title or redraw a diagram.', {
  id: z.string(), ...diagramFields,
  dx: z.number().optional(), dy: z.number().optional(), x: z.number().optional(), y: z.number().optional(),
  rotation: z.number().optional(), opacity: z.number().min(0.05).max(1).optional(), page: z.number().int().min(0).optional(),
}, async (a) => call('update_diagram', await withImage(a)));
tool('remove_diagram', 'Delete a diagram (and its place in the text).', { id: z.string() });

tool('render_page', 'Look at a page exactly as it will export (JPEG).', { page: z.number().int().min(0).optional(), width: z.number().min(400).max(2400).optional() },
  async (a) => {
    const r = await call('render_page', a);
    return { content: [{ type: 'image', data: r.base64, mimeType: r.mime }, { type: 'text', text: `Page ${r.page + 1} of ${r.pages}` }] };
  });
tool('export', 'Save the document as a PDF (default) or one JPG per page, and return the file paths.', {
  format: z.enum(['pdf', 'image']).optional(), resolution: resolution.optional(), fileName: z.string().optional(), outputDir,
}, async ({ outputDir: dir, ...a }) => saveFiles(await call('export', a, 600_000), dir));
tool('upload_font', 'Add a handwriting font from a .ttf/.otf/.woff file on disk; returns its font id.', { path: z.string(), name: z.string().optional() },
  async ({ path: file, name }) => call('upload_font', { name: name || path.parse(file).name, base64: (await fs.readFile(file)).toString('base64') }));
tool('undo', 'Undo the last change.', {});
tool('redo', 'Redo.', {});
tool('reset_document', 'Clear the document (can be undone).', {});

await server.connect(new StdioServerTransport());
log('MCP server ready');
