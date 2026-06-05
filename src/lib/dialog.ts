/**
 * In-app dialog system — custom, styled, and SILENT.
 *
 * History: we used to route through `@tauri-apps/plugin-dialog`'s
 * native `ask()` / `message()` because the browser `confirm()` /
 * `alert()` are no-ops in WebView2. Those native dialogs worked but
 * (a) play the OS system chime (the harsh "ding" on every prompt)
 * and (b) look like generic Windows boxes, not part of the app.
 *
 * This module replaces the backend with a tiny pub/sub store driving
 * a React modal (`DialogHost`, mounted once at app root). The public
 * API — `confirmDialog` / `alertDialog` — keeps the exact same async
 * signatures, so all existing call sites work unchanged. No sound,
 * fully themable.
 */

export type DialogKind = "info" | "warning" | "error";

export type DialogRequest = {
  id: number;
  mode: "confirm" | "alert";
  title: string;
  message: string;
  kind: DialogKind;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (accepted: boolean) => void;
};

type Listener = (queue: DialogRequest[]) => void;

const listeners = new Set<Listener>();
let queue: DialogRequest[] = [];
let nextId = 1;

function emit() {
  const snapshot = [...queue];
  for (const l of listeners) l(snapshot);
}

/** DialogHost subscribes here. Returns an unsubscribe fn. */
export function subscribeDialogs(l: Listener): () => void {
  listeners.add(l);
  l([...queue]); // prime with current state
  return () => {
    listeners.delete(l);
  };
}

/** Resolve + dequeue a request by id (called by DialogHost buttons). */
export function resolveDialog(id: number, accepted: boolean) {
  const req = queue.find((r) => r.id === id);
  if (!req) return;
  queue = queue.filter((r) => r.id !== id);
  emit();
  req.resolve(accepted);
}

/**
 * Modal yes/no prompt. Resolves true when accepted, false otherwise.
 * Safer default (false) preserved for destructive actions.
 */
export function confirmDialog(
  msg: string,
  opts?: {
    title?: string;
    kind?: DialogKind;
    confirmLabel?: string;
    cancelLabel?: string;
  },
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    queue.push({
      id: nextId++,
      mode: "confirm",
      title: opts?.title ?? "Are you sure?",
      message: msg,
      kind: opts?.kind ?? "warning",
      confirmLabel: opts?.confirmLabel ?? "Confirm",
      cancelLabel: opts?.cancelLabel ?? "Cancel",
      resolve,
    });
    emit();
  });
}

/**
 * Modal notification (errors / "operation failed" messages).
 * Resolves when dismissed.
 */
export function alertDialog(
  msg: string,
  opts?: { title?: string; kind?: DialogKind; confirmLabel?: string },
): Promise<void> {
  return new Promise<void>((resolve) => {
    queue.push({
      id: nextId++,
      mode: "alert",
      title: opts?.title ?? "Notice",
      message: msg,
      kind: opts?.kind ?? "error",
      confirmLabel: opts?.confirmLabel ?? "OK",
      cancelLabel: "",
      resolve: () => resolve(),
    });
    emit();
  });
}
