from __future__ import annotations

import csv
from pathlib import Path

from measure_video3_texture import measure


ROOT = Path(r"E:\TESTE CLAUDE CODEX\Test Video 3")
OLD = ROOT / "_analysis" / "restored" / "codex" / "nlmeans_vulkan_test"
OUT = ROOT / "_analysis" / "restored" / "codex" / "nlmeans_vulkan_no_blur_masked"

VIDEOS = {
    "source_upload": ROOT / "Sora_RyoTa_-_Babilonia [mEzxpHslNgE].mp4",
    "rtx_only": OLD / "_intermediate" / "rtx_only_1440_raw.mp4",
    "global_s2.5_preclean": OUT / "_intermediate" / "nlmeansVK-s2.5-global_preclean720.mp4",
    "global_s2.5_then_rtx": OUT / "01_NLMeansVK-s2.5-global-noBlur-RTX_1440_FINAL.mp4",
    "global_s3.0_preclean": OUT / "_intermediate" / "nlmeansVK-s3.0-global_preclean720.mp4",
    "global_s3.0_then_rtx": OUT / "02_NLMeansVK-s3.0-global-noBlur-RTX_1440_FINAL.mp4",
    "masked_s3.0_preclean": OUT / "_intermediate" / "nlmeansVK-s3.0-structuralEdges_preclean720.mp4",
    "masked_s3.0_then_rtx": OUT / "03_NLMeansVK-s3.0-structuralEdges-noBlur-RTX_1440_FINAL.mp4",
}


def main() -> None:
    rows = []
    for name, path in VIDEOS.items():
        result = measure(path)
        result["name"] = name
        rows.append(result)

    source = next(r["highpass_mad"] for r in rows if r["name"] == "source_upload")
    rtx = next(r["highpass_mad"] for r in rows if r["name"] == "rtx_only")
    for row in rows:
        row["retention_vs_source_pct"] = row["highpass_mad"] / source * 100.0
        row["retention_vs_rtx_pct"] = row["highpass_mad"] / rtx * 100.0

    fields = [
        "name", "frames", "highpass_mad", "highpass_rms", "flat_mask_coverage",
        "retention_vs_source_pct", "retention_vs_rtx_pct",
    ]
    with (OUT / "TEXTURE_RETENTION.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    lines = [
        "# Video 3: no-blur and structural-edge NLMeans", "",
        "Spatial luma microtexture in low-gradient mid-tones; two samples/second,",
        "normalized to 1280x720. No clean master is available, so upload texture",
        "contains both legitimate grain and compression residue.", "",
        "| Candidate | Robust texture MAD | vs upload | vs RTX-only |",
        "|---|---:|---:|---:|",
    ]
    for row in rows:
        lines.append(
            f"| {row['name']} | {row['highpass_mad']:.4f} | "
            f"{row['retention_vs_source_pct']:.1f}% | {row['retention_vs_rtx_pct']:.1f}% |"
        )
    report = "\n".join(lines) + "\n"
    (OUT / "TEXTURE_RETENTION.md").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
