// Font picker popover content: custom upload, language & script filter, search, lazy font previews.
import { Check, ChevronDown, Languages, Plus, Search, Type, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CLASSIC_FONTS, LANGUAGES, SCRIPT_FONTS, type FontDef } from '../data/catalog';
import { customFonts, findFont, isFontLoaded, loadFont, onFontsChanged, registerCustomFont } from '../engine/fontLoader';
import { cx, useFilePicker } from './ui';

type LangChoice = 'classic' | 'all' | string; // language id

const SCRIPT_LABEL: Record<string, string> = { latin: 'Latin', cyrillic: 'Cyrillic', greek: 'Greek', devanagari: 'Devanagari', arabic: 'Arabic', hangul: 'Hangul', hiragana: 'Hiragana', katakana: 'Katakana' };
const LANG_KEY = 'notehand.fontLanguage.v2';

function useFontsTick() {
  const [v, set] = useState(0);
  useEffect(() => onFontsChanged(() => set((x) => x + 1)), []);
  return v;
}

function FontCard({ font, selected, onPick }: { font: FontDef; selected: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useFontsTick();
  useEffect(() => {
    const el = ref.current;
    if (!el || isFontLoaded(font.id) || font.group === 'custom') return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) { loadFont(font.id, 'low'); io.disconnect(); } }, { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, [font.id, font.group]);
  const ready = isFontLoaded(font.id);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onPick}
      className={cx(
        'w-full text-left rounded-2xl border px-3.5 py-2.5 transition cursor-pointer',
        selected ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-200' : 'border-surface-200 hover:border-brand-300 hover:bg-surface-50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cx('text-2xl leading-tight text-surface-900 truncate', !ready && 'opacity-40')} style={{ fontFamily: ready ? `"${font.id}"` : 'inherit' }}>
          {font.name}
        </span>
        {selected && <span className="w-5 h-5 rounded-full bg-brand-600 text-white flex items-center justify-center shrink-0"><Check size={12} /></span>}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[11px] text-surface-600 font-medium truncate">{font.name}</span>
        <span className="text-[9px] font-bold text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded shrink-0">
          {font.group === 'custom' ? 'Personal' : font.group === 'classic' ? 'English' : font.scripts.map((s) => SCRIPT_LABEL[s] || s).slice(0, 3).join(' · ')}
        </span>
      </div>
    </button>
  );
}

