// Light / dark appearance. Follows the system by default (HIG Dark Mode); the header switch overrides it,
// and switching back to whatever the system uses returns to "follow system". index.html applies the
// stored choice before first paint so there is no flash.
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'notehand.theme';
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set<() => void>();

const stored = (): Theme | null => {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null; } catch { return null; }
};
const systemTheme = (): Theme => (media?.matches ? 'dark' : 'light');
export const currentTheme = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  listeners.forEach((l) => l());
}

media?.addEventListener('change', () => { if (!stored()) apply(systemTheme()); });

/** Switch theme with a circular reveal from `origin` (the switch), when the browser and the user allow motion. */
export function setTheme(next: Theme, origin?: { x: number; y: number }) {
  try { if (next === systemTheme()) localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch { /* preference only */ }
  if (next === currentTheme()) return;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduce) { apply(next); return; }
  const root = document.documentElement;
  const x = origin?.x ?? window.innerWidth / 2, y = origin?.y ?? 0;
  root.style.setProperty('--vt-x', `${x}px`);
  root.style.setProperty('--vt-y', `${y}px`);
  root.style.setProperty('--vt-r', `${Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))}px`);
  root.classList.add('nh-vt');
  doc.startViewTransition(() => apply(next)).finished.finally(() => root.classList.remove('nh-vt'));
}

export function useTheme(): Theme {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, currentTheme, () => 'light');
}
