import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useTauriEvent } from "../lib/useTauriEvent";
import { Icon } from "../lib/icons";
import { fmtBytes, fmtDuration } from "../lib/format";
import { attachLocalThumbnail, openExternalUrl, openFileInDefaultApp, revealFile, thumbnailSrc } from "../lib/library";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { alertDialog, confirmDialog } from "../lib/dialog";
import { scopeToFilter, useActiveProject } from "../lib/activeProject";
import type { Asset, AssetKind, Folder, FolderFilter, LibraryFilters, SiblingSummary, TagCount } from "../lib/types";

// "now" is the "I just downloaded this" bucket — last 5 min. Surfaces
// the answer to "where's the clip I JUST made?" without scrolling.
// (0.9 UX win #7.)
type Bucket = "now" | "today" | "week" | "month" | "older";

type SortMode =
  | "recent"
  | "oldest"
  | "name_az"
  | "name_za"
  | "size_desc"
  | "size_asc"
  | "duration_desc"
  | "duration_asc";

// 1.3.x — Resizable list-view columns, v3. The model that actually
// holds up:
//
//   • State stores RATIOS (fr units), not pixels. Sum = 100 always.
//   • CSS Grid uses `minmax(MIN_PX, var(--fr))` per column, so the
//     browser turns ratios into pixels at layout time. Total of all
//     columns equals the available width — no overflow, no offscreen.
//   • Window or inspector resizes flow automatically; we don't need
//     a ResizeObserver loop because the browser does it.
//   • Drag = pair-resize: A.fr += d, neighbor.fr -= d. Sum stays 100.
//     CASCADE on grow: when the immediate neighbor hits its MIN_PX,
//     the next column over takes the rest, then the next, and so on.
//     "Boundaries collide and move together" — what the tester asked.
//   • Pixel mins are translated to fr mins at drag-time using the
//     measured container width, so the floor is always real-world
//     correct regardless of how the user resized the window.
//   • The last column (date) has no right-edge handle; resize date
//     by dragging the size column's right edge instead. Symmetric,
//     no edge cases.
type ColKey = "title" | "tags" | "res" | "dur" | "size" | "date";
type ColRatios = Record<ColKey, number>;

// Default fraction of the available width each column claims. Picked
// to sum to 100 so the values read as percentages (40% title, 18%
// tags, etc.) — keeps mental math easy during tuning.
const DEFAULT_RATIOS: ColRatios = {
  title: 40,
  tags: 18,
  res: 8,
  dur: 8,
  size: 9,
  date: 17,
};
// Hard pixel floors. Each value = "the smallest column width where
// this column's header label OR its worst-case content still reads
// without being chopped." Date is the widest because pt-BR full
// dates ("23 de mai. de 26") run ~130px in our mono font.
const MIN_COL_PX: Record<ColKey, number> = {
  title: 200,
  tags: 80,
  res: 56,
  dur: 80,
  size: 80,
  date: 140,
};
// Visual left-to-right order. A column's right-edge handle pair-resizes
// ITS column with the NEXT entry here. The last entry (date) has no
// right-edge handle since there's no "next" to redistribute width
// with — users grow date by shrinking size from its handle instead.
const COL_ORDER: ColKey[] = ["title", "tags", "res", "dur", "size", "date"];

/**
 * Library page — real grid (formerly the dev-card LibraryDevCard).
 * Filter sidebar (source / tags / added / duration) + grid of cards +
 * status footer. Selecting a card opens a slide-over drawer with full
 * metadata, tag editor, and actions (Open / Move to Trash).
 *
 * Search is debounced (150ms). Filters compose via AND. The backend
 * does the heavy lifting via library_list — we only do client-side
 * filtering for buckets the SQL command doesn't support yet
 * (added-date, duration).
 */
