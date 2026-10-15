<#
.SYNOPSIS
  End-to-end check of scripts\bootstrap.ps1 against a locally built archive (CI job "bootstrap").
.DESCRIPTION
  scripts\test-bootstrap.ps1 [-Archive dist\rf-write-<version>-win-x64.zip]

  Runs under Windows PowerShell 5.1 and starts the bootstrap as a separate
  powershell.exe process: as a file, and in the documented one-liner forms ("irm | iex"
  and the script block with -Uninstall), fed from the local file instead of irm.
  LOCALAPPDATA, APPDATA and RFW_HOME point into a temp folder, so the real profile,
  WindowsApps folder and Start menu are never touched. The download path runs against
  fake Invoke-RestMethod / Invoke-WebRequest functions (they shadow the cmdlets), so no
  network is needed.
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
  $oldDir = $installDir + '.old'
  $marker = Join-Path $installDir '.rf-write-install'
  $cmdPath = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\rf-write.cmd'
  $shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\rf-write.lnk'

  # --- Fake GitHub -----------------------------------------------------------
  $fake = Join-Path $work 'fake-gh'
  New-Item -ItemType Directory -Path $fake | Out-Null
  $env:FAKE_GH = $fake
  $fakeWeb = Join-Path $work 'fake-web.ps1'
  Set-Content -LiteralPath $fakeWeb -Encoding Ascii -Value @'
