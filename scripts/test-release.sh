#!/usr/bin/env bash
# Tests for scripts/release.sh (CI runs this on Linux).
#
#   scripts/test-release.sh
#
# 1. Version arithmetic via `--print-next`.
# 2. `--dry-run` for dev and prod against the real checkout (must change nothing).
# 3. Full dev and prod flows in a throwaway repo below a temp dir, with a bare repo
#    as fake origin and fake `npm`/`gh` on PATH. The real remote is never touched.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release="${root}/scripts/release.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "ok   $*"
}

expect_eq() {
  [[ "$2" == "$3" ]] || fail "$1: expected '$3', got '$2'"
  pass "$1"
}

# --- 1. version arithmetic -------------------------------------------------
next() {
  local cur="$1"
  shift
  RFW_CURRENT_VERSION="${cur}" RFW_NOW="26.11" "${release}" --print-next "$@"
}

expect_eq "dev increments" "$(next 26.10.0-dev.0 dev)" "26.10.0-dev.1"
expect_eq "dev increments (two digits)" "$(next 26.10.1-dev.9 dev)" "26.10.1-dev.10"
expect_eq "dev after release continues at next MICRO" "$(next 26.10.0 dev)" "26.10.1-dev.0"
expect_eq "prod strips dev suffix" "$(next 26.10.0-dev.3 prod)" "26.10.0"
expect_eq "prod keeps MICRO" "$(next 26.10.2-dev.0 prod)" "26.10.2"
expect_eq "prod --new-month" "$(next 26.10.2-dev.4 prod --new-month)" "26.11.0"
if RFW_CURRENT_VERSION="26.10.0" "${release}" --print-next prod >/dev/null 2>&1; then
  fail "prod from a plain release must fail"
fi
pass "prod from a plain release fails"
if RFW_CURRENT_VERSION="nonsense" "${release}" --print-next dev >/dev/null 2>&1; then
  fail "invalid version must fail"
fi
pass "invalid version fails"

# --- 2. dry run on the real checkout ---------------------------------------
before="$(git -C "${root}" rev-parse HEAD)$(git -C "${root}" status --porcelain)"
cur="$(sed -n 's/^  "version": "\(.*\)",/\1/p' "${root}/package.json" | head -n 1)"
out="$("${release}" dev --dry-run)"
want="$(RFW_CURRENT_VERSION="${cur}" "${release}" --print-next dev)"
grep -qx "Version: ${want}" <<<"${out}" || fail "dev --dry-run did not print 'Version: ${want}'"
grep -q "git -C ${root} push" <<<"${out}" || fail "dev --dry-run did not list the push"
pass "dev --dry-run prints ${want}"
out="$("${release}" prod --dry-run)"
want="$(RFW_CURRENT_VERSION="${cur}" "${release}" --print-next prod)"
grep -qx "Version: ${want}" <<<"${out}" || fail "prod --dry-run did not print 'Version: ${want}'"
grep -q "gh pr merge" <<<"${out}" || fail "prod --dry-run did not list the merge"
pass "prod --dry-run prints ${want}"
out="$("${release}" prod --new-month --dry-run)"
grep -q '^Version: ' <<<"${out}" || fail "prod --new-month --dry-run printed no version"
pass "prod --new-month --dry-run"
after="$(git -C "${root}" rev-parse HEAD)$(git -C "${root}" status --porcelain)"
expect_eq "dry runs leave the checkout untouched" "${after}" "${before}"

# --- 3. full flows in a throwaway repo -------------------------------------
fakebin="${tmp}/bin"
mkdir -p "${fakebin}"
cat >"${fakebin}/npm" <<'NPM'
#!/usr/bin/env bash
# Fake `npm version <v> --no-git-tag-version`: rewrites the version in package*.json.
set -euo pipefail
[[ "$1" == "version" ]] || exit 1
for f in package.json package-lock.json; do
  [[ -f "${f}" ]] && sed -i.bak "s/^\(  \"version\": \"\).*\(\",\)/\1$2\2/" "${f}" && rm -f "${f}.bak"
done
exit 0
NPM
cat >"${fakebin}/gh" <<'GH'
#!/usr/bin/env bash
# Fake gh. `pr create` records the base; `pr merge` merges inside the bare fake origin.
set -euo pipefail
bare="${FAKE_ORIGIN}"
case "$1 $2" in
  "auth status") exit 0 ;;
  "pr create")
    head="" base=""
    while [[ $# -gt 0 ]]; do
      case "$1" in --head) head="$2"; shift ;; --base) base="$2"; shift ;; esac
      shift
    done
    echo "${base}" >"${FAKE_STATE}/$(echo "${head}" | tr / _).base"
    echo "https://example.invalid/pr/1"
    ;;
  "pr checks") exit 0 ;;
  "pr merge")
    head="$3"
    base="$(cat "${FAKE_STATE}/$(echo "${head}" | tr / _).base")"
    if [[ "$*" == *--rebase* ]]; then
      git -C "${bare}" merge-base --is-ancestor "refs/heads/${base}" "refs/heads/${head}"
      [[ -n "${FAKE_MERGE_NOOP:-}" ]] || git -C "${bare}" update-ref "refs/heads/${base}" "refs/heads/${head}"
    else
      tree="$(git -C "${bare}" merge-tree --write-tree "refs/heads/${base}" "refs/heads/${head}")"
      c="$(git -C "${bare}" commit-tree "${tree}" -p "refs/heads/${base}" -p "refs/heads/${head}" -m "Merge ${head}")"
      git -C "${bare}" update-ref "refs/heads/${base}" "${c}"
    fi
    ;;
  *) echo "fake gh: unsupported: $*" >&2; exit 1 ;;
