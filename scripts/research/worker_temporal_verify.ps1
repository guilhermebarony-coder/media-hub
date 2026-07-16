<#
  worker_temporal_verify.ps1 — temporal-integrity harness for the RTX worker.

  Proves the EXACT input->output frame mapping (count, content shift, warm-up
  dup, dropped tail) WITHOUT OCR or eyeballing, and — crucially — TONE-MAP ROBUST
  so it works on the THDR (SDR->HDR) paths where absolute luma is remapped.

  Marker (top BAND rows), read structurally, not by absolute luma:
    cell 0 = black reference (lum 16)
    cell 1 = white reference (lum 235)
    cells 2..15 = 14 binary bits of the frame index N (white=1, black=0, LSB first)
  Below the band: a moving sine so the VSR is not in a degenerate flat-frame mode.
  Readback: crop the band, area-scale to CELLS x 1 (one averaged pixel per cell),
  dump raw gray. Per frame, threshold each bit cell against (black+white)/2 of that
  same frame -> recovers N regardless of any monotonic tone curve.

  Modes (measure all four latency paths):
    bypass   : --no-vsr --no-thdr   (RTX evaluate bypassed; expect depth 0)
    vsr      : VSR only  --no-thdr
    thdr     : THDR only --no-vsr
    vsrthdr  : VSR + THDR

  Usage:
    worker_temporal_verify.ps1 -Worker <exe> [-Mode vsr] [-Frames 100]
        [-Ffmpeg <ffmpeg>] [-OutDir <dir>]
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$Worker,
    [ValidateSet('bypass','vsr','thdr','vsrthdr')] [string]$Mode = 'vsr',
    [int]$Frames = 100,
    [string]$Ffmpeg = "F:\CLAUDE\media-hub\src-tauri\binaries\ffmpeg-x86_64-pc-windows-msvc.exe",
    [string]$OutDir = "$env:TEMP\mh-worker-verify"
)

