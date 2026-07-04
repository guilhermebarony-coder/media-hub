#!/usr/bin/env bash
# Media Hub - release smoke test (macOS).
#
# macOS twin of smoke-test.ps1. Runs the real transcode pipeline with the
# fetched ffmpeg sidecar before the app is built, so a broken ffmpeg fails
# the release job instead of a tester. Network-free (synthetic input).
# Keep preset args in sync with resolve_preset() in src-tauri/src/lib.rs.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="aarch64-apple-darwin"
FF="$REPO_ROOT/src-tauri/binaries/ffmpeg-$TARGET"
YTDLP="$REPO_ROOT/src-tauri/binaries/yt-dlp-$TARGET"
WORK="$(mktemp -d -t mh-smoke)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "SMOKE FAIL: $1" >&2; exit 1; }

[ -x "$FF" ]    || fail "ffmpeg sidecar missing/not executable at $FF"
[ -x "$YTDLP" ] || fail "yt-dlp sidecar missing/not executable at $YTDLP"

echo "== sidecar versions =="
"$FF" -hide_banner -version | head -1
"$YTDLP" --version

# 1. Synthetic 3s H.264 + AAC clip.
SRC="$WORK/src.mp4"
"$FF" -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc=size=640x360:rate=30" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000" \
  -t 3 -c:v libx264 -pix_fmt yuv420p -c:a aac "$SRC"
[ -s "$SRC" ] || fail "could not generate synthetic source"

# 2. Trim step (the app's segment cut).
SEG="$WORK/seg.mp4"
"$FF" -y -hide_banner -loglevel error -ss 1 -i "$SRC" -t 1 -c copy -movflags +faststart "$SEG"
[ "$(stat -f%z "$SEG")" -gt 1000 ] || fail "trim produced no/empty segment"

# 3. Each CPU preset must produce a non-empty file.
run_preset() {
  local name="$1"; local out="$WORK/$2"; shift 2
  echo "== transcode preset: $name =="
  "$FF" -y -hide_banner -loglevel error -i "$SEG" -map 0:v:0 -map "0:a:0?" "$@" "$out" \
    || fail "preset $name failed"
  [ -s "$out" ] && [ "$(stat -f%z "$out")" -gt 1000 ] \
    || fail "preset $name produced no/empty output (the 'received no packets' class)"
  echo "   ok -> $(( $(stat -f%z "$out") / 1024 )) KB"
}

run_preset h264_mp4      out_h264.mp4   -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart
run_preset prores_422_lt out_prores.mov -c:v prores_ks -profile:v 1 -vendor apl0 -pix_fmt yuv422p10le -c:a pcm_s16le -ar 48000
run_preset dnxhr_sq      out_dnxhr.mov  -c:v dnxhd -profile:v dnxhr_sq -pix_fmt yuv422p -c:a pcm_s16le -ar 48000

echo "SMOKE PASS - pipeline healthy with the bundled ffmpeg."