esac
GH
chmod +x "${fakebin}/npm" "${fakebin}/gh"

git_id=(-c user.name=jcmx9 -c user.email=jcmx9@users.noreply.github.com)
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=jcmx9 GIT_AUTHOR_EMAIL=jcmx9@users.noreply.github.com
export GIT_COMMITTER_NAME=jcmx9 GIT_COMMITTER_EMAIL=jcmx9@users.noreply.github.com
export FAKE_ORIGIN="${tmp}/origin.git" FAKE_STATE="${tmp}/state"
mkdir -p "${FAKE_STATE}"

setup_repo() {
  rm -rf "${FAKE_ORIGIN}" "${tmp}/work"
  git init -q --bare -b main "${FAKE_ORIGIN}"
  git init -q -b main "${tmp}/work"
  mkdir -p "${tmp}/work/scripts"
  cp "${release}" "${tmp}/work/scripts/release.sh"
  printf '{\n  "name": "x",\n  "version": "26.10.0-dev.0",\n  "private": true\n}\n' >"${tmp}/work/package.json"
  cp "${tmp}/work/package.json" "${tmp}/work/package-lock.json"
  (
    cd "${tmp}/work"
    git "${git_id[@]}" add -A
    git "${git_id[@]}" commit -q -m init
    git remote add origin "${FAKE_ORIGIN}"
    git push -q origin main
    git checkout -q -b dev
    git push -q origin dev
  )
}

pkg_version() {
  git -C "$1" show "$2:package.json" | sed -n 's/^  "version": "\(.*\)",/\1/p'
}

run_release() {
  (cd "${tmp}/work" && PATH="${fakebin}:${PATH}" ./scripts/release.sh "$@")
}

setup_repo
run_release dev >/dev/null
expect_eq "dev: package.json bumped on origin/dev" "$(pkg_version "${FAKE_ORIGIN}" dev)" "26.10.0-dev.1"
git -C "${FAKE_ORIGIN}" rev-parse -q --verify refs/tags/v26.10.0-dev.1 >/dev/null || fail "dev: tag not pushed"
pass "dev: tag v26.10.0-dev.1 pushed"
expect_eq "dev: lock file bumped" "$(git -C "${FAKE_ORIGIN}" show dev:package-lock.json | sed -n 's/^  "version": "\(.*\)",/\1/p')" "26.10.0-dev.1"
expect_eq "dev: commit message" "$(git -C "${FAKE_ORIGIN}" log -1 --format=%s dev)" "release: 26.10.0-dev.1"

set +e
run_release dev >/dev/null 2>&1 <<<""
set -e
expect_eq "dev: second run bumps again" "$(pkg_version "${FAKE_ORIGIN}" dev)" "26.10.0-dev.2"

# precondition failures
echo dirty >"${tmp}/work/dirty.txt"
set +e
run_release dev >/dev/null 2>&1
code=$?
set -e
expect_eq "dirty tree exit code" "${code}" "4"
rm "${tmp}/work/dirty.txt"
git -C "${tmp}/work" checkout -q -b other
set +e
run_release dev >/dev/null 2>&1
code=$?
set -e
expect_eq "wrong branch exit code" "${code}" "3"
git -C "${tmp}/work" checkout -q dev

# prod
run_release prod >/dev/null
expect_eq "prod: main has the release version" "$(pkg_version "${FAKE_ORIGIN}" main)" "26.10.0"
git -C "${FAKE_ORIGIN}" rev-parse -q --verify refs/tags/v26.10.0 >/dev/null || fail "prod: tag not pushed"
expect_eq "prod: tag points at main" "$(git -C "${FAKE_ORIGIN}" rev-parse 'v26.10.0^{commit}')" "$(git -C "${FAKE_ORIGIN}" rev-parse main)"
expect_eq "prod: dev continues at next MICRO" "$(pkg_version "${FAKE_ORIGIN}" dev)" "26.10.1-dev.0"
git -C "${FAKE_ORIGIN}" merge-base --is-ancestor main dev || fail "prod: main not merged back into dev"
pass "prod: main merged back into dev"

# the release above is v26.10.0, so the same month would collide; pretend it is November
RFW_NOW=26.11 run_release prod --new-month >/dev/null 2>&1 || fail "prod --new-month failed"
want="26.11.0"
expect_eq "prod --new-month: version on main" "$(pkg_version "${FAKE_ORIGIN}" main)" "${want}"

# a wrong version on main must abort before tagging
setup_repo
set +e
FAKE_MERGE_NOOP=1 run_release prod >/dev/null 2>&1
code=$?
set -e
expect_eq "prod: wrong version on main aborts (exit code)" "${code}" "8"
if git -C "${FAKE_ORIGIN}" rev-parse -q --verify refs/tags/v26.10.0 >/dev/null; then
  fail "prod: tag must not exist after failed verification"
fi
pass "prod: no tag after failed verification"

echo "All release tests passed."
