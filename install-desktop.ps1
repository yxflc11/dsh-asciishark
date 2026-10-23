# Run from the complete repository or installed package; no npm install needed.
$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProfileDir = if ($env:DSH_PROFILE_DIR) { $env:DSH_PROFILE_DIR } else { Join-Path $env:USERPROFILE ".dsh\profiles\desktop" }
$Helper = Join-Path $Here "scripts\desktop.mjs"
if (-not (Test-Path -LiteralPath $Helper -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $Here "scripts\vendor\yaml.mjs") -PathType Leaf)) {
  throw "Installer support files are missing; use the complete repository/package. No files were changed."
}
$Candidates = @()
if ($env:DSH_NODE_BIN) {
  $Candidates += $env:DSH_NODE_BIN
} else {
  $NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($NodeCommand) { $Candidates += $NodeCommand.Source }
  # Best-effort paths for Desktop installations; system Node remains supported.
  foreach ($Root in @($env:LOCALAPPDATA, $env:ProgramFiles)) {
    if ($Root) {
      foreach ($AppDir in @("Programs\DeepSeek Harness", "DeepSeek Harness")) {
        foreach ($NodeRelative in @("resources\runtime\primary-runtime\dependencies\node\node.exe", "resources\runtime\primary-runtime\dependencies\node\bin\node.exe")) {
          $Candidates += Join-Path (Join-Path $Root $AppDir) $NodeRelative
        }
      }
    }
  }
}
foreach ($NodeBin in $Candidates) {
  if (-not (Test-Path -LiteralPath $NodeBin -PathType Leaf)) { continue }
  & $NodeBin -e 'process.exit(Number.parseInt(process.versions.node, 10) >= 18 ? 0 : 1)' 2>$null
  if ($LASTEXITCODE -eq 0) {
    & $NodeBin $Helper install $ProfileDir
    exit $LASTEXITCODE
  }
}
throw "Node.js 18+ was not found. Install Node or set DSH_NODE_BIN to its executable. No files were changed."
