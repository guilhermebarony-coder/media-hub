import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Icon } from "../lib/icons";
import { useActiveProject } from "../lib/activeProject";
import type { Project } from "../lib/types";

/**
 * Projects screen — list + create + rename + delete.
 *
 * Phase A scope: metadata only. Creating a project does NOT make a
 * folder on disk yet (Phase B). Deleting a project sets its assets'
 * project_id to NULL, returning them to the Library — files on disk
 * stay put.
 *
 * The active-project picker in the top bar is the primary way to
 * switch scope; this page is the management surface for the projects
 * themselves.
 */
export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const { scope, setScope } = useActiveProject();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

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
    let unlisten: UnlistenFn | null = null;
    listen("library:changed", () => {
      void refresh();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  async function create(e?: FormEvent) {
    e?.preventDefault();
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setErr(null);
    try {
      const project = await invoke<Project>("project_create", { name });
      setNewName("");
      // Auto-activate the new project — matches the "I just made
      // this, where is it" reflex. Users who don't want it can flip
      // back to Library in one click via the top-bar picker.
      setScope({ kind: "project", id: project.id, name: project.name });
    } catch (e) {
      setErr(String(e));
    } finally {
      setCreating(false);
    }
  }

  async function rename(id: string) {
    const name = renameDraft.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    try {
      await invoke("project_rename", { id, name });
      // If the renamed project is currently active, update the
      // displayed name in the active-scope state too.
      if (scope.kind === "project" && scope.id === id) {
        setScope({ kind: "project", id, name });
      }
      setRenamingId(null);
      setRenameDraft("");
    } catch (e) {
      setErr(String(e));
    }
  }

  async function del(p: Project) {
    const msg =
      p.asset_count > 0
        ? `Delete project "${p.name}"?\n\n${p.asset_count} ${p.asset_count === 1 ? "clip" : "clips"} will be moved back to the Library. Files on disk are not deleted.`
        : `Delete project "${p.name}"?`;
    if (!confirm(msg)) return;
    try {
      await invoke("project_delete", { id: p.id });
      // If the deleted project was active, fall back to Library.
      if (scope.kind === "project" && scope.id === p.id) {
        setScope({ kind: "library" });
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  /**
   * Finish a project — the lifecycle endgame.
   *
   * Two-step confirm:
   *   1. "Are you done with this project?" — sets context. Lets the
   *      user choose whether to promote assets to Library or trash
   *      them with the folder.
   *   2. Implicit second step is the OS confirm dialog (window.confirm
   *      runs twice).
   *
   * On commit, calls project_finish which: optionally promotes assets
   * (moves files to Library/raw/), then OS-trashes the project folder,
   * then deletes the project row. Recoverable from Recycle Bin / Trash
   * if the user finished too early.
   */
  async function finish(p: Project) {
    const hasAssets = p.asset_count > 0;
    const intro = hasAssets
      ? `Finish project "${p.name}"?\n\n` +
        `This project has ${p.asset_count} ${p.asset_count === 1 ? "clip" : "clips"}. ` +
        `What should happen to them?\n\n` +
        `[OK] = Promote all to Library (keep clips, lose project structure)\n` +
        `[Cancel] = Choose more carefully…`
      : `Finish project "${p.name}"?\n\nThe project folder will be moved to Recycle Bin.`;

    if (!hasAssets) {
      if (!confirm(intro)) return;
      try {
        await invoke("project_finish", { id: p.id, promote: false });
        if (scope.kind === "project" && scope.id === p.id) {
          setScope({ kind: "library" });
        }
      } catch (e) {
        setErr(String(e));
      }
      return;
    }

    // Three-way choice: promote / trash-with-folder / cancel. Native
    // confirm can only do yes/no, so we do two stages.
    const promote = confirm(intro);
    if (!promote) {
      // User picked Cancel from the promote prompt — offer the
      // destructive path explicitly.
      const trashAll = confirm(
        `Trash everything in "${p.name}"?\n\n` +
          `${p.asset_count} ${p.asset_count === 1 ? "clip" : "clips"} AND the project folder will be moved to Recycle Bin.\n\n` +
          `Recoverable from the OS Recycle Bin, but not from inside Media Hub. ` +
          `Choose "Cancel" to back out entirely.`,
      );
      if (!trashAll) return;
      try {
        await invoke("project_finish", { id: p.id, promote: false });
        if (scope.kind === "project" && scope.id === p.id) {
          setScope({ kind: "library" });
        }
      } catch (e) {
        setErr(String(e));
      }
      return;
    }

    try {
      await invoke("project_finish", { id: p.id, promote: true });
      if (scope.kind === "project" && scope.id === p.id) {
        setScope({ kind: "library" });
      }
    } catch (e) {
      setErr(String(e));
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
        <span className="mono faint" style={{ fontSize: 11 }}>
          Phase A · metadata only · folder routing arrives next
        </span>
      </div>

      <div className="content-body">
        <div className="stack" style={{ maxWidth: 760 }}>
          <section className="card-box">
            <h2>
              New project
              <span className="chip">free-form name</span>
            </h2>
            <p className="hint">
              Names are case-insensitive unique. Anything you type is fine —
              we'll sanitize the folder name automatically (Phase B). Creating
              a project switches the active scope to it; flip back to{" "}
              <strong>Library</strong> from the top-bar picker any time.
            </p>
            <form className="field" onSubmit={create}>
              <input
                className="field-input"
                type="text"
                placeholder="e.g. Q3 Brand Spot · Drone Reel · Tutorial Vol 2"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={creating}
                maxLength={80}
                spellCheck={false}
                autoComplete="off"
              />
              <button type="submit" className="btn" disabled={creating || !newName.trim()}>
                <Icon.plus width={12} height={12} />
                {creating ? "Creating…" : "Create"}
              </button>
            </form>
            {err && (
              <div className="msg-row err">
                <span className="label">error</span>
                <code>{err}</code>
              </div>
            )}
          </section>

          <section className="card-box">
            <h2>Existing</h2>
            {projects.length === 0 ? (
              <div className="empty" style={{ padding: "30px 20px" }}>
                <Icon.projects width={22} height={22} style={{ color: "var(--text-3)" }} />
                <p>No projects yet. Create one above to scope your next downloads.</p>
              </div>
            ) : (
              <ul className="proj-list">
                {projects.map((p) => {
                  const isActive = scope.kind === "project" && scope.id === p.id;
                  const isRenaming = renamingId === p.id;
                  return (
                    <li key={p.id} className={"proj-row" + (isActive ? " active" : "")}>
                      <span className={"proj-row-dot" + (isActive ? " on" : "")} />
                      <div className="proj-row-body">
                        {isRenaming ? (
                          <input
                            className="field-input proj-row-rename"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void rename(p.id);
                              else if (e.key === "Escape") {
                                setRenamingId(null);
                                setRenameDraft("");
                              }
                            }}
                            onBlur={() => void rename(p.id)}
                            autoFocus
                            maxLength={80}
                            spellCheck={false}
                          />
                        ) : (
                          <div className="proj-row-name">{p.name}</div>
                        )}
                        <div className="proj-row-meta mono">
                          <span>{p.asset_count} {p.asset_count === 1 ? "clip" : "clips"}</span>
                          <span className="sep">·</span>
                          <span>created {new Date(p.created_at * 1000).toLocaleDateString()}</span>
                          <span className="sep">·</span>
                          <span className="faint">{p.slug}</span>
                        </div>
                      </div>
                      <div className="proj-row-actions">
                        {!isActive && !isRenaming && (
                          <button
                            className="btn btn-secondary"
                            onClick={() => setScope({ kind: "project", id: p.id, name: p.name })}
                          >
                            Activate
                          </button>
                        )}
                        {!isRenaming && (
                          <button
                            className="btn btn-secondary"
                            onClick={() => {
                              setRenamingId(p.id);
                              setRenameDraft(p.name);
                            }}
                          >
                            Rename
                          </button>
                        )}
                        {!isRenaming && (
                          <button
                            className="btn btn-secondary"
                            onClick={() => void finish(p)}
                            title="Wrap up: promote to Library and move folder to Recycle Bin"
                          >
                            Finish
                          </button>
                        )}
                        <button className="btn btn-danger" onClick={() => void del(p)}>
                          Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
