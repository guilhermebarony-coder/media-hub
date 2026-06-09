#!/usr/bin/env bash
# Media Hub — sidecar fetch script (macOS, Apple Silicon / aarch64).
#
# Downloads yt-dlp + a static ffmpeg into src-tauri/binaries/ with the
# target-triple suffix Tauri's externalBin requires:
#   yt-dlp-aarch64-apple-darwin
#   ffmpeg-aarch64-apple-darwin
#
# Run from repo root (or anywhere — paths are resolved):
#   bash scripts/fetch-sidecars-mac.sh
#
# Sidecars are gitignored — CI and every Mac dev runs this once.
# Mirror of scripts/fetch-sidecars.ps1 (Windows).

set -euo pipefail

TARGET="aarch64-apple-darwin"   # Tauri's required suffix (Apple Silicon)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$REPO_ROOT/src-tauri/binaries"

mkdir -p "$BIN_DIR"

# ---------- yt-dlp ----------
# yt-dlp ships a universal2 macOS binary (runs natively on arm64).
YTDLP_OUT="$BIN_DIR/yt-dlp-$TARGET"
echo "[1/2] Fetching yt-dlp (macos universal2)..."
curl -L --fail --retry 3 \
  -o "$YTDLP_OUT" \
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
chmod +x "$YTDLP_OUT"
echo "      -> $YTDLP_OUT"

# ---------- ffmpeg ----------
# Static arm64 macOS build from Martin Riedl's CI (stable redirect URL).
# Static = no Homebrew dylib dependencies, so it bundles cleanly.
FF_ZIP="$(mktemp -t ffmpeg-mh-XXXX).zip"
FF_EXTRACT="$(mktemp -d -t ffmpeg-mh-XXXX)"
FF_OUT="$BIN_DIR/ffmpeg-$TARGET"
echo "[2/2] Fetching ffmpeg (static arm64)..."
curl -L --fail --retry 3 \
  -o "$FF_ZIP" \
  "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip"
echo "      Extracting..."
unzip -o -q "$FF_ZIP" -d "$FF_EXTRACT"
FF_SRC="$(find "$FF_EXTRACT" -name ffmpeg -type f | head -n 1)"
if [ -z "$FF_SRC" ]; then
  echo "ffmpeg binary not found in extracted archive" >&2
  exit 1
fi
cp "$FF_SRC" "$FF_OUT"
chmod +x "$FF_OUT"
rm -rf "$FF_ZIP" "$FF_EXTRACT"
echo "      -> $FF_OUT"

echo ""
echo "Sidecars ready. Verify with:"
echo "  \"$YTDLP_OUT\" --version"
echo "  \"$FF_OUT\" -version | head -1"
