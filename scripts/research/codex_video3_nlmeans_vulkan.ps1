param(
    [string]$Root = "E:\TESTE CLAUDE CODEX\Test Video 3"
)

$ErrorActionPreference = "Stop"
$ff = "$env:APPDATA\com.guilherme.mediahub\bin\ffmpeg.exe"
$wk = "$env:APPDATA\com.guilherme.mediahub\bin\RTXVideoProcessor.exe"
$src = Join-Path $Root "Sora_RyoTa_-_Babilonia [mEzxpHslNgE].mp4"
$out = Join-Path $Root "_analysis\restored\codex\nlmeans_vulkan_test"
$tmp = Join-Path $out "_intermediate"
New-Item -ItemType Directory -Force $out, $tmp | Out-Null
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

function Add-Audio([string]$VideoPath, [string]$OutputPath) {
    & $ff -y -hide_banner -loglevel error -i $VideoPath -i $src `
        -map 0:v:0 -map 1:a? -c:v copy -c:a aac -b:a 256k `
        -shortest -movflags +faststart $OutputPath
    if ($LASTEXITCODE -ne 0) { throw "Audio mux failed: $OutputPath" }
    Assert-Output $OutputPath "audio mux"
}

# Control: RTX directly from the uploaded source.
$rtxOnlyRaw = Join-Path $tmp "rtx_only_1440_raw.mp4"
Run-Timed "RTX only" {
    & $wk $src $rtxOnlyRaw -v --vsr-quality 4 --vsr-scale 2 --no-thdr
    if ($LASTEXITCODE -ne 0) { throw "RTX-only failed: $LASTEXITCODE" }
}
Assert-Output $rtxOnlyRaw "RTX-only"
Add-Audio $rtxOnlyRaw (Join-Path $out "00_RTX-only_1440_FINAL.mp4")

foreach ($strength in @(2.5, 3.0)) {
    $tag = $strength.ToString("0.0", [Globalization.CultureInfo]::InvariantCulture)
    $pre = Join-Path $tmp "nlmeansVK-s$tag-gblurVK0.6_preclean720.mp4"
    $rtx = Join-Path $tmp "nlmeansVK-s$tag-gblurVK0.6_rtx1440_raw.mp4"
    $final = Join-Path $out "nlmeansVK-s$tag-gblurVK0.6-RTX_1440_FINAL.mp4"
    $vf = "format=yuv420p,hwupload,nlmeans_vulkan=s=${tag}:p=7:r=15,gblur_vulkan=sigma=0.6,hwdownload,format=yuv420p"

    Run-Timed "NLMeans Vulkan s=$tag + gblur Vulkan 0.6 + NVENC" {
        & $ff -y -hide_banner -loglevel warning `
            -init_hw_device vulkan=vk:0 -filter_hw_device vk `
            -i $src -an -vf $vf `
            -c:v h264_nvenc -preset p7 -tune hq -rc constqp -qp 10 `
            -pix_fmt yuv420p $pre
        if ($LASTEXITCODE -ne 0) { throw "GPU preclean s=$tag failed: $LASTEXITCODE" }
    }
    Assert-Output $pre "GPU preclean s=$tag"

    Run-Timed "RTX after NLMeans Vulkan s=$tag" {
        & $wk $pre $rtx -v --vsr-quality 4 --vsr-scale 2 --no-thdr
        if ($LASTEXITCODE -ne 0) { throw "RTX after GPU preclean s=$tag failed: $LASTEXITCODE" }
    }
    Assert-Output $rtx "RTX after GPU preclean s=$tag"
    Add-Audio $rtx $final
}

$timingFile = Join-Path $out "TIMINGS.txt"
$timings.GetEnumerator() | ForEach-Object { "{0}: {1}" -f $_.Key, $_.Value } |
    Set-Content -LiteralPath $timingFile

@"
GPU chain: software decode -> hwupload Vulkan -> nlmeans_vulkan ->
gblur_vulkan -> hwdownload -> h264_nvenc -> RTX worker.

Known bundled-FFmpeg bug: gblur_vulkan with planes=1 generates an invalid shader
for yuv420p (variable redefinition). This test applies sigma 0.6 to all planes.
"@ | Set-Content -LiteralPath (Join-Path $out "README.txt")

Write-Output "Completed Video 3 GPU NLMeans test: $out"
Get-Content -LiteralPath $timingFile
