import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export type Theme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
export type ColorScheme = 'default' | 'coffee' | 'outdoor';

export const theme = writable<Theme>('system');
export const colorScheme = writable<ColorScheme>('default');
/** Tracks the OS preference for "system" mode. */
const systemPrefersDark = writable(true);

/** The actual theme applied — always 'dark' or 'light'. */
export const resolvedTheme = derived(
  [theme, systemPrefersDark],
  ([$theme, $sysDark]) => {
    if ($theme === 'system') return $sysDark ? 'dark' : 'light';
    return $theme as ResolvedTheme;
  },
);

let mediaQuery: MediaQueryList | null = null;

function applyTheme(resolved: ResolvedTheme) {
  document.body.setAttribute('data-theme', resolved);
}

function applyColorScheme(scheme: ColorScheme) {
  document.body.setAttribute('data-color-scheme', scheme);
}

function resolve(t: Theme): ResolvedTheme {
  if (t === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return t;
}

export async function loadTheme() {
  try {
    const [t, cs] = await Promise.all([
      invoke<string>('get_theme'),
      invoke<string>('get_color_scheme'),
    ]);
    theme.set(t as Theme);
    colorScheme.set(cs as ColorScheme);
    systemPrefersDark.set(window.matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(resolve(t as Theme));
    applyColorScheme(cs as ColorScheme);
    setupMediaListener(t as Theme);
  } catch {
    applyTheme(resolve('system'));
    applyColorScheme('default');
  }
}

export async function setTheme(t: Theme) {
  theme.set(t);
  applyTheme(resolve(t));
  setupMediaListener(t);
  await invoke('set_theme', { theme: t });
}

export async function setColorScheme(cs: ColorScheme) {
  colorScheme.set(cs);
  applyColorScheme(cs);
  await invoke('set_color_scheme', { colorScheme: cs });
}

function setupMediaListener(t: Theme) {
  if (mediaQuery) {
    mediaQuery.removeEventListener('change', onSystemChange);
    mediaQuery = null;
  }
  if (t === 'system') {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', onSystemChange);
  }
}

function onSystemChange(e: MediaQueryListEvent) {
  systemPrefersDark.set(e.matches);
  applyTheme(e.matches ? 'dark' : 'light');
}
