// Formatting toolbar shown once a page exists. Edits the selected block(s), or the global layout when
// nothing is selected / in PAGE mode (same rule as the reference app).
import { AlignCenter, AlignLeft, AlignRight, ChevronDown, Highlighter, Layers, Minus, PenLine, Plus, SlidersHorizontal, Strikethrough } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { PENS, resolvePen } from '../data/catalog';
import { HIGHLIGHT_COLORS, STRIKE_STYLES } from '../engine/markup';
import { applyStyle, useEffectiveStyle, useStore } from '../state/store';
import FontPicker, { fontName } from './FontPicker';
import InkPicker from './InkPicker';
import { Popover, Segmented, Slider, cx } from './ui';

type Pop = null | 'font' | 'font2' | 'ink' | 'strike' | 'mistake' | 'highlight' | 'spacing';

export const MISTAKE_PRESETS = [0, 1, 2, 3, 5];

const ctl = 'h-9 rounded-[10px] border shrink-0 cursor-pointer';
const idle = 'bg-panel border-surface-200 text-surface-700 hover:bg-surface-50 hover:border-surface-300 dark:hover:bg-surface-100';
const on = 'bg-brand-50 border-brand-200 text-brand-700';
const Divider = () => <span className="w-px h-6 bg-surface-200 shrink-0" />;

function Btn({ active, onClick, children, title, className }: { active?: boolean; onClick?: (e: React.MouseEvent<HTMLElement>) => void; children: ReactNode; title: string; className?: string }) {
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={active} onClick={onClick}
      className={cx(ctl, 'flex items-center gap-1.5 px-3 text-[13px] font-medium', active ? on : idle, className)}>
      {children}
    </button>
  );
}

function PopTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="px-1 pb-2">
      <div className="text-[13px] font-semibold text-surface-900">{children}</div>
      {hint && <div className="text-[11px] text-surface-500">{hint}</div>}
    </div>
  );
}

