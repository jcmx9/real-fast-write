# rf-write Plan 7 – Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rf-write becomes installable with one line on macOS, Windows and Linux (like rf-document): unsigned release archives built by CI from a `v*` tag, bootstrap scripts that install/update/uninstall without admin rights and add the `rf-write` command, a settings dialog, and a release script. A dev tag produces a pre-release so the user can test on Windows before anything reaches `main`.

**Architecture:**
- **Packaging:** electron-builder (devDependency) with `electron-builder.yml`; targets: macOS `zip` (arm64, x64, ad-hoc signed), Windows `zip` (x64, unpacked app), Linux `AppImage` (x64). Output names carry the version and arch. `npm run dist` builds for the current OS.
- **Release workflow:** `.github/workflows/release.yml` on tags `v*`: build matrix, upload archives + `SHA256SUMS` to a GitHub Release; a tag with `-dev.` creates a pre-release.
- **Bootstrap:** `scripts/bootstrap.sh` (macOS/Linux) and `scripts/bootstrap.ps1` (Windows) download the matching archive from the latest release (or pre-release with `--pre`/`-Pre`, or a given `--version`/`-Version`), verify its SHA-256, install into the per-user location, add the `rf-write` command and a menu/start entry, and run rf-document's bootstrap if `rf-document` is missing. `--uninstall`/`-Uninstall` removes only a folder carrying rf-write's install marker. `RFW_ARCHIVE` installs from a local archive (CI tests).
- **Settings dialog:** a renderer dialog edits the existing `Settings` (plus a new header default); main sanitises and persists; a read-only status shows rf-document and font detection.
- **Release script:** `scripts/release.sh dev|prod` per the user's conventions (CalVer, abort on any error, verify the version on `main` before tagging).

**Tech Stack:** Electron 44, electron-builder, GitHub Actions, bash (shellcheck-clean), PowerShell 5.1+, TypeScript strict, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-rf-write-mvp-design.md` §11 (settings), §14 (installation and release), §16 (CI). Task 4 adds the header-default setting to §11 (user request 2026-10-15).

**Builds on:** `dev` at `62769f1` (plans 1–6). Relevant code: `package.json` (`productName: "rf-write"`, `version: "26.10.0-dev.0"`, single version source, `postinstall` dev-name script), `src/main/cli.ts` (`--version`, `--help`), `src/main/index.ts`, `src/main/store.ts` (`Settings`, `sanitizeSettings`, `defaultSettings`), `src/main/context.ts` (`settings`, `fonts`, `locateRfDocument`), `src/main/locate.ts`, `src/main/menu.ts`, `src/renderer/ui/prompt.ts` (dialog pattern), `src/renderer/editor/header.ts` (per-tab `headerHidden`, new-tab default `false`). Model scripts: `~/GitHub/real-fast-document/scripts/bootstrap.sh`/`.ps1` (safety checks, messages).

## Global Constraints

- **Branch:** `feature/distribution` from `dev`. PR into `dev`; merge after green CI and the user's „ja“.
- **No outward-facing release action without the user's explicit OK:** pushing tags, creating GitHub Releases (also pre-releases), and running `release.sh` against the remote are done by the controller only after asking.
- **Versioning:** CalVer `YY.M.MICRO`, single source `package.json` `version`. Dev versions `YY.M.MICRO-dev.N` (SemVer form for electron-builder). Tags `v<version>`.
- **Unsigned** in the MVP; macOS apps are ad-hoc signed (required on Apple Silicon) and quarantine is removed by the bootstrap.
- **Install locations (no admin):** macOS `~/Applications/rf-write.app`; Linux `~/.local/share/real-fast-write/rf-write.AppImage` + `~/.local/share/applications/rf-write.desktop`; Windows `%LOCALAPPDATA%\real-fast-write\` + Start-menu shortcut. Command: `~/.local/bin/rf-write` (macOS/Linux), `%LOCALAPPDATA%\Microsoft\WindowsApps\rf-write.cmd` (Windows, already on PATH).
- **Shell scripts:** `#!/usr/bin/env bash`, `set -euo pipefail`, quoted `"${var}"`, `snake_case` functions, meaningful exit codes, POSIX/macOS-compatible flags, shellcheck-clean. PowerShell: `$ErrorActionPreference = 'Stop'`, `Set-StrictMode -Version Latest`. Messages German (like rf-document's), code comments English.
- **Never delete** anything not carrying rf-write's install marker (`.rf-write-install` file in the install folder; on macOS inside `rf-write.app/Contents/`).
- **UI strings German**, code/commits/docs English, Conventional Commits, no AI attribution, author `jcmx9`. README de/en parity. Local `CLAUDE.md` never committed.

