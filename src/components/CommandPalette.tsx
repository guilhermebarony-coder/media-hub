// Media Hub — Command Palette (1.3.x).
//
// Global search modal triggered by Ctrl+Space (or click of the topbar
// search button). Inspired by Eagle's command palette — same
// keyboard-driven shape so editors who've been using Eagle for years
// don't have to re-learn anything.
//
// v2 scope (Option B, 1.3.x): three tabs along the top.
//   - Clips     — search asset titles / channels / tags via
//                 library_list. Enter plays in OS default app;
//                 Ctrl+Enter reveals in folder; Shift+Enter jumps
//                 Library to the asset.
//   - Projects  — search project names. Enter switches the active
//                 scope and navigates to /library.
//   - Tags      — search tag names. Enter applies that tag as a
//                 filter on /library and navigates there.
// Tab key cycles tabs forward, Shift+Tab cycles back. Clicking a
// tab does the same.
//
// Wiring strategy:
//   - This component renders nothing when closed (parent gates by
//     `open` prop).
//   - On Enter (Clips tab), dispatch a "mh:open-asset" CustomEvent
//     the Library page listens for.
//   - On Enter (Tags tab), dispatch "mh:apply-tag-filter".
//   - Projects use the activeProject context directly (setScope) so
//     no extra event channel is needed.
//   - Cross-route navigation is always navigate("/library") AFTER
//     dispatch so the keep-alive page handles state changes in
//     place when already mounted.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "../lib/icons";
import { thumbnailSrc, revealFile, openFileInDefaultApp } from "../lib/library";
import { useActiveProject } from "../lib/activeProject";
import type {
  Asset,
  LibraryFilters,
  Project,
  TagCount,
} from "../lib/types";
import { fmtDuration, fmtBytes } from "../lib/format";

/** Window-level event payload — the Library page listens for this and
 *  scopes / selects / scrolls to the asset. */
export type OpenAssetDetail = {
  assetId: string;
  /** Asset's project id (null = Library scope). The Library handler
   *  switches the active scope to match before selecting. */
  projectId: string | null;
};
export const OPEN_ASSET_EVENT = "mh:open-asset";

/** 1.3.x — Tags tab Enter handler. Library listens, replaces its
 *  activeTags set with the single tag, navigates not needed (this
 *  fires together with navigate("/library") at the call site). */
export type ApplyTagFilterDetail = { tag: string };
export const APPLY_TAG_FILTER_EVENT = "mh:apply-tag-filter";

