#!/usr/bin/env bash
# End-to-end check of scripts/bootstrap.sh against a locally built archive (CI job `bootstrap`).
#
#   scripts/test-bootstrap.sh [archive]
#
# Default archive: dist/rf-write-<version>-mac-<arch>.zip (macOS) or
# dist/rf-write-<version>-linux-x86_64.AppImage (Linux), as built by `npm run dist`.
# Everything happens below a temp dir with its own HOME: the runner's (or developer's)
# real ~/Applications, ~/.local/bin and ~/.local/share are never touched.
# On Linux without FUSE, run with APPIMAGE_EXTRACT_AND_RUN=1 (and a display, e.g. xvfb-run).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bootstrap="${root}/scripts/bootstrap.sh"
version="$(node -p "require('${root}/package.json').version")"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "ok   $*"
}

default_archive() {
  case "$(uname -s)" in
    Darwin)
      local arch
      arch="$(uname -m)"
      [[ "${arch}" == "x86_64" ]] && arch="x64"
      echo "${root}/dist/rf-write-${version}-mac-${arch}.zip"
      ;;
    Linux) echo "${root}/dist/rf-write-${version}-linux-x86_64.AppImage" ;;
    *) fail "unsupported OS $(uname -s)" ;;
  esac
}

archive="${1:-$(default_archive)}"
[[ -f "${archive}" ]] || fail "archive not found: ${archive}"
archive="$(cd "$(dirname "${archive}")" && pwd)/$(basename "${archive}")"

work="$(mktemp -d "${TMPDIR:-/tmp}/rfw-bootstrap-test.XXXXXX")"
cleanup() {
  rm -rf "${work}"
}
trap cleanup EXIT

# Isolated profile: HOME, XDG and the install folder all live in the temp dir.
export HOME="${work}/home"
mkdir -p "${HOME}"
unset XDG_DATA_HOME
export RFW_HOME="${work}/apps"
# A stand-in rf-document, found first by the lookup, so the bootstrap does not install the real one.
mkdir -p "${work}/fake-rfd"
printf '#!/bin/sh\necho "rf-document 0.0.0"\n' >"${work}/fake-rfd/rf-document"
chmod +x "${work}/fake-rfd/rf-document"
export RF_DOCUMENT="${work}/fake-rfd/rf-document"

command_path="${HOME}/.local/bin/rf-write"
desktop_path="${HOME}/.local/share/applications/rf-write.desktop"
case "$(uname -s)" in
  Darwin)
    install_dir="${RFW_HOME}/rf-write.app"
    # Outside the signed bundle; with RFW_HOME it sits next to the app.
    marker="${RFW_HOME}/.rf-write-install"
    ;;
  Linux)
    install_dir="${RFW_HOME}"
    marker="${install_dir}/.rf-write-install"
    ;;
esac

run_bootstrap() {
  bash "${bootstrap}" "$@" </dev/null
}

assert_installed() {
  [[ -f "${marker}" ]] || fail "marker missing: ${marker}"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    [[ "$(cat "${marker}")" == "${install_dir}" ]] || fail "marker does not name ${install_dir}"
    [[ -z "$(find "${install_dir}" -name '.rf-write-install')" ]] || fail "marker written into the app bundle"
    codesign --verify --deep --strict "${install_dir}" || fail "code seal of the installed app is broken"
  fi
  [[ -x "${command_path}" ]] || fail "command missing: ${command_path}"
  if [[ "$(uname -s)" == "Linux" ]]; then
    [[ -x "${install_dir}/rf-write.AppImage" ]] || fail "AppImage missing"
    [[ -f "${desktop_path}" ]] || fail ".desktop entry missing"
    grep -q '^MimeType=text/markdown;$' "${desktop_path}" || fail ".desktop lacks MimeType"
    grep -q "^Exec=\"${install_dir}/rf-write.AppImage\" %F$" "${desktop_path}" || fail ".desktop Exec line"
  fi
  local out
  out="$("${command_path}" --version)"
  [[ "${out}" == "rf-write ${version}" ]] || fail "--version printed '${out}', expected 'rf-write ${version}'"
  [[ -z "$(find "$(dirname "${install_dir}")" -maxdepth 1 \( -name '*.old' -o -name '.*-new.*' \))" ]] ||
    fail "leftover staging/.old folders next to ${install_dir}"
}

