import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { restoreCustomFonts } from './engine/fontLoader';
import { hydrateSavedAssets } from './state/store';
import './index.css';

restoreCustomFonts();

// Restore saved page photos/diagrams from IndexedDB before the first render (avoids a broken-image flash).
hydrateSavedAssets()
  .catch(() => undefined)
  .finally(() =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
