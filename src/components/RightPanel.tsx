// Right-hand panel: page actions, text input, corrections, selected-text tweaks, document style, realism.
import { ChevronRight, FileUp, ImagePlus, Layers, Loader2, RotateCcw, ScanLine, Sigma, Trash2, Wand2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { DEFAULT_FONT, wordCount } from '../data/catalog';
import { looksLikeLatex, latexToUnicode } from '../engine/latex';
import { DEFAULT_TEMPLATE, SAMPLE_TEXT, applyStyle, findNode, overrideKey, uploadPaper, useStore } from '../state/store';
import FontPicker, { fontName } from './FontPicker';
import InkPicker from './InkPicker';
import { MistakeSettings } from './Toolbar';
import { Popover, SectionLabel, Segmented, Slider, Toggle, cx, useFilePicker } from './ui';

const card = 'rounded-2xl border border-surface-200 bg-panel';

function Heading({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-surface-900">{title}</h3>
        {hint && <p className="mt-0.5 text-[12px] text-surface-500 leading-snug">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

function Row({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full h-11 flex items-center gap-3 px-3.5 text-left text-[13px] font-medium text-surface-800 hover:bg-surface-50 dark:hover:bg-surface-100 cursor-pointer first:rounded-t-2xl last:rounded-b-2xl active:scale-100">
      <span className="text-surface-500">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight size={15} className="text-surface-400" />
    </button>
  );
}

function SwitchRow({ title, hint, checked, onChange }: { title: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0"><div className="text-[13px] font-medium text-surface-900">{title}</div><div className="text-[12px] text-surface-500 leading-snug">{hint}</div></div>
      <Toggle label={title} checked={checked} onChange={onChange} />
    </div>
  );
}

export default function RightPanel() {
  const doc = useStore((s) => s.doc);
  const pages = useStore((s) => s.pages);
  const selectedIds = useStore((s) => s.selectedIds);
  const currentPage = useStore((s) => s.currentPage);
  const { update, ui } = useStore.getState();
  const [busy, setBusy] = useState<string | null>(null);
  const [fontPop, setFontPop] = useState<null | 'primary' | 'secondary'>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const t = doc.template;
  const setT = (patch: Partial<typeof t>, key: string) => update({ template: { ...doc.template, ...patch } }, `template:${key}`);

  const doc_ = useFilePicker('.pdf,.docx,.txt,.md', async (f) => {
    setBusy('Extracting text…');
    try {
      const text = await (await import('../lib/extractText')).extractText(f, (p) => setBusy(`Extracting text… ${Math.round(p * 100)}%`));
      if (!text.trim()) throw new Error('No selectable text found. Scanned PDFs need OCR first.');
      update({ text, overrides: {}, pageOffsets: {} }, 'import');
      toast.success(`Imported “${f.name}”`, { description: `${wordCount(text)} words` });
    } catch (e) {
      toast.error((e as Error).message || 'This file could not be read.');
    } finally {
      setBusy(null);
    }
  });
  const photo = useFilePicker('image/*', (f) => uploadPaper(f, null).catch((e: Error) => toast.error(e.message)));

  const selectedNode = doc.moveMode !== 'all' && selectedIds.length > 0 ? findNode(pages, selectedIds[0]) : undefined;
  const words = wordCount(doc.text);

  return (
    <div className="p-5 space-y-6">
      {doc_.input}
      {photo.input}
      {doc.paperUrl && (
        <div className={cx(card, 'divide-y divide-surface-200')}>
          <Row icon={<ScanLine size={16} />} label="Set writing area" onClick={() => ui({ calibratingPage: currentPage })} />
          <Row icon={<ImagePlus size={16} />} label="Upload page photo" onClick={photo.open} />
          <Row icon={<Layers size={16} />} label="Change paper" onClick={() => ui({ modal: 'background', backgroundTarget: currentPage })} />
        </div>
      )}

      <section className="space-y-2.5">
        <Heading
          title="Content"
          right={
            <div className="flex items-center gap-1.5">
              {looksLikeLatex(doc.text) && (
                <button type="button" onClick={() => { update({ text: latexToUnicode(doc.text) }, 'latex'); toast.success('Math formatted'); }} className="btn-secondary h-7 px-2.5 rounded-lg text-[12px] font-medium flex items-center gap-1.5 cursor-pointer">
                  <Sigma size={13} /> Format math
                </button>
              )}
              <button type="button" onClick={doc_.open} disabled={!!busy} className="btn-secondary h-7 px-2.5 rounded-lg text-[12px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-60" title="Import PDF, DOCX or TXT">
                <FileUp size={13} /> Import
              </button>
            </div>
          }
        />
        <div className="relative">
          <textarea
            value={doc.text}
            onChange={(e) => update({ text: e.target.value }, 'text')}
            placeholder={'Type or paste your text.\nLaTeX such as \\frac{1}{2} or \\sqrt{x} is supported.'}
            aria-label="Document text"
            className="w-full h-60 resize-y rounded-2xl border border-surface-200 bg-surface-50 p-4 text-[14px] leading-relaxed text-surface-900 placeholder:text-surface-500 outline-none transition-[border-color,box-shadow] focus:border-brand-400 focus:ring-4 focus:ring-brand-500/15 scroll-thin"
          />
          {busy && (
            <div className="absolute inset-0 rounded-2xl bg-panel/90 flex items-center justify-center gap-2 text-[13px] font-medium text-surface-700"><Loader2 size={15} className="animate-spin text-brand-600" /> {busy}</div>
          )}
        </div>
        <div className="flex items-center justify-between text-[12px] text-surface-500">
          <span className="tabular-nums">{words.toLocaleString()} words · {pages.length} {pages.length === 1 ? 'page' : 'pages'}</span>
          {!doc.text && <button type="button" className="font-medium text-brand-600 hover:underline cursor-pointer" onClick={() => update({ text: SAMPLE_TEXT }, 'text')}>Insert sample</button>}
        </div>
        <p className="text-[12px] text-surface-500 leading-relaxed"><code className="bg-surface-100 px-1 rounded">~~word~~</code> crosses out · <code className="bg-surface-100 px-1 rounded">==word==</code> highlights · <code className="bg-surface-100 px-1 rounded">x^2</code> for math</p>
      </section>

      {selectedNode && (
        <section className={cx(card, 'p-4 space-y-2.5 border-brand-200 bg-brand-50/40')}>
          <Heading title={`Selection · ${selectedIds.length}`} right={
            <button type="button" className="flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:underline cursor-pointer" onClick={() => {
              const overrides = { ...doc.overrides };
              for (const id of selectedIds) { const n = findNode(pages, id); if (n) delete overrides[overrideKey(n)]; }
              update({ overrides }, 'reset-block');
            }}><RotateCcw size={12} /> Reset</button>
          } />
          <p className="text-base text-surface-700 truncate font-hand">“{selectedNode.text}”</p>
          <p className="text-[12px] text-surface-500">Toolbar changes apply to the selection. Drag to move; use the handles to resize or rotate.</p>
          <button type="button" onClick={() => { applyStyle({ hidden: true }, 'delete'); useStore.getState().ui({ selectedIds: [] }); toast.success('Removed from the page', { description: 'Press Ctrl+Z to undo.' }); }} className="w-full h-9 flex items-center justify-center gap-2 rounded-[10px] border border-red-200 bg-red-50 text-red-700 text-[13px] font-medium hover:bg-red-100 cursor-pointer">
            <Trash2 size={14} /> Remove from page
          </button>
        </section>
      )}

      <section className={cx(card, 'p-4 space-y-3')}>
        <Heading title="Corrections" hint="Occasional misspelled words, crossed out and rewritten." right={<Toggle label="Corrections" checked={doc.strikeRate > 0} onChange={(v) => update({ strikeRate: v ? 1 : 0 }, 'rate')} />} />
        {doc.strikeRate > 0 && <MistakeSettings bare />}
      </section>

      <section className={cx(card, 'p-4 space-y-3.5')}>
        <Heading title="Document style" hint="Applies to all text, except lines you style individually." />
        <div className="space-y-1.5">
          <SectionLabel>Handwriting</SectionLabel>
          <button type="button" onClick={(e) => { setAnchor(e.currentTarget); setFontPop('primary'); }} className="btn-secondary w-full flex items-center justify-between rounded-xl px-3 py-2 cursor-pointer">
            <span className="text-xl text-surface-900 truncate" style={{ fontFamily: `"${t.fontFamily}"` }}>{fontName(t.fontFamily)}</span>
            <span className="text-[12px] font-medium text-brand-600 shrink-0">Change</span>
          </button>
        </div>
        <SwitchRow title="Blend two fonts" hint="Mixes letters from a second font for natural variation." checked={!!t.isCombinedFont} onChange={(v) => setT({ isCombinedFont: v, secondaryFontFamily: t.secondaryFontFamily || 'handwritten_cursive' }, 'combine')} />
        {t.isCombinedFont && (
          <button type="button" onClick={(e) => { setAnchor(e.currentTarget); setFontPop('secondary'); }} className="w-full flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50/50 px-3 py-2 cursor-pointer">
            <span className="text-xl text-surface-900 truncate" style={{ fontFamily: `"${t.secondaryFontFamily}"` }}>{fontName(t.secondaryFontFamily)}</span>
            <span className="text-[12px] font-medium text-brand-600 shrink-0">Second font</span>
          </button>
        )}
        <div className="space-y-1.5">
          <SectionLabel>Ink and pen</SectionLabel>
          <InkPicker compact fill={t.fill} penType={t.penType} onPick={(ink) => setT({ fill: ink.value, penType: ink.category }, 'ink')} />
        </div>
        <Slider label="Size" value={t.fontSize} min={8} max={200} step={1} digits={0} onChange={(v) => setT({ fontSize: v }, 'size')} onReset={() => setT({ fontSize: DEFAULT_TEMPLATE.fontSize }, 'size')} />
        <Slider label="Line spacing" value={t.lineHeight} min={0.5} max={3} step={0.05} digits={2} onChange={(v) => setT({ lineHeight: v }, 'lh')} onReset={() => setT({ lineHeight: DEFAULT_TEMPLATE.lineHeight }, 'lh')} />
        <Slider label="Letter spacing" value={t.letterSpacing} min={-5} max={20} step={0.5} onChange={(v) => setT({ letterSpacing: v }, 'ls')} onReset={() => setT({ letterSpacing: 0 }, 'ls')} />
        <Slider label="Word spacing" value={t.wordSpacing} min={0} max={20} step={0.5} onChange={(v) => setT({ wordSpacing: v }, 'ws')} onReset={() => setT({ wordSpacing: 0 }, 'ws')} />
        <Slider label="Ink opacity" value={t.opacity} min={0.1} max={1} step={0.05} digits={2} onChange={(v) => setT({ opacity: v }, 'op')} onReset={() => setT({ opacity: DEFAULT_TEMPLATE.opacity }, 'op')} />
        <Slider label="Tilt" value={t.rotation || 0} min={-15} max={15} step={0.5} unit="°" onChange={(v) => setT({ rotation: v }, 'rot')} onReset={() => setT({ rotation: 0 }, 'rot')} />
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>Alignment</SectionLabel>
          <Segmented size="sm" value={t.align} onChange={(a) => setT({ align: a }, 'align')} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} />
        </div>
        <button type="button" className="text-[12px] font-medium text-surface-500 hover:text-brand-600 cursor-pointer" onClick={() => update({ template: { ...DEFAULT_TEMPLATE, fontFamily: t.fontFamily || DEFAULT_FONT } }, 'template:reset')}>Restore default style</button>
      </section>

      <section className={cx(card, 'p-4 space-y-3.5')}>
        <Heading title="Realism" />
        <SwitchRow title="Photo finish" hint="Camera tilt, lighting and grain, unique to each page." checked={doc.realistic} onChange={(v) => update({ realistic: v }, 'realistic')} />
        <SwitchRow title="Letter variation" hint="Repeated letters are never drawn exactly alike." checked={doc.charVariance} onChange={(v) => update({ charVariance: v }, 'variance')} />
        <button type="button" onClick={() => update({ realistic: true, charVariance: true, strikeRate: Math.max(1, doc.strikeRate) }, 'max-real')} className="btn-secondary w-full h-9 flex items-center justify-center gap-2 rounded-[10px] text-[13px] font-medium cursor-pointer">
          <Wand2 size={14} /> Apply all realism effects
        </button>
      </section>

      <Popover anchor={anchor} open={fontPop !== null} onClose={() => setFontPop(null)} width={360}>
        <FontPicker
          value={(fontPop === 'secondary' ? t.secondaryFontFamily : t.fontFamily) || ''}
          onPick={(id) => { setT(fontPop === 'secondary' ? { secondaryFontFamily: id, isCombinedFont: true } : { fontFamily: id }, fontPop === 'secondary' ? 'font2' : 'font'); setFontPop(null); }}
        />
      </Popover>
    </div>
  );
}