# Native ffmpeg/worker write progress to stderr; PS 5.1 wraps that as errors, so
# don't use Stop. Explicit throws below guard the real failures.
$ErrorActionPreference = "Continue"
if (-not (Test-Path $Worker)) { throw "Worker not found: $Worker" }
if (-not (Test-Path $Ffmpeg)) { throw "ffmpeg not found: $Ffmpeg" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$FPS   = "24000/1001"     # 23.976 — the case that first exposed the bug
$W     = 1280
$H     = 720
$BAND  = 48               # top rows carrying the marker
$CELLS = 16               # cell 0 black-ref, 1 white-ref, 2..15 = 14 index bits
$NBITS = 14
$CW    = $W / $CELLS      # 80 px per cell

$useVsr  = ($Mode -eq 'vsr' -or $Mode -eq 'vsrthdr')
$useThdr = ($Mode -eq 'thdr' -or $Mode -eq 'vsrthdr')
$scale   = if ($useVsr) { 2 } else { 1 }

$src = Join-Path $OutDir "counter_src.mp4"
$dst = Join-Path $OutDir "counter_$Mode.mp4"
$raw = Join-Path $OutDir "cells_$Mode.raw"
$dur = [math]::Round(($Frames + 3) / (24000.0 / 1001.0), 3)

function Count-Frames([string]$path) {
    $tmp = [IO.Path]::GetTempFileName()
    & $Ffmpeg -hide_banner -i $path -map 0:v:0 -an -f null - 2> $tmp
    $err = Get-Content $tmp -Raw; Remove-Item $tmp -Force
    $m = [regex]::Matches($err, 'frame=\s*(\d+)')
    if ($m.Count -eq 0) { return -1 }
    [int]$m[$m.Count - 1].Groups[1].Value
}

Write-Host "== 1. Generate $Frames-frame binary-marker clip (mode=$Mode) ==" -ForegroundColor Cyan
# Marker luma in the band; moving sine below. bit b of cell c(>=2) is b=c-2,
# value = mod(floor(N/2^b),2). Single-quoted lum keeps commas literal for ffmpeg.
$expr = "if(lt(Y,$BAND),if(lt(X,$CW),16,if(lt(X,$([int]($CW*2))),235,if(gt(mod(floor(N/pow(2,floor(X/$CW)-2)),2),0.5),235,16))),128+80*sin((X+N*12)/18))"
$vf   = "geq=lum='$expr':cb=128:cr=128,trim=end_frame=$Frames,setpts=N/($FPS)/TB"
# -threads 1: x264 slice/lookahead threading is non-deterministic run-to-run, which
# jitters the marker cells near the readback threshold. Single-thread => bit-exact source.
& $Ffmpeg -y -hide_banner -loglevel error -f lavfi -i "color=c=black:s=${W}x${H}:r=$FPS" `
    -t $dur -vf $vf -c:v libx264 -preset veryfast -crf 10 -threads 1 -pix_fmt yuv420p $src
$srcCount = Count-Frames $src
Write-Host "   source frames requested=$Frames, actual=$srcCount"

Write-Host "== 2. Run worker (mode=$Mode, scale=$scale) ==" -ForegroundColor Cyan
$wargs = @($src, $dst, "-v")
if ($useVsr) { $wargs += @("--vsr-quality","4","--vsr-scale","2") } else { $wargs += @("--no-vsr","--vsr-scale","1") }
if (-not $useThdr) { $wargs += "--no-thdr" }
& $Worker @wargs
if (-not (Test-Path $dst)) { throw "Worker produced no output (mode=$Mode)" }

Write-Host "== 3. Read binary marker back (oversampled center-median, tone-map robust) ==" -ForegroundColor Cyan
# Oversample each cell into $SUB subsamples, then decode from the CENTER subsamples
# only. Inter-cell ringing (from the 16<->235 transitions, amplified by VSR 2x +
# NVENC) lives at the cell edges; sampling the center plateau is immune to it.
$SUB = 8
$WIDTH = $CELLS * $SUB
& $Ffmpeg -y -hide_banner -loglevel error -i $dst `
    -vf "crop=iw:$($BAND*$scale):0:0,scale=${WIDTH}:1:flags=area,format=gray" -f rawvideo $raw
if (-not (Test-Path $raw)) { throw "cell readback produced no data" }
$bytes = [IO.File]::ReadAllBytes($raw)
$outFrames = [int]($bytes.Length / $WIDTH)

# Mean of the center subsamples of a cell (drops the 2 edge subsamples each side).
function Cell-Center([byte[]]$b, [int]$frameBase, [int]$cell) {
    $cb = $frameBase + $cell * $SUB
    $lo = 2; $hi = $SUB - 3           # SUB=8 -> subsamples 2..5
    $s = 0.0; for ($k = $lo; $k -le $hi; $k++) { $s += $b[$cb + $k] }
    return $s / ($hi - $lo + 1)
}

$indices = New-Object System.Collections.Generic.List[int]
for ($f = 0; $f -lt $outFrames; $f++) {
    $base = $f * $WIDTH
    $blk = Cell-Center $bytes $base 0
    $wht = Cell-Center $bytes $base 1
    $thr = ($blk + $wht) / 2.0
    $n = 0
    for ($b = 0; $b -lt $NBITS; $b++) {
        if ((Cell-Center $bytes $base ($b + 2)) -gt $thr) { $n = $n -bor (1 -shl $b) }
    }
    $indices.Add($n)
}
$outCount = Count-Frames $dst

# --- diagnosis ---
$shifts = for ($i = 0; $i -lt $indices.Count; $i++) { $indices[$i] - $i }
$medianShift = if ($shifts.Count) { ($shifts | Sort-Object)[[int]($shifts.Count/2)] } else { 0 }
$hasLast = $indices -contains ($srcCount - 1)
# depth estimate: leading outputs before content index first reaches 0-run end.
$dup = 0; while ($dup + 1 -lt $indices.Count -and $indices[$dup + 1] -eq $indices[0]) { $dup++ }

# STRICT permutation check: the output content sequence must be EXACTLY 0..srcCount-1
# in order. This catches internal swaps / drops / dups that the median-shift + count +
# last-present heuristic silently passes. Report every deviating position.
$perfect = ($outCount -eq $srcCount) -and ($indices.Count -eq $srcCount)
$mismatches = @()
for ($i = 0; $i -lt $indices.Count; $i++) {
    if ($indices[$i] -ne $i) { $mismatches += ("pos{0}=>{1}" -f $i, $indices[$i]); $perfect = $false }
}
$seen = @{}; $dupContent = @()
foreach ($v in $indices) { if ($seen.ContainsKey($v)) { $dupContent += $v } else { $seen[$v] = $true } }
$missingContent = @(); for ($v = 0; $v -lt $srcCount; $v++) { if (-not $seen.ContainsKey($v)) { $missingContent += $v } }

Write-Host ""
Write-Host "============= RESULT (mode=$Mode) =============" -ForegroundColor Yellow
Write-Host "input frames          : $srcCount"
Write-Host "output frames (probe) : $outCount"
Write-Host "output frames (cells) : $outFrames"
$hn = [math]::Min(7, $indices.Count - 1)
$headPairs = @()
for ($i = 0; $i -le $hn; $i++) { $headPairs += ("{0}:{1}" -f $i, $indices[$i]) }
Write-Host ("head map (pos:content): " + ($headPairs -join "  "))
if ($indices.Count -gt 8) {
    $t0 = [math]::Max(0, $indices.Count - 6)
    $tail = @()
    for ($i = $t0; $i -lt $indices.Count; $i++) { $tail += $indices[$i] }
    Write-Host ("tail content          : " + ($tail -join ", "))
}
Write-Host ("dominant shift        : {0}    leading-dup(head): {1}" -f $medianShift, $dup)
if ($outCount -ne $srcCount) {
    Write-Host ("  * COUNT MISMATCH: {0} in / {1} out (delta {2})" -f $srcCount,$outCount,($outCount-$srcCount)) -ForegroundColor Red
} else { Write-Host "  * frame count matches" -ForegroundColor Green }
if (-not $hasLast) {
    Write-Host ("  * last content index {0} MISSING -> stuck/dropped tail" -f ($srcCount-1)) -ForegroundColor Red
}
if ($mismatches.Count) {
    $show = if ($mismatches.Count -gt 12) { ($mismatches[0..11] -join "  ") + "  ..(+$($mismatches.Count-12))" } else { $mismatches -join "  " }
    Write-Host ("  * NON-IDENTITY positions: {0}" -f $show) -ForegroundColor Red
}
if ($dupContent.Count)     { Write-Host ("  * DUPLICATED content: {0}" -f (($dupContent | Select-Object -Unique) -join ", ")) -ForegroundColor Red }
if ($missingContent.Count) { Write-Host ("  * MISSING content: {0}" -f ($missingContent -join ", ")) -ForegroundColor Red }
if ($perfect) {
    Write-Host "  * STRICT IDENTITY: output content == 0..$($srcCount-1) exactly (no swap/drop/dup)" -ForegroundColor Green
} else {
    Write-Host "  * STRICT CHECK FAILED (see above)" -ForegroundColor Red
}
Write-Host "===============================================" -ForegroundColor Yellow
