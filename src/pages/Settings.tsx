import { Icon } from "../lib/icons";

/**
 * Settings — placeholder. Real settings panel lands with 0.9 packaging
 * (library root, concurrency, default transcode, optional Twitter cookie).
 */
export default function SettingsPage() {
  return (
    <div className="content">
      <div className="content-header">
        <div className="ch-title">Settings</div>
        <span className="ch-meta">coming with packaging milestone</span>
        <div className="ch-spacer" />
      </div>
      <div className="content-body">
        <div className="empty" style={{ padding: "80px 20px" }}>
          <Icon.settings width={32} height={32} style={{ color: "var(--text-3)" }} />
          <h3>Settings panel arrives with 0.9</h3>
          <p>
            Library root, download concurrency, default transcode preset, optional
            Twitter cookie. For now defaults live in code — see{" "}
            <code>src-tauri/src/lib.rs</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
