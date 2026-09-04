<#
.SYNOPSIS
  Regenerate the known image capability fixtures used by the MED-02 startup
  decode checks, deterministically and at a tiny fixed size.

.DESCRIPTION
  PNG, JPEG, and WebP are produced with ffmpeg (present in the base toolchain).
  HEIC requires a HEIF encoder (ImageMagick with HEIC delegates, or
  `pillow-heif`), which is not part of the base offline toolchain; the command
  is emitted but only run when the encoder is available.

  After regenerating, refresh bytes and sha256 in `manifest.json`.

.EXAMPLE
  pwsh db/fixtures/media/generate-media-fixtures.ps1
#>
[CmdletBinding()]
param(
  [int]$Size = 16,
  [switch]$GenerateHeic
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function New-Image($color, $name) {
  $out = Join-Path $here $name
  ffmpeg -hide_banner -loglevel error -f lavfi -i "color=c=$color`:s=${Size}x${Size}" -frames:v 1 -y $out
  $hash = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
  '{0,-26} {1,5} bytes  sha256:{2}' -f $name, (Get-Item $out).Length, $hash
}

Write-Host 'Generating PNG/JPEG/WebP capability fixtures with ffmpeg...'
New-Image '0x336699' 'capability-16x16.png'
New-Image '0x996633' 'capability-16x16.jpg'
New-Image '0x339966' 'capability-16x16.webp'

Write-Host ''
if ($GenerateHeic) {
  Write-Host 'Generating HEIC capability fixture with Pillow/pillow-heif...'
  $heicPath = Join-Path $here 'capability-16x16.heic'
  python -c "from PIL import Image; import pillow_heif; pillow_heif.register_heif_opener(); Image.new('RGB',($Size,$Size),(102,51,153)).save(r'$heicPath', quality=90)"
  $hash = (Get-FileHash $heicPath -Algorithm SHA256).Hash.ToLower()
  '{0,-26} {1,5} bytes  sha256:{2}' -f 'capability-16x16.heic', (Get-Item $heicPath).Length, $hash
} else {
  Write-Host 'HEIC unchanged. Install Pillow 10.4.0 and pillow-heif 0.18.0, then'
  Write-Host 'rerun with -GenerateHeic to regenerate all four capability files.'
}
