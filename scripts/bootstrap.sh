#!/usr/bin/env bash
# Ein-Zeiler-Bootstrap für rf-write (macOS/Linux).
#
#   Installieren / Aktualisieren (neueste stabile Version):
#     curl -fsSL https://raw.githubusercontent.com/jcmx9/real-fast-write/main/scripts/bootstrap.sh | bash
#   Vorabversion testen (neueste Pre-Release):
#     curl -fsSL https://raw.githubusercontent.com/jcmx9/real-fast-write/dev/scripts/bootstrap.sh | bash -s -- --pre
#   Bestimmte Version:            ... | bash -s -- --version 26.10.0
#   Deinstallieren:               ... | bash -s -- --uninstall
#
# Lädt das passende Archiv der GitHub-Release, prüft es gegen SHA256SUMS und
# installiert ohne Adminrechte:
#   macOS: ~/Applications/rf-write.app
#          (Marker ~/.local/share/real-fast-write/.rf-write-install, außerhalb der
#          signierten App; Inhalt: Pfad der App)
#   Linux: ~/.local/share/real-fast-write/rf-write.AppImage
#          + ~/.local/share/applications/rf-write.desktop
#   Befehl: ~/.local/bin/rf-write (Startprotokoll: ~/.local/share/real-fast-write/launch.log)
# Fehlt rf-document, wird dessen eigener Bootstrap ausgeführt.
#
# Umgebung (für Tests):
#   RFW_ARCHIVE  lokales Archiv statt Download (keine Prüfsumme)
#   RFW_HOME     Installordner (macOS: Ordner, der rf-write.app enthält – dort liegen
#                dann auch Marker und Startprotokoll; Linux: Ordner mit rf-write.AppImage)
#
# Exit-Codes:
#   0 ok                          1 Sicherheitsabbruch (keine rf-write-Installation)
#   2 falscher Aufruf             3 System nicht unterstützt / Werkzeug fehlt
#   4 offline / Download-Fehler   5 Prüfsumme falsch
#   6 Installation fehlgeschlagen, alte Version unverändert
#   7 Wiederherstellung fehlgeschlagen – manuell nötig (Pfad wird ausgegeben)
#   8 keine passende Release (noch keine stabile, keine Vorabversion, Datei fehlt)
#   9 Version gibt es nicht       10 GitHub-Abfragelimit erreicht
#  12 rf-write läuft noch (macOS; nichts verändert)
#
# Release lookup uses the unauthenticated GitHub API (60 requests/hour) with exactly
# one call: /releases/latest (never a pre-release or draft), /releases?per_page=50 for
# --pre, /releases/tags/v<X> for --version. The JSON is read with grep/awk instead of jq
# (often missing) or python3 (on macOS without Command Line Tools, /usr/bin/python3 is a
# stub that opens an install dialog). That is safe: a quoted key followed by a colon,
# e.g. "tag_name":, cannot occur inside a JSON string, where quotes are escaped. Each
# release carries exactly one top-level tag_name, draft and prerelease (nested objects
# have none), so the tokens come in groups of three in any field order.
#
# Everything runs inside main(), called on the last line, so a truncated download
# of this script never executes half of it.
set -euo pipefail

readonly repo="jcmx9/real-fast-write"
readonly api="https://api.github.com/repos/${repo}/releases"
readonly rfd_bootstrap="https://raw.githubusercontent.com/jcmx9/real-fast-document/main/scripts/bootstrap.sh"
readonly marker_name=".rf-write-install"
readonly bundle_id="io.github.jcmx9.rfwrite"
readonly launcher_tag="# rf-write launcher (real-fast-write bootstrap)"
readonly desktop_tag="X-RfWrite-Bootstrap=true"
readonly version_re='^[0-9]+\.[0-9]+\.[0-9]+(-dev\.[0-9]+)?$'