# 1. Usage errors exit 2 and change nothing.
set +e
run_bootstrap --bogus >/dev/null 2>&1
code=$?
set -e
[[ "${code}" -eq 2 ]] || fail "unknown option exited ${code}, expected 2"
[[ ! -e "${install_dir}" ]] || fail "unknown option created ${install_dir}"
pass "unknown option -> exit 2"

# 2. Fresh install from the local archive.
RFW_ARCHIVE="${archive}" run_bootstrap
assert_installed
pass "install: marker, command, rf-write --version = ${version}"

# 3. Update over an existing install.
RFW_ARCHIVE="${archive}" run_bootstrap
assert_installed
pass "update over existing install"

# 4. A broken archive aborts before anything is replaced; the old install keeps working.
broken="${work}/broken-$(basename "${archive}")"
printf 'not an archive' >"${broken}"
set +e
RFW_ARCHIVE="${broken}" run_bootstrap >/dev/null 2>&1
code=$?
set -e
[[ "${code}" -ne 0 ]] || fail "broken archive was accepted"
assert_installed
pass "broken archive -> exit ${code}, old install intact"

# 5. Download path against a fake GitHub: a stand-in `curl` first on PATH serves fixtures
#    keyed by URL, so release selection and checksum checks run without network.
fake="${work}/fake-gh"
mkdir -p "${fake}" "${work}/fakebin"
cat >"${work}/fakebin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift ;;
    -H | --proto | --retry) shift ;;
    -*) ;;
    *) url="$1" ;;
  esac
  shift
done
echo "${url}" >>"${FAKE_GH}/requests.log"
src="${FAKE_GH}/$(printf '%s' "${url}" | tr '/:?=&' '_____')"
[[ -f "${src}" ]] || { echo "curl: (22) 404 ${url}" >&2; exit 22; }
if [[ -n "${out}" ]]; then cp "${src}" "${out}"; else cat "${src}"; fi
EOF
chmod +x "${work}/fakebin/curl"
export FAKE_GH="${fake}"
api="https://api.github.com/repos/jcmx9/real-fast-write/releases"
download="https://github.com/jcmx9/real-fast-write/releases/download"
suffix="${archive##*/rf-write-"${version}"}"

fixture_path() {
  printf '%s/%s' "${fake}" "$(printf '%s' "$1" | tr '/:?=&' '_____')"
}

# Release JSON as GitHub returns it (subset): tag, flags and asset download URLs.
release_json() {
  local tag="$1" pre="$2"
  printf '{"tag_name": "%s", "draft": false, "prerelease": %s, "body": "\\"prerelease\\": true", "assets": [' "${tag}" "${pre}"
  printf '{"name": "rf-write-%s%s", "browser_download_url": "%s/%s/rf-write-%s%s"}, ' \
    "${tag#v}" "${suffix}" "${download}" "${tag}" "${tag#v}" "${suffix}"
  printf '{"name": "SHA256SUMS", "browser_download_url": "%s/%s/SHA256SUMS"}]}' "${download}" "${tag}"
}

# Publishes asset + SHA256SUMS for a tag; a third argument overrides the hash.
publish_assets() {
  local tag="$1" hash="${2:-}"
  local asset="rf-write-${tag#v}${suffix}"
  ln -sf "${archive}" "$(fixture_path "${download}/${tag}/${asset}")"
  [[ -n "${hash}" ]] || hash="$({ sha256sum "${archive}" 2>/dev/null || shasum -a 256 "${archive}"; } | awk '{ print $1 }')"
  printf '%s  %s\n' "${hash}" "${asset}" >"$(fixture_path "${download}/${tag}/SHA256SUMS")"
}

run_online() {
  PATH="${work}/fakebin:${PATH}" run_bootstrap "$@"
}

release_json "v${version}" false >"$(fixture_path "${api}/latest")"
publish_assets "v${version}"
run_online
assert_installed
grep -qxF "${api}/latest" "${fake}/requests.log" || fail "default channel did not ask /releases/latest"
grep -qxF "${download}/v${version}/rf-write-${version}${suffix}" "${fake}/requests.log" || fail "wrong asset downloaded"
pass "download: /releases/latest, checksum ok, installed"

