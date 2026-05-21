import { Icon } from "../lib/icons";

/**
 * Projects screen — placeholder. The dual-root library structure
 * (`Library/` + `Projects/<name>/` with active-project sticky default)
 * is scoped to 0.6 per ROADMAP. Until then, this screen documents what
 * lands and why, so the nav item isn't a broken link.
 */
export default function ProjectsPage() {
  return (
    <div className="content">
      <div className="content-header">
        <div className="ch-title">Projects</div>
        <span className="ch-meta">coming in 0.6</span>
        <div className="ch-spacer" />
      </div>
      <div className="content-body">
        <div className="empty" style={{ padding: "80px 20px" }}>
          <Icon.projects width={32} height={32} style={{ color: "var(--text-3)" }} />
          <h3>Projects arrive with milestone 0.6</h3>
          <p>
            Every download will be filed into either your <strong>Library</strong>{" "}
            (forever-reusable) or an <strong>active project</strong> folder
            (scoped, deletable as a unit). Promote between them with one click;
            finish a project to move the whole folder to OS trash.
          </p>
          <p className="faint" style={{ fontSize: 11 }}>
            See <code>docs/NOTES.md</code> → "Library vs Projects" for the model.
          </p>
        </div>
      </div>
    </div>
  );
}
