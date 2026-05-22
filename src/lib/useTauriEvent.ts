/**
 * useTauriEvent — listener that survives the mount/unmount race.
 *
 * Tauri's `listen(event, handler)` returns a Promise<UnlistenFn>.
 * The natural usage pattern looks like:
 *
 *   useEffect(() => {
 *     let unlisten: UnlistenFn | null = null;
 *     listen("evt", handler).then((fn) => { unlisten = fn; });
 *     return () => { unlisten?.(); };
 *   }, []);
 *
 * But this has a subtle leak: if the component unmounts BEFORE the
 * `listen()` promise resolves, the cleanup runs with
 * `unlisten === null` (no-op), then the promise resolves and assigns
 * the unlisten fn to the now-orphan variable. The listener is
 * registered to Tauri forever, retains its closure (which retains
 * setState callbacks pointing at an unmounted component), and the
 * orphan fn is never called. React doesn't warn about this — the
 * setState calls just no-op silently. Memory accumulates per
 * registration.
 *
 * Most-likely-to-bite-us sites:
 *   - Library asset drawer (remounts on every asset click)
 *   - Any short-lived component that subscribes
 *
 * The fix this hook implements:
 *   1. A `cancelled` flag closed over by the .then() callback.
 *   2. When the promise resolves: if cancelled, immediately invoke
 *      the unlisten fn instead of assigning it.
 *   3. Otherwise, save it for the cleanup phase as usual.
 *
 * Handler stability:
 *
 * The handler is captured ONCE via a ref so subscribing/unsubscribing
 * doesn't re-fire when the parent re-renders (which would happen if
 * handler were in the dep array). The ref is updated synchronously on
 * every render so the latest handler closure runs when an event
 * arrives.
 */

import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type EventHandler<T> = (event: { payload: T }) => void;

export function useTauriEvent<T = unknown>(
  event: string,
  handler: EventHandler<T>,
): void {
  // Ref keeps the latest handler closure available without forcing
  // re-subscription on every render. The .current read inside the
  // listen wrapper picks up whatever the latest render gave us.
  const handlerRef = useRef<EventHandler<T>>(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<T>(event, (e) => {
      // Defensive guard — between cleanup and the listener still
      // being callable (e.g. in-flight event already dispatched),
      // we'd otherwise call into a possibly-unmounted component.
      if (!cancelled) handlerRef.current(e);
    })
      .then((fn) => {
        if (cancelled) {
          // Unmounted before subscription completed — drop it now.
          void fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        // Subscription failures are rare (Tauri IPC issue). Don't
        // throw — just log and let the component proceed without
        // the event stream.
        console.warn(`useTauriEvent(${event}) subscribe failed:`, err);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [event]);
}
