// Client-side text extraction for "Upload PDF" (also DOCX and TXT). Nothing leaves the browser.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

async function fromPdf(buf: ArrayBuffer, onProgress?: (p: number) => void): Promise<string> {
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    let lastY: number | null = null;
    const lines: string[] = [];
    for (const item of content.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
      const y = item.transform?.[5] ?? 0;
      if (lastY !== null && Math.abs(y - lastY) > 2 && line.trim()) { lines.push(line.trimEnd()); line = ''; }
      line += item.str;
      if (item.hasEOL) { lines.push(line.trimEnd()); line = ''; }
      lastY = y;
    }
    if (line.trim()) lines.push(line.trimEnd());
    out.push(lines.join('\n'));
    onProgress?.(i / pdf.numPages);
  }
  return out.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function fromDocx(buf: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth');
  const r = await mammoth.extractRawText({ arrayBuffer: buf });
  return r.value.replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractText(file: File, onProgress?: (p: number) => void): Promise<string> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return fromPdf(buf, onProgress);
  if (name.endsWith('.docx')) return fromDocx(buf);
  if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) return new TextDecoder().decode(buf).trim();
  throw new Error('Unsupported file. Use PDF, DOCX or TXT.');
}

