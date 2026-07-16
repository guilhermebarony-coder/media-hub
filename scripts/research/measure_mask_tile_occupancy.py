from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np


FFMPEG = Path(r"F:\CLAUDE\media-hub\src-tauri\target\release\ffmpeg.exe")
VIDEO = Path(r"E:\TESTE CLAUDE CODEX\Test video 4 and 5\Most_Beautiful_Lie_AMV [nRQCXNj680U].mp4")
WIDTH, HEIGHT = 640, 360


def tile_coverage(mask: np.ndarray, tile: int, threshold: int) -> float:
    h, w = mask.shape
    pad_h = (-h) % tile
    pad_w = (-w) % tile
    padded = np.pad(mask > threshold, ((0, pad_h), (0, pad_w)))
    tiles = padded.reshape(
        padded.shape[0] // tile, tile, padded.shape[1] // tile, tile
    ).any(axis=(1, 3))
    return float(tiles.mean())


def main() -> None:
    vf = (
        "fps=2,scale=640:360:flags=bilinear,format=gray,"
        "gblur=sigma=0.8,edgedetect=low=0.07:high=0.20,"
        "dilation,dilation,gblur=sigma=1.5,format=gray"
    )
    cmd = [
        str(FFMPEG), "-hide_banner", "-loglevel", "error", "-i", str(VIDEO),
        "-vf", vf, "-an", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    assert proc.stdout is not None
    frame_bytes = WIDTH * HEIGHT
    rows: list[dict[str, float]] = []
    while True:
        data = proc.stdout.read(frame_bytes)
        if not data:
            break
        if len(data) != frame_bytes:
            raise RuntimeError(f"partial frame: {len(data)} bytes")
        mask = np.frombuffer(data, dtype=np.uint8).reshape(HEIGHT, WIDTH)
        row: dict[str, float] = {}
        for threshold in (1, 16, 32):
            active = mask > threshold
            row[f"pixels_t{threshold}"] = float(active.mean())
            ys, xs = np.nonzero(active)
            if len(xs):
                bbox_area = (xs.max() - xs.min() + 1) * (ys.max() - ys.min() + 1)
                row[f"bbox_t{threshold}"] = float(bbox_area / (WIDTH * HEIGHT))
            else:
                row[f"bbox_t{threshold}"] = 0.0
            # Mask is half-resolution: 8/16/32 here correspond to 16/32/64 source px.
            for tile in (4, 8, 16, 32):
                row[f"tiles{tile * 2}_t{threshold}"] = tile_coverage(mask, tile, threshold)
        rows.append(row)
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg exited {proc.returncode}")

    print(f"frames_sampled={len(rows)}")
    for key in rows[0]:
        values = np.asarray([row[key] for row in rows]) * 100.0
        print(
            f"{key}: mean={values.mean():.2f}% "
            f"median={np.median(values):.2f}% p95={np.percentile(values, 95):.2f}%"
        )


if __name__ == "__main__":
    main()
