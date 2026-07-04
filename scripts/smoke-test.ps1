# Media Hub - release smoke test (Windows).
#
# Runs the REAL transcode pipeline with the ACTUAL fetched ffmpeg sidecar,
# BEFORE the installer is built. Exists because the "transcode: at least
# one of its streams received no packets" bug had nothing wrong in our
# code - it was the bundled ffmpeg (a master nightly) behaving differently.
# Unit tests can't see that; this does.
#
# What it checks, network-free (synthetic input, so no YouTube flakiness):
#   1. ffmpeg + yt-dlp run and report a version.
#   2. A clip trims (the app's -ss/-i/-t/-c copy segment step).
#   3. Every CPU transcode preset produces a NON-EMPTY output.
# (NVENC is skipped - CI runners have no NVIDIA GPU.)
#
# Any failure exits non-zero, which fails the release job → no bad build
# reaches a tester. Keep the preset args in sync with resolve_preset() in
# src-tauri/src/lib.rs.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$ff = Join-Path $repoRoot 'src-tauri\binaries\ffmpeg-x86_64-pc-windows-msvc.exe'
$ytdlp = Join-Path $repoRoot 'src-tauri\binaries\yt-dlp-x86_64-pc-windows-msvc.exe'
$work = Join-Path $env:TEMP 'mh-smoke'
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Force $work | Out-Null

function Fail($msg) { Write-Host "SMOKE FAIL: $msg" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $ff))     { Fail "ffmpeg sidecar missing at $ff" }
if (-not (Test-Path $ytdlp))  { Fail "yt-dlp sidecar missing at $ytdlp" }

Write-Host "== sidecar versions ==" -ForegroundColor Cyan
& $ff -hide_banner -version | Select-Object -First 1
& $ytdlp --version

# 1. Synthetic 3s H.264 + AAC clip (mirrors a downloaded source).
$src = Join-Path $work 'src.mp4'
& $ff -y -hide_banner -loglevel error `
  -f lavfi -i "testsrc=size=640x360:rate=30" `
  -f lavfi -i "sine=frequency=440:sample_rate=48000" `
  -t 3 -c:v libx264 -pix_fmt yuv420p -c:a aac $src
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $src)) { Fail "could not generate synthetic source" }

# 2. Trim step (exactly what yt_download does for a segment).
$seg = Join-Path $work 'seg.mp4'
& $ff -y -hide_banner -loglevel error -ss 1 -i $src -t 1 -c copy -movflags +faststart $seg
if ($LASTEXITCODE -ne 0 -or (Get-Item $seg).Length -lt 1000) { Fail "trim (-c copy) produced no/empty segment" }

# 3. Each CPU preset - must produce a non-empty file (this is the exact
#    thing that broke). Args mirror resolve_preset() in lib.rs.
$presets = @(
  @{ name = 'h264_mp4';      out = 'out_h264.mp4'; vargs = @('-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart') }
  @{ name = 'prores_422_lt'; out = 'out_prores.mov'; vargs = @('-c:v','prores_ks','-profile:v','1','-vendor','apl0','-pix_fmt','yuv422p10le','-c:a','pcm_s16le','-ar','48000') }
  @{ name = 'dnxhr_sq';      out = 'out_dnxhr.mov'; vargs = @('-c:v','dnxhd','-profile:v','dnxhr_sq','-pix_fmt','yuv422p','-c:a','pcm_s16le','-ar','48000') }
)

foreach ($p in $presets) {
  $out = Join-Path $work $p.out
  $args = @('-y','-hide_banner','-loglevel','error','-i',$seg,'-map','0:v:0','-map','0:a:0?') + $p.vargs + @($out)
  Write-Host "== transcode preset: $($p.name) ==" -ForegroundColor Cyan
  & $ff @args
  if ($LASTEXITCODE -ne 0) { Fail "preset $($p.name) exited $LASTEXITCODE" }
  if (-not (Test-Path $out) -or (Get-Item $out).Length -lt 1000) {
    Fail "preset $($p.name) produced no/empty output (the 'received no packets' class of bug)"
  }
  Write-Host "   ok -> $([math]::Round((Get-Item $out).Length/1KB,1)) KB"
}

Remove-Item -Recurse -Force $work
Write-Host "SMOKE PASS - pipeline healthy with the bundled ffmpeg." -ForegroundColor Green
