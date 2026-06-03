// Media Hub — Command Palette (1.3.x).
//
// Global search modal triggered by Ctrl+Space (or click of the topbar
// search button). Inspired by Eagle's command palette — same
// keyboard-driven shape so editors who've been using Eagle for years
// don't have to re-learn anything.
//
// v1 scope (Clips only): search asset titles + channel + tags via
// the existing library_list backend. Enter or click opens the result
// in the Library page with the inspector drawer focused on it.
// Ctrl+Enter (or Cmd+Enter on macOS) reveals the file in the OS
// file manager. Tabs for Projects / Tags will land in v2.
//
// Wiring strategy:
//   - This component renders nothing when closed (parent gates by
//     `open` prop).
//   - On Enter, dispatch a "mh:open-asset" CustomEvent that the
//     Library page listens for. Decouples the palette from any
//     specific page lifecycle; cross-route navigation is just
//     navigate("/library") + the event handler fires after the page
//     keep-alive mounts.

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
import { thumbnailSrc, revealFile } from "../lib/library";
import { useActiveProject } from "../lib/activeProject";
import type { Asset, LibraryFilters } from "../lib/types";
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

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Asset[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const navigate = useNavigate();
  // Project list cached at the app level — we use it just to resolve
  // project_id → human-readable name for the right-side scope chip
  // on each row. No additional fetch needed.
  const { projects } = useActiveProject();
  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

  // Reset when (re)opened. Clear stale query + results; refocus input.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setSelectedIdx(0);
    // Wait a tick so the input is in the DOM before focusing.
    queueMicrotask(() => inputRef.current?.focus());
  }, [open]);

  // Search. 200ms debounce so the user can type "pinterest pin"
  // without firing 14 backend calls. Empty query → empty results
  // (we don't want to dump the whole library here; the Library page
  // is the dump view).
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const filters: LibraryFilters = {
          query: trimmed,
          scope: { kind: "any" }, // 1.3.x — search the whole library + every project
          limit: 50,
          trashed: false,
        };
        const list = await invoke<Asset[]>("library_list", { filters });
        setResults(list);
        setSelectedIdx(0);
      } catch (e) {
        console.warn("[palette] search failed:", e);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open]);

  const openAsset = useCallback(
    (asset: Asset) => {
      const detail: OpenAssetDetail = {
        assetId: asset.id,
        projectId: asset.project_id ?? null,
      };
      // Dispatch BEFORE navigating so a Library page that's already
      // mounted (keep-alive) handles it without the route flicker. A
      // freshly-mounted Library page will pick up the event from its
      // own listen-on-mount path that re-fires the last pending event.
      window.dispatchEvent(new CustomEvent(OPEN_ASSET_EVENT, { detail }));
      navigate("/library");
      onClose();
    },
    [navigate, onClose],
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
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter") {
        const target = results[selectedIdx];
        if (!target) return;
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          // Reveal in OS file manager instead of opening.
          void revealFile(target.file_path).catch((err) =>
            console.warn("[palette] revealFile failed:", err),
          );
          onClose();
          return;
        }
        openAsset(target);
      }
    },
    [onClose, openAsset, results, selectedIdx],
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

  // Helpful hint footer adapts to selection state.
  const hint = useMemo(() => {
    if (!query.trim()) return "Start typing to search clips by title, channel, or tag.";
    if (loading) return "searching…";
    if (results.length === 0) return `No clips match "${query}".`;
    return `${results.length} match${results.length === 1 ? "" : "es"} · ↑↓ move · ↵ open · Ctrl ↵ reveal in folder · Esc close`;
  }, [query, loading, results.length]);

  if (!open) return null;

  return (
    <div
      className="cmdp-backdrop"
      onClick={(e) => {
        // Click outside the modal closes it; clicks inside do nothing.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmdp-modal" role="dialog" aria-label="Search clips">
        <div className="cmdp-input-row">
          <Icon.search width={14} height={14} />
          <input
            ref={inputRef}
            type="text"
            className="cmdp-input"
            placeholder="Search clips…"
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

        {results.length > 0 && (
          <ul className="cmdp-list" ref={listRef}>
            {results.map((a, i) => (
              <CommandRow
                key={a.id}
                asset={a}
                scopeLabel={
                  a.project_id ? projectNameById.get(a.project_id) ?? "Project" : "Library"
                }
                selected={i === selectedIdx}
                idx={i}
                onClick={() => openAsset(a)}
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

function CommandRow({
  asset,
  scopeLabel,
  selected,
  idx,
  onClick,
  onMouseEnter,
}: {
  asset: Asset;
  scopeLabel: string;
  selected: boolean;
  idx: number;
  onClick: () => void;
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
      onClick={onClick}
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
      <div className="cmdp-scope mono">{scopeLabel}</div>
    </li>
  );
}
