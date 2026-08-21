/**
 * RTX install card (1.15.0).
 *
 * The enhancer is NOT part of the installer: it is a ~28 MB bundle
 * (worker + NVIDIA runtime DLLs + the CodecClean weights) pulled from a
 * GitHub release on demand. Two places offer it — the first-run wizard and
 * Settings → RTX Video — and they render THIS component, so the wording,
 * the progress and the failure can never drift apart between them.
 *
 * It renders nothing unless the machine has a capable RTX GPU and the
 * bundle is missing. Every other RTX control in the app is hidden in that
 * same state, so this card is the only RTX thing a fresh install shows.
 */
import { useRtxEnhance } from "../lib/rtxEnhance";
import { useT } from "../lib/i18n";
import { Icon } from "../lib/icons";

/** "28 MB" — one decimal only under 10 MB, where it actually matters. */
function mb(bytes: number): string {
  const m = bytes / 1_000_000;
  return m >= 10 ? `${Math.round(m)} MB` : `${m.toFixed(1)} MB`;
}

export function RtxInstallCard({
  /** The wizard says "you can do this later"; Settings IS later. */
  showLater = false,
}: {
  showLater?: boolean;
}) {
  const t = useT();
  const {
    capability,
    rtxInstallable,
    installBytes,
    installing,
    installPercent,
    installError,
    ensureWorker,
  } = useRtxEnhance();

  // Still probing, no RTX card, or already installed → nothing to offer.
  if (!rtxInstallable) return null;

  const size = installBytes > 0 ? mb(installBytes) : "";
  const gpu = capability?.gpu_name || t("rtx.install.yourGpu");
  const pct = installPercent == null ? null : Math.max(0, Math.min(100, installPercent));

  return (
    <div className="rtx-install">
      <div className="rtx-install-head">
        <span className="rtx-install-icon">
          <Icon.rtx width={16} height={16} />
        </span>
        <div className="rtx-install-heading">
          <div className="rtx-install-title">{t("rtx.install.title")}</div>
          <div className="rtx-install-gpu mono">{gpu}</div>
        </div>
      </div>

      <p className="rtx-install-body">
        {size
          ? t("rtx.install.body").replace("{size}", size)
          : t("rtx.install.bodyNoSize")}
      </p>

      {installing ? (
        <div className="rtx-install-prog">
          <div className="rtx-install-track">
            {/* No percentage yet = the request is still opening. An
                indeterminate bar is honest about that; a 0% bar is not. */}
            <i
              className={pct == null ? "indet" : ""}
              style={pct == null ? undefined : { width: `${pct}%` }}
            />
          </div>
          <span className="rtx-install-pct mono">
            {pct == null ? t("rtx.install.starting") : `${Math.round(pct)}%`}
          </span>
        </div>
      ) : (
        <div className="rtx-install-actions">
          <button type="button" className="btn btn-primary" onClick={() => void ensureWorker()}>
            {installError ? t("rtx.install.retry") : t("rtx.install.cta")}
          </button>
          {showLater && <span className="rtx-install-later">{t("rtx.install.later")}</span>}
        </div>
      )}

      {installError && !installing && (
        <div className="rtx-install-err">{installError}</div>
      )}

      {/* The card is the moment the user agrees to pull NVIDIA's runtime
          onto their machine, so it is where NVIDIA's terms belong. */}
      <div className="rtx-install-legal">{t("rtx.install.legal")}</div>
    </div>
  );
}
