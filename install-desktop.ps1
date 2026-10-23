# Install the ASCII-ocean background into the DSH Desktop profile (Windows).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\install-desktop.ps1
#
# Set DSH_PROFILE_DIR to install into a different profile directory.
$ErrorActionPreference = "Stop"

$PkgName = "@local/dsh-client-ui-ascii-ocean"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProfileDir = if ($env:DSH_PROFILE_DIR) { $env:DSH_PROFILE_DIR } else { Join-Path $env:USERPROFILE ".dsh\profiles\desktop" }
$Patch = Join-Path $ProfileDir "cordis.patch.yml"
$Dest = Join-Path $ProfileDir "node_modules\@local\dsh-client-ui-ascii-ocean"

if (-not (Test-Path $Patch)) {
  throw "error: $Patch not found - is the DeepSeek Harness Desktop profile initialized?"
}

# 1. Package first: the Loader must be able to import it the moment the row appears.
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Dest) | Out-Null
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item -Recurse -Force (Join-Path $Here "lib") $Dest
Copy-Item -Force (Join-Path $Here "package.json") $Dest
Copy-Item -Force (Join-Path $Here "README.md") $Dest
Copy-Item -Force (Join-Path $Here "LICENSE") $Dest
Copy-Item -Force (Join-Path $Here "THIRD_PARTY_NOTICES.md") $Dest

# 2. Patch row: hot-reloaded by dsh-hmr, so the canvas appears without a restart.
$Content = Get-Content -Raw -Path $Patch
if ($Content -notmatch "id:\s*ui-ascii-ocean") {
  $Snippet = "`r`n- insert:`r`n    - id: ui-ascii-ocean`r`n      name: `"$PkgName`"`r`n"
  $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::AppendAllText($Patch, $Snippet, $Utf8NoBom)
}

Write-Host "installed: $Dest"
$Count = (Select-String -Path $Patch -Pattern "id: ui-ascii-ocean" -AllMatches).Matches.Count
Write-Host "patch row: ui-ascii-ocean -> $Count occurrence(s)"
Write-Host "DSH hot-reloads the profile patch; no restart needed."
Write-Host "If the app window was already open and still shows an older build of the"
Write-Host "plugin, press Ctrl+R once to reload the page (drafts are auto-saved)."
