<#
.SYNOPSIS
  Ein-Zeiler-Bootstrap fuer rf-write (Windows).
.DESCRIPTION
  Installieren / Aktualisieren (neueste Version):
    irm https://raw.githubusercontent.com/jcmx9/real-fast-write/main/scripts/bootstrap.ps1 | iex
  Vorabversion testen (neueste Pre-Release):
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/jcmx9/real-fast-write/dev/scripts/bootstrap.ps1))) -Pre
  Bestimmte Version:   ... -Version 26.10.0
  Deinstallieren:      ... -Uninstall

  Laedt das passende Archiv der GitHub-Release, prueft es gegen SHA256SUMS und
  installiert ohne Adminrechte nach %LOCALAPPDATA%\real-fast-write, legt den Befehl
  %LOCALAPPDATA%\Microsoft\WindowsApps\rf-write.cmd und eine Startmenue-Verknuepfung
  an. Fehlt rf-document, wird dessen eigener Bootstrap ausgefuehrt.

  Umgebung (fuer Tests):
    RFW_ARCHIVE  lokales .zip statt Download (keine Pruefsumme)
    RFW_HOME     Installordner statt %LOCALAPPDATA%\real-fast-write

  Exit-Codes (bei Aufruf als Datei): 0 ok, 1 Sicherheitsabbruch (Ordner ohne Marker),
  2 falscher Aufruf, 4 Release/Download fehlgeschlagen, 5 Pruefsumme falsch,
  6 Installation fehlgeschlagen. Ueber "irm | iex" wird statt exit eine Ausnahme
  geworfen, damit das PowerShell-Fenster offen bleibt.
