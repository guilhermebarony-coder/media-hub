import { useEffect, useRef, useState } from "react";
import { Icon } from "../lib/icons";
import { LANGS, useLang } from "../lib/i18n";

/**
 * Compact language switcher for the top bar: a globe button showing the
 * current language code; click opens a small menu of available languages.
 * Adding a language to LANGS (lib/i18n) makes it appear here automatically.
 */
export function LanguagePicker() {
  const { lang, setLang, t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="lang-picker" ref={ref}>
      <button
        type="button"
        className="ic-btn lang-picker-btn"
        onClick={() => setOpen((v) => !v)}
        title={t("lang.label")}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon.globe width={14} height={14} />
        <span className="lang-picker-code">{lang.toUpperCase()}</span>
      </button>
      {open && (
        <div className="lang-menu" role="listbox">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              role="option"
              aria-selected={l.code === lang}
              className={"lang-menu-item" + (l.code === lang ? " active" : "")}
              onClick={() => {
                setLang(l.code);
                setOpen(false);
              }}
            >
              <span className="lang-menu-code mono">{l.code.toUpperCase()}</span>
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
