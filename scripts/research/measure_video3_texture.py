from __future__ import annotations

import csv
import subprocess
from pathlib import Path

import numpy as np


ROOT = Path(r"E:\TESTE CLAUDE CODEX\Test Video 3")
OUT = ROOT / "_analysis" / "restored" / "codex" / "nlmeans_vulkan_test"
FFMPEG = Path.home() / "AppData" / "Roaming" / "com.guilherme.mediahub" / "bin" / "ffmpeg.exe"
WIDTH, HEIGHT = 1280, 720

VIDEOS = {
    "source_upload": ROOT / "Sora_RyoTa_-_Babilonia [mEzxpHslNgE].mp4",
    "preclean_s2.5": OUT / "_intermediate" / "nlmeansVK-s2.5-gblurVK0.6_preclean720.mp4",
    "preclean_s3.0": OUT / "_intermediate" / "nlmeansVK-s3.0-gblurVK0.6_preclean720.mp4",
    "rtx_only": OUT / "00_RTX-only_1440_FINAL.mp4",
    "s2.5_then_rtx": OUT / "nlmeansVK-s2.5-gblurVK0.6-RTX_1440_FINAL.mp4",
    "s3.0_then_rtx": OUT / "nlmeansVK-s3.0-gblurVK0.6-RTX_1440_FINAL.mp4",
}


def blur5(image: np.ndarray) -> np.ndarray:
    """Separable [1 4 6 4 1]/16 blur without external image libraries."""
    weights = np.array([1, 4, 6, 4, 1], dtype=np.float32) / 16.0
    padded = np.pad(image, ((0, 0), (2, 2)), mode="reflect")
    horizontal = sum(weights[i] * padded[:, i : i + image.shape[1]] for i in range(5))
    padded = np.pad(horizontal, ((2, 2), (0, 0)), mode="reflect")
    return sum(weights[i] * padded[i : i + image.shape[0], :] for i in range(5))


def raw_frames(path: Path):
    command = [
        str(FFMPEG), "-v", "error", "-ss", "2", "-i", str(path),
        "-vf", f"fps=2,scale={WIDTH}:{HEIGHT}:flags=lanczos,format=gray",
        "-an", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE)
    assert process.stdout is not None
    frame_size = WIDTH * HEIGHT
    while True:
        data = process.stdout.read(frame_size)
        if len(data) != frame_size:
            break
        yield np.frombuffer(data, dtype=np.uint8).reshape(HEIGHT, WIDTH).astype(np.float32)
    if process.wait() != 0:
        raise RuntimeError(f"ffmpeg failed for {path}")


def measure(path: Path) -> dict[str, float]:
    mads: list[float] = []
    rmss: list[float] = []
    coverages: list[float] = []
    for frame in raw_frames(path):
        smooth = blur5(frame)
        residual = frame - smooth
        gx = np.abs(smooth[:, 2:] - smooth[:, :-2]) * 0.5
        gy = np.abs(smooth[2:, :] - smooth[:-2, :]) * 0.5
        gradient = np.zeros_like(frame)
        gradient[1:-1, 1:-1] = np.hypot(gx[1:-1, :], gy[:, 1:-1])

        # Keep ordinary flat/mid-tone pixels. Excluding edges prevents RTX
        # sharpening from masquerading as retained grain.
        mask = (gradient < 2.5) & (smooth > 20.0) & (smooth < 235.0)
        values = residual[mask]
        if values.size < 10_000:
            continue
        center = np.median(values)
        mads.append(float(np.median(np.abs(values - center)) * 1.4826))
        rmss.append(float(np.sqrt(np.mean(values * values))))
        coverages.append(float(mask.mean()))

    if not mads:
        raise RuntimeError(f"no usable frames for {path}")
    return {
        "frames": float(len(mads)),
        "highpass_mad": float(np.median(mads)),
        "highpass_rms": float(np.median(rmss)),
        "flat_mask_coverage": float(np.median(coverages)),
    }


def main() -> None:
    rows = []
    for name, path in VIDEOS.items():
        result = measure(path)
        result["name"] = name
        rows.append(result)

    source_mad = next(r["highpass_mad"] for r in rows if r["name"] == "source_upload")
    rtx_mad = next(r["highpass_mad"] for r in rows if r["name"] == "rtx_only")
    for row in rows:
        row["retention_vs_source_pct"] = row["highpass_mad"] / source_mad * 100.0
        row["retention_vs_rtx_pct"] = row["highpass_mad"] / rtx_mad * 100.0

    fields = [
        "name", "frames", "highpass_mad", "highpass_rms",
        "flat_mask_coverage", "retention_vs_source_pct", "retention_vs_rtx_pct",
    ]
    with (OUT / "TEXTURE_RETENTION.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    lines = [
        "# Spatial microtexture retention (Video 3)", "",
        "Two luma samples/second, normalized to 1280x720. A 5x5 high-pass is",
        "measured only on mid-tone pixels whose low-pass gradient is below 2.5.",
        "This suppresses strong edges so RTX sharpening is less likely to count",
        "as grain. With no clean master, the score measures upload microtexture",
        "(legitimate grain plus residual compression), not true grain fidelity.", "",
        "| Candidate | Robust texture MAD | vs upload | vs RTX-only |",
        "|---|---:|---:|---:|",
    ]
    for row in rows:
        lines.append(
            f"| {row['name']} | {row['highpass_mad']:.4f} | "
            f"{row['retention_vs_source_pct']:.1f}% | {row['retention_vs_rtx_pct']:.1f}% |"
        )
    (OUT / "TEXTURE_RETENTION.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
