// Assignment Studio: header, toolbar, page column, right panel, overlays. Owns the layout effect.
import { FileText, Loader2, PenLine, ScanLine, Layers, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import CalibrationOverlay from '../components/CalibrationOverlay';
import DiagramStudio from '../components/DiagramStudio';
import EmptyState from '../components/EmptyState';
import { fontName } from '../components/FontPicker';
import Header from '../components/Header';
import ClaudePanel from '../components/ClaudePanel';
import { useClaudeBridge } from '../lib/claudeBridge';
import { BackgroundModal, ExportModal, ExportProgress, FileNameModal, GuideOverlay, WelcomeModal, shouldWelcome } from '../components/Modals';
import PageCanvas from '../components/PageCanvas';
import RightPanel from '../components/RightPanel';
import Toolbar from '../components/Toolbar';
import { cx } from '../components/ui';
import { APP } from '../config';
import { CLASSIC_FONTS, PAGE_WIDTH, wordCount } from '../data/catalog';
import { applyAutoMistakes } from '../engine/autoMistake';
import { createCanvasMeasurer } from '../engine/draw';
import { findFont, isFontLoading, loadFont, onFontsChanged, prefetchFonts } from '../engine/fontLoader';
import { layoutPages } from '../engine/layout';

import { SAMPLE_TEXT, applyStyle, boundaryForPage, findNode, overrideKey, pageHeightFor, uploadPaper, useStore } from '../state/store';

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

let prefetched = false;

/** Recompute pages whenever text, style, boundaries or overrides change (fonts loaded first). */
function useLayoutEngine() {
  const doc = useStore((s) => s.doc);
  const fontsVersion = useStore((s) => s.fontsVersion);
  const text = useDebounced(doc.text, 300);
  const rate = useDebounced(doc.strikeRate, 200);
  const measurer = useMemo(() => createCanvasMeasurer(), []);
  // Re-layout only when a font this document uses changes; picker previews loading must not trigger it.
  useEffect(() => onFontsChanged((id) => {
    const { doc } = useStore.getState();
    const used = !id || id === doc.template.fontFamily || id === doc.template.secondaryFontFamily ||
      Object.values(doc.overrides).some((o) => o.fontFamily === id || o.secondaryFontFamily === id);
    if (used) useStore.setState((s) => ({ fontsVersion: s.fontsVersion + 1 }));
  }), []);
  useEffect(() => {
    const { ui } = useStore.getState();
    if (!doc.paperUrl || !text.trim()) { ui({ pages: [], layoutBusy: false }); return; }
    let alive = true;
    (async () => {
      ui({ layoutBusy: true });
      const fams = new Set<string>([doc.template.fontFamily]);
      if (doc.template.isCombinedFont && doc.template.secondaryFontFamily) fams.add(doc.template.secondaryFontFamily);
      for (const o of Object.values(doc.overrides)) { if (o.fontFamily) fams.add(o.fontFamily); if (o.secondaryFontFamily) fams.add(o.secondaryFontFamily); }
      // Only the fonts this document uses; document.fonts.ready would also wait for picker previews.
      await Promise.all([...fams].map((f) => loadFont(f)));
      if (!alive) return;
      const blockPositions: Record<string, { page: number; x: number; y: number; width: number }> = {};
      const pages = layoutPages({
        text: applyAutoMistakes(text, rate, doc.autoStrikeStyle),
        style: doc.template,
        boundaryFor: (p) => boundaryForPage(doc, p),
        defaultBoundary: boundaryForPage(doc, 0),
        moveMode: doc.moveMode,
        overrides: doc.overrides,
        pageOffsets: doc.pageOffsets,
        measurer,
        blocks: Object.fromEntries(doc.diagrams.map((d) => [d.id, d.height])),
        onBlock: (id, page, x, y, width) => { blockPositions[id] = { page, x, y, width }; },
      });
      if (!prefetched) { prefetched = true; prefetchFonts(CLASSIC_FONTS.map((f) => f.id)); } // picker opens instantly later
      const s = useStore.getState();
      // Node ids are positional; keep the selection on the same text block (paragraph/line/word) instead.
      const keys = new Set(s.selectedIds.map((sid) => findNode(s.pages, sid)).filter(Boolean).map((n) => overrideKey(n!)));
      const selectedIds = pages.flat().filter((n) => keys.has(overrideKey(n))).map((n) => n.id);
      ui({ pages, selectedIds, blockPositions, layoutBusy: false, currentPage: Math.min(s.currentPage, Math.max(0, pages.length - 1)) });
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, rate, doc.autoStrikeStyle, doc.template, doc.boundary, doc.pageBoundaries, doc.pageBackgrounds, doc.paperUrl, doc.paperSizes, doc.customPapers, doc.moveMode, doc.overrides, doc.pageOffsets, doc.diagrams, fontsVersion, measurer]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      if (s.calibratingPage !== null || (s.modal && s.modal !== null)) return;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (s.pages.length) s.ui({ modal: 'export' }); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); s.undo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); s.redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedDiagramId) {
        e.preventDefault();
        s.update({ diagrams: s.doc.diagrams.filter((d) => d.id !== s.selectedDiagramId) }, 'diagram-del');
        s.ui({ selectedDiagramId: null });
        toast.success('Diagram deleted');
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedIds.length && s.doc.moveMode !== 'all') {
        e.preventDefault();
        applyStyle({ hidden: true }, 'delete');
        s.ui({ selectedIds: [] });
        toast.success('Removed from the page (Ctrl+Z to undo)');
      } else if (e.key === 'Escape') s.ui({ selectedIds: [], selectedDiagramId: null });
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && s.pages.length > 1) {
        const next = Math.max(0, Math.min(s.pages.length - 1, s.currentPage + (e.key === 'ArrowRight' ? 1 : -1)));
        s.ui({ currentPage: next });
        document.getElementById(`page-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function useUrlParams() {
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const { doc, update } = useStore.getState();
    const blank = params.get('blank') === 'true' || params.get('blank') === '1';
    const mode = params.get('mode');
    const font = findFont(params.get('font') || undefined)?.id;
    const patch: Parameters<typeof update>[0] = {};
    if (blank) patch.text = '';
    else if (mode === 'assignment' && !doc.text) patch.text = SAMPLE_TEXT;
    if (mode === 'ai') { patch.realistic = true; patch.charVariance = true; }
    if (font) patch.template = { ...doc.template, fontFamily: font };
    if (Object.keys(patch).length) update(patch, 'url');
    if (mode === 'help') useStore.getState().ui({ modal: 'guide' });
    if (params.toString()) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function PageSlot({ index, colWidth }: { index: number; colWidth: number }) {
  const doc = useStore((s) => s.doc);
  const total = useStore((s) => s.pages.length);
  const isCurrent = useStore((s) => s.currentPage === index);
  const { ui } = useStore.getState();
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(index < 4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => setNear(!!e[0]?.isIntersecting), { rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const pageH = pageHeightFor(doc, index);
  const maxH = Math.max(520, Math.min(window.innerHeight * 0.82, 1100));
  let w = Math.min(colWidth - 32, 900);
  let h = (w * pageH) / PAGE_WIDTH;
  if (h > maxH) { h = maxH; w = (h * PAGE_WIDTH) / pageH; }
  w = Math.max(200, Math.floor(w));
  h = Math.floor((w * pageH) / PAGE_WIDTH);
  return (
    <div id={`page-${index}`} ref={ref} className="flex flex-col items-center gap-2" onMouseDown={() => !isCurrent && ui({ currentPage: index })}>
      <div className="w-full flex items-center justify-between gap-2" style={{ maxWidth: w }}>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-surface-500 tabular-nums">Page {index + 1}{total > 1 ? ` / ${total}` : ''}</span>
          <button type="button" onClick={() => ui({ modal: 'background', backgroundTarget: index })} className="h-7 px-2 rounded-lg text-[12px] font-medium text-surface-600 hover:bg-surface-200/60 hover:text-surface-900 flex items-center gap-1.5 cursor-pointer"><Layers size={13} /> Paper</button>
          <button type="button" onClick={() => ui({ calibratingPage: index })} className="h-7 px-2 rounded-lg text-[12px] font-medium text-surface-600 hover:bg-surface-200/60 hover:text-surface-900 flex items-center gap-1.5 cursor-pointer"><ScanLine size={13} /> Writing area</button>
        </div>
        {doc.realistic && <span className="text-[11px] font-medium text-surface-600 bg-surface-200/60 rounded-full px-2 py-0.5 flex items-center gap-1"><Sparkles size={11} /> Photo finish</span>}
      </div>
      <div className={cx('nh-page rounded-[6px] overflow-hidden bg-surface-100 transition-shadow duration-300 shadow-[0_1px_2px_rgb(0_0_0/0.06),0_18px_40px_-14px_rgb(0_0_0/0.28)] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.05),0_30px_70px_-20px_rgb(0_0_0/0.9)]', isCurrent && 'ring-2 ring-brand-500/50 ring-offset-4 ring-offset-canvas')} style={{ width: w, height: h }}>
        {near ? <PageCanvas pageIndex={index} width={w} height={h} /> : <div className="w-full h-full bg-[#faf9f5] animate-pulse" />}
      </div>
    </div>
  );
}

function Pages() {
  const pages = useStore((s) => s.pages.length);
  const busy = useStore((s) => s.layoutBusy);
  const text = useStore((s) => s.doc.text);
  const allHidden = useStore((s) => Object.values(s.doc.overrides).some((o) => o.hidden));
  const col = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = col.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const count = Math.max(1, pages);
  return (
    <div ref={col} className="nh-desk min-h-full py-8 px-2 sm:px-6 space-y-12">
      {!text.trim() && (
        <div className="max-w-xl mx-auto rounded-2xl border border-surface-200 bg-panel shadow-sm px-4 py-3 text-[13px] text-surface-700 flex items-center gap-3">
          <PenLine size={18} className="shrink-0 text-brand-600" /> The page is ready. Add text in the {window.innerWidth < 768 ? 'Edit tab' : 'panel on the right'}, or import a document.
        </div>
      )}
      {Array.from({ length: count }, (_, i) => <PageSlot key={i} index={i} colWidth={width} />)}
      {busy && pages === 0 && text.trim() && <div className="flex justify-center"><Loader2 className="animate-spin text-brand-600" /></div>}
      {!busy && pages === 0 && text.trim() && allHidden && (
        <div className="max-w-xl mx-auto rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Every text block on the page is deleted.{' '}
          <button type="button" className="font-bold underline cursor-pointer" onClick={() => { const { doc, update } = useStore.getState(); update({ overrides: Object.fromEntries(Object.entries(doc.overrides).map(([k, o]) => [k, { ...o, hidden: false }])) }, 'restore-hidden'); }}>Restore deleted text</button>
          {' '}or press Ctrl+Z.
        </div>
      )}
    </div>
  );
}

export default function EditorPage() {
  useLayoutEngine();
  useShortcuts();
  useClaudeBridge();
  useUrlParams();
  const hasPaper = useStore((s) => !!s.doc.paperUrl);
  const mobileTab = useStore((s) => s.mobileTab);
  const font = useStore((s) => s.doc.template.fontFamily);
  useStore((s) => s.fontsVersion);
  const { ui, update } = useStore.getState();
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => { if (shouldWelcome()) ui({ modal: 'welcome' }); document.title = `${APP.name} Editor — Text to Handwriting`; }, [ui]);
  useEffect(() => {
    // the page has unsaved-looking work only while exporting; everything else autosaves
    const onUnload = (e: BeforeUnloadEvent) => { if (useStore.getState().exportProgress) { e.preventDefault(); } };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    try {
      if (f.type.startsWith('image/')) await uploadPaper(f, null);
      else {
        const text = await (await import('../lib/extractText')).extractText(f);
        update({ text, overrides: {}, pageOffsets: {} }, 'import');
        toast.success(`Loaded "${f.name}" (${wordCount(text)} words)`);
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div
      className="fixed inset-0 h-[100dvh] w-full bg-canvas flex flex-col overflow-hidden"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={onDrop}
    >
      <Header />
      {hasPaper && <Toolbar />}
      <div className="flex flex-1 min-h-0">
        <main className={cx('flex-1 min-w-0 overflow-y-auto scroll-thin', mobileTab !== 'canvas' && 'hidden md:block')}>
          {hasPaper ? <Pages /> : <EmptyState />}
        </main>
        <aside className={cx('w-full md:w-[340px] shrink-0 bg-panel md:border-l border-surface-200 overflow-y-auto overflow-x-hidden scroll-thin', mobileTab === 'canvas' && 'hidden md:block')}>
          <RightPanel />
        </aside>
      </div>
      <nav className="md:hidden shrink-0 grid grid-cols-2 border-t border-surface-200 bg-panel">
        {([['canvas', 'Pages', FileText], ['text', 'Edit', PenLine]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => ui({ mobileTab: id })} className={cx('h-14 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium cursor-pointer', (mobileTab === id || (id === 'text' && mobileTab === 'settings')) ? 'text-brand-600' : 'text-surface-500')}>
            <Icon size={18} /> {label}
          </button>
        ))}
      </nav>
      <footer className="hidden md:flex h-9 shrink-0 items-center justify-between px-6 border-t border-surface-200 bg-panel text-[11px] text-surface-500">
        <span>{APP.footer.copyright} · {APP.footer.note}</span>
        <span>Autosaved in this browser</span>
      </footer>

      {isFontLoading(font) && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[150] bg-night-900/90 text-white backdrop-blur-md px-4 py-2 rounded-full shadow-xl flex items-center gap-2.5 text-[12px] font-medium animate-fade-in pointer-events-none">
          <Loader2 size={14} className="animate-spin text-brand-300" /> Loading {fontName(font)} font…
        </div>
      )}
      {dragOver && (
        <div className="fixed inset-0 z-[180] bg-brand-600/10 border-4 border-dashed border-brand-500 flex items-center justify-center pointer-events-none">
          <div className="bg-panel rounded-2xl shadow-2xl px-6 py-4 font-semibold text-surface-900">Drop a page photo, PDF, DOCX or TXT file</div>
        </div>
      )}
      <CalibrationOverlay />
      <ExportModal />
      <FileNameModal />
      <ExportProgress />
      <BackgroundModal />
      <WelcomeModal />
      <GuideOverlay />
      <ClaudePanel />
      <DiagramStudio />
    </div>
  );
}