export default function Toolbar() {
  const doc = useStore((s) => s.doc);
  const selected = useStore((s) => s.selectedIds.length);
  const { update } = useStore.getState();
  const { style, target } = useEffectiveStyle();
  const [pop, setPop] = useState<Pop>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = (p: Pop) => (e: React.MouseEvent<HTMLElement>) => { setAnchor(e.currentTarget); setPop((cur) => (cur === p ? null : p)); };
  const close = () => setPop(null);
  const pen = resolvePen(style.fill, style.penType);
  const align = style.align || 'left';

  return (
    <div className="hidden sm:block shrink-0 bg-panel/85 backdrop-blur-xl border-b border-surface-200 relative z-[100]">
      <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto scroll-none w-full [mask-image:linear-gradient(90deg,#000_calc(100%-32px),transparent)]">
        <Segmented
          value={doc.moveMode}
          onChange={(m) => { update({ moveMode: m }, 'mode'); useStore.getState().ui({ selectedIds: [] }); }}
          options={[
            { value: 'single', label: 'Line', title: 'Select and move one line at a time' },
            { value: 'words', label: 'Words', title: 'Select and move individual words' },
            { value: 'all', label: 'Page', title: 'Move all text together' },
          ]}
        />
        {target === 'selection' && <span className="h-6 px-2 rounded-full bg-brand-50 text-brand-700 text-[11px] font-semibold flex items-center shrink-0">{selected} selected</span>}
        <Divider />
        <button type="button" onClick={open('font')} className={cx(ctl, idle, 'flex items-center gap-2 pl-1.5 pr-2.5')} title="Handwriting font" aria-label={`Handwriting font: ${fontName(style.fontFamily)}`}>
          <span className="w-6 h-6 rounded-md bg-surface-100 text-[11px] font-semibold text-surface-600 flex items-center justify-center">Aa</span>
          <span className="text-[17px] leading-none text-surface-900 truncate max-w-[140px]" style={{ fontFamily: `"${style.fontFamily}"` }}>{fontName(style.fontFamily)}</span>
          <ChevronDown size={14} className="text-surface-500" />
        </button>
        <Btn active={!!style.isCombinedFont} title="Blend two fonts for natural variation" onClick={() => applyStyle({ isCombinedFont: !style.isCombinedFont, secondaryFontFamily: style.secondaryFontFamily || 'handwritten_cursive' }, 'combine')}>
          <Layers size={15} /> <span className="hidden 2xl:inline">Blend</span>
        </Btn>
        {style.isCombinedFont && (
          <button type="button" onClick={open('font2')} className={cx(ctl, on, 'flex items-center gap-2 pl-1.5 pr-2.5')} title="Second font" aria-label={`Second font: ${fontName(style.secondaryFontFamily)}`}>
            <span className="w-6 h-6 rounded-md bg-brand-100 text-[10px] font-semibold flex items-center justify-center">Aa₂</span>
            <span className="text-[17px] leading-none text-surface-900 truncate max-w-[140px]" style={{ fontFamily: `"${style.secondaryFontFamily}"` }}>{fontName(style.secondaryFontFamily)}</span>
            <ChevronDown size={14} className="text-surface-500" />
          </button>
        )}
        <div className={cx(ctl, 'bg-panel border-surface-200 flex items-center cursor-default')}>
          <button type="button" className="h-full px-2.5 text-surface-600 hover:text-surface-900 cursor-pointer" aria-label="Decrease text size" title="Smaller" onClick={() => applyStyle({ fontSize: Math.max(8, style.fontSize - 2) }, 'size')}><Minus size={14} /></button>
          <span className="w-9 text-center text-[13px] font-semibold text-surface-900 tabular-nums" aria-label="Text size">{Math.round(style.fontSize)}</span>
          <button type="button" className="h-full px-2.5 text-surface-600 hover:text-surface-900 cursor-pointer" aria-label="Increase text size" title="Larger" onClick={() => applyStyle({ fontSize: Math.min(200, style.fontSize + 2) }, 'size')}><Plus size={14} /></button>
        </div>
        <div className="h-9 flex items-center gap-0.5 rounded-[10px] bg-surface-100 p-[3px] shrink-0">
          {(['left', 'center', 'right'] as const).map((a) => {
            const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight;
            return (
              <button key={a} type="button" title={`Align ${a}`} aria-label={`Align ${a}`} aria-pressed={align === a} onClick={() => applyStyle({ align: a }, 'align')}
                className={cx('h-full w-9 flex items-center justify-center rounded-[8px] cursor-pointer', align === a ? 'bg-panel dark:bg-surface-300 shadow-sm text-surface-900' : 'text-surface-500 hover:text-surface-800')}>
                <Icon size={15} />
              </button>
            );
          })}
        </div>
        <Divider />
        <button type="button" onClick={open('ink')} className={cx(ctl, idle, 'flex items-center gap-2 px-2.5')} title="Ink and pen" aria-label="Ink and pen">
          <span className="swatch w-5 h-5 rounded-full" style={{ backgroundColor: style.fill }} />
          <span className="text-[13px] font-medium text-surface-800">{PENS.find((p) => p.id === pen)?.label}</span>
          <ChevronDown size={14} className="text-surface-500" />
        </button>
        <div className="flex items-center shrink-0">
          <Btn active={!!style.isStrikethrough} title="Strike through" className="rounded-r-none" onClick={() => applyStyle({ isStrikethrough: !style.isStrikethrough }, 'strike')}>
            <Strikethrough size={15} />
          </Btn>
          <Btn title="Cross-out style" className="rounded-l-none border-l-0 px-2" onClick={open('strike')}>
            <ChevronDown size={14} />
          </Btn>
        </div>
        <div className="flex items-center shrink-0">
          <Btn active={!!style.isHighlighted} title="Highlight" className="rounded-r-none" onClick={() => applyStyle({ isHighlighted: !style.isHighlighted }, 'hl')}>
            <Highlighter size={15} />
          </Btn>
          <Btn title="Highlighter colour" className="rounded-l-none border-l-0 px-2" onClick={open('highlight')}>
            <span className="swatch w-3 h-3 rounded-full" style={{ backgroundColor: HIGHLIGHT_COLORS.find((c) => c.id === (style.highlightColor || 'yellow'))?.hex }} />
            <ChevronDown size={14} />
          </Btn>
        </div>
        <Divider />
        <Btn title="Corrections: occasional crossed-out words" active={doc.strikeRate > 0} onClick={open('mistake')}>
          <PenLine size={15} /> <span className="hidden xl:inline">Corrections</span>
          <span className="tabular-nums text-[12px] font-semibold opacity-80">{doc.strikeRate > 0 ? `${doc.strikeRate}%` : 'Off'}</span>
          <ChevronDown size={13} className="opacity-60" />
        </Btn>
        <Btn title="Spacing, tilt and opacity" onClick={open('spacing')}>
          <SlidersHorizontal size={15} /> <span className="hidden xl:inline">Spacing</span>
        </Btn>
      </div>

      <Popover anchor={anchor} open={pop === 'font'} onClose={close} width={360}>
        <FontPicker value={style.fontFamily} onPick={(id) => { applyStyle({ fontFamily: id }, 'font'); close(); }} />
      </Popover>
      <Popover anchor={anchor} open={pop === 'font2'} onClose={close} width={360}>
        <FontPicker value={style.secondaryFontFamily || ''} onPick={(id) => { applyStyle({ secondaryFontFamily: id, isCombinedFont: true }, 'font2'); close(); }} />
      </Popover>
      <Popover anchor={anchor} open={pop === 'ink'} onClose={close} width={380}>
        <InkPicker fill={style.fill} penType={style.penType} onPick={(ink) => { applyStyle({ fill: ink.value, penType: ink.category }, 'ink'); close(); }} />
      </Popover>
      <Popover anchor={anchor} open={pop === 'strike'} onClose={close} width={250}>
        <div className="p-3 space-y-0.5">
          <PopTitle>Cross-out style</PopTitle>
          {STRIKE_STYLES.map((s) => (
            <button key={s.id} type="button" onClick={() => { applyStyle({ strikeStyle: s.id, isStrikethrough: true }, 'strikeStyle'); close(); }}
              className={cx('w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left cursor-pointer', (style.strikeStyle || 'wavy') === s.id ? 'bg-brand-50 text-brand-700' : 'hover:bg-surface-100 text-surface-800')}>
              <span className="w-6 text-center text-lg">{s.icon}</span>
              <span><span className="block text-[13px] font-medium">{s.label}</span><span className="block text-[11px] text-surface-500">{s.description}</span></span>
            </button>
          ))}
        </div>
      </Popover>
      <Popover anchor={anchor} open={pop === 'highlight'} onClose={close} width={260}>
        <div className="p-3">
          <PopTitle>Highlighter colour</PopTitle>
          <div className="grid grid-cols-3 gap-2">
            {HIGHLIGHT_COLORS.map((c) => (
              <button key={c.id} type="button" onClick={() => { applyStyle({ highlightColor: c.id, isHighlighted: true }, 'hlColor'); close(); }}
                className={cx('flex flex-col items-center gap-1.5 p-2 rounded-xl border cursor-pointer', (style.highlightColor || 'yellow') === c.id ? 'border-brand-400 bg-brand-50' : 'border-surface-200 hover:bg-surface-100')}>
                <span className="w-8 h-4 rounded" style={{ backgroundColor: c.hex }} />
                <span className="text-[11px] font-medium text-surface-700">{c.name.split(' ')[1] || c.name}</span>
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] text-surface-500 leading-relaxed">In text: <code className="bg-surface-100 px-1 rounded">==word==</code> or <code className="bg-surface-100 px-1 rounded">==green:two words==</code></p>
        </div>
      </Popover>
      <Popover anchor={anchor} open={pop === 'mistake'} onClose={close} width={320}>
        <MistakeSettings />
      </Popover>
      <Popover anchor={anchor} open={pop === 'spacing'} onClose={close} width={300}>
        <div className="p-4 space-y-1">
          <Slider label="Line spacing" value={style.lineHeight || 1.2} min={0.5} max={3} step={0.05} digits={2} onChange={(v) => applyStyle({ lineHeight: v }, 'lh')} />
          <Slider label="Letter spacing" value={style.letterSpacing || 0} min={-5} max={20} step={0.5} onChange={(v) => applyStyle({ letterSpacing: v }, 'ls')} />
          <Slider label="Word spacing" value={style.wordSpacing || 0} min={0} max={20} step={0.5} onChange={(v) => applyStyle({ wordSpacing: v }, 'ws')} />
          <Slider label="Tilt" value={style.rotation || 0} min={-15} max={15} step={0.5} unit="°" onChange={(v) => applyStyle({ rotation: v }, 'rot')} />
          <Slider label="Ink opacity" value={style.opacity || 0.8} min={0.1} max={1} step={0.05} digits={2} onChange={(v) => applyStyle({ opacity: v }, 'op')} />
        </div>
      </Popover>
    </div>
  );
}

/** Corrections ("auto mistake") controls, shared by the toolbar popover and the side panel. */
export function MistakeSettings({ bare = false }: { bare?: boolean }) {
  const doc = useStore((s) => s.doc);
  const { update } = useStore.getState();
  const set = (v: number) => update({ strikeRate: Math.max(0, Math.min(10, v)) }, 'rate');
  return (
    <div className={cx('space-y-3', !bare && 'p-4')}>
      {!bare && <PopTitle hint="Occasional misspelled words, crossed out and rewritten">Corrections</PopTitle>}
      <div className="flex items-center justify-between text-xs font-medium text-surface-600"><span>Frequency</span><span className="tabular-nums font-semibold text-surface-900">{doc.strikeRate > 0 ? `${doc.strikeRate}% of words` : 'Off'}</span></div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Fewer corrections" className="btn-secondary w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer" onClick={() => set(doc.strikeRate - 1)}><Minus size={14} /></button>
        <input type="range" min={0} max={10} step={1} value={doc.strikeRate} onChange={(e) => set(+e.target.value)} className="flex-1" aria-label="Correction frequency" />
        <button type="button" aria-label="More corrections" className="btn-secondary w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer" onClick={() => set(doc.strikeRate + 1)}><Plus size={14} /></button>
      </div>
      <div className="grid grid-cols-5 gap-1 bg-surface-100 p-[3px] rounded-[10px]">
        {MISTAKE_PRESETS.map((p) => (
          <button key={p} type="button" onClick={() => set(p)} aria-pressed={doc.strikeRate === p}
            className={cx('h-10 rounded-[8px] text-[12px] font-semibold leading-tight cursor-pointer', doc.strikeRate === p ? 'bg-panel dark:bg-surface-300 shadow-sm text-surface-900' : 'text-surface-500 hover:text-surface-800')}>
            {p === 0 ? 'Off' : `${p}%`}
            {p === 1 && <span className="block text-[10px] font-medium opacity-70">Light</span>}
            {p === 5 && <span className="block text-[10px] font-medium opacity-70">Heavy</span>}
          </button>
        ))}
      </div>
      <div className="text-xs font-semibold text-surface-500 pt-1">Cross-out style</div>
      <div className="grid grid-cols-2 gap-1.5">
        {STRIKE_STYLES.map((s) => (
          <button key={s.id} type="button" onClick={() => update({ autoStrikeStyle: s.id }, 'autoStyle')} aria-pressed={doc.autoStrikeStyle === s.id}
            className={cx('h-9 flex items-center gap-2 px-3 rounded-[10px] border text-[12px] font-medium cursor-pointer', doc.autoStrikeStyle === s.id ? on : idle)}>
            <span className="w-4 text-center">{s.icon}</span> {s.short}
          </button>
        ))}
      </div>
    </div>
  );
}
