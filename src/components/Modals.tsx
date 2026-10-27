// Export (options → file name → progress), background chooser, welcome card and the user guide.
import { BookOpen, Check, Download, FileImage, FileText, ImagePlus, Laptop, Loader2, ScanLine, Sliders, Sparkles, Type, Upload, Wand2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { APP } from '../config';
import { PAPERS } from '../data/catalog';
import { PAPER_STYLES, paperDataUrl } from '../data/generatedPapers';
import { exportDocument } from '../lib/exportDoc';
import { RESOLUTION_WIDTH, pageBackground, selectPaper, uploadPaper, useGeneratedPaper, useStore, type Resolution } from '../state/store';
import { CloseButton, Modal, Toggle, cx, useFilePicker } from './ui';

const RES_HINT: Record<Resolution, string> = { low: 'Smallest files, quick to share', normal: 'Balanced quality and size', high: 'Sharpest print quality, larger files' };
const MESSAGES = ['Laying out pages…', 'Drawing ink strokes…', 'Applying pen pressure…', 'Aligning to the writing area…', 'Compiling your document…'];

export function ExportModal() {
  const modal = useStore((s) => s.modal);
  const doc = useStore((s) => s.doc);
  const pages = useStore((s) => s.pages.length);
  const { update, ui } = useStore.getState();
  const go = (format: 'pdf' | 'image') => ui({ pendingExport: format, modal: 'filename' });
  return (
    <Modal open={modal === 'export'} onClose={() => ui({ modal: null })} label="Export options">
      <div className="p-6">
        <div className="flex items-center justify-between">
          <div><h3 className="text-[19px] font-semibold text-surface-900">Export</h3><p className="text-[13px] text-surface-500">{pages} {pages === 1 ? 'page' : 'pages'} · rendered exactly as shown</p></div>
          <CloseButton onClick={() => ui({ modal: null })} />
        </div>
        <div className="mt-6 text-xs font-semibold text-surface-500">Quality</div>
        <div className="mt-2 grid grid-cols-3 gap-0.5 bg-surface-100 p-[3px] rounded-[10px]">
          {(['low', 'normal', 'high'] as Resolution[]).map((r) => (
            <button key={r} type="button" onClick={() => update({ resolution: r }, 'res')} className={cx('h-8 rounded-[8px] text-[13px] font-semibold capitalize cursor-pointer', doc.resolution === r ? 'bg-panel dark:bg-surface-300 text-surface-900 shadow-sm' : 'text-surface-500 hover:text-surface-800')}>
              {r}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-surface-500 tabular-nums">{RES_HINT[doc.resolution]} · {RESOLUTION_WIDTH[doc.resolution]}px wide</p>
        <div className="mt-5 pt-5 border-t border-surface-200 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div><div className="text-[13px] font-medium text-surface-900">Photo finish</div><div className="text-[12px] text-surface-500">Camera tilt, lighting and grain, unique to each page</div></div>
            <Toggle label="Photo finish" checked={doc.realistic} onChange={(v) => update({ realistic: v }, 'realistic')} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div><div className="text-[13px] font-medium text-surface-900">Letter variation</div><div className="text-[12px] text-surface-500">Repeated letters are never drawn exactly alike</div></div>
            <Toggle label="Letter variation" checked={doc.charVariance} onChange={(v) => update({ charVariance: v }, 'variance')} />
          </div>
        </div>
      </div>
      <div className="border-t border-surface-200 p-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => go('image')} className="btn-secondary flex flex-col items-start gap-3 p-4 rounded-2xl text-left cursor-pointer">
          <span className="w-10 h-10 rounded-xl bg-surface-100 text-surface-700 flex items-center justify-center"><FileImage size={19} /></span>
          <span><span className="block text-[14px] font-semibold text-surface-900">JPEG images</span><span className="block text-[12px] text-surface-500">{pages > 1 ? `${pages} files, one per page` : 'One image file'}</span></span>
        </button>
        <button type="button" onClick={() => go('pdf')} className="btn-primary flex flex-col items-start gap-3 p-4 rounded-2xl text-left cursor-pointer">
          <span className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center"><FileText size={19} /></span>
          <span><span className="block text-[14px] font-semibold">PDF document</span><span className="block text-[12px] text-white/75">{pages} {pages === 1 ? 'page' : 'pages'} in one file</span></span>
        </button>
      </div>
    </Modal>
  );
}

export function FileNameModal() {
  const modal = useStore((s) => s.modal);
  const format = useStore((s) => s.pendingExport);
  const { ui } = useStore.getState();
  const [name, setName] = useState<string>(APP.defaultFileName);
  const cancelled = useRef(false);

  const run = async () => {
    const { doc, pages } = useStore.getState();
    if (!format) return;
    cancelled.current = false;
    ui({ modal: null, exportProgress: { page: 0, total: pages.length, message: MESSAGES[0] } });
    try {
      const res = await exportDocument({
        doc, pages, format, resolution: doc.resolution, fileName: name,
        onProgress: (p) => ui({ exportProgress: { page: p.page, total: p.total, message: MESSAGES[Math.min(MESSAGES.length - 1, Math.floor((p.page / Math.max(1, p.total)) * MESSAGES.length))] } }),
        isCancelled: () => cancelled.current || !useStore.getState().exportProgress,
      });
      if (res) toast.success(format === 'pdf' ? 'PDF downloaded' : `${res.files} image${res.files > 1 ? 's' : ''} downloaded`);
      else toast.info('Export cancelled');
    } catch (e) {
      console.error(e);
      toast.error('Could not export. If you used a page photo from another site, upload it from your device instead.');
    } finally {
      ui({ exportProgress: null, pendingExport: null });
    }
  };

  return (
    <Modal open={modal === 'filename'} onClose={() => ui({ modal: 'export' })} label="File name">
      <form className="p-6 space-y-4" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <div className="flex items-center justify-between">
          <h3 className="text-[17px] font-semibold text-surface-900">Export {format === 'pdf' ? 'PDF' : 'JPEG'}</h3>
          <CloseButton onClick={() => ui({ modal: 'export' })} />
        </div>
        <p className="text-[13px] text-surface-500">File name</p>
        <label className="flex items-center rounded-xl border border-surface-200 bg-surface-50 transition-[border-color,box-shadow] focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/15">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="flex-1 h-11 px-3 outline-none bg-transparent text-[14px] text-surface-900" aria-label="File name" />
          <span className="px-3 text-[13px] font-medium text-surface-500">.{format === 'pdf' ? 'pdf' : 'jpg'}</span>
        </label>
        <button type="submit" className="w-full h-11 rounded-xl btn-primary text-[14px] font-semibold flex items-center justify-center gap-2 cursor-pointer"><Download size={16} /> Export</button>
      </form>
    </Modal>
  );
}

export function ExportProgress() {
  const p = useStore((s) => s.exportProgress);
  const { ui } = useStore.getState();
  if (!p) return null;
  const pct = Math.round((p.page / Math.max(1, p.total)) * 100);
  return (
    <div className="fixed inset-0 z-[400] bg-panel/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="nh-sheet w-full max-w-sm rounded-[22px] bg-elevated ring-1 ring-black/[0.05] dark:ring-white/[0.08] shadow-sheet p-6 text-center" data-state="open">
        <Loader2 size={32} className="mx-auto animate-spin text-brand-600" />
        <div className="mt-4 text-[15px] font-semibold text-surface-900 tabular-nums">Exporting page {Math.min(p.page + 1, p.total)} of {p.total}</div>
        <div className="mt-1 text-xs text-surface-500">{p.message}</div>
        <div className="mt-4 h-1.5 rounded-full bg-surface-100 overflow-hidden"><div className="h-full bg-brand-600 rounded-full transition-[width] duration-500" style={{ width: `${Math.max(4, pct)}%` }} /></div>
        <button type="button" onClick={() => ui({ exportProgress: null })} className="mt-5 h-8 px-4 rounded-lg text-[13px] font-medium text-surface-600 hover:bg-surface-100 hover:text-surface-900 cursor-pointer">Cancel</button>
      </div>
    </div>
  );
}

export function BackgroundModal() {
  const modal = useStore((s) => s.modal);
  const target = useStore((s) => s.backgroundTarget);
  const doc = useStore((s) => s.doc);
  const pages = useStore((s) => s.pages.length);
  const { ui } = useStore.getState();
  const [scope, setScope] = useState<'page' | 'all'>('page');
  const page = target ?? 0;
  const forPage = target !== null && scope === 'page' && pages > 1 ? page : null;
  const picker = useFilePicker('image/*', (f) => uploadPaper(f, forPage).catch((e: Error) => toast.error(e.message)));
  const current = pageBackground(doc, page);
  const currentName = PAPERS.find((p) => p.url === current)?.name || doc.customPapers.find((p) => p.url === current)?.name || (current ? 'Custom page' : 'None');
  const close = () => ui({ modal: null });
  const pick = (url: string, size?: { width: number; height: number }) => { selectPaper(url, forPage, size); toast.success(forPage === null ? 'Background applied to all pages' : `Background applied to page ${page + 1}`); };

  return (
    <Modal open={modal === 'background'} onClose={close} dark wide label="Choose background">
      {picker.input}
      <div className="p-6 space-y-5">
        <div className="flex items-start justify-between gap-3 pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-brand-500/20 border border-brand-400/30 flex items-center justify-center text-brand-300"><ImagePlus size={18} /></span>
            <div>
              <h3 className="text-lg font-bold">Choose background{target !== null && pages > 1 ? ` (Page ${page + 1})` : ''}</h3>
              <p className="text-[13px] text-white/60">Choose a paper, or use a photo of your own notebook.</p>
            </div>
          </div>
          <CloseButton dark onClick={close} />
        </div>
        {target !== null && pages > 1 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-white/60 font-semibold">Apply to:</span>
            {(['page', 'all'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setScope(s)} className={cx('h-8 px-3 rounded-lg font-bold cursor-pointer', scope === s ? 'bg-brand-600 text-white' : 'bg-panel/10 text-white/70 hover:bg-panel/20')}>{s === 'page' ? `Page ${page + 1}` : 'All pages'}</button>
            ))}
          </div>
        )}
        <div>
          <div className="flex justify-between text-[11px] font-bold text-white/50 mb-2"><span>Upload custom page</span><span>Target: {forPage === null ? 'All pages' : `Page ${page + 1}`}</span></div>
          <button type="button" onClick={picker.open} className="w-full rounded-2xl border-2 border-dashed border-brand-400/40 bg-panel/5 hover:bg-panel/10 py-8 flex flex-col items-center gap-2 cursor-pointer">
            <span className="w-12 h-12 rounded-xl bg-brand-500/20 border border-brand-400/30 flex items-center justify-center"><Upload size={20} /></span>
            <span className="font-semibold">Upload a notebook photo</span>
            <span className="text-xs text-white/60">JPG, PNG, WEBP · camera or gallery</span>
          </button>
        </div>
        <div>
          <div className="flex justify-between text-[11px] font-bold text-white/50 mb-2"><span>Notebook photos</span><span>Click to apply</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PAPERS.map((p) => (
              <PaperCard key={p.id} name={p.name} tag={p.tag} desc={p.description} url={p.url} active={current === p.url} onPick={() => pick(p.url, { width: p.width, height: p.height })} onAdjust={() => { pick(p.url, { width: p.width, height: p.height }); ui({ modal: null, calibratingPage: forPage ?? 0 }); }} />
            ))}
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[11px] font-bold text-white/50 mb-2"><span>Paper styles</span><span>Generated</span></div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {PAPER_STYLES.map((p) => {
              const active = current === paperDataUrl(p.id, 1500);
              return (
                <button key={p.id} type="button" title={p.description} onClick={() => { useGeneratedPaper(p.id, forPage); toast.success(`${p.name} applied`); }} className={cx('rounded-xl overflow-hidden border-2 text-left cursor-pointer', active ? 'border-brand-400' : 'border-white/10 hover:border-white/30')}>
                  <img src={paperDataUrl(p.id, 240)} alt={p.name} className="thumb w-full h-28 object-cover object-top" />
                  <span className="block px-2 py-1.5 text-[11px] font-bold">{p.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        {doc.customPapers.length > 0 && (
          <div>
            <div className="text-[11px] font-bold text-white/50 mb-2">Your uploaded pages</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {doc.customPapers.map((p) => (
                <button key={p.id} type="button" onClick={() => pick(p.url, { width: p.width, height: p.height })} className={cx('relative h-32 rounded-xl overflow-hidden border-2 cursor-pointer', current === p.url ? 'border-brand-400' : 'border-white/10 hover:border-white/30')}>
                  <img src={p.url} alt={p.name} className="thumb w-full h-full object-cover" />
                  <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[10px] font-bold px-2 py-1 truncate">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between pt-4 border-t border-white/10">
          <span className="text-sm text-white/60">Current: <b className="text-white">{currentName}</b></span>
          <button type="button" onClick={close} className="h-10 px-6 rounded-xl btn-primary font-bold cursor-pointer">Done</button>
        </div>
      </div>
    </Modal>
  );
}

function PaperCard({ name, tag, desc, url, active, onPick, onAdjust }: { name: string; tag: string; desc: string; url: string; active: boolean; onPick: () => void; onAdjust: () => void }) {
  return (
    <div className={cx('rounded-2xl overflow-hidden border-2 bg-panel/5', active ? 'border-brand-400 ring-2 ring-brand-500/40' : 'border-white/10')}>
      <button type="button" onClick={onPick} className="relative block w-full h-40 cursor-pointer" aria-label={`Use ${name}`}>
        <img src={url} alt={name} className="thumb w-full h-full object-cover object-top" loading="lazy" />
        <span className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        {active && <span className="absolute top-3 right-3 w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center"><Check size={14} /></span>}
      </button>
      <div className="p-3">
        <div className="flex items-center justify-between"><span className="font-bold">{name}</span><span className="text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-panel/10 text-white/70">{tag}</span></div>
        <p className="text-[11px] text-white/60 mt-0.5">{desc}</p>
        <div className="mt-2 flex items-center justify-between text-[11px] font-bold">
          <span className="text-emerald-400 flex items-center gap-1"><Check size={11} /> Calibrated</span>
          <button type="button" onClick={onAdjust} className="text-white/70 hover:text-white flex items-center gap-1 cursor-pointer"><Sliders size={11} /> Adjust area</button>
        </div>
      </div>
    </div>
  );
}

const WELCOME_KEY = 'notehand.welcomed';
export const shouldWelcome = () => { try { return !localStorage.getItem(WELCOME_KEY); } catch { return false; } };

export function WelcomeModal() {
  const modal = useStore((s) => s.modal);
  const { ui } = useStore.getState();
  const close = (next: 'guide' | null) => { try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* ignore */ } ui({ modal: next }); };
  return (
    <Modal open={modal === 'welcome'} onClose={() => close(null)} label="Welcome">
      <div className="p-7 text-center">
        <img src={APP.logo} alt="" className="w-16 h-16 mx-auto rounded-2xl shadow-lg" />
        <h2 className="mt-5 text-2xl font-semibold text-surface-900">Welcome to {APP.name}</h2>
        <svg viewBox="0 0 160 10" className="mx-auto mt-1 w-40 h-2.5" aria-hidden><path d="M2 6 q20 -6 40 0 t40 0 t40 0 t36 0" fill="none" stroke="#2f64f5" strokeWidth="3" strokeLinecap="round" /></svg>
        <p className="mt-3 text-sm text-surface-600 leading-relaxed">Turn typed text into realistic handwriting on real notebook paper, then export a PDF or images.</p>
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-brand-50 border border-brand-100 px-3 py-2 text-left text-xs font-semibold text-brand-800"><Laptop size={16} className="shrink-0" /> Works on phones too, but a laptop makes adjusting pages easier.</div>
        <button type="button" onClick={() => close('guide')} className="mt-5 w-full h-12 rounded-2xl btn-primary text-white font-bold flex items-center justify-center gap-2 cursor-pointer"><BookOpen size={18} /> See the guide</button>
        <button type="button" onClick={() => close(null)} className="mt-2 w-full h-12 rounded-2xl bg-surface-100 hover:bg-surface-200 text-surface-800 font-bold cursor-pointer">Skip for now</button>
      </div>
    </Modal>
  );
}

const STEPS = [
  { icon: ImagePlus, title: 'Choose a page', body: 'Pick Classic White or Natural Paper, or upload a photo of your own notebook. Good, even light works best.' },
  { icon: ScanLine, title: 'Set the writing area', body: '“Select Writing Area” lets you drag four corners onto the first and last ruled lines. Text follows the page’s tilt and flows to new pages automatically.' },
  { icon: Type, title: 'Write or import', body: 'Type, paste, or upload a PDF/DOCX. Use ~~word~~ to cross out, ==word== to highlight, and LaTeX like \\frac{1}{2} for math.' },
  { icon: Sliders, title: 'Style it', body: 'Change font, size, ink and pen, spacing and tilt for the whole document, or select a line (or word in Words mode) to change just that.' },
  { icon: Wand2, title: 'Make it believable', body: 'Auto Mistake adds a few crossed-out typos. Realistic Mode adds phone-camera tilt and light. Character Variance makes repeated letters differ.' },
  { icon: Download, title: 'Export', body: 'Download a multi-page PDF or JPG images at low, normal or high resolution. No watermark, no sign-up. Your work is saved in this browser.' },
];

export function GuideOverlay() {
  const modal = useStore((s) => s.modal);
  const { ui } = useStore.getState();
  if (modal !== 'guide') return null;
  return (
    <div className="fixed inset-0 z-[260] bg-panel overflow-y-auto">
      <div className="fixed top-5 right-5 z-10"><CloseButton onClick={() => ui({ modal: null })} /></div>
      <div className="max-w-4xl mx-auto px-6 py-14 sm:py-20">
        <div className="text-center space-y-4">
          <span className="inline-flex items-center gap-2 px-4 py-2 bg-brand-50 text-brand-600 rounded-full text-xs font-bold"><BookOpen size={14} /> User guide</span>
          <h2 className="text-4xl sm:text-6xl font-bold text-surface-900 tracking-tight">Getting great results</h2>
          <p className="text-lg text-surface-500 max-w-2xl mx-auto">Six steps from typed text to a page that looks hand-written.</p>
        </div>
        <ol className="mt-14 grid gap-5 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-3xl border border-surface-200 p-6 bg-panel">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center"><s.icon size={18} /></span>
                <span className="text-xs font-medium text-surface-500 tabular-nums">Step {i + 1}</span>
              </div>
              <h3 className="mt-4 text-lg font-bold text-surface-900">{s.title}</h3>
              <p className="mt-1.5 text-sm text-surface-600 leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 rounded-3xl bg-[#1a4bd8] text-white p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3"><Sparkles size={22} /> <span className="font-medium">Shortcuts: Ctrl+Z undo · Ctrl+Shift+Z redo · Ctrl+S export · ←/→ change page · Delete removes the selection</span></div>
          <button type="button" onClick={() => ui({ modal: null })} className="h-11 px-6 rounded-xl bg-snow text-[#163bb0] font-semibold cursor-pointer">Start writing</button>
        </div>
      </div>
    </div>
  );
}
