import { describe, expect, it } from 'vitest';
import { PAPERS } from '../data/catalog';
import { applyAutoMistakes, isEligible, misspell } from './autoMistake';
import { parseColor, type Measurer, type TextStyle } from './draw';
import { latexToUnicode, looksLikeLatex } from './latex';
import { layoutPages, lineFrame, usableHeight } from './layout';
import { initialMarkupState, parseWord, stripMarkup } from './markup';
import { hash01, rng } from './rand';

// Fixed-width fake font: every char = 0.5·size, space = 0.3·size.
const fake: Measurer = {
  measure: (t, s) => stripMarkup(t).length * s.fontSize * 0.5,
  space: (s) => s.fontSize * 0.3 + (s.letterSpacing || 0) + (s.wordSpacing || 0) * 10,
};
const style: TextStyle = { fontSize: 96, fontFamily: 'cursive_real', fill: '#000066', lineHeight: 1.2, letterSpacing: 0, wordSpacing: 0, opacity: 0.8, align: 'left' };
const classic = PAPERS[0].boundary;

describe('prng', () => {
  it('is deterministic and in [0,1)', () => {
    expect(rng(42)).toBe(rng(42));
    expect(hash01(7)).toBe(hash01(7));
    for (let i = 0; i < 200; i++) {
      expect(rng(i)).toBeGreaterThanOrEqual(0);
      expect(rng(i)).toBeLessThan(1);
    }
  });
});

describe('latex', () => {
  it('converts common constructs', () => {
    expect(latexToUnicode('\\frac{1}{2}')).toBe('1/2');
    expect(latexToUnicode('\\sqrt{x}')).toBe('√x');
    expect(latexToUnicode('x^2 + y_1')).toBe('x² + y₁');
    expect(latexToUnicode('F = m \\times a')).toBe('F = m × a');
    expect(latexToUnicode('\\alpha \\to \\beta')).toBe('α → β');
    expect(looksLikeLatex('plain words')).toBe(false);
    expect(looksLikeLatex('\\frac{a}{b}')).toBe(true);
  });
});

describe('markup', () => {
  it('parses multi-word strike and highlight spans', () => {
    let st = initialMarkupState();
    const out = '~~double:hello there~~ ==green:hi== plain'.split(' ').map((w) => { const r = parseWord(w, st); st = r.next; return r.parsed; });
    expect(out.map((p) => p.cleanWord)).toEqual(['hello', 'there', 'hi', 'plain']);
    expect(out.map((p) => p.hasStrike)).toEqual([true, true, false, false]);
    expect(out[0].strikeStyle).toBe('double');
    expect(out[2].hasHighlight).toBe(true);
    expect(out[2].highlightColor).toBe('green');
    expect(out[3].hasHighlight).toBe(false);
  });
});

describe('literal == and ~~', () => {
  const parse = (text: string) => { let st = initialMarkupState(); return text.split(' ').map((w) => { const r = parseWord(w, st); st = r.next; return { ...r.parsed, open: st.highlight || st.strike }; }); };
  it('keeps bare markers as text and never opens a span', () => {
    const out = parse('if x == 5 then a ~~ b and c===d');
    expect(out.map((p) => p.cleanWord)).toEqual(['if', 'x', '==', '5', 'then', 'a', '~~', 'b', 'and', 'c===d']);
    expect(out.some((p) => p.hasHighlight || p.hasStrike || p.open)).toBe(false);
    expect(stripMarkup('x == 5, a==b, ==hi== ~~no~~')).toBe('x == 5, a==b, hi no');
  });
});

describe('auto mistake', () => {
  const text = 'The quick brown fox jumps over the lazy dog because they would like to make some time for other things.';
  it('is a no-op at 0%', () => expect(applyAutoMistakes(text, 0)).toBe(text));
  it('is deterministic', () => expect(applyAutoMistakes(text, 25)).toBe(applyAutoMistakes(text, 25)));
  it('injects ~~typo~~ correct pairs at high rates', () => {
    const out = applyAutoMistakes(text, 25, 'wavy');
    expect(out).toMatch(/~~wavy:[^~]+~~ \w+/);
    expect(stripMarkup(out).length).toBeGreaterThan(text.length);
  });
  it('never touches URLs, LaTeX, emails', () => {
    expect(isEligible('https://x.com')).toBe(false);
    expect(isEligible('\\frac{1}{2}')).toBe(false);
    expect(isEligible('a@b.com')).toBe(false);
    const t = Array(40).fill('https://example.com \\sqrt{x} me@mail.com').join(' ');
    expect(applyAutoMistakes(t, 25)).toBe(t);
  });
  it('uses the dictionary and keeps case', () => {
    expect(misspell('the', 1)).toBe('teh');
    expect(misspell('The', 1)).toBe('Teh');
    expect(misspell('THE', 1)).toBe('TEH');
  });
});

