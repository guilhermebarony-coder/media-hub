/**
 * RtxQueueDock (Phase 1) — persistent bottom-left status dock for the RTX
 * enhance queue. Appears only while there are jobs; shows live per-frame
 * progress, opens the before/after window (click a row or the eye button),
 * and lets you remove queued/finished rows or collapse to a compact pill.
 */

import { useState } from "react";
import { Icon } from "../lib/icons";
import { useRtxEnhance, type RtxJob } from "../lib/rtxEnhance";

function statusLabel(j: RtxJob): string {
  switch (j.status) {
    case "staged":
      return "Setting up";
    case "queued":
      return "Queued";
    case "running":
      return j.eta ? `${j.percent.toFixed(0)}% · ${j.fps.toFixed(0)} fps · ETA ${j.eta}` : "Starting…";
    case "done":
      return "Done";
    case "failed":
      return j.error ? `Failed — ${j.error}` : "Failed";
    case "canceled":
      return "Canceled";
  }
}

function JobRow({ job }: { job: RtxJob }) {
  const { removeJob, cancelJob, openWindow } = useRtxEnhance();
  const dims =
    job.scale <= 1
      ? job.height
        ? `${job.height}p · clean`
        : "decompress"
      : job.height
        ? `${job.height}p → ${job.height * job.scale}p`
        : `${job.scale}× upscale`;
  return (
    <div
      className={`rtx-job rtx-job-${job.status}`}
      role="button"
      onClick={() => openWindow(job.id)}
      title="Open before/after"
    >
      <div className="rtx-job-main">
        <span className="rtx-job-title" title={job.title}>
          {job.title}
        </span>
        {job.status !== "running" && <span className="rtx-job-dims">{dims}</span>}
      </div>
      <div className="rtx-job-status">{statusLabel(job)}</div>
      {job.status === "running" && (
        <div className="rtx-job-track">
          <div className="rtx-job-fill" style={{ width: `${job.percent}%` }} />
        </div>
      )}
      <button
        className={`rtx-job-x ${job.status === "running" ? "rtx-job-stop" : ""}`}
        title={job.status === "running" ? "Stop" : "Remove"}
        onClick={(e) => {
          e.stopPropagation();
          if (job.status === "running") cancelJob(job.id);
          else removeJob(job.id);
        }}
      >
        <Icon.x width={12} height={12} />
      </button>
    </div>
  );
}

export function RtxQueueDock() {
  const { jobs, activeCount, clearFinished, openWindow } = useRtxEnhance();
  const [collapsed, setCollapsed] = useState(false);

  if (jobs.length === 0) return null;

  // Mirror clearFinished's own definition of "finished" -- it deletes
  // canceled jobs too, so leaving them out here hid the button in exactly
  // the case where stopping a clip was what created the row.
  const hasFinished = jobs.some(
    (j) => j.status === "done" || j.status === "failed" || j.status === "canceled",
  );

  return (
    <div className={`rtx-dock ${collapsed ? "rtx-dock-collapsed" : ""}`}>
      <div className="rtx-dock-head">
        <Icon.video width={13} height={13} />
        <span className="rtx-dock-title">RTX Upscale</span>
        {activeCount > 0 && <span className="rtx-dock-count">{activeCount}</span>}
        <span className="rtx-dock-spacer" />
        <button className="rtx-dock-btn" title="Open window" onClick={() => openWindow()}>
          <Icon.eye width={13} height={13} />
        </button>
        <button
          className="rtx-dock-btn"
          title={collapsed ? "Expand" : "Collapse"}
          onClick={() => setCollapsed((c) => !c)}
        >
          <Icon.chev
            width={12}
            height={12}
            style={{ transform: collapsed ? "rotate(180deg)" : "none" }}
          />
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="rtx-dock-list">
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </div>
          {hasFinished && (
            <button className="rtx-dock-clear" onClick={clearFinished}>
              Clear finished
            </button>
          )}
        </>
      )}
    </div>
  );
}