## Review Focus

1. **Uninstall/update safety:** a wrong `RFW_HOME`/existing folder without marker is never deleted; update replaces the app atomically enough that a failed download leaves the old install working.
2. **Packaged app identity:** menu bar/Dock/Cmd-Tab/About show „rf-write“; `rf-write --version` prints the version and exits without a window; single instance and `rf-write file.md` work from the installed command (paths relative to the caller's cwd).
3. **Pre-release vs release selection** in the bootstrap (no accidental dev install for normal users; `--pre` picks the newest pre-release).
4. **Settings dialog:** invalid input never persists (main sanitises), changing the default folder never moves or deletes files, the status block is read-only and accurate.
5. **Windows specifics:** paths with spaces, PowerShell 5.1 (no `-Parallel`, no `??`), TLS 1.2 for downloads, long paths, shortcut creation without admin.

---

### Task 1: Packaging with electron-builder

**Files:** `package.json` (devDependency `electron-builder`, scripts `"dist": "electron-vite build && electron-builder --publish never"`), create `electron-builder.yml`, `build/` icons only if needed (use Electron default if none exists — no new artwork), `.gitignore` (`dist/`), `tests/unit/build-config.test.ts`.

`electron-builder.yml` essentials:
```yaml
appId: io.github.jcmx9.rfwrite
productName: rf-write
directories: { output: dist, buildResources: build }
files: ["out/**", "package.json", "!**/*.map"]
artifactName: "rf-write-${version}-${os}-${arch}.${ext}"
mac: { target: [{ target: zip, arch: [arm64, x64] }], identity: "-", category: public.app-category.productivity }
win: { target: [{ target: zip, arch: [x64] }] }
linux: { target: [{ target: AppImage, arch: [x64] }], category: Office }
fileAssociations: [{ ext: md, name: Markdown, role: Editor }]
```
Verify against the installed electron-builder version's schema (ad-hoc identity `"-"` support; `os` macro yields `mac`/`win`/`linux`). The `postinstall` dev-name script must not run inside the packaged app (it is not shipped: `files` excludes `scripts/`).

- [ ] **Steps:** failing config test (reads the YAML: appId, productName, artifactName pattern, targets per OS, files exclude scripts/tests) → add config → `npm run dist` on macOS produces `dist/rf-write-26.10.0-dev.0-mac-arm64.zip` (and x64) → unzip into a temp dir, run `rf-write.app/Contents/MacOS/rf-write --version` → prints `rf-write 26.10.0-dev.0`; `codesign --verify` passes (ad-hoc); `/usr/libexec/PlistBuddy -c "Print :CFBundleName"` → `rf-write`. CI (ci.yml): add a step `npm run dist` on all three OSes after the E2E and a smoke check that runs the packaged binary with `--version` (Windows: `dist/win-unpacked/rf-write.exe --version`; Linux AppImage `--appimage-extract-and-run --version` under xvfb or plain). Commit — `build: package rf-write with electron-builder`

### Task 2: Release workflow

**Files:** create `.github/workflows/release.yml`, `tests/unit/release-workflow.test.ts` (parses YAML: trigger `tags: ['v*']`, matrix, `prerelease` expression, uploaded globs, permissions `contents: write`).

- Trigger: `push: tags: ['v*']`. Job `verify`: tag equals `v` + `package.json` version, else fail. Job `build` (needs verify): matrix `macos-latest`, `windows-latest`, `ubuntu-latest`; `npm ci`, `npm run dist`; upload `dist/*.zip`, `dist/*.AppImage` as artifacts. Job `publish` (needs build): download artifacts, write `SHA256SUMS` (`sha256sum` over all files), create the release with `softprops/action-gh-release` pinned by SHA (like ci.yml pins actions), `prerelease: ${{ contains(github.ref_name, '-dev.') }}`, `generate_release_notes: true`, files = archives + SHA256SUMS.
- Pin every action to a full commit SHA with a version comment (as in ci.yml). Verify the SHAs with `gh api` before writing them.
- [ ] **Steps:** failing workflow test → workflow → `actionlint` if available (else note) → commit — `ci: build and publish release archives from v* tags`

### Task 3: Bootstrap scripts (install, update, uninstall)

**Files:** create `scripts/bootstrap.sh`, `scripts/bootstrap.ps1`; CI job `bootstrap` in `ci.yml`; README install section (Task 6).

Behaviour (both scripts, same options):
- Options: `--pre` / `-Pre` (newest pre-release), `--version X` / `-Version X` (exact), `--uninstall` / `-Uninstall`. Env `RFW_ARCHIVE` (local archive path: skip download and checksum, for CI), `RFW_HOME` (override install folder, tests only).
- Resolve the release via `https://api.github.com/repos/jcmx9/real-fast-write/releases` (latest non-prerelease by default; newest prerelease with `--pre`). Pick the asset for OS/arch (`uname -m` → arm64/x64; Windows x64). Download with `curl -fL` / `Invoke-WebRequest` (TLS 1.2) into a temp dir, verify against `SHA256SUMS` (`shasum -a 256` on macOS, `sha256sum` on Linux, `Get-FileHash` on Windows); mismatch → abort, nothing changed.
- Install atomically enough: extract into a temp folder next to the target, then replace the old install (rename old → `.old`, move new in, delete `.old`); on failure restore `.old`. Write the marker file.
- macOS: `xattr -dr com.apple.quarantine` on the app. Command `~/.local/bin/rf-write`:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  app="${HOME}/Applications/rf-write.app/Contents/MacOS/rf-write"
  case "${1:-}" in
    -V|--version|-h|--help) exec "${app}" "$@" ;;
  esac
  nohup "${app}" "$@" >/dev/null 2>&1 &
  ```
  Linux: same pattern with the AppImage; `.desktop` entry with `Exec=<AppImage> %F`, `MimeType=text/markdown;`. Windows: `rf-write.cmd` that calls the exe directly for `--version/--help` and otherwise `start "" "<exe>" %*`; Start-menu shortcut via `WScript.Shell` COM.
- Warn (not fail) if `~/.local/bin` is not on PATH, with the line to add.
- If `rf-document` is not found (same lookup order as the app: `RF_DOCUMENT`, `~/.local/bin`, Homebrew paths, `%LOCALAPPDATA%\Microsoft\WindowsApps\rf-document.cmd`, PATH), run rf-document's bootstrap one-liner and report its result; a failure there is a warning, not an rf-write install failure.
- Uninstall: remove command, menu entry/shortcut and the install folder — only if the marker exists; otherwise print what was found and exit 1. rf-document and user data (settings, notes) are never touched; say so in the final message.
- CI job `bootstrap` (all three OSes): build with `npm run dist`, run the bootstrap with `RFW_ARCHIVE=<built archive>` and `RFW_HOME=<temp>`, assert `rf-write --version` via the installed command prints the package version, run uninstall, assert everything is gone, and assert uninstall refuses a folder without marker. `shellcheck scripts/*.sh` in the lint step (install shellcheck on Linux runner if absent; macOS/Linux only).
- [ ] **Steps:** write the CI assertions as a script `scripts/test-bootstrap.sh` / `.ps1` first (RED: scripts missing), implement both bootstraps, run the bash flow locally on macOS with a locally built archive, commit — `feat(install): one-line bootstrap for macOS, Linux and Windows`

### Task 4: Settings dialog (and header default)

**Files:** `src/shared/types.ts` (`Settings.headerDefault: 'yaml' | 'titleblock'`, `RfwApi.getSettingsStatus()`, `updateSettings(patch)`), `src/main/store.ts` (default `'yaml'`, sanitise), `src/main/ipc.ts`/`context.ts` (`settings:get-status`, `settings:update` → sanitise, persist via saveJson, apply: rfDocumentPath re-locate, snippet folder → renderer reloads snippets, defaultFolder for new notes), `src/main/menu.ts` (macOS app menu „Einstellungen …“ Cmd+, ; Windows/Linux „Datei → Einstellungen …“ Ctrl+,), create `src/renderer/ui/settings.ts` (dialog), `src/renderer/app.ts` (open dialog; `headerDefault` used for newly opened/created tabs without a session entry), spec §11 text, tests (store sanitise, ipc update, dialog component, E2E).

Dialog (German, flat buttons, same look as the rename dialog):
- Standardordner für neue Notizen [Pfad] [Wählen …]
- Snippet-Ordner [Pfad] [Wählen …]
- rf-document [Pfad, leer = automatisch] [Wählen …]
- Schriftfaktor im Präsentationsmodus [1.0–3.0, Schritt 0.1]
- YAML-Header in der Vorschau: (•) als YAML ( ) als Titelblock
- Status (nur lesen): „rf-document: gefunden – <Pfad> (Version <x>)“ / „nicht gefunden“; „Schriften: gefunden in <Ordner>“ / „fehlen: …“
- [Abbrechen] [Speichern] — Esc cancels, Enter saves; in Present the dialog is refused like export (toast).
- Folder pickers use a main-side `dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })` IPC returning a canonical path; never move or delete existing files.
- [ ] **Steps:** failing tests (sanitise rejects relative paths / out-of-range factor / unknown headerDefault; update persists and applies; status reports locate result and `rf-document --version` output with a timeout; dialog renders values, validates factor, Save sends a patch, Esc cancels; E2E: open via menu, change Present font factor → Present text size changes; header default titleblock → a newly opened note shows the title block) → implement → commit — `feat(settings): settings dialog with rf-document and font status`

### Task 5: Release script

**Files:** create `scripts/release.sh`, `docs/github-release.md`, `tests/unit/release-script.test.ts` only if logic is extracted to Node; otherwise shellcheck + a dry-run mode tested in CI.

`./scripts/release.sh dev` (on `dev`, clean tree, up to date with origin): bump `YY.M.MICRO-dev.N` → `-dev.N+1` (or start `-dev.1` for a new MICRO) with `npm version --no-git-tag-version`, commit `release: <version>`, tag `v<version>`, push branch and tag (→ pre-release via workflow).
`./scripts/release.sh prod [--new-month]`: from `dev`, compute the release version (`YY.M.MICRO`; `--new-month` switches to the current year/month with MICRO 0), commit on a `release/<version>` branch, open a PR into `main` with `gh`, wait for green checks (`gh pr checks --watch`), rebase-merge, fetch `main`, **verify `package.json` on main equals the version**, tag `v<version>` on main, push the tag, then merge `main` back into `dev` via PR and bump dev to the next `-dev.0`.
- `set -euo pipefail`, every step checks preconditions (branch, clean tree, `gh auth status`, tag not existing) and aborts with a clear German message and distinct exit codes. `--dry-run` prints the steps without changing anything (used in CI).
- [ ] **Steps:** CI step `scripts/release.sh dev --dry-run` and `prod --dry-run` (assert exit 0 and printed version), implement, document in `docs/github-release.md`, commit — `chore(release): release script for dev pre-releases and prod releases`

### Task 6: Docs and final gate

**Files:** `README.md`, `README.en.md` (Installation, Update, Uninstall, pre-release testing line, settings dialog, status line without „noch nicht vorhanden“), `CHANGELOG.md`, local `CLAUDE.md`.
- Install lines exactly:
  - macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/jcmx9/real-fast-write/main/scripts/bootstrap.sh | bash`
  - Windows: `irm https://raw.githubusercontent.com/jcmx9/real-fast-write/main/scripts/bootstrap.ps1 | iex`
  - Pre-release (testing): `curl -fsSL https://raw.githubusercontent.com/jcmx9/real-fast-write/dev/scripts/bootstrap.sh | bash -s -- --pre` and `& ([scriptblock]::Create((irm https://raw.githubusercontent.com/jcmx9/real-fast-write/dev/scripts/bootstrap.ps1))) -Pre`
- [ ] **Steps:** README parity check, lint, typecheck, `test:coverage`, `test:e2e`, `npm run dist` locally; commit — `docs: installation, update and settings`

## Controller steps after merge (need the user's OK each)

1. Run `scripts/release.sh dev` → tag `v26.10.0-dev.1` → the release workflow publishes a pre-release.
2. The user installs on Windows with the pre-release line and runs the manual checks collected in memory (AltGr, zoom keys, held Present shortcut, mapped/OneDrive folders, menu bar after Present).
