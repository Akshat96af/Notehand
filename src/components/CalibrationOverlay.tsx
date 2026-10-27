// "Select Writing Area": drag the 4 corners of the writing quad on the page photo.
import type Konva from 'konva';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronLeft, ChevronRight, CopyCheck, Expand, HelpCircle, NotebookPen, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Circle, Group, Image as KImage, Layer, Line, Stage, Text } from 'react-konva';
import { toast } from 'sonner';
import { PAGE_WIDTH, defaultBoundaryFor, type Boundary } from '../data/catalog';
import { applyBoundaryToAll, boundaryForPage, pageBackground, pageHeightFor, paperBoundary, saveBoundary, useStore } from '../state/store';
import { usePageImage } from './PageCanvas';
import { Modal, CloseButton, cx } from './ui';

type Corner = keyof Boundary;
const CORNERS: { id: Corner; label: string; short: string }[] = [
  { id: 'topLeft', label: 'Top-Left', short: 'TL' },
  { id: 'topRight', label: 'Top-Right', short: 'TR' },
  { id: 'bottomLeft', label: 'Bottom-Left', short: 'BL' },
  { id: 'bottomRight', label: 'Bottom-Right', short: 'BR' },
];

export default function CalibrationOverlay() {
  const page = useStore((s) => s.calibratingPage);
  if (page === null) return null;
  return <Calibrator key={page} page={page} />;
}

