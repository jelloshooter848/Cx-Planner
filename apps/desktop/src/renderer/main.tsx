import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import './tokens.css';
import './styles.css';
import { App } from './App';
import { storageLayoutStore } from './layout-prefs';
import { createStore, StoreProvider } from './store';

const store = createStore(window.cx, { exit: () => window.close(), layout: storageLayoutStore() });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider store={store}>
      <App />
    </StoreProvider>
  </StrictMode>,
);
