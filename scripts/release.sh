#!/usr/bin/env bash
# rf-write release script (CalVer YY.M.MICRO, single source: package.json "version").
#
#   scripts/release.sh dev [--dry-run]
#   scripts/release.sh prod [--new-month] [--dry-run]
#   scripts/release.sh --print-next dev|prod [--new-month]
#
# dev   On `dev`: bump YY.M.MICRO-dev.N -> -dev.N+1, commit, tag v<version>, push
#       branch and tag (the tag builds a GitHub pre-release).
# prod  From `dev`: release branch -> PR into `main` -> wait for green checks ->
#       rebase-merge -> verify package.json on main -> tag on main -> push tag ->
#       back-merge PR into dev, which continues at the next MICRO as -dev.0.
#       --new-month switches to the current local YY.M with MICRO 0.
#
# --dry-run prints every step and changes nothing (no git state or network needed).
# Test hooks: RFW_CURRENT_VERSION overrides the version read from package.json,
# RFW_NOW="YY.M" overrides the clock, RFW_REMOTE names the remote (default: origin).
set -euo pipefail

readonly EXIT_USAGE=2
readonly EXIT_BRANCH=3
readonly EXIT_DIRTY=4
readonly EXIT_OUTDATED=5
readonly EXIT_TOOLING=6
readonly EXIT_TAG_EXISTS=7
readonly EXIT_VERSION=8
readonly EXIT_STEP=9

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
remote="${RFW_REMOTE:-origin}"
dry_run=0
new_month=0

die() {
  local code="$1"
  shift
  echo "Fehler: $*" >&2
  exit "${code}"
}

usage() {
  cat >&2 <<'USAGE'
Verwendung:
  scripts/release.sh dev [--dry-run]
  scripts/release.sh prod [--new-month] [--dry-run]
  scripts/release.sh --print-next dev|prod [--new-month]
USAGE
  exit "${EXIT_USAGE}"
}

