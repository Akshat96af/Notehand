import { Component, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useTheme } from './lib/theme';
import EditorPage from './pages/EditorPage';
import HomePage from './pages/HomePage';

/** Last line of defence: a render error shows a recovery screen instead of a blank page. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('[notehand] render error', error); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const reset = () => {
      if (!window.confirm('Start a new document? The current text, page and settings will be removed from this browser.')) return;
      try { localStorage.removeItem('notehand.doc.v1'); } catch { /* nothing to clear */ }
      location.reload();
    };
    return (
      <div className="min-h-full flex items-center justify-center p-6 bg-canvas">
        <div className="w-full max-w-md rounded-[22px] bg-elevated shadow-sheet ring-1 ring-black/[0.05] dark:ring-white/[0.08] p-7">
          <h1 className="text-[19px] font-semibold text-surface-900">Notehand stopped unexpectedly</h1>
          <p className="mt-2 text-[14px] text-surface-500 leading-relaxed">Your document is saved in this browser. Reloading usually fixes this.</p>
          <details className="mt-4 text-[12px] text-surface-500"><summary className="cursor-pointer font-medium">Details</summary><pre className="mt-2 whitespace-pre-wrap break-words">{error.message}</pre></details>
          <div className="mt-6 flex gap-2">
            <button type="button" onClick={() => location.reload()} className="btn-primary flex-1 h-10 rounded-xl text-[14px] font-semibold cursor-pointer">Reload</button>
            <button type="button" onClick={reset} className="btn-secondary flex-1 h-10 rounded-xl text-[14px] font-semibold cursor-pointer">New document</button>
          </div>
        </div>
      </div>
    );
  }
}

export default function App() {
  const theme = useTheme();
  return (
    <ErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Toaster position="top-center" theme={theme} richColors closeButton toastOptions={{ style: { borderRadius: 14 } }} />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/editor" element={<EditorPage />} />
          {/* Only the Assignment Studio exists in this build, so the studio chooser goes straight to it. */}
          <Route path="/create" element={<Navigate to="/editor" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
