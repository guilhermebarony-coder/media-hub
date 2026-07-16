import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useT } from "../lib/i18n";

/** Mirrors updater.rs `AppUpdateStatus` (the check_for_app_update IPC shape). */
type AppUpdateStatus = {
  available: boolean;
  remote_version: string;
  current_version: string;
  notes: string | null;
};

/** localStorage key holding the last remote version we notified about. */
const NOTICED_KEY = "mh.updateNotice.shown";

/**
 * 1.12.x — light, once-per-version update notice.
 *
 * A few seconds after boot (delayed so it never competes with startup
 * work) this asks the existing app updater (`check_for_app_update`, a
 * single cheap GET against the GitHub Releases manifest) whether a newer
 * signed build exists. If so — and we haven't already told the user about
 * THAT version — a small dismissible pill shows bottom-right.
 *
 * The version is marked as "noticed" the moment the pill renders, so each
 * release announces itself exactly once, ever. The manual button in
 * Settings → Diagnostics remains the explicit path. Errors are swallowed:
 * this is a background nicety, never a nag.
 */
export function UpdateNotice() {
  const t = useT();
  const [version, setVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const s = await invoke<AppUpdateStatus>("check_for_app_update");
        if (!s.available) return;
        if (localStorage.getItem(NOTICED_KEY) === s.remote_version) return;
        localStorage.setItem(NOTICED_KEY, s.remote_version);
        setVersion(s.remote_version);
      } catch {
        // Offline / rate-limited / bad manifest — stay silent.
      }
    }, 6000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!version) return null;
  return (
    <div className="update-notice" role="status">
      <span className="update-notice-dot" aria-hidden />
      <span className="update-notice-text">
        {failed
          ? t("update.failed")
          : t("update.available").replace("{v}", version)}
      </span>
      {!failed && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={installing}
          onClick={async () => {
            setInstalling(true);
            try {
              // Passive installer: downloads, verifies the signature and
              // relaunches the app — nothing left for us to render after.
              await invoke("install_app_update");
            } catch {
              setInstalling(false);
              setFailed(true);
            }
          }}
        >
          {installing ? t("update.installing") : t("update.install")}
        </button>
      )}
      <button
        type="button"
        className="update-notice-x"
        onClick={() => setVersion(null)}
        aria-label={t("update.dismiss")}
        title={t("update.dismiss")}
      >
        ×
      </button>
    </div>
  );
}