say() { echo "→ $*"; }
ok() { echo "✓ $*"; }
warn() { echo "Warnung: $*" >&2; }
die() {
  local code="$1"
  shift
  echo "Error: $*" >&2
  exit "${code}"
}

usage() {
  cat <<'EOF'
rf-write-Bootstrap (macOS/Linux)

  bootstrap.sh                 neueste stabile Version installieren oder aktualisieren
  bootstrap.sh --pre           neueste Vorabversion (Pre-Release) zum Testen – sie kann
                               älter sein als die neueste stabile Version
  bootstrap.sh --version X     genau Version X (z. B. 26.10.0 oder 26.10.0-dev.1)
  bootstrap.sh --uninstall     rf-write entfernen (rf-document und Notizen bleiben)
EOF
}

strip_trailing_slashes() {
  local path="$1"
  while [[ "${path}" == */ && "${path}" != "/" ]]; do
    path="${path%/}"
  done
  printf '%s' "${path}"
}

# --- Platform and paths -------------------------------------------------------

detect_platform() {
  os="$(uname -s)"
  local machine home_override=""
  machine="$(uname -m)"
  case "${os}" in
    Darwin)
      case "${machine}" in
        arm64) arch="arm64" ;;
        x86_64) arch="x64" ;;
        *) die 3 "Prozessor ${machine} wird nicht unterstützt." ;;
      esac
      ;;
    Linux)
      case "${machine}" in
        x86_64 | amd64) arch="x64" ;;
        *) die 3 "Linux auf ${machine} wird nicht unterstützt (nur x86_64)." ;;
      esac
      ;;
    *) die 3 "Betriebssystem ${os} wird nicht unterstützt (Windows: bootstrap.ps1)." ;;
  esac

  [[ -z "${RFW_HOME:-}" ]] || home_override="$(strip_trailing_slashes "${RFW_HOME}")"
  data_home="${XDG_DATA_HOME:-${HOME}/.local/share}"
  bin_dir="${HOME}/.local/bin"
  command_path="${bin_dir}/rf-write"
  desktop_path=""
  if [[ "${os}" == "Darwin" ]]; then
    # install_dir is the unit that gets replaced and deleted: the .app bundle. Never write
    # into the signed bundle (it would break the code seal): the marker lives outside the
    # app and names it; deleting additionally requires rf-write's bundle ID.
    install_dir="${home_override:-${HOME}/Applications}/rf-write.app"
    state_dir="${home_override:-${data_home}/real-fast-write}"
    app_exe="${install_dir}/Contents/MacOS/rf-write"
  else
    install_dir="${home_override:-${data_home}/real-fast-write}"
    state_dir="${install_dir}"
    app_exe="${install_dir}/rf-write.AppImage"
    desktop_path="${data_home}/applications/rf-write.desktop"
  fi
  marker="${state_dir}/${marker_name}"
  log_path="${state_dir}/launch.log"
}

asset_name() {
  local version="$1"
  if [[ "${os}" == "Darwin" ]]; then
    echo "rf-write-${version}-mac-${arch}.zip"
  else
    echo "rf-write-${version}-linux-x86_64.AppImage"
  fi
}

# --- Ownership checks ---------------------------------------------------------

app_bundle_id() {
  /usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$1/Contents/Info.plist" 2>/dev/null || true
}

is_elf() {
  [[ -f "$1" && "$(head -c 4 "$1" | tail -c 3)" == "ELF" ]]
}

# True only for an install this bootstrap made (install_dir or its leftover .old).
# macOS: the marker names this app AND the bundle is rf-write's.
# Linux: the marker AND an ELF rf-write.AppImage sit in the folder.
owns_dir() {
  local dir="$1"
  if [[ "${os}" == "Darwin" ]]; then
    [[ -f "${marker}" && "$(cat "${marker}")" == "${install_dir}" ]] &&
      [[ "$(app_bundle_id "${dir}")" == "${bundle_id}" ]]
  else
    [[ -f "${dir}/${marker_name}" ]] && is_elf "${dir}/rf-write.AppImage"
  fi
}

