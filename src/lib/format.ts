// Pure formatting helpers — no state, no I/O.

export function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

export function fmtBytes(b: number | null): string {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtUploadDate(d: string | null): string {
  if (!d || d.length !== 8) return "—";
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

export function fmtEta(sec: number | null): string {
  if (sec == null || sec <= 0) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}:${s.toString().padStart(2, "0")}`;
  const h = Math.floor(m / 60);
  return `${h}:${(m % 60).toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Parse a flexible timestamp string into seconds.
 *
 * Accepted: "42" · "1:30" · "1:02:30" · "01:30.500" · "" → null
 */
export function parseTimestamp(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isFinite(n) || n < 0) return null;
    const mult = Math.pow(60, parts.length - 1 - i);
    total += n * mult;
  }
  return total;
}

export function extFromPath(p: string): string | null {
  const idx = p.lastIndexOf(".");
  if (idx <= 0) return null;
  return p.slice(idx + 1).toLowerCase();
}
