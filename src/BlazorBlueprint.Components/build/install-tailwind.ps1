# Tailwind CLI Downloader for Windows
$tailwindVersion = if ($env:TAILWIND_VERSION) { $env:TAILWIND_VERSION } else { "v4.2.2" }
$url = "https://github.com/tailwindlabs/tailwindcss/releases/download/$tailwindVersion/tailwindcss-windows-x64.exe"
$target = Join-Path $PSScriptRoot "tailwindcss.exe"

Write-Host "Downloading Tailwind CLI from $url..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $url -OutFile $target

Write-Host "Done! Binary saved as $target" -ForegroundColor Green