# Run a mutating command, or only print it in dry-run mode.
run() {
  if [[ "${dry_run}" -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    "$@" || die "${EXIT_STEP}" "Schritt fehlgeschlagen: $*"
  fi
}

step() {
  echo "==> $*"
}

read_version_from_json() {
  sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

current_version() {
  if [[ -n "${RFW_CURRENT_VERSION:-}" ]]; then
    echo "${RFW_CURRENT_VERSION}"
    return
  fi
  local v
  v="$(read_version_from_json <"${root}/package.json")"
  [[ -n "${v}" ]] || die "${EXIT_VERSION}" "Keine Version in package.json gefunden."
  echo "${v}"
}

# Split "YY.M.MICRO[-dev.N]" into the globals v_year v_month v_micro v_dev.
parse_version() {
  local re='^([0-9]{2})\.([0-9]{1,2})\.([0-9]+)(-dev\.([0-9]+))?$'
  [[ "$1" =~ ${re} ]] || die "${EXIT_VERSION}" "Ungültige Version '$1' (erwartet YY.M.MICRO oder YY.M.MICRO-dev.N)."
  v_year="${BASH_REMATCH[1]}"
  v_month="${BASH_REMATCH[2]}"
  v_micro="${BASH_REMATCH[3]}"
  v_dev="${BASH_REMATCH[5]:-}"
}

# Next dev version: -dev.N -> -dev.N+1; a plain release continues at MICRO+1 -dev.0.
next_dev_version() {
  parse_version "$1"
  if [[ -n "${v_dev}" ]]; then
    echo "${v_year}.${v_month}.${v_micro}-dev.$((v_dev + 1))"
  else
    echo "${v_year}.${v_month}.$((v_micro + 1))-dev.0"
  fi
}

# Release version for a dev version; --new-month ($2 = 1) uses the current YY.M with MICRO 0.
next_prod_version() {
  parse_version "$1"
  [[ -n "${v_dev}" ]] || die "${EXIT_VERSION}" "Version '$1' ist bereits ein Release; prod startet von einer -dev.N-Version."
  if [[ "${2:-0}" -eq 1 ]]; then
    local now="${RFW_NOW:-$(date +%y.%-m)}"
    local re='^[0-9]{2}\.[0-9]{1,2}$'
    [[ "${now}" =~ ${re} ]] || die "${EXIT_VERSION}" "Ungültiges Datum '${now}' (erwartet YY.M)."
    echo "${now}.0"
  else
    echo "${v_year}.${v_month}.${v_micro}"
  fi
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || die "${EXIT_TOOLING}" "'$1' wurde nicht gefunden."
}

require_branch() {
  local branch
  branch="$(git -C "${root}" rev-parse --abbrev-ref HEAD)"
  [[ "${branch}" == "dev" ]] || die "${EXIT_BRANCH}" "Release nur auf dem Branch 'dev' (aktuell: '${branch}')."
}

require_clean_tree() {
  [[ -z "$(git -C "${root}" status --porcelain)" ]] || die "${EXIT_DIRTY}" "Arbeitsverzeichnis ist nicht sauber; erst committen oder stashen."
}

require_up_to_date() {
  git -C "${root}" fetch --quiet "${remote}" || die "${EXIT_TOOLING}" "git fetch ${remote} fehlgeschlagen."
  local local_sha remote_sha
  local_sha="$(git -C "${root}" rev-parse HEAD)"
  remote_sha="$(git -C "${root}" rev-parse "${remote}/dev" 2>/dev/null)" || die "${EXIT_OUTDATED}" "${remote}/dev existiert nicht."
  [[ "${local_sha}" == "${remote_sha}" ]] || die "${EXIT_OUTDATED}" "'dev' stimmt nicht mit ${remote}/dev überein; erst pullen bzw. pushen."
}

require_tag_free() {
  local tag="$1"
  if git -C "${root}" rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
    die "${EXIT_TAG_EXISTS}" "Tag ${tag} existiert bereits lokal."
  fi
  if [[ -n "$(git -C "${root}" ls-remote --tags "${remote}" "refs/tags/${tag}")" ]]; then
    die "${EXIT_TAG_EXISTS}" "Tag ${tag} existiert bereits auf ${remote}."
  fi
}

preconditions() {
  if [[ "${dry_run}" -eq 1 ]]; then
    step "Prüfe Voraussetzungen (Branch dev, sauberer Baum, aktuell mit ${remote}, Tag frei) [dry-run: übersprungen]"
    return
  fi
  step "Prüfe Voraussetzungen"
  require_tool git
  require_tool npm
  require_branch
  require_clean_tree
  require_up_to_date
}

set_version() {
  # Updates package.json and package-lock.json, then commits both.
  local version="$1" message="$2"
  run npm version "${version}" --no-git-tag-version --allow-same-version
  local files=(package.json)
  if [[ "${dry_run}" -eq 1 || -f "${root}/package-lock.json" ]]; then
    files+=(package-lock.json)
  fi
  run git -C "${root}" add -- "${files[@]}"
  run git -C "${root}" commit -m "${message}"
}

release_dev() {
  local cur next
  cur="$(current_version)"
  next="$(next_dev_version "${cur}")"
  echo "Version: ${next}"
  preconditions
  [[ "${dry_run}" -eq 1 ]] || require_tag_free "v${next}"
  step "Bump ${cur} -> ${next}"
  run_in_root set_version "${next}" "release: ${next}"
  step "Tag v${next} und Push (löst Pre-Release-Workflow aus)"
  run git -C "${root}" tag -a "v${next}" -m "Release ${next}"
  run git -C "${root}" push "${remote}" dev "v${next}"
  echo "Fertig: v${next} wurde veröffentlicht."
}

# npm must run inside the repo root.
run_in_root() {
  (cd "${root}" && "$@")
}

release_prod() {
  local cur version next_dev tag release_branch back_branch
  cur="$(current_version)"
  version="$(next_prod_version "${cur}" "${new_month}")"
  next_dev="$(next_dev_version "${version}")"
  tag="v${version}"
  release_branch="release/${version}"
  back_branch="chore/back-merge-${version}"
  echo "Version: ${version}"
  preconditions
  if [[ "${dry_run}" -eq 0 ]]; then
    require_tool gh
    gh auth status >/dev/null 2>&1 || die "${EXIT_TOOLING}" "gh ist nicht angemeldet (gh auth login)."
    require_tag_free "${tag}"
  else
    step "Prüfe gh auth status und Tag ${tag} [dry-run: übersprungen]"
  fi

  step "Release-Branch ${release_branch} mit Version ${version}"
  run git -C "${root}" checkout -b "${release_branch}"
  run_in_root set_version "${version}" "release: ${version}"
  run git -C "${root}" push -u "${remote}" "${release_branch}"

  step "Pull Request ${release_branch} -> main"
  run gh pr create --base main --head "${release_branch}" --title "release: ${version}" --body "Release ${version}"
  step "Warte auf grüne Checks"
  run gh pr checks "${release_branch}" --watch --fail-fast
  step "Rebase-Merge nach main"
  run gh pr merge "${release_branch}" --rebase --delete-branch

  step "Prüfe package.json auf ${remote}/main"
  if [[ "${dry_run}" -eq 1 ]]; then
    echo "[dry-run] git fetch ${remote} main; erwarte Version ${version} in ${remote}/main:package.json"
  else
    git -C "${root}" fetch --quiet "${remote}" main || die "${EXIT_TOOLING}" "git fetch ${remote} main fehlgeschlagen."
    local on_main
    on_main="$(git -C "${root}" show "${remote}/main:package.json" | read_version_from_json)"
    [[ "${on_main}" == "${version}" ]] || die "${EXIT_VERSION}" "package.json auf main hat Version '${on_main}', erwartet '${version}'. Kein Tag gesetzt."
  fi

  step "Tag ${tag} auf main und Push"
  run git -C "${root}" tag -a "${tag}" -m "Release ${version}" "${remote}/main"
  run git -C "${root}" push "${remote}" "${tag}"

  step "Zurück nach dev: ${back_branch}, dev -> ${next_dev}"
  run git -C "${root}" checkout -b "${back_branch}" "${remote}/main"
  run_in_root set_version "${next_dev}" "chore(release): start ${next_dev}"
  run git -C "${root}" push -u "${remote}" "${back_branch}"
  run gh pr create --base dev --head "${back_branch}" --title "chore(release): back-merge ${version}" --body "Merge ${tag} back into dev; dev continues at ${next_dev}."
  run gh pr checks "${back_branch}" --watch --fail-fast
  run gh pr merge "${back_branch}" --merge --delete-branch
  run git -C "${root}" checkout dev
  run git -C "${root}" pull --ff-only "${remote}" dev
  echo "Fertig: ${tag} veröffentlicht, dev steht auf ${next_dev}."
}

main() {
  local cmd="" print_next=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      dev | prod)
        if [[ -n "${print_next}" && "${print_next}" == "?" ]]; then print_next="$1"; else cmd="$1"; fi
        ;;
      --print-next) print_next="?" ;;
      --new-month) new_month=1 ;;
      --dry-run) dry_run=1 ;;
      -h | --help) usage ;;
      *) echo "Unbekannte Option: $1" >&2; usage ;;
    esac
    shift
  done

  if [[ "${print_next}" == "?" ]]; then usage; fi
  if [[ -n "${print_next}" ]]; then
    case "${print_next}" in
      dev) next_dev_version "$(current_version)" ;;
      prod) next_prod_version "$(current_version)" "${new_month}" ;;
    esac
    return
  fi

  if [[ "${new_month}" -eq 1 && "${cmd}" != "prod" ]]; then
    die "${EXIT_USAGE}" "--new-month ist nur mit 'prod' erlaubt."
  fi
  case "${cmd}" in
    dev) release_dev ;;
    prod) release_prod ;;
    *) usage ;;
  esac
}

main "$@"