export default function LibraryPage() {
  const { scope, setScope, projects } = useActiveProject();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [count, setCount] = useState<number>(0);
  const [err, setErr] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<TagCount[]>([]);

  // Filter state
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [activePlatforms, setActivePlatforms] = useState<Set<string>>(new Set());
  const [activeBuckets, setActiveBuckets] = useState<Set<Bucket>>(new Set());
  // 1.2.0 — filter by asset kind. Empty set = show all (default).
  // When the set has values, only matching kinds pass the filter.
  // Drives a row in the FilterPopup; counts come from the asset list.
  const [activeKinds, setActiveKinds] = useState<Set<AssetKind>>(new Set());
  const [tagFilter, setTagFilter] = useState("");

  // 1.1 Phase 2 — folders state. `folderFilter` is the currently
  // active sidebar entry: "any" (all clips), "uncategorized" (no
  // folder), or a specific folder id. `folders` is the loaded list
  // with per-folder asset counts.
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderFilter, setFolderFilter] = useState<FolderFilter>({ kind: "any" });
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderDraft, setRenameFolderDraft] = useState("");
  const [folderCtxMenu, setFolderCtxMenu] = useState<{
    x: number;
    y: number;
    folder: Folder;
  } | null>(null);

  // 1.1 Phase 3 — filter popup state. Boolean toggle; anchor element
  // ref lets the popup position relative to the trigger button so it
  // follows when the user resizes the window. Closed on outside-click /
  // Esc (handled inside FilterPopup).
  const [filterPopupOpen, setFilterPopupOpen] = useState(false);
  const filterBtnRef = useRef<HTMLButtonElement>(null);

  // 1.1.1 — Tags filter is now its own popup beside Filter (split out
  // because long projects will have a lot of tags and they deserve their
  // own search/scroll surface, not a section squeezed inside the generic
  // filter dropdown). Filter popup now shows only Source + Added.
  const [tagFilterPopupOpen, setTagFilterPopupOpen] = useState(false);
  const tagBtnRef = useRef<HTMLButtonElement>(null);

  // 1.1.1 — sort popup (Most recent / Oldest / Name / Size / Duration).
  // Pure client-side ordering on `filtered`; backend query stays sorted
  // by downloaded_at DESC so first paint already matches the default.
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [sortPopupOpen, setSortPopupOpen] = useState(false);
  const sortBtnRef = useRef<HTMLButtonElement>(null);

  // 1.1.1 — "T" tag picker popup. Different from the tag FILTER popup:
  // this one ASSIGNS tags to the current selection (single OR many).
  // Floats near the cursor (Eagle-style). `tagPickerPos` is captured
  // from the last known mouse position so the popup pops where the
  // user's eyes are. Null when closed.
  const [tagPickerPos, setTagPickerPos] = useState<{ x: number; y: number } | null>(null);
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  // 1.1.1 bugfix — debounce reopen of the picker. Without this, certain
  // event orderings (outside-click closes popup → some downstream
  // re-render path schedules another open with the cached cursor pos)
  // can immediately re-open the popup at the original P1. 300ms is
  // long enough to swallow any spurious double-fire but short enough
  // that real "close then reopen via T" still feels instant.
  const tagPickerClosedAtRef = useRef<number>(0);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    };
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  }, []);

  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 150);
    return () => clearTimeout(t);
  }, [query]);

  // 1.1 — unified selection model (Eagle-style). One Set drives both
  // the inspector (right panel) and bulk actions:
  //   - empty   → inspector shows "no selection" placeholder
  //   - size 1  → inspector shows single-asset details + actions
  //   - size >1 → inspector shows batch summary + bulk actions
  // No more separate "drawer selection" vs "multi-select" — plain
  // click replaces the set, Ctrl toggles, Shift ranges, double-click
  // opens the file in the default app.
  //
  // `anchor` tracks the last clicked card for Shift-range selections.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // 1.3.0 — in-app Trash view. When active, the grid shows trashed clips
  // (deleted_at NOT NULL) and a Restore/Empty toolbar replaces the normal
  // chrome. trashCount drives the sidebar badge in any view.
  const [inTrash, setInTrash] = useState(false);
  const [trashCount, setTrashCount] = useState(0);

  // 1.3.x — Command-palette open-asset handoff. When the global
  // palette fires `mh:open-asset`, we may need to switch the active
  // scope to that asset's project first (so the grid actually contains
  // it), and then select + scroll-into-view once the new asset list
  // has loaded. `pendingOpenId` carries the asset id through that
  // round-trip; a second effect (watching `assets`) consumes it.
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

  // 1.1 — box-drag (marquee) selection state. When the user mouses
  // down on empty grid area, we start a drag; mousemove updates the
  // rectangle and hit-tests cards live; mouseup commits the result.
  // Null when not dragging.
  const [dragRect, setDragRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  // Snapshot of selection at drag-start when Ctrl is held — lets us
  // ADD to (rather than REPLACE) the existing selection during a
  // modifier-drag, matching OS file-manager conventions.
  const dragAdditiveBaseRef = useRef<Set<string> | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);

  // Right-click context menu state (0.9 UX win #6). When non-null,
  // <CardContextMenu> renders at (x,y) for the targeted asset.
  // Dismissed by click-outside, Esc, scroll, or any of its actions.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    asset: Asset;
  } | null>(null);

  // 1.3.x — Grid vs List view. Persisted to localStorage so the user's
  // preference sticks across sessions. List view shows the same assets
  // as compact rows (thumb + title + meta columns) — useful when you're
  // hunting by metadata rather than scanning thumbnails.
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    try {
      const v = localStorage.getItem("mh.library.viewMode");
      return v === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("mh.library.viewMode", viewMode);
    } catch {
      // localStorage can be blocked (private windows, etc.) — fine.
    }
  }, [viewMode]);

  // 1.3.x — Resizable list-view columns (v3, ratio-based). State holds
  // FR ratios; the browser's grid layout turns them into pixels.
  // Container resize, inspector open/close, narrow windows — all
  // handled automatically by CSS Grid. The only thing this hook
  // owns is persisting the user's chosen ratios across sessions.
  const [colRatios, setColRatios] = useState<ColRatios>(() => {
    try {
      const raw = localStorage.getItem("mh.library.colRatios");
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ColRatios>;
        // Spread DEFAULT_RATIOS first so any missing key falls back
        // cleanly (e.g., we ever add a new column in the future).
        return { ...DEFAULT_RATIOS, ...parsed };
      }
    } catch {
      // localStorage blocked — fall back to defaults.
    }
    return DEFAULT_RATIOS;
  });
  useEffect(() => {
    try {
      localStorage.setItem("mh.library.colRatios", JSON.stringify(colRatios));
    } catch {
      // localStorage blocked — ratios still live in memory.
    }
  }, [colRatios]);

  async function refresh() {
    try {
      const scopeFilter = scopeToFilter(scope);
      const filters: LibraryFilters = {
        query: debouncedQuery || null,
        tags: inTrash ? null : activeTags.size > 0 ? Array.from(activeTags) : null,
        scope: scopeFilter,
        folder: inTrash || folderFilter.kind === "any" ? null : folderFilter,
        limit: 500,
        trashed: inTrash,
      };
      const [list, n, tags, folderList, tCount] = await Promise.all([
        invoke<Asset[]>("library_list", { filters }),
        invoke<number>("library_count", { scope: scopeFilter }),
        invoke<TagCount[]>("tag_list_all"),
        invoke<Folder[]>("folder_list"),
        invoke<number>("library_trash_count"),
      ]);
      setAssets(list);
      setCount(n);
      setAllTags(tags);
      setFolders(folderList);
      setTrashCount(tCount);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }

  // 1.3.0 — prune cards whose file was deleted out-of-band. Safe by
  // design: re-verified server-side before deletion (an offline drive
  // won't lose cards), and nothing on disk is touched (the file is
  // already gone). See library_remove_missing in library.rs.
  async function removeMissing() {
    const missing = assets.filter((a) => a.missing);
    if (missing.length === 0) return;
    const ok = await confirmDialog(
      `Remove ${missing.length} missing ${missing.length === 1 ? "clip" : "clips"} from the library?\n\n` +
        `Their files no longer exist on disk. Only the library cards are removed — there's nothing left on disk to delete.\n\n` +
        `Tip: if a clip lives on an external/network drive that's just unplugged, reconnect it and refresh instead.`,
      { title: "Remove missing clips?", kind: "warning" },
    );
    if (!ok) return;
    try {
      await invoke<number>("library_remove_missing", { ids: missing.map((a) => a.id) });
      await refresh();
    } catch (e) {
      setErr(String(e));
    }
  }

  // 1.1 Phase 2 — folder CRUD handlers. All go through the Rust
  // commands which emit library:changed → refresh() re-runs and
  // pulls the new folder list naturally. No optimistic UI; the
  // round-trip is fast enough.

  // Click "+" → create a folder with an auto-unique placeholder name,
  // then immediately enter rename mode on it. Mirrors Eagle's flow
  // (and Finder's, and most file managers') — one click to create,
  // type to name, Enter to commit, Esc to dismiss.
  async function createFolderInline() {
    if (creatingFolder) return;
    setCreatingFolder(true);
    try {
      // Pick a non-colliding placeholder. If "Untitled" exists, try
      // "Untitled 2", "Untitled 3"... The Rust side would also reject
      // dupes; doing it client-side keeps the UX snappy.
      const existing = new Set(folders.map((f) => f.name.toLowerCase()));
      let candidate = "Untitled";
      let n = 2;
      while (existing.has(candidate.toLowerCase())) {
        candidate = `Untitled ${n}`;
        n += 1;
      }
      const created = await invoke<Folder>("folder_create", {
        name: candidate,
        parentId: null,
        color: null,
      });
      // Open the rename input on the new folder so the user can
      // type the real name immediately.
      setRenamingFolderId(created.id);
      setRenameFolderDraft(created.name);
    } catch (e) {
      await alertDialog(String(e), { title: "Couldn't create folder", kind: "error" });
    } finally {
      setCreatingFolder(false);
    }
  }
  async function renameFolder(id: string) {
    const name = renameFolderDraft.trim();
    if (!name) {
      setRenamingFolderId(null);
      return;
    }
    try {
      await invoke("folder_rename", { id, name });
      setRenamingFolderId(null);
      setRenameFolderDraft("");
    } catch (e) {
      await alertDialog(String(e), { title: "Couldn't rename folder", kind: "error" });
    }
  }
  async function deleteFolder(folder: Folder) {
    const msg =
      folder.asset_count > 0
        ? `Delete folder "${folder.name}"?\n\n${folder.asset_count} ${folder.asset_count === 1 ? "clip" : "clips"} will fall back to Uncategorized (files stay where they are).`
        : `Delete folder "${folder.name}"?`;
    if (!(await confirmDialog(msg, { title: "Delete folder?", kind: "warning" }))) return;
    try {
      await invoke("folder_delete", { id: folder.id });
      // If the deleted folder was the active filter, fall back to all clips.
      if (folderFilter.kind === "id" && folderFilter.id === folder.id) {
        setFolderFilter({ kind: "any" });
      }
    } catch (e) {
      await alertDialog(String(e), { title: "Couldn't delete folder", kind: "error" });
    }
  }
  // Called from inspector dropdowns (single + batch).
  async function moveSelectionToFolder(folderId: string | null) {
    const ids = Array.from(selection);
    if (ids.length === 0) return;
    try {
      if (ids.length === 1) {
        await invoke("asset_set_folder", { assetId: ids[0], folderId });
      } else {
        await invoke<number>("asset_set_folder_many", { assetIds: ids, folderId });
      }
    } catch (e) {
      await alertDialog(String(e), { title: "Couldn't move to folder", kind: "error" });
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, activeTags, scope, folderFilter, inTrash]);

  // 1.3.x — Listen for the command palette's open-asset event.
  // Switches the active scope when the target asset lives in a
  // different project; sets pendingOpenId so the consume-effect
  // below can finish the job once the new asset list lands.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { assetId: string; projectId: string | null }
        | undefined;
      if (!detail?.assetId) return;
      // Exit the Trash view first so the live grid is what receives the
      // selection — otherwise an asset can appear "missing" because the
      // trashed view filters it out.
      if (inTrash) setInTrash(false);
      // Scope switch if the asset's home doesn't match the current.
      const targetIsLib = detail.projectId == null;
      const currentScopeId =
        scope.kind === "project" ? scope.id : null;
      if (targetIsLib && scope.kind !== "library") {
        setScope({ kind: "library" });
      } else if (
        !targetIsLib &&
        detail.projectId &&
        currentScopeId !== detail.projectId
      ) {
        const proj = projects.find((p) => p.id === detail.projectId);
        if (proj) {
          setScope({ kind: "project", id: proj.id, name: proj.name });
        } else {
          // Project deleted while the palette result was stale —
          // fall back to Library and let pendingOpenId match if the
          // asset's row still exists at library scope.
          setScope({ kind: "library" });
        }
      }
      setPendingOpenId(detail.assetId);
    };
    window.addEventListener("mh:open-asset", onOpen);
    return () => window.removeEventListener("mh:open-asset", onOpen);
  }, [scope, projects, setScope, inTrash]);

  // 1.3.x — Command palette Tags tab fires this. Replaces the
  // current activeTags set with the single picked tag so the user
  // sees only that tag's clips. Bounces out of Trash too — tag
  // filter on a trash view makes no sense.
  useEffect(() => {
    const onTag = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tag: string } | undefined;
      if (!detail?.tag) return;
      if (inTrash) setInTrash(false);
      setActiveTags(new Set([detail.tag]));
    };
    window.addEventListener("mh:apply-tag-filter", onTag);
    return () => window.removeEventListener("mh:apply-tag-filter", onTag);
  }, [inTrash]);

  // 1.3.x — Consume pendingOpenId once the matching asset has loaded
  // into the grid. Sets the single-asset selection (the inspector
  // picks it up automatically), scrolls it into view, and clears the
  // pending id. If 1s passes with no match the asset is probably gone
  // — clear pending so we don't leave the listener half-armed.
  useEffect(() => {
    if (!pendingOpenId) return;
    const present = assets.find((a) => a.id === pendingOpenId);
    if (present) {
      setSelection(new Set([pendingOpenId]));
      setAnchor(pendingOpenId);
      // Scroll-into-view after a microtask so the new selected styling
      // is applied first.
      queueMicrotask(() => {
        const card = document.querySelector<HTMLElement>(
          `[data-asset-id='${pendingOpenId}']`,
        );
        card?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      setPendingOpenId(null);
      return;
    }
    // Asset hasn't shown up yet — set a 1s grace timer.
    const t = setTimeout(() => {
      console.warn(`[lib] open-asset target ${pendingOpenId} not found after refresh`);
      setPendingOpenId(null);
    }, 1000);
    return () => clearTimeout(t);
  }, [assets, pendingOpenId]);

  // 1.3.0 — Trash actions. Restore moves files back to their original
  // location; empty permanently deletes. Both operate on the current
  // selection, or everything in the Trash when nothing is selected.
  async function restoreFromTrash(ids: string[]) {
    if (ids.length === 0) return;
    try {
      await invoke<number>("library_trash_restore", { ids });
      setSelection(new Set());
      await refresh();
    } catch (e) {
      setErr(String(e));
    }
  }
  async function emptyTrash(ids: string[]) {
    if (ids.length === 0) return;
    const ok = await confirmDialog(
      `Permanently delete ${ids.length} ${ids.length === 1 ? "clip" : "clips"}?\n\n` +
        `This cannot be undone — the files are removed from disk for good.`,
      { title: "Empty trash?", kind: "error" },
    );
    if (!ok) return;
    try {
      await invoke<number>("library_trash_empty", { ids });
      setSelection(new Set());
      await refresh();
    } catch (e) {
      setErr(String(e));
    }
  }

  // Event-driven refresh — Rust emits library:changed after every
  // insert/delete/tag mutation. No polling.
  useTauriEvent("library:changed", () => {
    void refresh();
  });

  // 1.1 — unified click handler. Eagle-style:
  //   - plain click       → replace selection with just this card
  //   - Ctrl/Cmd+click    → toggle this card in selection
  //   - Shift+click       → range select from anchor to this card
  //   - double-click      → open file in default app (handled separately
  //                          via onDoubleClick on the card)
  function handleCardClick(asset: Asset, ev: React.MouseEvent) {
    const id = asset.id;
    if (ev.ctrlKey || ev.metaKey) {
      setSelection((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setAnchor(id);
      return;
    }
    if (ev.shiftKey && anchor) {
      const ids = filtered.map((a) => a.id);
      const ai = ids.indexOf(anchor);
      const bi = ids.indexOf(id);
      if (ai >= 0 && bi >= 0) {
        const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
        setSelection(new Set(ids.slice(lo, hi + 1)));
        return;
      }
    }
    // Plain click — replace selection entirely.
    setSelection(new Set([id]));
    setAnchor(id);
  }

  // 1.1 — double-click opens the file in the OS default app.
  // The single click that precedes it (per browser dom semantics)
  // selects the card — that's the desired sequence.
  async function handleCardDoubleClick(asset: Asset) {
    try {
      await openFileInDefaultApp(asset.file_path);
    } catch (e) {
      console.warn("open file failed:", e);
    }
  }

  // 1.1.2 — UNIFIED drag (internal folder-drop + external NLE drop).
  //
  // Single gesture. We call tauri-plugin-drag's startDrag() so the OS
  // takes over the drag (allowing Premiere/Resolve/Explorer to accept
  // it). The plugin's callback fires on drop with the cursor's screen
  // position, which we use to hit-test against folder DOM rects via
  // document.elementFromPoint:
  //
  //   - Dropped over a folder row inside our window → call asset_set_folder
  //     (internal move). The OS drag never "lands" on an external app.
  //   - Dropped anywhere else inside our window → no-op (treat as accidental
  //     drop in empty space).
  //   - Dropped outside our window → the OS has already given the file
  //     paths to the target app (Premiere/Resolve/Explorer/etc.). We
  //     get a "Dropped" result with cursorPos outside our window's
  //     client rect; we do nothing — the OS handled it.
  //   - Cancelled (Esc, drop on disallowed surface) → no-op.
  //
  // Selection rule mirrors Finder/Eagle: if the dragged card is already
  // in the selection, drag the whole selection. If not, swap selection
  // to just that card before dragging so the inspector follows.
  //
  // We pass mode: "copy" because the library file is canonical — dropping
  // into Premiere should not move/delete the source.
  //
  // `folderDropHover` is still used for the visual highlight, but it's
  // updated from a global mousemove listener while a drag is active
  // (since HTML5 drag events stop firing the moment startDrag takes
  // over the OS cursor).
  const [folderDropHover, setFolderDropHover] = useState<string | null>(null);
  // 1.1.2 — `draggingCount` drives a sidebar hint ("Drop on a folder to
  // move N clips") that shows while a drag is in flight. We can't
  // reliably highlight the hovered folder live on Windows (OLE doesn't
  // surface enter/over events for self-initiated drags) so we settle
  // for a static hint that at least signals "drag mode is on" + tells
  // the user what dropping does.
  const [draggingCount, setDraggingCount] = useState<number>(0);

  // 1.1.2 bugfix v2 — internal drag-to-folder originally relied on
  // `cursorPos` returned from tauri-plugin-drag's callback. Two
  // Windows OLE-drag quirks broke that path:
  //   1. Drops INSIDE the source window often report `Cancelled`
  //      (the OS doesn't recognize the source as a drop target for
  //      its own drag), so the Dropped-only check skipped them.
  //   2. cursorPos is ambiguous between physical/logical screen px
  //      depending on platform + DPI scaling.
  // Reliable fix: subscribe to Tauri's webview onDragDropEvent and
  // track the last over/enter position (already in WINDOW-relative
  // physical px). At drag end (whether Dropped OR Cancelled), use
  // that tracked position to hit-test folder rows. cursorPos still
  // serves as a fallback if events didn't fire for some reason.
  const dragTrackedPosRef = useRef<{ x: number; y: number } | null>(null);
  // 1.1.3 — gate Tauri drag-drop events to the lifetime of the current
  // self-initiated drag. On Windows, OLE drag fires an enter/over event
  // shortly AFTER the plugin callback resolves; without this gate, that
  // late event re-sets folderDropHover and leaves the dashed outline
  // stuck on the folder the user just dropped into. Flipped true at
  // drag start, false the moment the plugin callback fires (which is
  // also where we clear hover). Late events after that bail out.
  const dragSessionActiveRef = useRef<boolean>(false);

  // Subscribe once. Tauri's drag-drop events fire for any OS drag
  // hovering over our window — including our own self-initiated
  // drags (the case we care about here). Position payload is in
  // physical pixels; divide by devicePixelRatio for elementFromPoint.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const fn = await getCurrentWebview().onDragDropEvent((e) => {
          const p = e.payload;
          const posPayload = (p as { position?: { x: number; y: number } }).position;
          // 1.1.3 — drag-session gate. The plugin callback flips this
          // false on completion. Anything that arrives after that is
          // a stale OLE-queued event (Windows fires a late `over`
          // shortly after `drop` for self-drags, which was the cause
          // of the stuck-highlight bug). Bail on any event when the
          // session is dead.
          if (!dragSessionActiveRef.current) return;

          if (p.type === "enter" || p.type === "over") {
            if (posPayload) {
              const dpr = window.devicePixelRatio || 1;
              dragTrackedPosRef.current = { x: posPayload.x / dpr, y: posPayload.y / dpr };
              const hit = folderAtPoint(dragTrackedPosRef.current.x, dragTrackedPosRef.current.y);
              setFolderDropHover(hit?.key ?? null);
            }
          } else if (p.type === "drop") {
            // Record position for the plugin callback's hit-test,
            // but don't set hover (would stick).
            if (posPayload) {
              const dpr = window.devicePixelRatio || 1;
              dragTrackedPosRef.current = { x: posPayload.x / dpr, y: posPayload.y / dpr };
            }
            setFolderDropHover(null);
          } else if (p.type === "leave") {
            dragTrackedPosRef.current = null;
            setFolderDropHover(null);
          }
        });
        if (cancelled) fn();
        else unlisten = fn;
      } catch (e) {
        console.warn("onDragDropEvent subscribe failed:", e);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Hit-test helper — given client (cursor) coords, walk up the DOM
  // looking for the nearest .lib-folder ancestor and return its
  // data-folder-key (or "__uncategorized__" for the special row).
  // Returns undefined if the cursor isn't over a folder row.
  function folderAtPoint(x: number, y: number): { id: string | null; key: string } | undefined {
    const el = document.elementFromPoint(x, y);
    if (!el) return undefined;
    const row = el.closest<HTMLElement>(".lib-folder[data-folder-key]");
    if (!row) return undefined;
    const key = row.dataset.folderKey ?? "";
    if (key === "__uncategorized__") return { id: null, key };
    if (key === "__all__") return undefined; // not a drop target
    return { id: key, key };
  }

  async function onCardDragStart(asset: Asset, ev: React.DragEvent<HTMLButtonElement>) {
    // Take over from HTML5 drag — Tauri's startDrag drives the OS
    // cursor from here.
    ev.preventDefault();

    // Build the asset set to drag (selection or just this card).
    let ids: string[];
    if (selection.has(asset.id)) {
      ids = Array.from(selection);
    } else {
      ids = [asset.id];
      setSelection(new Set([asset.id]));
      setAnchor(asset.id);
    }
    const targets = ids
      .map((id) => assets.find((a) => a.id === id))
      .filter((a): a is Asset => !!a);
    if (targets.length === 0) return;
    const paths = targets.map((a) => a.file_path);
    // Preview image: use the first asset's local thumbnail if present.
    // Plugin expects a real filesystem path (not an asset:// URL).
    const icon = targets[0].thumbnail_path || targets[0].file_path;

    // Reset trackers at drag start. dragSessionActive opens the gate
    // for the Tauri webview drag-drop events; flipped false in the
    // plugin callback so late OLE events (Windows fires a stray `over`
    // after the drop completes) can't re-set folderDropHover and leave
    // a stuck dashed outline on the dropped-into folder.
    dragTrackedPosRef.current = null;
    setFolderDropHover(null);
    setDraggingCount(ids.length);
    dragSessionActiveRef.current = true;

    // 1.1.7 — cursor-poll loop for live per-folder hover feedback.
    //
    // Background: Tauri's onDragDropEvent enter/over events DO NOT
    // fire for self-initiated OS drags on Windows (OLE's DoDragDrop
    // doesn't deliver IDropTarget callbacks to the SOURCE window's
    // webview). The previous attempt used Tauri's cursorPosition()
    // command, but that dispatches through tao's event loop — and
    // DoDragDrop BLOCKS that loop for the duration of the drag, so
    // every cursorPosition() call queues up and only resolves AFTER
    // drop. Net effect: zero live updates during the drag.
    //
    // Fix: call Win32 GetCursorPos directly via a custom Rust
    // command (`mouse_cursor_pos`). It runs on a tokio worker, uses
    // plain FFI, never touches the blocked tao loop. Result returns
    // in microseconds even while a drag is in flight. We cache
    // window innerPosition ONCE at drag start (it can't change
    // mid-drag — window can't be moved while user is dragging).
    //
    // Diagnostic logging is intentionally loud: if this breaks again,
    // the user (or you, future me) will see exactly what's happening
    // in DevTools console without needing to add instrumentation.
    let pollHandle: number | null = null;
    let tickCount = 0;
    let hitCount = 0;
    const stopPoll = () => {
      if (pollHandle !== null) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
      console.log(
        `[drag-hover] poll stopped — ${tickCount} ticks, ${hitCount} folder hits`,
      );
    };
    // Cache window position ONCE — it can't move during a drag.
    // This also means the polling tick doesn't await two IPCs.
    let cachedWinPos: { x: number; y: number } | null = null;
    void getCurrentWindow()
      .innerPosition()
      .then((p) => {
        cachedWinPos = { x: p.x, y: p.y };
        console.log("[drag-hover] cached window position:", cachedWinPos);
      })
      .catch((e) => console.warn("[drag-hover] innerPosition failed:", e));

    const tickPoll = async () => {
      if (!dragSessionActiveRef.current) return;
      if (!cachedWinPos) return; // wait for window pos
      tickCount += 1;
      try {
        // Direct Win32 FFI — bypasses tao event loop entirely.
        const cur = await invoke<{ x: number; y: number }>("mouse_cursor_pos");
        const dpr = window.devicePixelRatio || 1;
        const cx = (cur.x - cachedWinPos.x) / dpr;
        const cy = (cur.y - cachedWinPos.y) / dpr;
        if (tickCount === 1 || tickCount % 30 === 0) {
          console.log(
            `[drag-hover] tick ${tickCount}: cur=(${cur.x},${cur.y}) win=(${cachedWinPos.x},${cachedWinPos.y}) client=(${cx.toFixed(0)},${cy.toFixed(0)}) dpr=${dpr}`,
          );
        }
        // Outside the window → no hover.
        if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) {
          if (dragSessionActiveRef.current) setFolderDropHover(null);
          return;
        }
        dragTrackedPosRef.current = { x: cx, y: cy };
        const hit = folderAtPoint(cx, cy);
        if (hit) {
          hitCount += 1;
          if (hitCount === 1) {
            console.log("[drag-hover] FIRST folder hit:", hit);
          }
        }
        if (dragSessionActiveRef.current) {
          setFolderDropHover(hit?.key ?? null);
        }
      } catch (e) {
        // Don't spam — log first failure and stop polling so the
        // user sees one clear error not a hundred.
        console.warn("[drag-hover] poll failed (will stop):", e);
        stopPoll();
      }
    };
    pollHandle = window.setInterval(() => void tickPoll(), 33);
    void tickPoll();
    console.log(`[drag-hover] poll started for ${ids.length} item(s)`);

    try {
      await startDrag(
        { item: paths, icon, mode: "copy" },
        (payload) => {
          // Close the gate BEFORE clearing visible state, so any
          // synchronous event re-entry triggered by setState here
          // is already gated out.
          dragSessionActiveRef.current = false;
          stopPoll();
          setFolderDropHover(null);
          setDraggingCount(0);
          const tracked = dragTrackedPosRef.current;
          dragTrackedPosRef.current = null;

          // PRIMARY path: tracked position from Tauri webview drag
          // events. Works on both Dropped and Cancelled (Windows
          // reports own-window drops as Cancelled).
          let hit = tracked ? folderAtPoint(tracked.x, tracked.y) : undefined;

          // FALLBACK path: cursorPos from the plugin callback. Only
          // try when result === Dropped (otherwise the OS handled it
          // externally — we'd risk false positives). Try multiple
          // coordinate-space interpretations to be DPI-robust.
          if (!hit && payload.result === "Dropped" && payload.cursorPos) {
            const cx = Number(payload.cursorPos.x);
            const cy = Number(payload.cursorPos.y);
            const dpr = window.devicePixelRatio || 1;
            const candidates = [
              // cursorPos in logical screen → client
              { x: cx - window.screenX, y: cy - window.screenY },
              // cursorPos in physical screen → client
              { x: cx / dpr - window.screenX, y: cy / dpr - window.screenY },
              // cursorPos already in client coords
              { x: cx, y: cy },
              // cursorPos in physical client
              { x: cx / dpr, y: cy / dpr },
            ];
            for (const c of candidates) {
              const h = folderAtPoint(c.x, c.y);
              if (h) {
                hit = h;
                break;
              }
            }
          }

          if (!hit) return; // dropped outside any folder → OS handled it

          // Internal move.
          void (async () => {
            try {
              if (ids.length === 1) {
                await invoke("asset_set_folder", {
                  assetId: ids[0],
                  folderId: hit.id,
                });
              } else {
                await invoke<number>("asset_set_folder_many", {
                  assetIds: ids,
                  folderId: hit.id,
                });
              }
            } catch (e) {
              await alertDialog(`Move failed: ${String(e)}`, {
                title: "Drop failed",
                kind: "error",
              });
            }
          })();
        },
      );
    } catch (e) {
      dragSessionActiveRef.current = false;
      stopPoll();
      setFolderDropHover(null);
      setDraggingCount(0);
      dragTrackedPosRef.current = null;
      console.warn("startDrag failed:", e);
    }
  }

  // 1.1 Phase 2 — bulk delete, single semantics now.
  // 1.3.0 — bulk delete moves clips to the in-app Trash (recoverable
  // from the Trash view). The backend soft-deletes (keeps rows, flagged
  // trashed) — restore is one click.
  async function bulkDelete() {
    await moveToTrash(Array.from(selection));
  }

  // Shared by the Delete key, the bulk toolbar, and the card context menu
  // (which can act on the whole selection when the right-clicked card is
  // part of it). No confirm — trash is recoverable.
  async function moveToTrash(ids: string[]) {
    if (ids.length === 0) return;
    setBulkDeleting(true);
    try {
      const result = await invoke<{
        rows_deleted: number;
        files_removed: number;
        file_errors: string[];
      }>("library_delete_many", { ids });
      setSelection(new Set());
      setAnchor(null);
      if (result.file_errors.length > 0) {
        await alertDialog(
          `Moved ${result.rows_deleted} to Trash, but ${result.file_errors.length} couldn't be moved (likely in use by another app):\n\n` +
            result.file_errors.slice(0, 5).join("\n") +
            (result.file_errors.length > 5 ? `\n…and ${result.file_errors.length - 5} more` : ""),
          { title: "Partial success", kind: "warning" },
        );
      }
    } catch (e) {
      await alertDialog(`Delete failed:\n\n${String(e)}`, {
        title: "Couldn't delete",
        kind: "error",
      });
    } finally {
      setBulkDeleting(false);
    }
  }

  // 1.1 — box-drag selection. Listens for mousedown on the grid
  // scroll container; if the target isn't a card itself, starts a
  // marquee. The handler chain is:
  //   onMouseDown → maybe start drag (record start pos + base set)
  //   global mousemove → update rect, hit-test cards live
  //   global mouseup → commit + clean up listeners
  // We use document-level move/up handlers (rather than React props)
  // so a fast drag that leaves the grid container still gets the
  // mouseup event. Standard drag-selection pattern.
  function startBoxDrag(ev: React.MouseEvent) {
    // Only start on direct hits to the scroll container — clicking
    // a card propagates here too but its own handler runs first.
    if (ev.button !== 0) return; // left click only
    const scroll = gridScrollRef.current;
    if (!scroll) return;
    // Skip if the user clicked on a card (the card's own click
    // handler already handled the selection update).
    const targetEl = ev.target as HTMLElement;
    if (targetEl.closest(".lib-card, .lib-row")) return;
    // Header strip in list view isn't a card/row — but clicking a sort
    // button inside it shouldn't kick off a marquee drag (preventDefault
    // here would swallow the button's click). Treat it like a card.
    if (targetEl.closest(".lib-list-head")) return;
    ev.preventDefault();

    const rect = scroll.getBoundingClientRect();
    const sx = ev.clientX;
    const sy = ev.clientY;
    dragStartRef.current = { x: sx, y: sy };

    // Capture base selection if Ctrl held (additive); otherwise the
    // drag REPLACES selection on first movement.
    if (ev.ctrlKey || ev.metaKey) {
      dragAdditiveBaseRef.current = new Set(selection);
    } else {
      dragAdditiveBaseRef.current = null;
      setSelection(new Set());
    }

    function onMove(mv: MouseEvent) {
      const start = dragStartRef.current;
      if (!start) return;
      const x = Math.min(start.x, mv.clientX);
      const y = Math.min(start.y, mv.clientY);
      const w = Math.abs(mv.clientX - start.x);
      const h = Math.abs(mv.clientY - start.y);
      setDragRect({ x, y, w, h });

      // Hit-test: collect all card elements, check viewport-rect
      // intersection. Cheap enough at our scale (< 500 cards).
      const cards = scroll!.querySelectorAll<HTMLElement>(".lib-card, .lib-row");
      const hitIds = new Set<string>();
      const dragLeft = x;
      const dragTop = y;
      const dragRight = x + w;
      const dragBottom = y + h;
      cards.forEach((el) => {
        const r = el.getBoundingClientRect();
        const intersects =
          r.left < dragRight &&
          r.right > dragLeft &&
          r.top < dragBottom &&
          r.bottom > dragTop;
        if (intersects) {
          const id = el.getAttribute("data-asset-id");
          if (id) hitIds.add(id);
        }
      });

      if (dragAdditiveBaseRef.current) {
        const merged = new Set(dragAdditiveBaseRef.current);
        hitIds.forEach((id) => merged.add(id));
        setSelection(merged);
      } else {
        setSelection(hitIds);
      }
    }

    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      dragStartRef.current = null;
      dragAdditiveBaseRef.current = null;
      setDragRect(null);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    // Avoid the unused-binding warning from `rect`.
    void rect;
  }

  // 1.1 — heal any broken thumbnail_path refs first, then run the
  // normal backfill. The 1.0.5 library_migrate_root command had a
  // bug where it rewrote file_path but forgot thumbnail_path,
  // leaving moved libraries with every thumbnail pointing at the
  // old location. The repair command nulls out broken refs (files
  // that don't exist) — the backfill below then sees them via
  // library_thumbnails_missing and regenerates from the actual
  // video file at its NEW location.
  //
  // Safe to run on every mount: it's idempotent (does nothing when
  // all thumbnails are valid) and cheap (single SELECT + per-row
  // exists check; no decode/copy).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const repaired = await invoke<number>("library_repair_thumbnails");
        if (repaired > 0) {
          console.info(`[thumbs] healed ${repaired} broken thumbnail refs from old library root`);
        }
        // After repair, fall through to backfill any nulls.
        const missing = await invoke<
          Array<{ id: string; file_path: string; duration_sec: number | null }>
        >("library_thumbnails_missing");
        for (const m of missing) {
          if (cancelled) return;
          await attachLocalThumbnail(m.id, m.file_path, m.duration_sec);
          // Tiny breather between extractions — keeps the UI snappy
          // and lets the event loop process the library:changed
          // refresh that each extraction triggers.
          await new Promise((r) => setTimeout(r, 150));
        }
      } catch (e) {
        console.warn("thumbnail backfill failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 1.1 — page-level keyboard shortcuts for multi-select. Skipped
  // when an input/textarea is focused so typing in the search bar
  // doesn't accidentally select-all or trigger Delete. Escape always
  // works (it also closes the drawer naturally).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      const isTyping =
        tag === "input" || tag === "textarea" || tag === "select" ||
        (document.activeElement as HTMLElement | null)?.isContentEditable;

      // Ctrl/Cmd+A → select all in the current filtered view. Skipped
      // while typing (browser default text-select behavior wins there).
      if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
        if (isTyping) return;
        e.preventDefault();
        setSelection(new Set(filtered.map((a) => a.id)));
        return;
      }
      // Delete / Backspace → bulk delete the current selection.
      // Backspace is a "delete back" in inputs so the isTyping guard
      // is essential here. 1.1 Phase 2: dropped the Shift+Del split
      // — Delete now always moves files to the Recycle Bin (recoverable).
      if (e.key === "Delete" || e.key === "Backspace") {
        if (isTyping) return;
        if (selection.size === 0) return;
        e.preventDefault();
        void bulkDelete();
        return;
      }
      if (e.key === "Escape") {
        // 1.1.2 bugfix — if the T-popup is open, let the popup handle
        // Esc (it closes itself via onClose, which clears tagPickerPos).
        // We MUST early-return so we don't ALSO clear the selection,
        // which would unmount the popup before its onClose runs and
        // leave tagPickerPos stuck non-null — the "ghost reopen" bug
        // diagnosed 2026-05-24 PM (credit: user spotted that the
        // popup was "still open, just not rendering").
        if (tagPickerPos) return;
        if (selection.size > 0) {
          setSelection(new Set());
          return;
        }
      }
      // 1.1.1 — "T" opens the tag picker popup for the current
      // selection. Floats near the cursor. No-op when nothing selected
      // (would have nothing to tag).
      if ((e.key === "t" || e.key === "T") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isTyping) return;
        if (selection.size === 0) return;
        // Reject if the picker just closed (within 300ms). Defends
        // against accidental keyrepeat + the spurious-reopen race
        // reported 2026-05-24.
        if (Date.now() - tagPickerClosedAtRef.current < 300) return;
        // Reject if popup is already open — pressing T while it's
        // showing should NOT teleport it to a new cursor position.
        if (tagPickerPos) return;
        e.preventDefault();
        setTagPickerPos({ ...lastMouseRef.current });
        return;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // multiSelected.size and `filtered` are read from the closure on
    // every keystroke; re-binding on each render keeps them fresh.
  });

  // Client-side platform + bucket filtering on top of what SQL gives us.
  const filteredRaw = useMemo(() => {
    return assets.filter((a) => {
      if (activePlatforms.size > 0 && !activePlatforms.has(a.platform)) return false;
      if (activeBuckets.size > 0 && !activeBuckets.has(bucketFor(a.downloaded_at))) return false;
      if (activeKinds.size > 0 && !activeKinds.has(a.kind)) return false;
      return true;
    });
  }, [assets, activePlatforms, activeBuckets, activeKinds]);

  // Kind counts for the FilterPopup. Reflects post-SQL set (same
  // shape as platformCounts/bucketCounts) so chip numbers update with
  // tag/scope/folder filters.
  const kindCounts = useMemo(() => {
    const m: Record<AssetKind, number> = { video: 0, audio: 0 };
    for (const a of assets) m[a.kind] = (m[a.kind] ?? 0) + 1;
    return m;
  }, [assets]);

  // 1.1.1 — apply sort on top of the filtered set. Stable sort across
  // a copy so React re-uses card identities where it can. Default is
  // "recent" which matches the backend's downloaded_at DESC order, so
  // the default sort is effectively a no-op (still cheap).
  const filtered = useMemo(() => {
    const arr = [...filteredRaw];
    switch (sortMode) {
      case "recent":
        arr.sort((a, b) => b.downloaded_at - a.downloaded_at);
        break;
      case "oldest":
        arr.sort((a, b) => a.downloaded_at - b.downloaded_at);
        break;
      case "name_az":
        arr.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
        break;
      case "name_za":
        arr.sort((a, b) => b.title.localeCompare(a.title, undefined, { sensitivity: "base" }));
        break;
      case "size_desc":
        arr.sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0));
        break;
      case "size_asc":
        arr.sort((a, b) => (a.file_size ?? 0) - (b.file_size ?? 0));
        break;
      case "duration_desc":
        arr.sort((a, b) => (b.duration_sec ?? 0) - (a.duration_sec ?? 0));
        break;
      case "duration_asc":
        arr.sort((a, b) => (a.duration_sec ?? 0) - (b.duration_sec ?? 0));
        break;
    }
    return arr;
  }, [filteredRaw, sortMode]);

  // 1.1.1 — apply a tag delta (add + remove) across the current
  // selection. Each asset gets its own `tag_set_for_asset` call with
  // the computed final list. N round trips but fine for typical
  // selection sizes (<100); a future batch command can replace this.
  // Also pushes any newly added tags into a "recently used" list in
  // localStorage so the picker can surface them above the rest.
  async function applyTagDelta(toAdd: string[], toRemove: string[]) {
    const removeSet = new Set(toRemove.map((t) => t.toLowerCase()));
    const targets = Array.from(selection)
      .map((id) => assets.find((a) => a.id === id))
      .filter((a): a is Asset => !!a);
    try {
      await Promise.all(
        targets.map((a) => {
          const next = a.tags.filter((t) => !removeSet.has(t.toLowerCase()));
          for (const t of toAdd) {
            if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
          }
          return invoke("tag_set_for_asset", { assetId: a.id, tags: next });
        }),
      );
      if (toAdd.length > 0) bumpRecentTags(toAdd);
    } catch (e) {
      await alertDialog(`Tag update failed: ${String(e)}`, { title: "Tag failed", kind: "error" });
    }
  }

  // Compute platform counts from the SQL-filtered set so they reflect
  // the current tag/search filter context. Same for bucket counts.
  const platformCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assets) m.set(a.platform, (m.get(a.platform) ?? 0) + 1);
    return m;
  }, [assets]);

  const bucketCounts = useMemo(() => {
    const m: Record<Bucket, number> = { now: 0, today: 0, week: 0, month: 0, older: 0 };
    for (const a of assets) m[bucketFor(a.downloaded_at)]++;
    return m;
  }, [assets]);

  const visibleTags = allTags.filter((t) =>
    !tagFilter.trim() || t.name.toLowerCase().includes(tagFilter.trim().toLowerCase()),
  );

  // 1.1 Phase 3 — `visibleTags` (tag-name search filter) currently
  // unused; the popup includes its own search input internally. Will
  // wire up if we add an external tag search later.
  void visibleTags;
  void setTagFilter;

  const hasFilters =
    debouncedQuery !== "" ||
    activeTags.size > 0 ||
    activePlatforms.size > 0 ||
    activeBuckets.size > 0 ||
    activeKinds.size > 0;

  function clearAll() {
    setQuery("");
    setActiveTags(new Set());
    setActivePlatforms(new Set());
    setActiveBuckets(new Set());
    setActiveKinds(new Set());
  }

  function togglePlatform(p: string) {
    setActivePlatforms((prev) => toggle(prev, p));
  }
  function toggleTag(t: string) {
    setActiveTags((prev) => toggle(prev, t));
  }
  function toggleBucket(b: Bucket) {
    setActiveBuckets((prev) => toggle(prev, b));
  }
  function toggleKind(k: AssetKind) {
    setActiveKinds((prev) => toggle(prev, k));
  }

  return (
    <div className="content">
      <div className="content-header">
        <div className="ch-title">
          {inTrash ? "Trash" : scope.kind === "library" ? "Library" : scope.name}
        </div>
        <span className="ch-meta">
          {!inTrash && scope.kind === "project" && (
            <>
              <span className="mono faint">project</span>
              <span className="ch-sep"> · </span>
            </>
          )}
          {(inTrash ? assets.length : count).toLocaleString()}{" "}
          {(inTrash ? assets.length : count) === 1 ? "clip" : "clips"} ·{" "}
          {fmtBytes(totalSize(assets))}
        </span>
        <div className="ch-spacer" />
        <div className="ch-tabs">
          <button
            className={"ch-tab" + (viewMode === "grid" ? " active" : "")}
            title="Grid view"
            onClick={() => setViewMode("grid")}
          >
            <Icon.grid width={11} height={11} /> Grid
          </button>
          <button
            className={"ch-tab" + (viewMode === "list" ? " active" : "")}
            title="List view"
            onClick={() => setViewMode("list")}
          >
            <Icon.list width={12} height={12} /> List
          </button>
        </div>
      </div>

      {!inTrash && assets.some((a) => a.missing) && (
        <div className="lib-missing-banner">
          <span className="lib-missing-banner-text">
            ⚠ {assets.filter((a) => a.missing).length}{" "}
            {assets.filter((a) => a.missing).length === 1 ? "clip is" : "clips are"} missing — their
            files were moved or deleted on disk.
          </span>
          <button className="btn btn-secondary" onClick={() => void removeMissing()}>
            <Icon.trash width={11} height={11} /> Remove missing
          </button>
        </div>
      )}

      <div className={"lib-wrap" + (draggingCount > 0 ? " dragging" : "")}>
        <aside className="lib-side">
          {/* 1.1.7 — Vault-style sidebar layout. Two sections:
              VIEWS (system pseudo-entries: All clips + Uncategorized)
              and FOLDERS (user folders with "+" to create).
              Section headers use small uppercase mono labels. */}
          <div className="lib-side-head lib-section-head">
            <span>Views</span>
          </div>
          <ul className="lib-folders lib-views">
            <li
              className={"lib-folder" + (folderFilter.kind === "any" && !inTrash ? " active" : "")}
              onClick={() => {
                setInTrash(false);
                setFolderFilter({ kind: "any" });
              }}
              data-folder-key="__all__"
            >
              <Icon.library width={11} height={11} />
              <span className="lib-folder-name">All clips</span>
              <span className="lib-folder-count mono">{count}</span>
            </li>
            <li
              className={
                "lib-folder" +
                (folderFilter.kind === "uncategorized" && !inTrash ? " active" : "") +
                (folderDropHover === "__uncategorized__" ? " drop-hover" : "")
              }
              onClick={() => {
                setInTrash(false);
                setFolderFilter({ kind: "uncategorized" });
              }}
              data-folder-key="__uncategorized__"
              title="Clips not assigned to any folder · drop here to clear folder"
            >
              <Icon.folder width={11} height={11} />
              <span className="lib-folder-name">Uncategorized</span>
              {/* 1.1 Phase 2 — derive uncategorized count from
                  (scope total) − (sum of folder.asset_count). Folders
                  are orthogonal to scope, so every clip in the
                  current scope either has a folder or doesn't. */}
              <span className="lib-folder-count mono">
                {Math.max(0, count - folders.reduce((acc, f) => acc + f.asset_count, 0))}
              </span>
            </li>
            {/* 1.3.0 — in-app Trash view. Always visible; badge shows the
                trashed count. */}
            <li
              className={"lib-folder" + (inTrash ? " active" : "")}
              onClick={() => setInTrash(true)}
              data-folder-key="__trash__"
              title="Deleted clips — restore or permanently remove"
            >
              <Icon.trash width={11} height={11} />
              <span className="lib-folder-name">Trash</span>
              <span className="lib-folder-count mono">{trashCount}</span>
            </li>
          </ul>
          <div className="lib-side-head lib-section-head lib-folders-head">
            <span>Folders <span className="mono faint" style={{ fontSize: 10, marginLeft: 4 }}>{folders.length}</span></span>
            <button
              type="button"
              className="lib-folder-add-btn"
              onClick={() => void createFolderInline()}
              disabled={creatingFolder}
              title="Create folder"
            >
              <Icon.plus width={11} height={11} />
            </button>
          </div>
          <ul className="lib-folders">
            {folders.map((f) => {
              const isActive = folderFilter.kind === "id" && folderFilter.id === f.id && !inTrash;
              const isRenaming = renamingFolderId === f.id;
              return (
                <li
                  key={f.id}
                  className={
                    "lib-folder" +
                    (isActive ? " active" : "") +
                    (folderDropHover === f.id ? " drop-hover" : "")
                  }
                  onClick={() => {
                    if (!isRenaming) {
                      setInTrash(false);
                      setFolderFilter({ kind: "id", id: f.id });
                    }
                  }}
                  onDoubleClick={() => {
                    setRenamingFolderId(f.id);
                    setRenameFolderDraft(f.name);
                  }}
                  title="Click to filter · Double-click to rename · Right-click for more · Drop clips here to move"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setFolderCtxMenu({ x: e.clientX, y: e.clientY, folder: f });
                  }}
                  data-folder-key={f.id}
                >
                  <Icon.folder width={11} height={11} />
                  {isRenaming ? (
                    <input
                      className="lib-folder-rename"
                      value={renameFolderDraft}
                      onChange={(e) => setRenameFolderDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void renameFolder(f.id);
                        else if (e.key === "Escape") {
                          setRenamingFolderId(null);
                          setRenameFolderDraft("");
                        }
                      }}
                      onBlur={() => void renameFolder(f.id)}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                      maxLength={80}
                      spellCheck={false}
                    />
                  ) : (
                    <span className="lib-folder-name">{f.name}</span>
                  )}
                  <span className="lib-folder-count mono">{f.asset_count}</span>
                </li>
              );
            })}
          </ul>

          {/* 1.1 Phase 2 — filter sections (Source / Tags / Added)
              removed. They're moving into the Eagle-style tag/filter
              popup in Phase 3. State + computations preserved at the
              top of LibraryPage so re-wiring is a render-only change. */}
        </aside>

        <div className="lib-main">
          <div className="lib-toolbar">
            <div className="lib-search">
              <Icon.search width={13} height={13} style={{ color: "var(--text-2)" }} />
              <input
                type="text"
                placeholder="search title or channel…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                spellCheck={false}
                autoFocus
              />
              <span className="kbd">/</span>
            </div>
            {/* 1.1 Phase 3 — Filter button opens the multi-category
                popup (Source / Tags / Added). Active-count badge sums
                the three filter sets so the user can see at a glance
                "I have N filters on" before clicking. */}
            <button
              ref={filterBtnRef}
              type="button"
              className={"btn btn-secondary lib-filter-btn" + (filterPopupOpen ? " open" : "")}
              onClick={() => {
                setFilterPopupOpen((v) => !v);
                setTagFilterPopupOpen(false);
                setSortPopupOpen(false);
              }}
              title="Source + added date filters"
            >
              <Icon.filter width={12} height={12} />
              Filter
              {(activePlatforms.size + activeBuckets.size + activeKinds.size) > 0 && (
                <span className="lib-filter-badge mono">
                  {activePlatforms.size + activeBuckets.size + activeKinds.size}
                </span>
              )}
            </button>
            {/* 1.1.1 — Tags split into its own popup; long projects will
                have many tags and they deserve a search/scroll surface
                separate from the source/date filters. */}
            <button
              ref={tagBtnRef}
              type="button"
              className={"btn btn-secondary lib-filter-btn" + (tagFilterPopupOpen ? " open" : "")}
              onClick={() => {
                setTagFilterPopupOpen((v) => !v);
                setFilterPopupOpen(false);
                setSortPopupOpen(false);
              }}
              title="Filter by tags"
            >
              <Icon.tag width={12} height={12} />
              Tags
              {activeTags.size > 0 && (
                <span className="lib-filter-badge mono">{activeTags.size}</span>
              )}
            </button>
            {/* 1.1.1 — Sort dropdown. Client-side only; default order
                matches the backend's downloaded_at DESC. */}
            <button
              ref={sortBtnRef}
              type="button"
              className={"btn btn-secondary lib-filter-btn" + (sortPopupOpen ? " open" : "")}
              onClick={() => {
                setSortPopupOpen((v) => !v);
                setFilterPopupOpen(false);
                setTagFilterPopupOpen(false);
              }}
              title={`Sort: ${sortLabel(sortMode)}`}
            >
              <Icon.list width={12} height={12} />
              {sortLabel(sortMode)}
            </button>
            <div className="ch-spacer" />
            {/* 1.3.0 — in Trash, Restore/Empty live inline in the toolbar
                so the grid never shifts (no full-width banner). They act
                on the selection, or everything when nothing's selected. */}
            {inTrash && assets.length > 0 && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary lib-filter-btn"
                  onClick={() =>
                    void restoreFromTrash(
                      selection.size > 0 ? [...selection] : assets.map((a) => a.id),
                    )
                  }
                  title="Restore to original location"
                >
                  <Icon.retry width={12} height={12} />
                  {selection.size > 0 ? `Restore (${selection.size})` : "Restore all"}
                </button>
                <button
                  type="button"
                  className="btn btn-danger lib-filter-btn"
                  onClick={() =>
                    void emptyTrash(selection.size > 0 ? [...selection] : assets.map((a) => a.id))
                  }
                  title="Permanently delete (cannot be undone)"
                >
                  <Icon.trash width={12} height={12} />
                  {selection.size > 0 ? `Delete ${selection.size}` : "Empty trash"}
                </button>
              </>
            )}
            <span className="mono faint" style={{ fontSize: 11 }}>
              {inTrash
                ? `${filtered.length.toLocaleString()} in trash`
                : `${filtered.length.toLocaleString()} of ${count.toLocaleString()}`}
            </span>
          </div>

          {hasFilters && (
            <div className="lib-active-filters">
              <span className="mono faint" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Filters
              </span>
              {debouncedQuery && (
                <span className="tag">
                  "{debouncedQuery}"
                  <button className="x" onClick={() => setQuery("")} aria-label="Clear search">
                    <Icon.x width={9} height={9} />
                  </button>
                </span>
              )}
              {Array.from(activeTags).map((t) => (
                <span key={t} className="tag amber">
                  {t}
                  <button className="x" onClick={() => toggleTag(t)} aria-label={`Remove tag filter ${t}`}>
                    <Icon.x width={9} height={9} />
                  </button>
                </span>
              ))}
              {Array.from(activePlatforms).map((p) => (
                <span key={p} className="tag">
                  {platformLabel(p)}
                  <button className="x" onClick={() => togglePlatform(p)} aria-label={`Remove platform filter ${p}`}>
                    <Icon.x width={9} height={9} />
                  </button>
                </span>
              ))}
              {Array.from(activeBuckets).map((b) => (
                <span key={b} className="tag">
                  {bucketLabel(b)}
                  <button className="x" onClick={() => toggleBucket(b)} aria-label={`Remove date filter ${b}`}>
                    <Icon.x width={9} height={9} />
                  </button>
                </span>
              ))}
              {Array.from(activeKinds).map((k) => (
                <span key={k} className="tag">
                  {k === "audio" ? "Audio" : "Video"}
                  <button className="x" onClick={() => toggleKind(k)} aria-label={`Remove kind filter ${k}`}>
                    <Icon.x width={9} height={9} />
                  </button>
                </span>
              ))}
              <button className="clear-all" onClick={clearAll}>
                Clear all <span className="kbd">esc</span>
              </button>
            </div>
          )}

          {err && (
            <div className="msg-row err" style={{ margin: "14px 14px 0" }}>
              <span className="label">library error</span>
              <code>{err}</code>
            </div>
          )}

          <div
            className="lib-grid-scroll"
            ref={gridScrollRef}
            onMouseDown={startBoxDrag}
          >
            {filtered.length === 0 ? (
              <EmptyState
                hasFilters={hasFilters}
                totalCount={count}
                scopeName={scope.kind === "project" ? scope.name : null}
                inTrash={inTrash}
              />
            ) : viewMode === "list" ? (
              <div
                className="lib-list"
                role="list"
                style={
                  {
                    "--col-title-fr": `${colRatios.title}fr`,
                    "--col-tags-fr": `${colRatios.tags}fr`,
                    "--col-res-fr": `${colRatios.res}fr`,
                    "--col-dur-fr": `${colRatios.dur}fr`,
                    "--col-size-fr": `${colRatios.size}fr`,
                    "--col-date-fr": `${colRatios.date}fr`,
                  } as React.CSSProperties
                }
              >
                <ListHead
                  sortMode={sortMode}
                  onSort={setSortMode}
                  ratios={colRatios}
                  onResize={setColRatios}
                />

                {filtered.map((a) => (
                  <LibRow
                    key={a.id}
                    asset={a}
                    selected={selection.has(a.id)}
                    onDragStart={(ev) => onCardDragStart(a, ev)}
                    onClick={(ev) => handleCardClick(a, ev)}
                    onDoubleClick={() => void handleCardDoubleClick(a)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (!selection.has(a.id)) {
                        setSelection(new Set([a.id]));
                        setAnchor(a.id);
                      }
                      setContextMenu({ x: e.clientX, y: e.clientY, asset: a });
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="lib-grid">
                {filtered.map((a) => (
                  <LibCard
                    key={a.id}
                    asset={a}
                    selected={selection.has(a.id)}
                    onDragStart={(ev) => onCardDragStart(a, ev)}
                    onClick={(ev) => handleCardClick(a, ev)}
                    onDoubleClick={() => void handleCardDoubleClick(a)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      // Right-click on an unselected card replaces the
                      // selection with that card. Right-click on a
                      // card that's already in the selection leaves
                      // the selection alone so the context menu can
                      // act on it (future-friendly when the menu
                      // grows batch actions).
                      if (!selection.has(a.id)) {
                        setSelection(new Set([a.id]));
                        setAnchor(a.id);
                      }
                      setContextMenu({ x: e.clientX, y: e.clientY, asset: a });
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="lib-status">
            <span>
              {selection.size > 0
                ? `${selection.size} of ${filtered.length} selected`
                : `${filtered.length} shown`}
            </span>
            <span className="sep">·</span>
            <span>{fmtBytes(totalSize(filtered))}</span>
            <div className="right">
              <span><span className="kbd">/</span> search</span>
              <span><span className="kbd">esc</span> clear</span>
              <span><span className="kbd">t</span> tag selected</span>
              <span><span className="kbd">⏎</span> open (dbl-click)</span>
            </div>
          </div>
        </div>

        {/* 1.1 — Eagle-style always-on inspector panel. Replaces the
            modal AssetDrawer. Renders empty / single / batch state
            based on the current selection set. */}
        <InspectorPanel
          selection={selection}
          assets={filtered}
          allAssets={assets}
          knownTags={allTags}
          folders={folders}
          bulkDeleting={bulkDeleting}
          onClearSelection={() => setSelection(new Set())}
          onSelectOne={(id) => {
            setSelection(new Set([id]));
            setAnchor(id);
          }}
          onBulkDelete={() => void bulkDelete()}
          onMoveToFolder={(folderId) => void moveSelectionToFolder(folderId)}
        />
      </div>

      {/* 1.1 — marquee selection rectangle overlay. Rendered fixed-
          positioned in viewport coords so it follows the mouse
          regardless of scroll. */}
      {dragRect && (
        <div
          className="lib-drag-rect"
          style={{
            left: dragRect.x,
            top: dragRect.y,
            width: dragRect.w,
            height: dragRect.h,
          }}
        />
      )}

      {contextMenu && (
        <CardContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          asset={contextMenu.asset}
          // Freeze the selection at menu-open time so the action runs
          // on what the user saw. Always includes the right-clicked
          // card (the onContextMenu handler enforces this).
          selectionIds={
            selection.has(contextMenu.asset.id)
              ? Array.from(selection)
              : [contextMenu.asset.id]
          }
          inTrash={inTrash}
          onClose={() => setContextMenu(null)}
          onMoveToTrash={(ids) => void moveToTrash(ids)}
          onRestore={(ids) => void restoreFromTrash(ids)}
          onDeleteForever={(ids) => void emptyTrash(ids)}
        />
      )}

      {/* 1.1 Phase 3 — multi-category filter popup. Anchored to the
          Filter button in the toolbar; positions itself in viewport
          coords via the anchor's getBoundingClientRect. */}
      {filterPopupOpen && (
        <FilterPopup
          anchorRef={filterBtnRef}
          platformCounts={platformCounts}
          bucketCounts={bucketCounts}
          kindCounts={kindCounts}
          activePlatforms={activePlatforms}
          activeBuckets={activeBuckets}
          activeKinds={activeKinds}
          onTogglePlatform={togglePlatform}
          onToggleBucket={toggleBucket}
          onToggleKind={toggleKind}
          onClearAll={() => {
            setActivePlatforms(new Set());
            setActiveBuckets(new Set());
            setActiveKinds(new Set());
          }}
          onClose={() => setFilterPopupOpen(false)}
        />
      )}

      {/* 1.1.1 — Tag filter popup (Eagle-style two-column). Anchored
          to the Tags button in the toolbar. */}
      {tagFilterPopupOpen && (
        <TagFilterPopup
          anchorRef={tagBtnRef}
          knownTags={allTags}
          activeTags={activeTags}
          onToggleTag={toggleTag}
          onClearTags={() => setActiveTags(new Set())}
          onClose={() => setTagFilterPopupOpen(false)}
        />
      )}

      {/* 1.1.1 — Sort dropdown. Anchored to the Sort button. */}
      {sortPopupOpen && (
        <SortPopup
          anchorRef={sortBtnRef}
          current={sortMode}
          onPick={(m) => {
            setSortMode(m);
            setSortPopupOpen(false);
          }}
          onClose={() => setSortPopupOpen(false)}
        />
      )}

      {/* 1.1.1 — Press-T tag picker popup. Floats near the cursor when
          opened; assigns/unassigns tags on the current selection (1 or
          many). Distinct from TagFilterPopup, which filters the view.
          1.1.2 bugfix — render gate is `tagPickerPos` alone, NOT also
          `selection.size > 0`. If selection clears while popup is open,
          the popup itself closes via its own useEffect on empty
          selection (below). Gating on both caused the popup to unmount
          without onClose, leaving tagPickerPos stuck non-null and
          re-mounting the popup the next time selection became > 0. */}
      {tagPickerPos && (
        <TagPickerPopup
          x={tagPickerPos.x}
          y={tagPickerPos.y}
          selection={Array.from(selection)
            .map((id) => assets.find((a) => a.id === id))
            .filter((a): a is Asset => !!a)}
          knownTags={allTags}
          onApply={(toAdd, toRemove) => void applyTagDelta(toAdd, toRemove)}
          onClose={() => {
            tagPickerClosedAtRef.current = Date.now();
            setTagPickerPos(null);
            // Also blur whatever has focus — if focus stayed on the
            // popup's input as it unmounted, focus could land somewhere
            // unexpected and propagate stray keys.
            (document.activeElement as HTMLElement | null)?.blur?.();
          }}
        />
      )}

      {/* 1.1 Phase 2 — folder right-click menu (Rename / Delete). */}
      {folderCtxMenu && (
        <FolderContextMenu
          x={folderCtxMenu.x}
          y={folderCtxMenu.y}
          folder={folderCtxMenu.folder}
          onClose={() => setFolderCtxMenu(null)}
          onRename={() => {
            setRenamingFolderId(folderCtxMenu.folder.id);
            setRenameFolderDraft(folderCtxMenu.folder.name);
            setFolderCtxMenu(null);
          }}
          onDelete={() => {
            const f = folderCtxMenu.folder;
            setFolderCtxMenu(null);
            void deleteFolder(f);
          }}
        />
      )}
    </div>
  );
}

// =====================================================================
// Right-click context menu for library cards (0.9 UX win #6)
// =====================================================================

/**
 * Floating menu rendered at (x, y) with the common per-asset actions
 * that previously required opening the drawer. Dismissed by:
 *   - Clicking outside the menu
 *   - Pressing Escape
 *   - Scrolling (menus that drift off their anchor feel broken)
 *   - Window resize (ditto)
 *   - Activating any of its own actions
 *
 * Positions are clamped to the viewport so the menu never renders off-
 * screen. Falls back to opening above the cursor when there isn't
 * enough room below.
 */
function CardContextMenu({
  x,
  y,
  asset,
  selectionIds,
  inTrash,
  onClose,
  onMoveToTrash,
  onRestore,
  onDeleteForever,
}: {
  x: number;
  y: number;
  /** Card the user right-clicked. Used for per-file actions (Open,
   *  Reveal, Copy URL/path) which don't make sense across multiple
   *  files. */
  asset: Asset;
  /** Current selection at menu-open time. Always includes `asset.id`
   *  (the right-click handler ensures this). Length is the "act on N"
   *  count shown in destructive labels. */
  selectionIds: string[];
  /** When true, swaps Move-to-Trash for Restore/Delete-forever. */
  inTrash: boolean;
  onClose: () => void;
  onMoveToTrash: (ids: string[]) => void | Promise<void>;
  onRestore: (ids: string[]) => void | Promise<void>;
  onDeleteForever: (ids: string[]) => void | Promise<void>;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  // Adjust position to fit in viewport. ResizeObserver / layout effect
  // would be over-engineered for a transient menu — pick a sensible
  // estimated height and clamp on initial render.
  const ESTIMATED_HEIGHT = 280;
  const ESTIMATED_WIDTH = 220;
  const vh = typeof window !== "undefined" ? window.innerHeight : 1000;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1600;
  const adjX = Math.min(x, vw - ESTIMATED_WIDTH - 8);
  const adjY = y + ESTIMATED_HEIGHT > vh ? Math.max(8, y - ESTIMATED_HEIGHT) : y;

  // Dismiss handlers
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [onClose]);

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.warn("clipboard write failed:", e);
    }
  }

  // Non-destructive actions: close the menu first, then run. Safe
  // because there's no destructive prompt that could get suppressed.
  function withClose(action: () => void | Promise<void>) {
    return () => {
      onClose();
      void Promise.resolve(action());
    };
  }

  // 1.3.0 — multi-select aware. Per-file actions (Open, Reveal, Copy)
  // always target the right-clicked card, never the wider selection
  // (you can't "open 5 files at once" meaningfully). Destructive
  // actions act on the WHOLE selection and surface the count in their
  // label so the user can see what they're about to do.
  const count = selectionIds.length;
  const multi = count > 1;
  const suffix = multi ? ` (${count})` : "";

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ top: adjY, left: adjX }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Per-file: act on the right-clicked card only. */}
      <button className="ctx-item" onClick={withClose(() => openFileInDefaultApp(asset.file_path))}>
        <Icon.folder width={11} height={11} />
        Open
      </button>
      <button className="ctx-item" onClick={withClose(() => revealFile(asset.file_path))}>
        <Icon.folder width={11} height={11} />
        Reveal in Explorer
      </button>
      <div className="ctx-sep" />
      <button className="ctx-item" onClick={withClose(() => copyToClipboard(asset.source_url))}>
        Copy source URL
      </button>
      <button className="ctx-item" onClick={withClose(() => copyToClipboard(asset.file_path))}>
        Copy file path
      </button>
      <div className="ctx-sep" />
      {/* Destructive actions: act on the whole selection. Branch on
          where we are — Library vs the Trash view get different verbs. */}
      {inTrash ? (
        <>
          <button
            className="ctx-item"
            onClick={withClose(() => onRestore(selectionIds))}
          >
            <Icon.retry width={11} height={11} />
            Restore{suffix}
          </button>
          <button
            className="ctx-item ctx-danger"
            onClick={withClose(() => onDeleteForever(selectionIds))}
          >
            <Icon.trash width={11} height={11} />
            Delete forever{suffix}
          </button>
        </>
      ) : (
        <button
          className="ctx-item ctx-danger"
          onClick={withClose(() => onMoveToTrash(selectionIds))}
        >
          <Icon.trash width={11} height={11} />
          Move to Trash{suffix}
        </button>
      )}
    </div>
  );
}

// =====================================================================
// 1.1 Phase 2 — Folder context menu (Rename / Delete)
// =====================================================================
//
// Same shape as CardContextMenu — floating div positioned at click
// coords with viewport-clamp, dismissed via click-outside / Esc /
// scroll / resize. Two actions for MVP; can grow (Move, Color,
// duplicate, etc.) without changing the host wiring.

function FolderContextMenu({
  x,
  y,
  folder,
  onClose,
  onRename,
  onDelete,
}: {
  x: number;
  y: number;
  folder: Folder;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const ESTIMATED_HEIGHT = 90;
  const ESTIMATED_WIDTH = 180;
  const vh = typeof window !== "undefined" ? window.innerHeight : 1000;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1600;
  const adjX = Math.min(x, vw - ESTIMATED_WIDTH - 8);
  const adjY = y + ESTIMATED_HEIGHT > vh ? Math.max(8, y - ESTIMATED_HEIGHT) : y;

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ top: adjY, left: adjX }}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
      aria-label={`Folder actions for ${folder.name}`}
    >
      {/* Mirror CardContextMenu's class structure (.ctx-item, .ctx-sep,
          .ctx-danger) so the two menus share the same visual treatment
          via the existing .ctx-menu CSS. The folder name shows at the
          top as a non-interactive label — same row pattern but in a
          dimmed style via .ctx-label. */}
      <div className="ctx-label">{folder.name}</div>
      <div className="ctx-sep" />
      <button className="ctx-item" onClick={onRename}>
        <Icon.folder width={11} height={11} />
        Rename
      </button>
      <button className="ctx-item ctx-danger" onClick={onDelete}>
        <Icon.trash width={11} height={11} />
        Delete folder
      </button>
    </div>
  );
}

// =====================================================================
// 1.1 Phase 3 — Multi-category filter popup (Eagle-style)
// =====================================================================
//
// Replaces the Source / Tags / Added sidebar facets that got dropped
// in Phase 2 to make room for folders. Triggered by the Filter button
// in the library toolbar; anchors below it via the anchor ref.
//
// Three sections:
//   - Source    (platform, e.g. youtube/twitter) — multi-select OR
//   - Tags      (user-defined, multi-select AND — narrows results)
//   - Added     (now/today/week/month/older — multi-select OR)
//
// State is owned by LibraryPage; the popup is a pure presenter that
// dispatches toggle/clear callbacks. Stays open after a toggle so
// the user can multi-select rapidly. Closed via:
//   - Click outside (mousedown listener at document level)
//   - Esc keypress
//   - Click the trigger button again (toggles via parent state)
//
// MVP scope:
//   - Flat row list per section, with counts
//   - Inline search at the top to filter tag names
//   - "Clear all" footer button
//   - No Include/Exclude split (Eagle has L-click select, R-click
//     exclude — defer until requested)
//   - No collapsible sections (small enough to show all)

function FilterPopup({
  anchorRef,
  platformCounts,
  bucketCounts,
  kindCounts,
  activePlatforms,
  activeBuckets,
  activeKinds,
  onTogglePlatform,
  onToggleBucket,
  onToggleKind,
  onClearAll,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  platformCounts: Map<string, number>;
  bucketCounts: Record<Bucket, number>;
  kindCounts: Record<AssetKind, number>;
  activePlatforms: Set<string>;
  activeBuckets: Set<Bucket>;
  activeKinds: Set<AssetKind>;
  onTogglePlatform: (p: string) => void;
  onToggleBucket: (b: Bucket) => void;
  onToggleKind: (k: AssetKind) => void;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);

  // Position calculated from the anchor button's bounding rect.
  // Recomputes only on mount; we close the popup on scroll/resize
  // (anchor would drift otherwise — same pattern as CardContextMenu).
  const POPUP_WIDTH = 340;
  const anchorRect = anchorRef.current?.getBoundingClientRect();
  const top = anchorRect ? anchorRect.bottom + 6 : 60;
  const right =
    anchorRect && typeof window !== "undefined"
      ? Math.max(8, window.innerWidth - anchorRect.right)
      : 16;

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      // Don't close when clicking the anchor button itself — its own
      // click handler toggles popup open/closed.
      if (anchorRef.current?.contains(e.target as Node)) return;
      if (!popupRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [onClose, anchorRef]);

  const activeCount = activePlatforms.size + activeBuckets.size + activeKinds.size;

  return (
    <div
      ref={popupRef}
      className="filter-popup"
      style={{ top, right, width: POPUP_WIDTH }}
      role="dialog"
      aria-label="Filters"
    >
      <div className="filter-popup-head">
        <span className="filter-popup-title">Filters</span>
        {activeCount > 0 && (
          <button
            type="button"
            className="filter-popup-clear"
            onClick={onClearAll}
            title="Clear all active filters"
          >
            Clear all
          </button>
        )}
      </div>

      <FilterSection title="Source">
        {platformCounts.size === 0 ? (
          <FilterEmpty label="no downloads yet" />
        ) : (
          Array.from(platformCounts.entries()).map(([plat, ct]) => (
            <FilterRow
              key={plat}
              active={activePlatforms.has(plat)}
              label={platformLabel(plat)}
              count={ct}
              onClick={() => onTogglePlatform(plat)}
            />
          ))
        )}
      </FilterSection>

      {/* 1.1.1 — Tags now live in their own popup (Tags button beside
          Filter). Source + Added only here. */}

      <FilterSection title="Kind">
        <FilterRow
          active={activeKinds.has("video")}
          label="Video"
          count={kindCounts.video}
          onClick={() => onToggleKind("video")}
        />
        <FilterRow
          active={activeKinds.has("audio")}
          label="Audio"
          count={kindCounts.audio}
          onClick={() => onToggleKind("audio")}
        />
      </FilterSection>

      <FilterSection title="Added">
        {(["now", "today", "week", "month", "older"] as Bucket[]).map((b) => (
          <FilterRow
            key={b}
            active={activeBuckets.has(b)}
            label={bucketLabel(b)}
            count={bucketCounts[b]}
            onClick={() => onToggleBucket(b)}
          />
        ))}
      </FilterSection>
    </div>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="filter-section">
      <div className="filter-section-head">{title}</div>
      <div className="filter-section-body">{children}</div>
    </div>
  );
}

function FilterRow({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"filter-row" + (active ? " active" : "")}
      onClick={onClick}
    >
      <span className="filter-row-check">{active ? "✓" : ""}</span>
      <span className="filter-row-label">{label}</span>
      <span className="filter-row-count mono">{count}</span>
    </button>
  );
}