Add-Type -TypeDefinition @"
public class FakeHttpException : System.Exception {
  public FakeHttpException(string message) : base(message) {}
  public object Response { get; set; }
}
"@
function global:Get-FakeKey([string]$Uri) { Join-Path $env:FAKE_GH ($Uri -replace '[/:?=&]', '_') }
function global:Invoke-FakeFetch([string]$Uri) {
  $key = Get-FakeKey $Uri
  Add-Content -LiteralPath (Join-Path $env:FAKE_GH 'requests.log') -Value $Uri
  if (Test-Path -LiteralPath "$key.offline") {
    throw (New-Object System.Net.WebException 'Der Remotename konnte nicht aufgeloest werden: api.github.com')
  }
  $status = 200
  if (Test-Path -LiteralPath "$key.status") {
    $status = [int](Get-Content -LiteralPath "$key.status")
  } elseif (-not ((Test-Path -LiteralPath $key) -or (Test-Path -LiteralPath "$key.ref"))) {
    $status = 404
  }
  if ($status -ge 400) {
    $headers = @{}
    if (Test-Path -LiteralPath "$key.headers") {
      foreach ($line in Get-Content -LiteralPath "$key.headers") {
        $parts = $line -split ':\s*', 2
        if ($parts.Count -eq 2) { $headers[$parts[0]] = $parts[1] }
      }
    }
    $err = New-Object FakeHttpException "HTTP $status"
    $err.Response = [pscustomobject]@{ StatusCode = $status; Headers = $headers }
    throw $err
  }
  return $key
}
function global:Invoke-RestMethod {
  param([string]$Uri, $Headers, [switch]$UseBasicParsing)
  $key = Invoke-FakeFetch $Uri
  return (Get-Content -Raw -LiteralPath $key | ConvertFrom-Json)
}
function global:Invoke-WebRequest {
  param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing)
  $key = Invoke-FakeFetch $Uri
  if (Test-Path -LiteralPath "$key.ref") {
    Copy-Item -LiteralPath (Get-Content -LiteralPath "$key.ref") -Destination $OutFile
  } else {
    Copy-Item -LiteralPath $key -Destination $OutFile
  }
}
'@
  $api = 'https://api.github.com/repos/jcmx9/real-fast-write/releases'
  $download = 'https://github.com/jcmx9/real-fast-write/releases/download'
  function Get-FixturePath([string]$Uri) { Join-Path $fake ($Uri -replace '[/:?=&]', '_') }
  function New-ReleaseJson([string]$Tag, [string]$Prerelease, [string]$Draft) {
    $ver = $Tag.TrimStart('v')
    return ('{{"prerelease": {0}, "assets": [{{"name": "rf-write-{1}-win-x64.zip", "browser_download_url": "{2}/{3}/rf-write-{1}-win-x64.zip"}}, {{"name": "SHA256SUMS", "browser_download_url": "{2}/{3}/SHA256SUMS"}}], "draft": {4}, "tag_name": "{3}"}}' -f $Prerelease, $ver, $download, $Tag, $Draft)
  }
  function Publish-Assets([string]$Tag, [string]$Hash = '') {
    $ver = $Tag.TrimStart('v')
    $asset = "rf-write-$ver-win-x64.zip"
    Set-Content -LiteralPath ((Get-FixturePath "$download/$Tag/$asset") + '.ref') -Value $Archive -Encoding Ascii
    if (-not $Hash) { $Hash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() }
    Set-Content -LiteralPath (Get-FixturePath "$download/$Tag/SHA256SUMS") -Value "$Hash  $asset" -Encoding Ascii
  }

  # --- Runners ---------------------------------------------------------------
  function Invoke-Bootstrap([string[]]$Arguments) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bootstrap @Arguments | Out-Host
    return $LASTEXITCODE
  }
  # Same, but with the fake web functions loaded; the script still runs as a file.
  function Invoke-Online([string]$ArgumentText) {
    $command = ". '$fakeWeb'; & '$bootstrap' $ArgumentText; exit `$LASTEXITCODE"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $command | Out-Host
    return $LASTEXITCODE
  }
  function Assert-Code([int]$Actual, [int]$Expected, [string]$What) {
    if ($Actual -ne $Expected) { Fail "$What exited $Actual, expected $Expected" }
  }

  function Assert-Installed {
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { Fail "marker missing: $marker" }
    if (-not (Test-Path -LiteralPath (Join-Path $installDir 'rf-write.exe') -PathType Leaf)) { Fail 'rf-write.exe missing' }
    if (-not (Test-Path -LiteralPath $cmdPath -PathType Leaf)) { Fail "command missing: $cmdPath" }
    $launcher = Get-Content -LiteralPath $cmdPath -Raw
    if ($launcher -notmatch '%LOCALAPPDATA%\\rfw-home\\rf-write\.exe') { Fail 'launcher does not use %LOCALAPPDATA%' }
    if ($launcher -notmatch '\| more') { Fail 'launcher does not pipe --version/--help through more' }
    if (-not (Test-Path -LiteralPath $shortcut -PathType Leaf)) { Fail "shortcut missing: $shortcut" }
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut).TargetPath
    if ($target -ne (Join-Path $installDir 'rf-write.exe')) { Fail "shortcut points to '$target'" }
    $out = (& $cmdPath --version | Out-String).Trim()
    if ($out -ne "rf-write $version") { Fail "--version printed '$out', expected 'rf-write $version'" }
    $leftovers = @(Get-ChildItem -LiteralPath (Split-Path -Parent $installDir) -Force | Where-Object { $_.Name -like '*.old' -or $_.Name -like '.*-new.*' })
    if ($leftovers.Count -gt 0) { Fail "leftover staging/.old folders: $(($leftovers | ForEach-Object { $_.Name }) -join ', ')" }
  }

  # An install leftover (<install>.old) that the bootstrap must recognise as its own.
  function New-OwnedOld {
    New-Item -ItemType Directory -Force -Path $oldDir | Out-Null
    Set-Content -LiteralPath (Join-Path $oldDir '.rf-write-install') -Value 'real-fast-write' -Encoding Ascii
    Set-Content -LiteralPath (Join-Path $oldDir 'rf-write.exe') -Value 'stub' -Encoding Ascii
  }

  # 1. Usage errors exit 2 and change nothing.
  Assert-Code (Invoke-Bootstrap @('-Pre', '-Version', '26.10.0')) 2 '-Pre -Version'
  Assert-Code (Invoke-Bootstrap @('-Version', '1.2')) 2 '-Version 1.2'
  if (Test-Path -LiteralPath $installDir) { Fail 'usage errors created the install folder' }
  Pass 'usage errors (-Pre with -Version, bad -Version) -> exit 2'

  # 2. Fresh install from the local archive.
  $env:RFW_ARCHIVE = $Archive
  Assert-Code (Invoke-Bootstrap @()) 0 'install'
  Assert-Installed
  Pass "install: marker, launcher, shortcut, rf-write --version = $version"

  # 3. Update via a script block like "irm | iex", and with a trailing backslash on RFW_HOME.
  $block = "& ([scriptblock]::Create((Get-Content -Raw -LiteralPath '$bootstrap')))"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $block | Out-Host
  Assert-Code $LASTEXITCODE 0 'update via script block'
  Assert-Installed
  $env:RFW_HOME = $installDir + '\'
  Assert-Code (Invoke-Bootstrap @()) 0 'update with trailing backslash on RFW_HOME'
  $env:RFW_HOME = $installDir
  Assert-Installed
  Pass 'update over existing install (script block; RFW_HOME with trailing backslash)'

  # 3b. The documented "irm | iex" one-liner, fed from the local file: it updates, and an
  #     error throws instead of calling exit, so the user's window stays open.
  $iex = "Get-Content -Raw -LiteralPath '$bootstrap' | Invoke-Expression"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $iex | Out-Host
  Assert-Code $LASTEXITCODE 0 'update via irm | iex'
  Assert-Installed
  $env:RFW_ARCHIVE = Join-Path $work 'missing.zip'
  $probe = "try { Get-Content -Raw -LiteralPath '$bootstrap' | Invoke-Expression } catch { Write-Host ('caught: ' + `$_.Exception.Message) }; Write-Host 'host still running'; exit 0"
  $out = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $probe | Out-String)
  $env:RFW_ARCHIVE = $Archive
  if ($out -notmatch 'caught: ') { Fail "an error under irm | iex did not throw: $out" }
  if ($out -notmatch 'host still running') { Fail "the bootstrap under irm | iex ended the host: $out" }
  Assert-Installed
  Pass 'irm | iex: update works; an error throws and keeps the window open'

  # 4. A broken archive aborts before anything is replaced; the old install keeps working.
  $broken = Join-Path $work 'broken.zip'
  Set-Content -LiteralPath $broken -Value 'not an archive' -Encoding Ascii
  $env:RFW_ARCHIVE = $broken
  Assert-Code (Invoke-Bootstrap @()) 6 'broken archive'
  $env:RFW_ARCHIVE = $Archive
  Assert-Installed
  Pass 'broken archive -> exit 6, old install intact'

  # 5. Leftover .old: an own one is cleared on update, a foreign one stops the update.
  New-OwnedOld
  Assert-Code (Invoke-Bootstrap @()) 0 'update with own .old'
  Assert-Installed
  New-Item -ItemType Directory -Force -Path $oldDir | Out-Null
  Set-Content -LiteralPath (Join-Path $oldDir 'keep.txt') -Value 'keep' -Encoding Ascii
  Assert-Code (Invoke-Bootstrap @()) 1 'update with foreign .old'
  if (-not (Test-Path -LiteralPath (Join-Path $oldDir 'keep.txt'))) { Fail 'update deleted a foreign .old' }
  Remove-Item -LiteralPath $oldDir -Recurse -Force
  Assert-Installed
  Pass 'leftover .old: own one removed on update, foreign one -> exit 1 and kept'
  Remove-Item Env:RFW_ARCHIVE

  # 6. Download path against the fake GitHub.
  $latest = Get-FixturePath "$api/latest"
  Assert-Code (Invoke-Online '') 8 'no stable release'
  Set-Content -LiteralPath "$latest.offline" -Value '' -Encoding Ascii
  Assert-Code (Invoke-Online '') 4 'offline'
  Remove-Item -LiteralPath "$latest.offline"
  Set-Content -LiteralPath "$latest.status" -Value '403' -Encoding Ascii
  Set-Content -LiteralPath "$latest.headers" -Value @('X-RateLimit-Remaining: 0', 'X-RateLimit-Reset: 1700000000') -Encoding Ascii
  Assert-Code (Invoke-Online '') 10 'rate limit'
  Remove-Item -LiteralPath "$latest.status", "$latest.headers"
  Assert-Code (Invoke-Online '-Version 0.0.2') 9 'unknown version'
  Assert-Installed
  Pass 'API errors: no stable release -> 8, offline -> 4, rate limit -> 10, unknown version -> 9'

  Set-Content -LiteralPath $latest -Value (New-ReleaseJson "v$version" 'false' 'false') -Encoding Ascii
  Publish-Assets "v$version"
  Assert-Code (Invoke-Online '') 0 'download install'
  Assert-Installed
  $log = Get-Content -LiteralPath (Join-Path $fake 'requests.log')
  if ($log -notcontains "$api/latest") { Fail 'default channel did not ask /releases/latest' }
  if ($log -notcontains "$download/v$version/rf-write-$version-win-x64.zip") { Fail 'wrong asset downloaded' }
  Pass 'download: /releases/latest, checksum ok, installed'

  $list = '[' + ((New-ReleaseJson 'v98.0.0-dev.1' 'true' 'true'), (New-ReleaseJson 'v99.0.0' 'false' 'false'), (New-ReleaseJson "v$version" 'true' 'false') -join ', ') + ']'
  Set-Content -LiteralPath (Get-FixturePath ($api + '?per_page=50')) -Value $list -Encoding Ascii
  Publish-Assets 'v99.0.0'
  Remove-Item -LiteralPath (Join-Path $fake 'requests.log')
  Assert-Code (Invoke-Online '-Pre') 0 'download -Pre'
  Assert-Installed
  $log = Get-Content -LiteralPath (Join-Path $fake 'requests.log')
  if ($log -notcontains "$download/v$version/rf-write-$version-win-x64.zip") { Fail '-Pre picked the wrong release' }
  Pass '-Pre: newest published pre-release chosen (draft and stable skipped)'

  Set-Content -LiteralPath (Get-FixturePath "$api/tags/v0.0.1") -Value (New-ReleaseJson 'v0.0.1' 'false' 'false') -Encoding Ascii
  Publish-Assets 'v0.0.1' ('0' * 64)
  Assert-Code (Invoke-Online '-Version 0.0.1') 5 'bad checksum'
  Assert-Installed
  Pass '-Version with bad checksum -> exit 5, install intact'

  # 7. Uninstall while rf-write.exe is open: nothing is removed.
  $handle = [IO.File]::Open((Join-Path $installDir 'rf-write.exe'), 'Open', 'Read', 'Read')
  try {
    Assert-Code (Invoke-Bootstrap @('-Uninstall')) 12 'uninstall while running'
  } finally {
    $handle.Close()
  }
  Assert-Installed
  Pass 'uninstall while rf-write.exe is in use -> exit 12, nothing removed'

  # 8. Uninstall (script-block form with -Uninstall) removes launcher, shortcut, install
  #    folder and an own .old, never follows a junction out of the folder, and leaves
  #    rf-document alone.
  $outside = Join-Path $work 'outside'
  New-Item -ItemType Directory -Path $outside | Out-Null
  Set-Content -LiteralPath (Join-Path $outside 'precious.txt') -Value 'keep' -Encoding Ascii
  New-Item -ItemType Junction -Path (Join-Path $installDir 'link') -Target $outside | Out-Null
  New-OwnedOld
  # As the documented script-block one-liner with -Uninstall.
  $block = "& ([scriptblock]::Create((Get-Content -Raw -LiteralPath '$bootstrap'))) -Uninstall"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $block | Out-Host
  Assert-Code $LASTEXITCODE 0 'uninstall via script block'
  foreach ($path in @($installDir, $oldDir, $cmdPath, $shortcut)) {
    if (Test-Path -LiteralPath $path) { Fail "still there after uninstall: $path" }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $outside 'precious.txt'))) { Fail 'uninstall followed a junction' }
  if (-not (Test-Path -LiteralPath $fakeRfd)) { Fail 'rf-document was touched' }
  Pass 'uninstall removed everything (incl. own .old), junction target untouched'

  # 9. A folder without the marker, or with a marker but no rf-write.exe, is never deleted
  #    or overwritten.
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  $keep = Join-Path $installDir 'keep.txt'
  Set-Content -LiteralPath $keep -Value 'keep' -Encoding Ascii
  foreach ($case in @('no marker', 'marker without rf-write.exe')) {
    if ($case -eq 'marker without rf-write.exe') {
      Set-Content -LiteralPath $marker -Value 'real-fast-write' -Encoding Ascii
    }
    Assert-Code (Invoke-Bootstrap @('-Uninstall')) 1 "uninstall ($case)"
    if (-not (Test-Path -LiteralPath $keep)) { Fail "uninstall deleted a folder ($case)" }
    $env:RFW_ARCHIVE = $Archive
    $code = Invoke-Bootstrap @()
    Remove-Item Env:RFW_ARCHIVE
    Assert-Code $code 1 "install ($case)"
    if (-not (Test-Path -LiteralPath $keep)) { Fail "install replaced a folder ($case)" }
  }
  Pass 'foreign folder (no marker / marker without rf-write.exe): refuse (exit 1), folder intact'

  Write-Host 'All bootstrap checks passed.'
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
# The expected refusals above leave LASTEXITCODE non-zero; the CI shell would report it.
exit 0
