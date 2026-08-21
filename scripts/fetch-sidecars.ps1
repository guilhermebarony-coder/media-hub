# Media Hub — sidecar fetch script (Windows)
# Downloads yt-dlp.exe + ffmpeg.exe into src-tauri/binaries/ with
# the target-triple suffix Tauri requires.
#
# Run from repo root:
#   pwsh scripts/fetch-sidecars.ps1
#
# Sidecars are gitignored — every dev machine runs this once.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # speeds up Invoke-WebRequest dramatically

$repoRoot = Split-Path -Parent $PSScriptRoot
$binDir   = Join-Path $repoRoot 'src-tauri\binaries'
$target   = 'x86_64-pc-windows-msvc'   # Tauri's required suffix

New-Item -ItemType Directory -Force -Path $binDir | Out-Null

# ---------- yt-dlp ----------
$ytdlpOut = Join-Path $binDir "yt-dlp-$target.exe"
Write-Host "[1/2] Fetching yt-dlp..." -ForegroundColor Cyan
Invoke-WebRequest `
  -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' `
  -OutFile $ytdlpOut
Write-Host "      -> $ytdlpOut" -ForegroundColor Green

# ---------- ffmpeg ----------
# BtbN GPL build — includes prores, dnxhd, libx264, etc.
#
# IMPORTANT: pin to the STABLE RELEASE BRANCH (n7.1), NOT master-latest.
# `ffmpeg-master-latest` is a bleeding-edge nightly re-fetched on every
# build, so each release randomly inherited whatever regressions were in
# that day's master (this is what caused the "transcode: at least one of
# its streams received no packets" bug that hit some machines and not
# others, then "fixed itself" a few versions later). The n7.1 release
# branch only takes bugfix backports — stable + reproducible.
# To fully freeze a build, swap `latest` for a dated `autobuild-YYYY-MM-DD-*`
# tag (see https://github.com/BtbN/FFmpeg-Builds/releases).
$ffZip = Join-Path $env:TEMP 'ffmpeg-mh.zip'
$ffExtract = Join-Path $env:TEMP 'ffmpeg-mh'
$ffOut = Join-Path $binDir "ffmpeg-$target.exe"

Write-Host "[2/2] Fetching ffmpeg (BtbN GPL, stable n7.1, ~80 MB)..." -ForegroundColor Cyan
Invoke-WebRequest `
  -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-win64-gpl-7.1.zip' `
  -OutFile $ffZip
Write-Host "      Extracting..." -ForegroundColor Cyan
if (Test-Path $ffExtract) { Remove-Item -Recurse -Force $ffExtract }
Expand-Archive -Path $ffZip -DestinationPath $ffExtract
$ffSrc = (Get-ChildItem -Path $ffExtract -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1).FullName
if (-not $ffSrc) { throw "ffmpeg.exe not found in extracted archive" }
Copy-Item -Path $ffSrc -Destination $ffOut -Force
Remove-Item -Force $ffZip
Remove-Item -Recurse -Force $ffExtract
Write-Host "      -> $ffOut" -ForegroundColor Green

# ---------- deno ----------
# JavaScript runtime for yt-dlp's YouTube sig/nsig challenge solving
# (required since yt-dlp 2025.11 — without it, restricted/age-gated and
# increasingly normal YouTube videos return no real formats). Deno ships
# release assets already named by target-triple.
$denoZip = Join-Path $env:TEMP 'deno-mh.zip'
$denoExtract = Join-Path $env:TEMP 'deno-mh'
$denoOut = Join-Path $binDir "deno-$target.exe"

Write-Host "[3/3] Fetching deno (JS runtime, ~40 MB)..." -ForegroundColor Cyan
Invoke-WebRequest `
  -Uri "https://github.com/denoland/deno/releases/latest/download/deno-$target.zip" `
  -OutFile $denoZip
if (Test-Path $denoExtract) { Remove-Item -Recurse -Force $denoExtract }
Expand-Archive -Path $denoZip -DestinationPath $denoExtract
Copy-Item -Path (Join-Path $denoExtract 'deno.exe') -Destination $denoOut -Force
Remove-Item -Force $denoZip
Remove-Item -Recurse -Force $denoExtract
Write-Host "      -> $denoOut" -ForegroundColor Green

# ---------------------------------------------------------------------------
# NVIDIA RTX Video runtime (bundled into the installer, NOT downloadable).
#
# Not fetched: it is behind an NVIDIA developer login and must never live in
# this repo. Without it `npm run tauri build` fails at the bundle step, which
# is deliberate -- see src-tauri/resources/README.md.
# ---------------------------------------------------------------------------
$vsrOut = Join-Path $PSScriptRoot '..\src-tauriesources
vngx_vsr.dll'
if (Test-Path $vsrOut) {
  Write-Host "      -> nvngx_vsr.dll already in place" -ForegroundColor Green
} else {
  $sdkGuess = 'E:\TESTE RTX VIDEO\sdkin\Windowsdel
vngx_vsr.dll'
  if (Test-Path $sdkGuess) {
    New-Item -ItemType Directory -Force (Split-Path $vsrOut) | Out-Null
    Copy-Item $sdkGuess $vsrOut -Force
    Write-Host "      -> copied nvngx_vsr.dll from the local RTX Video SDK" -ForegroundColor Green
  } else {
    Write-Host "[!] nvngx_vsr.dll is MISSING." -ForegroundColor Red
    Write-Host "    Get the RTX Video SDK (developer.nvidia.com/rtx-video-sdk) and copy" -ForegroundColor Red
    Write-Host "    bin\Windowsdel
vngx_vsr.dll into src-tauriesources\." -ForegroundColor Red
    Write-Host "    The RTX enhancer cannot be built without it." -ForegroundColor Red
  }
}

Write-Host ""
Write-Host "Sidecars ready. Verify with:" -ForegroundColor Yellow
Write-Host "  & '$ytdlpOut' --version"
Write-Host "  & '$ffOut' -version | Select-Object -First 1"
