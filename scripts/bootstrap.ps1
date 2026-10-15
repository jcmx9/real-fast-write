<#
.SYNOPSIS
  Ein-Zeiler-Bootstrap fuer rf-write (Windows).
.DESCRIPTION
  Installieren / Aktualisieren (neueste stabile Version):
    irm https://raw.githubusercontent.com/jcmx9/real-fast-write/main/scripts/bootstrap.ps1 | iex
  Vorabversion testen (neueste Pre-Release; kann aelter sein als die neueste stabile):
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/jcmx9/real-fast-write/dev/scripts/bootstrap.ps1))) -Pre
  Bestimmte Version:   ... -Version 26.10.0   (oder 26.10.0-dev.1)
  Deinstallieren:      ... -Uninstall

  Laedt das passende Archiv der GitHub-Release, prueft es gegen SHA256SUMS und
  installiert ohne Adminrechte nach %LOCALAPPDATA%\real-fast-write, legt den Befehl
  %LOCALAPPDATA%\Microsoft\WindowsApps\rf-write.cmd und eine Startmenue-Verknuepfung
  an. Fehlt rf-document, wird dessen eigener Bootstrap ausgefuehrt.

  Umgebung (fuer Tests):
    RFW_ARCHIVE  lokales .zip statt Download (keine Pruefsumme)
    RFW_HOME     Installordner statt %LOCALAPPDATA%\real-fast-write

  Exit-Codes (bei Aufruf als Datei):
    0 ok, 1 Sicherheitsabbruch (keine rf-write-Installation), 2 falscher Aufruf,
    4 offline / Download-Fehler, 5 Pruefsumme falsch,
    6 Installation fehlgeschlagen (alte Version unveraendert),
    7 Wiederherstellung fehlgeschlagen - manuell noetig (Pfad wird ausgegeben),
    8 keine passende Release (noch keine stabile, keine Vorabversion, Datei fehlt),
    9 Version gibt es nicht, 10 GitHub-Abfragelimit erreicht,
    11 unerwarteter Fehler, 12 rf-write laeuft noch (nichts veraendert).
  Ueber "irm | iex" wird statt exit eine Ausnahme geworfen, damit das Fenster offen bleibt.
#>
# Windows PowerShell 5.1 compatible: no ??, no ternary, no -Parallel. ASCII only, because
# 5.1 reads BOM-less files and irm responses with a legacy code page.
[CmdletBinding()]
param(
  [switch]$Pre,
  [string]$Version = '',
  [switch]$Uninstall
)

