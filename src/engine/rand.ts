// Seeded pseudo-random helpers. Rendering must stay deterministic (ARCHITECTURE invariant 2):
// never use Math.random() in engine code.

/** sin-hash in [0,1). Used for strikes, highlights and page effects (reference `be`). */
export function hash01(t: number): number {
  const u = Math.sin(t) * 1e4;
  return u - Math.floor(u);
}

/** mulberry32-style step in [0,1). Used for glyph jitter (reference `Je`). */
export function rng(t: number): number {
  let u = (t + 1831565813) | 0;
  u = Math.imul(u ^ (u >>> 15), u | 1);
  u ^= u + Math.imul(u ^ (u >>> 7), u | 61);
  return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
}

/** Sum of char codes: the seed of a text node (reference uses node ids like `page-0-line-3`). */
export function idSeed(id: string): number {
  let s = 0;
  for (let i = 0; i < id.length; i++) s += id.charCodeAt(i);
  return s;
}

/** Java-style string hash, used to pick auto-mistake words (reference `Ml`). */
export function strHash(s: string, seed = 0): number {
  let h = seed;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