function FilterEmpty({ label }: { label: string }) {
  return <div className="filter-empty">{label}</div>;
}

// =====================================================================
// Helpers
// =====================================================================

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

function totalSize(assets: Asset[]): number {
  let n = 0;
  for (const a of assets) n += a.file_size ?? 0;
  return n;
}

function platformLabel(p: string): string {
  switch (p.toLowerCase()) {
    case "youtube":
      return "YouTube";
    case "twitter":
    case "x":
      return "Twitter / X";
    case "pinterest":
      return "Pinterest";
    case "tiktok":
      return "TikTok";
    default:
      return p;
  }
}

function bucketLabel(b: Bucket): string {
  switch (b) {
    case "now":
      return "Just now";
    case "today":
      return "Today";
    case "week":
      return "This week";
    case "month":
      return "This month";
    case "older":
      return "Older";
  }
}

const DAY = 86_400;
// "Just now" = downloaded within the last 5 minutes. Tuned for the
// "did my download finish? where is it?" workflow — short enough to
// be useful as a session highlight, long enough that a slow
// download + transcode pair still falls inside the window.
const NOW_WINDOW_SEC = 5 * 60;
function bucketFor(downloaded_at: number): Bucket {
  const now = Math.floor(Date.now() / 1000);
  const ageSec = now - downloaded_at;
  if (ageSec < NOW_WINDOW_SEC) return "now";
  const ageDays = ageSec / DAY;
  if (ageDays < 1) return "today";
  if (ageDays < 7) return "week";
  if (ageDays < 30) return "month";
  return "older";
}