function Calibrator({ page }: { page: number }) {
  const doc = useStore((s) => s.doc);
  const pageCount = useStore((s) => Math.max(1, s.pages.length));
  const { ui } = useStore.getState();
  const url = pageBackground(doc, page);
  const { img } = usePageImage(url);
  const pageH = pageHeightFor(doc, page);
  const [b, setB] = useState<Boundary>(() => boundaryForPage(doc, page) || defaultBoundaryFor(PAGE_WIDTH, pageH));
  const [active, setActive] = useState<Corner>('topLeft');
  const [guide, setGuide] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const pad = 24;
  const scale = Math.min((size.w - pad * 2) / PAGE_WIDTH, (size.h - pad * 2) / pageH);
  const ox = (size.w - PAGE_WIDTH * scale) / 2, oy = (size.h - pageH * scale) / 2;
  const clamp = (p: { x: number; y: number }) => ({ x: Math.round(Math.max(0, Math.min(PAGE_WIDTH, p.x))), y: Math.round(Math.max(0, Math.min(pageH, p.y))) });
  const move = (c: Corner, p: { x: number; y: number }) => setB((cur) => ({ ...cur, [c]: clamp(p) }));
  const nudge = (dx: number, dy: number, big: boolean) => { const s = big ? 25 : 5; move(active, { x: b[active].x + dx * s, y: b[active].y + dy * s }); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (guide) return;
      const map: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (map[e.key]) { e.preventDefault(); nudge(map[e.key][0], map[e.key][1], e.shiftKey); }
      else if (e.key === 'Enter') done();
      else if (e.key === 'Escape') ui({ calibratingPage: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const done = () => { saveBoundary(page, b); ui({ calibratingPage: null }); };
  const preset = (kind: 'reset' | 'margin' | 'full') => {
    if (kind === 'reset') setB(paperBoundary(doc, url) || defaultBoundaryFor(PAGE_WIDTH, pageH));
    else if (kind === 'full') setB({ topLeft: { x: 0, y: 0 }, topRight: { x: PAGE_WIDTH, y: 0 }, bottomLeft: { x: 0, y: Math.round(pageH) }, bottomRight: { x: PAGE_WIDTH, y: Math.round(pageH) } });
    else setB(defaultBoundaryFor(PAGE_WIDTH, pageH, 0.08));
  };
  const initial = useRef(JSON.stringify(b));
  // only save when something changed (avoids freezing untouched pages and empty undo steps)
  const goPage = (p: number) => { if (JSON.stringify(b) !== initial.current) saveBoundary(page, b); ui({ calibratingPage: p }); };
  const pts = [b.topLeft, b.topRight, b.bottomRight, b.bottomLeft, b.topLeft].flatMap((p) => [p.x, p.y]);
  const btn = 'h-9 sm:h-10 px-2.5 sm:px-3 bg-zinc-800/90 hover:bg-zinc-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-zinc-700 cursor-pointer';

  return (
    <div className="fixed inset-0 z-[200] bg-night-950/98 backdrop-blur-xl flex flex-col p-2 sm:p-4 text-white select-none">
      <div className="w-full max-w-6xl mx-auto flex flex-col gap-2 sm:gap-3 h-full">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={() => ui({ calibratingPage: null })} className="p-2 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 rounded-xl border border-zinc-700 cursor-pointer" aria-label="Exit without saving"><X size={17} /></button>
            <h2 className="text-sm sm:text-base font-bold">Writing area{pageCount > 1 ? ` · Page ${page + 1}` : ''}</h2>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            {pageCount > 1 && (
              <>
                <button type="button" className={btn} disabled={page === 0} onClick={() => goPage(page - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
                <button type="button" className={btn} disabled={page >= pageCount - 1} onClick={() => goPage(page + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
                <button type="button" className={btn} onClick={() => { applyBoundaryToAll(b); toast.success(`Writing area applied to all ${pageCount} pages`); ui({ calibratingPage: null }); }}><CopyCheck size={15} /> <span className="hidden sm:inline">Apply all</span></button>
              </>
            )}
            <button type="button" className={cx(btn, 'text-[#8eb4ff]')} onClick={() => setGuide(true)}><HelpCircle size={15} /> <span className="hidden sm:inline">Guide</span></button>
            <button type="button" className={btn} onClick={() => preset('reset')} title="Reset to the page's default"><RotateCcw size={15} /> <span className="hidden sm:inline">Reset</span></button>
            <button type="button" onClick={done} className="h-9 sm:h-10 px-3 sm:px-5 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 shadow-md cursor-pointer"><Check size={15} strokeWidth={3} /> Done</button>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-night-900 border border-zinc-800 px-3 py-2 text-xs">
          <span className="font-semibold text-zinc-300">Drag a corner (or use arrow keys, Shift = bigger steps) to fit the writing area inside the lines</span>
          <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">{CORNERS.find((c) => c.id === active)?.short}</span>
        </div>
        <div ref={box} className="flex-1 min-h-0 rounded-2xl bg-surface-100 ring-4 ring-brand-500/20 overflow-hidden">
          <Stage width={size.w} height={size.h}>
            <Layer>
              <Group x={ox} y={oy} scaleX={scale} scaleY={scale}>
                {img && <KImage image={img} width={PAGE_WIDTH} height={pageH} />}
                <Line points={pts} stroke="rgba(255,255,255,0.55)" strokeWidth={2.6 / scale} closed listening={false} />
                <Line points={pts} stroke="#e11d48" strokeWidth={1.4 / scale} dash={[8 / scale, 5 / scale]} closed listening={false} />
                <Line points={[0, b[active].y, PAGE_WIDTH, b[active].y]} stroke="rgba(225,29,72,0.4)" strokeWidth={1 / scale} dash={[4 / scale, 4 / scale]} listening={false} />
                <Line points={[b[active].x, 0, b[active].x, pageH]} stroke="rgba(225,29,72,0.4)" strokeWidth={1 / scale} dash={[4 / scale, 4 / scale]} listening={false} />
                {CORNERS.map((c) => {
                  const p = b[c.id];
                  const on = active === c.id;
                  return (
                    <Group key={c.id}>
                      {on && <Circle x={p.x} y={p.y} radius={17 / scale} stroke="rgba(225,29,72,0.45)" strokeWidth={1 / scale} dash={[3 / scale, 3 / scale]} listening={false} />}
                      <Circle
                        x={p.x}
                        y={p.y}
                        radius={(on ? 11 : 9) / scale}
                        fill={on ? 'rgba(225,29,72,0.18)' : 'rgba(255,255,255,0.12)'}
                        stroke={on ? '#e11d48' : '#f43f5e'}
                        strokeWidth={(on ? 2 : 1.4) / scale}
                        hitStrokeWidth={60 / scale}
                        draggable
                        onMouseDown={() => setActive(c.id)}
                        onTouchStart={() => setActive(c.id)}
                        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => { const q = clamp({ x: e.target.x(), y: e.target.y() }); e.target.position(q); move(c.id, q); }}
                        onMouseEnter={(e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = 'crosshair'; }}
                        onMouseLeave={(e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = 'default'; }}
                      />
                      <Line points={[p.x - 12 / scale, p.y, p.x + 12 / scale, p.y]} stroke={on ? '#e11d48' : '#fff'} strokeWidth={1.2 / scale} listening={false} />
                      <Line points={[p.x, p.y - 12 / scale, p.x, p.y + 12 / scale]} stroke={on ? '#e11d48' : '#fff'} strokeWidth={1.2 / scale} listening={false} />
                      <Text x={p.x + (c.id.includes('Right') ? -26 : 12) / scale} y={p.y + (c.id.includes('bottom') ? -22 : 10) / scale} text={c.short} fontSize={10 / scale} fontStyle="bold" fill={on ? '#fff' : '#fca5a5'} shadowColor="black" shadowBlur={3} listening={false} />
                    </Group>
                  );
                })}
              </Group>
            </Layer>
          </Stage>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {CORNERS.map((c) => (
            <button key={c.id} type="button" onClick={() => setActive(c.id)} className={cx('rounded-xl border px-3 py-2 text-center cursor-pointer', active === c.id ? 'bg-rose-950/70 border-rose-500' : 'bg-night-900 border-zinc-800 hover:border-surface-600')}>
              <div className="text-xs font-bold">{c.label}</div>
              <div className="text-[10px] font-mono text-zinc-400">{Math.round(b[c.id].x)}, {Math.round(b[c.id].y)}</div>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-night-900 border border-zinc-800 p-2">
          <div className="flex items-center gap-1.5">
            {([[ArrowLeft, -1, 0, 'left'], [ArrowUp, 0, -1, 'up'], [ArrowDown, 0, 1, 'down'], [ArrowRight, 1, 0, 'right']] as const).map(([Icon, dx, dy, name]) => (
              <button key={name} type="button" aria-label={`Nudge ${name}`} onClick={(e) => nudge(dx, dy, e.shiftKey)} className="w-10 h-10 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 flex items-center justify-center cursor-pointer"><Icon size={16} /></button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={btn} onClick={() => preset('margin')} title="Set an 8% notebook margin"><NotebookPen size={15} className="text-[#8eb4ff]" /> Notebook margin</button>
            <button type="button" className={btn} onClick={() => preset('full')}><Expand size={15} className="text-emerald-300" /> Full page</button>
          </div>
        </div>
      </div>
      <Modal open={guide} onClose={() => setGuide(false)} label="Calibration guide">
        <div className="p-6 space-y-3 text-surface-800">
          <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Fitting the writing area</h3><CloseButton onClick={() => setGuide(false)} /></div>
          <ol className="list-decimal pl-5 space-y-2 text-sm text-surface-600">
            <li>Put <b>Top-Left</b> where the first line of writing should start (just right of the red margin line).</li>
            <li>Put <b>Top-Right</b> at the end of that same line. Text follows the slope between them, so a tilted photo still lines up.</li>
            <li>Put the bottom corners on the last usable line. The text never goes below them; extra text flows to a new page.</li>
            <li>Then tune <b>Line height</b> in the panel so each line sits on a ruled line.</li>
          </ol>
          <p className="text-xs text-surface-500">Arrow keys nudge the selected corner (Shift for big steps), Enter saves, Esc cancels.</p>
        </div>
      </Modal>
    </div>
  );
}
