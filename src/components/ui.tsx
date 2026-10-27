// Small shared UI primitives (Tailwind). Kept in one file on purpose.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, X } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** Keep an element mounted for `ms` after `open` turns false so it can play its exit animation. */
function usePresence(open: boolean, ms = 180) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { mounted: open || mounted, state: open ? 'open' : 'closed' };
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-semibold text-surface-500">{children}</span>
      {right}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-[26px] w-[44px] shrink-0 cursor-pointer items-center rounded-full p-[2px] transition-colors duration-200',
        checked ? 'bg-brand-600' : 'bg-surface-200 dark:bg-surface-300',
      )}
    >
      <span
        className={cx('inline-block h-[22px] w-[22px] rounded-full bg-snow shadow-[0_1px_3px_rgb(0_0_0/0.25),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-transform duration-[260ms]', checked ? 'translate-x-[18px]' : 'translate-x-0')}
        style={{ transitionTimingFunction: 'var(--ease-out-soft)' }}
      />
    </button>
  );
}

export function Slider({ label, value, min, max, step, unit = '', onChange, onReset, digits = 1 }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void; onReset?: () => void; digits?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-surface-600">{label}</span>
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-semibold text-surface-700 bg-surface-100 px-1.5 py-0.5 rounded-md tabular-nums">
            {value.toFixed(digits)}
            {unit}
          </span>
          {onReset && (
            <button type="button" onClick={onReset} className="p-1 hover:bg-surface-100 rounded-md text-surface-500 hover:text-surface-800" title={`Reset ${label}`} aria-label={`Reset ${label}`}>
              <RotateCcw size={11} />
            </button>
          )}
        </div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full h-1.5 cursor-pointer" />
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="flex items-center gap-0.5 bg-surface-100 rounded-[10px] p-[3px] shrink-0">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-[8px] text-xs font-semibold cursor-pointer',
            size === 'sm' ? 'h-7 px-3' : 'h-8 px-3.5 min-w-[56px]',
            value === o.value ? 'bg-panel dark:bg-surface-300 shadow-sm text-surface-900' : 'text-surface-500 hover:text-surface-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Popover anchored under an element, rendered in a portal, closed by outside click / Escape. */
export function Popover({ anchor, open, onClose, width = 320, children }: { anchor: HTMLElement | null; open: boolean; onClose: () => void; width?: number; children: ReactNode }) {
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const { mounted, state } = usePresence(open, 120);
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left, window.innerWidth - width - 16)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, anchor, width]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, onClose, anchor]);
  if (!mounted) return null;
  return createPortal(
    <div ref={ref} role="dialog" data-state={state} style={{ top: pos.top, left: pos.left, width }}
      className={cx('nh-pop fixed z-[300] bg-elevated rounded-2xl ring-1 ring-black/[0.06] dark:ring-white/[0.08] shadow-pop max-h-[min(70vh,640px)] overflow-y-auto scroll-thin', !open && 'pointer-events-none')}>
      {children}
    </div>,
    document.body,
  );
}

export function Modal({ open, onClose, children, dark = false, wide = false, label }: { open: boolean; onClose: () => void; children: ReactNode; dark?: boolean; wide?: boolean; label: string }) {
  const { mounted, state } = usePresence(open, 180);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // stopPropagation: an Escape that closes this modal must not also reach window-level handlers
    // (e.g. the calibration overlay would exit and discard edits).
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    // Move focus into the dialog (unless a field auto-focused) and give it back on close.
    const before = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => { if (sheet.current && !sheet.current.contains(document.activeElement)) sheet.current.focus({ preventScroll: true }); });
    return () => { document.removeEventListener('keydown', onKey); before?.focus?.({ preventScroll: true }); };
  }, [open, onClose]);
  if (!mounted) return null;
  return createPortal(
    <div data-state={state} className={cx('nh-backdrop fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/35 dark:bg-black/60 backdrop-blur-sm', !open && 'pointer-events-none')}
      onMouseDown={(e) => open && e.target === e.currentTarget && onClose()}>
      <div ref={sheet} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} data-state={state}
        className={cx('nh-sheet relative w-full rounded-[22px] shadow-sheet max-h-[92vh] overflow-y-auto scroll-thin outline-none', wide ? 'max-w-3xl' : 'max-w-md',
          dark ? 'bg-[#16161a] text-white ring-1 ring-white/10' : 'bg-elevated ring-1 ring-black/[0.05] dark:ring-white/[0.08]')}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function CloseButton({ onClick, dark = false }: { onClick: () => void; dark?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label="Close" className={cx('w-8 h-8 shrink-0 flex items-center justify-center rounded-full cursor-pointer', dark ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-surface-100 hover:bg-surface-200 text-surface-600 hover:text-surface-900')}>
      <X size={16} strokeWidth={2.25} />
    </button>
  );
}

export function useFilePicker(accept: string, onFile: (f: File) => void) {
  const ref = useRef<HTMLInputElement | null>(null);
  const input = <input ref={ref} type="file" accept={accept} className="hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />;
  return { open: () => ref.current?.click(), input };
}