/**
 * Same window logic but as a quick boolean check the card renderer
 * uses to decide whether to apply the "just downloaded" visual
 * treatment. Kept in sync with bucketFor's "now" bucket.
 */
function isJustNow(downloaded_at: number): boolean {
  return Math.floor(Date.now() / 1000) - downloaded_at < NOW_WINDOW_SEC;
}

// =====================================================================
// Facet sidebar bits
// =====================================================================

function FacetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="lib-group">
      <div className="lib-group-title">
        <Icon.chev width={10} height={10} />
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Facet({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button className={"facet" + (active ? " active" : "")} onClick={onClick}>
      <span className="box">{active && <Icon.check width={10} height={10} />}</span>
      <span className="label">{label}</span>
      <span className="ct">{count.toLocaleString()}</span>
    </button>
  );
}

// =====================================================================
// Card + Empty state
// =====================================================================

function LibCard({
  asset,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
}: {
  asset: Asset;
  /** Whether this card is in the active selection set. Drives the
   *  outlined visual; the inspector picks up details separately. */
  selected: boolean;
  onClick: (ev: React.MouseEvent) => void;
  /** 1.1 — double-click opens the asset's file in the OS default
   *  app. Single click selects (or modifies selection); double-click
   *  is the "actually open the thing" gesture. */
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** 1.1.2 — drag-to-folder. Card is HTML5-draggable; parent fills
   *  the dataTransfer with selected asset IDs. Folder rows accept. */
  onDragStart: (ev: React.DragEvent<HTMLButtonElement>) => void;
}) {
  const thumb = thumbnailSrc(asset.thumbnail_path, asset.thumbnail_url);
  const justNow = isJustNow(asset.downloaded_at);
  // 1.2.0 — audio cards get a slightly different visual treatment:
  //  - thumbnail container shows the waveform on a dark backdrop
  //    (the waveform PNG is transparent so the dark surface shows
  //    through cleanly), with a music-note overlay icon top-right.
  //  - resolution chip swaps for the audio container ("MP3"/"M4A"/"FLAC").
  const isAudio = asset.kind === "audio";
  const className = [
    "lib-card",
    selected ? "selected" : "",
    justNow ? "just-now" : "",
    isAudio ? "audio" : "",
    asset.missing ? "is-missing" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={className}
      data-asset-id={asset.id}
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <div className="thumb">
        <span className="badge">
          {asset.platform === "youtube" ? (
            <>
              <Icon.yt width={9} height={9} style={{ verticalAlign: "-1px" }} /> YT
            </>
          ) : asset.platform === "twitter" || asset.platform === "x" ? (
            <>
              <Icon.twitter width={8} height={8} /> X
            </>
          ) : asset.platform === "pinterest" ? (
            <>
              <Icon.pinterest width={9} height={9} style={{ verticalAlign: "-1px" }} /> PIN
            </>
          ) : asset.platform === "tiktok" ? (
            <>
              <Icon.tiktok width={9} height={9} style={{ verticalAlign: "-1px" }} /> TT
            </>
          ) : (
            asset.platform.toUpperCase()
          )}
        </span>
        {isAudio && (
          <span className="lib-card-audio-glyph" title="Audio">
            <Icon.music width={13} height={13} />
          </span>
        )}
        {asset.missing && (
          <span className="lib-card-missing" title="File not found on disk — moved or deleted">
            ⚠ missing
          </span>
        )}
        {thumb && <img src={thumb} alt="" loading="lazy" />}
        {asset.duration_sec != null && <span className="dur">{fmtDuration(asset.duration_sec)}</span>}
      </div>
      <div className="info">
        <div className="title">{asset.title}</div>
        <div className="sub">
          <span className="ch">{asset.channel ?? "—"}</span>
          {asset.sibling_count > 0 && (
            <span
              className="lib-card-siblings mono"
              title={`${asset.sibling_count} other ${
                asset.sibling_count === 1 ? "clip" : "clips"
              } from the same source`}
            >
              +{asset.sibling_count}
            </span>
          )}
          {isAudio ? (
            <span className="mono">{(asset.codec_audio ?? "audio").toUpperCase()}</span>
          ) : (
            asset.width && asset.height && <span>{asset.height}p</span>
          )}
        </div>
        {asset.tags.length > 0 && (
          <div className="tags">
            {asset.tags.slice(0, 3).map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
            {asset.tags.length > 3 && <span className="tag faint">+{asset.tags.length - 3}</span>}
          </div>
        )}
      </div>
    </button>
  );
}

// 1.3.x — Library list-view row. Same selection / drag / context-menu
// semantics as LibCard (so all the existing handlers work unchanged),
// but laid out as a single horizontal row with a small thumbnail and
// metadata columns. Compact density: ~32px row height. Truncates
// title/channel with ellipsis; tags col shows the first few chips.
function PlatformBadge({ platform }: { platform: string }) {
  if (platform === "youtube") {
    return <><Icon.yt width={9} height={9} style={{ verticalAlign: "-1px" }} /> YT</>;
  }
  if (platform === "twitter" || platform === "x") {
    return <><Icon.twitter width={8} height={8} /> X</>;
  }
  if (platform === "pinterest") {
    return <><Icon.pinterest width={9} height={9} style={{ verticalAlign: "-1px" }} /> PIN</>;
  }
  if (platform === "tiktok") {
    return <><Icon.tiktok width={9} height={9} style={{ verticalAlign: "-1px" }} /> TT</>;
  }
  return <>{platform.toUpperCase()}</>;
}

function LibRow({
  asset,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
}: {
  asset: Asset;
  selected: boolean;
  onClick: (ev: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (ev: React.DragEvent<HTMLButtonElement>) => void;
}) {
  const thumb = thumbnailSrc(asset.thumbnail_path, asset.thumbnail_url);
  const justNow = isJustNow(asset.downloaded_at);
  const isAudio = asset.kind === "audio";
  const className = [
    "lib-row",
    selected ? "selected" : "",
    justNow ? "just-now" : "",
    isAudio ? "audio" : "",
    asset.missing ? "is-missing" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const addedDate = new Date(asset.downloaded_at * 1000);
  const addedStr = addedDate.toLocaleDateString(undefined, {
    year: "2-digit",
    month: "short",
    day: "numeric",
  });
  return (
    <button
      type="button"
      className={className}
      data-asset-id={asset.id}
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      role="listitem"
    >
      <div className="lib-list-col col-thumb">
        <div className="lib-row-thumb">
          {thumb && <img src={thumb} alt="" loading="lazy" />}
          {isAudio && (
            <span className="lib-row-audio-glyph" title="Audio">
              <Icon.music width={10} height={10} />
            </span>
          )}
        </div>
      </div>
      <div className="lib-list-col col-title">
        <span className="lib-row-platform">
          <PlatformBadge platform={asset.platform} />
        </span>
        <span className="lib-row-title" title={asset.title}>
          {asset.title}
        </span>
        {asset.missing && (
          <span className="lib-row-missing" title="File not found on disk">
            ⚠ missing
          </span>
        )}
        {asset.channel && (
          <span className="lib-row-channel" title={asset.channel}>
            · {asset.channel}
          </span>
        )}
        {asset.sibling_count > 0 && (
          <span
            className="lib-row-siblings mono"
            title={`${asset.sibling_count} other ${
              asset.sibling_count === 1 ? "clip" : "clips"
            } from the same source`}
          >
            +{asset.sibling_count}
          </span>
        )}
      </div>
      <div className="lib-list-col col-tags">
        {asset.tags.length === 0 ? (
          <span className="faint">—</span>
        ) : (
          <>
            {asset.tags.slice(0, 3).map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
            {asset.tags.length > 3 && (
              <span className="tag faint">+{asset.tags.length - 3}</span>
            )}
          </>
        )}
      </div>
      <div className="lib-list-col col-res mono">
        {isAudio
          ? (asset.codec_audio ?? "audio").toUpperCase()
          : asset.height
            ? `${asset.height}p`
            : "—"}
      </div>
      <div className="lib-list-col col-dur mono">{fmtDuration(asset.duration_sec)}</div>
      <div className="lib-list-col col-size mono">{fmtBytes(asset.file_size)}</div>
      <div className="lib-list-col col-date mono">{addedStr}</div>
    </button>
  );
}

// 1.3.x — sortable header strip for list view. Clicking a sortable
// column cycles the active SortMode for that column (default direction
// → flipped direction → back to default). Non-sortable columns
// (thumb, tags, res) render as plain labels. The arrow indicator
// shows the active direction in lime; inactive sortable columns
// get a faint two-headed arrow as an affordance.
const COL_SORTS: Record<string, { asc: SortMode; desc: SortMode; defaultDir: "asc" | "desc" }> = {
  title: { asc: "name_az", desc: "name_za", defaultDir: "asc" },
  duration: { asc: "duration_asc", desc: "duration_desc", defaultDir: "desc" },
  size: { asc: "size_asc", desc: "size_desc", defaultDir: "desc" },
  date: { asc: "oldest", desc: "recent", defaultDir: "desc" },
};

function ListHead({
  sortMode,
  onSort,
  ratios,
  onResize,
}: {
  sortMode: SortMode;
  onSort: (m: SortMode) => void;
  ratios: ColRatios;
  onResize: (next: ColRatios) => void;
}) {
  function dirFor(col: keyof typeof COL_SORTS): "asc" | "desc" | null {
    const cfg = COL_SORTS[col];
    if (sortMode === cfg.desc) return "desc";
    if (sortMode === cfg.asc) return "asc";
    return null;
  }
  function clickHeader(col: keyof typeof COL_SORTS) {
    const cfg = COL_SORTS[col];
    const cur = dirFor(col);
    if (cur === null) onSort(cfg[cfg.defaultDir]);
    else if (cur === cfg.defaultDir) onSort(cfg[cfg.defaultDir === "desc" ? "asc" : "desc"]);
    else onSort(cfg[cfg.defaultDir]);
  }
  function Arrow({ col }: { col: keyof typeof COL_SORTS }) {
    const dir = dirFor(col);
    // No arrow on inactive columns — keeps the header strip clean.
    // The active column gets a single ↓ / ↑ glyph in the accent color.
    if (dir === null) return null;
    return <span className="lib-sort-arrow">{dir === "desc" ? "↓" : "↑"}</span>;
  }
  function SortBtn({ col, label }: { col: keyof typeof COL_SORTS; label: string }) {
    return (
      <button
        type="button"
        className={"lib-sort-btn" + (dirFor(col) ? " active" : "")}
        onClick={() => clickHeader(col)}
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <Arrow col={col} />
      </button>
    );
  }
  // Drag handle on a column's right edge. Pair-resize semantics with
  // CASCADE on grow:
  //   • Dragging RIGHT: this column grows by dx, the immediate next
  //     column shrinks by dx. If the next column hits its MIN_PX,
  //     the cascade picks up the column AFTER that one, then the
  //     one after, and so on — testers wanted "boundaries collide
  //     and start moving together" and this is that.
  //   • Dragging LEFT: this column shrinks (down to its own MIN_PX),
  //     the immediate next column grows. No cascade needed since the
  //     drag naturally stops when the dragged column hits its floor.
  //   • Total of all ratios stays constant (=100), so the grid always
  //     fits the container exactly — date never goes offscreen.
  function ResizeHandle({ col }: { col: ColKey }) {
    return (
      <span
        className="lib-col-resize"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const startX = e.clientX;
          const startRatios = { ...ratios };
          const colIdx = COL_ORDER.indexOf(col);
          const nextCol: ColKey | null = COL_ORDER[colIdx + 1] ?? null;
          // Translate pixel drag → fr drag. We measure the container's
          // EFFECTIVE width (clientWidth minus the 64px thumb track,
          // minus the 6 × 10px grid gaps, minus the 2 × 10px row
          // padding) at drag-start, then compute "how many fr units
          // equal one pixel" so the drag tracks the cursor 1:1.
          const handleEl = e.currentTarget as HTMLElement;
          const scrollEl = handleEl.closest(".lib-grid-scroll") as HTMLElement | null;
          const containerW = scrollEl?.clientWidth ?? 0;
          const effectiveW = Math.max(1, containerW - 64 - 60 - 20);
          const sumFr = COL_ORDER.reduce((acc, k) => acc + startRatios[k], 0);
          const frPerPx = sumFr / effectiveW;
          // Pixel mins → fr mins, evaluated against the current
          // container width so floors stay real-world correct even
          // when the user has the window narrow.
          const minFr: Record<ColKey, number> = {
            title: MIN_COL_PX.title * frPerPx,
            tags: MIN_COL_PX.tags * frPerPx,
            res: MIN_COL_PX.res * frPerPx,
            dur: MIN_COL_PX.dur * frPerPx,
            size: MIN_COL_PX.size * frPerPx,
            date: MIN_COL_PX.date * frPerPx,
          };
          document.body.classList.add("lib-resizing");
          function onMove(mv: MouseEvent) {
            const dxPx = mv.clientX - startX;
            const dxFr = dxPx * frPerPx;
            const next = { ...startRatios };
            if (dxFr > 0) {
              // BOUNDARY MOVES RIGHT. Dragged column grows; cascade
              // RIGHTWARD — immediate next col shrinks first, then
              // the col after that once the first one bottoms out,
              // chaining until every column to the right is at its
              // pixel floor.
              let need = dxFr;
              for (let i = colIdx + 1; i < COL_ORDER.length && need > 0; i++) {
                const c = COL_ORDER[i];
                const canGive = next[c] - minFr[c];
                if (canGive <= 0) continue;
                const give = Math.min(need, canGive);
                next[c] -= give;
                need -= give;
              }
              next[col] = startRatios[col] + (dxFr - need);
            } else if (dxFr < 0 && nextCol) {
              // BOUNDARY MOVES LEFT. The immediate right-side neighbor
              // grows; cascade LEFTWARD — the dragged column shrinks
              // first, then the column BEFORE it once the dragged
              // column bottoms out, chaining until every column up
              // to (but not including) the thumb is at its pixel
              // floor. This is the symmetric counterpart to the
              // rightward cascade above — testers wanted "drag them
              // to the left together" and this is that.
              let need = -dxFr;
              for (let i = colIdx; i >= 0 && need > 0; i--) {
                const c = COL_ORDER[i];
                const canGive = next[c] - minFr[c];
                if (canGive <= 0) continue;
                const give = Math.min(need, canGive);
                next[c] -= give;
                need -= give;
              }
              const actualShrink = -dxFr - need;
              next[nextCol] = startRatios[nextCol] + actualShrink;
            }
            onResize(next);
          }
          function onUp() {
            document.body.classList.remove("lib-resizing");
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          }
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
        onDoubleClick={(e) => {
          // Double-click → reset ALL columns to defaults. Resetting
          // just one would break the sum-stays-100 invariant.
          e.stopPropagation();
          onResize({ ...DEFAULT_RATIOS });
        }}
        title="Drag to resize · double-click to reset all columns"
      />
    );
  }
  return (
    <div className="lib-list-head">
      {/* Title label sits in the 64px thumb cell, centered so it
          reads as the column header for the thumbnails. */}
      <span className="lib-list-col col-thumb head-title-cell">
        <SortBtn col="title" label="Title" />
      </span>
      <span className="lib-list-col col-title">
        <ResizeHandle col="title" />
      </span>
      <span className="lib-list-col col-tags">
        Tags
        <ResizeHandle col="tags" />
      </span>
      <span className="lib-list-col col-res">
        Res
        <ResizeHandle col="res" />
      </span>
      <span className="lib-list-col col-dur">
        <SortBtn col="duration" label="Duration" />
        <ResizeHandle col="dur" />
      </span>
      <span className="lib-list-col col-size">
        <SortBtn col="size" label="Size" />
        <ResizeHandle col="size" />
      </span>
      {/* Last column — no right-edge handle. To resize date, drag the
          size column's right edge instead. */}
      <span className="lib-list-col col-date">
        <SortBtn col="date" label="Added" />
      </span>
    </div>
  );
}

function EmptyState({
  hasFilters,
  totalCount,
  scopeName,
  inTrash,
}: {
  hasFilters: boolean;
  totalCount: number;
  scopeName: string | null;
  inTrash?: boolean;
}) {
  // 1.3.0 — Trash view has its own empty message. (Without this it fell
  // through to `return null` because the live totalCount is non-zero,
  // leaving the Trash grid blank with no feedback.)
  if (inTrash) {
    return (
      <div className="empty">
        <Icon.trash width={26} height={26} style={{ color: "var(--text-3)" }} />
        <h3>Trash is empty</h3>
        <p>
          Clips you delete land here and stay recoverable until you empty the Trash.
          Nothing on disk is removed until then.
        </p>
      </div>
    );
  }
  if (totalCount === 0) {
    return (
      <div className="empty">
        <Icon.library width={28} height={28} style={{ color: "var(--text-3)" }} />
        <h3>
          {scopeName ? `"${scopeName}" is empty` : "Your library is empty"}
        </h3>
        <p>
          {scopeName ? (
            <>
              No clips have been downloaded into this project yet. Folder
              routing arrives next session (Phase B); for now you can move
              existing assets into projects from the asset drawer.
            </>
          ) : (
            <>
              Head to the <strong>Download</strong> tab and grab your first clip.
              Every successful download lands here automatically.
            </>
          )}
        </p>
      </div>
    );
  }
  if (hasFilters) {
    return (
      <div className="empty">
        <Icon.filter width={24} height={24} style={{ color: "var(--text-3)" }} />
        <h3>No assets match the current filter</h3>
        <p>Try clearing one of the filters above, or use the Clear all button.</p>
      </div>
    );
  }
  return null;
}

// =====================================================================
// 1.1 — InspectorPanel (always-on right column)
// =====================================================================
//
// Replaces the modal AssetDrawer. Three states based on selection size:
//   0   → placeholder + keyboard tips
//   1   → single-asset details + actions
//   >1  → batch summary + bulk actions
//
// Reads from the existing `selection` Set + the `filtered` asset list
// (so unselected-but-filtered assets are excluded from the multi-pick
// view — selection always refers to currently-visible cards). Calls
// up via callback props to act on selection.
//
// MVP scope: read-only single-view (no tag editor yet — port from
// AssetDrawer in a follow-up pass), batch view shows count + size +
// platform breakdown + Move to Trash action.

function InspectorPanel({
  selection,
  assets,
  allAssets,
  knownTags,
  folders,
  bulkDeleting,
  onClearSelection,
  onSelectOne,
  onBulkDelete,
  onMoveToFolder,
}: {
  selection: Set<string>;
  assets: Asset[];
  allAssets: Asset[];
  knownTags: TagCount[];
  folders: Folder[];
  bulkDeleting: boolean;
  onClearSelection: () => void;
  onSelectOne: (id: string) => void;
  onBulkDelete: () => void;
  /** 1.1 Phase 2 — move the entire current selection to a folder.
   *  null = Uncategorized (clear folder assignment). */
  onMoveToFolder: (folderId: string | null) => void;
}) {
  const selectedAssets = useMemo(() => {
    if (selection.size === 0) return [];
    return allAssets.filter((a) => selection.has(a.id));
  }, [selection, allAssets]);

  void assets;

  return (
    <aside className="lib-inspector">
      {selection.size === 0 && <InspectorEmpty />}
      {selection.size === 1 && (
        <InspectorSingle
          asset={selectedAssets[0]}
          folders={folders}
          knownTagsForInspector={knownTags}
          bulkDeleting={bulkDeleting}
          onMoveToFolder={onMoveToFolder}
          onDelete={onBulkDelete}
        />
      )}
      {selection.size > 1 && (
        <InspectorBatch
          selected={selectedAssets}
          folders={folders}
          knownTags={knownTags}
          bulkDeleting={bulkDeleting}
          onClear={onClearSelection}
          onSelectOne={onSelectOne}
          onBulkDelete={onBulkDelete}
          onMoveToFolder={onMoveToFolder}
        />
      )}
    </aside>
  );
}

function InspectorEmpty() {
  return (
    <div className="insp-empty">
      <div className="insp-empty-title">No selection</div>
      <div className="insp-empty-hint">
        Click a card to inspect. <br />
        <span className="kbd">Ctrl</span>+click to add, <span className="kbd">Shift</span>+click for range,{" "}
        <br />
        drag on empty space for a box select. <br />
        Double-click a card to open in your default app.
      </div>
    </div>
  );
}

function InspectorSingle({
  asset,
  folders,
  knownTagsForInspector,
  bulkDeleting,
  onMoveToFolder,
  onDelete,
}: {
  asset: Asset | undefined;
  folders: Folder[];
  knownTagsForInspector: TagCount[];
  bulkDeleting: boolean;
  onMoveToFolder: (folderId: string | null) => void;
  onDelete: () => void;
}) {
  if (!asset) return <InspectorEmpty />;
  const currentFolder = asset.folder_id
    ? folders.find((f) => f.id === asset.folder_id)?.name ?? "(unknown)"
    : "Uncategorized";
  const thumb = thumbnailSrc(asset.thumbnail_path, asset.thumbnail_url);
  // 1.2.0 — audio assets get a slightly different stat strip:
  //   - "Dimensions" → "Format" (the audio container, e.g. MP3 320k)
  //   - "Codec" row shows audio codec instead of video codec
  //   - Thumbnail container styles via .insp-thumb.audio for the
  //     waveform-on-dark-backdrop treatment
  const isAudio = asset.kind === "audio";
  const dims =
    asset.width && asset.height ? `${asset.width}×${asset.height}` : "—";
  return (
    <div className="insp-single">
      <div className={"insp-thumb" + (isAudio ? " audio" : "")}>
        {thumb ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            onClick={() => void openFileInDefaultApp(asset.file_path)}
            title="Click to open in default app"
            style={{ cursor: "pointer" }}
          />
        ) : (
          <div className="insp-thumb-empty">{isAudio ? "no waveform yet" : "no thumb"}</div>
        )}
        {isAudio && (
          <span className="lib-card-audio-glyph" title="Audio">
            <Icon.music width={13} height={13} />
          </span>
        )}
      </div>
      <div className="insp-title" title={asset.title}>
        {asset.title}
      </div>
      <div className="insp-channel">
        {asset.channel ?? "—"} · {platformLabel(asset.platform)}
      </div>

      <dl className="insp-stats">
        <div>
          <dt>Duration</dt>
          <dd>{asset.duration_sec ? fmtDuration(asset.duration_sec) : "—"}</dd>
        </div>
        {isAudio ? (
          <div>
            <dt>Format</dt>
            <dd className="mono">{(asset.codec_audio ?? asset.container ?? "audio").toUpperCase()}</dd>
          </div>
        ) : (
          <div>
            <dt>Dimensions</dt>
            <dd>{dims}</dd>
          </div>
        )}
        <div>
          <dt>Container</dt>
          <dd className="mono">{asset.container ?? "—"}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{asset.file_size != null ? fmtBytes(asset.file_size) : "—"}</dd>
        </div>
        <div>
          <dt>Codec</dt>
          <dd className="mono" title={isAudio ? undefined : `audio: ${asset.codec_audio ?? "—"}`}>
            {isAudio ? (asset.codec_audio ?? "—") : (asset.codec_video ?? "—")}
          </dd>
        </div>
        <div>
          <dt>Added</dt>
          <dd>{new Date(asset.downloaded_at * 1000).toLocaleString()}</dd>
        </div>
      </dl>

      <div className="insp-actions insp-actions-icon">
        <button
          className="btn btn-secondary insp-action-btn"
          onClick={() => void openFileInDefaultApp(asset.file_path)}
          title="Open in default app"
          aria-label="Open in default app"
        >
          <Icon.play width={18} height={18} />
        </button>
        <button
          className="btn btn-secondary insp-action-btn"
          onClick={() => void revealFile(asset.file_path)}
          title="Reveal in file manager"
          aria-label="Reveal in file manager"
        >
          <Icon.folder width={18} height={18} />
        </button>
        <button
          className="btn btn-danger insp-action-btn"
          onClick={onDelete}
          disabled={bulkDeleting}
          title="Move to Recycle Bin — Delete"
          aria-label="Move to Recycle Bin"
        >
          <Icon.trash width={18} height={18} />
        </button>
      </div>

      <div className="insp-folder">
        <div className="insp-section-head">Folder</div>
        <select
          className="field-select"
          value={asset.folder_id ?? ""}
          onChange={(e) => onMoveToFolder(e.target.value || null)}
          title={`Currently in: ${currentFolder}`}
        >
          <option value="">Uncategorized</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      {/* 1.1.1 — Tag editor restored to the drawer (regressed when the
          modal AssetDrawer was replaced by the inspector). Chip-style
          editor with autocomplete; press T on the card grid for the
          alternative popup picker. */}
      <div className="insp-tags">
        <div className="insp-section-head">Tags</div>
        <TagEditor asset={asset} knownTags={knownTagsForInspector} />
      </div>

      <div className="insp-source">
        <div className="insp-section-head">Source</div>
        <a
          className="mono insp-url"
          href={asset.source_url}
          onClick={(e) => {
            // WebView2 won't open target=_blank in the system browser;
            // route through the opener plugin instead.
            e.preventDefault();
            void openExternalUrl(asset.source_url);
          }}
          title={`Open in browser — ${asset.source_url}`}
        >
          {asset.source_url}
        </a>
      </div>
    </div>
  );
}

function InspectorBatch({
  selected,
  folders,
  knownTags,
  bulkDeleting,
  onClear,
  onSelectOne,
  onBulkDelete,
  onMoveToFolder,
}: {
  selected: Asset[];
  folders: Folder[];
  knownTags: TagCount[];
  bulkDeleting: boolean;
  onClear: () => void;
  onSelectOne: (id: string) => void;
  onBulkDelete: () => void;
  onMoveToFolder: (folderId: string | null) => void;
}) {
  // If every selected asset shares the same folder_id, surface it as
  // the current value of the batch dropdown; otherwise show a "mixed"
  // sentinel so the dropdown doesn't lie.
  const folderIds = new Set(selected.map((a) => a.folder_id ?? null));
  const commonFolderId =
    folderIds.size === 1 ? selected[0]?.folder_id ?? null : "__mixed__";
  const totalBytes = selected.reduce((acc, a) => acc + (a.file_size ?? 0), 0);
  // Platform breakdown — most users batch within one platform but
  // mixed batches happen. Show counts so the user isn't surprised
  // when a "delete all" sweeps across sources.
  const platforms = new Map<string, number>();
  for (const a of selected) {
    platforms.set(a.platform, (platforms.get(a.platform) ?? 0) + 1);
  }

  return (
    <div className="insp-batch">
      <div className="insp-batch-head">
        <div className="insp-batch-count">{selected.length} selected</div>
        <button className="btn btn-secondary" onClick={onClear} title="Esc">
          Clear
        </button>
      </div>

      <dl className="insp-stats">
        <div>
          <dt>Total size</dt>
          <dd>{fmtBytes(totalBytes)}</dd>
        </div>
        <div>
          <dt>Sources</dt>
          <dd>
            {Array.from(platforms.entries())
              .map(([p, n]) => `${platformLabel(p)} ${n}`)
              .join(" · ")}
          </dd>
        </div>
      </dl>

      <div className="insp-folder">
        <div className="insp-section-head">Move to folder</div>
        <select
          className="field-select"
          value={commonFolderId === "__mixed__" ? "__mixed__" : commonFolderId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__mixed__") return; // no-op sentinel
            onMoveToFolder(v || null);
          }}
        >
          {commonFolderId === "__mixed__" && (
            <option value="__mixed__">— mixed —</option>
          )}
          <option value="">Uncategorized</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      {/* 1.1.1 — Batch tag editor. Shows tags shared by ALL selected
          assets ("common tags") as removable chips, and lets the user
          add a tag to the whole batch in one stroke. For more nuanced
          tagging (partial add/remove across the batch), press T for
          the popup picker which shows indeterminate state. */}
      <BatchTagEditor selected={selected} knownTags={knownTags} />

      <div className="insp-actions insp-actions-icon" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <button
          className="btn btn-danger insp-action-btn"
          onClick={onBulkDelete}
          disabled={bulkDeleting}
          title="Delete from library + move files to Recycle Bin — Delete"
        >
          <Icon.trash width={16} height={16} />
          {bulkDeleting ? "Deleting…" : `Delete ${selected.length}`}
        </button>
      </div>

      <div className="insp-section-head" style={{ marginTop: 18 }}>
        Items
      </div>
      <ul className="insp-batch-list">
        {selected.slice(0, 25).map((a) => (
          <li key={a.id} onClick={() => onSelectOne(a.id)} title="Click to focus this one">
            <div className="insp-bl-title">{a.title}</div>
            <div className="insp-bl-meta mono">
              {a.duration_sec ? fmtDuration(a.duration_sec) : "—"} ·{" "}
              {a.file_size ? fmtBytes(a.file_size) : "—"}
            </div>
          </li>
        ))}
        {selected.length > 25 && (
          <li className="insp-bl-more">
            …and {selected.length - 25} more
          </li>
        )}
      </ul>
    </div>
  );
}

// =====================================================================
// Asset detail drawer (legacy — kept in tree but no longer rendered.
// Source for porting tag editor + project mover into InspectorSingle
// in a follow-up pass. Marked "used" via the void-statement at the
// bottom of the file so noUnusedLocals doesn't complain.
// =====================================================================

function _AssetDrawerLegacy({
  asset,
  knownTags,
  onClose,
  onSelectAsset,
}: {
  asset: Asset;
  knownTags: TagCount[];
  onClose: () => void;
  onSelectAsset: (id: string) => void;
}) {
  const { projects } = useActiveProject();
  const [siblings, setSiblings] = useState<SiblingSummary[]>([]);

  // Pull sibling list (other assets with same source_url) whenever
  // the drawer points at a new asset OR the library reports a change
  // (so freshly-trimmed siblings appear without closing/reopening).
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (asset.sibling_count === 0) {
        if (!cancelled) setSiblings([]);
        return;
      }
      try {
        const res = await invoke<SiblingSummary[]>("library_siblings", {
          assetId: asset.id,
        });
        if (!cancelled) setSiblings(res);
      } catch (e) {
        console.warn("library_siblings failed:", e);
      }
    }
    void refresh();
    let unlisten: UnlistenFn | null = null;
    listen("library:changed", () => void refresh())
      .then((fn) => {
        // Race-safe: if unmount already ran (e.g. user clicked
        // another sibling before listen() resolved), immediately
        // drop the subscription instead of orphaning it.
        if (cancelled) void fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [asset.id, asset.sibling_count]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function moveTo(projectId: string | null) {
    try {
      await invoke("asset_set_project", { assetId: asset.id, projectId });
    } catch (e) {
      await alertDialog(`Move failed: ${String(e)}`, { title: "Move failed" });
    }
  }

  async function deleteFromDisk() {
    // 1.3.0 — no confirm: trash is recoverable, restore is one click in
    // the Trash view. Permanent delete (Empty trash) keeps its confirm.
    try {
      await invoke("library_delete", { id: asset.id });
      onClose();
    } catch (e) {
      await alertDialog(`Delete failed: ${String(e)}`, { title: "Delete failed" });
    }
  }

  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div className="title">{asset.title}</div>
          <button className="ic-btn" onClick={onClose} title="Close (Esc)">
            <Icon.x width={14} height={14} />
          </button>
        </div>
        <div className="drawer-body">
          <div className="drawer-thumb">
            {(() => {
              const t = thumbnailSrc(asset.thumbnail_path, asset.thumbnail_url);
              return t ? <img src={t} alt="" /> : <div className="drawer-thumb-empty" />;
            })()}
          </div>

          <dl className="drawer-grid">
            <dt>Channel</dt>
            <dd>{asset.channel ?? "—"}</dd>
            <dt>Source</dt>
            <dd>{platformLabel(asset.platform)}</dd>
            <dt>Duration</dt>
            <dd>{fmtDuration(asset.duration_sec)}</dd>
            {asset.width && asset.height && (
              <>
                <dt>Resolution</dt>
                <dd>
                  {asset.width}×{asset.height}
                  {asset.fps ? ` @ ${Math.round(asset.fps)}` : ""}
                </dd>
              </>
            )}
            {asset.in_sec != null && asset.out_sec != null && (
              <>
                <dt>Segment</dt>
                <dd>{fmtDuration(asset.in_sec)} → {fmtDuration(asset.out_sec)}</dd>
              </>
            )}
            <dt>Size</dt>
            <dd>{fmtBytes(asset.file_size)}</dd>
            <dt>Codec</dt>
            <dd>
              {asset.codec_video ?? "—"}
              {asset.codec_audio ? ` · ${asset.codec_audio}` : ""}
              {asset.container ? ` · .${asset.container}` : ""}
            </dd>
            {asset.transcoded_to && (
              <>
                <dt>Transcoded</dt>
                <dd>{asset.transcoded_to}</dd>
              </>
            )}
            <dt>Added</dt>
            <dd>{new Date(asset.downloaded_at * 1000).toLocaleString()}</dd>
            <dt>Path</dt>
            <dd style={{ fontSize: 10.5 }}>{asset.file_path}</dd>
          </dl>

          <div>
            <div className="mono faint" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Scope
            </div>
            <select
              className="field-select"
              style={{ width: "100%", height: 30 }}
              value={asset.project_id ?? "__library__"}
              onChange={(e) => {
                const v = e.target.value;
                void moveTo(v === "__library__" ? null : v);
              }}
            >
              <option value="__library__">Library</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mono faint" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Tags
            </div>
            <TagEditor asset={asset} knownTags={knownTags} />
          </div>

          {siblings.length > 0 && (
            <div>
              <div className="mono faint" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Other clips from this source · {siblings.length}
              </div>
              <ul className="sibling-list">
                {siblings.map((s) => {
                  const thumb = thumbnailSrc(s.thumbnail_path, s.thumbnail_url);
                  const segLabel =
                    s.in_sec != null && s.out_sec != null
                      ? `${fmtDuration(s.in_sec)} → ${fmtDuration(s.out_sec)}`
                      : "full";
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="sibling-row"
                        onClick={() => onSelectAsset(s.id)}
                        title={`Open ${s.title}`}
                      >
                        <div className="sibling-thumb">
                          {thumb ? (
                            <img src={thumb} alt="" loading="lazy" />
                          ) : (
                            <div className="sibling-thumb-empty" />
                          )}
                        </div>
                        <div className="sibling-meta">
                          <div className="sibling-title">{s.title}</div>
                          <div className="sibling-sub mono">
                            <span>{segLabel}</span>
                            <span className="sep">·</span>
                            <span>{s.scope_label}</span>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="drawer-actions">
            <button className="btn btn-secondary" onClick={() => revealFile(asset.file_path)}>
              <Icon.folder width={12} height={12} /> Reveal in Explorer
            </button>
            <button
              className="btn btn-danger"
              onClick={deleteFromDisk}
              title="Move the clip to the in-app Trash (recoverable)"
            >
              Move to Trash
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// =====================================================================
// Inline tag editor (chips + autocomplete)
// =====================================================================

function TagEditor({ asset, knownTags }: { asset: Asset; knownTags: TagCount[] }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  async function commitTags(next: string[]) {
    try {
      await invoke("tag_set_for_asset", { assetId: asset.id, tags: next });
    } catch (e) {
      console.warn("tag_set_for_asset failed:", e);
    }
  }

  async function addTag(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (asset.tags.some((t) => t.toLowerCase() === lower)) {
      setDraft("");
      return;
    }
    await commitTags([...asset.tags, trimmed]);
    setDraft("");
  }

  async function removeTag(name: string) {
    await commitTags(asset.tags.filter((t) => t !== name));
  }

  const suggestions = (() => {
    const d = draft.trim().toLowerCase();
    if (!d) return [];
    const has = new Set(asset.tags.map((t) => t.toLowerCase()));
    return knownTags
      .filter((t) => t.name.toLowerCase().includes(d) && !has.has(t.name.toLowerCase()))
      .slice(0, 5);
  })();

  return (
    <div className="tag-row">
      {asset.tags.map((t) => (
        <span key={t} className="tag-chip">
          <span>{t}</span>
          <button className="x" onClick={() => void removeTag(t)} title="Remove">
            ×
          </button>
        </span>
      ))}
      {editing ? (
        <span className="tag-input-wrap">
          <input
            className="tag-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addTag(draft);
              } else if (e.key === "Escape") {
                setDraft("");
                setEditing(false);
              }
            }}
            onBlur={() => {
              if (draft.trim()) void addTag(draft);
              setEditing(false);
            }}
            placeholder="tag…"
            autoFocus
            spellCheck={false}
          />
          {suggestions.length > 0 && (
            <div className="tag-suggestions">
              {suggestions.map((s) => (
                <button
                  key={s.name}
                  className="tag-suggestion"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void addTag(s.name);
                    setEditing(false);
                  }}
                >
                  {s.name} <span className="faint">({s.count})</span>
                </button>
              ))}
            </div>
          )}
        </span>
      ) : (
        <button className="tag-chip tag-add" onClick={() => setEditing(true)}>
          + tag
        </button>
      )}
    </div>
  );
}

// =====================================================================
// 1.1.1 — Tag picker (press T) — floating-near-cursor popup
// =====================================================================
//
// Distinct from TagFilterPopup (which narrows the visible grid). This
// one MUTATES tags on the current selection. Works on single or many
// assets. Mirrors Eagle's tagger:
//   - Search field on top; pressing Enter on a no-match query creates
//     a new tag and applies it to the selection.
//   - Sections: "Recently used" (last 8 from localStorage), "Others"
//     (everything else, sorted alphabetically).
//   - Each row is a tristate toggle:
//       all of selection has tag → checked  → click removes
//       none has tag             → empty    → click adds
//       partial                  → indeterm → click adds (resolves up)
//   - Esc / outside-click / scroll → close.
//
// The host owns the actual mutation (applyTagDelta). This component
// just figures out the desired delta and shouts it up.

const RECENT_TAGS_KEY = "media-hub:recent-tags";
const RECENT_TAGS_LIMIT = 8;

function getRecentTags(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_TAGS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string").slice(0, RECENT_TAGS_LIMIT);
  } catch {
    return [];
  }
}

function bumpRecentTags(names: string[]) {
  try {
    const current = getRecentTags();
    const seen = new Set<string>();
    const next: string[] = [];
    for (const n of [...names, ...current]) {
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(n);
      if (next.length >= RECENT_TAGS_LIMIT) break;
    }
    localStorage.setItem(RECENT_TAGS_KEY, JSON.stringify(next));
  } catch {
    // localStorage off / quota — silent. Recent-tags is just a UX
    // boost, not a correctness requirement.
  }
}

function sortLabel(m:
  | "recent" | "oldest" | "name_az" | "name_za"
  | "size_desc" | "size_asc" | "duration_desc" | "duration_asc"): string {
  switch (m) {
    case "recent": return "Most recent";
    case "oldest": return "Oldest";
    case "name_az": return "Name A→Z";
    case "name_za": return "Name Z→A";
    case "size_desc": return "Largest";
    case "size_asc": return "Smallest";
    case "duration_desc": return "Longest";
    case "duration_asc": return "Shortest";
  }
}

function SortPopup({
  anchorRef,
  current,
  onPick,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  current:
    | "recent" | "oldest" | "name_az" | "name_za"
    | "size_desc" | "size_asc" | "duration_desc" | "duration_asc";
  onPick: (m:
    | "recent" | "oldest" | "name_az" | "name_za"
    | "size_desc" | "size_asc" | "duration_desc" | "duration_asc") => void;
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const POPUP_WIDTH = 180;
  const anchorRect = anchorRef.current?.getBoundingClientRect();
  const top = anchorRect ? anchorRect.bottom + 6 : 60;
  const right =
    anchorRect && typeof window !== "undefined"
      ? Math.max(8, window.innerWidth - anchorRect.right)
      : 16;

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (anchorRef.current?.contains(e.target as Node)) return;
      if (!popupRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [onClose, anchorRef]);

  const options: Array<typeof current> = [
    "recent", "oldest", "name_az", "name_za",
    "size_desc", "size_asc", "duration_desc", "duration_asc",
  ];

  return (
    <div
      ref={popupRef}
      className="filter-popup"
      style={{ top, right, width: POPUP_WIDTH }}
      role="menu"
      aria-label="Sort by"
    >
      <div className="filter-popup-head">
        <span className="filter-popup-title">Sort by</span>
      </div>
      <div className="filter-section-body" style={{ maxHeight: "none" }}>
        {options.map((m) => (
          <button
            key={m}
            type="button"
            className={"filter-row" + (m === current ? " active" : "")}
            onClick={() => onPick(m)}
          >
            <span className="filter-row-check">{m === current ? "✓" : ""}</span>
            <span className="filter-row-label">{sortLabel(m)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// 1.1.1 — Tag FILTER popup. Two-column Eagle layout: left rail with
// virtual sections (Selected / All Tags), right pane with search +
// row list + counts. Mutates `activeTags` via toggle callbacks; the
// underlying filter state lives in LibraryPage.
function TagFilterPopup({
  anchorRef,
  knownTags,
  activeTags,
  onToggleTag,
  onClearTags,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  knownTags: TagCount[];
  activeTags: Set<string>;
  onToggleTag: (t: string) => void;
  onClearTags: () => void;
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [rail, setRail] = useState<"all" | "selected">("all");

  const POPUP_WIDTH = 460;
  const POPUP_HEIGHT = 380;
  const anchorRect = anchorRef.current?.getBoundingClientRect();
  const top = anchorRect ? anchorRect.bottom + 6 : 60;
  const right =
    anchorRect && typeof window !== "undefined"
      ? Math.max(8, window.innerWidth - anchorRect.right)
      : 16;

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (anchorRef.current?.contains(e.target as Node)) return;
      if (!popupRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [onClose, anchorRef]);

  // Build the visible row list. Always alphabetical. "Selected" rail
  // narrows to currently-active. Search further narrows by substring.
  const q = search.trim().toLowerCase();
  const sourceList = rail === "selected"
    ? knownTags.filter((t) => activeTags.has(t.name))
    : knownTags;
  const visible = q
    ? sourceList.filter((t) => t.name.toLowerCase().includes(q))
    : sourceList;

  return (
    <div
      ref={popupRef}
      className="filter-popup tag-filter-popup"
      style={{ top, right, width: POPUP_WIDTH, height: POPUP_HEIGHT }}
      role="dialog"
      aria-label="Filter by tags"
    >
      <div className="filter-popup-head">
        <span className="filter-popup-title">
          Tags{activeTags.size > 0 ? ` · ${activeTags.size} on` : ""}
        </span>
        {activeTags.size > 0 && (
          <button
            type="button"
            className="filter-popup-clear"
            onClick={onClearTags}
            title="Clear all selected tags"
          >
            Clear
          </button>
        )}
      </div>

      <div className="tagf-search">
        <Icon.search width={11} height={11} style={{ color: "var(--text-3)" }} />
        <input
          type="text"
          placeholder="Search tags…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
          autoFocus
        />
      </div>

      <div className="tagf-body">
        <div className="tagf-rail">
          <button
            type="button"
            className={"tagf-rail-item" + (rail === "selected" ? " active" : "")}
            onClick={() => setRail("selected")}
          >
            <span>Selected</span>
            <span className="mono faint">{activeTags.size}</span>
          </button>
          <button
            type="button"
            className={"tagf-rail-item" + (rail === "all" ? " active" : "")}
            onClick={() => setRail("all")}
          >
            <span>All Tags</span>
            <span className="mono faint">{knownTags.length}</span>
          </button>
        </div>

        <div className="tagf-list">
          {knownTags.length === 0 ? (
            <div className="filter-empty">no tags yet — add some via the inspector or press T on selected clips</div>
          ) : visible.length === 0 ? (
            <div className="filter-empty">no matches</div>
          ) : (
            visible.map((t) => {
              const on = activeTags.has(t.name);
              return (
                <button
                  key={t.name}
                  type="button"
                  className={"filter-row" + (on ? " active" : "")}
                  onClick={() => onToggleTag(t.name)}
                >
                  <span className="filter-row-check">{on ? "✓" : ""}</span>
                  <Icon.tag width={10} height={10} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                  <span className="filter-row-label">{t.name}</span>
                  <span className="filter-row-count mono">{t.count}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// 1.1.1 — Press-T tag picker. Tags-vs-tagger split: this MUTATES tags
// on the current selection; TagFilterPopup only narrows the visible grid.
function TagPickerPopup({
  x,
  y,
  selection,
  knownTags,
  onApply,
  onClose,
}: {
  x: number;
  y: number;
  selection: Asset[];
  knownTags: TagCount[];
  onApply: (toAdd: string[], toRemove: string[]) => void;
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");

  const POPUP_WIDTH = 360;
  const POPUP_HEIGHT = 400;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1600;
  const vh = typeof window !== "undefined" ? window.innerHeight : 1000;
  // Nudge so the popup never spills off-screen. Anchors to top-left
  // of the cursor by default; flips to the other side when there
  // isn't room.
  const left = Math.min(Math.max(8, x + 8), vw - POPUP_WIDTH - 8);
  const top = Math.min(Math.max(8, y + 8), vh - POPUP_HEIGHT - 8);

  // Compute per-tag selection state: how many of the selected assets
  // already have each tag. Drives the checkmark / indeterminate state.
  const tagStates = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of selection) {
      for (const t of a.tags) {
        m.set(t, (m.get(t) ?? 0) + 1);
      }
    }
    return m; // tag → count of selected assets that have it
  }, [selection]);

  function stateOf(tag: string): "all" | "some" | "none" {
    const n = tagStates.get(tag) ?? 0;
    if (n === 0) return "none";
    if (n === selection.length) return "all";
    return "some";
  }

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!popupRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [onClose]);

  // 1.1.2 bugfix — if selection clears while popup is open, close
  // ourselves so onClose runs (clears tagPickerPos) before next render.
  useEffect(() => {
    if (selection.length === 0) onClose();
  }, [selection.length, onClose]);

  const recent = useMemo(() => {
    const r = getRecentTags();
    const known = new Set(knownTags.map((t) => t.name.toLowerCase()));
    return r.filter((n) => known.has(n.toLowerCase()));
  }, [knownTags]);

  const q = search.trim();
  const qLower = q.toLowerCase();
  const matchesQuery = (name: string) => !qLower || name.toLowerCase().includes(qLower);
  const recentSet = new Set(recent.map((r) => r.toLowerCase()));
  const others = knownTags
    .filter((t) => !recentSet.has(t.name.toLowerCase()))
    .map((t) => t.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const visibleRecent = recent.filter(matchesQuery);
  const visibleOthers = others.filter(matchesQuery);
  const exactMatch = knownTags.some((t) => t.name.toLowerCase() === qLower);
  const canCreate = q.length > 0 && !exactMatch;

  function toggleTag(name: string) {
    const s = stateOf(name);
    if (s === "all") {
      onApply([], [name]);
    } else {
      onApply([name], []);
    }
  }

  function createAndApply() {
    if (!canCreate) return;
    onApply([q], []);
    setSearch("");
  }

  function renderRow(name: string) {
    const s = stateOf(name);
    const checkMark = s === "all" ? "✓" : s === "some" ? "–" : "";
    return (
      <button
        key={name}
        type="button"
        className={"filter-row" + (s === "all" ? " active" : "") + (s === "some" ? " partial" : "")}
        onClick={() => toggleTag(name)}
      >
        <span className="filter-row-check">{checkMark}</span>
        <Icon.tag width={10} height={10} style={{ color: "var(--text-3)", flexShrink: 0 }} />
        <span className="filter-row-label">{name}</span>
        <span className="filter-row-count mono">
          {s === "all" ? "all" : s === "some" ? `${tagStates.get(name)}/${selection.length}` : ""}
        </span>
      </button>
    );
  }

  return (
    <div
      ref={popupRef}
      className="filter-popup tag-picker-popup"
      style={{ top, left, width: POPUP_WIDTH, maxHeight: POPUP_HEIGHT }}
      role="dialog"
      aria-label="Tag picker"
    >
      <div className="filter-popup-head">
        <span className="filter-popup-title">
          Tag {selection.length} {selection.length === 1 ? "clip" : "clips"}
        </span>
        <span className="filter-popup-clear" style={{ cursor: "default" }}>
          <span className="kbd">esc</span>
        </span>
      </div>

      <div className="tagf-search">
        <Icon.search width={11} height={11} style={{ color: "var(--text-3)" }} />
        <input
          type="text"
          placeholder="Search or create a tag…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (canCreate) createAndApply();
            }
          }}
          spellCheck={false}
          autoFocus
        />
      </div>

      <div className="tagf-list" style={{ flex: 1, overflowY: "auto" }}>
        {canCreate && (
          <button
            type="button"
            className="filter-row tag-picker-create"
            onClick={createAndApply}
            title="Create and apply this tag"
          >
            <span className="filter-row-check">+</span>
            <span className="filter-row-label">
              Create <strong>"{q}"</strong>
            </span>
          </button>
        )}

        {visibleRecent.length > 0 && (
          <>
            <div className="filter-section-head">Recently used</div>
            {visibleRecent.map(renderRow)}
          </>
        )}

        {visibleOthers.length > 0 && (
          <>
            <div className="filter-section-head">
              {visibleRecent.length > 0 ? "Others" : "All tags"}
            </div>
            {visibleOthers.map(renderRow)}
          </>
        )}

        {!canCreate && visibleRecent.length === 0 && visibleOthers.length === 0 && (
          <div className="filter-empty">
            {knownTags.length === 0 ? "no tags yet — type to create" : "no matches"}
          </div>
        )}
      </div>
    </div>
  );
}

// 1.1.1 — Batch tag editor for the multi-select inspector view.
// Shows tags shared by ALL selected assets as removable chips and a
// "+ tag" affordance to add a tag to every asset at once. Doesn't
// surface partial state (tags on SOME but not all) — that's what the
// press-T picker is for, where indeterminate state has real UI.
function BatchTagEditor({ selected, knownTags }: { selected: Asset[]; knownTags: TagCount[] }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  // Common tags = tags present on ALL selected assets. Case-insensitive
  // dedupe using the first-seen casing.
  const common = useMemo(() => {
    if (selected.length === 0) return [];
    const first = selected[0];
    const counts = new Map<string, { name: string; n: number }>();
    for (const t of first.tags) {
      counts.set(t.toLowerCase(), { name: t, n: 1 });
    }
    for (let i = 1; i < selected.length; i++) {
      const seen = new Set(selected[i].tags.map((t) => t.toLowerCase()));
      for (const [k, v] of counts) {
        if (seen.has(k)) v.n += 1;
      }
    }
    return Array.from(counts.values())
      .filter((v) => v.n === selected.length)
      .map((v) => v.name);
  }, [selected]);

  async function removeFromAll(name: string) {
    const lower = name.toLowerCase();
    try {
      await Promise.all(
        selected.map((a) =>
          invoke("tag_set_for_asset", {
            assetId: a.id,
            tags: a.tags.filter((t) => t.toLowerCase() !== lower),
          }),
        ),
      );
    } catch (e) {
      console.warn("batch tag remove failed:", e);
    }
  }

  async function addToAll(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    try {
      await Promise.all(
        selected.map((a) => {
          if (a.tags.some((t) => t.toLowerCase() === lower)) return Promise.resolve();
          return invoke("tag_set_for_asset", {
            assetId: a.id,
            tags: [...a.tags, trimmed],
          });
        }),
      );
      bumpRecentTags([trimmed]);
      setDraft("");
    } catch (e) {
      console.warn("batch tag add failed:", e);
    }
  }

  const suggestions = (() => {
    const d = draft.trim().toLowerCase();
    if (!d) return [];
    const has = new Set(common.map((t) => t.toLowerCase()));
    return knownTags
      .filter((t) => t.name.toLowerCase().includes(d) && !has.has(t.name.toLowerCase()))
      .slice(0, 5);
  })();

  return (
    <div className="insp-folder">
      <div className="insp-section-head">
        Tags <span className="mono faint" style={{ fontSize: 10 }}>(in all)</span>
      </div>
      <div className="tag-row">
        {common.map((t) => (
          <span key={t} className="tag-chip">
            <span>{t}</span>
            <button className="x" onClick={() => void removeFromAll(t)} title="Remove from all">
              ×
            </button>
          </span>
        ))}
        {editing ? (
          <span className="tag-input-wrap">
            <input
              className="tag-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addToAll(draft);
                } else if (e.key === "Escape") {
                  setDraft("");
                  setEditing(false);
                }
              }}
              onBlur={() => {
                if (draft.trim()) void addToAll(draft);
                setEditing(false);
              }}
              placeholder="tag…"
              autoFocus
              spellCheck={false}
            />
            {suggestions.length > 0 && (
              <div className="tag-suggestions">
                {suggestions.map((s) => (
                  <button
                    key={s.name}
                    className="tag-suggestion"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      void addToAll(s.name);
                      setEditing(false);
                    }}
                  >
                    {s.name} <span className="faint">({s.count})</span>
                  </button>
                ))}
              </div>
            )}
          </span>
        ) : (
          <button className="tag-chip tag-add" onClick={() => setEditing(true)}>
            + tag to all
          </button>
        )}
      </div>
      <div className="mono faint" style={{ fontSize: 10, marginTop: 4 }}>
        Press <span className="kbd">T</span> for partial-add/remove across the batch.
      </div>
    </div>
  );
}

// 1.1 — keep the legacy drawer in the tree without rendering. TagEditor
// is now used by InspectorSingle so it no longer needs the void shim.
void _AssetDrawerLegacy;
// 1.1 Phase 3 — FacetGroup/Facet were the original sidebar facets.
// FilterPopup ships its own simpler row primitives so these stay
// dormant. Kept for future polish + voided so noUnusedLocals doesn't
// strip them.
void FacetGroup;
void Facet;
