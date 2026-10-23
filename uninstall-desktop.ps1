# Remove the ASCII-ocean background from the DSH Desktop profile (Windows).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\uninstall-desktop.ps1
#
# Set DSH_PROFILE_DIR to target a different profile directory.
$ErrorActionPreference = "Stop"

$ProfileDir = if ($env:DSH_PROFILE_DIR) { $env:DSH_PROFILE_DIR } else { Join-Path $env:USERPROFILE ".dsh\profiles\desktop" }
$Patch = Join-Path $ProfileDir "cordis.patch.yml"
$Dest = Join-Path $ProfileDir "node_modules\@local\dsh-client-ui-ascii-ocean"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }

if (Test-Path $Patch) {
  $Content = Get-Content -Raw -Path $Patch

  # Remove exactly our dedicated insert block, leaving any other entries intact.
  $Pattern = '(?ms)\r?\n- insert:\r?\n[ \t]+- id: ui-ascii-ocean\r?\n[ \t]+name: "[^"]*"\r?\n?'
  $Content = [regex]::Replace($Content, $Pattern, "`r`n")

  # Older installer versions added a comment above the block.
  $Content = [regex]::Replace($Content, '(?m)^# ASCII-sharks animated background.*\r?\n', '')

  $Content = $Content.TrimEnd() + "`r`n"
  [System.IO.File]::WriteAllText($Patch, $Content, $Utf8NoBom)
}

Write-Host "removed: $Dest"
Write-Host "If the app window still shows the background, press Ctrl+R to reload the page."
