export type Theme = 'light' | 'dark';
export type RelayMode = 'default' | 'custom';

export interface Prefs {
  theme: Theme;
  revealOnDone: boolean;
  relay: RelayMode;
  relayCustom: string;
}

const KEY = 'croc.prefs';
const DEFAULTS: Prefs = { theme: 'light', revealOnDone: true, relay: 'default', relayCustom: '' };

function read(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return DEFAULTS;
  }
}

function write(patch: Partial<Prefs>): Prefs {
  const next = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function getPrefs(): Prefs {
  return read();
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  return write(patch);
}

export function getTheme(): Theme {
  return read().theme;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function setTheme(theme: Theme): void {
  write({ theme });
  applyTheme(theme);
}
