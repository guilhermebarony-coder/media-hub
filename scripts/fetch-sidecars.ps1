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
# NVIDIA RTX Video runtime -- packed INTO the installer, never downloaded by
# the app.
#
# It cannot live in the public repo (proprietary), and it cannot sit behind a
# public URL either: NVIDIA's grant covers redistribution incorporated into an
# application, not standalone hosting of the binary. So the build machine gets
# it from one of two access-controlled places:
#
#   CI     -> the private media-hub-deps repo, using MH_DEPS_TOKEN
#   local  -> your own RTX Video SDK install
#
# Without it the build fails at COMPILE time with "resource path
# resources\nvngx_vsr.dll doesn't exist". That is deliberate: an installer
# silently missing the runtime would ship an "Install enhancer" button that
# downloads a worker which then dies at RTX init.
# ---------------------------------------------------------------------------
$vsrDir = Join-Path $PSScriptRoot '..\src-tauri\resources'
$vsrOut = Join-Path $vsrDir 'nvngx_vsr.dll'
$vsrSha = 'c3d88eea5ff7a548edefa66414cf6e77464d0947277c904f324dd23abf58a1ed'

function Test-VsrHash {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $false }
  return (Get-FileHash -Algorithm SHA256 $Path).Hash -ieq $vsrSha
}

Write-Host ""
Write-Host "[RTX] nvngx_vsr.dll (NVIDIA runtime, 19 MB)..." -ForegroundColor Cyan

if (Test-VsrHash $vsrOut) {
  Write-Host "      -> already in place" -ForegroundColor Green
}
elseif ($env:MH_DEPS_TOKEN) {
  # CI path. gh is preinstalled on GitHub runners.
  New-Item -ItemType Directory -Force $vsrDir | Out-Null
  $env:GH_TOKEN = $env:MH_DEPS_TOKEN
  gh release download nvngx-vsr-sdk-1.0 `
    --repo guilhermebarony-coder/media-hub-deps `
    --pattern nvngx_vsr.dll `
    --dir $vsrDir --clobber
  if (-not (Test-VsrHash $vsrOut)) {
    # A wrong or truncated DLL would be packed into an installer we then sign.
    # Refuse rather than ship it.
    Write-Host "[!] nvngx_vsr.dll failed its sha256 check after download." -ForegroundColor Red
    exit 1
  }
  Write-Host "      -> fetched from media-hub-deps (sha256 ok)" -ForegroundColor Green
}
else {
  $sdkGuess = 'E:\TESTE RTX VIDEO\sdk\bin\Windows\x64\rel\nvngx_vsr.dll'
  if (Test-Path $sdkGuess) {
    New-Item -ItemType Directory -Force $vsrDir | Out-Null
    Copy-Item $sdkGuess $vsrOut -Force
    Write-Host "      -> copied from the local RTX Video SDK" -ForegroundColor Green
  }
  else {
    Write-Host "[!] nvngx_vsr.dll is MISSING and no MH_DEPS_TOKEN is set." -ForegroundColor Red
    Write-Host "    Local build: install the RTX Video SDK and copy" -ForegroundColor Red
    Write-Host "    bin\Windows\x64\rel\nvngx_vsr.dll into src-tauri\resources\." -ForegroundColor Red
    Write-Host "    See src-tauri\resources\README.md." -ForegroundColor Red
    exit 1
  }
}

Write-Host ""
Write-Host "Sidecars ready. Verify with:" -ForegroundColor Yellow
Write-Host "  & '$ytdlpOut' --version"
Write-Host "  & '$ffOut' -version | Select-Object -First 1"