export default function FontPicker({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [lang, setLang] = useState<LangChoice>(() => { try { return localStorage.getItem(LANG_KEY) || 'all'; } catch { return 'classic'; } });
  const [langOpen, setLangOpen] = useState(false);
  const fontsTick = useFontsTick();
  const picker = useFilePicker('.ttf,.otf,.woff,.woff2', async (f) => {
    try {
      const def = await registerCustomFont(f.name.replace(/\.[^.]+$/, ''), await f.arrayBuffer());
      onPick(def.id);
      toast.success(`Added font "${def.name}"`);
    } catch {
      toast.error('That file is not a valid font.');
    }
  });

  const chooseLang = (l: LangChoice) => { setLang(l); setLangOpen(false); try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ } };
  const language = LANGUAGES.find((l) => l.id === lang);
  const langLabel = lang === 'classic' ? 'English (classic only)' : lang === 'all' ? 'All fonts' : language ? `${language.flag} ${language.name}` : 'English';

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (f: FontDef) => !q || f.name.toLowerCase().includes(q) || f.id.includes(q) || f.category.toLowerCase().includes(q);
    const out: { title: string; fonts: FontDef[] }[] = [];
    const everything = lang === 'all' || !!q; // searching always looks through every font
    const mine = customFonts().filter(match);
    if (mine.length) out.push({ title: 'My custom fonts', fonts: mine });
    if (lang === 'classic' || everything) out.push({ title: everything ? 'Classic handwriting' : 'English', fonts: CLASSIC_FONTS.filter(match) });
    if (everything) out.push({ title: 'Multilingual & script fonts', fonts: SCRIPT_FONTS.filter(match) });
    else if (language) {
      const fonts = SCRIPT_FONTS.filter((f) => f.scripts.includes(language.script));
      out.push({ title: language.name, fonts: fonts.filter(match) });
      if (language.script === 'latin') out.push({ title: 'Classic handwriting', fonts: CLASSIC_FONTS.filter(match) });
    }
    return out.filter((g) => g.fonts.length > 0);
  }, [query, lang, language, fontsTick]); // fontsTick: newly uploaded custom fonts appear immediately

  const total = groups.reduce((n, g) => n + g.fonts.length, 0);
  const pick = (id: string) => { loadFont(id); onPick(id); };

  return (
    <div className="p-3 space-y-3">
      {picker.input}
      <div className="flex items-center justify-between px-1">
        <span className="flex items-center gap-2 text-xs font-semibold text-surface-800"><Type size={14} className="text-brand-600" /> Handwriting fonts</span>
        <span className="text-[11px] font-medium text-surface-500 tabular-nums">{total} styles</span>
      </div>
      <div className="rounded-xl border border-dashed border-surface-300 p-2.5 flex items-center gap-3">
        <span className="w-8 h-8 rounded-lg bg-surface-100 text-surface-600 flex items-center justify-center shrink-0"><Upload size={15} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-surface-900">Your own font</div>
          <div className="text-[11px] text-surface-500 truncate">TTF, OTF or WOFF2</div>
        </div>
        <button type="button" onClick={picker.open} className="btn-secondary flex items-center gap-1 h-8 px-3 rounded-lg text-[12px] font-medium cursor-pointer"><Plus size={13} /> Upload</button>
      </div>
      <div>
        <div className="flex items-center justify-between px-1 mb-1.5">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-surface-600"><Languages size={13} /> Language & script</span>
          <span className="text-[11px] text-surface-500 tabular-nums">{LANGUAGES.length}+ languages</span>
        </div>
        <button type="button" onClick={() => setLangOpen((v) => !v)} className="btn-secondary w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 cursor-pointer" aria-expanded={langOpen}>
          <span className="text-[13px] font-medium text-surface-900">{langLabel}</span>
          <span className="flex items-center gap-1 text-[12px] font-medium text-brand-600">Change <ChevronDown size={12} /></span>
        </button>
        {langOpen && (
          <div className="mt-2 max-h-56 overflow-y-auto scroll-thin rounded-xl border border-surface-200 divide-y divide-surface-100">
            {[{ id: 'all', label: '🌐 All fonts (112)' }, { id: 'classic', label: '🇬🇧 English: 17 classic fonts only' }, ...LANGUAGES.filter((l) => l.id !== 'english').map((l) => ({ id: l.id, label: `${l.flag} ${l.name} · ${l.nativeName}` }))].map((o) => (
              <button key={o.id} type="button" onClick={() => chooseLang(o.id)} className={cx('w-full text-left px-3 py-2 text-xs hover:bg-surface-50 cursor-pointer', lang === o.id && 'bg-brand-50 font-bold text-brand-700')}>{o.label}</button>
            ))}
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 rounded-xl bg-surface-100 px-3 py-2 transition-shadow focus-within:ring-4 focus-within:ring-brand-500/15">
        <Search size={14} className="text-surface-500" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search fonts" className="flex-1 text-[13px] outline-none bg-transparent text-surface-900 placeholder:text-surface-500" aria-label="Search fonts" />
      </label>
      {groups.map((g) => (
        <div key={g.title} className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-semibold text-surface-500">{g.title}</span>
            <span className="text-[10px] font-bold text-surface-500">{g.fonts.length}</span>
          </div>
          {g.fonts.map((f) => <FontCard key={f.id} font={f} selected={value === f.id} onPick={() => pick(f.id)} />)}
        </div>
      ))}
      {total === 0 && <p className="text-xs text-surface-500 text-center py-6">No fonts match “{query}”.</p>}
    </div>
  );
}

export const fontName = (id?: string) => findFont(id)?.name || id || 'Font';