# --pre takes the newest pre-release, skipping a newer stable release listed first.
{
  printf '['
  release_json "v99.0.0" false
  printf ', '
  release_json "v${version}" true
  printf ']'
} >"$(fixture_path "${api}?per_page=20")"
publish_assets "v99.0.0"
: >"${fake}/requests.log"
run_online --pre
assert_installed
grep -qxF "${download}/v${version}/rf-write-${version}${suffix}" "${fake}/requests.log" || fail "--pre picked the wrong release"
pass "--pre: newest pre-release chosen"

# --version with a wrong checksum aborts with 5 and leaves the install alone.
release_json "v0.0.1" false >"$(fixture_path "${api}/tags/v0.0.1")"
publish_assets "v0.0.1" "0000000000000000000000000000000000000000000000000000000000000000"
set +e
run_online --version 0.0.1 >/dev/null 2>&1
code=$?
set -e
[[ "${code}" -eq 5 ]] || fail "checksum mismatch exited ${code}, expected 5"
assert_installed
pass "--version with bad checksum -> exit 5, install intact"

# An unknown version fails cleanly with 4.
set +e
run_online --version 0.0.2 >/dev/null 2>&1
code=$?
set -e
[[ "${code}" -eq 4 ]] || fail "unknown version exited ${code}, expected 4"
assert_installed
pass "unknown --version -> exit 4"

# 6. Uninstall removes command, menu entry and install folder; user data stays.
out="$(run_bootstrap --uninstall)"
echo "${out}"
[[ ! -e "${install_dir}" ]] || fail "install folder still there"
[[ ! -e "${command_path}" ]] || fail "command still there"
[[ ! -e "${desktop_path}" ]] || fail ".desktop entry still there"
[[ ! -e "${marker}" ]] || fail "marker still there"
[[ -x "${RF_DOCUMENT}" ]] || fail "rf-document was touched"
grep -q 'rf-document' <<<"${out}" || fail "final message does not mention rf-document"
pass "uninstall removed everything"

# 7. A folder without the marker is never deleted or overwritten.
if [[ "$(uname -s)" == "Darwin" ]]; then
  mkdir -p "${install_dir}/Contents"
  echo keep >"${install_dir}/Contents/keep.txt"
  keep="${install_dir}/Contents/keep.txt"
else
  mkdir -p "${install_dir}"
  echo keep >"${install_dir}/keep.txt"
  keep="${install_dir}/keep.txt"
fi
set +e
run_bootstrap --uninstall >/dev/null 2>&1
code=$?
set -e
[[ "${code}" -eq 1 ]] || fail "uninstall of unmarked folder exited ${code}, expected 1"
[[ -f "${keep}" ]] || fail "uninstall deleted an unmarked folder"
set +e
RFW_ARCHIVE="${archive}" run_bootstrap >/dev/null 2>&1
code=$?
set -e
[[ "${code}" -eq 1 ]] || fail "install over unmarked folder exited ${code}, expected 1"
[[ -f "${keep}" ]] || fail "install replaced an unmarked folder"
pass "unmarked folder: uninstall and install refuse (exit 1), folder intact"

# 8. macOS: a marker is not enough – an app with a different bundle ID is never deleted.
if [[ "$(uname -s)" == "Darwin" ]]; then
  rm -rf "${install_dir}"
  mkdir -p "${install_dir}/Contents"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.example.other" \
    "${install_dir}/Contents/Info.plist" >/dev/null
  echo keep >"${keep}"
  printf '%s\n' "${install_dir}" >"${marker}"
  set +e
  run_bootstrap --uninstall >/dev/null 2>&1
  code=$?
  set -e
  [[ "${code}" -eq 1 ]] || fail "uninstall of foreign bundle ID exited ${code}, expected 1"
  [[ -f "${keep}" ]] || fail "uninstall deleted an app with a foreign bundle ID"
  set +e
  RFW_ARCHIVE="${archive}" run_bootstrap >/dev/null 2>&1
  code=$?
  set -e
  [[ "${code}" -eq 1 ]] || fail "install over foreign bundle ID exited ${code}, expected 1"
  [[ -f "${keep}" ]] || fail "install replaced an app with a foreign bundle ID"
  pass "foreign bundle ID with marker: uninstall and install refuse (exit 1), app intact"
fi

echo "All bootstrap checks passed."
