// Landing page (own copy; layout inspired by the reference home: hero, features, steps, CTA).
import { ArrowRight, Download, FileText, Highlighter, ImagePlus, Languages, PenLine, ScanLine, Sparkles, Wand2 } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ThemeSwitch } from '../components/Header';
import { APP, asset } from '../config';
import { useStore } from '../state/store';

const FEATURES = [
  { icon: PenLine, title: '112 handwriting fonts', body: 'Cursive, print and script styles, plus Hindi, Arabic, Cyrillic, Greek, Korean and Japanese fonts. Combine two fonts for extra variety.' },
  { icon: ScanLine, title: 'Your own notebook', body: 'Use a photo of your paper. Drag four corners onto the ruled lines and the text follows the page, even when the photo is tilted.' },
  { icon: Wand2, title: 'Looks written, not typed', body: 'Seeded per-letter variation, real ink behaviour for ballpoint, gel and fountain pens, and optional crossed-out typos.' },
  { icon: Highlighter, title: 'Strike, highlight, math', body: 'Cross out with four pen styles, highlight with six colors, and write LaTeX like \\frac{1}{2} or x^2.' },
  { icon: FileText, title: 'Import documents', body: 'Bring in PDF, DOCX or TXT. Long text flows onto as many pages as it needs.' },
  { icon: Download, title: 'PDF & JPG export', body: 'Low, normal or high resolution. No watermark, no account, no payment. Everything stays in your browser.' },
];

export default function HomePage() {
  const hasWork = useStore((s) => !!s.doc.text || !!s.doc.paperUrl);
  useEffect(() => { document.title = `${APP.name} — Text to Handwriting`; }, []);
  return (
    <div className="min-h-full bg-canvas">
      <nav className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <img src={APP.logo} alt="" className="w-10 h-10 rounded-xl shadow" />
          <span className="text-lg font-semibold text-surface-900">{APP.name}</span>
        </Link>
        <div className="flex items-center gap-2"><ThemeSwitch /><Link to="/editor" className="h-10 px-5 rounded-xl btn-primary text-sm font-semibold flex items-center gap-2">Open editor <ArrowRight size={16} /></Link></div>
      </nav>

      <header className="max-w-6xl mx-auto px-6 pt-10 pb-16 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-panel border border-surface-200 text-surface-700 text-[12px] font-medium"><Sparkles size={13} className="text-brand-600" /> Free · no account · no watermark</span>
          <h1 className="mt-5 text-5xl sm:text-6xl font-semibold tracking-tight text-surface-900 leading-[1.05]">Text to handwriting<span className="text-brand-600">.</span></h1>
          <p className="mt-5 text-lg text-surface-600 leading-relaxed max-w-xl">{APP.tagline} Paste your notes or assignment, pick a notebook page and a pen, and download realistic handwritten pages as PDF or images.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/editor?mode=assignment" className="h-14 px-7 rounded-2xl btn-primary text-white font-bold flex items-center gap-2 shadow-lg shadow-brand-600/25">Start writing <ArrowRight size={18} /></Link>
            {hasWork && <Link to="/editor" className="h-14 px-7 rounded-2xl border-2 border-brand-200 bg-panel text-brand-700 font-bold flex items-center gap-2">Continue where you left off</Link>}
          </div>
          <div className="mt-8 flex items-center gap-6 text-sm text-surface-500">
            <span className="flex items-center gap-2"><Languages size={16} /> 95+ languages</span>
            <span className="flex items-center gap-2"><ImagePlus size={16} /> Your own paper</span>
          </div>
        </div>
        <div className="relative">
          <div className="rounded-[2rem] overflow-hidden shadow-2xl border border-surface-200 rotate-1 bg-panel">
            <img src={asset('pages/notebook/20260329_012336.jpg')} alt="Notebook page" className="w-full h-[460px] object-cover object-top" />
          </div>
          <div className="absolute inset-x-10 top-16 mix-blend-multiply space-y-4 font-hand text-[#000066] text-2xl sm:text-3xl leading-snug rotate-1 pointer-events-none" aria-hidden>
            <p>Name: Student Name</p>
            <p>Question 1: State Newton's laws.</p>
            <p>1. An object at rest stays at rest…</p>
            <p>2. F = m × a</p>
          </div>
          <span className="absolute -bottom-4 -left-4 -rotate-3 bg-panel border border-surface-200 shadow-lg rounded-xl px-4 py-2 font-hand text-xl text-brand-700">{APP.stickers.hand}</span>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 pb-20">
        <h2 className="text-3xl font-semibold text-surface-900 text-center">Everything you need for handwritten pages</h2>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-3xl bg-panel border border-surface-200 p-6">
              <span className="w-11 h-11 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center"><f.icon size={20} /></span>
              <h3 className="mt-4 font-bold text-surface-900">{f.title}</h3>
              <p className="mt-1.5 text-sm text-surface-600 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-night-900 text-white">
        <div className="max-w-6xl mx-auto px-6 py-16 grid sm:grid-cols-3 gap-8">
          {[['1', 'Pick a page', 'Built-in notebook paper or a photo of yours.'], ['2', 'Paste text', 'Type, paste, or import a PDF/DOCX.'], ['3', 'Export', 'Multi-page PDF or JPG, ready to print or share.']].map(([n, t, b]) => (
            <div key={n}><span className="text-5xl font-semibold text-brand-400">{n}</span><h3 className="mt-2 text-xl font-bold">{t}</h3><p className="mt-1 text-white/60">{b}</p></div>
          ))}
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 py-10 flex flex-wrap items-center justify-between gap-4 text-sm text-surface-500">
        <span>{APP.footer.copyright} · {APP.footer.note}</span>
        <Link to="/editor" className="font-bold text-brand-600">Open the editor →</Link>
      </footer>
    </div>
  );
}