# Prints what is in a folder rf-write would otherwise delete, and stops.
refuse_foreign() {
  local path="$1"
  if [[ "${os}" == "Darwin" ]]; then
    echo "Error: ${path} existiert, ist aber keine rf-write-Installation dieses Skripts (Marker ${marker} fehlt oder Bundle-ID ≠ ${bundle_id})." >&2
  else
    echo "Error: ${path} existiert, ist aber keine rf-write-Installation dieses Skripts (Marker ${marker_name} oder rf-write.AppImage fehlt)." >&2
  fi
  echo "Gefunden:" >&2
  ls -la "${path}" >&2 || true
  die 1 "Abbruch – der Ordner wird nicht angetastet. Bitte selbst prüfen und ggf. entfernen."
}

is_own_file() {
  local path="$1" tag="$2"
  [[ -f "${path}" ]] && grep -qF -- "${tag}" "${path}"
}

# --- Release lookup -----------------------------------------------------------

header_value() {
  local name="$1"
  awk -v n="${name}" -F': *' 'tolower($1) == n { v = $2; sub(/\r$/, "", v) } END { print v }' \
    "${tmp}/api.headers" 2>/dev/null || true
}

clock_time() {
  date -r "$1" '+%H:%M' 2>/dev/null || date -d "@$1" '+%H:%M' 2>/dev/null || echo "?"
}

# Fetches ${1} into ${tmp}/api.json; maps HTTP errors to distinct messages and codes.
# ${2}: latest | list | tag (only changes the 404 message).
api_get() {
  local url="$1" what="$2" code
  : >"${tmp}/api.headers"
  if ! code="$(curl -sS -L --proto '=https' -H 'Accept: application/vnd.github+json' \
    -D "${tmp}/api.headers" -o "${tmp}/api.json" -w '%{http_code}' "${url}" 2>"${tmp}/api.err")"; then
    die 4 "Keine Verbindung zu GitHub (offline?): $(tail -n 1 "${tmp}/api.err")"
  fi
  case "${code}" in
    200) ;;
    404)
      case "${what}" in
        latest) die 8 "Noch keine stabile Version veröffentlicht – mit --pre die Testversion installieren." ;;
        tag) die 9 "Version ${want_version} gibt es nicht (keine Release v${want_version})." ;;
        *) die 4 "GitHub-API antwortet mit 404: ${url}" ;;
      esac
      ;;
    403 | 429)
      if [[ "${code}" == "429" || "$(header_value x-ratelimit-remaining)" == "0" ]]; then
        local reset
        reset="$(header_value x-ratelimit-reset)"
        if [[ -n "${reset}" ]]; then
          die 10 "GitHub-Abfragelimit (60 pro Stunde) erreicht – wieder möglich ab $(clock_time "${reset}") Uhr."
        fi
        die 10 "GitHub-Abfragelimit (60 pro Stunde) erreicht – bitte später erneut versuchen."
      fi
      die 4 "GitHub-API verweigert den Zugriff (HTTP ${code}): ${url}"
      ;;
    *) die 4 "GitHub-API antwortet mit HTTP ${code}: ${url}" ;;
  esac
}

json_tokens() {
  grep -oE '"(tag_name|draft|prerelease)": *("[^"\\]*"|true|false)' "${tmp}/api.json" || true
}

first_tag() {
  json_tokens | awk -F'"' '$2 == "tag_name" { print $4; exit }'
}

# Newest published pre-release in a /releases list (newest first). Tokens come in
# groups of three per release, in any order; a group without all three keys means the
# response is not what we expect, so stop instead of guessing.
newest_prerelease() {
  json_tokens | awk -F'"' '
    {
      n++
      seen[$2] = 1
      if ($2 == "tag_name") tag = $4
      else if ($2 == "draft") draft = ($0 ~ /true$/)
      else if ($2 == "prerelease") pre = ($0 ~ /true$/)
    }
    n % 3 == 0 {
      if (!(seen["tag_name"] && seen["draft"] && seen["prerelease"])) { bad = 1; exit }
      if (pre && !draft && tag != "") { print tag; exit }
      split("", seen); tag = ""; draft = 0; pre = 0
    }
    END { if (bad || n % 3 != 0) exit 1 }'
}

