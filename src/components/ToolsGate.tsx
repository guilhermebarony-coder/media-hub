/**
 * First-run tool setup gate (1.12.0).
 *
 * ffmpeg + deno are no longer bundled — they're downloaded to app-data on
 * first launch (see src-tauri/src/tools.rs). This overlay blocks the app
 * until ffmpeg (the required one) is present, showing live download
 * progress. On subsequent launches the tools already exist, so this checks
 * status once and renders nothing.
 */
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type ToolsStatus = { ffmpeg: boolean; deno: boolean; ready: boolean };
type ToolProgress = {
  tool: string;
  phase: "download" | "extract" | "done";
  received: number;
  total: number | null;
  percent: number | null;
};

export function ToolsGate() {
  // null = still checking; true = show the gate; false = ready, render nothing.
  const [show, setShow] = useState<boolean | null>(null);
  const [prog, setProg] = useState<ToolProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    invoke<ToolsStatus>("tools_status")
      .then((s) => setShow(!s.ready))
      .catch(() => setShow(false)); // never trap the user if the check fails
  }, []);

  useEffect(() => {
    const un = listen<ToolProgress>("tools:progress", (e) => setProg(e.payload));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  async function runSetup() {
    setError(null);
    setProg(null);
    try {
      await invoke("tools_ensure");
      const s = await invoke<ToolsStatus>("tools_status");
      if (s.ready) setShow(false);
      else setError("Setup finished but ffmpeg still isn't available. Please retry.");
    } catch (e) {
      setError(String(e));
    }
  }

  // Auto-start the download the first time we learn tools are missing.
  useEffect(() => {
    if (show === true && !started.current) {
      started.current = true;
      void runSetup();
    }
  }, [show]);

  if (show !== true) return null;

  const pct = prog?.percent != null ? Math.round(prog.percent) : null;
  const phaseLabel =
    prog?.phase === "extract"
      ? "Installing"
      : prog?.phase === "done"
        ? "Finishing"
        : "Downloading";
  const toolLabel = prog ? `${phaseLabel} ${prog.tool}` : "Preparing…";

  return (
    <div className="tools-gate">
      <div className="tools-gate-card">
        <div className="tools-gate-logo">⚙</div>
        <h1>Setting up Media Hub</h1>
        <p>
          Downloading the media engine (ffmpeg + deno, ~120&nbsp;MB). This
          happens once — future launches start instantly.
        </p>

        {error ? (
          <>
            <div className="tools-gate-error mono">{error}</div>
            <button className="btn btn-primary" onClick={() => void runSetup()}>
              Retry
            </button>
            <p className="tools-gate-hint">
              Needs an internet connection. If it keeps failing, check your
              firewall/proxy — the files come from GitHub.
            </p>
          </>
        ) : (
          <>
            <div className="tools-gate-bar">
              <div
                className={"tools-gate-fill" + (pct == null ? " indeterminate" : "")}
                style={pct != null ? { width: `${pct}%` } : undefined}
              />
            </div>
            <div className="tools-gate-status mono">
              {toolLabel}
              {pct != null ? ` · ${pct}%` : "…"}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
