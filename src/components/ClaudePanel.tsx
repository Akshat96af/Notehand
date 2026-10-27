// Claude Connector sheet: access switch for the MCP bridge, connection status, setup and activity log.
import { Bot, Check, ChevronRight, Copy } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_BRIDGE_PORT, setBridgePrefs, useBridge } from '../lib/claudeBridge';
import { useStore } from '../state/store';
import { CloseButton, Modal, Segmented, Toggle, cx } from './ui';

const SERVER = `${__NOTEHAND_DIR__}/mcp/server.mjs`;
const EXAMPLE = 'Using Notehand, write a five-question physics assignment on Newton’s laws with a labelled free-body diagram, then export it as a PDF.';

export const STATUS_LABEL = { off: 'Off', waiting: 'Waiting for Claude', connected: 'Connected' } as const;
export const STATUS_DOT = { off: 'bg-surface-300', waiting: 'bg-amber-400 animate-pulse', connected: 'bg-emerald-500' } as const;

function CopyField({ text, mono = true }: { text: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = () => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1600); }).catch(() => {});
  return (
    <div className={cx('flex items-start gap-2 rounded-xl p-1.5 pl-3', mono ? 'bg-night-950 text-white/90' : 'bg-surface-100 text-surface-800')}>
      <p className={cx('flex-1 min-w-0 py-1.5 text-[12px] leading-relaxed break-words', mono && 'font-mono')}>{text}</p>
      <button type="button" onClick={copy} aria-label={done ? 'Copied' : 'Copy'} title={done ? 'Copied' : 'Copy'}
        className={cx('shrink-0 h-8 px-2.5 rounded-lg text-[12px] font-semibold flex items-center gap-1.5 cursor-pointer', mono ? 'bg-white/10 hover:bg-white/15 text-white' : 'btn-secondary')}>
        {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[24px_1fr] gap-3">
      <span className="w-6 h-6 rounded-full bg-surface-100 text-surface-700 text-[12px] font-semibold flex items-center justify-center tabular-nums">{n}</span>
      <div className="min-w-0 space-y-2 pt-0.5">
        <div className="text-[13px] font-semibold text-surface-900">{title}</div>
        {children}
      </div>
    </li>
  );
}

export default function ClaudePanel() {
  const open = useStore((s) => s.modal === 'claude');
  const enabled = useBridge((s) => s.enabled);
  const port = useBridge((s) => s.port);
  const status = useBridge((s) => s.status);
  const busy = useBridge((s) => s.busy);
  const log = useBridge((s) => s.log);
  const [client, setClient] = useState<'code' | 'desktop'>('code');
  const close = () => useStore.getState().ui({ modal: null });
  const custom = port !== DEFAULT_BRIDGE_PORT;
  const codeCmd = `claude mcp add notehand${custom ? ` -e NOTEHAND_BRIDGE_PORT=${port}` : ''} -- node "${SERVER}"`;
  const desktopCfg = JSON.stringify({ mcpServers: { notehand: { command: 'node', args: [SERVER], ...(custom ? { env: { NOTEHAND_BRIDGE_PORT: String(port) } } : {}) } } });
  const statusText = busy ? 'Working' : STATUS_LABEL[status];

  return (
    <Modal open={open} onClose={close} wide label="Claude Connector">
      <div className="p-6 sm:p-7 space-y-6">
        <header className="flex items-start gap-4">
          <span className="w-11 h-11 rounded-[13px] bg-surface-900 text-surface-50 flex items-center justify-center shrink-0 shadow-sm"><Bot size={22} /></span>
          <div className="flex-1 min-w-0">
            <h3 className="text-[19px] font-semibold text-surface-900">Claude Connector</h3>
            <p className="mt-0.5 text-[13px] text-surface-500">Let Claude compose, format and export documents directly in this editor.</p>
          </div>
          <CloseButton onClick={close} />
        </header>

        <section className="rounded-2xl border border-surface-200 bg-panel">
          <div className="flex items-center gap-4 p-4">
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-surface-900">Editor access</div>
              <p className="mt-0.5 text-[12px] text-surface-500 leading-relaxed">Claude can read and edit the document and save exports to your computer. You can turn access off at any time.</p>
            </div>
            <Toggle label="Editor access" checked={enabled} onChange={(v) => setBridgePrefs({ enabled: v })} />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-surface-200 px-4 py-2.5 text-[12px]">
            <span className="flex items-center gap-2 font-medium text-surface-700" aria-live="polite">
              <span className={cx('w-2 h-2 rounded-full', busy ? 'bg-brand-500 animate-pulse' : STATUS_DOT[status])} /> {statusText}
            </span>
            <span className="text-surface-500 tabular-nums">127.0.0.1:{port}</span>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-[13px] font-semibold text-surface-900">Set up</h4>
            <Segmented size="sm" value={client} onChange={setClient} options={[{ value: 'code', label: 'Claude Code' }, { value: 'desktop', label: 'Claude Desktop' }]} />
          </div>
          <ol className="space-y-4">
            <Step n={1} title={client === 'code' ? 'Register the Notehand server' : 'Add Notehand to the Desktop config'}>
              <p className="text-[12px] text-surface-500">{client === 'code' ? 'Run this once in a terminal.' : 'Settings › Developer › Edit Config, add this entry to claude_desktop_config.json, then restart Claude Desktop.'}</p>
              <CopyField text={client === 'code' ? codeCmd : desktopCfg} />
            </Step>
            <Step n={2} title="Turn on editor access">
              <p className="text-[12px] text-surface-500">Use the switch above. The status changes to Connected once Claude starts the server.</p>
            </Step>
            <Step n={3} title="Ask Claude">
              <CopyField text={EXAMPLE} mono={false} />
            </Step>
          </ol>
        </section>

        <details className="group rounded-xl border border-surface-200 px-4 py-3 text-[12px] text-surface-600">
          <summary className="flex items-center gap-1.5 cursor-pointer list-none font-semibold text-surface-800 [&::-webkit-details-marker]:hidden">
            <ChevronRight size={14} className="transition-transform group-open:rotate-90" /> Advanced
          </summary>
          <label className="mt-3 flex flex-wrap items-center gap-2">
            <span className="font-medium text-surface-700">Connection port</span>
            <input type="number" min={1024} max={65535} value={port}
              onChange={(e) => { const v = Number(e.target.value); if (v >= 1024 && v <= 65535) setBridgePrefs({ port: v }); }}
              className="w-24 h-8 px-2 rounded-lg border border-surface-200 bg-panel text-surface-900 tabular-nums" />
            <span className="text-surface-500">Must match NOTEHAND_BRIDGE_PORT. Only connections from this computer are accepted.</span>
          </label>
        </details>

        <section>
          <h4 className="text-[13px] font-semibold text-surface-900">Activity</h4>
          {log.length === 0 ? (
            <p className="mt-2 text-[12px] text-surface-500">No activity yet. Actions Claude takes in this editor appear here.</p>
          ) : (
            <ul className="mt-2 max-h-48 overflow-y-auto scroll-thin rounded-xl border border-surface-200 divide-y divide-surface-200 text-[12px]">
              {log.map((l, i) => (
                <li key={i} className="px-3 py-2 flex gap-3">
                  <span className="text-surface-500 tabular-nums shrink-0">{new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  <span className={cx('min-w-0 break-words', l.ok ? 'text-surface-800' : 'text-red-600')}>{l.note}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