# Sets tag, version, asset, asset_url and sums_url for the requested channel.
resolve_release() {
  if [[ -n "${want_version}" ]]; then
    api_get "${api}/tags/v${want_version}" tag
    tag="$(first_tag)"
  elif [[ "${want_pre}" == "true" ]]; then
    api_get "${api}?per_page=50" list
    tag="$(newest_prerelease)" || die 4 "Unerwartete Antwort der GitHub-API (Release ohne tag_name/draft/prerelease)."
    [[ -n "${tag}" ]] || die 8 "Keine Vorabversion (Pre-Release) unter den letzten 50 Releases gefunden."
  else
    # /releases/latest never returns a pre-release or draft.
    api_get "${api}/latest" latest
    tag="$(first_tag)"
  fi
  [[ -n "${tag}" ]] || die 4 "Unerwartete Antwort der GitHub-API (kein tag_name)."
  version="${tag#v}"
  asset="$(asset_name "${version}")"
  local base="https://github.com/${repo}/releases/download/${tag}"
  grep -qF "${base}/${asset}\"" "${tmp}/api.json" || die 8 "Release ${tag} enthält kein ${asset}."
  grep -qF "${base}/SHA256SUMS\"" "${tmp}/api.json" || die 8 "Release ${tag} enthält keine SHA256SUMS."
  asset_url="${base}/${asset}"
  sums_url="${base}/SHA256SUMS"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

# Downloads the asset into ${tmp} and verifies it; sets archive.
download_release() {
  resolve_release
  say "Lade rf-write ${version} (${asset})"
  curl -fL --proto '=https' --retry 3 -o "${tmp}/${asset}" "${asset_url}" ||
    die 4 "Download fehlgeschlagen: ${asset_url}"
  curl -fsSL --proto '=https' --retry 3 -o "${tmp}/SHA256SUMS" "${sums_url}" ||
    die 4 "Download fehlgeschlagen: ${sums_url}"
  local expected actual
  expected="$(awk -v f="${asset}" '$2 == f || $2 == "*" f { print $1; exit }' "${tmp}/SHA256SUMS")"
  [[ -n "${expected}" ]] || die 5 "SHA256SUMS enthält keinen Eintrag für ${asset}."
  actual="$(sha256_of "${tmp}/${asset}")"
  if [[ "${actual}" != "${expected}" ]]; then
    die 5 "Prüfsumme falsch für ${asset} (erwartet ${expected}, erhalten ${actual}) – nichts wurde verändert."
  fi
  ok "Prüfsumme stimmt"
  archive="${tmp}/${asset}"
}

# --- Install ------------------------------------------------------------------

run_limited() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 30 "$@"
  else
    "$@"
  fi
}