type PaletteTab = "clips" | "projects" | "tags";
const TAB_ORDER: PaletteTab[] = ["clips", "projects", "tags"];

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<PaletteTab>("clips");
  const [query, setQuery] = useState("");
  const [clipResults, setClipResults] = useState<Asset[]>([]);
  const [tagResults, setTagResults] = useState<TagCount[]>([]);
  const [allTags, setAllTags] = useState<TagCount[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const navigate = useNavigate();
  // Project list cached at the app level — we use it both for the
  // Projects tab results and to resolve project_id → human-readable
  // name for the Clips tab's scope chip. No extra fetch needed.
  const { projects, setScope } = useActiveProject();
  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

  // Filter projects + tags client-side. Both collections are small
  // (< 100 items each in practice), so an in-memory substring filter
  // is faster than a backend round-trip per keystroke.
  const projectResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  // Reset when (re)opened. Clear stale query + results; refocus input.
  // Default to the Clips tab — most common entry point.
  useEffect(() => {
    if (!open) return;
    setTab("clips");
    setQuery("");
    setClipResults([]);
    setSelectedIdx(0);
    // Wait a tick so the input is in the DOM before focusing.
    queueMicrotask(() => inputRef.current?.focus());
    // Tags list is small (< 200 items in practice), fetch once on
    // open so the Tags tab is responsive when the user switches.
    void invoke<TagCount[]>("tag_list_all")
      .then((tags) => setAllTags(tags))
      .catch((e) => console.warn("[palette] tag_list_all failed:", e));
  }, [open]);

  // Whenever the tab changes, reset selection to top and refocus input
  // (Tab key would otherwise blur it into the tab strip).
  useEffect(() => {
    if (!open) return;
    setSelectedIdx(0);
    inputRef.current?.focus();
  }, [tab, open]);

  // Clips search — only fires on the Clips tab. 200ms debounce so the
  // user can type "pinterest pin" without firing 14 backend calls.
  useEffect(() => {
    if (!open || tab !== "clips") return;
    const trimmed = query.trim();
    if (!trimmed) {
      setClipResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const filters: LibraryFilters = {
          query: trimmed,
          scope: { kind: "any" }, // search the whole library + every project
          limit: 50,
          trashed: false,
        };
        const list = await invoke<Asset[]>("library_list", { filters });
        setClipResults(list);
        setSelectedIdx(0);
      } catch (e) {
        console.warn("[palette] search failed:", e);
        setClipResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open, tab]);

  // Tags filter — client-side substring against the cached list.
  useEffect(() => {
    if (!open || tab !== "tags") return;
    const q = query.trim().toLowerCase();
    setTagResults(q ? allTags.filter((t) => t.name.toLowerCase().includes(q)) : allTags);
    setSelectedIdx(0);
  }, [query, open, tab, allTags]);

  /**
   * Primary action — open the clip in the OS's default app (mpv,
   * Premiere, etc.). Bound to Enter, click, and Ctrl-click on a row.
   * Closes the palette after firing so the user can keep typing
   * fresh searches without manually dismissing.
   */
  const playAsset = useCallback(
    (asset: Asset) => {
      void openFileInDefaultApp(asset.file_path);
      onClose();
    },
    [onClose],
  );

  /**
   * Secondary action — jump the Library page to this asset (scope-
   * switch + select + scroll-into-view). Bound to Shift+Enter and
   * the right-arrow row button. Useful when you want to look at
   * sibling clips or apply tag/folder edits.
   */
  const showAssetInLibrary = useCallback(
    (asset: Asset) => {
      const detail: OpenAssetDetail = {
        assetId: asset.id,
        projectId: asset.project_id ?? null,
      };
      window.dispatchEvent(new CustomEvent(OPEN_ASSET_EVENT, { detail }));
      navigate("/library");
      onClose();
    },
    [navigate, onClose],
  );

  /**
   * Tertiary action — open the OS file manager pointing at the file.
   * Bound to the small folder button on each row.
   */
  const revealAsset = useCallback(
    (asset: Asset) => {
      void revealFile(asset.file_path).catch((err) =>
        console.warn("[palette] revealFile failed:", err),
      );
      onClose();
    },
    [onClose],
  );

  /**
   * Projects tab — switch active scope to the picked project then
   * navigate to /library so the user can see its clips.
   */
  const openProject = useCallback(
    (project: Project) => {
      setScope({ kind: "project", id: project.id, name: project.name });
      navigate("/library");
      onClose();
    },
    [navigate, onClose, setScope],
  );

  /**
   * Tags tab — apply the tag as a filter on the Library page and
   * navigate there. Library's listener REPLACES its activeTags set
   * (not adds), so picking a tag from the palette is "show me only
   * this tag", not "and-also this tag".
   */
  const applyTagFilter = useCallback(
    (tag: TagCount) => {
      const detail: ApplyTagFilterDetail = { tag: tag.name };
      window.dispatchEvent(new CustomEvent(APPLY_TAG_FILTER_EVENT, { detail }));
      navigate("/library");
      onClose();
    },
    [navigate, onClose],
  );

  // Current tab's result length — used by ArrowUp/Down clamping.
  const currentLen =
    tab === "clips"
      ? clipResults.length
      : tab === "projects"
        ? projectResults.length
        : tagResults.length;

  const cycleTab = useCallback(
    (dir: 1 | -1) => {
      setTab((cur) => {
        const i = TAB_ORDER.indexOf(cur);
        const next = (i + dir + TAB_ORDER.length) % TAB_ORDER.length;
        return TAB_ORDER[next];
      });
    },
    [],
  );

  // Keyboard nav. Bound on the input so it doesn't compete with the
  // global Ctrl+Space handler at the Shell level.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      // Tab / Shift+Tab cycle tabs. Browser default Tab would blur
      // the input → kill the typing flow.
      if (e.key === "Tab") {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, Math.max(0, currentLen - 1)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (tab === "clips") {
          const target = clipResults[selectedIdx];
          if (!target) return;
          if (e.shiftKey) return showAssetInLibrary(target);
          if (e.ctrlKey || e.metaKey) return revealAsset(target);
          return playAsset(target);
        }
        if (tab === "projects") {
          const proj = projectResults[selectedIdx];
          if (proj) openProject(proj);
          return;
        }
        if (tab === "tags") {
          const t = tagResults[selectedIdx];
          if (t) applyTagFilter(t);
          return;
        }
      }
    },
    [
      onClose,
      cycleTab,
      currentLen,
      tab,
      clipResults,
      projectResults,
      tagResults,
      selectedIdx,
      playAsset,
      revealAsset,
      showAssetInLibrary,
      openProject,
      applyTagFilter,
    ],
  );

  // Scroll the highlighted row into view when arrows move past the
  // visible window. Use scrollIntoView with block: nearest so we
  // never overshoot or fight the user's manual scroll.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLLIElement>(
      `li[data-idx='${selectedIdx}']`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx, open]);

  // Helpful hint footer adapts to selection state + active tab so
  // the user sees the right shortcuts for what they're picking.
  const hint = useMemo(() => {
    const tabHint = "Tab to switch tabs";
    if (tab === "clips") {
      if (!query.trim()) return `Start typing to search clips. ${tabHint}.`;
      if (loading) return "searching…";
      if (clipResults.length === 0) return `No clips match "${query}". ${tabHint}.`;
      return `${clipResults.length} match${clipResults.length === 1 ? "" : "es"} · ↵ play · Ctrl ↵ reveal · ⇧↵ show in library · ${tabHint}`;
    }
    if (tab === "projects") {
      if (projectResults.length === 0)
        return query.trim()
          ? `No projects match "${query}". ${tabHint}.`
          : `No projects yet. ${tabHint}.`;
      return `${projectResults.length} project${projectResults.length === 1 ? "" : "s"} · ↵ switch & open · ${tabHint}`;
    }
    // tags
    if (tagResults.length === 0)
      return query.trim()
        ? `No tags match "${query}". ${tabHint}.`
        : `No tags yet — tag some clips in the library. ${tabHint}.`;
    return `${tagResults.length} tag${tagResults.length === 1 ? "" : "s"} · ↵ filter library · ${tabHint}`;
  }, [tab, query, loading, clipResults.length, projectResults.length, tagResults.length]);

  if (!open) return null;

  return (
    <div
      className="cmdp-backdrop"
      onClick={(e) => {
        // Click outside the modal closes it; clicks inside do nothing.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmdp-modal" role="dialog" aria-label="Command palette">
        <div className="cmdp-input-row">
          <Icon.search width={14} height={14} />
          <input
            ref={inputRef}
            type="text"
            className="cmdp-input"
            placeholder={
              tab === "clips"
                ? "Search clips…"
                : tab === "projects"
                  ? "Search projects…"
                  : "Search tags…"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            className="cmdp-close"
            onClick={onClose}
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        <div className="cmdp-tabs" role="tablist">
          {TAB_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              className={"cmdp-tab" + (tab === t ? " active" : "")}
              aria-selected={tab === t}
              onClick={() => {
                setTab(t);
                inputRef.current?.focus();
              }}
            >
              {t === "clips" ? "Clips" : t === "projects" ? "Projects" : "Tags"}
              <span className="cmdp-tab-count mono">
                {t === "clips"
                  ? clipResults.length
                  : t === "projects"
                    ? projectResults.length
                    : tagResults.length}
              </span>
            </button>
          ))}
        </div>

        {tab === "clips" && clipResults.length > 0 && (
          <ul className="cmdp-list" ref={listRef}>
            {clipResults.map((a, i) => (
              <CommandRow
                key={a.id}
                asset={a}
                scopeLabel={
                  a.project_id ? projectNameById.get(a.project_id) ?? "Project" : "Library"
                }
                selected={i === selectedIdx}
                idx={i}
                onReveal={() => revealAsset(a)}
                onShowInLibrary={() => showAssetInLibrary(a)}
                onRowClick={(modifier) => {
                  if (modifier === "ctrl") revealAsset(a);
                  else if (modifier === "shift") showAssetInLibrary(a);
                  else playAsset(a);
                }}
                onMouseEnter={() => setSelectedIdx(i)}
              />
            ))}
          </ul>
        )}

        {tab === "projects" && projectResults.length > 0 && (
          <ul className="cmdp-list" ref={listRef}>
            {projectResults.map((p, i) => (
              <ProjectRow
                key={p.id}
                project={p}
                selected={i === selectedIdx}
                idx={i}
                onOpen={() => openProject(p)}
                onMouseEnter={() => setSelectedIdx(i)}
              />
            ))}
          </ul>
        )}

        {tab === "tags" && tagResults.length > 0 && (
          <ul className="cmdp-list" ref={listRef}>
            {tagResults.map((t, i) => (
              <TagRow
                key={t.name}
                tag={t}
                selected={i === selectedIdx}
                idx={i}
                onApply={() => applyTagFilter(t)}
                onMouseEnter={() => setSelectedIdx(i)}
              />
            ))}
          </ul>
        )}

        <div className="cmdp-footer mono">{hint}</div>
      </div>
    </div>
  );
}

