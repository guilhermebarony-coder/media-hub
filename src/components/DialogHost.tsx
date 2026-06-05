// 1.3.x — In-app dialog renderer. Mounted once at the app root; it
// subscribes to the dialog store (src/lib/dialog.ts) and renders the
// oldest pending request as a styled, silent modal. Replaces the
// native Tauri dialogs (which played the OS chime).
//
// Keyboard: Enter confirms, Escape cancels (alerts treat both as
// dismiss). Backdrop click cancels. Focus lands on the primary
// button so a quick Enter just works.

import { useEffect, useRef, useState } from "react";
import {
  subscribeDialogs,
  resolveDialog,
  type DialogRequest,
} from "../lib/dialog";

export function DialogHost() {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  useEffect(() => subscribeDialogs(setQueue), []);

  // Only the oldest request is shown; the rest wait behind it.
  const active = queue[0] ?? null;
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!active) return;
    // Focus the primary action so Enter resolves immediately.
    confirmBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        resolveDialog(active!.id, true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        // Alerts have no cancel — Escape just dismisses (accepted=true
        // is meaningless for void alerts; for confirms it's a cancel).
        resolveDialog(active!.id, active!.mode === "alert");
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active]);

  if (!active) return null;

  const isConfirm = active.mode === "confirm";

  return (
    <div
      className="mh-dialog-backdrop"
      onMouseDown={(e) => {
        // Backdrop click cancels (or dismisses an alert). Ignore
        // clicks that originated inside the modal.
        if (e.target === e.currentTarget) {
          resolveDialog(active.id, !isConfirm);
        }
      }}
    >
      <div
        className={"mh-dialog mh-dialog-" + active.kind}
        role="dialog"
        aria-modal="true"
        aria-label={active.title}
      >
        <div className="mh-dialog-head">
          <span className={"mh-dialog-dot mh-dialog-dot-" + active.kind} />
          <h2 className="mh-dialog-title">{active.title}</h2>
        </div>
        <p className="mh-dialog-msg">{active.message}</p>
        <div className="mh-dialog-actions">
          {isConfirm && active.cancelLabel && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => resolveDialog(active.id, false)}
            >
              {active.cancelLabel}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            className={
              "btn" + (active.kind === "error" && isConfirm ? " btn-danger" : "")
            }
            onClick={() => resolveDialog(active.id, true)}
          >
            {active.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
