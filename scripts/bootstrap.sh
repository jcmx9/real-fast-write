#!/usr/bin/env bash
# Ein-Zeiler-Bootstrap für rf-write (macOS/Linux).
#
#   Installieren / Aktualisieren (neueste Version):
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
#   Befehl: ~/.local/bin/rf-write
# Fehlt rf-document, wird dessen eigener Bootstrap ausgeführt.
#
# Umgebung (für Tests):
#   RFW_ARCHIVE  lokales Archiv statt Download (keine Prüfsumme)
#   RFW_HOME     Installordner (macOS: Ordner, der rf-write.app enthält – dort liegt
#                dann auch der Marker; Linux: Ordner mit rf-write.AppImage)
#
# Exit-Codes: 0 ok · 1 Sicherheitsabbruch (fremder Ordner ohne Marker) ·
#   2 falscher Aufruf · 3 System nicht unterstützt / Werkzeug fehlt ·
#   4 Release/Download fehlgeschlagen · 5 Prüfsumme falsch · 6 Installation fehlgeschlagen
#
# Release lookup uses the unauthenticated GitHub API (60 requests/hour) with exactly
# one call: /releases/latest (never a pre-release), /releases?per_page=20 for --pre,
# /releases/tags/v<X> for --version. The JSON is read with grep/awk instead of jq
# (often missing) or python3 (on macOS without Command Line Tools, /usr/bin/python3
# is a stub that opens an install dialog). That is safe here: a quoted key followed
# by a colon, e.g. "tag_name":, cannot occur inside a JSON string, where quotes are
# escaped.
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

  bootstrap.sh                 neueste Version installieren oder aktualisieren
  bootstrap.sh --pre           neueste Vorabversion (Pre-Release)
  bootstrap.sh --version X     genau Version X (z. B. 26.10.0)
  bootstrap.sh --uninstall     rf-write entfernen (rf-document und Notizen bleiben)
EOF
}

# --- Platform and paths -------------------------------------------------------

