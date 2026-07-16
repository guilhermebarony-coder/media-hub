$ErrorActionPreference = 'Stop'

$ff = 'F:\CLAUDE\media-hub\src-tauri\target\release\ffmpeg.exe'
$wk = "$env:APPDATA\com.guilherme.mediahub\bin\RTXVideoProcessor.exe"
$sourcePath = 'E:\TESTE CLAUDE CODEX\Test video 4 and 5\I_Like_It_ft._Seih [fYLUeGBp2Y8].mp4'
$outDir = 'E:\TESTE CLAUDE CODEX\Test video 4 and 5\_analysis\restored\codex\SHARPEN_FAMILY_SWEEP_2026-07-07'
$preDir = Join-Path $outDir '_pre720'
New-Item -ItemType Directory -Force -Path $outDir, $preDir | Out-Null

$tests = @(
    @{ Family='dog'; Label='weak';  Strength=0.75 },
    @{ Family='dog'; Label='ideal'; Strength=1.50 },
    @{ Family='dog'; Label='strong'; Strength=2.25 },
    @{ Family='dog'; Label='blown'; Strength=3.00 },
    @{ Family='bilateral'; Label='weak';  Strength=0.50 },
    @{ Family='bilateral'; Label='ideal'; Strength=1.00 },
    @{ Family='bilateral'; Label='strong'; Strength=1.75 },
    @{ Family='bilateral'; Label='blown'; Strength=2.75 },
    @{ Family='guided'; Label='weak';  Strength=0.50 },
    @{ Family='guided'; Label='ideal'; Strength=1.00 },
    @{ Family='guided'; Label='strong'; Strength=1.75 },
    @{ Family='guided'; Label='blown'; Strength=2.75 }
)

function Get-DetailGraph([string]$family, [double]$strength) {
    $s = $strength.ToString('0.00', [Globalization.CultureInfo]::InvariantCulture)
    if ($family -eq 'dog') {
        return "[nlmout]split=4[nbase][d1][d2][keep];" +
               "[d1]gblur=sigma=0.6:planes=1[g1];[d2]gblur=sigma=1.2:planes=1[g2];" +
               "[g1][g2]blend=c0_expr='clip(A-B+128,0,255)':c1_expr='128':c2_expr='128'[res];" +
               "[nbase][res]blend=c0_expr='clip(A+$s*(B-128),0,255)':c1_expr='A':c2_expr='A'[detail];" +
               "[keep][detail][mask]maskedmerge=planes=1[out]"
    }
    if ($family -eq 'bilateral') {
        return "[nlmout]split=3[nbase][bf][keep];" +
               "[bf]bilateral=sigmaS=2.0:sigmaR=0.12:planes=1[basefilter];" +
               "[nbase][basefilter]blend=c0_expr='clip(A+$s*(A-B),0,255)':c1_expr='A':c2_expr='A'[detail];" +
               "[keep][detail][mask]maskedmerge=planes=1[out]"
    }
    return "[nlmout]split=3[nbase][gf][keep];" +
           "[gf]guided=radius=4:eps=0.01:mode=fast:sub=2:planes=1[basefilter];" +
           "[nbase][basefilter]blend=c0_expr='clip(A+$s*(A-B),0,255)':c1_expr='A':c2_expr='A'[detail];" +
           "[keep][detail][mask]maskedmerge=planes=1[out]"
}

$common = "[0:v]format=yuv420p,split=3[base][ms][nlm];" +
          "[ms]scale=640:360:flags=bilinear,gblur=sigma=0.8,edgedetect=low=0.07:high=0.20:planes=1," +
          "dilation,dilation,gblur=sigma=1.5,scale=1280:720:flags=bilinear,format=gray[mask];" +
          "[nlm]pad=iw+48:ih+48:24:24:color=black,fillborders=left=24:right=24:top=24:bottom=24:mode=mirror," +
          "format=yuv420p,hwupload,nlmeans_vulkan=s=10:p=7:r=15:t=8,hwdownload,format=yuv420p," +
          "crop=1280:720:24:24[cleanfull];" +
          "[base][cleanfull][mask]maskedmerge=planes=1[nlmout];"

$rows = @()
foreach ($test in $tests) {
    $strengthTag = $test.Strength.ToString('0.00', [Globalization.CultureInfo]::InvariantCulture).Replace('.', 'p')
    $stem = "{0}_{1}_s{2}" -f $test.Family, $test.Label, $strengthTag
    $pre = Join-Path $preDir ($stem + '_pre720.mp4')
    $final = Join-Path $outDir ($stem + '_RTX2x_1440.mp4')
    $graph = $common + (Get-DetailGraph $test.Family $test.Strength)

    Write-Host "PREFILTER $stem"
    $preTime = Measure-Command {
        $ffArgs = @(
            '-y', '-hide_banner', '-loglevel', 'warning',
            '-init_hw_device', 'vulkan=vk:0', '-filter_hw_device', 'vk',
            '-ss', '10', '-t', '6', '-i', $sourcePath,
            '-filter_complex', $graph, '-map', '[out]', '-an',
            '-c:v', 'h264_nvenc', '-preset', 'p6', '-tune', 'hq',
            '-rc', 'constqp', '-qp', '18', '-pix_fmt', 'yuv420p', $pre
        )
        & $ff @ffArgs
        if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed for $stem" }
    }

    Write-Host "RTX $stem"
    $rtxTime = Measure-Command {
        & $wk $pre $final -v --vsr-quality 4 --vsr-scale 2 --no-thdr
        if ($LASTEXITCODE -ne 0) { throw "RTX worker failed for $stem" }
    }

    $rows += [pscustomobject]@{
        family = $test.Family
        label = $test.Label
        strength = $test.Strength
        clip_seconds = 6
        prefilter_seconds = [math]::Round($preTime.TotalSeconds, 3)
        rtx_seconds = [math]::Round($rtxTime.TotalSeconds, 3)
        total_seconds = [math]::Round(($preTime + $rtxTime).TotalSeconds, 3)
        output = $final
    }
}

$csv = Join-Path $outDir 'timings.csv'
$rows | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $csv
$rows | Format-Table -AutoSize

$readme = @"
# Sharpen family sweep

Common pipeline: conservative mask -> reflected-border nlmeans_vulkan s=10 p=7 r=15 t=8 -> masked detail operator -> RTX VSR Q4 2x.

Source segment: Video 4, 00:10-00:16. No libplacebo post-pass, so the comparison isolates the pre-RTX detail operator.

Families:
- dog: exact sigma 0.6 / 1.2 band-pass used by the champion pipeline.
- bilateral: edge-aware detail layer, bilateral sigmaS 2.0 / sigmaR 0.12.
- guided: fast guided-filter detail layer, radius 4 / eps 0.01 / sub 2.

Strength labels are intentionally family-relative, not numerically equivalent across algorithms. See timings.csv for measured wall-clock times.
"@
Set-Content -LiteralPath (Join-Path $outDir 'README.md') -Value $readme -Encoding UTF8