describe('layout', () => {
  it('follows the quad and paginates', () => {
    const h = usableHeight(classic);
    expect(h).toBeGreaterThan(3600);
    const f = lineFrame(classic, 0);
    expect(f.leftX).toBeCloseTo(classic.topLeft.x + 10, 5);
    expect(f.width).toBeGreaterThan(2600);
    const long = Array(800).fill('word').join(' ');
    const pages = layoutPages({ text: long, style, boundaryFor: () => classic, moveMode: 'single', overrides: {}, pageOffsets: {}, measurer: fake });
    expect(pages.length).toBeGreaterThan(1);
    const L = 96 * 1.2;
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(Math.floor(h / L) + 1);
    // every line fits its available width
    for (const p of pages) for (const n of p) expect(n.width).toBeLessThanOrEqual(2650);
  });
  it('splits an over-long word with binary search', () => {
    const pages = layoutPages({ text: 'x'.repeat(200), style, boundaryFor: () => classic, moveMode: 'single', overrides: {}, pageOffsets: {}, measurer: fake });
    const lines = pages.flat();
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.map((l) => l.text).join('')).toBe('x'.repeat(200));
  });
  it('words mode emits one node per word, overrides win', () => {
    const pages = layoutPages({ text: 'hello big world', style, boundaryFor: () => classic, moveMode: 'words', overrides: { 'p0-l0-w1': { x: 999, y: 888 } }, pageOffsets: {}, measurer: fake });
    expect(pages[0].map((n) => n.text)).toEqual(['hello', 'big', 'world']);
    expect(pages[0][1].x).toBe(999);
    expect(pages[0][1].y).toBe(888);
  });
  it('keeps strike/highlight spans that cross line breaks and word splits', () => {
    const words = Array(40).fill('lorem').join(' ');
    const lines = layoutPages({ text: `==green:${words}== ~~double:${words}~~`, style, boundaryFor: () => classic, moveMode: 'single', overrides: {}, pageOffsets: {}, measurer: fake }).flat();
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) {
      let st = initialMarkupState();
      const parsed = l.text.split(' ').map((w) => { const r = parseWord(w, st); st = r.next; return r.parsed; });
      for (const p of parsed) expect(p.hasHighlight || p.hasStrike).toBe(true);
      expect(st.highlight || st.strike).toBe(false); // every line closes its spans
    }
    const strikeWords = lines.flatMap((l) => { let st = initialMarkupState(); return l.text.split(' ').map((w) => { const r = parseWord(w, st); st = r.next; return r.parsed; }); }).filter((p) => p.hasStrike);
    expect(strikeWords.every((p) => p.strikeStyle === 'double')).toBe(true);
    const wordNodes = layoutPages({ text: '==a b c==', style, boundaryFor: () => classic, moveMode: 'words', overrides: {}, pageOffsets: {}, measurer: fake }).flat();
    expect(wordNodes.map((n) => parseWord(n.text, initialMarkupState()).parsed.hasHighlight)).toEqual([true, true, true]);
  });
  it('blank lines advance and line ids are stable', () => {
    const a = layoutPages({ text: 'one\n\ntwo', style, boundaryFor: () => classic, moveMode: 'single', overrides: {}, pageOffsets: {}, measurer: fake });
    expect(a[0].map((n) => n.id)).toEqual(['page-0-line-0', 'page-0-line-1']);
    expect(a[0][1].y - a[0][0].y).toBeGreaterThan(96 * 1.2 * 1.9);
  });
  it('parses ink colours with zero channels (diagram ink used to turn navy into steel blue)', () => {
    expect(parseColor('#000066')).toEqual({ r: 0, g: 0, b: 102 });
    expect(parseColor('#000')).toEqual({ r: 0, g: 0, b: 0 });
  });
  it('diagram blocks reserve space, page breaks split pages, paragraph styles apply', () => {
    const base = { style, boundaryFor: () => classic, moveMode: 'single' as const, pageOffsets: {}, measurer: fake };
    const spots: Record<string, { page: number; y: number }> = {};
    const pages = layoutPages({
      ...base,
      text: 'Q1. Question\nAnswer\n[[diagram:d1]]\nAfter\n[[pagebreak]]\nNext page',
      overrides: { p0: { fill: '#212326' }, p1: { fill: '#000066' } },
      blocks: { d1: 900 },
      onBlock: (id, page, _x, y) => { spots[id] = { page, y }; },
    });
    expect(pages.length).toBe(2);
    expect(pages[0].map((n) => n.fill)).toEqual(['#212326', '#000066', style.fill]);
    expect(spots.d1.page).toBe(0);
    const [, answer, after] = pages[0];
    expect(spots.d1.y).toBeGreaterThan(answer.y);
    expect(after.y - spots.d1.y).toBeGreaterThanOrEqual(900); // text resumes below the diagram
    expect(pages[1][0].text).toBe('Next page');
    // a diagram that does not fit moves to the next page whole
    const tall = layoutPages({ ...base, text: 'top\n[[diagram:big]]', overrides: {}, blocks: { big: usableHeight(classic) - 50 }, onBlock: (id, page) => { spots[id] = { page, y: 0 }; } });
    expect(tall.length).toBe(2);
    expect(spots.big.page).toBe(1);
  });
});
