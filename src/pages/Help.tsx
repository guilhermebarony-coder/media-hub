import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Icon } from "../lib/icons";
import { getHelpContent, type HelpEntry } from "../lib/helpContent";

/**
 * Help / Manual page. Searchable, grouped by screen, with stable per-entry
 * anchors so the planned per-button (?) icons can deep-link straight to a
 * section via /help#<entry-id> (see docs/MANUAL.md + lib/helpContent.ts).
 *
 * Kept-alive by the Shell like every other page, so the hash-scroll effect
 * also listens to `hashchange` — re-clicking a (?) link while Help is
 * already mounted still jumps + flashes the target.
 */
export default function HelpPage() {
  const [query, setQuery] = useState("");
  const location = useLocation();
  const bodyRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Locale-driven content. English today; getHelpContent falls back to en
  // for any unknown locale, so wiring an app language later is a one-liner.
  const { categories, entries } = getHelpContent();

  const q = query.trim().toLowerCase();
  const tokens = q ? q.split(/\s+/) : [];

  // Filtered entries. A query matches when every token appears somewhere in
  // the title, keywords, or body — so people can search by the words they'd
  // actually use, not just the exact button label.
  const filtered = useMemo<HelpEntry[]>(() => {
    if (tokens.length === 0) return entries;
    return entries.filter((e) => {
      const hay = (
        e.title +
        " " +
        e.keywords.join(" ") +
        " " +
        e.body.join(" ") +
        (e.tip ? " " + e.tip : "")
      ).toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [tokens, entries]);

  // Group filtered entries back under their categories, preserving order.
  const grouped = useMemo(() => {
    return categories.map((cat) => ({
      cat,
      entries: filtered.filter((e) => e.category === cat.id),
    })).filter((g) => g.entries.length > 0);
  }, [filtered, categories]);

  // Deep-link: scroll to #<id> and flash it. Runs on hash change and when
  // the search is cleared (so a (?) target that was filtered out reappears).
  useEffect(() => {
    function jump() {
      const id = decodeURIComponent(location.hash.replace(/^#/, ""));
      if (!id) return;
      const el = document.getElementById(`help-${id}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("help-flash");
      window.setTimeout(() => el.classList.remove("help-flash"), 1600);
    }
    // Defer a tick so the target exists after any filter re-render.
    const t = window.setTimeout(jump, 30);
    window.addEventListener("hashchange", jump);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("hashchange", jump);
    };
  }, [location.hash, q]);

  // Focus search on "/" (common help-page convention), unless already typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      if (el instanceof HTMLElement) {
        const tag = el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable)
          return;
      }
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function jumpToCategory(id: string) {
    const el = document.getElementById(`help-cat-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const totalCount = entries.length;
  const searching = tokens.length > 0;

  return (
    <div className="content">
      <div className="content-header">
        <div className="ch-title">Help &amp; Manual</div>
        <span className="ch-meta">
          {searching ? `${filtered.length} / ${totalCount} topics` : `${totalCount} topics`}
        </span>
        <div className="ch-spacer" />
        <span className="mono faint" style={{ fontSize: 11 }}>
          press / to search
        </span>
      </div>

      <div className="content-body" ref={bodyRef}>
        <div className="help">
          {/* Search — full-bleed opaque sticky bar so scrolled content
              can't peek through around/under it. */}
          <div className="help-searchbar">
            <div className="help-search">
              <Icon.search width={15} height={15} />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search help — try “mp3”, “cookies”, “laggy preview”, “delete”…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              {query && (
                <button
                  type="button"
                  className="help-search-clear"
                  onClick={() => setQuery("")}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className={"help-layout" + (searching ? " flat" : "")}>
            {/* Category jump nav — hidden while searching (flat results). */}
            {!searching && (
              <nav className="help-nav">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="help-nav-item"
                    onClick={() => jumpToCategory(c.id)}
                  >
                    {c.title}
                  </button>
                ))}
              </nav>
            )}

            <div className="help-sections">
              {grouped.length === 0 && (
                <div className="help-empty">
                  <Icon.help width={22} height={22} />
                  <p>No topics match “{query}”.</p>
                  <button type="button" className="btn btn-secondary" onClick={() => setQuery("")}>
                    Clear search
                  </button>
                </div>
              )}

              {grouped.map(({ cat, entries }) => (
                <section key={cat.id} className="help-group" id={`help-cat-${cat.id}`}>
                  <h2 className="help-group-title">{cat.title}</h2>
                  {cat.blurb && !searching && <p className="help-group-blurb">{cat.blurb}</p>}
                  {entries.map((e) => (
                    <article key={e.id} id={`help-${e.id}`} className="help-entry">
                      <div className="help-entry-head">
                        <h3>{e.title}</h3>
                        {e.shortcut && <span className="kbd">{e.shortcut}</span>}
                      </div>
                      {e.body.map((p, i) => (
                        <p key={i} className="help-p">
                          {p}
                        </p>
                      ))}
                      {e.tip && (
                        <p className="help-tip">
                          <strong>Tip</strong> {e.tip}
                        </p>
                      )}
                    </article>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
