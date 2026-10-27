// End-to-end check of the Claude connector: spawns mcp/server.mjs like Claude would, waits for the editor
// (open http://127.0.0.1:5173/editor and switch on "Allow Claude"), writes a small assignment with a
// diagram, renders page 1 and saves a PDF. Usage: npm run mcp:smoke [-- outputDir]
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'notehand-smoke'));
const client = new Client({ name: 'notehand-smoke', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [path.join(import.meta.dirname, 'server.mjs')],
  env: { ...process.env, NOTEHAND_OUTPUT_DIR: out },
  stderr: 'inherit',
}));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return r;
};
const json = (r) => JSON.parse(r.content[0].text);

const { tools } = await client.listTools();
console.log(`tools (${tools.length}): ${tools.map((t) => t.name).join(', ')}`);

console.log('waiting for the editor (open it and switch on "Allow Claude")…');
for (let i = 0; ; i++) {
  try { await call('get_state'); break; } catch (e) { if (i > 90) throw e; await new Promise((r) => setTimeout(r, 1000)); }
}

const svg = `<svg viewBox="0 0 800 420" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#000" stroke-width="5">
  <rect x="330" y="160" width="140" height="100"/>
  <line x1="400" y1="160" x2="400" y2="40"/><polygon points="400,30 390,52 410,52" fill="#000"/>
  <line x1="400" y1="260" x2="400" y2="380"/><polygon points="400,390 390,368 410,368" fill="#000"/>
  <line x1="470" y1="210" x2="640" y2="210"/><polygon points="650,210 628,200 628,220" fill="#000"/>
  <text x="415" y="60" font-size="46" fill="#000" stroke="none">N</text>
  <text x="415" y="380" font-size="46" fill="#000" stroke="none">mg</text>
  <text x="600" y="195" font-size="46" fill="#000" stroke="none">F</text>
</svg>`;

const wrote = json(await call('write_assignment', {
  title: 'Physics Assignment\nName: Test Student',
  items: [
    { question: "State Newton's second law.", answer: 'The net force on a body equals its mass times its acceleration: F = m × a.', diagram: { svg, title: 'Free-body diagram', width: 1300 } },
    { question: 'Define inertia.', answer: 'Inertia is the tendency of a body to resist any change in its state of rest or motion.' },
  ],
  paper: 'classic',
  savePdf: true,
  fileName: 'notehand-smoke',
}));
const styled = wrote.paragraphs.filter((p) => p.style);
console.log(`pages: ${wrote.pages}, styled paragraphs: ${styled.map((p) => `${p.index}:${p.style.fill}`).join(' ')}`);
console.log(`diagrams: ${wrote.diagrams.map((d) => `${d.id} anchored=${d.anchored}`).join(', ')}`);
console.log(`pdf: ${wrote.files.map((f) => `${f.path} (${f.bytes} bytes)`).join(', ')}`);

const img = await call('render_page', { page: 0, width: 900 });
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'page-1.jpg'), Buffer.from(img.content[0].data, 'base64'));
console.log(`render_page: ${img.content[1].text} → ${path.join(out, 'page-1.jpg')}`);

const pdf = await fs.readFile(wrote.files[0].path);
if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('saved file is not a PDF');
if (!styled.some((p) => p.style.fill === '#212326') || !styled.some((p) => p.style.fill === '#000066')) throw new Error('questions/answers are not black/blue');
console.log('OK');
await client.close();
