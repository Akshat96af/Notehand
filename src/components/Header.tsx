import { Bot, Download, HelpCircle, Maximize, Minimize, Moon, PenTool, Redo2, RotateCcw, Sun, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { APP } from '../config';
import { useBridge } from '../lib/claudeBridge';
import { setTheme, useTheme } from '../lib/theme';
import { useStore } from '../state/store';
import { STATUS_DOT } from './ClaudePanel';
import { cx } from './ui';

const iconBtn = 'items-center justify-center w-9 h-9 rounded-[10px] text-surface-600 hover:bg-surface-100 hover:text-surface-900 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed';
const pill = 'btn-secondary h-9 px-3 rounded-[10px] text-[13px] font-semibold items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

export function ThemeSwitch() {
  const theme = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      className={cx(iconBtn, 'inline-flex relative overflow-hidden')}
      aria-label={dark ? 'Switch to light appearance' : 'Switch to dark appearance'}
      title={dark ? 'Light appearance' : 'Dark appearance'}
      onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTheme(dark ? 'light' : 'dark', { x: r.left + r.width / 2, y: r.top + r.height / 2 }); }}
    >
      <Sun size={17} className={cx('absolute transition-all duration-500', dark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50')} style={{ transitionTimingFunction: 'var(--ease-out-soft)' }} />
      <Moon size={16} className={cx('absolute transition-all duration-500', dark ? 'opacity-0 rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100')} style={{ transitionTimingFunction: 'var(--ease-out-soft)' }} />
    </button>
  );
}

export default function Header() {
  const pages = useStore((s) => s.pages);
  const hasPaper = useStore((s) => !!s.doc.paperUrl);
  const canUndo = useStore((s) => s.history.past.length > 0);
  const canRedo = useStore((s) => s.history.future.length > 0);
  const { undo, redo, ui, resetDoc } = useStore.getState();
  const [full, setFull] = useState(false);
  const claudeStatus = useBridge((s) => s.status);
  const claudeBusy = useBridge((s) => s.busy);

  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const exportReady = hasPaper && pages.length > 0;

  return (
    <header className="h-[60px] shrink-0 bg-panel/85 backdrop-blur-xl border-b border-surface-200 flex items-center justify-between px-3 sm:px-5 gap-3 z-[120]">
      <Link to="/" className="flex items-center gap-2.5 min-w-0 rounded-xl -ml-1 pl-1 pr-2 py-1 hover:bg-surface-100" title="Home">
        <img src={APP.logo} alt="" className="w-8 h-8 rounded-[9px] shrink-0 shadow-sm" />
        <span className="min-w-0 leading-tight">
          <span className="block text-[15px] font-semibold text-surface-900 truncate">{APP.name}</span>
          <span className="hidden sm:block text-[11px] text-surface-500 truncate">{APP.subtitle}</span>
        </span>
      </Link>
      <div className="flex items-center gap-1 sm:gap-1.5">
        <div className="hidden sm:flex items-center">
          <button type="button" className={cx(iconBtn, "inline-flex")} onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 size={17} /></button>
          <button type="button" className={cx(iconBtn, "inline-flex")} onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Redo2 size={17} /></button>
        </div>
        <span className="hidden sm:block w-px h-5 bg-surface-200 mx-1" />
        <button type="button" onClick={() => ui({ modal: 'diagram' })} disabled={!hasPaper} title={hasPaper ? 'Add a diagram, sketch or chart' : 'Choose a page first'} className={cx(pill, 'hidden md:flex')}>
          <PenTool size={15} /> Diagram
        </button>
        <button type="button" onClick={() => ui({ modal: 'claude' })} title="Claude Connector" className={cx(pill, 'flex')}>
          <span className="relative flex items-center"><Bot size={16} /><span className={cx('absolute -top-0.5 -right-1 w-2 h-2 rounded-full ring-2 ring-panel', STATUS_DOT[claudeStatus])} /></span>
          <span className="hidden sm:inline">{claudeBusy ? 'Working…' : 'Claude'}</span>
        </button>
        <button
          type="button"
          onClick={() => ui({ modal: 'export' })}
          disabled={!exportReady}
          title={exportReady ? 'Export PDF or images (Ctrl+S)' : 'Choose a page and add text first'}
          className="btn-primary h-9 px-3.5 rounded-[10px] text-[13px] font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none"
        >
          <Download size={15} /> Export{exportReady && pages.length > 1 ? <span className="tabular-nums opacity-80">· {pages.length}</span> : null}
        </button>
        <span className="hidden sm:block w-px h-5 bg-surface-200 mx-1" />
        <ThemeSwitch />
        <button type="button" className={cx(iconBtn, "inline-flex")} onClick={() => ui({ modal: "guide" })} aria-label="Guide" title="Guide"><HelpCircle size={17} /></button>
        <button
          type="button"
          className={cx(iconBtn, 'hidden lg:inline-flex')}
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}
          aria-label={full ? 'Exit full screen' : 'Full screen'}
          title={full ? 'Exit full screen' : 'Full screen'}
        >
          {full ? <Minimize size={17} /> : <Maximize size={17} />}
        </button>
        <button
          type="button"
          className={cx(iconBtn, 'hidden sm:inline-flex')}
          onClick={() => { if (window.confirm('Start a new document? The page, text and settings will be cleared. You can undo this.')) resetDoc(); }}
          aria-label="New document"
          title="New document (undoable)"
        >
          <RotateCcw size={16} />
        </button>
      </div>
    </header>
  );
}
