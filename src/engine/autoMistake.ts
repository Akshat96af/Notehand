// "Auto Mistake": deterministically inject `~~typo~~ correct` pairs so a few words look crossed out
// and rewritten. Ported from reference EditorPage.js 9408-10020 (`fr`, `Tl`, `Pl`, `$l`).
import typos from '../data/typos.json';
import { strHash } from './rand';
import type { StrikeStyle } from './markup';

const TYPOS = typos as Record<string, string>;

export function graphemes(t: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(seg.segment(t), (s) => s.segment);
    } catch { /* fall through */ }
  }
  const m = t.match(/(?:[\p{L}\p{N}\p{S}\p{P}][\p{M}]*)/gu);
  return m && m.length > 0 ? m : Array.from(t);
}

type Script = 'devanagari' | 'arabic' | 'cyrillic' | 'greek' | 'cjk' | 'hebrew' | 'latin' | 'other';
export function detectScript(t: string): Script {
  if (/[ऀ-ॿ]/.test(t)) return 'devanagari';
  if (/[؀-ۿݐ-ݿࢠ-ࣿ]/.test(t)) return 'arabic';
  if (/[Ѐ-ӿ]/.test(t)) return 'cyrillic';
  if (/[Ͱ-Ͽ]/.test(t)) return 'greek';
  if (/[一-鿿぀-ヿ가-힯]/.test(t)) return 'cjk';
  if (/[֐-׿]/.test(t)) return 'hebrew';
  if (/[a-zA-ZÀ-ɏ]/.test(t)) return 'latin';
  return 'other';
}

/** A typo must differ from the word and not merely be its prefix. */
function isUsableTypo(word: string, typo: string): boolean {
  if (!typo || typo.trim().length < 2) return false;
  const a = word.toLowerCase(), b = typo.toLowerCase();
  return !(a === b || a.startsWith(b));
}

/** Copy the casing pattern of `word` onto `typo` (ALL CAPS, Capitalised, lower). */
function matchCase(word: string, typo: string): string {
  if (word.toUpperCase() === word.toLowerCase()) return typo;
  if (word === word.toUpperCase() && word.length > 1) return typo.toUpperCase();
  const c = word.charAt(0);
  if (c.toUpperCase() === c && c.toLowerCase() !== c) {
    const g = graphemes(typo);
    if (g.length > 0) return g[0].toUpperCase() + g.slice(1).join('').toLowerCase();
  }
  return typo.toLowerCase();
}

const VOWEL_SWAPS: Record<string, Record<string, string>> = {
  devanagari: { 'ि': 'ी', 'ी': 'ि', 'ु': 'ू', 'ू': 'ु', 'े': 'ै', 'ै': 'े', 'ो': 'ौ', 'ौ': 'ो' },
  arabic: { ب: 'ت', ت: 'ث', ث: 'ت', ر: 'ز', ز: 'ر', د: 'ذ', ذ: 'د', س: 'ش', ش: 'س', ف: 'ق', ق: 'ف', ج: 'ح', ح: 'خ', خ: 'ج', ه: 'ة', ة: 'ه' },
};

