param(
    [string]$Root = "E:\TESTE CLAUDE CODEX\Test video 2"
)

$ErrorActionPreference = "Stop"
$fps = "24000/1001"
$frames = 6172
$ff = "$env:APPDATA\com.guilherme.mediahub\bin\ffmpeg.exe"
$wk = "$env:APPDATA\com.guilherme.mediahub\bin\RTXVideoProcessor.exe"
$mxDir = "F:\CLAUDE\maxine-vfx-sdk\samples\VideoEffectsApp"
$mxRunner = "F:\CLAUDE\rtx-restoration-research\scripts\run_maxine_effect.cmd"
$src = Join-Path $Root "YT compressed\AMV_-_Resonance_-_Bestamvsofalltime_Anime_MV [N_aK1QYZkNk].mp4"
$claude = Join-Path $Root "_analysis\restored\claude\full_restored720.mp4"
$out = Join-Path $Root "_analysis\restored\codex\maxine_full_compare"
New-Item -ItemType Directory -Force $out | Out-Null

$champion = Join-Path $out "01_free_rtx-libplacebo_compare-ready.mp4"
$srRaw = Join-Path $out "maxine_sr_1440_23fps_raw.mp4"
$sr1440 = Join-Path $out "maxine_sr_1440_23976_crf1.mp4"
$sr720 = Join-Path $out "02_maxine-superres_compare-ready.mp4"
$srRtxRaw = Join-Path $out "maxine_sr-rtx_2880_raw.mp4"
$srRtx720 = Join-Path $out "03_maxine-superres-rtx_compare-ready.mp4"

function Assert-Output([string]$Path, [string]$Stage) {
    if (!(Test-Path -LiteralPath $Path) -or (Get-Item -LiteralPath $Path).Length -eq 0) {
        throw "$Stage failed or produced an empty file: $Path"
    }
}

# Existing free champion contains the RTX worker's one-frame delay and one
# fewer frame than the source. Drop the delayed first frame and pad two tail
# frames so all three compare-ready files have the source's 6172 frames.
& $ff -y -hide_banner -i $claude -i $src `
    -filter_complex "[0:v]trim=start_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=2,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709[v]" `
    -map "[v]" -map 1:a? -frames:v $frames -r $fps `
    -c:v libx264 -crf 10 -preset slow -pix_fmt yuv420p `
    -c:a aac -b:a 320k -movflags +faststart $champion
Assert-Output $champion "Champion remux"

# Maxine SR aggressive performs neural cleanup and a 2x upscale. The sample
# app incorrectly stamps the stream as integer 23 fps and drops audio.
Push-Location $mxDir
& $mxRunner $src $srRaw SuperRes 1440 1
$mxExit = $LASTEXITCODE
Pop-Location
if ($mxExit -ne 0) { throw "Maxine SR failed with exit code $mxExit" }
Assert-Output $srRaw "Maxine SR"

# Repair timestamps by frame ordinal. Keep a high-quality 1440p intermediate
# for the intentionally excessive Maxine SR -> RTX experiment.
& $ff -y -hide_banner -i $srRaw -an `
    -vf "setpts=N/($fps)/TB,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709" `
    -frames:v $frames -r $fps -c:v libx264 -crf 1 -preset medium `
    -pix_fmt yuv420p $sr1440
Assert-Output $sr1440 "Maxine SR timestamp repair"

& $ff -y -hide_banner -i $sr1440 -i $src `
    -filter_complex "[0:v]scale=1280:720:flags=lanczos,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709[v]" `
    -map "[v]" -map 1:a? -frames:v $frames -r $fps `
    -c:v libx264 -crf 10 -preset slow -pix_fmt yuv420p `
    -c:a aac -b:a 320k -movflags +faststart $sr720
Assert-Output $sr720 "Maxine SR compare output"

# Mad-scientist arm: Maxine SR 2x -> RTX VSR 2x -> Lanczos back to 720p.
& $wk $sr1440 $srRtxRaw -v --vsr-quality 4 --vsr-scale 2 --no-thdr
if ($LASTEXITCODE -ne 0) { throw "RTX after Maxine SR failed: $LASTEXITCODE" }
Assert-Output $srRtxRaw "RTX after Maxine SR"

& $ff -y -hide_banner -i $srRtxRaw -i $src `
    -filter_complex "[0:v]trim=start_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=2,scale=1280:720:flags=lanczos,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709[v]" `
    -map "[v]" -map 1:a? -frames:v $frames -r $fps `
    -c:v libx264 -crf 10 -preset slow -pix_fmt yuv420p `
    -c:a aac -b:a 320k -movflags +faststart $srRtx720
Assert-Output $srRtx720 "Maxine SR -> RTX compare output"

# Machine-readable stream audit for the handoff.
$audit = Join-Path $out "STREAM_AUDIT.txt"
foreach ($file in @($champion, $sr720, $srRtx720)) {
    "### $file" | Add-Content -LiteralPath $audit
    & $ff -hide_banner -i $file -map 0:v:0 -f null NUL 2>&1 |
        Select-String "Duration:|Stream #|frame=" | Select-Object -Last 4 |
        Add-Content -LiteralPath $audit
}

Write-Output "Compare-ready full clips: $out"
