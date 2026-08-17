# Xingyu - export map marker PNGs from the iconfont glyph (0xE600 定位图钉)
# Glyph is rendered large, auto-cropped to its ink bounding box and bottom-aligned,
# so the marker tip aligns with map anchor {x:0.5, y:1}.

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$fontFile = Join-Path $root 'miniprogram\styles\fonts\iconfont.ttf'
$imgDir = Join-Path $root 'miniprogram\images'

$fontCol = New-Object System.Drawing.Text.PrivateFontCollection
$fontCol.AddFontFile($fontFile)
$family = $fontCol.Families[0]

$CP = 0xE600

function Export-Pin([string]$file, [string]$colorHex, [int]$targetW) {
  $W = 64
  $H = 84
  $bmp = New-Object System.Drawing.Bitmap($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $font = New-Object System.Drawing.Font($family, 70, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($colorHex))
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, 0, $W, $H)
  $g.DrawString([char]$CP, $font, $brush, $rect, $format)

  # find ink bounding box
  $minX = $W; $minY = $H; $maxX = -1; $maxY = -1
  for ($y = 0; $y -lt $H; $y++) {
    for ($x = 0; $x -lt $W; $x++) {
      $p = $bmp.GetPixel($x, $y)
      if ($p.A -gt 12) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  $cw = $maxX - $minX + 1
  $ch = $maxY - $minY + 1

  # bottom-aligned output canvas (2px pad), scaled to target width
  $outH = [math]::Round($ch * $targetW / $cw)
  $out = New-Object System.Drawing.Bitmap($targetW, $outH)
  $og = [System.Drawing.Graphics]::FromImage($out)
  $og.Clear([System.Drawing.Color]::Transparent)
  $og.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $srcRect = New-Object System.Drawing.Rectangle($minX, $minY, $cw, $ch)
  $destRect = New-Object System.Drawing.Rectangle(0, 0, $targetW, $outH)
  $og.DrawImage($bmp, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

  $out.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host ("exported " + $file + "  (" + $targetW + "x" + $outH + ")")

  $og.Dispose(); $out.Dispose()
  $format.Dispose(); $brush.Dispose(); $font.Dispose(); $g.Dispose(); $bmp.Dispose()
}

Export-Pin (Join-Path $imgDir 'marker-island.png') '#E8564C' 34
Export-Pin (Join-Path $imgDir 'marker-point.png') '#2B5CD9' 34

Write-Host 'marker-island / marker-point exported (marker-current.png kept as user-provided).'
