// First screen of the editor: upload a notebook photo or pick a built-in page.
import { Check, ImagePlus, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { APP } from '../config';
import { PAPERS } from '../data/catalog';
import { PAPER_STYLES, paperDataUrl } from '../data/generatedPapers';
import { selectPaper, uploadPaper, useGeneratedPaper, useStore } from '../state/store';
import { useFilePicker } from './ui';

export default function EmptyState() {
  const paperUrl = useStore((s) => s.doc.paperUrl);
  const { ui } = useStore.getState();
  const picker = useFilePicker('image/*', (f) => uploadPaper(f, null).catch((e: Error) => toast.error(e.message)));

  return (
    <div className="nh-desk min-h-full">
      <div className="max-w-[920px] mx-auto px-4 sm:px-8 py-10 sm:py-14 space-y-12">
        {picker.input}
        <header className="text-center animate-fade-in">
          <p className="font-hand text-2xl text-brand-600 -rotate-1">{APP.stickers.hand}</p>
          <h1 className="mt-2 text-3xl sm:text-[40px] font-semibold tracking-tight text-surface-900">Start with a page</h1>
          <p className="mt-3 mx-auto max-w-md text-[15px] text-surface-500 leading-relaxed">Use a photo of your own notebook, or choose one of the prepared pages below. You can drop a file anywhere.</p>
          <div className="mt-7 flex flex-col sm:flex-row justify-center gap-3">
            <button type="button" onClick={picker.open} className="btn-primary h-11 px-6 rounded-xl text-[14px] font-semibold flex items-center justify-center gap-2 cursor-pointer">
              <ImagePlus size={17} /> Upload a photo
            </button>
            <button type="button" onClick={() => ui({ modal: 'background', backgroundTarget: null })} className="btn-secondary h-11 px-6 rounded-xl text-[14px] font-semibold flex items-center justify-center gap-2 cursor-pointer">
              <LayoutGrid size={17} /> All papers
            </button>
          </div>
        </header>

        <section id="page-templates" className="space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-surface-900">Notebook photos</h2>
            <span className="text-[12px] text-surface-500">Calibrated writing area · Classic White aligns best</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {PAPERS.map((p) => {
              const active = paperUrl === p.url;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPaper(p.url, null, { width: p.width, height: p.height })}
                  className={`group relative h-72 rounded-[20px] overflow-hidden text-left cursor-pointer transition-shadow duration-300 shadow-[0_1px_2px_rgb(0_0_0/0.06),0_16px_36px_-16px_rgb(0_0_0/0.35)] hover:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_24px_48px_-16px_rgb(0_0_0/0.45)] ${active ? 'ring-2 ring-brand-500 ring-offset-4 ring-offset-canvas' : ''}`}
                  aria-label={`Use ${p.name}`}
                >
                  <img src={p.url} alt="" className="thumb nh-page w-full h-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.04]" loading="lazy" />
                  <span className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-transparent" />
                  {active && <span className="absolute top-4 right-4 w-8 h-8 rounded-full bg-snow text-[#1a4bd8] flex items-center justify-center shadow-lg"><Check size={17} strokeWidth={2.5} /></span>}
                  <span className="absolute bottom-5 left-6 right-6">
                    <span className="block text-[17px] font-semibold text-white">{p.name}</span>
                    <span className="block text-[12px] text-white/75">{p.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-surface-900">Paper styles</h2>
            <span className="text-[12px] text-surface-500">Generated at full resolution</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {PAPER_STYLES.map((p) => (
              <button key={p.id} type="button" onClick={() => useGeneratedPaper(p.id, null)} title={p.description} className="group rounded-2xl overflow-hidden border border-surface-200 bg-panel text-left cursor-pointer hover:border-surface-300 hover:shadow-md transition-shadow">
                <img src={paperDataUrl(p.id, 240)} alt="" className="nh-page w-full h-36 object-cover object-top" />
                <span className="block px-3 py-2 text-[13px] font-medium text-surface-800 border-t border-surface-200">{p.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-px rounded-2xl overflow-hidden border border-surface-200 bg-surface-200">
          {[
            ['Choose a page', 'A prepared notebook page or a photo of your own paper.'],
            ['Add your text', 'Notes, essays or LaTeX math. Long text flows onto new pages.'],
            ['Export', 'A multi-page PDF or one image per page. No watermark.'],
          ].map(([title, body], i) => (
            <div key={title} className="bg-panel p-5">
              <span className="text-[12px] font-medium text-surface-500 tabular-nums">Step {i + 1}</span>
              <div className="mt-1 text-[14px] font-semibold text-surface-900">{title}</div>
              <p className="mt-1 text-[13px] text-surface-500 leading-relaxed">{body}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
