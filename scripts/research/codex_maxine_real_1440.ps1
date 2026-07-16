param(
    [string]$Root = "E:\TESTE CLAUDE CODEX\Test video 2"
)

$ErrorActionPreference = "Stop"
$fps = "24000/1001"
$ff = "$env:APPDATA\com.guilherme.mediahub\bin\ffmpeg.exe"
$wk = "$env:APPDATA\com.guilherme.mediahub\bin\RTXVideoProcessor.exe"
$mxSr = "F:\CLAUDE\media-hub\scripts\research\run_maxine_sr_strength.cmd"
$mxAny = "F:\CLAUDE\rtx-restoration-research\scripts\run_maxine_effect.cmd"
$mxDir = "F:\CLAUDE\maxine-vfx-sdk\samples\VideoEffectsApp"
$src = Join-Path $Root "YT compressed\AMV_-_Resonance_-_Bestamvsofalltime_Anime_MV [N_aK1QYZkNk].mp4"
$normalRtx = Join-Path $Root "_analysis\restored\claude\full_rtx1440.mp4"
$out = Join-Path $Root "_analysis\restored\codex\maxine_real_compare_1440"
$tmp = Join-Path $out "_intermediate"
New-Item -ItemType Directory -Force $out, $tmp | Out-Null

$srRaw = Join-Path $tmp "sr_mode0_strength1_raw23.mp4"
$arRaw = Join-Path $tmp "ar_weak_mode0_raw23.mp4"
$arSrRaw = Join-Path $tmp "arweak_sr_mode0_strength1_raw23.mp4"
$arRtxRaw = Join-Path $tmp "arweak_rtx_1440_raw23.mp4"
$timings = [ordered]@{}

function Assert-Output([string]$Path, [string]$Stage) {
    if (!(Test-Path -LiteralPath $Path) -or (Get-Item -LiteralPath $Path).Length -eq 0) {
        throw "$Stage failed or produced an empty file: $Path"
    }
}

function Run-Timed([string]$Name, [scriptblock]$Action) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    & $Action
    $sw.Stop()
    $script:timings[$Name] = $sw.Elapsed
}

function Make-Maxine-Final([string]$InputPath, [string]$OutputPath, [string]$Name) {
    # The rebuilt sample passes CAP_PROP_FPS as double, but OpenCV still reports
    # this 24000/1001 MP4 as integer 23. Relabel by frame ordinal before decode;
    # this does not interpolate, drop, or duplicate frames.
    $sw = [Diagnostics.Stopwatch]::StartNew()
        & $ff -y -hide_banner -loglevel warning -r $fps -i $InputPath -i $src `
            -map 0:v:0 -map 1:a? -r $fps `
            -c:v libx264 -crf 10 -preset medium -pix_fmt yuv420p `
            -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 `
            -c:a aac -b:a 320k -movflags +faststart $OutputPath
        if ($LASTEXITCODE -ne 0) { throw "$Name final encode failed: $LASTEXITCODE" }
    $sw.Stop()
    $script:timings["$Name final audio encode"] = $sw.Elapsed
    Assert-Output $OutputPath $Name
}

# 1. Correct Maxine SR: conservative model, maximum nonzero strength.
if (!(Test-Path -LiteralPath $srRaw) -or (Get-Item -LiteralPath $srRaw).Length -eq 0) {
    Push-Location $mxDir
    Run-Timed "Maxine SR mode0 strength1" {
        & $mxSr $src $srRaw 1440 0 1
        if ($LASTEXITCODE -ne 0) { throw "Maxine SR failed: $LASTEXITCODE" }
    }
    Pop-Location
} else {
    $timings["Maxine SR mode0 strength1"] = "reused completed raw"
}
Assert-Output $srRaw "Maxine SR raw"
Make-Maxine-Final $srRaw (Join-Path $out "01_maxine-SR-mode0-strength1_1440_FINAL.mp4") "Maxine SR"

# Shared weak AR (mode 0). It has no strength parameter and is reused by both
# AR -> SR and AR -> RTX.
if (!(Test-Path -LiteralPath $arRaw) -or (Get-Item -LiteralPath $arRaw).Length -eq 0) {
    Push-Location $mxDir
    Run-Timed "Maxine AR weak mode0" {
        & $mxAny $src $arRaw ArtifactReduction 720 0
        if ($LASTEXITCODE -ne 0) { throw "Maxine AR weak failed: $LASTEXITCODE" }
    }
    Pop-Location
} else {
    $timings["Maxine AR weak mode0"] = "reused completed raw"
}
Assert-Output $arRaw "Maxine AR weak raw"

# 2. Weak AR -> correctly configured SR. Both Maxine passes keep frame order;
# only the final output receives corrected 24000/1001 timestamps.
Push-Location $mxDir
Run-Timed "AR weak to Maxine SR" {
    & $mxSr $arRaw $arSrRaw 1440 0 1
    if ($LASTEXITCODE -ne 0) { throw "AR weak -> Maxine SR failed: $LASTEXITCODE" }
}
Pop-Location
Assert-Output $arSrRaw "AR weak -> SR raw"
Make-Maxine-Final $arSrRaw (Join-Path $out "02_ARweak-MaxineSR_1440_FINAL.mp4") "AR weak -> Maxine SR"

# 3. Weak AR -> RTX VSR 2x. The RTX worker accepts the 23-fps-tagged Maxine
# intermediate; timestamps are repaired once, in the final encode.
Run-Timed "AR weak to RTX" {
    & $wk $arRaw $arRtxRaw -v --vsr-quality 4 --vsr-scale 2 --no-thdr
    if ($LASTEXITCODE -ne 0) { throw "AR weak -> RTX failed: $LASTEXITCODE" }
}
Assert-Output $arRtxRaw "AR weak -> RTX raw"
Make-Maxine-Final $arRtxRaw (Join-Path $out "03_ARweak-RTX_1440_FINAL.mp4") "AR weak -> RTX"

# Normal RTX -> libplacebo is intentionally not rebuilt: Gui already has it.
$timings["Normal RTX to libplacebo 1440"] = "skipped; existing comparison available"

$timingFile = Join-Path $out "TIMINGS.txt"
$timings.GetEnumerator() | ForEach-Object { "{0}: {1}" -f $_.Key, $_.Value } |
    Set-Content -LiteralPath $timingFile

Write-Output "Completed real Maxine comparison: $out"
Get-Content -LiteralPath $timingFile
