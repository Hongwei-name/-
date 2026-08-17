# Xingyu - select linear (outline) icons from candidate codepoints
# For each candidate, render the glyph and measure fill ratios to
# distinguish linear/outline style (hollow center) from filled style.
#
# Input : tools/candidates.txt  - lines of "HEX" or "HEX;semantic-name"
# Output: console table + tools/preview-candidates.png (rendered previews)

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$fontFile = Join-Path $root 'miniprogram\styles\fonts\iconfont.ttf'
$candFile = Join-Path $root 'tools\candidates.txt'

$fontCol = New-Object System.Drawing.Text.PrivateFontCollection
$fontCol.AddFontFile($fontFile)
$family = $fontCol.Families[0]

$lines = Get-Content $candFile | Where-Object { $_ -and $_ -notmatch '^\s*#' }
$items = @()
foreach ($ln in $lines) {
  $parts = $ln -split ';'
  $hex = $parts[0].Trim()
  $name = if ($parts.Length -gt 1) { $parts[1].Trim() } else { '' }
  try { $items += , @([Convert]::ToInt32($hex, 16), $name) } catch { }
}

$size = 96
$fontSize = 84
$font = New-Object System.Drawing.Font($family, $fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

function Measure-Glyph([int]$cp) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(2, 2, ($size - 4), ($size - 4))
  $g.DrawString([char]$cp, $font, $brush, $rect, $format)

  $total = 0
  $center = 0
  $cx = $size / 2
  $cy = $size / 2
  $cr = $size * 0.22
  for ($y = 0; $y -lt $size; $y += 2) {
    for ($x = 0; $x -lt $size; $x += 2) {
      $c = $bmp.GetPixel($x, $y)
      if ($c.R -lt 200) {
        $total++
        $dx = $x - $cx
        $dy = $y - $cy
        if (($dx * $dx + $dy * $dy) -lt ($cr * $cr)) { $center++ }
      }
    }
  }
  $totalPts = ($size / 2) * ($size / 2)
  $centerPts = [math]::PI * $cr * $cr / 4
  $totalRatio = $total / $totalPts
  $centerRatio = $center / $centerPts

  $brush.Dispose(); $format.Dispose(); $g.Dispose()
  return , @($totalRatio, $centerRatio, $bmp)
}

$results = @()
foreach ($item in $items) {
  $cp = $item[0]
  $name = $item[1]
  $m = Measure-Glyph $cp
  $totalRatio = $m[0]
  $centerRatio = $m[1]
  $bmp = $m[2]
  # linear heuristic: moderate ink, hollow center
  $isLinear = ($totalRatio -gt 0.02 -and $totalRatio -lt 0.55) -and ($centerRatio -lt 0.30)
  $results += , @($cp, $name, $totalRatio, $centerRatio, $isLinear, $bmp)
  Write-Host ("{0}  {1,-16} total={2,5:P0} center={3,5:P0}  {4}" -f ('0x' + $cp.ToString('X4')), $name, $totalRatio, $centerRatio, $(if ($isLinear) { 'LINEAR' } else { '--' }))
}

# compose preview sheet (8 per row, 140px cells)
$cols = 8
$cell = 140
$rows = [math]::Ceiling($results.Count / $cols)
$sheet = New-Object System.Drawing.Bitmap(($cols * $cell), ($rows * $cell))
$sg = [System.Drawing.Graphics]::FromImage($sheet)
$sg.Clear([System.Drawing.Color]::White)
$labelFont = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$labelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 90, 100, 115))
for ($i = 0; $i -lt $results.Count; $i++) {
  $r = $results[$i]
  $col = $i % $cols
  $row = [math]::Floor($i / $cols)
  $x = $col * $cell
  $y = $row * $cell
  $sg.DrawImage($r[5], ($x + 10), ($y + 4), 96, 96)
  $sg.DrawString('0x' + $r[0].ToString('X4'), $labelFont, $labelBrush, ($x + 6), ($y + 106))
}
$preview = Join-Path $root 'tools\preview-candidates.png'
$sheet.Save($preview, [System.Drawing.Imaging.ImageFormat]::Png)
$labelFont.Dispose(); $labelBrush.Dispose(); $sg.Dispose(); $sheet.Dispose()
foreach ($r in $results) { $r[5].Dispose() }
$font.Dispose()
Write-Host ('preview saved: ' + $preview)