#>
# Windows PowerShell 5.1 compatible: no ??, no ternary, no -Parallel. ASCII only, because
# 5.1 reads BOM-less files and irm responses with a legacy code page.
[CmdletBinding()]
param(
  [switch]$Pre,
  [string]$Version = '',
  [switch]$Uninstall
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Invoke-WebRequest in 5.1 is many times slower with the progress bar.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$script:RfwFromFile = -not [string]::IsNullOrEmpty((Get-Variable -Name PSCommandPath -ValueOnly -ErrorAction SilentlyContinue))
$script:RfwCleanup = New-Object System.Collections.ArrayList

$RfwRepo       = 'jcmx9/real-fast-write'
$RfwApi        = "https://api.github.com/repos/$RfwRepo/releases"
$RfdBootstrap  = 'https://raw.githubusercontent.com/jcmx9/real-fast-document/main/scripts/bootstrap.ps1'
$MarkerName    = '.rf-write-install'
$LauncherTag   = 'rem rf-write launcher (real-fast-write bootstrap)'

$LocalAppData = $env:LOCALAPPDATA
if ($env:RFW_HOME) {
  $InstallDir = [IO.Path]::GetFullPath($env:RFW_HOME)
} else {
  $InstallDir = Join-Path $LocalAppData 'real-fast-write'
}
$Exe       = Join-Path $InstallDir 'rf-write.exe'
$WinApps   = Join-Path $LocalAppData 'Microsoft\WindowsApps'
$CmdPath   = Join-Path $WinApps 'rf-write.cmd'
$StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$Shortcut  = Join-Path $StartMenu 'rf-write.lnk'

function Write-Step([string]$Message) { Write-Host "-> $Message" }
function Write-Ok([string]$Message) { Write-Host "OK  $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "Warnung: $Message" -ForegroundColor Yellow }

function Remove-RfwTemp {
  foreach ($path in @($script:RfwCleanup)) {
    if ($path -and (Test-Path -LiteralPath $path)) {
      Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  $script:RfwCleanup.Clear()
}

# Stops with an exit code when run as a file (CI); under irm | iex, exit would close the
# user's PowerShell window, so it throws instead.
function Stop-Rfw([int]$Code, [string]$Message) {
  Write-Host "Error: $Message" -ForegroundColor Red
  Remove-RfwTemp
  if ($script:RfwFromFile) { exit $Code }
  throw "rf-write-Bootstrap abgebrochen (Code $Code)."
}

function Stop-Foreign([string]$Path) {
  Write-Host "Error: $Path existiert, traegt aber keinen rf-write-Installationsmarker ($MarkerName)." -ForegroundColor Red
  Write-Host 'Gefunden:'
  Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue | Format-Table Mode, LastWriteTime, Length, Name -AutoSize | Out-String | Write-Host
  Stop-Rfw 1 'Abbruch - der Ordner wird nicht angetastet. Bitte selbst pruefen und ggf. entfernen.'
}

function Test-RfwMarker([string]$Dir) {
  return (Test-Path -LiteralPath (Join-Path $Dir $MarkerName) -PathType Leaf)
}

function Test-OwnLauncher {
  if (-not (Test-Path -LiteralPath $CmdPath -PathType Leaf)) { return $false }
  return ((Get-Content -LiteralPath $CmdPath -Raw) -match [regex]::Escape($LauncherTag))
}

function Get-ShortcutTarget([string]$Path) {
  $shell = New-Object -ComObject WScript.Shell
  return $shell.CreateShortcut($Path).TargetPath
}

function Test-OwnShortcut {
  if (-not (Test-Path -LiteralPath $Shortcut -PathType Leaf)) { return $false }
  return ((Get-ShortcutTarget $Shortcut) -eq $Exe)
}

# --- Release lookup ---------------------------------------------------------
# One unauthenticated API call (limit 60/h): /releases/latest never returns a
# pre-release; -Pre scans the newest 20 releases; -Version asks for the exact tag.

function Get-RfwRelease {
  $headers = @{ Accept = 'application/vnd.github+json' }
  $release = $null
  try {
    if ($Version) {
      $release = Invoke-RestMethod -Uri "$RfwApi/tags/v$Version" -Headers $headers -UseBasicParsing
    } elseif ($Pre) {
      # Assign first: 5.1 would pipe a JSON array as one object.
      $list = Invoke-RestMethod -Uri ($RfwApi + '?per_page=20') -Headers $headers -UseBasicParsing
      foreach ($candidate in $list) {
        if ($candidate.prerelease -and -not $candidate.draft) { $release = $candidate; break }
      }
    } else {
      $release = Invoke-RestMethod -Uri "$RfwApi/latest" -Headers $headers -UseBasicParsing
    }
  } catch {
    Stop-Rfw 4 "GitHub-API nicht erreichbar (offline, Version unbekannt oder Abfragelimit 60/h erreicht?): $($_.Exception.Message)"
  }
  if (-not $release) { Stop-Rfw 4 'Keine Vorabversion (Pre-Release) gefunden.' }
  return $release
}

function Get-RfwDownload([string]$TempDir) {
  $release = Get-RfwRelease
  $tag = [string]$release.tag_name
  $ver = $tag.TrimStart('v')
  $assetName = "rf-write-$ver-win-x64.zip"
  $asset = @($release.assets | Where-Object { $_.name -eq $assetName }) | Select-Object -First 1
  $sums = @($release.assets | Where-Object { $_.name -eq 'SHA256SUMS' }) | Select-Object -First 1
  if (-not $asset) { Stop-Rfw 4 "Release $tag enthaelt kein $assetName." }
  if (-not $sums) { Stop-Rfw 4 "Release $tag enthaelt keine SHA256SUMS." }

  $zip = Join-Path $TempDir $assetName
  $sumsFile = Join-Path $TempDir 'SHA256SUMS'
  Write-Step "Lade rf-write $ver ($assetName)"
  try {
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
    Invoke-WebRequest -Uri $sums.browser_download_url -OutFile $sumsFile -UseBasicParsing
  } catch {
    Stop-Rfw 4 "Download fehlgeschlagen: $($_.Exception.Message)"
  }

  $expected = $null
  foreach ($line in (Get-Content -LiteralPath $sumsFile)) {
    $parts = $line.Trim() -split '\s+', 2
    if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $assetName) {
      $expected = $parts[0].ToLowerInvariant()
      break
    }
  }
  if (-not $expected) { Stop-Rfw 5 "SHA256SUMS enthaelt keinen Eintrag fuer $assetName." }
  $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    Stop-Rfw 5 "Pruefsumme falsch fuer $assetName (erwartet $expected, erhalten $actual) - nichts wurde veraendert."
  }
  Write-Ok 'Pruefsumme stimmt'
  return $zip
}

# --- Install ----------------------------------------------------------------

# Extracts into a staging folder next to the target (same volume, so the swap is a
# rename) and smoke-tests the new exe; returns the folder that becomes $InstallDir.
function New-RfwStage([string]$Zip) {
  $parent = Split-Path -Parent $InstallDir
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $stage = Join-Path $parent ('.' + (Split-Path -Leaf $InstallDir) + '-new.' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  [void]$script:RfwCleanup.Add($stage)
  try {
    Expand-Archive -LiteralPath $Zip -DestinationPath $stage -Force
  } catch {
    Stop-Rfw 6 "Archiv laesst sich nicht entpacken: $Zip ($($_.Exception.Message))"
  }
  # electron-builder's win zip has the files at the top level; accept one wrapping folder too.
  $root = $stage
  if (-not (Test-Path -LiteralPath (Join-Path $root 'rf-write.exe') -PathType Leaf)) {
    $subs = @(Get-ChildItem -LiteralPath $stage -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'rf-write.exe') -PathType Leaf })
    if ($subs.Count -ne 1) { Stop-Rfw 6 "Archiv enthaelt kein rf-write.exe: $Zip" }
    $root = $subs[0].FullName
  }
  Get-ChildItem -LiteralPath $root -Recurse -File | Unblock-File
  Set-Content -LiteralPath (Join-Path $root $MarkerName) -Value 'real-fast-write' -Encoding Ascii

  $out = ''
  try {
    $out = (& (Join-Path $root 'rf-write.exe') --version | Out-String).Trim()
  } catch {
    $out = ''
  }
  if ($out -notlike 'rf-write *') { Stop-Rfw 6 'Das neue rf-write startet nicht - die bisherige Installation bleibt.' }
  Write-Step "Neue Version: $out"
  return $root
}

# Old -> .old, new -> target, delete .old; on failure the old install is restored.
function Install-RfwStage([string]$Root) {
  $old = $InstallDir + '.old'
  if (Test-Path -LiteralPath $old) {
    if (Test-RfwMarker $old) {
      Remove-Item -LiteralPath $old -Recurse -Force
    } else {
      Stop-Foreign $old
    }
  }
  $hadOld = $false
  if (Test-Path -LiteralPath $InstallDir) {
    try {
      Move-Item -LiteralPath $InstallDir -Destination $old
    } catch {
      Stop-Rfw 6 "Konnte $InstallDir nicht ersetzen - laeuft rf-write noch? Bitte schliessen und erneut versuchen."
    }
    $hadOld = $true
  }
  try {
    Move-Item -LiteralPath $Root -Destination $InstallDir
  } catch {
    if ($hadOld) { Move-Item -LiteralPath $old -Destination $InstallDir }
    Stop-Rfw 6 'Installation fehlgeschlagen - die bisherige Version wurde wiederhergestellt.'
  }
  if ($hadOld) { Remove-Item -LiteralPath $old -Recurse -Force }
  Remove-RfwTemp
}

function Write-RfwLauncher {
  New-Item -ItemType Directory -Force -Path $WinApps | Out-Null
  if ((Test-Path -LiteralPath $CmdPath) -and -not (Test-OwnLauncher)) {
    Stop-Rfw 1 "$CmdPath existiert und stammt nicht von rf-write - bitte selbst entfernen."
  }
  # %LOCALAPPDATA% keeps the file ASCII even when the user name has umlauts.
  $exeRef = $Exe
  if ($Exe.StartsWith($LocalAppData + '\', [StringComparison]::OrdinalIgnoreCase)) {
    $exeRef = '%LOCALAPPDATA%' + $Exe.Substring($LocalAppData.Length)
  }
  # --version/--help print to the console; anything else starts the app without blocking
  # the console. start keeps the caller's working directory, so relative paths work, and a
  # running instance receives them already resolved (single instance).
  $lines = @(
    '@echo off',
    $LauncherTag,
    'setlocal',
    "set `"RFW_EXE=$exeRef`"",
    'if "%~1"=="--version" goto direct',
    'if "%~1"=="-V" goto direct',
    'if "%~1"=="--help" goto direct',
    'if "%~1"=="-h" goto direct',
    'start "" "%RFW_EXE%" %*',
    'exit /b 0',
    ':direct',
    '"%RFW_EXE%" %*',
    'exit /b %ERRORLEVEL%'
  )
  # cmd.exe reads batch files in the OEM code page.
  $encoding = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
  [IO.File]::WriteAllText($CmdPath, (($lines -join "`r`n") + "`r`n"), $encoding)
}

function Write-RfwShortcut {
  New-Item -ItemType Directory -Force -Path $StartMenu | Out-Null
  if ((Test-Path -LiteralPath $Shortcut) -and -not (Test-OwnShortcut)) {
    Write-Warn "$Shortcut zeigt nicht auf rf-write - Startmenue-Eintrag nicht angelegt."
    return
  }
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($Shortcut)
  $link.TargetPath = $Exe
  $link.WorkingDirectory = $env:USERPROFILE
  $link.Description = 'Markdown-Editor fuer real-fast-document'
  $link.Save()
}

function Test-RfwPath {
  $dirs = @($env:Path -split ';' | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') })
  if ($dirs -notcontains $WinApps.TrimEnd('\')) {
    Write-Warn "$WinApps ist nicht im PATH - der Befehl rf-write wird so nicht gefunden."
    Write-Host '  In "Umgebungsvariablen fuer dieses Konto bearbeiten" bei Path ergaenzen:'
    Write-Host "  $WinApps"
  }
}

# Same order as the app (src/main/locate.ts): RF_DOCUMENT, WindowsApps\rf-document.cmd, PATH.
function Find-RfDocument {
  $candidates = @()
  if ($env:RF_DOCUMENT) { $candidates += $env:RF_DOCUMENT }
  $candidates += (Join-Path $WinApps 'rf-document.cmd')
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  $command = Get-Command -Name 'rf-document.cmd', 'rf-document.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { return $command.Path }
  return $null
}

function Initialize-RfDocument {
  $found = Find-RfDocument
  if ($found) {
    Write-Ok "rf-document gefunden: $found"
    return
  }
  Write-Step "rf-document fehlt - starte dessen Bootstrap ($RfdBootstrap)"
  # Separate process: its errors (or exit) must not end this script.
  $command = "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; irm $RfdBootstrap | iex"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $command
  if ($LASTEXITCODE -eq 0) {
    Write-Ok 'rf-document installiert'
  } else {
    Write-Warn 'rf-document konnte nicht installiert werden. rf-write laeuft trotzdem; fuer den PDF-Export spaeter nachholen:'
    Write-Host "  irm $RfdBootstrap | iex"
  }
}

function Install-Rfw {
  if ((Test-Path -LiteralPath $InstallDir) -and -not (Test-RfwMarker $InstallDir)) {
    Stop-Foreign $InstallDir
  }
  $tempDir = Join-Path ([IO.Path]::GetTempPath()) ('rf-write-bootstrap-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempDir | Out-Null
  [void]$script:RfwCleanup.Add($tempDir)

  if ($env:RFW_ARCHIVE) {
    if (-not (Test-Path -LiteralPath $env:RFW_ARCHIVE -PathType Leaf)) { Stop-Rfw 2 "RFW_ARCHIVE nicht gefunden: $env:RFW_ARCHIVE" }
    $zip = $env:RFW_ARCHIVE
    Write-Step "Installiere aus lokalem Archiv $zip (ohne Pruefsumme)"
  } else {
    $zip = Get-RfwDownload $tempDir
  }

  if (Test-RfwMarker $InstallDir) {
    Write-Step "Aktualisiere $InstallDir"
  } else {
    Write-Step "Installiere nach $InstallDir"
  }
  $root = New-RfwStage $zip
  Install-RfwStage $root
  Write-RfwLauncher
  Write-RfwShortcut
  Write-Ok "rf-write installiert: $InstallDir"
  Write-Ok "Befehl: $CmdPath"
  Test-RfwPath
  Initialize-RfDocument
  Write-Host 'Fertig. Start: rf-write [notiz.md] oder Startmenue -> rf-write'
}

# --- Uninstall --------------------------------------------------------------

function Remove-RfwEntries {
  if (Test-OwnLauncher) {
    Remove-Item -LiteralPath $CmdPath -Force
    Write-Step "Befehl entfernt: $CmdPath"
  } elseif (Test-Path -LiteralPath $CmdPath) {
    Write-Warn "$CmdPath stammt nicht von rf-write - bleibt."
  }
  if (Test-OwnShortcut) {
    Remove-Item -LiteralPath $Shortcut -Force
    Write-Step "Startmenue-Eintrag entfernt: $Shortcut"
  } elseif (Test-Path -LiteralPath $Shortcut) {
    Write-Warn "$Shortcut zeigt nicht auf rf-write - bleibt."
  }
}

function Uninstall-Rfw {
  if (-not (Test-Path -LiteralPath $InstallDir)) {
    Write-Host "Nichts zu deinstallieren: $InstallDir existiert nicht."
    Remove-RfwEntries
    return
  }
  if (-not (Test-RfwMarker $InstallDir)) { Stop-Foreign $InstallDir }
  Remove-RfwEntries
  Write-Step "Loesche $InstallDir"
  try {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force
  } catch {
    Stop-Rfw 6 "Konnte $InstallDir nicht loeschen - laeuft rf-write noch? ($($_.Exception.Message))"
  }
  Write-Ok 'rf-write deinstalliert. rf-document, Einstellungen und Notizen bleiben unangetastet.'
}

# --- Main -------------------------------------------------------------------

function Invoke-RfwBootstrap {
  if ($Pre -and $Version) { Stop-Rfw 2 '-Pre und -Version schliessen sich aus.' }
  if ($Uninstall) {
    Uninstall-Rfw
    return
  }
  try {
    Install-Rfw
  } finally {
    Remove-RfwTemp
  }
}

$Version = $Version.TrimStart('v')
Invoke-RfwBootstrap
# As a file, report success explicitly (a native command's exit code must not leak);
# under irm | iex, exit would close the window.
if ($script:RfwFromFile) { exit 0 }
