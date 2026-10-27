// "Ink & Pen Style" picker: pen tabs (ball point / gel / fountain) + color swatches.
import { Check } from 'lucide-react';
import { useState } from 'react';
import { PENS, inksForPen, resolvePen, type Ink, type PenType } from '../data/catalog';
import { cx } from './ui';

export default function InkPicker({ fill, penType, onPick, compact = false }: { fill: string; penType?: PenType; onPick: (ink: Ink) => void; compact?: boolean }) {
  const current = resolvePen(fill, penType);
  const [tab, setTab] = useState<PenType>(current);
  const pen = PENS.find((p) => p.id === tab) || PENS[0];
  const active = inksForPen(current).find((i) => i.value.toLowerCase() === fill.toLowerCase());
  return (
    <div className={cx('space-y-2.5', !compact && 'p-4')}>
      {!compact && (
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-surface-800">Ink & pen style</div>
            <div className="text-[11px] text-surface-500">Colour and how the pen lays down ink</div>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200 whitespace-nowrap">{PENS.find((p) => p.id === current)?.name}</span>
        </div>
      )}
      <div className="grid grid-cols-3 gap-1 bg-surface-100 p-1 rounded-xl" role="tablist">
        {PENS.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={tab === p.id} onClick={() => setTab(p.id)}
            className={cx('py-1.5 px-1 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer', tab === p.id ? 'bg-panel dark:bg-surface-300 text-surface-900 shadow-sm' : 'text-surface-600 hover:text-surface-900')}>
            <span aria-hidden>{p.icon}</span>
            <span className="truncate">{p.label}</span>
          </button>
        ))}
      </div>
      <div className="text-[10.5px] text-surface-500 bg-surface-50 p-2 rounded-lg border border-surface-200/70 leading-relaxed">
        <div className="flex items-center justify-between mb-0.5">
          <span className="font-bold text-surface-700">{pen.icon} {pen.name}</span>
          <span className="text-[9px] font-semibold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded">{pen.tag}</span>
        </div>
        <p className="text-[10px]">{pen.description}</p>
      </div>
      <div className="grid grid-cols-6 gap-2 bg-surface-50 border border-surface-200 p-2.5 rounded-xl">
        {inksForPen(tab).map((ink) => {
          const sel = fill.toLowerCase() === ink.value.toLowerCase() && current === ink.category;
          return (
            <div key={`${ink.category}-${ink.value}`} className="flex flex-col items-center gap-1">
              <button type="button" onClick={() => onPick(ink)} title={`${ink.name} — ${ink.description}`} aria-label={ink.name}
                className={cx('swatch aspect-square w-full rounded-full transition flex items-center justify-center cursor-pointer', sel ? 'scale-110 ring-2 ring-brand-500 ring-offset-2 ring-offset-panel' : 'hover:scale-105')}
                style={{ backgroundColor: ink.value }}>
                {sel && <Check size={12} className="text-white drop-shadow" />}
              </button>
              {!compact && <span className="text-[9px] text-surface-500 truncate max-w-full">{ink.name.split(' ')[0]}</span>}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-lg bg-surface-100/70 border border-surface-200/60">
        <span className="flex items-center gap-2 truncate">
          <span className="swatch w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: fill }} />
          <span className="font-semibold text-surface-700 truncate">{active?.name || 'Custom color'}</span>
        </span>
        <span className="text-[10px] font-mono text-surface-500 shrink-0">{PENS.find((p) => p.id === current)?.label}</span>
      </div>
    </div>
  );
}