/** Produce a plausible misspelling of `t`; `u` is a hash that picks the strategy. */
export function misspell(t: string, u: number): string {
  const lower = t.toLowerCase();
  for (const key of [lower, t]) {
    const d = TYPOS[key];
    if (d && isUsableTypo(t, d)) return matchCase(t, d);
  }
  const N = graphemes(t), j = N.length;
  if (j < 2) return t;
  const script = detectScript(t);
  const strategies: (() => string)[] = [
    () => {
      // transpose two adjacent letters
      if (j === 2) return N[1] + N[0];
      const i = j === 3 ? (u % 2 === 0 ? 1 : 0) : 1 + (u % (j - 2));
      const f = [...N];
      [f[i], f[i + 1]] = [f[i + 1], f[i]];
      return f.join('');
    },
    () => {
      // swap a vowel / matra / look-alike letter, script-aware
      if (script === 'devanagari') {
        for (let f = 0; f < j; f++) for (const [a, b] of Object.entries(VOWEL_SWAPS.devanagari)) if (N[f].includes(a)) { const G = [...N]; G[f] = N[f].replace(a, b); return G.join(''); }
      } else if (script === 'arabic') {
        for (let f = 1; f < j; f++) if (VOWEL_SWAPS.arabic[N[f]]) { const z = [...N]; z[f] = VOWEL_SWAPS.arabic[N[f]]; return z.join(''); }
      } else {
        const vowels = script === 'cyrillic' ? ['а', 'о', 'е', 'и', 'у', 'ы', 'э'] : script === 'greek' ? ['α', 'ε', 'η', 'ι', 'ο', 'υ', 'ω'] : ['a', 'e', 'i', 'o', 'u'];
        const step = script === 'cyrillic' ? 1 + (u % 2) : script === 'greek' ? 1 : 1 + (u % 3);
        for (let f = 1; f < j; f++) {
          const C = N[f].toLowerCase(), z = vowels.indexOf(C);
          if (z !== -1) { const D = [...N]; const G = vowels[(z + step) % vowels.length]; D[f] = D[f] === C ? G : G.toUpperCase(); return D.join(''); }
        }
      }
      return '';
    },
    () => {
      // common suffix slips
      if (lower.endsWith('tion')) return t.slice(0, -4) + 'toin';
      if (lower.endsWith('ción')) return t.slice(0, -4) + 'coin';
      if (lower.endsWith('mente') && j >= 6) return t.slice(0, -5) + 'mnete';
      if (lower.endsWith('ing') && j >= 5) return t.slice(0, -3) + 'ign';
      if (lower.endsWith('ment') && j >= 6) return t.slice(0, -4) + 'mnet';
      if (lower.endsWith('ed') && j >= 4) return t.slice(0, -2) + 'de';
      if (lower.endsWith('ly') && j >= 4) return t.slice(0, -2) + 'yl';
      if (lower.endsWith('ung') && j >= 5) return t.slice(0, -3) + 'ugn';
      if (lower.endsWith('keit') && j >= 6) return t.slice(0, -4) + 'kiet';
      if (lower.endsWith('тся') && j >= 5) return t.slice(0, -3) + 'ться';
      if (lower.endsWith('ться') && j >= 6) return t.slice(0, -4) + 'тся';
      if (t.endsWith('ों') && j >= 3) return t.slice(0, -2) + 'ो';
      if (t.endsWith('एं') && j >= 3) return t.slice(0, -2) + 'े';
      return '';
    },
    () => {
      // undouble or double a letter
      for (let i = 0; i < j - 1; i++) if (N[i] === N[i + 1]) { const f = [...N]; f.splice(i, 1); return f.join(''); }
      if (j >= 3) { const i = 1 + (u % (j - 2)); const f = [...N]; f.splice(i, 0, f[i]); return f.join(''); }
      return '';
    },
    () => {
      // swap last two letters
      const f = [...N];
      [f[j - 2], f[j - 1]] = [f[j - 1], f[j - 2]];
      return f.join('');
    },
  ];
  const start = u % strategies.length;
  for (let i = 0; i < strategies.length; i++) {
    const c = strategies[(start + i) % strategies.length]();
    if (c && isUsableTypo(t, c)) return matchCase(t, c);
  }
  const v = [...N];
  [v[0], v[1]] = [v[1], v[0]];
  if (isUsableTypo(t, v.join(''))) return matchCase(t, v.join(''));
  if (N.length >= 3) {
    const w = [...N];
    [w[j - 2], w[j - 1]] = [w[j - 1], w[j - 2]];
    if (isUsableTypo(t, w.join(''))) return matchCase(t, w.join(''));
  }
  return t;
}

/** Tokens we never touch: math, markup, URLs, emails, paths, very short words. */
export function isEligible(t: string): boolean {
  return !(
    !t || t.trim().length < 2 ||
    /[\\${}^_@/]/.test(t) || t.includes('~~') || t.includes('==') || t.includes('**') || t.includes('##') ||
    t.includes('http://') || t.includes('https://') || t.includes('www.') || t.includes('[[') || t.includes(']]') ||
    t.replace(/[^\p{L}\p{M}]/gu, '').length < 2
  );
}

/**
 * Apply auto mistakes. `percent` = 1 means ~1% of eligible words. Deterministic for a given text.
 * Output example: "the ~~teh~~ the" → rendered as a crossed-out "teh" followed by "the".
 */
export function applyAutoMistakes(text: string, percent: number, style: StrikeStyle = 'wavy', salt = 77): string {
  if (!text || percent <= 0) return text;
  const rate = Math.min(0.25, Math.max(0.005, percent / 100));
  const tag = style !== 'single' ? `${style}:` : '';
  let counter = 0;
  return text
    .split('\n')
    .map((line, lineIndex) =>
      line.trim()
        ? line
            .split(/(\s+)/)
            .map((tok) => {
              if (/^\s+$/.test(tok)) return tok;
              counter++;
              if (!isEligible(tok)) return tok;
              const h = strHash(tok, salt + counter * 31 + lineIndex * 997);
              if ((h % 1e4) / 1e4 >= rate) return tok;
              const m = tok.match(/^([^\p{L}\p{N}]*)([\p{L}\p{M}\p{N}'-]+)([^\p{L}\p{N}]*)$/u);
              if (!m) return tok;
              const [, pre = '', core, post = ''] = m;
              if (graphemes(core).length < 2) return tok;
              const wrong = misspell(core, h);
              return !wrong || wrong === core ? tok : `${pre}~~${tag}${wrong}~~ ${core}${post}`;
            })
            .join('')
        : line,
    )
    .join('\n');
}
