import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useTauriEvent } from "../lib/useTauriEvent";
import { confirmDialog, alertDialog } from "../lib/dialog";
import { Icon } from "../lib/icons";
import { useActiveProject } from "../lib/activeProject";
import type { Project } from "../lib/types";

/**
 * Projects — master/detail management surface (1.3.0 rewrite).
 *
 * The old page crammed Activate / Rename / Finish / Delete into four
 * per-row buttons, and "Finish" ran a confusing 2–3 stage native-confirm
 * dance. This rewrite:
 *
 *   - Create takes a NAME + a FOLDER LOCATION together. You can point a
 *     project at any folder (e.g. D:\Edits\ClientX\BrandSpot\B-rolls) so
 *     downloads land beside your NLE project, or leave it on the default
 *     managed location.
 *   - Each list row has ONE primary action (Activate); everything else
 *     lives in the detail panel on the right — rows stay uncluttered.
 *   - The Delete/Finish mess becomes two clear actions:
 *       • Close project  → clips return to the Library, files stay put,
 *         the project grouping is removed. SAFE / non-destructive.
 *       • Delete project → removes the clips from Media Hub; a managed
 *         folder goes to the Recycle Bin, a custom (your own) folder is
 *         left completely untouched. DESTRUCTIVE / guarded.
 */

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const { scope, setScope } = useActiveProject();
  // mode drives the right-hand panel: nothing selected, creating, or
  // inspecting a specific project.
  const [mode, setMode] = useState<{ kind: "empty" } | { kind: "create" } | { kind: "detail"; id: string }>(
    { kind: "empty" },
  );

  async function refresh() {
    try {
      const list = await invoke<Project[]>("project_list");
      setProjects(list);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useTauriEvent("library:changed", () => {
    void refresh();
  });

  const selected =
    mode.kind === "detail" ? projects.find((p) => p.id === mode.id) ?? null : null;

  // If the inspected project vanished (deleted/closed elsewhere), fall
  // back to the empty state so the panel never references a dead id.
  useEffect(() => {
    if (mode.kind === "detail" && !projects.some((p) => p.id === mode.id)) {
      setMode({ kind: "empty" });
    }
  }, [projects, mode]);

  function activate(p: Project) {
    setScope({ kind: "project", id: p.id, name: p.name });
  }

  async function openFolder(p: Project) {
    try {
      const dir = await invoke<string>("project_dir", { id: p.id });
      await invoke("os_open_path", { path: dir });
    } catch (e) {
      await alertDialog(
        `Couldn't open the folder.\n\n${String(e)}\n\n` +
          `If this is a managed project with no downloads yet, the folder is created on the first download.`,
        { title: "Open folder", kind: "warning" },
      );
    }
  }

  // SAFE wrap-up: clips go back to the Library, files stay exactly where
  // they are on disk. Just removes the project grouping.
  async function closeProject(p: Project) {
    const msg =
      p.asset_count > 0
        ? `Close "${p.name}"?\n\n${p.asset_count} ${p.asset_count === 1 ? "clip" : "clips"} return to the Library. ` +
          `Files on disk are NOT moved or deleted — only the project grouping is removed.`
        : `Close "${p.name}"?\n\nThe (empty) project is removed. Nothing on disk is touched.`;
    if (!(await confirmDialog(msg, { title: "Close project?", kind: "warning" }))) return;
    try {
      await invoke("project_delete", { id: p.id });
      if (scope.kind === "project" && scope.id === p.id) setScope({ kind: "library" });
      setMode({ kind: "empty" });
    } catch (e) {
      await alertDialog(String(e), { title: "Close failed" });
    }
  }

  // DESTRUCTIVE: removes the clips from Media Hub. Managed folder →
  // Recycle Bin; a custom (user) folder is left untouched on disk.
  async function deleteProject(p: Project) {
    const custom = !!p.root_path;
    const clips = `${p.asset_count} ${p.asset_count === 1 ? "clip" : "clips"}`;
    const msg = custom
      ? `Delete "${p.name}"?\n\n${clips} will be removed from Media Hub.\n\n` +
        `Your folder is LEFT UNTOUCHED on disk:\n${p.root_path}\n\n` +
        `(Media Hub never deletes a folder you chose — remove it yourself if you want.)`
      : `Delete "${p.name}"?\n\n${clips} AND the project folder will be moved to the Recycle Bin.\n\n` +
        `Recoverable from the OS Recycle Bin, but not from inside Media Hub.`;
    if (!(await confirmDialog(msg, { title: "Delete project?", kind: "error" }))) return;
    try {
      await invoke("project_finish", { id: p.id, promote: false });
      if (scope.kind === "project" && scope.id === p.id) setScope({ kind: "library" });
      setMode({ kind: "empty" });
    } catch (e) {
      await alertDialog(String(e), { title: "Delete failed" });
    }
  }

  return (
    <div className="content">
      <div className="content-header">
        <div className="ch-title">Projects</div>
        <span className="ch-meta">
          {projects.length} {projects.length === 1 ? "project" : "projects"}
        </span>
        <div className="ch-spacer" />
        <button className="btn" onClick={() => setMode({ kind: "create" })}>
          <Icon.plus width={12} height={12} />
          New project
        </button>
      </div>

      <div className="content-body">
        {err && (
          <div className="msg-row err" style={{ marginBottom: 12 }}>
            <span className="label">error</span>
            <code>{err}</code>
          </div>
        )}

        {/* 1.3.0 — stacked layout: detail panel on top, the project list
            below it. column-reverse keeps the list first in source order
            but renders it under the detail. Full-width beats the old
            320px sidebar that squished project names. */}
        <div style={{ display: "flex", flexDirection: "column-reverse", gap: 16, maxWidth: 980 }}>
          {/* ---- BOTTOM: project list ---- */}
          <aside>
            <section className="card-box">
              <h2>All projects</h2>
              {projects.length === 0 ? (
                <div className="empty" style={{ padding: "26px 18px" }}>
                  <Icon.projects width={22} height={22} style={{ color: "var(--text-3)" }} />
                  <p>No projects yet. Create one to scope your downloads into their own folder.</p>
                </div>
              ) : (
                <ul className="proj-list">
                  {projects.map((p) => {
                    const isActive = scope.kind === "project" && scope.id === p.id;
                    const isSelected = mode.kind === "detail" && mode.id === p.id;
                    return (
                      <li
                        key={p.id}
                        className={"proj-row" + (isSelected ? " selected" : "") + (isActive ? " active" : "")}
                        onClick={() => setMode({ kind: "detail", id: p.id })}
                        style={{ cursor: "pointer" }}
                      >
                        <span className={"proj-row-dot" + (isActive ? " on" : "")} />
                        <div className="proj-row-body">
                          <div className="proj-row-name">{p.name}</div>
                          <div className="proj-row-meta mono">
                            <span>
                              {p.asset_count} {p.asset_count === 1 ? "clip" : "clips"}
                            </span>
                            <span className="sep">·</span>
                            <span className="faint" title={p.root_path ?? "Default managed location"}>
                              {p.root_path ? baseName(p.root_path) : "Default"}
                            </span>
                          </div>
                        </div>
                        {!isActive && (
                          <button
                            className="btn btn-secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              activate(p);
                            }}
                          >
                            Activate
                          </button>
                        )}
                        {isActive && <span className="chip">active</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </aside>

          {/* ---- TOP: detail / create / empty (rendered above the list
              via column-reverse) ---- */}
          <section style={{ minWidth: 0 }}>
            {mode.kind === "create" ? (
              <CreateProject
                onCancel={() => setMode({ kind: "empty" })}
                onCreated={(p) => {
                  // Auto-activate the new project + jump to its detail.
                  setScope({ kind: "project", id: p.id, name: p.name });
                  setMode({ kind: "detail", id: p.id });
                }}
              />
            ) : selected ? (
              <ProjectDetail
                key={selected.id}
                project={selected}
                isActive={scope.kind === "project" && scope.id === selected.id}
                onActivate={() => activate(selected)}
                onOpenFolder={() => void openFolder(selected)}
                onClose={() => void closeProject(selected)}
                onDelete={() => void deleteProject(selected)}
                onRenamed={() => void refresh()}
              />
            ) : (
              <div className="card-box">
                <div className="empty" style={{ padding: "40px 24px" }}>
                  <Icon.projects width={26} height={26} style={{ color: "var(--text-3)" }} />
                  <p>Select a project to manage it, or create a new one.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Create form — name + folder location together.
// =====================================================================

function CreateProject({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (p: Project) => void;
}) {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [useDefault, setUseDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function chooseFolder() {
    try {
      const sel = await open({ directory: true, multiple: false, title: "Choose project folder" });
      if (typeof sel === "string") {
        setFolder(sel);
        setUseDefault(false);
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    if (!useDefault && !folder) {
      setErr("Pick a folder, or switch to the default location.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const rootPath = useDefault ? null : folder;
      const p = await invoke<Project>("project_create", { name: n, rootPath });
      onCreated(p);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-box">
      <h2>
        New project <span className="chip">name + location</span>
      </h2>
      <form className="stack" onSubmit={submit} style={{ gap: 16 }}>
        <div>
          <label className="settings-label" style={{ display: "block", marginBottom: 6 }}>
            Name
          </label>
          <input
            className="field-input"
            type="text"
            placeholder="e.g. BrandSpot 001 · Drone Reel · Tutorial Vol 2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            maxLength={80}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </div>

        <div>
          <label className="settings-label" style={{ display: "block", marginBottom: 6 }}>
            Folder location
          </label>
          <label className="radio-row" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <input
              type="radio"
              checked={useDefault}
              onChange={() => {
                setUseDefault(true);
                setErr(null);
              }}
              disabled={busy}
            />
            <span>
              Default managed location{" "}
              <span className="faint mono" style={{ fontSize: 11 }}>
                (~/Media Hub/Projects/&lt;name&gt;/)
              </span>
            </span>
          </label>
          <label className="radio-row" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="radio"
              checked={!useDefault}
              onChange={() => setUseDefault(false)}
              disabled={busy}
            />
            <span>Custom folder — clips land directly in it</span>
          </label>

          {!useDefault && (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                gap: 8,
                alignItems: "center",
                paddingLeft: 24,
              }}
            >
              <button type="button" className="btn btn-secondary" onClick={() => void chooseFolder()} disabled={busy}>
                <Icon.folder width={12} height={12} />
                {folder ? "Change…" : "Choose folder…"}
              </button>
              <code className="mono faint" style={{ fontSize: 12, wordBreak: "break-all" }}>
                {folder ?? "no folder chosen"}
              </code>
            </div>
          )}
        </div>

        {err && (
          <div className="msg-row err">
            <span className="label">error</span>
            <code>{err}</code>
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn" disabled={busy || !name.trim()}>
            <Icon.plus width={12} height={12} />
            {busy ? "Creating…" : "Create project"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

// =====================================================================
// Detail panel — full management for one project.
// =====================================================================

function ProjectDetail({
  project,
  isActive,
  onActivate,
  onOpenFolder,
  onClose,
  onDelete,
  onRenamed,
}: {
  project: Project;
  isActive: boolean;
  onActivate: () => void;
  onOpenFolder: () => void;
  onClose: () => void;
  onDelete: () => void;
  onRenamed: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const [err, setErr] = useState<string | null>(null);

  async function commitRename() {
    const n = draft.trim();
    if (!n || n === project.name) {
      setRenaming(false);
      setDraft(project.name);
      return;
    }
    try {
      await invoke("project_rename", { id: project.id, name: n });
      setRenaming(false);
      onRenamed();
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <section className="card-box">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        {renaming ? (
          <input
            className="field-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
              else if (e.key === "Escape") {
                setRenaming(false);
                setDraft(project.name);
              }
            }}
            onBlur={() => void commitRename()}
            autoFocus
            maxLength={80}
            spellCheck={false}
            style={{ fontSize: 18 }}
          />
        ) : (
          <h2 style={{ margin: 0 }}>{project.name}</h2>
        )}
        {isActive ? (
          <span className="chip">active</span>
        ) : (
          <button className="btn btn-secondary" onClick={onActivate}>
            Activate
          </button>
        )}
      </div>

      <dl className="settings-kv" style={{ marginTop: 14 }}>
        <div>
          <dt>Location</dt>
          <dd className="mono" style={{ wordBreak: "break-all" }}>
            {project.root_path ? (
              project.root_path
            ) : (
              <span className="faint">Default — ~/Media Hub/Projects/{project.slug}/raw/</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Clips</dt>
          <dd>{project.asset_count}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{new Date(project.created_at * 1000).toLocaleString()}</dd>
        </div>
      </dl>

      {err && (
        <div className="msg-row err">
          <span className="label">error</span>
          <code>{err}</code>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        <button className="btn btn-secondary" onClick={onOpenFolder}>
          <Icon.folder width={12} height={12} />
          Open folder
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => {
            setDraft(project.name);
            setRenaming(true);
          }}
        >
          Rename
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary" onClick={onClose} title="Return clips to Library; files stay on disk">
          Close project
        </button>
        <button className="btn btn-danger" onClick={onDelete}>
          <Icon.trash width={12} height={12} />
          Delete
        </button>
      </div>

      <p className="hint" style={{ marginTop: 12 }}>
        <strong>Close</strong> returns clips to the Library and leaves every file on disk — just
        drops the grouping. <strong>Delete</strong> removes the clips from Media Hub
        {project.root_path
          ? " but never touches your chosen folder on disk."
          : " and moves the managed project folder to the Recycle Bin."}
      </p>
    </section>
  );
}