type RowModifier = "ctrl" | "shift" | null;

function CommandRow({
  asset,
  scopeLabel,
  selected,
  idx,
  onReveal,
  onShowInLibrary,
  onRowClick,
  onMouseEnter,
}: {
  asset: Asset;
  scopeLabel: string;
  selected: boolean;
  idx: number;
  /** 📁 button — reveal in OS file manager. */
  onReveal: () => void;
  /** ↗ button — jump Library page to this asset. */
  onShowInLibrary: () => void;
  /** Row body click. Modifier is decoded at the parent so the row
   *  doesn't need to know what each modifier means — it just
   *  forwards the user's intent. */
  onRowClick: (modifier: RowModifier) => void;
  onMouseEnter: () => void;
}) {
  const thumb = thumbnailSrc(asset.thumbnail_path, asset.thumbnail_url);
  const meta: string[] = [];
  if (asset.duration_sec != null) meta.push(fmtDuration(asset.duration_sec));
  if (asset.width && asset.height) meta.push(`${asset.width}×${asset.height}`);
  if (asset.file_size) meta.push(fmtBytes(asset.file_size));
  return (
    <li
      className={"cmdp-row" + (selected ? " selected" : "")}
      data-idx={idx}
      // Row click — modifier decides:
      //   plain → play in OS default app
      //   ctrl  → reveal in folder (mirrors Ctrl+Enter)
      //   shift → show in library (mirrors Shift+Enter)
      onClick={(e) => {
        if (e.target instanceof Element && e.target.closest(".cmdp-row-action")) {
          // Action buttons handle their own click — don't double-fire.
          return;
        }
        const mod: RowModifier = e.ctrlKey || e.metaKey ? "ctrl" : e.shiftKey ? "shift" : null;
        onRowClick(mod);
      }}
      onMouseEnter={onMouseEnter}
    >
      <div className="cmdp-thumb">
        {thumb ? <img src={thumb} alt="" /> : <div className="cmdp-thumb-empty" />}
      </div>
      <div className="cmdp-text">
        <div className="cmdp-title">{asset.title || asset.id}</div>
        <div className="cmdp-meta mono">
          {meta.length > 0 ? meta.join(" · ") : <span className="faint">—</span>}
        </div>
      </div>
      <div className="cmdp-actions">
        <button
          type="button"
          className="cmdp-row-action"
          onClick={(e) => {
            e.stopPropagation();
            onReveal();
          }}
          title="Reveal file in folder"
          aria-label="Reveal file in folder"
        >
          📁
        </button>
        <button
          type="button"
          className="cmdp-row-action"
          onClick={(e) => {
            e.stopPropagation();
            onShowInLibrary();
          }}
          title="Show in library (⇧ Enter)"
          aria-label="Show in library"
        >
          ↗
        </button>
      </div>
      <div className="cmdp-scope mono">{scopeLabel}</div>
    </li>
  );
}

