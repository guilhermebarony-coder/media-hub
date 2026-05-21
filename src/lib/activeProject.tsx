/**
 * Active-project context — single source of truth for "which scope is
 * the user looking at / downloading into."
 *
 * The Shell mounts the Provider once. The TopBar picker, the Library
 * page, the Projects page, and (in Phase B) the Download page all read
 * from this context.
 *
 * Persistence: the active scope serializes to localStorage so the
 * choice survives app restarts. On load we double-check the project
 * still exists; if it was deleted between sessions we fall back to
 * Library.
 *
 * Project list refresh: we subscribe to `library:changed` and re-fetch
 * the list, same pattern as the Library page. Project create / rename /
 * delete all emit that event from Rust, so the picker stays current
 * without manual invalidation.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ActiveScope, Project } from "./types";

const STORAGE_KEY = "mh.activeScope.v1";
const LIBRARY: ActiveScope = { kind: "library" };

type Ctx = {
  scope: ActiveScope;
  setScope: (s: ActiveScope) => void;
  projects: Project[];
  refreshProjects: () => Promise<void>;
};

const ActiveProjectContext = createContext<Ctx | null>(null);

function loadFromStorage(): ActiveScope {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return LIBRARY;
    const parsed = JSON.parse(raw) as ActiveScope;
    if (parsed.kind === "library" || parsed.kind === "project") return parsed;
    return LIBRARY;
  } catch {
    return LIBRARY;
  }
}

export function ActiveProjectProvider({ children }: { children: ReactNode }) {
  const [scope, setScopeState] = useState<ActiveScope>(() => loadFromStorage());
  const [projects, setProjects] = useState<Project[]>([]);

  const refreshProjects = useCallback(async () => {
    try {
      const list = await invoke<Project[]>("project_list");
      setProjects(list);
      // If the active project was deleted between renders, fall back
      // to Library quietly. Doing it here keeps the check colocated
      // with the source of truth.
      setScopeState((current) => {
        if (current.kind === "project" && !list.some((p) => p.id === current.id)) {
          return LIBRARY;
        }
        return current;
      });
    } catch (e) {
      console.warn("project_list failed:", e);
    }
  }, []);

  // Initial load + subscribe to library:changed so picker updates
  // when projects are created / renamed / deleted from any screen.
  useEffect(() => {
    void refreshProjects();
    let unlisten: UnlistenFn | null = null;
    listen("library:changed", () => {
      void refreshProjects();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [refreshProjects]);

  // Persist on every change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scope));
    } catch {
      // localStorage quota / disabled — skip silently.
    }
  }, [scope]);

  const setScope = useCallback((s: ActiveScope) => setScopeState(s), []);

  return (
    <ActiveProjectContext.Provider value={{ scope, setScope, projects, refreshProjects }}>
      {children}
    </ActiveProjectContext.Provider>
  );
}

export function useActiveProject(): Ctx {
  const ctx = useContext(ActiveProjectContext);
  if (!ctx) {
    throw new Error("useActiveProject must be inside <ActiveProjectProvider />");
  }
  return ctx;
}

/** Convert an ActiveScope into the LibraryScope filter shape the
 *  backend expects. They differ slightly because ActiveScope carries
 *  the project NAME for UI display, while LibraryScope only needs the
 *  id for the SQL query. */
export function scopeToFilter(s: ActiveScope) {
  if (s.kind === "library") return { kind: "library" as const };
  return { kind: "project" as const, id: s.id };
}
