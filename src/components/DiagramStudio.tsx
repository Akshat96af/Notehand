// Diagram Studio: upload / sketch / preset → convert to hand-drawn ink → place on the current page.
import { Brush, Check, Eraser, ImageUp, LayoutGrid, PenTool, Trash2, Type, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { PENS, inksForPen, type PenType } from '../data/catalog';
import { DEFAULT_INK_OPTIONS, inkifyCanvas, loadImage, type InkOptions } from '../engine/diagramInk';
import { pageHeightFor, useStore } from '../state/store';
import { Slider, cx, useFilePicker } from './ui';

const W = 900, H = 640;
type Tool = 'draw' | 'erase' | 'text';
interface Stroke { tool: 'draw' | 'erase'; color: string; size: number; pts: [number, number][] }
interface TextItem { x: number; y: number; text: string; color: string; size: number }
const COLORS = ['#1a1a1a', '#1d4ed8', '#dc2626', '#16a34a', '#d97706', '#6b7280'];

const PRESETS: { id: string; name: string; draw: (c: CanvasRenderingContext2D) => void }[] = [
  { id: 'flow', name: 'Flowchart', draw: (c) => {
    const box = (x: number, y: number, t: string) => { c.strokeRect(x - 110, y - 35, 220, 70); c.fillText(t, x, y + 8); };
    const arrow = (x: number, y1: number, y2: number) => { c.beginPath(); c.moveTo(x, y1); c.lineTo(x, y2); c.lineTo(x - 10, y2 - 14); c.moveTo(x, y2); c.lineTo(x + 10, y2 - 14); c.stroke(); };
    box(450, 90, 'Start'); arrow(450, 125, 205); box(450, 240, 'Process'); arrow(450, 275, 355);
    c.beginPath(); c.moveTo(450, 360); c.lineTo(560, 430); c.lineTo(450, 500); c.lineTo(340, 430); c.closePath(); c.stroke(); c.fillText('Decision?', 450, 438);
    arrow(450, 500, 570); c.fillText('End', 450, 600);
  } },
  { id: 'cycle', name: 'Cycle', draw: (c) => {
    const pts = [[450, 120], [650, 320], [450, 520], [250, 320]] as const;
    const labels = ['Step 1', 'Step 2', 'Step 3', 'Step 4'];
    pts.forEach(([x, y], i) => { c.beginPath(); c.arc(x, y, 70, 0, Math.PI * 2); c.stroke(); c.fillText(labels[i], x, y + 8); });
    c.beginPath(); c.arc(450, 320, 200, -Math.PI / 2 + 0.4, -0.4); c.stroke(); c.beginPath(); c.arc(450, 320, 200, 0.4, Math.PI / 2 - 0.4); c.stroke();
    c.beginPath(); c.arc(450, 320, 200, Math.PI / 2 + 0.4, Math.PI - 0.4); c.stroke(); c.beginPath(); c.arc(450, 320, 200, Math.PI + 0.4, 1.5 * Math.PI - 0.4); c.stroke();
  } },
  { id: 'graph', name: 'Graph axes', draw: (c) => {
    c.beginPath(); c.moveTo(120, 560); c.lineTo(820, 560); c.moveTo(150, 590); c.lineTo(150, 70); c.stroke();
    c.beginPath(); for (let x = 0; x <= 600; x += 10) { const y = 520 - 0.0011 * x * x; x === 0 ? c.moveTo(150 + x, y) : c.lineTo(150 + x, y); } c.stroke();
    c.fillText('x', 800, 595); c.fillText('y', 120, 90); c.fillText('y = kx²', 640, 160);
  } },
  { id: 'venn', name: 'Venn diagram', draw: (c) => {
    c.beginPath(); c.arc(370, 320, 190, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.arc(530, 320, 190, 0, Math.PI * 2); c.stroke();
    c.fillText('A', 280, 330); c.fillText('B', 620, 330); c.fillText('A ∩ B', 450, 330);
  } },
  { id: 'bars', name: 'Bar chart', draw: (c) => {
    c.beginPath(); c.moveTo(120, 560); c.lineTo(820, 560); c.moveTo(150, 590); c.lineTo(150, 80); c.stroke();
    [220, 330, 180, 420, 300].forEach((h, i) => c.strokeRect(210 + i * 120, 560 - h, 70, h));
  } },
  { id: 'table', name: 'Table', draw: (c) => {
    for (let r = 0; r <= 4; r++) { c.beginPath(); c.moveTo(150, 120 + r * 100); c.lineTo(750, 120 + r * 100); c.stroke(); }
    for (let k = 0; k <= 3; k++) { c.beginPath(); c.moveTo(150 + k * 200, 120); c.lineTo(150 + k * 200, 520); c.stroke(); }
    ['Item', 'Value', 'Notes'].forEach((t, i) => c.fillText(t, 250 + i * 200, 180));
  } },
];

export default function DiagramStudio() {
  const open = useStore((s) => s.modal === 'diagram');
  return open ? <Studio /> : null;
}

function Studio() {
  const page = useStore((s) => s.currentPage);
  const doc = useStore((s) => s.doc);
  const { ui, update } = useStore.getState();
  const [source, setSource] = useState<'upload' | 'sketch' | 'preset'>('upload');
  const [base, setBase] = useState<HTMLImageElement | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [texts, setTexts] = useState<TextItem[]>([]);
  const [tool, setTool] = useState<Tool>('draw');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(4);
  const [pen, setPen] = useState<PenType>('ballpoint');
  const [ink, setInk] = useState<InkOptions>({ ...DEFAULT_INK_OPTIONS, inkColor: '#000066' });
  const [preview, setPreview] = useState<string>('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<Stroke | null>(null);
  const [title, setTitle] = useState('Diagram');
  const close = () => ui({ modal: null });

  const upload = useFilePicker('image/*', async (f) => {
    try {
      const url = URL.createObjectURL(f);
      try { setBase(await loadImage(url)); } finally { URL.revokeObjectURL(url); } // decoded image stays usable
      setPreset(null);
      setTitle(f.name.replace(/\.[^.]+$/, ''));
    } catch { toast.error('Could not open that image'); }
  });

  const redraw = useCallback(() => {
    const c = canvas.current?.getContext('2d');
    if (!c) return;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, W, H);
    if (base) {
      // SVGs without width/height report 0×0: treat them as filling the canvas instead of drawing NaN×NaN
      const nw = base.naturalWidth || W, nh = base.naturalHeight || H;
      const k = Math.min(W / nw, H / nh);
      const w = nw * k, h = nh * k;
      c.drawImage(base, (W - w) / 2, (H - h) / 2, w, h);
    }
    const p = PRESETS.find((x) => x.id === preset);
    if (p) { c.save(); c.strokeStyle = '#111'; c.fillStyle = '#111'; c.lineWidth = 3.5; c.lineJoin = 'round'; c.font = '34px "cursive_real", cursive'; c.textAlign = 'center'; p.draw(c); c.restore(); }
    for (const s of strokes) {
      c.save();
      c.strokeStyle = s.tool === 'erase' ? '#ffffff' : s.color;
      c.lineWidth = s.tool === 'erase' ? s.size * 4 : s.size;
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath();
      s.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.stroke();
      c.restore();
    }
    for (const t of texts) { c.fillStyle = t.color; c.font = `${t.size}px "cursive_real", cursive`; c.fillText(t.text, t.x, t.y); }
  }, [base, preset, strokes, texts]);

  useEffect(() => { redraw(); }, [redraw]);
  useEffect(() => {
    const id = setTimeout(() => { if (canvas.current) setPreview(inkifyCanvas(canvas.current, ink)); }, 180);
    return () => clearTimeout(id);
  }, [ink, base, preset, strokes, texts]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pos(e);
    if (tool === 'text') {
      const text = window.prompt('Text to add');
      if (text) setTexts((t) => [...t, { x: p[0], y: p[1], text, color, size: 14 + size * 3 }]);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = { tool, color, size, pts: [p] };
    setStrokes((s) => [...s, drawing.current!]);
  };
  const moveP = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current.pts.push(pos(e));
    const stroke = { ...drawing.current, pts: [...drawing.current.pts] }; // copy now: the ref is cleared on pointerup
    setStrokes((s) => [...s.slice(0, -1), stroke]);
  };
  const up = () => { drawing.current = null; };

  const place = () => {
    if (!preview) return;
    const img = new Image();
    img.onload = () => {
      const pageH = pageHeightFor(doc, page);
      const w = 1500, h = w * (img.height / img.width);
      update({ diagrams: [...doc.diagrams, { id: `dg_${Date.now().toString(36)}`, src: preview, title, pageIndex: page, x: (3000 - w) / 2, y: Math.min(pageH * 0.45, pageH - h - 100), width: w, height: h, rotation: 0, opacity: 0.95 }] }, 'diagram-add');
      ui({ modal: null });
      toast.success(`Diagram placed on page ${page + 1}. Drag, resize or rotate it.`);
    };
    img.src = preview;
  };

  const hasContent = !!base || !!preset || strokes.length > 0 || texts.length > 0;

  return createPortal(
    <div className="fixed inset-0 z-[260] bg-panel flex flex-col">
      {upload.input}
      <div className="h-16 shrink-0 border-b border-surface-200 flex items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center"><PenTool size={18} /></span>
          <div>
            <div className="font-bold text-surface-900 flex items-center gap-2">Diagram Studio <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-100">P{page + 1}</span></div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="text-xs text-surface-500 outline-none bg-transparent" aria-label="Diagram title" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={close} className="h-10 px-4 rounded-xl border border-surface-200 text-sm font-bold text-surface-700 hover:bg-surface-50 cursor-pointer">Cancel</button>
          <button type="button" onClick={place} disabled={!hasContent} className="h-10 px-4 rounded-xl btn-primary text-white text-sm font-bold flex items-center gap-2 disabled:opacity-50 cursor-pointer"><Check size={16} /> Insert on page {page + 1}</button>
        </div>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[320px_1fr_340px]">
        <aside className="border-r border-surface-200 overflow-y-auto scroll-thin p-4 space-y-5">
          <div>
            <div className="text-[11px] font-bold text-surface-500 mb-2">Diagram source</div>
            <div className="grid grid-cols-3 gap-1 bg-surface-100 p-1 rounded-xl">
              {([['upload', 'Upload', Upload], ['sketch', 'Sketch', Brush], ['preset', 'Preset', LayoutGrid]] as const).map(([id, label, Icon]) => (
                <button key={id} type="button" onClick={() => setSource(id)} className={cx('py-2 rounded-lg text-[11px] font-bold flex flex-col items-center gap-1 cursor-pointer', source === id ? 'bg-panel dark:bg-surface-300 text-surface-900 shadow-sm' : 'text-surface-600')}><Icon size={15} />{label}</button>
              ))}
            </div>
          </div>
          {source === 'upload' && (
            <button type="button" onClick={upload.open} className="w-full rounded-2xl border-2 border-dashed border-surface-300 hover:border-brand-300 py-8 flex flex-col items-center gap-2 cursor-pointer">
              <span className="w-10 h-10 rounded-xl bg-panel border border-surface-200 shadow-sm flex items-center justify-center"><ImageUp size={18} className="text-brand-600" /></span>
              <span className="text-sm font-bold text-surface-800">Upload diagram image</span>
              <span className="text-[11px] text-surface-500">PNG, JPG, WebP, SVG</span>
            </button>
          )}
          {source === 'sketch' && <p className="text-xs text-surface-500">Draw straight on the canvas. Pen, eraser and text tools are above it.</p>}
          {source === 'preset' && (
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" onClick={() => { setPreset(p.id); setBase(null); setTitle(p.name); }} className={cx('h-14 rounded-xl border text-xs font-bold cursor-pointer', preset === p.id ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-surface-200 hover:bg-surface-50 text-surface-700')}>{p.name}</button>
              ))}
            </div>
          )}
          <div className="space-y-3 pt-4 border-t border-surface-100">
            <div className="text-[11px] font-bold text-surface-500">Ink & line tuning</div>
            <div className="grid grid-cols-3 gap-1 bg-surface-100 p-1 rounded-xl">
              {PENS.map((p) => (
                <button key={p.id} type="button" onClick={() => setPen(p.id)} className={cx('py-1.5 rounded-lg text-[11px] font-bold cursor-pointer', pen === p.id ? 'bg-panel dark:bg-surface-300 text-surface-900 shadow-sm' : 'text-surface-600')}>{p.label.replace(' (Fountain)', '')}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {inksForPen(pen).map((i) => (
                <button key={i.value + i.category} type="button" onClick={() => setInk((o) => ({ ...o, inkColor: i.value }))} className={cx('flex items-center gap-2 h-8 px-2 rounded-lg border text-[11px] text-left cursor-pointer', ink.inkColor === i.value ? 'border-brand-400 bg-brand-50' : 'border-surface-200 hover:bg-surface-50')}>
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: i.value }} /><span className="truncate">{i.name}</span>
                </button>
              ))}
            </div>
            <Slider label="Line thickness" value={ink.lineThickness} min={0.3} max={3} step={0.1} unit="x" onChange={(v) => setInk((o) => ({ ...o, lineThickness: v }))} />
            <Slider label="Ink opacity" value={ink.lineOpacity * 100} min={10} max={100} step={1} digits={0} unit="%" onChange={(v) => setInk((o) => ({ ...o, lineOpacity: v / 100 }))} />
            <Slider label="Hand-drawn roughness" value={ink.roughness} min={0} max={8} step={1} digits={0} onChange={(v) => setInk((o) => ({ ...o, roughness: v }))} />
            <Slider label="Background removal threshold" value={ink.contrastThreshold} min={80} max={250} step={1} digits={0} onChange={(v) => setInk((o) => ({ ...o, contrastThreshold: v }))} />
            <label className="flex items-center gap-2 text-sm text-surface-700"><input type="checkbox" checked={ink.transparent} onChange={(e) => setInk((o) => ({ ...o, transparent: e.target.checked }))} /> Transparent background</label>
            <label className="flex items-center gap-2 text-sm text-surface-700"><input type="checkbox" checked={ink.invert} onChange={(e) => setInk((o) => ({ ...o, invert: e.target.checked }))} /> Invert dark diagram</label>
          </div>
        </aside>
        <main className="bg-surface-50 p-4 flex flex-col gap-3 min-h-0 overflow-auto">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-panel border border-surface-200 p-2 shadow-sm">
            <div className="flex items-center gap-1 bg-surface-100 rounded-xl p-1">
              {([['draw', 'Draw', Brush], ['erase', 'Erase', Eraser], ['text', 'Text', Type]] as const).map(([id, label, Icon]) => (
                <button key={id} type="button" onClick={() => setTool(id)} className={cx('h-8 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer', tool === id ? 'bg-brand-600 text-white' : 'text-surface-600')}><Icon size={14} />{label}</button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {COLORS.map((c) => <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => setColor(c)} className={cx('w-7 h-7 rounded-full border-2 cursor-pointer', color === c ? 'border-brand-500 ring-2 ring-brand-200' : 'border-white shadow')} style={{ backgroundColor: c }} />)}
            </div>
            <label className="flex items-center gap-2 text-xs text-surface-500">Size <input type="range" min={1} max={16} value={size} onChange={(e) => setSize(+e.target.value)} className="nh-range" /> <b className="text-surface-800">{size}px</b></label>
            <button type="button" aria-label="Clear drawing" title="Clear drawing" onClick={() => { setStrokes([]); setTexts([]); }} className="ml-auto p-2 rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"><Trash2 size={16} /></button>
          </div>
          <div className="flex-1 min-h-[300px] flex items-center justify-center">
            <canvas ref={canvas} width={W} height={H} onPointerDown={down} onPointerMove={moveP} onPointerUp={up} onPointerLeave={up} className="max-w-full max-h-full bg-snow rounded-xl shadow border border-surface-200 touch-none" style={{ aspectRatio: `${W}/${H}`, cursor: tool === 'text' ? 'text' : 'crosshair' }} />
          </div>
        </main>
        <aside className="border-l border-surface-200 p-4 flex flex-col gap-3 overflow-y-auto scroll-thin">
          <div className="flex items-center justify-between text-[11px] font-bold text-surface-500"><span>Notebook live result</span><span className="text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded normal-case">Ink output</span></div>
          <div className="rounded-2xl border border-amber-200 bg-[#fdfbf4] p-3 min-h-[220px] flex items-center justify-center" style={{ backgroundImage: 'radial-gradient(#e7dfc9 1px, transparent 1px)', backgroundSize: '14px 14px' }}>
            {preview && hasContent ? <img src={preview} alt="Ink preview" className="max-w-full" /> : <span className="text-xs text-surface-500">Your inked diagram appears here</span>}
          </div>
          <button type="button" onClick={place} disabled={!hasContent} className="mt-auto h-12 rounded-2xl btn-primary text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"><Check size={16} /> Place on page {page + 1}</button>
          <p className="text-[11px] text-surface-500 text-center">The diagram becomes a movable element: drag, resize, rotate, or delete it with Backspace/Delete.</p>
        </aside>
      </div>
    </div>,
    document.body,
  );
}