/**
 * Projects tab row. Single Enter target — switches the active scope
 * and navigates to /library so the user is dropped into that
 * project's clip grid.
 */
function ProjectRow({
  project,
  selected,
  idx,
  onOpen,
  onMouseEnter,
}: {
  project: Project;
  selected: boolean;
  idx: number;
  onOpen: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <li
      className={"cmdp-row cmdp-row-simple" + (selected ? " selected" : "")}
      data-idx={idx}
      onClick={onOpen}
      onMouseEnter={onMouseEnter}
    >
      <div className="cmdp-row-icon">
        <Icon.projects width={14} height={14} />
      </div>
      <div className="cmdp-text">
        <div className="cmdp-title">{project.name}</div>
        <div className="cmdp-meta mono">
          {project.asset_count} {project.asset_count === 1 ? "clip" : "clips"}
          {project.root_path ? ` · ${project.root_path}` : ""}
        </div>
      </div>
      <div className="cmdp-scope mono">Switch & open</div>
    </li>
  );
}

/**
 * Tags tab row. Single Enter target — apply this tag as the only
 * filter on the Library page and navigate there.
 */
function TagRow({
  tag,
  selected,
  idx,
  onApply,
  onMouseEnter,
}: {
  tag: TagCount;
  selected: boolean;
  idx: number;
  onApply: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <li
      className={"cmdp-row cmdp-row-simple" + (selected ? " selected" : "")}
      data-idx={idx}
      onClick={onApply}
      onMouseEnter={onMouseEnter}
    >
      <div className="cmdp-row-icon">#</div>
      <div className="cmdp-text">
        <div className="cmdp-title">{tag.name}</div>
        <div className="cmdp-meta mono">
          {tag.count} {tag.count === 1 ? "clip" : "clips"} tagged
        </div>
      </div>
      <div className="cmdp-scope mono">Filter library</div>
    </li>
  );
}
