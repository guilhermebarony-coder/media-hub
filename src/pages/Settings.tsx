import { Icon } from "../lib/icons";
import { useSettings } from "../lib/settings";

/**
 * Settings page — 0.8 milestone.
 *
 * Sections (laid out in 0.8.A, fields filled in 0.8.B / 0.8.C / 0.8.D):
 *   - Sources     → YouTube cookies (B)
 *   - Library     → root override (B), rename template (C)
 *   - Downloads   → concurrency (B), bandwidth (C), sticky format (C)
 *   - Transcode   → default preset (B)
 *   - Diagnostics → tool versions, library.db path, recycle bin (B)
 *   - About       → version, build, licenses (B)
 *
 * Each section card lives independently so future fields just slot in.
 * Sections that have no live fields yet show a "Coming in 0.8.X" hint
 * so it's obvious what's wired vs. scaffolded.
 */
export default function SettingsPage() {
  const { ready } = useSettings();

  return (
    <div className="content">
      <div className="content-header">
        <div className="ch-title">Settings</div>
        <span className="ch-meta">0.8 in progress</span>
        <div className="ch-spacer" />
        <span className="mono faint" style={{ fontSize: 11 }}>
          {ready ? "settings.json live" : "loading…"}
        </span>
      </div>

      <div className="content-body">
        <div className="stack" style={{ maxWidth: 760 }}>
          <SectionPlaceholder
            title="Sources"
            chip="0.8.B"
            description="YouTube cookies source — unlocks age-restricted videos and following-only Twitter content. Pick the browser you're signed in to, point at a cookies.txt, or leave at None for public-only sources."
          />

          <SectionPlaceholder
            title="Library"
            chip="0.8.B / 0.8.C"
            description="Library root override (move ~/Media Hub somewhere else). Rename rule with {channel}/{title}/{date} tokens plus a few preset patterns."
          />

          <SectionPlaceholder
            title="Downloads"
            chip="0.8.B / 0.8.C"
            description="Parallel download workers (default 3). Optional bandwidth throttle. Sticky last-format memory per platform."
          />

          <SectionPlaceholder
            title="Transcode"
            chip="0.8.B"
            description="Default transcode preset for new downloads. ProRes 422 LT / DNxHR SQ / H.264 MP4 / NVENC. Editable per-download from the picker."
          />

          <SectionPlaceholder
            title="Diagnostics"
            chip="0.8.B"
            description="yt-dlp + ffmpeg versions, library.db path, recycle bin shortcut."
          />

          <SectionPlaceholder
            title="About"
            chip="0.8.B"
            description="Version, build hash, links to yt-dlp + ffmpeg licenses, link to docs."
          />
        </div>
      </div>
    </div>
  );
}

function SectionPlaceholder({
  title,
  chip,
  description,
}: {
  title: string;
  chip: string;
  description: string;
}) {
  return (
    <section className="card-box">
      <h2>
        {title}
        <span className="chip">{chip}</span>
      </h2>
      <p className="hint">{description}</p>
      <div className="settings-placeholder">
        <Icon.settings width={18} height={18} style={{ color: "var(--text-3)" }} />
        <span className="faint mono" style={{ fontSize: 11 }}>
          Fields land with {chip}.
        </span>
      </div>
    </section>
  );
}
