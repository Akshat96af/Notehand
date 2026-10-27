// One notebook page on screen. Layer 1 draws the page with the shared renderer (same code as export);
// layer 2 holds invisible hit boxes for selecting, dragging and transforming lines/words/diagrams.
import type Konva from 'konva';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Rect, Shape, Stage, Transformer } from 'react-konva';
import type { TextNode } from '../engine/draw';
import { getImage, getReadyImage, nodeJitter, pageTransformFor, renderPage } from '../lib/exportDoc';
import { pageBackground, pageHeightFor, resolveDiagrams, setOverride, useStore, type Diagram } from '../state/store';

interface Live { ids: Set<string>; dx: number; dy: number; rotation?: number; sx?: number; sy?: number; nodeId?: string }

export function usePageImage(url: string | null) {
  const [img, setImg] = useState<HTMLImageElement | undefined>(() => getReadyImage(url));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (!url) { setImg(undefined); return; }
    const hit = getReadyImage(url);
    if (hit) { setImg(hit); return; }
    let alive = true;
    setImg(undefined);
    getImage(url).then((i) => alive && setImg(i)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [url]);
  return { img, failed };
}

export default function PageCanvas({ pageIndex, width, height }: { pageIndex: number; width: number; height: number }) {
  const doc = useStore((s) => s.doc);
  const nodes = useStore((s) => s.pages[pageIndex]) || [];
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedDiagramId = useStore((s) => s.selectedDiagramId);
  const fontsVersion = useStore((s) => s.fontsVersion);
  const exporting = useStore((s) => !!s.exportProgress);
  const { ui, update } = useStore.getState();
  const bgUrl = pageBackground(doc, pageIndex);
  const { img, failed } = usePageImage(bgUrl);
  const pageH = pageHeightFor(doc, pageIndex);
  const k = width / 3000;
  const [live, setLive] = useState<Live | null>(null);
  const [diagLive, setDiagLive] = useState<Diagram | null>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const diagTrRef = useRef<Konva.Transformer>(null);
  const hitLayer = useRef<Konva.Layer>(null);
  const blockPositions = useStore((s) => s.blockPositions);
  // anchored diagrams ([[diagram:id]] in the text) follow the text flow
  const diagrams = resolveDiagrams(doc, blockPositions).filter((d) => d.pageIndex === pageIndex);
  const mode = doc.moveMode;
  // block overrides are stored relative to the page offset (so PAGE-mode drags move them as well)
  const off = doc.pageOffsets[pageIndex] || { x: 0, y: 0 };
  const t = pageTransformFor({ pageIndex, bgUrl, realistic: doc.realistic, bg: img });

  // diagram images must be decoded before the render layer can draw them
  const [, setDiagTick] = useState(0);
  useEffect(() => {
    let alive = true;
    diagrams.forEach((d) => { if (!getReadyImage(d.src)) getImage(d.src).then(() => alive && setDiagTick((v) => v + 1)).catch(() => {}); });
    return () => { alive = false; };
  }, [diagrams.map((d) => d.src).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const drawnNodes: TextNode[] = useMemo(() => {
    if (!live) return nodes;
    return nodes.map((n) => {
      if (!live.ids.has(n.id)) return n;
      if (live.nodeId && live.nodeId !== n.id && live.rotation !== undefined) return n;
      return {
        ...n,
        x: n.x + live.dx,
        y: n.y + live.dy,
        rotation: live.rotation !== undefined && live.nodeId === n.id ? live.rotation : n.rotation,
        fontSize: live.sy && live.nodeId === n.id ? n.fontSize * live.sy : n.fontSize,
        width: live.sx && live.nodeId === n.id ? n.width * live.sx : n.width,
      };
    });
  }, [nodes, live]);
  const drawnDiagrams = diagLive ? diagrams.map((d) => (d.id === diagLive.id ? diagLive : d)) : diagrams;

  const sceneFunc = useMemo(
    () => (ctx: Konva.Context) =>
      renderPage(ctx._context, {
        pageIndex, nodes: drawnNodes, bg: img, bgUrl, pageH, outW: width, outH: height,
        realistic: doc.realistic, charVariance: doc.charVariance, overrides: doc.overrides, diagrams: drawnDiagrams,
      }),
    // fontsVersion forces a redraw once handwriting fonts finish loading
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawnNodes, img, bgUrl, pageH, width, height, doc.realistic, doc.charVariance, doc.overrides, drawnDiagrams, fontsVersion, pageIndex],
  );

  // attach transformers
  useEffect(() => {
    const tr = trRef.current;
    const layer = hitLayer.current;
    if (!tr || !layer) return;
    const targets = mode === 'all' || exporting ? [] : selectedIds.map((id) => layer.findOne(`#hit-${id}`)).filter(Boolean) as Konva.Node[];
    tr.nodes(targets);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, nodes, mode, exporting]);
  useEffect(() => {
    const tr = diagTrRef.current;
    const layer = hitLayer.current;
    if (!tr || !layer) return;
    const n = selectedDiagramId ? layer.findOne(`#diag-${selectedDiagramId}`) : null;
    tr.nodes(n ? [n] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedDiagramId, diagrams.length]);

  const select = (id: string, additive: boolean) => {
    if (mode === 'all') return;
    const cur = useStore.getState().selectedIds;
    ui({ selectedDiagramId: null, currentPage: pageIndex, selectedIds: additive ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id] });
  };

  const updateDiagram = (d: Diagram & { anchorX?: number; anchorY?: number }) => {
    const { anchorX, anchorY, ...rest } = d;
    // anchored: keep the anchor, store the drag as a nudge (dx/dy) from it
    const next = (x: Diagram): Diagram => (anchorX !== undefined ? { ...x, width: rest.width, height: rest.height, rotation: rest.rotation, dx: rest.x - anchorX, dy: rest.y - (anchorY ?? rest.y) } : rest);
    update({ diagrams: useStore.getState().doc.diagrams.map((x) => (x.id === d.id ? next(x) : x)) }, `diagram:${d.id}`);
  };
  const deleteDiagram = (id: string) => { update({ diagrams: useStore.getState().doc.diagrams.filter((x) => x.id !== id) }, 'diagram-del'); ui({ selectedDiagramId: null }); };

  return (
    <div className="relative" style={{ width, height }}>
      <Stage
        width={width}
        height={height}
        onMouseDown={(e) => { if (e.target === e.target.getStage()) ui({ selectedIds: [], selectedDiagramId: null, currentPage: pageIndex }); }}
        onTouchStart={(e) => { if (e.target === e.target.getStage()) ui({ selectedIds: [], selectedDiagramId: null, currentPage: pageIndex }); }}
      >
        <Layer listening={false}>
          <Shape sceneFunc={sceneFunc} perfectDrawEnabled={false} />
        </Layer>
        <Layer ref={hitLayer} listening={!exporting}>
          <Group
            x={width / 2 + t.offsetX * k}
            y={height / 2 + t.offsetY * k}
            rotation={t.rotation}
            skewX={t.skewX}
            skewY={t.skewY}
            scaleX={k * t.scaleOverscan}
            scaleY={k * t.scaleOverscan}
            offsetX={1500}
            offsetY={pageH / 2}
          >
            <Group
              draggable={mode === 'all'}
              onDragMove={(e) => { if (mode === 'all' && e.target === e.currentTarget) setLive({ ids: new Set(nodes.map((n) => n.id)), dx: e.target.x(), dy: e.target.y() }); }}
              onDragEnd={(e) => {
                if (mode !== 'all' || e.target !== e.currentTarget) return;
                const dx = e.target.x(), dy = e.target.y();
                e.target.position({ x: 0, y: 0 });
                const offs = useStore.getState().doc.pageOffsets;
                const cur = offs[pageIndex] || { x: 0, y: 0 };
                update({ pageOffsets: { ...offs, [pageIndex]: { x: cur.x + dx, y: cur.y + dy } } }, `offset:${pageIndex}`);
                setLive(null);
              }}
            >
              {mode === 'all' && <Rect x={0} y={0} width={3000} height={pageH} fill="rgba(0,0,0,0.001)" />}
              {nodes.map((n) => {
                const j = nodeJitter(n.id, pageIndex, doc.realistic);
                const sel = selectedIds.includes(n.id);
                const h = n.fontSize * Math.max(1.1, n.lineHeight || 1.2);
                return (
                  <Group
                    key={n.id}
                    id={`hit-${n.id}`}
                    x={n.x + j.x}
                    y={n.y + j.y}
                    rotation={(n.rotation || 0) + j.rotation}
                    draggable={mode !== 'all' && !exporting}
                    listening={mode !== 'all'}
                    onMouseDown={(e) => { e.cancelBubble = true; select(n.id, e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey); }}
                    onTap={(e) => { e.cancelBubble = true; select(n.id, false); }}
                    onMouseEnter={(e) => { const s = e.target.getStage(); if (s && mode !== 'all') s.container().style.cursor = 'move'; }}
                    onMouseLeave={(e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = 'default'; }}
                    onDragMove={(e) => setLive({ ids: new Set([n.id]), dx: e.target.x() - (n.x + j.x), dy: e.target.y() - (n.y + j.y) })}
                    onDragEnd={(e) => { setOverride(n, { x: e.target.x() - j.x - off.x, y: e.target.y() - j.y - off.y }, 'move'); setLive(null); }}
                    onTransform={(e) => {
                      const g = e.target;
                      setLive({ ids: new Set([n.id]), nodeId: n.id, dx: g.x() - (n.x + j.x), dy: g.y() - (n.y + j.y), rotation: g.rotation() - j.rotation, sx: g.scaleX(), sy: g.scaleY() });
                    }}
                    onTransformEnd={(e) => {
                      const g = e.target;
                      const sy = g.scaleY();
                      g.scale({ x: 1, y: 1 });
                      setOverride(n, { x: g.x() - j.x - off.x, y: g.y() - j.y - off.y, rotation: g.rotation() - j.rotation, fontSize: Math.max(8, n.fontSize * sy) }, 'transform');
                      setLive(null);
                    }}
                  >
                    <Rect x={-6} y={-4} width={Math.max(20, n.width) + 12} height={h + 8} fill="rgba(0,0,0,0.001)" stroke={sel ? '#2f64f5' : undefined} strokeWidth={sel ? 3 / k : 0} dash={[12, 8]} cornerRadius={8} />
                  </Group>
                );
              })}
            </Group>
            {drawnDiagrams.map((d) => (
              <Group key={d.id}>
                <Rect
                  id={`diag-${d.id}`}
                  x={d.x}
                  y={d.y}
                  width={d.width}
                  height={d.height}
                  rotation={d.rotation}
                  fill="rgba(0,0,0,0.001)"
                  stroke={selectedDiagramId === d.id ? '#2563eb' : undefined}
                  strokeWidth={3 / k}
                  dash={[14, 10]}
                  draggable={!exporting}
                  onMouseDown={(e) => { e.cancelBubble = true; ui({ selectedDiagramId: d.id, selectedIds: [], currentPage: pageIndex }); }}
                  onTap={(e) => { e.cancelBubble = true; ui({ selectedDiagramId: d.id, selectedIds: [] }); }}
                  onDragMove={(e) => setDiagLive({ ...d, x: e.target.x(), y: e.target.y() })}
                  onDragEnd={(e) => { updateDiagram({ ...d, x: e.target.x(), y: e.target.y() }); setDiagLive(null); }}
                  onTransform={(e) => { const r = e.target; setDiagLive({ ...d, x: r.x(), y: r.y(), rotation: r.rotation(), width: d.width * r.scaleX(), height: d.height * r.scaleY() }); }}
                  onTransformEnd={(e) => {
                    const r = e.target;
                    const nd = { ...d, x: r.x(), y: r.y(), rotation: r.rotation(), width: Math.max(30, d.width * r.scaleX()), height: Math.max(30, d.height * r.scaleY()) };
                    r.scale({ x: 1, y: 1 });
                    updateDiagram(nd);
                    setDiagLive(null);
                  }}
                />
                {selectedDiagramId === d.id && !exporting && (
                  <Group x={d.x + d.width + 30} y={d.y - 30} onMouseDown={(e) => { e.cancelBubble = true; deleteDiagram(d.id); }} onTap={(e) => { e.cancelBubble = true; deleteDiagram(d.id); }}>
                    <Circle radius={12 / k} fill="#ef4444" shadowBlur={4} shadowOpacity={0.3} />
                    <Line points={[-4 / k, -4 / k, 4 / k, 4 / k]} stroke="#fff" strokeWidth={2.5 / k} lineCap="round" />
                    <Line points={[4 / k, -4 / k, -4 / k, 4 / k]} stroke="#fff" strokeWidth={2.5 / k} lineCap="round" />
                  </Group>
                )}
              </Group>
            ))}
          </Group>
          <Transformer
            ref={trRef}
            rotateEnabled
            enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            keepRatio
            anchorSize={typeof window !== 'undefined' && window.innerWidth < 640 ? 16 : 10}
            anchorCornerRadius={4}
            anchorStroke="#2f64f5"
            anchorFill="#fff"
            borderStroke="#2f64f5"
            borderDash={[3, 3]}
            boundBoxFunc={(o, n) => (n.width < 5 || n.height < 5 ? o : n)}
          />
          <Transformer ref={diagTrRef} rotateEnabled anchorSize={12} anchorCornerRadius={3} anchorStroke="#2563eb" anchorFill="#fff" borderStroke="#2563eb" borderDash={[4, 4]} boundBoxFunc={(o, n) => (n.width < 20 || n.height < 20 ? o : n)} />
        </Layer>
      </Stage>
      {bgUrl && !img && !failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-panel/70 rounded-xl pointer-events-none">
          <div className="flex flex-col items-center gap-3 p-5 bg-panel rounded-2xl border border-surface-200 shadow-xl">
            <div className="w-10 h-10 border-[3px] border-brand-200 border-t-brand-600 rounded-full animate-spin" />
            <span className="text-xs font-bold text-surface-800">Loading page…</span>
          </div>
        </div>
      )}
      {failed && <div className="absolute inset-0 flex items-center justify-center text-sm text-red-600 font-semibold">Could not load this page image.</div>}
    </div>
  );
}
