import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Icon } from "../lib/icons";
import { fmtBytes, fmtDuration } from "../lib/format";
import { attachLocalThumbnail, revealFile, thumbnailSrc } from "../lib/library";
import { scopeToFilter, useActiveProject } from "../lib/activeProject";
import type { Asset, LibraryFilters, TagCount } from "../lib/types";

type Bucket = "today" | "week" | "month" | "older";

/**
 * Library page — real grid (formerly the dev-card LibraryDevCard).
 * Filter sidebar (source / tags / added / duration) + grid of cards +
 * status footer. Selecting a card opens a slide-over drawer with full
 * metadata, tag editor, and actions (Open / Forget).
 *
 * Search is debounced (150ms). Filters compose via AND. The backend
 * does the heavy lifting via library_list — we only do client-side
 * filtering for buckets the SQL command doesn't support yet
 * (added-date, duration).
 */
export default function LibraryPage() {
  const { scope } = useActiveProject();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [count, setCount] = useState<number>(0);
  const [err, setErr] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<TagCount[]>([]);

  // Filter state
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [activePlatforms, setActivePlatforms] = useState<Set<string>>(new Set());
  const [activeBuckets, setActiveBuckets] = useState<Set<Bucket>>(new Set());
  const [tagFilter, setTagFilter] = useState("");

  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 150);
    return () => clearTimeout(t);
  }, [query]);

  // Selection: which asset is open in the drawer.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function refresh() {
    try {
      const scopeFilter = scopeToFilter(scope);
      const filters: LibraryFilters = {
        query: debouncedQuery || null,
        tags: activeTags.size > 0 ? Array.from(activeTags) : null,
        scope: scopeFilter,
        limit: 500,
      };
      const [list, n, tags] = await Promise.all([
        invoke<Asset[]>("library_list", { filters }),
        invoke<number>("library_count", { scope: scopeFilter }),
        invoke<TagCount[]>("tag_list_all"),
      ]);
      setAssets(list);
      setCount(n);
      setAllTags(tags);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, activeTags, scope]);

  // Event-driven refresh — Rust emits library:changed after every
  // insert/delete/tag mutation. No polling.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen("library:changed", () => {
      void refresh();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Backfill thumbnails for assets that landed before this feature
  // existed (or any other reason thumbnail_path is null). Runs once
  // per Library mount, serially with a small pause so we don't peg
  // the CPU when there are hundreds. Library:changed events from
  // each successful set fire the normal refresh and the cards update
  // live as they fill in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
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

  // Client-side platform + bucket filtering on top of what SQL gives us.
  const filtered = useMemo(() => {
    return assets.filter((a) => {
      if (activePlatforms.size > 0 && !activePlatforms.has(a.platform)) return false;
      if (activeBuckets.size > 0 && !activeBuckets.has(bucketFor(a.downloaded_at))) return false;
      return true;
    });
  }, [assets, activePlatforms, activeBuckets]);

  // Compute platform counts from the SQL-filtered set so they reflect
  // the current tag/search filter context. Same for bucket counts.
  const platformCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assets) m.set(a.platform, (m.get(a.platform) ?? 0) + 1);
    return m;
  }, [assets]);

  const bucketCounts = useMemo(() => {
    const m: Record<Bucket, number> = { today: 0, week: 0, month: 0, older: 0 };
    for (const a of assets) m[bucketFor(a.downloaded_at)]++;
    return m;
  }, [assets]);

  const selected = selectedId ? assets.find((a) => a.id === selectedId) ?? null : null;

  // Total filesize (selected asset, for status bar)
  const selectedSize = selected?.file_size ?? null;

  const visibleTags = allTags.filter((t) =>
    !tagFilter.trim() || t.name.toLowerCase().includes(tagFilter.trim().toLowerCase()),
  );

  const hasFilters =
    debouncedQuery !== "" ||
    activeTags.size > 0 ||
    activePlatforms.size > 0 ||
    activeBuckets.size > 0;

  function clearAll() {
    setQuery("");
    setActiveTags(new Set());
    setActivePlatforms(new Set());
    setActiveBuckets(new Set());
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

  return (
    <div className="content">
      <div className="content-header">
        <div className="ch-title">
          {scope.kind === "library" ? "Library" : scope.name}
        </div>
        <span className="ch-meta">
          {scope.kind === "project" && (
            <>
              <span className="mono faint">project</span>
              <span className="ch-sep"> · </span>
            </>
          )}
          {count.toLocaleString()} {count === 1 ? "clip" : "clips"} ·{" "}
          {fmtBytes(totalSize(assets))}
        </span>
        <div className="ch-spacer" />
        <div className="ch-tabs">
          <button className="ch-tab active" title="Grid view">
            <Icon.grid width={11} height={11} /> Grid
          </button>
          <button className="ch-tab" title="List view (coming soon)" disabled>
            <Icon.list width={12} height={12} /> List
          </button>
        </div>
      </div>

      <div className="lib-wrap">
        <aside className="lib-side">
          <div className="lib-side-head">Filters</div>
          <div className="lib-side-search">
            <div className="lib-search" style={{ maxWidth: "none", height: 26 }}>
              <Icon.search width={12} height={12} style={{ color: "var(--text-2)" }} />
              <input
                type="text"
                placeholder="Filter tags…"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>

          <FacetGroup title="Source">
            {Array.from(platformCounts.entries()).length === 0 ? (
              <div className="facet faint" style={{ cursor: "default" }}>
                <span style={{ width: 12 }} />
                <span className="label">no downloads yet</span>
              </div>
            ) : (
              Array.from(platformCounts.entries()).map(([plat, ct]) => (
                <Facet
                  key={plat}
                  active={activePlatforms.has(plat)}
                  label={platformLabel(plat)}
                  count={ct}
                  onClick={() => togglePlatform(plat)}
                />
              ))
            )}
          </FacetGroup>

          <FacetGroup title={`Tags${activeTags.size > 0 ? ` · ${activeTags.size} on` : ""}`}>
            {visibleTags.length === 0 ? (
              <div className="facet faint" style={{ cursor: "default" }}>
                <span style={{ width: 12 }} />
                <span className="label">
                  {allTags.length === 0 ? "no tags yet" : "no matches"}
                </span>
              </div>
            ) : (
              visibleTags.map((t) => (
                <Facet
                  key={t.name}
                  active={activeTags.has(t.name)}
                  label={t.name}
                  count={t.count}
                  onClick={() => toggleTag(t.name)}
                />
              ))
            )}
          </FacetGroup>

          <FacetGroup title="Added">
            {(["today", "week", "month", "older"] as Bucket[]).map((b) => (
              <Facet
                key={b}
                active={activeBuckets.has(b)}
                label={bucketLabel(b)}
                count={bucketCounts[b]}
                onClick={() => toggleBucket(b)}
              />
            ))}
          </FacetGroup>
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
            <div className="ch-spacer" />
            <span className="mono faint" style={{ fontSize: 11 }}>
              {filtered.length.toLocaleString()} of {count.toLocaleString()}
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

          <div className="lib-grid-scroll">
            {filtered.length === 0 ? (
              <EmptyState
                hasFilters={hasFilters}
                totalCount={count}
                scopeName={scope.kind === "project" ? scope.name : null}
              />
            ) : (
              <div className="lib-grid">
                {filtered.map((a) => (
                  <LibCard
                    key={a.id}
                    asset={a}
                    selected={selectedId === a.id}
                    onClick={() => setSelectedId(a.id)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="lib-status">
            <span>{selected ? "1 selected" : `${filtered.length} shown`}</span>
            <span className="sep">·</span>
            <span>{fmtBytes(selectedSize ?? totalSize(filtered))}</span>
            {selected && (
              <>
                <span className="sep">·</span>
                <span>
                  {platformLabel(selected.platform)}
                  {selected.width && selected.height ? ` · ${selected.width}×${selected.height}` : ""}
                  {selected.duration_sec ? ` · ${fmtDuration(selected.duration_sec)}` : ""}
                </span>
              </>
            )}
            <div className="right">
              <span><span className="kbd">/</span> search</span>
              <span><span className="kbd">esc</span> clear</span>
            </div>
          </div>
        </div>
      </div>

      {selected && (
        <AssetDrawer
          asset={selected}
          knownTags={allTags}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
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
    default:
      return p;
  }
}

function bucketLabel(b: Bucket): string {
  switch (b) {
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
function bucketFor(downloaded_at: number): Bucket {
  const now = Math.floor(Date.now() / 1000);
  const ageDays = (now - downloaded_at) / DAY;
  if (ageDays < 1) return "today";
  if (ageDays < 7) return "week";
  if (ageDays < 30) return "month";
  return "older";
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
}: {
  asset: Asset;
  selected: boolean;
  onClick: () => void;
}) {
  const thumb = thumbnailSrc(asset.thumbnail_path, asset.thumbnail_url);
  return (
    <button className={"lib-card" + (selected ? " selected" : "")} onClick={onClick}>
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
          ) : (
            asset.platform.toUpperCase()
          )}
        </span>
        {thumb && <img src={thumb} alt="" loading="lazy" />}
        {asset.duration_sec != null && <span className="dur">{fmtDuration(asset.duration_sec)}</span>}
      </div>
      <div className="info">
        <div className="title">{asset.title}</div>
        <div className="sub">
          <span className="ch">{asset.channel ?? "—"}</span>
          {asset.width && asset.height && <span>{asset.height}p</span>}
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

function EmptyState({
  hasFilters,
  totalCount,
  scopeName,
}: {
  hasFilters: boolean;
  totalCount: number;
  scopeName: string | null;
}) {
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
// Asset detail drawer
// =====================================================================

function AssetDrawer({
  asset,
  knownTags,
  onClose,
}: {
  asset: Asset;
  knownTags: TagCount[];
  onClose: () => void;
}) {
  const { projects } = useActiveProject();

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
      alert(`Move failed: ${String(e)}`);
    }
  }

  async function del() {
    if (!confirm(`Forget "${asset.title}" from the library?\n\n(The file on disk is NOT deleted.)`)) return;
    try {
      await invoke("library_delete", { id: asset.id });
      onClose();
    } catch (e) {
      alert(`Delete failed: ${String(e)}`);
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

          <div className="drawer-actions">
            <button className="btn btn-secondary" onClick={() => revealFile(asset.file_path)}>
              <Icon.folder width={12} height={12} /> Reveal in Explorer
            </button>
            <button className="btn btn-danger" onClick={del}>
              Forget
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
