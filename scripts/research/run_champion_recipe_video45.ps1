param(
    [string]$Root = "E:\TESTE CLAUDE CODEX\Test video 4 and 5"
)

$ErrorActionPreference = "Stop"

$ff = "F:\CLAUDE\media-hub\src-tauri\target\release\ffmpeg.exe"
$rtx = "F:\CLAUDE\rtx-worker-fork\build-final\RTXVideoProcessor.exe"

$inputs = @(
    @{ Label = "video4"; File = "I_Like_It_ft._Seih [fYLUeGBp2Y8].mp4" },
    @{ Label = "video5"; File = "Most_Beautiful_Lie_AMV [nRQCXNj680U].mp4" }
)

$filter = @"
[0:v]format=yuv420p,split=3[orig][denin][maskin];
[maskin]scale=640:360:flags=bilinear,format=gray,gblur=sigma=0.8,edgedetect=low=0.07:high=0.20,dilation,dilation,gblur=sigma=1.5,scale=1280:720:flags=bilinear,format=yuv420p,split=2[maskn][maskd];
[denin]pad=iw+48:ih+48:24:24,fillborders=left=24:right=24:top=24:bottom=24:mode=reflect,hwupload,nlmeans_vulkan=s=10:p=7:r=15,hwdownload,format=yuv420p,crop=1280:720:24:24[den];
[orig][den][maskn]maskedmerge[clean];
[clean]split=3[base][g1][g2];
[g1]gblur=sigma=0.6:planes=1[b1];
[g2]gblur=sigma=1.2:planes=1[b2];
[b1][b2]blend=c0_expr='clip(A-B+128,0,255)':c1_expr='128':c2_expr='128'[dog];
[base][dog]blend=c0_expr='clip(A+1.5*(B-128),0,255)':c1_expr='A':c2_expr='A'[sharp];
[clean][sharp][maskd]maskedmerge=planes=1[out]
"@ -replace "`r?`n", ""

foreach ($item in $inputs) {
    $input = Join-Path $Root $item.File
    $outDir = Join-Path $Root "_analysis\restored\codex\champion_nlm10_dog15_rtx_libplacebo\$($item.Label)"
    $tmp = Join-Path $outDir "_intermediate"
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null

    $pre = Join-Path $tmp "$($item.Label)_nlm10_dog15_preclean720.mp4"
    $rtxRaw = Join-Path $tmp "$($item.Label)_nlm10_dog15_rtx2x_raw1440.mp4"
    $final = Join-Path $outDir "$($item.Label)_NLM10-DOG1.5-RTX2x-libplacebo_1440_FINAL.mp4"
    $timings = Join-Path $outDir "PIPELINE_AND_TIMINGS.txt"

    $sw = [Diagnostics.Stopwatch]::StartNew()
    & $ff -y -hide_banner -loglevel warning `
        -init_hw_device vulkan=vk:0 -filter_hw_device vk -i $input `
        -filter_complex $filter -map "[out]" -map "0:a?" `
        -c:v h264_nvenc -preset p7 -tune hq -rc constqp -qp 18 `
        -pix_fmt yuv420p -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 `
        -c:a copy -movflags +faststart $pre
    if ($LASTEXITCODE -ne 0) { throw "Prefilter failed for $($item.Label)" }
    $sw.Stop()
    $preSeconds = $sw.Elapsed.TotalSeconds

    $sw.Restart()
    & $rtx $pre $rtxRaw -v --vsr-quality 4 --vsr-scale 2 --no-thdr
    if ($LASTEXITCODE -ne 0) { throw "RTX failed for $($item.Label)" }
    $sw.Stop()
    $rtxSeconds = $sw.Elapsed.TotalSeconds

    $sw.Restart()
    & $ff -y -hide_banner -loglevel warning `
        -init_hw_device vulkan=vk:0 -filter_hw_device vk -i $rtxRaw `
        -vf "libplacebo=w=2560:h=1440:deband=true:deband_iterations=3:deband_threshold=6:deband_radius=24:deband_grain=6:dithering=blue:peak_detect=false" `
        -map "0:v:0" -map "0:a?" `
        -c:v hevc_nvenc -preset p7 -tune hq -rc constqp -qp 18 -tag:v hvc1 `
        -pix_fmt yuv420p -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 `
        -c:a copy -movflags +faststart $final
    if ($LASTEXITCODE -ne 0) { throw "Postfilter failed for $($item.Label)" }
    $sw.Stop()
    $postSeconds = $sw.Elapsed.TotalSeconds

    $total = $preSeconds + $rtxSeconds + $postSeconds
    @"
Input: $input
Output: $final
Recipe: conservative mask -> reflected-border nlmeans_vulkan s=10 p=7 r=15 -> luma DoG 0.6/1.2 strength 1.5 -> RTX VSR Q4 2x -> libplacebo deband(iter3,thr6,r24,grain6,blue dither)
Prefilter seconds: $([math]::Round($preSeconds, 2))
RTX seconds: $([math]::Round($rtxSeconds, 2))
Post + NVENC seconds: $([math]::Round($postSeconds, 2))
Total seconds: $([math]::Round($total, 2))
"@ | Set-Content -LiteralPath $timings -Encoding UTF8

    Write-Host "$($item.Label) complete: $final"
}
