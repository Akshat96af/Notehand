// Pagination & line layout onto a perspective writing quad. Ported from reference
// EditorPage.js 14038-14464 (see reference/02-rendering-engine-spec.md §7). Pure: canvas access goes
// through the injected Measurer so this can be unit-tested in Node.
import { FALLBACK_BOUNDARY, type Boundary } from '../data/catalog';
import type { Measurer, Overrides, TextNode, TextStyle } from './draw';
import { graphemes } from './autoMistake';
import { latexToUnicode } from './latex';
import { carryMarkup, initialMarkupState } from './markup';

export type MoveMode = 'single' | 'words' | 'all';

export interface LayoutInput {
  text: string;
  style: TextStyle;
  /** Boundary for page i (falls back to `defaultBoundary`, then FALLBACK_BOUNDARY). */
  boundaryFor: (pageIndex: number) => Boundary | null | undefined;
  defaultBoundary?: Boundary | null;
  moveMode: MoveMode;
  overrides: Overrides;
  pageOffsets: Record<number, { x: number; y: number }>;
  measurer: Measurer;
  /** Heights (page units) of `[[diagram:ID]]` blocks; each block reserves that space in the text flow. */
  blocks?: Record<string, number>;
  /** Called with where each diagram block landed (top-left of its line box and the available width). */
  onBlock?: (id: string, page: number, x: number, y: number, width: number) => void;
}

/** A line containing only `[[diagram:ID]]` reserves room for that diagram; `[[pagebreak]]` starts a new page. */
export const DIAGRAM_MARKER = /^\[\[diagram:([\w-]+)\]\]$/;
export const PAGEBREAK_MARKER = /^\[\[pagebreak\]\]$/i;

const isQuad = (b?: Boundary | null): b is Boundary => !!(b && b.topLeft && b.topRight && b.bottomLeft && b.bottomRight);

export function usableHeight(b: Boundary): number {
  return Math.max(100, (b.bottomLeft.y - b.topLeft.y + (b.bottomRight.y - b.topRight.y)) / 2 - 20);
}

/** Line origin, available width and angle at vertical offset `y` inside the quad (10px inset). */
export function lineFrame(b: Boundary, y: number) {
  const h = Math.max(100, (b.bottomLeft.y - b.topLeft.y + (b.bottomRight.y - b.topRight.y)) / 2);
  const inset = 10;
  const t = y / h;
  const lx = b.topLeft.x + (b.bottomLeft.x - b.topLeft.x) * t + inset;
  const ly = b.topLeft.y + (b.bottomLeft.y - b.topLeft.y) * t + inset;
  const rx = b.topRight.x + (b.bottomRight.x - b.topRight.x) * t - inset;
  const ry = b.topRight.y + (b.bottomRight.y - b.topRight.y) * t + inset;
  const dx = rx - lx, dy = ry - ly;
  return { leftX: lx, leftY: ly, width: Math.max(0, Math.sqrt(dx * dx + dy * dy)), angleRad: Math.atan2(dy, dx) };
}

const STRIKE_WRAP = /^(~~(?:wavy|single|double|scribble|scratch|diagonal):)([\s\S]*?)(~~)$/;
const MARK_TOKEN = /(==(?:yellow|green|pink|blue|orange|purple):|==|~~(?:wavy|single|double|scribble|scratch|diagonal):|~~)/g;
const IS_MARK = /^(==(?:yellow|green|pink|blue|orange|purple):|==|~~(?:wavy|single|double|scribble|scratch|diagonal):|~~)$/;

/** Split a too-long word into grapheme tokens, keeping markup tokens glued to their neighbours. */
function tokenize(word: string) {
  let prefix = '', suffix = '', body = word;
  const m = body.match(STRIKE_WRAP) || body.match(/^(~~)([\s\S]*?)(~~)$/);
  if (m) { prefix = m[1]; body = m[2]; suffix = m[3]; }
  const parts = latexToUnicode(body).split(MARK_TOKEN).filter(Boolean);
  const tokens: string[] = [];
  for (const p of parts) {
    if (IS_MARK.test(p)) {
      if (tokens.length > 0) tokens[tokens.length - 1] += p;
      else prefix += p;
    } else tokens.push(...graphemes(p));
  }
  return { prefix, tokens, suffix };
}

