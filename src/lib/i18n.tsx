import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en } from "../locales/en";
import { pt } from "../locales/pt";

// Lightweight, dependency-free i18n. Flat string keys, per-language
// dictionaries, English as the fallback. Language is remembered in
// localStorage (frontend-only — no Rust/settings round-trip) and defaults to
// the browser locale on first run. Adding a language = add a dictionary +
// an entry in LANGS + a line in DICTS.

export type Lang = "en" | "pt";

export const LANGS: { code: Lang; label: string; wip?: boolean }[] = [
  { code: "en", label: "English" },
  // Portuguese is a work in progress — most of the app is translated, but a
  // few pages still fall back to English. The `wip` flag surfaces a small
  // marker in the picker so users know. Drop it once coverage is complete.
  { code: "pt", label: "Português", wip: true },
];

const DICTS: Record<Lang, Record<string, string>> = { en, pt };
const STORAGE_KEY = "mh.lang";

type I18nCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Translate a key. Falls back to English, then to the provided fallback,
   *  then to the key itself — so a missing translation is never a crash. */
  t: (key: string, fallback?: string) => string;
};

const LangContext = createContext<I18nCtx | null>(null);

function detectInitial(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "pt") return saved;
  } catch {
    /* localStorage blocked — fall through to detection */
  }
  const nav = (navigator.language || "").toLowerCase();
  if (nav.startsWith("pt")) return "pt";
  return "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(detectInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18nCtx>(() => {
    const dict = DICTS[lang];
    const t = (key: string, fallback?: string) =>
      dict[key] ?? en[key] ?? fallback ?? key;
    return { lang, setLang, t };
  }, [lang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): I18nCtx {
  const ctx = useContext(LangContext);
  if (!ctx) {
    // Defensive fallback so a component rendered outside the provider (or in
    // isolation) still works in English rather than throwing.
    return {
      lang: "en",
      setLang: () => {},
      t: (key: string, fallback?: string) => en[key] ?? fallback ?? key,
    };
  }
  return ctx;
}

/** Convenience hook when you only need the translate function. */
export function useT() {
  return useLang().t;
}
