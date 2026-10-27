// Inline markup for strikes (`~~word~~`, `~~wavy:word~~`) and highlights (`==word==`, `==green:word==`).
// Strike parsing ported from reference `cl`/`dn` (EditorPage.js 730-775). Inline highlight parsing is a
// Notehand addition: the reference recognised `==` only when splitting long words, never when drawing.

export type StrikeStyle = 'single' | 'double' | 'wavy' | 'scratch';
export type HighlightColorId = 'yellow' | 'green' | 'pink' | 'blue' | 'orange' | 'purple';

export interface HighlightColor {
  id: HighlightColorId | 'custom';
  name: string;
  hex: string;
  rgba: string;
  borderHex: string;
  darkHex: string;
  label: string;
}

export const HIGHLIGHT_COLORS: HighlightColor[] = [
  { id: 'yellow', name: 'Classic Yellow', hex: '#fef08a', rgba: 'rgba(254, 240, 138, 0.48)', borderHex: '#eab308', darkHex: '#ca8a04', label: 'Fluorescent Neon Yellow' },
  { id: 'green', name: 'Mint Green', hex: '#86efac', rgba: 'rgba(134, 239, 172, 0.45)', borderHex: '#22c55e', darkHex: '#16a34a', label: 'Pastel Mint Green' },
  { id: 'pink', name: 'Coral Pink', hex: '#f472b6', rgba: 'rgba(244, 114, 182, 0.42)', borderHex: '#ec4899', darkHex: '#db2777', label: 'Vibrant Study Pink' },
  { id: 'blue', name: 'Sky Blue', hex: '#7dd3fc', rgba: 'rgba(125, 211, 252, 0.42)', borderHex: '#0284c7', darkHex: '#0369a1', label: 'Soft Pastel Sky Blue' },
  { id: 'orange', name: 'Peach Orange', hex: '#fdba74', rgba: 'rgba(253, 186, 116, 0.46)', borderHex: '#f97316', darkHex: '#ea580c', label: 'Warm Peach Highlighter' },
  { id: 'purple', name: 'Lavender', hex: '#d8b4fe', rgba: 'rgba(216, 180, 254, 0.42)', borderHex: '#a855f7', darkHex: '#9333ea', label: 'Pastel Lavender Purple' },
];

export const STRIKE_STYLES: { id: StrikeStyle; label: string; short: string; description: string; icon: string }[] = [
  { id: 'single', label: 'Single Pen Strike', short: 'Single', description: 'Natural pen cross-out with organic slant & flick', icon: '—' },
  { id: 'double', label: 'Double Pen Strike', short: 'Double', description: 'Two rapid parallel pen passes across text', icon: '═' },
  { id: 'wavy', label: 'Wavy Pen Strike', short: 'Wavy', description: 'Fluid oscillating pen squiggle across letters', icon: '〰' },
  { id: 'scratch', label: 'Scribble Scratch', short: 'Scribble', description: 'Dense zig-zag scratch out used in quick corrections', icon: '✕' },
];

