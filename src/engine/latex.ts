// LaTeX-ish math → unicode, ported from reference EditorPage.js 167-451.

export const SUPERSCRIPT: Record<string, string> = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', y: 'ʸ',
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ',
  o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', N: 'ᴺ', T: 'ᵀ',
};

export const SUBSCRIPT: Record<string, string> = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ',
  k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
};

/** Characters drawn smaller and raised (0.65×, −0.38·size). */
export const SUPER_CHARS = new Set(Object.values(SUPERSCRIPT).filter((c) => c !== 'ᴺ' && c !== 'ᵀ'));
/** Characters drawn smaller and lowered (0.65×, +0.18·size). */
export const SUB_CHARS = new Set(Object.values(SUBSCRIPT));

/** Symbols drawn with the math font stack at full size. */
export const MATH_SYMBOLS = new Set([
  '√', '∫', '∑', '∏', '±', '∓', '≤', '≥', '≠', '×', '÷', '≈', '≡', '∝', '∞', '°',
  'α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'π', 'ρ', 'σ', 'τ', 'υ', 'ϕ', 'χ', 'ψ', 'ω',
  'Γ', 'Δ', 'Θ', 'Λ', 'Ξ', 'Π', 'Σ', 'Φ', 'Ψ', 'Ω', '∂', '∇', '→', '←', '↔', '⇒', '⇐', '⇔',
  '∈', '∉', '⊂', '∩', '∪', '∅', '∀', '∃', '·',
]);

const LATEX_TEST =
  /\\(frac|sqrt|sum|int|prod|lim|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|phi|omega|Delta|Omega|pm|times|div|cdot|leq|geq|neq|approx|infty|degree|partial|nabla|to|rightarrow|in|subset|cap|cup)|[\^_{}√∫∑∏±≤≥≠×÷≈∞°αβγδεθλμπσφωΔΩ∂∇→]/;

export function looksLikeLatex(t: string): boolean {
  return !!t && LATEX_TEST.test(t);
}

const toSuper = (t: string) => t.split('').map((c) => SUPERSCRIPT[c] || c).join('');
const toSub = (t: string) => t.split('').map((c) => SUBSCRIPT[c] || c).join('');

const REPLACEMENTS: [RegExp, string][] = [
  [/\\pm\b/g, '±'], [/\\mp\b/g, '∓'], [/\\times\b/g, '×'], [/\\div\b/g, '÷'], [/\\cdot\b/g, '·'],
  [/\\leq?\b/g, '≤'], [/\\geq?\b/g, '≥'], [/\\neq\b/g, '≠'], [/\\approx\b/g, '≈'], [/\\equiv\b/g, '≡'],
  [/\\propto\b/g, '∝'], [/\\infty\b/g, '∞'], [/\\int\b/g, '∫'], [/\\sum\b/g, '∑'], [/\\prod\b/g, '∏'],
  [/\\partial\b/g, '∂'], [/\\nabla\b/g, '∇'], [/\\degree\b/g, '°'], [/\\circ\b/g, '°'],
  [/\\alpha\b/g, 'α'], [/\\beta\b/g, 'β'], [/\\gamma\b/g, 'γ'], [/\\delta\b/g, 'δ'], [/\\epsilon\b/g, 'ε'],
  [/\\varepsilon\b/g, 'ε'], [/\\zeta\b/g, 'ζ'], [/\\eta\b/g, 'η'], [/\\theta\b/g, 'θ'], [/\\vartheta\b/g, 'θ'],
  [/\\iota\b/g, 'ι'], [/\\kappa\b/g, 'κ'], [/\\lambda\b/g, 'λ'], [/\\mu\b/g, 'μ'], [/\\nu\b/g, 'ν'],
  [/\\xi\b/g, 'ξ'], [/\\pi\b/g, 'π'], [/\\rho\b/g, 'ρ'], [/\\sigma\b/g, 'σ'], [/\\tau\b/g, 'τ'],
  [/\\upsilon\b/g, 'υ'], [/\\phi\b/g, 'ϕ'], [/\\varphi\b/g, 'ϕ'], [/\\chi\b/g, 'χ'], [/\\psi\b/g, 'ψ'],
  [/\\omega\b/g, 'ω'], [/\\Gamma\b/g, 'Γ'], [/\\Delta\b/g, 'Δ'], [/\\Theta\b/g, 'Θ'], [/\\Lambda\b/g, 'Λ'],
  [/\\Xi\b/g, 'Ξ'], [/\\Pi\b/g, 'Π'], [/\\Sigma\b/g, 'Σ'], [/\\Phi\b/g, 'Φ'], [/\\Psi\b/g, 'Ψ'],
  [/\\Omega\b/g, 'Ω'], [/\\(to|rightarrow)\b/g, '→'], [/\\leftarrow\b/g, '←'], [/\\leftrightarrow\b/g, '↔'],
  [/\\Rightarrow\b/g, '⇒'], [/\\Leftarrow\b/g, '⇐'], [/\\Leftrightarrow\b/g, '⇔'], [/\\in\b/g, '∈'],
  [/\\notin\b/g, '∉'], [/\\subsets?\b/g, '⊂'], [/\\cap\b/g, '∩'], [/\\cup\b/g, '∪'], [/\\emptyset\b/g, '∅'],
  [/\\forall\b/g, '∀'], [/\\exists\b/g, '∃'], [/\\quad\b/g, '  '], [/\\qquad\b/g, '   '],
  [/\\;\b/g, ' '], [/\\,\b/g, ' '],
];

/** Convert LaTeX fragments to plain unicode text (reference `Da`). */
export function latexToUnicode(t: string): string {
  if (!t) return '';
  let u = t
    .replace(/\$\$(.*?)\$\$/gs, '$1')
    .replace(/\$(.*?)\$/g, '$1')
    .replace(/\\\[(.*?)\\\]/gs, '$1')
    .replace(/\\\((.*?)\\\)/g, '$1')
    .replace(/\\(text|mathrm|mathbf|mathit|mathsf|mb|operatorname)\{([^}]*)\}/g, '$2');
  let prev = '';
  while (prev !== u) {
    prev = u;
    u = u.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_m, a: string, b: string) => {
      const num = a.trim();
      const den = b.trim();
      const wrapNum = /[\s+\-*/=]/.test(num) && !/^\(.*\)$/.test(num);
      const wrapDen = /[\s+\-*/=]/.test(den) && !/^\(.*\)$/.test(den);
      return `${wrapNum ? `(${num})` : num}/${wrapDen ? `(${den})` : den}`;
    });
  }
  u = u
    .replace(/\\sqrt\[([^\]]+)\]\{([^}]+)\}/g, (_m, n: string, x: string) => `${toSuper(n.trim())}√(${x.trim()})`)
    .replace(/\\sqrt\{([^}]+)\}/g, (_m, x: string) => {
      const v = x.trim();
      return v.length === 1 ? `√${v}` : `√(${v})`;
    });
  for (const [re, rep] of REPLACEMENTS) u = u.replace(re, rep);
  return u
    .replace(/\^\{([^}]+)\}/g, (_m, x: string) => toSuper(x))
    .replace(/\^([0-9a-zA-Z+\-=()])/g, (_m, x: string) => SUPERSCRIPT[x] || `^${x}`)
    .replace(/_\{([^}]+)\}/g, (_m, x: string) => toSub(x))
    .replace(/_([0-9a-zA-Z+\-=()])/g, (_m, x: string) => SUBSCRIPT[x] || `_${x}`)
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}');
}