export function layoutPages(input: LayoutInput): TextNode[][] {
  const { text, moveMode, overrides: st, pageOffsets: offs, measurer } = input;
  const n: TextStyle = { ...input.style };
  if (!text || !text.trim()) return [];
  const L = n.fontSize * (n.lineHeight || 1.2);
  const fallback = isQuad(input.defaultBoundary) ? input.defaultBoundary : FALLBACK_BOUNDARY;
  const quad = (p: number): Boundary => {
    const b = input.boundaryFor(p);
    return isQuad(b) ? b : fallback;
  };
  const maxY = (p: number) => usableHeight(quad(p));
  const cache = new Map<string, number>();
  const measure = (s: string, style: TextStyle, seedId: string) => {
    const key = `${s}_${style.fontSize}_${style.fontFamily}_${style.letterSpacing}_${style.wordSpacing}_${style.isCombinedFont ? `${style.secondaryFontFamily}_${seedId}` : '0'}`;
    let v = cache.get(key);
    if (v === undefined) { v = measurer.measure(s, style, seedId); cache.set(key, v); }
    return v;
  };
  const off = (p: number) => offs[p] || { x: 0, y: 0 };

  const pages: TextNode[][] = [];
  let page: TextNode[] = [];
  let slot = 0; // node index on this page, counting hidden (deleted) blocks too
  let y = 0;
  let para = 0;
  let hasBlock = false; // a page holding only a diagram must still count as a page
  const newPage = () => { pages.push(page); page = []; slot = 0; y = 0; hasBlock = false; };

  for (const srcLine of text.split('\n')) {
    const marker = srcLine.trim();
    if (PAGEBREAK_MARKER.test(marker)) {
      if (slot > 0 || y > 0 || hasBlock) newPage();
      para++;
      continue;
    }
    const block = marker.match(DIAGRAM_MARKER);
    if (block) {
      const h = input.blocks?.[block[1]] ?? 0;
      if (h > 0) {
        // keep a diagram whole: start a new page when it doesn't fit below the current text
        if (y + h > maxY(pages.length) && (slot > 0 || y > 0 || hasBlock)) newPage();
        const fr = lineFrame(quad(pages.length), y);
        input.onBlock?.(block[1], pages.length, fr.leftX + off(pages.length).x, fr.leftY + off(pages.length).y, fr.width);
        hasBlock = true;
        y += h + L * 0.3;
        if (y + L > maxY(pages.length)) newPage();
      }
      para++;
      continue;
    }
    if (srcLine.trim() === '') {
      y += L;
      if (y + L > maxY(pages.length)) newPage();
      para++;
      continue;
    }
    const words = srcLine.split(/\s+/).filter(Boolean);
    let cur = '', curW = 0, line = 0;
    let markup = initialMarkupState();
    // paragraph-level style (`p{N}`, e.g. answers in blue) sits between the template and line overrides
    const paraStyle = st[`p${para}`] || {};
    const lineStyle = (li: number): TextStyle => ({ ...n, ...paraStyle, ...(st[`p${para}-l${li}`] || {}) });
    const budget = (s: TextStyle) => (s.isCombinedFont && s.secondaryFontFamily && s.secondaryFontFamily !== s.fontFamily ? 0.96 : 1);

    const flush = (rawText: string, lineWidth: number) => {
      if (!rawText) return;
      const carried = carryMarkup(rawText, markup);
      markup = carried.next;
      const lineText = carried.text;
      if (y + L > maxY(pages.length) && slot > 0) newPage();
      const p = pages.length;
      const fr = lineFrame(quad(p), y);
      const angleDeg = fr.angleRad * (180 / Math.PI);
      const lo = st[`p${para}-l${line}`] || {};
      const it: TextStyle = { ...n, ...paraStyle, ...lo };
      let shift = 0;
      if (it.align === 'center') shift = (fr.width - lineWidth) / 2;
      else if (it.align === 'right') shift = fr.width - lineWidth;
      const ax = fr.leftX + shift * Math.cos(fr.angleRad);
      const ay = fr.leftY + shift * Math.sin(fr.angleRad);
      if (moveMode === 'words') {
        let dx = 0, dy = 0;
        if (lo.x !== undefined) dx = lo.x - ax;
        if (lo.y !== undefined) dy = lo.y - ay;
        const ox = ax + dx + off(p).x, oy = ay + dy + off(p).y;
        const rot = lo.rotation !== undefined ? lo.rotation : angleDeg + (it.rotation || 0);
        const rad = rot * (Math.PI / 180);
        const space = measurer.space(it);
        let along = 0;
        let wm = initialMarkupState();
        lineText.split(' ').forEach((rawWord, wi) => {
          const cw = carryMarkup(rawWord, wm);
          wm = cw.next;
          const word = cw.text;
          const wo = st[`p${para}-l${line}-w${wi}`] || {};
          const ws: TextStyle = { ...it, ...wo };
          const id = `page-${p}-word-${slot++}`;
          const ww = measure(word, ws, id);
          if (!wo.hidden && !lo.hidden) page.push({
            ...ws,
            id,
            text: word,
            x: wo.x !== undefined ? wo.x + off(p).x : ox + along * Math.cos(rad),
            y: wo.y !== undefined ? wo.y + off(p).y : oy + along * Math.sin(rad),
            width: wo.width !== undefined ? wo.width : ww,
            rotation: wo.rotation !== undefined ? wo.rotation : rot,
            paragraphIndex: para,
            lineIndex: line,
            wordIndex: wi,
          });
          along += ww + space;
        });
      } else {
        const id = `page-${p}-line-${slot++}`;
        if (!lo.hidden) page.push({
          ...it,
          id,
          text: lineText,
          x: (lo.x !== undefined ? lo.x : ax) + off(p).x,
          y: (lo.y !== undefined ? lo.y : ay) + off(p).y,
          width: lineWidth,
          rotation: lo.rotation !== undefined ? lo.rotation : angleDeg + (it.rotation || 0),
          paragraphIndex: para,
          lineIndex: line,
        });
      }
      line++;
      y += L;
      if (y + L > maxY(pages.length)) newPage();
    };

    for (const word of words) {
      const s = lineStyle(line);
      const avail = lineFrame(quad(pages.length), y).width * budget(s);
      const id = `page-${pages.length}-line-${slot}`;
      const ww = measure(word, s, id);
      const candidate = cur ? curW + measurer.space(s) + ww : ww;
      if (candidate <= avail) { cur = cur ? `${cur} ${word}` : word; curW = candidate; continue; }
      if (cur) { flush(cur, curW); cur = ''; curW = 0; }
      const s2 = lineStyle(line);
      const avail2 = lineFrame(quad(pages.length), y).width * budget(s2);
      const ww2 = measure(word, s2, `page-${pages.length}-line-${slot}`);
      if (ww2 <= avail2) { cur = word; curW = ww2; continue; }
      // A single word wider than the line: binary-search the longest grapheme prefix that fits.
      const { prefix, tokens, suffix } = tokenize(word);
      let i = 0;
      while (i < tokens.length) {
        let pIdx = pages.length, nIdx = slot, yy = y;
        if (yy + L > maxY(pIdx) && nIdx > 0) { pIdx += 1; nIdx = 0; yy = 0; }
        const s3 = lineStyle(line);
        const avail3 = lineFrame(quad(pIdx), yy).width * budget(s3);
        const sid = `page-${pIdx}-line-${nIdx}`;
        let lo = 1, hi = tokens.length - i, best = 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (measure(prefix + tokens.slice(i, i + mid).join('') + suffix, s3, sid) <= avail3) { best = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        const chunk = prefix + tokens.slice(i, i + best).join('') + suffix;
        const cw = measure(chunk, s3, sid);
        i += best;
        if (i < tokens.length) flush(chunk, cw);
        else { cur = chunk; curW = cw; }
      }
    }
    if (cur) flush(cur, curW);
    para++;
  }
  if (page.length > 0 || hasBlock) pages.push(page);
  return pages;
}
