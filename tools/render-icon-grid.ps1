# Xingyu - render icon font glyph overview grids for manual selection
# Reads tools/glyphs.txt (space-separated PUA hex list), outputs 256-glyph grids
# to tools/ as icons-eXXX.png. Grid position: row*16+col -> start + row*16 + col.

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$glyphFile = Join-Path $root 'tools\glyphs.txt'
$fontFile = Join-Path $root 'miniprogram\styles\fonts\iconfont.ttf'

$hexList = ((Get-Content -Raw $glyphFile).Trim() -split '\s+') | ForEach-Object { [Convert]::ToInt32($_, 16) }

$fontCol = New-Object System.Drawing.Text.PrivateFontCollection
$fontCol.AddFontFile($fontFile)
$family = $fontCol.Families[0]

$cell = 50
$cols = 16
$rows = 16
$per = $cols * $rows

$chunkCount = [math]::Ceiling($hexList.Count / $per)
for ($c = 0; $c -lt $chunkCount; $c++) {
  $startCp = $hexList[$c * $per]
  $bmp = New-Object System.Drawing.Bitmap(($cols * $cell), ($rows * $cell))
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $font = New-Object System.Drawing.Font($family, 30, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 31, 39, 51))
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center

  $count = [math]::Min($per, $hexList.Count - $c * $per)
  for ($i = 0; $i -lt $count; $i++) {
    $cp = $hexList[$c * $per + $i]
    $row = [math]::Floor($i / $cols)
    $col = $i % $cols
    $rect = New-Object System.Drawing.RectangleF(($col * $cell), ($row * $cell), $cell, $cell)
    $g.DrawString([char]$cp, $font, $brush, $rect, $format)
  }

  $font.Dispose(); $brush.Dispose(); $format.Dispose(); $g.Dispose()
  $out = Join-Path $root ("tools\icons-" + $startCp.ToString('x4') + '.png')
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("grid " + $c + " done: " + $out)
}
Write-Host 'all grids rendered.'