export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (isNaN(n) || h.length !== 6) return `rgba(254, 240, 138, ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function resolveHighlight(key?: string): HighlightColor {
  if (!key) return HIGHLIGHT_COLORS[0];
  const k = key.toLowerCase().trim();
  const found = HIGHLIGHT_COLORS.find((c) => c.id === k || c.name.toLowerCase() === k || c.hex.toLowerCase() === k);
  if (found) return found;
  if (k.startsWith('#') || k.startsWith('rgb')) {
    return { id: 'custom', name: 'Custom', hex: key, rgba: k.startsWith('#') ? hexToRgba(key, 0.45) : key, borderHex: key, darkHex: key, label: 'Custom Color' };
  }
  return HIGHLIGHT_COLORS[0];
}

const STRIKE_ALIASES: Record<string, StrikeStyle> = { single: 'single', double: 'double', wavy: 'wavy', scratch: 'scratch', scribble: 'scratch', diagonal: 'single' };
export const normalizeStrike = (s?: string): StrikeStyle => STRIKE_ALIASES[s || ''] || 'wavy';

/** Remove all markup tokens (reference `dn`, extended with `==`). */
export function stripMarkup(t: string): string {
  if (!t) return '';
  // Markers only count when glued to a word: `==hi==` is markup, `x == 5` / `a==b` / `===` are literal text.
  return t
    .replace(/(?<=^|[\s(\[{'"“‘])~~(?:[a-zA-Z0-9_-]+:)?(?=[^\s~])/g, '')
    .replace(/(?<=[^\s~])~~(?=$|[\s)\]}'"”’.,!?:;=])/g, '')
    .replace(/(?<=^|[\s(\[{'"“‘~:])==(?:[a-zA-Z]+:)?(?=[^\s=])/g, '')
    .replace(/(?<=[^\s=])==(?=$|[\s)\]}'"”’.,!?:;~])/g, '')
    .replace(/<\/?(del|s|strike)(\s+[^>]*)*>/gi, '')
    .replace(/\[\/?(strike)(\s+[^\]]*)*\]/gi, '');
}

export interface MarkupState {
  strike: boolean;
  strikeStyle: StrikeStyle;
  highlight: boolean;
  highlightColor: string;
}

export interface ParsedWord {
  cleanWord: string;
  hasStrike: boolean;
  strikeStyle: StrikeStyle;
  hasHighlight: boolean;
  highlightColor: string;
}

export const initialMarkupState = (strikeStyle: StrikeStyle = 'wavy'): MarkupState => ({
  strike: false,
  strikeStyle,
  highlight: false,
  highlightColor: 'yellow',
});

/**
 * Make a line (or word) self-contained: re-open spans that started on an earlier line and close spans
 * that continue on the next one. Without this, a highlight/strike crossing a line break loses its
 * middle words (a bug in the reference app).
 */
export function carryMarkup(text: string, start: MarkupState): { text: string; next: MarkupState } {
  let st = start;
  for (const w of text.split(' ')) st = parseWord(w, st).next;
  const pre = (start.strike ? `~~${start.strikeStyle}:` : '') + (start.highlight ? `==${start.highlightColor}:` : '');
  const post = (st.highlight ? '==' : '') + (st.strike ? '~~' : '');
  return { text: pre + text + post, next: st };
}

/** Parse one space-separated word; markup spans can cover several words, so state carries over. */
export function parseWord(word: string, state: MarkupState): { parsed: ParsedWord; next: MarkupState } {
  let w = word;
  let strike = state.strike;
  let strikeStyle = state.strikeStyle;
  let highlight = state.highlight;
  let highlightColor = state.highlightColor;
  let strikeEnds = false;
  let highlightEnds = false;

  // Openers must be followed by text and closers preceded by text, so a bare `==` / `~~` (e.g. `x == 5`)
  // stays literal instead of opening a span for the rest of the paragraph.
  const so = w.match(/^([(\[{'"“‘]*)~~(?:(single|double|wavy|scratch|scribble|diagonal):)?(?=[^\s~])/);
  if (so) {
    strike = true;
    if (so[2]) strikeStyle = normalizeStrike(so[2]);
    w = w.replace(/~~(?:(single|double|wavy|scratch|scribble|diagonal):)?/, '');
  }
  const ho = w.match(/^([(\[{'"“‘]*)==(?:(yellow|green|pink|blue|orange|purple):)?(?=[^\s=])/);
  if (ho) {
    highlight = true;
    if (ho[2]) highlightColor = ho[2];
    w = w.replace(/==(?:(yellow|green|pink|blue|orange|purple):)?/, '');
  }
  if (/(?<=[^\s~])~~([)\]}'"”’.,!?:;]*)$/.test(w)) {
    strike = true;
    strikeEnds = true;
    w = w.replace(/~~([)\]}'"”’.,!?:;]*)$/, '$1');
  }
  if (/(?<=[^\s=])==([)\]}'"”’.,!?:;]*)$/.test(w)) {
    highlight = true;
    highlightEnds = true;
    w = w.replace(/==([)\]}'"”’.,!?:;]*)$/, '$1');
  }
  return {
    parsed: { cleanWord: stripMarkup(w), hasStrike: strike, strikeStyle, hasHighlight: highlight, highlightColor },
    next: {
      strike: strikeEnds ? false : strike,
      strikeStyle: strikeEnds ? state.strikeStyle : strikeStyle,
      highlight: highlightEnds ? false : highlight,
      highlightColor: highlightEnds ? 'yellow' : highlightColor,
    },
  };
}
