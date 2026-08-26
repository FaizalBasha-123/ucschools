'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialize from the data attributes written by the blocking inline script
  // in layout.tsx. This runs before React hydration, so we read the already-
  // applied theme to avoid a flash of incorrect theme on mount.
  const [theme, setThemeState] = useState<Theme>('system');
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>('light');
  const [hydrated, setHydrated] = useState(false);

  const resolvedTheme = theme === 'system' ? systemTheme : theme;

  // Hydrate from the DOM attributes set by the inline script.
  // The inline script in <head> runs before paint and writes:
  //   data-theme      = 'light' | 'dark' | 'system'
  //   data-resolved-theme = 'light' | 'dark'
  // Reading these avoids re-reading localStorage (which could diverge) and
  // ensures React's state matches what the browser already rendered.
  /* eslint-disable react-hooks/set-state-in-effect -- Hydration from DOM must happen in effect */
  useEffect(() => {
    const root = document.documentElement;
    const stored = (root.getAttribute('data-theme') || localStorage.getItem('theme')) as Theme | null;
    if (stored && ['light', 'dark', 'system'].includes(stored)) {
      setThemeState(stored);
    }
    const resolvedAttr = root.getAttribute('data-resolved-theme') as 'light' | 'dark' | null;
    if (resolvedAttr === 'dark' || resolvedAttr === 'light') {
      setSystemTheme(resolvedAttr);
    } else {
      setSystemTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
    setHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Apply theme to document — only after hydration so we don't fight the
  // inline script's pre-paint class. Before hydration, the inline script
  // has already set the correct class.
  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    // Keep data attributes in sync for any future inline-script reads.
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-resolved-theme', resolvedTheme);
  }, [resolvedTheme, theme, hydrated]);

  // Listen to system theme changes (only relevant when theme === 'system')
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Save theme to localStorage
  const handleSetTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
    // Update data attribute immediately so the inline script reads the
    // correct value on next hard refresh / navigation.
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: handleSetTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