# Linux, best effort: copies the AppImage's own icon (.DirIcon) to ${2}. The AppImage
# runtime extracts without FUSE and without starting the app.
extract_icon() {
  local appimage="$1" dest="$2" dir icon target
  dir="$(mktemp -d "${tmp}/icon.XXXXXX")"
  (cd "${dir}" && run_limited "${appimage}" --appimage-extract .DirIcon) >/dev/null 2>&1 || return 1
  icon="${dir}/squashfs-root/.DirIcon"
  if [[ -L "${icon}" ]]; then
    target="$(readlink "${icon}")"
    [[ "${target}" != /* && "${target}" != *..* ]] || return 1
    (cd "${dir}" && run_limited "${appimage}" --appimage-extract "${target}") >/dev/null 2>&1 || return 1
    icon="${dir}/squashfs-root/${target}"
  fi
  [[ -f "${icon}" && ! -L "${icon}" && "$(head -c 4 "${icon}" | tail -c 3)" == "PNG" ]] || return 1
  cp "${icon}" "${dest}"
}

# Builds the new install in a staging folder next to the target (same file system,
# so the final moves are renames); sets stage_dir (the new install_dir).
stage_install() {
  local parent
  parent="$(dirname "${install_dir}")"
  mkdir -p "${parent}"
  stage_root="$(mktemp -d "${parent}/.$(basename "${install_dir}")-new.XXXXXX")"
  if [[ "${os}" == "Darwin" ]]; then
    ditto -x -k "${archive}" "${stage_root}" 2>/dev/null ||
      die 6 "Archiv lässt sich nicht entpacken: ${archive}"
    stage_dir="${stage_root}/rf-write.app"
    [[ -x "${stage_dir}/Contents/MacOS/rf-write" ]] ||
      die 6 "Archiv enthält kein rf-write.app: ${archive}"
    [[ "$(app_bundle_id "${stage_dir}")" == "${bundle_id}" ]] ||
      die 6 "Archiv enthält kein rf-write (Bundle-ID ≠ ${bundle_id}): ${archive}"
    # Downloaded or copied archives may carry Gatekeeper's quarantine flag; the app is unsigned.
    xattr -dr com.apple.quarantine "${stage_dir}" 2>/dev/null || true
    # Smoke test before the old install is touched (prints the version, opens no window).
    local out
    out="$("${stage_dir}/Contents/MacOS/rf-write" --version </dev/null 2>/dev/null)" ||
      die 6 "Das neue rf-write startet nicht – die bisherige Installation bleibt."
    say "Neue Version: ${out}"
  else
    is_elf "${archive}" || die 6 "Keine gültige AppImage-Datei: ${archive}"
    stage_dir="${stage_root}/$(basename "${install_dir}")"
    mkdir "${stage_dir}"
    cp "${archive}" "${stage_dir}/rf-write.AppImage"
    chmod 755 "${stage_dir}/rf-write.AppImage"
    extract_icon "${stage_dir}/rf-write.AppImage" "${stage_dir}/rf-write.png" || true
    touch "${stage_dir}/${marker_name}"
  fi
}

# Prints how to put the previous version back by hand, and stops with 7.
die_recovery() {
  local old="$1"
  echo "Error: Installation und Wiederherstellung fehlgeschlagen." >&2
  echo "  Die bisherige Version liegt unverändert in: ${old}" >&2
  echo "  Zurückholen mit:" >&2
  printf '    mv %q %q\n' "${old}" "${install_dir}" >&2
  exit 7
}

# macOS: Electron starts its helpers from the bundle path, so swapping or deleting the
# bundle under a running app could mix versions or crash it (Linux keeps the mounted
# AppImage's inode; Windows refuses on its own). Stops with 12, nothing changed.
refuse_running() {
  [[ "${os}" == "Darwin" ]] || return 0
  local pattern
  pattern="$(printf '%s' "${install_dir}/Contents/" | sed -e 's/[][\\.*^$+?(){}|]/\\&/g')"
  if pgrep -f -- "${pattern}" >/dev/null 2>&1; then
    die 12 "rf-write läuft noch – bitte beenden und erneut versuchen. Es wurde nichts verändert."
  fi
}

# Swaps the staged install in: old → .old, new → target, delete .old; restores .old on failure.
swap_install() {
  refuse_running
  local old="${install_dir}.old"
  if [[ -e "${old}" ]]; then
    # Leftover from an interrupted run: only ours may go.
    owns_dir "${old}" || refuse_foreign "${old}"
    rm -rf "${old}" || die 6 "Konnte den Rest eines früheren Laufs nicht löschen: ${old}"
  fi
  if [[ "${os}" == "Darwin" ]]; then
    # Before the swap, so an interrupted first install is still recognised as ours
    # (ownership also needs the bundle ID, so a marker without app is harmless).
    mkdir -p "${state_dir}"
    printf '%s\n' "${install_dir}" >"${marker}"
  fi
  local had_old="false"
  if [[ -e "${install_dir}" ]]; then
    mv "${install_dir}" "${old}" || die 6 "Konnte ${install_dir} nicht ersetzen – läuft rf-write noch?"
    had_old="true"
  fi
  if ! mv "${stage_dir}" "${install_dir}"; then
    if [[ "${had_old}" == "true" ]]; then
      mv "${old}" "${install_dir}" || die_recovery "${old}"
      die 6 "Installation fehlgeschlagen – die bisherige Version wurde wiederhergestellt."
    fi
    die 6 "Installation fehlgeschlagen."
  fi
  rm -rf "${old}" || warn "Alte Version konnte nicht gelöscht werden: ${old}"
  rm -rf "${stage_root}"
  stage_root=""
}

write_launcher() {
  mkdir -p "${bin_dir}"
  if [[ -e "${command_path}" ]] && ! is_own_file "${command_path}" "${launcher_tag}"; then
    die 1 "${command_path} existiert und stammt nicht von rf-write – bitte selbst entfernen."
  fi
  local app_q log_q tmp_cmd
  app_q="$(printf '%q' "${app_exe}")"
  log_q="$(printf '%q' "${log_path}")"
  tmp_cmd="$(mktemp "${bin_dir}/.rf-write.XXXXXX")"
  # --version/--help print to the terminal; everything else starts the app detached so the
  # terminal stays free, with its output in a log (truncated per launch) instead of
  # /dev/null, so a failed start can be diagnosed. Relative paths work: the app resolves
  # them against this cwd, and a running instance receives them already resolved.
  cat >"${tmp_cmd}" <<EOF
#!/usr/bin/env bash
${launcher_tag}
set -euo pipefail
app=${app_q}
log=${log_q}
case "\${1:-}" in
  -V|--version|-h|--help) exec "\${app}" "\$@" ;;
esac
mkdir -p "\$(dirname "\${log}")" 2>/dev/null || log=/dev/null
nohup "\${app}" "\$@" >"\${log}" 2>&1 &
EOF
  chmod 755 "${tmp_cmd}"
  mv "${tmp_cmd}" "${command_path}"
}

# One argument for a .desktop Exec line: quoted, with ", `, $ and \ escaped by the quoting
# rule, then every \ doubled by the string escape rule, and % doubled (field codes).
desktop_exec_arg() {
  printf '"%s"' "$(printf '%s' "$1" | sed -e 's/[\\"`$]/\\&/g' -e 's/\\/\\\\/g' -e 's/%/%%/g')"
}

write_desktop_entry() {
  [[ -n "${desktop_path}" ]] || return 0
  mkdir -p "$(dirname "${desktop_path}")"
  if [[ -e "${desktop_path}" ]] && ! is_own_file "${desktop_path}" "${desktop_tag}"; then
    warn "${desktop_path} stammt nicht von rf-write – Menüeintrag nicht angelegt."
    return 0
  fi
  local icon_line=""
  if [[ -f "${install_dir}/rf-write.png" ]]; then
    icon_line="Icon=$(printf '%s' "${install_dir}/rf-write.png" | sed -e 's/\\/\\\\/g')"
  fi
  {
    echo "[Desktop Entry]"
    echo "Type=Application"
    echo "Name=rf-write"
    echo "Comment=Markdown-Editor für real-fast-document"
    echo "Exec=$(desktop_exec_arg "${app_exe}") %F"
    [[ -z "${icon_line}" ]] || echo "${icon_line}"
    echo "Terminal=false"
    echo "Categories=Office;TextEditor;"
    echo "MimeType=text/markdown;"
    echo "StartupWMClass=rf-write"
    echo "${desktop_tag}"
  } >"${desktop_path}"
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$(dirname "${desktop_path}")" >/dev/null 2>&1 || true
  fi
}

check_path() {
  case ":${PATH}:" in
    *":${bin_dir}:"*) ;;
    *)
      warn "${bin_dir} ist nicht im PATH – der Befehl rf-write wird so nicht gefunden."
      echo "  Diese Zeile in ~/.zshrc bzw. ~/.bashrc ergänzen:" >&2
      # shellcheck disable=SC2016 # printed literally for the user's shell profile
      echo '  export PATH="$HOME/.local/bin:$PATH"' >&2
      ;;
  esac
}

check_linux_runtime() {
  [[ "${os}" == "Linux" ]] || return 0
  local libs userns
  libs="$({ ldconfig -p || /sbin/ldconfig -p; } 2>/dev/null || true)"
  if ! grep -q 'libfuse\.so\.2' <<<"${libs}"; then
    warn "libfuse2 nicht gefunden – AppImages brauchen es zum Start."
    echo "  Debian/Ubuntu: sudo apt install libfuse2t64 (ältere: libfuse2) · Fedora: sudo dnf install fuse-libs" >&2
  fi
  # Ubuntu 24.04+ blocks the unprivileged user namespaces Chromium's sandbox needs; an
  # AppImage then exits right away without a window.
  userns="$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || true)"
  if [[ "${userns}" == "1" ]]; then
    warn "AppArmor sperrt unprivilegierte User-Namespaces (Ubuntu 24.04+) – rf-write startet so nicht."
    echo "  Abhilfe (setzt diese Kernel-Härtung systemweit zurück, braucht sudo):" >&2
    echo "    echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/60-rf-write.conf" >&2
    echo "    sudo sysctl --system" >&2
    echo "  Startprotokoll bei Problemen: ${log_path}" >&2
  fi
}

# Same order as the app (src/main/locate.ts): RF_DOCUMENT, ~/.local/bin, Homebrew, PATH.
find_rf_document() {
  local candidate
  for candidate in "${RF_DOCUMENT:-}" "${HOME}/.local/bin/rf-document" \
    /opt/homebrew/bin/rf-document /usr/local/bin/rf-document; do
    if [[ -n "${candidate}" && -f "${candidate}" && -x "${candidate}" ]]; then
      echo "${candidate}"
      return 0
    fi
  done
  command -v rf-document 2>/dev/null
}

ensure_rf_document() {
  local found
  if found="$(find_rf_document)"; then
    ok "rf-document gefunden: ${found}"
    return 0
  fi
  say "rf-document fehlt – starte dessen Bootstrap (${rfd_bootstrap})"
  if curl -fsSL --proto '=https' "${rfd_bootstrap}" | bash; then
    ok "rf-document installiert"
  else
    warn "rf-document konnte nicht installiert werden. rf-write läuft trotzdem; für den PDF-Export später nachholen:"
    echo "  curl -fsSL ${rfd_bootstrap} | bash" >&2
  fi
}

do_install() {
  if [[ -e "${install_dir}" ]] && ! owns_dir "${install_dir}"; then
    refuse_foreign "${install_dir}"
  fi
  if [[ -n "${RFW_ARCHIVE:-}" ]]; then
    [[ -f "${RFW_ARCHIVE}" ]] || die 2 "RFW_ARCHIVE nicht gefunden: ${RFW_ARCHIVE}"
    archive="${RFW_ARCHIVE}"
    say "Installiere aus lokalem Archiv ${archive} (ohne Prüfsumme)"
  else
    command -v curl >/dev/null 2>&1 || die 3 "curl nicht gefunden – bitte zuerst installieren."
    download_release
  fi

  if [[ -e "${install_dir}" ]]; then
    refuse_running
    say "Aktualisiere ${install_dir}"
  else
    say "Installiere nach ${install_dir}"
  fi
  stage_install
  swap_install
  write_launcher
  write_desktop_entry
  ok "rf-write installiert: ${install_dir}"
  ok "Befehl: ${command_path}"
  check_path
  check_linux_runtime
  ensure_rf_document
  echo "Fertig. Start: rf-write [notiz.md]"
}

# --- Uninstall ----------------------------------------------------------------

remove_own_entries() {
  if is_own_file "${command_path}" "${launcher_tag}"; then
    rm -f "${command_path}"
    say "Befehl entfernt: ${command_path}"
  elif [[ -e "${command_path}" ]]; then
    warn "${command_path} stammt nicht von rf-write – bleibt."
  fi
  if [[ -n "${desktop_path}" ]]; then
    if is_own_file "${desktop_path}" "${desktop_tag}"; then
      rm -f "${desktop_path}"
      say "Menüeintrag entfernt: ${desktop_path}"
      if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$(dirname "${desktop_path}")" >/dev/null 2>&1 || true
      fi
    elif [[ -e "${desktop_path}" ]]; then
      warn "${desktop_path} stammt nicht von rf-write – bleibt."
    fi
  fi
}

# A leftover <install>.old from an interrupted update; checked while the marker exists.
remove_old() {
  local old="${install_dir}.old"
  [[ -e "${old}" ]] || return 0
  if owns_dir "${old}"; then
    rm -rf "${old}" || die 6 "Konnte ${old} nicht löschen."
    say "Rest eines früheren Laufs entfernt: ${old}"
  else
    warn "${old} ist keine rf-write-Installation dieses Skripts – bleibt."
  fi
}

# macOS keeps marker and launch log outside the app; drop them (and the default folder
# if it is now empty). On Linux both live in the install folder.
remove_state() {
  [[ "${os}" == "Darwin" ]] || return 0
  rm -f "${marker}" "${log_path}"
  [[ -n "${RFW_HOME:-}" ]] || rmdir "${state_dir}" 2>/dev/null || true
}

do_uninstall() {
  if [[ ! -e "${install_dir}" ]]; then
    echo "Nichts zu deinstallieren: ${install_dir} existiert nicht."
    remove_old
    remove_own_entries
    remove_state
    exit 0
  fi
  owns_dir "${install_dir}" || refuse_foreign "${install_dir}"
  refuse_running
  remove_old
  say "Lösche ${install_dir}"
  rm -rf "${install_dir}" || die 6 "Konnte ${install_dir} nicht vollständig löschen."
  remove_own_entries
  remove_state
  ok "rf-write deinstalliert. rf-document, Einstellungen und Notizen bleiben unangetastet."
}

# --- Main ---------------------------------------------------------------------

main() {
  local action="install"
  want_pre="false"
  want_version=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pre) want_pre="true" ;;
      --version)
        [[ $# -ge 2 && -n "$2" ]] || die 2 "--version braucht eine Versionsnummer (z. B. 26.10.0)."
        want_version="${2#v}"
        shift
        ;;
      --version=*)
        want_version="${1#--version=}"
        want_version="${want_version#v}"
        ;;
      --uninstall | uninstall) action="uninstall" ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        usage >&2
        die 2 "unbekannte Option ${1}"
        ;;
    esac
    shift
  done
  if [[ "${want_pre}" == "true" && -n "${want_version}" ]]; then
    die 2 "--pre und --version schließen sich aus."
  fi
  if [[ -n "${want_version}" ]] && ! [[ "${want_version}" =~ ${version_re} ]]; then
    die 2 "Ungültige Version ${want_version} (erwartet z. B. 26.10.0 oder 26.10.0-dev.1)."
  fi

  detect_platform
  if [[ "${action}" == "uninstall" ]]; then
    do_uninstall
    return
  fi

  tmp="$(mktemp -d "${TMPDIR:-/tmp}/rf-write-bootstrap.XXXXXX")"
  stage_root=""
  trap 'rm -rf "${tmp}"; [[ -z "${stage_root}" ]] || rm -rf "${stage_root}"' EXIT
  do_install
}

main "$@"
