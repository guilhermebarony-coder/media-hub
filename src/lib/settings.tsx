/**
 * Settings context — single source of truth for user-tweakable
 * preferences. Mirrors the Rust `Settings` struct exactly (see
 * src-tauri/src/settings.rs).
 *
 * The provider loads on mount, subscribes to `settings:changed`, and
 * exposes `settings` + a `save(updater)` helper. The updater takes
 * the current settings and returns a new shape — same pattern as
 * React's `setState(fn)`, so callers don't race on stale snapshots.
 *
 * Save semantics:
 *   - Optimistic: updates local state immediately so the UI feels
 *     instant
 *   - Then invokes `settings_set` which atomically rewrites
 *     settings.json on disk
 *   - On failure, reverts local state to the previous value AND
 *     surfaces the error to the caller (caller decides whether to
 *     show it inline — most settings UIs will just `void save(...)`
 *     and let the next `settings:changed` event correct any drift)
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
import { DEFAULT_SETTINGS, type Settings } from "./types";

type Ctx = {
  settings: Settings;
  ready: boolean;
  save: (updater: (current: Settings) => Settings) => Promise<void>;
};

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  // Initial load + subscribe to changes. The subscription matters when
  // multiple windows ever open, or when something on the Rust side
  // (e.g. the onboarding flow) writes settings directly — UI reflects
  // without a refresh.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    (async () => {
      try {
        const s = await invoke<Settings>("settings_get");
        setSettings(s);
      } catch (e) {
        console.warn("settings_get failed, using defaults:", e);
      } finally {
        setReady(true);
      }
      try {
        unlisten = await listen<Settings>("settings:changed", async () => {
          try {
            const s = await invoke<Settings>("settings_get");
            setSettings(s);
          } catch (e) {
            console.warn("settings refresh failed:", e);
          }
        });
      } catch (e) {
        console.warn("settings:changed subscription failed:", e);
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  const save = useCallback(
    async (updater: (current: Settings) => Settings) => {
      let next: Settings = settings;
      setSettings((current) => {
        next = updater(current);
        return next;
      });
      try {
        await invoke("settings_set", { settings: next });
      } catch (e) {
        // Revert — and re-fetch to get whatever's actually on disk.
        console.warn("settings_set failed, reverting:", e);
        try {
          const refetched = await invoke<Settings>("settings_get");
          setSettings(refetched);
        } catch {
          // Last resort: leave the optimistic state. User can retry.
        }
        throw e;
      }
    },
    [settings],
  );

  return (
    <SettingsContext.Provider value={{ settings, ready, save }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be inside <SettingsProvider />");
  }
  return ctx;
}