detect_platform() {
  os="$(uname -s)"
  local machine
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

  data_home="${XDG_DATA_HOME:-${HOME}/.local/share}"
  bin_dir="${HOME}/.local/bin"
  command_path="${bin_dir}/rf-write"
  desktop_path=""
  if [[ "${os}" == "Darwin" ]]; then
    # install_dir is the unit that gets replaced and deleted: the .app bundle.
    install_dir="${RFW_HOME:-${HOME}/Applications}/rf-write.app"
    # Never write into the signed bundle (it would break the code seal): the marker lives
    # outside the app and names it; deleting additionally requires rf-write's bundle ID.
    marker_dir="${RFW_HOME:-${data_home}/real-fast-write}"
    marker="${marker_dir}/${marker_name}"
    app_exe="${install_dir}/Contents/MacOS/rf-write"
  else
    install_dir="${RFW_HOME:-${data_home}/real-fast-write}"
    marker="${install_dir}/${marker_name}"
    app_exe="${install_dir}/rf-write.AppImage"
    desktop_path="${data_home}/applications/rf-write.desktop"
  fi
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

# True only for an install this bootstrap made. macOS: the marker names this app AND the
# bundle is rf-write's; Linux: the marker file sits in the install folder.
owns_install() {
  if [[ "${os}" == "Darwin" ]]; then
    [[ -f "${marker}" && "$(cat "${marker}")" == "${install_dir}" ]] &&
      [[ "$(app_bundle_id "${install_dir}")" == "${bundle_id}" ]]
  else
    [[ -f "${marker}" ]]
  fi
}

# Same for a leftover <install_dir>.old from an interrupted update.
owns_old() {
  local old="$1"
  if [[ "${os}" == "Darwin" ]]; then
    [[ -f "${marker}" && "$(app_bundle_id "${old}")" == "${bundle_id}" ]]
  else
    [[ -f "${old}/${marker_name}" ]]
  fi
}

# Prints what is in a folder rf-write would otherwise delete, and stops.
refuse_foreign() {
  local path="$1"
  if [[ "${os}" == "Darwin" ]]; then
    echo "Error: ${path} existiert, ist aber keine rf-write-Installation dieses Skripts (Marker ${marker} fehlt oder Bundle-ID ≠ ${bundle_id})." >&2
  else
    echo "Error: ${path} existiert, trägt aber keinen rf-write-Installationsmarker (${marker_name})." >&2
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

api_get() {
  local url="$1"
  curl -fsSL --proto '=https' -H 'Accept: application/vnd.github+json' "${url}" ||
    die 4 "GitHub-API nicht erreichbar: ${url} (offline, Version unbekannt oder Abfragelimit 60/h erreicht?)"
}

json_tokens() {
  grep -oE '"(tag_name|draft|prerelease)": *("[^"\\]*"|true|false)' || true
}

# Sets tag and version for the requested channel.
resolve_release() {
  local json
  if [[ -n "${want_version}" ]]; then
    json="$(api_get "${api}/tags/v${want_version}")"
    tag="$(json_tokens <<<"${json}" | awk -F'"' '$2 == "tag_name" { print $4; exit }')"
  elif [[ "${want_pre}" == "true" ]]; then
    json="$(api_get "${api}?per_page=20")"
    # Releases come newest first; take the first published pre-release.
    tag="$(json_tokens <<<"${json}" | awk -F'"' '
      $2 == "tag_name" { tag = $4; draft = "false"; next }
      $2 == "draft" { draft = ($0 ~ /true$/) ? "true" : "false"; next }
      $2 == "prerelease" && $0 ~ /true$/ && draft == "false" && tag != "" { print tag; exit }')"
    [[ -n "${tag}" ]] || die 4 "Keine Vorabversion (Pre-Release) gefunden."
  else
    # /releases/latest never returns a pre-release or draft.
    json="$(api_get "${api}/latest")"
    tag="$(json_tokens <<<"${json}" | awk -F'"' '$2 == "tag_name" { print $4; exit }')"
  fi
  [[ -n "${tag}" ]] || die 4 "Release-Antwort von GitHub ohne tag_name."
  version="${tag#v}"
  asset="$(asset_name "${version}")"
  local base="https://github.com/${repo}/releases/download/${tag}"
  grep -qF "${base}/${asset}\"" <<<"${json}" || die 4 "Release ${tag} enthält kein ${asset}."
  grep -qF "${base}/SHA256SUMS\"" <<<"${json}" || die 4 "Release ${tag} enthält keine SHA256SUMS."
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
    # Downloaded or copied archives may carry Gatekeeper's quarantine flag; the app is unsigned.
    xattr -dr com.apple.quarantine "${stage_dir}" 2>/dev/null || true
    [[ "$(app_bundle_id "${stage_dir}")" == "${bundle_id}" ]] ||
      die 6 "Archiv enthält kein rf-write (Bundle-ID ≠ ${bundle_id}): ${archive}"
    # Smoke test before the old install is touched (prints the version, opens no window).
    local out
    out="$("${stage_dir}/Contents/MacOS/rf-write" --version </dev/null 2>/dev/null)" ||
      die 6 "Das neue rf-write startet nicht – die bisherige Installation bleibt."
    say "Neue Version: ${out}"
  else
    if [[ "$(head -c 4 "${archive}" | tail -c 3)" != "ELF" ]]; then
      die 6 "Keine gültige AppImage-Datei: ${archive}"
    fi
    stage_dir="${stage_root}/$(basename "${install_dir}")"
    mkdir "${stage_dir}"
    cp "${archive}" "${stage_dir}/rf-write.AppImage"
    chmod 755 "${stage_dir}/rf-write.AppImage"
    touch "${stage_dir}/${marker_name}"
  fi
}

# Swaps the staged install in: old → .old, new → target, delete .old; restores .old on failure.
swap_install() {
  local old="${install_dir}.old"
  if [[ -e "${old}" ]]; then
    # Leftover from an interrupted run: only ours may go.
    if owns_old "${old}"; then
      rm -rf "${old}"
    else
      refuse_foreign "${old}"
    fi
  fi
  if [[ -e "${install_dir}" ]]; then
    mv "${install_dir}" "${old}" || die 6 "Konnte ${install_dir} nicht ersetzen – läuft rf-write noch?"
  fi
  if ! mv "${stage_dir}" "${install_dir}"; then
    [[ -e "${old}" ]] && mv "${old}" "${install_dir}"
    die 6 "Installation fehlgeschlagen – die bisherige Version wurde wiederhergestellt."
  fi
  rm -rf "${old}" "${stage_root}"
  stage_root=""
  if [[ "${os}" == "Darwin" ]]; then
    mkdir -p "${marker_dir}"
    printf '%s\n' "${install_dir}" >"${marker}"
  fi
}

write_launcher() {
  mkdir -p "${bin_dir}"
  if [[ -e "${command_path}" ]] && ! is_own_file "${command_path}" "${launcher_tag}"; then
    die 1 "${command_path} existiert und stammt nicht von rf-write – bitte selbst entfernen."
  fi
  local app_q tmp_cmd
  app_q="$(printf '%q' "${app_exe}")"
  tmp_cmd="$(mktemp "${bin_dir}/.rf-write.XXXXXX")"
  # --version/--help print to the terminal; everything else starts the app detached so the
  # terminal stays free. Relative paths work: the app resolves them against this cwd, and a
  # running instance receives them already resolved (single instance).
  cat >"${tmp_cmd}" <<EOF
#!/usr/bin/env bash
${launcher_tag}
set -euo pipefail
app=${app_q}
case "\${1:-}" in
  -V|--version|-h|--help) exec "\${app}" "\$@" ;;
esac
nohup "\${app}" "\$@" >/dev/null 2>&1 &
EOF
  chmod 755 "${tmp_cmd}"
  mv "${tmp_cmd}" "${command_path}"
}

write_desktop_entry() {
  [[ -n "${desktop_path}" ]] || return 0
  mkdir -p "$(dirname "${desktop_path}")"
  if [[ -e "${desktop_path}" ]] && ! is_own_file "${desktop_path}" "${desktop_tag}"; then
    warn "${desktop_path} stammt nicht von rf-write – Menüeintrag nicht angelegt."
    return 0
  fi
  cat >"${desktop_path}" <<EOF
[Desktop Entry]
Type=Application
Name=rf-write
Comment=Markdown-Editor für real-fast-document
Exec="${app_exe}" %F
Terminal=false
Categories=Office;TextEditor;
MimeType=text/markdown;
StartupWMClass=rf-write
${desktop_tag}
EOF
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

check_fuse() {
  [[ "${os}" == "Linux" ]] || return 0
  local libs
  libs="$({ ldconfig -p || /sbin/ldconfig -p; } 2>/dev/null || true)"
  if ! grep -q 'libfuse\.so\.2' <<<"${libs}"; then
    warn "libfuse2 nicht gefunden – AppImages brauchen es zum Start."
    echo "  Debian/Ubuntu: sudo apt install libfuse2t64 (ältere: libfuse2) · Fedora: sudo dnf install fuse-libs" >&2
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
  if [[ -e "${install_dir}" ]] && ! owns_install; then
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
  check_fuse
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

# macOS keeps the marker outside the app; drop it (and the default folder if now empty).
remove_mac_marker() {
  [[ "${os}" == "Darwin" ]] || return 0
  rm -f "${marker}"
  [[ -n "${RFW_HOME:-}" ]] || rmdir "${marker_dir}" 2>/dev/null || true
}

do_uninstall() {
  if [[ ! -e "${install_dir}" ]]; then
    echo "Nichts zu deinstallieren: ${install_dir} existiert nicht."
    remove_own_entries
    remove_mac_marker
    exit 0
  fi
  owns_install || refuse_foreign "${install_dir}"
  remove_own_entries
  say "Lösche ${install_dir}"
  rm -rf "${install_dir}"
  remove_mac_marker
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
