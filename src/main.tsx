// Entry point. Vite calls this first.
// We mount a single React component (<App />) into the #root div in index.html.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