# Everything runs in a child scope: StrictMode, preferences and helper functions stay
# inside it, so "irm | iex" leaves the user's session as it was. TLS is process-wide and
# is restored afterwards.
$RfwSavedTls = [Net.ServicePointManager]::SecurityProtocol
try {
  & {
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
    # Invoke-WebRequest in 5.1 is many times slower with the progress bar.
    $ProgressPreference = 'SilentlyContinue'
    [Net.ServicePointManager]::SecurityProtocol = $RfwSavedTls -bor [Net.SecurityProtocolType]::Tls12

    $RfwFromFile = -not [string]::IsNullOrEmpty((Get-Variable -Name PSCommandPath -ValueOnly -ErrorAction SilentlyContinue))
    $RfwCleanup = New-Object System.Collections.ArrayList
    $RfwStopMessage = 'rf-write-Bootstrap abgebrochen'

    $RfwRepo      = 'jcmx9/real-fast-write'
    $RfwApi       = "https://api.github.com/repos/$RfwRepo/releases"
    $RfdBootstrap = 'https://raw.githubusercontent.com/jcmx9/real-fast-document/main/scripts/bootstrap.ps1'
    $MarkerName   = '.rf-write-install'
    $LauncherTag  = 'rem rf-write launcher (real-fast-write bootstrap)'
    $VersionRegex = '^[0-9]+\.[0-9]+\.[0-9]+(-dev\.[0-9]+)?$'

    $LocalAppData = $env:LOCALAPPDATA
    if ($env:RFW_HOME) {
      $InstallDir = [IO.Path]::GetFullPath($env:RFW_HOME.TrimEnd('\', '/'))
    } else {
      $InstallDir = Join-Path $LocalAppData 'real-fast-write'
    }
    # A unique name per run: the rename of the live folder is the first action and needs
    # no cleanup before it; leftovers (<leaf>.old, <leaf>.old-*) are cleared afterwards.
    $OldDir    = $InstallDir + '.old-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $Exe       = Join-Path $InstallDir 'rf-write.exe'
    $WinApps   = Join-Path $LocalAppData 'Microsoft\WindowsApps'
    $CmdPath   = Join-Path $WinApps 'rf-write.cmd'
    $StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $Shortcut  = Join-Path $StartMenu 'rf-write.lnk'
    $WantVersion = $Version.TrimStart('v')

    function Write-Step([string]$Message) { Write-Host "-> $Message" }
    function Write-Ok([string]$Message) { Write-Host "OK  $Message" -ForegroundColor Green }
    function Write-Warn([string]$Message) { Write-Host "Warnung: $Message" -ForegroundColor Yellow }

    # --- Removal without following links ---------------------------------------

    # Deletes a tree; junctions and symlinks are removed as links, never followed, so
    # nothing outside the folder can be hit.
    function Remove-RfwTree([string]$Path) {
      $item = Get-Item -LiteralPath $Path -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        if ($item.PSIsContainer) { [IO.Directory]::Delete($item.FullName, $false) } else { $item.Delete() }
        return
      }
      if ($item.PSIsContainer) {
        foreach ($child in @(Get-ChildItem -LiteralPath $item.FullName -Force)) { Remove-RfwTree $child.FullName }
        $item.Attributes = [IO.FileAttributes]::Directory
        [IO.Directory]::Delete($item.FullName, $false)
      } else {
        $item.Attributes = [IO.FileAttributes]::Normal
        $item.Delete()
      }
    }

    function Remove-RfwTemp {
      foreach ($path in @($RfwCleanup)) {
        if ($path -and (Test-Path -LiteralPath $path)) {
          try { Remove-RfwTree $path } catch { Write-Warn "Temporaerer Ordner bleibt: $path" }
        }
      }
      $RfwCleanup.Clear()
    }

    # Stops with an exit code when run as a file (CI); under irm | iex, exit would close
    # the user's PowerShell window, so it throws instead.
    function Stop-Rfw([int]$Code, [string]$Message) {
      Write-Host "Error: $Message" -ForegroundColor Red
      Remove-RfwTemp
      if ($RfwFromFile) { exit $Code }
      throw "$RfwStopMessage (Code $Code)."
    }

    function Stop-Foreign([string]$Path) {
      Write-Host "Error: $Path existiert, ist aber keine rf-write-Installation dieses Skripts ($MarkerName oder rf-write.exe fehlt)." -ForegroundColor Red
      Write-Host 'Gefunden:'
      Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue | Format-Table Mode, LastWriteTime, Length, Name -AutoSize | Out-String | Write-Host
      Stop-Rfw 1 'Abbruch - der Ordner wird nicht angetastet. Bitte selbst pruefen und ggf. entfernen.'
    }

    # Ours = marker AND rf-write.exe in the folder.
    function Test-RfwOwned([string]$Dir) {
      return ((Test-Path -LiteralPath (Join-Path $Dir $MarkerName) -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $Dir 'rf-write.exe') -PathType Leaf))
    }

    # Renames a folder with [IO.Directory]::Move: a pure rename that fails as a whole.
    # (Move-Item falls back to copy-and-delete for a folder whose rename fails, which
    # half-moved a running install.) Retries because Defender, the indexer or exiting
    # child processes can hold handles for a moment.
    function Move-RfwDir([string]$From, [string]$To) {
      for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
          [IO.Directory]::Move($From, $To)
          return $true
        } catch {
          if ($attempt -lt 5) { Start-Sleep -Milliseconds (300 * $attempt) }
        }
      }
      return $false
    }

    function Test-OwnLauncher {
      if (-not (Test-Path -LiteralPath $CmdPath -PathType Leaf)) { return $false }
      return ((Get-Content -LiteralPath $CmdPath -Raw) -match [regex]::Escape($LauncherTag))
    }

    function Test-OwnShortcut {
      if (-not (Test-Path -LiteralPath $Shortcut -PathType Leaf)) { return $false }
      try {
        $shell = New-Object -ComObject WScript.Shell
        return ($shell.CreateShortcut($Shortcut).TargetPath -eq $Exe)
      } catch {
        return $false
      }
    }

    # --- Release lookup -------------------------------------------------------
    # One unauthenticated API call (limit 60/h): /releases/latest never returns a
    # pre-release; -Pre scans the newest 50 releases; -Version asks for the exact tag.

    function Get-HttpStatus($ErrorRecord) {
      $response = $null
      try { $response = $ErrorRecord.Exception.Response } catch { $response = $null }
      if ($null -eq $response) { return 0 }
      try { return [int]$response.StatusCode } catch { return 0 }
    }

    function Get-HttpHeader($ErrorRecord, [string]$Name) {
      $headers = $null
      try { $headers = $ErrorRecord.Exception.Response.Headers } catch { return '' }
      if ($null -eq $headers) { return '' }
      try {
        $value = $headers[$Name]
        if ($value) { return [string]$value }
      } catch { $value = $null }
      try { return [string](@($headers.GetValues($Name))[0]) } catch { return '' }
    }

    function Invoke-RfwApi([string]$Uri, [string]$What) {
      $headers = @{ Accept = 'application/vnd.github+json' }
      try {
        return Invoke-RestMethod -Uri $Uri -Headers $headers -UseBasicParsing
      } catch {
        $status = Get-HttpStatus $_
        $detail = $_.Exception.Message
        if ($status -eq 0) { Stop-Rfw 4 "Keine Verbindung zu GitHub (offline?): $detail" }
        if ($status -eq 404) {
          if ($What -eq 'latest') { Stop-Rfw 8 'Noch keine stabile Version veroeffentlicht - mit -Pre die Testversion installieren.' }
          if ($What -eq 'tag') { Stop-Rfw 9 "Version $WantVersion gibt es nicht (keine Release v$WantVersion)." }
          Stop-Rfw 4 "GitHub-API antwortet mit 404: $Uri"
        }
        if ($status -eq 429 -or ($status -eq 403 -and (Get-HttpHeader $_ 'X-RateLimit-Remaining') -eq '0')) {
          $reset = Get-HttpHeader $_ 'X-RateLimit-Reset'
          if ($reset -match '^[0-9]+$') {
            $at = [DateTimeOffset]::FromUnixTimeSeconds([long]$reset).LocalDateTime.ToString('HH:mm')
            Stop-Rfw 10 "GitHub-Abfragelimit (60 pro Stunde) erreicht - wieder moeglich ab $at Uhr."
          }
          Stop-Rfw 10 'GitHub-Abfragelimit (60 pro Stunde) erreicht - bitte spaeter erneut versuchen.'
        }
        Stop-Rfw 4 "GitHub-API antwortet mit HTTP ${status}: $detail"
      }
    }

    function Get-RfwRelease {
      if ($WantVersion) {
        $release = Invoke-RfwApi "$RfwApi/tags/v$WantVersion" 'tag'
      } elseif ($Pre) {
        # Assign first: 5.1 would pipe a JSON array as one object.
        $list = Invoke-RfwApi ($RfwApi + '?per_page=50') 'list'
        $release = $null
        foreach ($candidate in @($list)) {
          if ($candidate.prerelease -and -not $candidate.draft) { $release = $candidate; break }
        }
        if (-not $release) { Stop-Rfw 8 'Keine Vorabversion (Pre-Release) unter den letzten 50 Releases gefunden.' }
      } else {
        $release = Invoke-RfwApi "$RfwApi/latest" 'latest'
      }
      return $release
    }

    function Get-RfwDownload([string]$TempDir) {
      $release = Get-RfwRelease
      $tag = [string]$release.tag_name
      if (-not $tag) { Stop-Rfw 4 'Unerwartete Antwort der GitHub-API (kein tag_name).' }
      $ver = $tag.TrimStart('v')
      $assetName = "rf-write-$ver-win-x64.zip"
      $asset = @($release.assets | Where-Object { $_.name -eq $assetName }) | Select-Object -First 1
      $sums = @($release.assets | Where-Object { $_.name -eq 'SHA256SUMS' }) | Select-Object -First 1
      if (-not $asset) { Stop-Rfw 8 "Release $tag enthaelt kein $assetName." }
      if (-not $sums) { Stop-Rfw 8 "Release $tag enthaelt keine SHA256SUMS." }

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

    # --- Install --------------------------------------------------------------

    # Extracts into a staging folder next to the target (same volume, so the swap is a
    # rename) and smoke-tests the new exe; returns the folder that becomes $InstallDir.
    function New-RfwStage([string]$Zip) {
      $parent = Split-Path -Parent $InstallDir
      New-Item -ItemType Directory -Force -Path $parent | Out-Null
      $stage = Join-Path $parent ('.' + (Split-Path -Leaf $InstallDir) + '-new.' + [guid]::NewGuid().ToString('N').Substring(0, 8))
      [void]$RfwCleanup.Add($stage)
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
      # The marker travels with the folder, so it is in place before the swap.
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

    # Clears leftovers of interrupted runs (<leaf>.old, <leaf>.old-*) after the main work.
    # Only ours may go; anything else stays with a warning. Never fatal.
    function Remove-RfwOld {
      $parent = Split-Path -Parent $InstallDir
      $leaf = Split-Path -Leaf $InstallDir
      if (-not (Test-Path -LiteralPath $parent)) { return }
      $leftovers = @(Get-ChildItem -LiteralPath $parent -Directory -Force | Where-Object { $_.Name -eq "$leaf.old" -or $_.Name -like "$leaf.old-*" })
      foreach ($dir in $leftovers) {
        if (Test-RfwOwned $dir.FullName) {
          try {
            Remove-RfwTree $dir.FullName
            Write-Step "Rest eines frueheren Laufs entfernt: $($dir.FullName)"
          } catch {
            Write-Warn "Rest eines frueheren Laufs bleibt (in Benutzung?): $($dir.FullName)"
          }
        } else {
          Write-Warn "$($dir.FullName) ist keine rf-write-Installation dieses Skripts - bleibt."
        }
      }
    }

    function Stop-RfwRecovery {
      Write-Host 'Error: Installation und Wiederherstellung fehlgeschlagen.' -ForegroundColor Red
      Write-Host "  Die bisherige Version liegt unveraendert in: $OldDir"
      Write-Host '  Zurueckholen mit:'
      Write-Host ("    Rename-Item -LiteralPath '{0}' -NewName '{1}'" -f ($OldDir -replace "'", "''"), ((Split-Path -Leaf $InstallDir) -replace "'", "''"))
      Stop-Rfw 7 'Bitte die bisherige Version wie oben beschrieben zurueckholen.'
    }

    # Old -> .old-<id> (first action: fails as a whole while rf-write runs), new -> target,
    # delete the old one; on failure the old install is restored.
    function Install-RfwStage([string]$Root) {
      $hadOld = $false
      if (Test-Path -LiteralPath $InstallDir) {
        if (-not (Move-RfwDir $InstallDir $OldDir)) {
          Stop-Rfw 12 "Konnte $InstallDir nicht ersetzen - rf-write laeuft noch? Bitte beenden und erneut versuchen. Es wurde nichts veraendert."
        }
        $hadOld = $true
      }
      if (-not (Move-RfwDir $Root $InstallDir)) {
        if ($hadOld) {
          if (-not (Move-RfwDir $OldDir $InstallDir)) { Stop-RfwRecovery }
          Stop-Rfw 6 'Installation fehlgeschlagen - die bisherige Version wurde wiederhergestellt.'
        }
        Stop-Rfw 6 'Installation fehlgeschlagen.'
      }
      if ($hadOld) {
        try { Remove-RfwTree $OldDir } catch { Write-Warn "Alte Version konnte nicht geloescht werden: $OldDir" }
      }
      Remove-RfwOld
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
      # --version/--help: rf-write.exe is a GUI-subsystem program, whose output reaches a
      # pipe but not an interactive console, so it is piped through more. Anything else
      # starts the app without blocking the console; start keeps the caller's working
      # directory, so relative paths work, and a running instance receives them resolved.
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
        '"%RFW_EXE%" %* 2>&1 | more',
        'exit /b 0'
      )
      # cmd.exe reads batch files in the OEM code page.
      $encoding = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
      [IO.File]::WriteAllText($CmdPath, (($lines -join "`r`n") + "`r`n"), $encoding)
    }

    # The install is complete at this point, so a failure here is only a warning.
    function Write-RfwShortcut {
      try {
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
      } catch {
        Write-Warn "Startmenue-Eintrag konnte nicht angelegt werden ($($_.Exception.Message)). rf-write ist trotzdem installiert."
      }
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
      if ((Test-Path -LiteralPath $InstallDir) -and -not (Test-RfwOwned $InstallDir)) {
        Stop-Foreign $InstallDir
      }
      $tempDir = Join-Path ([IO.Path]::GetTempPath()) ('rf-write-bootstrap-' + [guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path $tempDir | Out-Null
      [void]$RfwCleanup.Add($tempDir)

      if ($env:RFW_ARCHIVE) {
        if (-not (Test-Path -LiteralPath $env:RFW_ARCHIVE -PathType Leaf)) { Stop-Rfw 2 "RFW_ARCHIVE nicht gefunden: $env:RFW_ARCHIVE" }
        $zip = $env:RFW_ARCHIVE
        Write-Step "Installiere aus lokalem Archiv $zip (ohne Pruefsumme)"
      } else {
        $zip = Get-RfwDownload $tempDir
      }

      if (Test-Path -LiteralPath $InstallDir) {
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

    # --- Uninstall ------------------------------------------------------------

    function Remove-RfwEntry {
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
        Remove-RfwOld
        Remove-RfwEntry
        return
      }
      if (-not (Test-RfwOwned $InstallDir)) { Stop-Foreign $InstallDir }
      # Rename first, before anything else is touched: it fails as a whole while rf-write
      # has files open, so a refusal changes nothing. Leftovers, launcher and shortcut go
      # only after the folder is gone.
      if (-not (Move-RfwDir $InstallDir $OldDir)) {
        Stop-Rfw 12 'rf-write laeuft noch - bitte beenden und erneut versuchen. Es wurde nichts entfernt.'
      }
      Write-Step "Loesche $InstallDir"
      try {
        Remove-RfwTree $OldDir
      } catch {
        Stop-Rfw 6 "Konnte $OldDir nicht vollstaendig loeschen ($($_.Exception.Message)). Bitte von Hand entfernen."
      }
      Remove-RfwOld
      Remove-RfwEntry
      Write-Ok 'rf-write deinstalliert. rf-document, Einstellungen und Notizen bleiben unangetastet.'
    }

    # --- Main -----------------------------------------------------------------

    try {
      if ($Pre -and $WantVersion) { Stop-Rfw 2 '-Pre und -Version schliessen sich aus.' }
      if ($WantVersion -and $WantVersion -notmatch $VersionRegex) {
        Stop-Rfw 2 "Ungueltige Version $WantVersion (erwartet z. B. 26.10.0 oder 26.10.0-dev.1)."
      }
      if ($Uninstall) {
        Uninstall-Rfw
      } else {
        try { Install-Rfw } finally { Remove-RfwTemp }
      }
    } catch {
      if ($_.Exception.Message -like "$RfwStopMessage*") { throw }
      Write-Host "Error: Unerwarteter Fehler: $($_.Exception.Message)" -ForegroundColor Red
      Remove-RfwTemp
      if ($RfwFromFile) { exit 11 }
      throw
    }
    # As a file, report success explicitly (a native command's exit code must not leak);
    # under irm | iex, exit would close the window.
    if ($RfwFromFile) { exit 0 }
  }
} finally {
  [Net.ServicePointManager]::SecurityProtocol = $RfwSavedTls
  Remove-Variable -Name RfwSavedTls -ErrorAction SilentlyContinue
}
