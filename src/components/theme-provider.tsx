import React, {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_THEME_SCHEME,
  isThemeScheme,
  type ThemeScheme,
} from "@/config/themeSchemes";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  defaultScheme?: ThemeScheme;
  storageKey?: string;
}

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  scheme: ThemeScheme;
  setTheme: (theme: Theme, event?: React.MouseEvent) => void;
  setScheme: (scheme: ThemeScheme, event?: React.MouseEvent) => void;
}

const ThemeProviderContext = createContext<ThemeContextValue | undefined>(
  undefined,
);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  defaultScheme = DEFAULT_THEME_SCHEME,
  storageKey = "cc-switch-theme",
}: ThemeProviderProps) {
  const getInitialTheme = () => {
    if (typeof window === "undefined") {
      return defaultTheme;
    }

    const stored = window.localStorage.getItem(storageKey) as Theme | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }

    return defaultTheme;
  };

  const getInitialSystemTheme = (): ResolvedTheme => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return "light";
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  };

  const getInitialScheme = () => {
    if (typeof window === "undefined") {
      return defaultScheme;
    }

    const stored = window.localStorage.getItem(`${storageKey}-scheme`);
    return isThemeScheme(stored) ? stored : defaultScheme;
  };

  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [scheme, setSchemeState] = useState<ThemeScheme>(getInitialScheme);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(
    getInitialSystemTheme,
  );
  const resolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(storageKey, theme);
  }, [theme, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
    root.dataset.themeScheme = scheme;
  }, [resolvedTheme, scheme]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      setSystemTheme(mediaQuery.matches ? "dark" : "light");
    };

    handleChange();

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(`${storageKey}-scheme`, scheme);
  }, [scheme, storageKey]);

  const applyVisualTransition = useCallback(
    (updater: () => void, event?: React.MouseEvent) => {
      const x = event?.clientX ?? window.innerWidth / 2;
      const y = event?.clientY ?? window.innerHeight / 2;
      document.documentElement.style.setProperty(
        "--theme-transition-x",
        `${x}px`,
      );
      document.documentElement.style.setProperty(
        "--theme-transition-y",
        `${y}px`,
      );

      if (document.startViewTransition) {
        document.startViewTransition(() => {
          updater();
        });
        return;
      }

      updater();
    },
    [],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      scheme,
      setTheme: (nextTheme: Theme, event?: React.MouseEvent) => {
        if (nextTheme === theme) return;
        applyVisualTransition(() => setThemeState(nextTheme), event);
      },
      setScheme: (nextScheme: ThemeScheme, event?: React.MouseEvent) => {
        if (nextScheme === scheme) return;
        applyVisualTransition(() => setSchemeState(nextScheme), event);
      },
    }),
    [applyVisualTransition, resolvedTheme, scheme, theme],
  );

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
