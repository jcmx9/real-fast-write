<#
.SYNOPSIS
  End-to-end check of scripts\bootstrap.ps1 against a locally built archive (CI job "bootstrap").
.DESCRIPTION
  scripts\test-bootstrap.ps1 [-Archive dist\rf-write-<version>-win-x64.zip]

  Runs under Windows PowerShell 5.1 and starts the bootstrap as a separate
  powershell.exe process (as a file, and once as a script block like "irm | iex").
  LOCALAPPDATA, APPDATA and RFW_HOME point into a temp folder, so the real profile,
  WindowsApps folder and Start menu are never touched.
#>
param([string]$Archive = '')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$bootstrap = Join-Path $root 'scripts\bootstrap.ps1'
$version = (Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json).version
if (-not $Archive) { $Archive = Join-Path $root "dist\rf-write-$version-win-x64.zip" }
if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { throw "archive not found: $Archive" }
$Archive = (Resolve-Path -LiteralPath $Archive).Path

function Fail([string]$Message) {
  Write-Host "FAIL: $Message" -ForegroundColor Red
  exit 1
}
function Pass([string]$Message) { Write-Host "ok   $Message" }

$work = Join-Path ([IO.Path]::GetTempPath()) ('rfw-bootstrap-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null

try {
  $env:LOCALAPPDATA = Join-Path $work 'Local'
  $env:APPDATA = Join-Path $work 'Roaming'
  New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA, $env:APPDATA | Out-Null
  # Below LOCALAPPDATA, like the default location, so the launcher uses %LOCALAPPDATA%.
  $env:RFW_HOME = Join-Path $env:LOCALAPPDATA 'rfw-home'
  # A stand-in rf-document, found first, so the bootstrap does not install the real one.
  $fakeRfd = Join-Path $work 'fake-rfd\rf-document.cmd'
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $fakeRfd) | Out-Null
  Set-Content -LiteralPath $fakeRfd -Value '@echo rf-document 0.0.0' -Encoding Ascii
  $env:RF_DOCUMENT = $fakeRfd

  $installDir = $env:RFW_HOME
  $marker = Join-Path $installDir '.rf-write-install'
  $cmdPath = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\rf-write.cmd'
  $shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\rf-write.lnk'

  function Invoke-Bootstrap([string[]]$Arguments) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bootstrap @Arguments | Out-Host
    return $LASTEXITCODE
  }

  function Assert-Installed {
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { Fail "marker missing: $marker" }
    if (-not (Test-Path -LiteralPath (Join-Path $installDir 'rf-write.exe') -PathType Leaf)) { Fail 'rf-write.exe missing' }
    if (-not (Test-Path -LiteralPath $cmdPath -PathType Leaf)) { Fail "command missing: $cmdPath" }
    if ((Get-Content -LiteralPath $cmdPath -Raw) -notmatch '%LOCALAPPDATA%\\rfw-home\\rf-write\.exe') { Fail 'launcher does not use %LOCALAPPDATA%' }
    if (-not (Test-Path -LiteralPath $shortcut -PathType Leaf)) { Fail "shortcut missing: $shortcut" }
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut).TargetPath
    if ($target -ne (Join-Path $installDir 'rf-write.exe')) { Fail "shortcut points to '$target'" }
    $out = (& $cmdPath --version | Out-String).Trim()
    if ($out -ne "rf-write $version") { Fail "--version printed '$out', expected 'rf-write $version'" }
    $leftovers = @(Get-ChildItem -LiteralPath (Split-Path -Parent $installDir) -Force | Where-Object { $_.Name -like '*.old' -or $_.Name -like '.*-new.*' })
    if ($leftovers.Count -gt 0) { Fail "leftover staging/.old folders: $($leftovers.Name -join ', ')" }
  }

  # 1. Conflicting options exit 2 and change nothing.
  $code = Invoke-Bootstrap @('-Pre', '-Version', '1.0.0')
  if ($code -ne 2) { Fail "-Pre -Version exited $code, expected 2" }
  if (Test-Path -LiteralPath $installDir) { Fail 'conflicting options created the install folder' }
  Pass 'conflicting options -> exit 2'

  # 2. Fresh install from the local archive.
  $env:RFW_ARCHIVE = $Archive
  $code = Invoke-Bootstrap @()
  if ($code -ne 0) { Fail "install exited $code" }
  Assert-Installed
  Pass "install: marker, launcher, shortcut, rf-write --version = $version"

  # 3. Update over the existing install, run as a script block like "irm | iex".
  $block = "& ([scriptblock]::Create((Get-Content -Raw -LiteralPath '$bootstrap')))"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $block | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail "update via script block exited $LASTEXITCODE" }
  Assert-Installed
  Pass 'update over existing install (script block)'

  # 4. A broken archive aborts before anything is replaced; the old install keeps working.
  $broken = Join-Path $work 'broken.zip'
  Set-Content -LiteralPath $broken -Value 'not an archive' -Encoding Ascii
  $env:RFW_ARCHIVE = $broken
  $code = Invoke-Bootstrap @()
  if ($code -eq 0) { Fail 'broken archive was accepted' }
  Assert-Installed
  Pass "broken archive -> exit $code, old install intact"
  Remove-Item Env:RFW_ARCHIVE

  # 5. Uninstall removes launcher, shortcut and install folder; rf-document stays.
  $code = Invoke-Bootstrap @('-Uninstall')
  if ($code -ne 0) { Fail "uninstall exited $code" }
  foreach ($path in @($installDir, $cmdPath, $shortcut)) {
    if (Test-Path -LiteralPath $path) { Fail "still there after uninstall: $path" }
  }
  if (-not (Test-Path -LiteralPath $fakeRfd)) { Fail 'rf-document was touched' }
  Pass 'uninstall removed everything'

  # 6. A folder without the marker is never deleted or overwritten.
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  $keep = Join-Path $installDir 'keep.txt'
  Set-Content -LiteralPath $keep -Value 'keep' -Encoding Ascii
  $code = Invoke-Bootstrap @('-Uninstall')
  if ($code -ne 1) { Fail "uninstall of unmarked folder exited $code, expected 1" }
  if (-not (Test-Path -LiteralPath $keep)) { Fail 'uninstall deleted an unmarked folder' }
  $env:RFW_ARCHIVE = $Archive
  $code = Invoke-Bootstrap @()
  Remove-Item Env:RFW_ARCHIVE
  if ($code -ne 1) { Fail "install over unmarked folder exited $code, expected 1" }
  if (-not (Test-Path -LiteralPath $keep)) { Fail 'install replaced an unmarked folder' }
  Pass 'unmarked folder: uninstall and install refuse (exit 1), folder intact'

  Write-Host 'All bootstrap checks passed.'
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
# The expected refusals above leave LASTEXITCODE at 1; the CI shell would report it.
exit 0
