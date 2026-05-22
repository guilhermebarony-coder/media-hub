/**
 * Dialog helpers that actually work in Tauri's WebView2.
 *
 * The native browser `window.confirm()` / `window.alert()` are
 * either suppressed or return immediately in Tauri's WebView2
 * context — meaning destructive actions guarded by `if (!confirm())
 * return` would silently proceed without a prompt. Real-user
 * testing on 2026-05-22 PM confirmed: clicking "Delete file" in
 * the library context menu was straight-up deleting the file
 * with NO popup ever appearing.
 *
 * The fix: use `@tauri-apps/plugin-dialog` which talks to the
 * native OS dialog API directly. Yes/no prompts route through
 * `ask()`, error messages route through `message()`.
 *
 * Both helpers are async. Callers that used the old sync
 * `confirm(...)` need to `await` these.
 */

import { ask, message } from "@tauri-apps/plugin-dialog";

/**
 * Modal yes/no prompt. Returns true when the user accepts, false
 * otherwise (including when the plugin errors out — safer default
 * for destructive actions).
 *
 * Use `kind: "warning"` (default) for cautionary prompts, "error"
 * for irreversible ones (it tints the OS dialog).
 */
export async function confirmDialog(
  msg: string,
  opts?: { title?: string; kind?: "info" | "warning" | "error" },
): Promise<boolean> {
  try {
    return await ask(msg, {
      title: opts?.title ?? "Are you sure?",
      kind: opts?.kind ?? "warning",
    });
  } catch (e) {
    console.warn("confirmDialog failed:", e);
    return false;
  }
}

/**
 * Modal notification (for errors / "operation failed" messages).
 * Defaults to error kind. Returns when the user dismisses.
 */
export async function alertDialog(
  msg: string,
  opts?: { title?: string; kind?: "info" | "warning" | "error" },
): Promise<void> {
  try {
    await message(msg, {
      title: opts?.title ?? "Notice",
      kind: opts?.kind ?? "error",
    });
  } catch (e) {
    console.warn("alertDialog failed:", e);
  }
}
