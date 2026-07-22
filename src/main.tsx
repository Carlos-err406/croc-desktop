import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app';

// Latin + latin-ext only (covers English + Western-European accented filenames);
// the full CSS also pulls in cyrillic/greek/vietnamese subsets we don't need.
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-ext-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-ext-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-ext-600.css';
import '@fontsource/poppins/latin-700.css';
import '@fontsource/poppins/latin-ext-700.css';
import '@fontsource/oswald/latin-500.css';
import '@fontsource/oswald/latin-ext-500.css';
import '@fontsource/oswald/latin-600.css';
import '@fontsource/oswald/latin-ext-600.css';
import '@fontsource/oswald/latin-700.css';
import '@fontsource/oswald/latin-ext-700.css';
import './styles.css';

import { applyTheme, getTheme } from '@/lib/prefs';

// Apply the saved theme before first paint.
applyTheme(getTheme());

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
