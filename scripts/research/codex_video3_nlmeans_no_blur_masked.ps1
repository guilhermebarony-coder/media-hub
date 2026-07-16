param(
    [string]$Root = "E:\TESTE CLAUDE CODEX\Test Video 3"
)

$ErrorActionPreference = "Stop"
$ff = "$env:APPDATA\com.guilherme.mediahub\bin\ffmpeg.exe"
$wk = "$env:APPDATA\com.guilherme.mediahub\bin\RTXVideoProcessor.exe"
$src = Join-Path $Root "Sora_RyoTa_-_Babilonia [mEzxpHslNgE].mp4"
$out = Join-Path $Root "_analysis\restored\codex\nlmeans_vulkan_no_blur_masked"
$tmp = Join-Path $out "_intermediate"
$maps = Join-Path $out "maps"
New-Item -ItemType Directory -Force $out, $tmp, $maps | Out-Null
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

function Run-Rtx([string]$Preclean, [string]$Tag, [string]$FinalName) {
    $rtxRaw = Join-Path $tmp ("{0}_rtx1440_raw.mp4" -f $Tag)
    Run-Timed "RTX after $Tag" {
        & $wk $Preclean $rtxRaw -v --vsr-quality 4 --vsr-scale 2 --no-thdr
        if ($LASTEXITCODE -ne 0) { throw "RTX after $Tag failed: $LASTEXITCODE" }
    }
    Assert-Output $rtxRaw "RTX after $Tag"
    Add-Audio $rtxRaw (Join-Path $out $FinalName)
}

# Global controls: NLMeans only. No gblur touches the image.
foreach ($strength in @(2.5, 3.0)) {
    $tag = $strength.ToString("0.0", [Globalization.CultureInfo]::InvariantCulture)
    $pre = Join-Path $tmp "nlmeansVK-s$tag-global_preclean720.mp4"
    $vf = "format=yuv420p,hwupload,nlmeans_vulkan=s=${tag}:p=7:r=15,hwdownload,format=yuv420p"
    Run-Timed "NLMeans Vulkan global s=$tag + NVENC" {
        & $ff -y -hide_banner -loglevel warning `
            -init_hw_device vulkan=vk:0 -filter_hw_device vk `
            -i $src -an -vf $vf `
            -c:v h264_nvenc -preset p7 -tune hq -rc constqp -qp 10 `
            -pix_fmt yuv420p $pre
        if ($LASTEXITCODE -ne 0) { throw "Global NLMeans s=$tag failed: $LASTEXITCODE" }
    }
    Assert-Output $pre "global NLMeans s=$tag"
    $index = if ($tag -eq "2.5") { "01" } else { "02" }
    Run-Rtx $pre "global-s$tag" "${index}_NLMeansVK-s${tag}-global-noBlur-RTX_1440_FINAL.mp4"
}

# Edge-neighborhood arm. The original remains untouched outside a soft mask.
# The mask is built at half resolution so grain, rain and tiny details are less
# likely to be classified as structural edges. Blur is applied to the mask only.
$maskedPre = Join-Path $tmp "nlmeansVK-s3.0-structuralEdges_preclean720.mp4"
$fc = @"
[0:v]format=yuv420p,split=3[base][gpu][ms];
[gpu]hwupload,nlmeans_vulkan=s=3.0:p=7:r=15,hwdownload,format=yuv420p[clean];
[ms]format=gray,scale=640:360:flags=area,gblur=sigma=0.8,edgedetect=low=0.05:high=0.15:planes=y,dilation,dilation,gblur=sigma=1.5,scale=1280:720:flags=bilinear,format=gray[mask];
[base][clean][mask]maskedmerge=planes=15[out]
"@ -replace "`r?`n", ""
Run-Timed "NLMeans Vulkan s=3 structural-edge mask + NVENC" {
    & $ff -y -hide_banner -loglevel warning `
        -init_hw_device vulkan=vk:0 -filter_hw_device vk `
        -i $src -an -filter_complex $fc -map "[out]" `
        -c:v h264_nvenc -preset p7 -tune hq -rc constqp -qp 10 `
        -pix_fmt yuv420p $maskedPre
    if ($LASTEXITCODE -ne 0) { throw "Masked NLMeans failed: $LASTEXITCODE" }
}
Assert-Output $maskedPre "masked NLMeans"
Run-Rtx $maskedPre "masked-structural-s3.0" "03_NLMeansVK-s3.0-structuralEdges-noBlur-RTX_1440_FINAL.mp4"

# Representative mask still for auditing what is actually being filtered.
$maskVf = "format=gray,scale=640:360:flags=area,gblur=sigma=0.8,edgedetect=low=0.05:high=0.15:planes=y,dilation,dilation,gblur=sigma=1.5,scale=1280:720:flags=bilinear,format=gray"
& $ff -y -hide_banner -loglevel error -ss 25 -i $src -vf $maskVf `
    -frames:v 1 -update 1 (Join-Path $maps "structural_edge_mask_t25.png")

$timings.GetEnumerator() | ForEach-Object { "{0}: {1}" -f $_.Key, $_.Value } |
    Set-Content -LiteralPath (Join-Path $out "TIMINGS.txt")

@"
No image gblur is used in this experiment.

The structural-edge candidate uses blur only while constructing its invisible
mask at half resolution. White mask regions receive NLMeans; black regions retain
the original upload. See maps/structural_edge_mask_t25.png.
"@ | Set-Content -LiteralPath (Join-Path $out "README.txt")

Write-Output "Completed no-blur/masked test: $out"
Get-Content -LiteralPath (Join-Path $out "TIMINGS.txt")
