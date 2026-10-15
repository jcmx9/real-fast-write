# Releasing rf-write

Versions use CalVer `YY.M.MICRO`. The single source is `version` in `package.json`.
Dev builds are `YY.M.MICRO-dev.N`. A tag `v<version>` triggers
`.github/workflows/release.yml`; a tag containing `-dev.` publishes a GitHub pre-release,
any other tag a normal release.

## Commands

```bash
./scripts/release.sh dev                 # pre-release from dev
./scripts/release.sh prod                # release dev -> main
./scripts/release.sh prod --new-month    # release with the current YY.M and MICRO 0
./scripts/release.sh dev --dry-run       # print the steps, change nothing
```

`--print-next dev|prod [--new-month]` prints only the next version.

### dev

Run on a clean, up-to-date `dev`. The script bumps `-dev.N` to `-dev.N+1`
(`npm version --no-git-tag-version`, so `package-lock.json` follows), commits
`release: <version>`, tags `v<version>` and pushes branch and tag with `git push --atomic`:
if `dev` is rejected, the tag is not published either. A rerun after a failed push sees
the local commit and tag and only repeats the push.

### prod

Run from a clean, up-to-date `dev` with `gh` authenticated. Every `gh` call uses
`-R <owner/repo>` (derived from the `origin` URL, override with `RFW_GH_REPO`), so the
working directory does not matter. Without `--new-month` the script warns when the release
would carry an older `YY.M` than today.

1. Branch `release/<version>` from `origin/main`. The dev commits that are not released yet
   (newer than the last release's `Release-Source`, not on `main`) are cherry-picked onto
   it; conflicts in the `version` lines of `package.json`/`package-lock.json` take the dev
   side, any other conflict aborts (exit 10). The branch must then match `origin/dev`
   except for those version lines. The release commit sets the version, rolls
   `CHANGELOG.md` (`## [Unreleased]` stays, `## [<version>] - <date>` is inserted below
   it) and records `Release-Source: <dev commit>`. Because the branch sits on top of
   `main`, GitHub's rebase-merge is conflict-free even though it rewrites the SHAs.
2. Pull request into `main`; the script polls until GitHub has registered the checks, then
   waits for them (`gh pr checks --watch --fail-fast`).
3. Rebase-merge.
4. Fetch `main` and verify that `package.json` on `main` equals the version. On a
   mismatch the script aborts before tagging.
5. Tag `v<version>` on `main`, push the tag (publishes the release).
6. Back-merge `chore/back-merge-<version>`: from `origin/dev`, a merge commit with `main`
   as second parent whose content is dev plus the release delta
   (`Release-Source..main`: version, CHANGELOG, hotfixes). Only conflicts in the version
   lines are resolved automatically; dev then gets the next `YY.M.(MICRO+1)-dev.0`. The
   PR into `dev` is merged with a merge commit.

Nothing is pushed on a failed precondition. The script aborts on every error.

`--dry-run` runs the local checks (branch, clean tree, `dev` against the last fetched
`origin/dev`, local tag, tools) and reports failures as warnings, without network access,
then prints the steps.

## Recovery

Each prod step checks whether an earlier run already did it, so after fixing the cause
(for example a failed check) run `./scripts/release.sh prod` again from `dev`:

| State found | Rerun does |
|---|---|
| `origin/release/<v>` exists with the version | reuses it |
| PR open / already merged | waits for checks and merges / skips the merge |
| `main` already has the version | skips to tagging |
| tag `v<v>` already on `origin` (on `main`, right version) | skips to the back-merge |
| `origin/chore/back-merge-<v>` exists | reuses it |
| `origin/dev` already contains `main` | skips the back-merge |

A local `release/<v>` or `chore/back-merge-<v>` branch that was never pushed is rebuilt.

**Exit 10 in the back-merge** (dev changed the same lines as `main` after the release was
cut): the release is published, nothing was pushed to `dev`. Finish by hand:

```bash
git checkout -b chore/back-merge-<v> origin/dev
git merge --no-ff origin/main          # resolve the conflicts (version lines and CHANGELOG may conflict too)
npm version <v+1>-dev.0 --no-git-tag-version --allow-same-version
git commit -am "chore(release): back-merge v<v> into dev"
git push -u origin chore/back-merge-<v>
gh pr create --base dev --head chore/back-merge-<v> --fill
```

Then merge the PR with a merge commit (not squash or rebase, so `main` stays an ancestor
of `dev`).

**Exit 10 while building the release branch**: a dev commit conflicts with `main` (for
example a hotfix on `main` that dev changed too). Merge `main` into `dev` by a PR, resolve
the conflict there, and start `prod` again.

## Exit codes

| Code | Meaning |
|------|---------|
| 2 | Usage error |
| 3 | Not on `dev` |
| 4 | Working tree not clean |
| 5 | `dev` differs from `origin/dev` |
| 6 | Missing tool, `gh` not logged in, fetch failed |
| 7 | Tag already exists (local or remote) and does not belong to this release |
| 8 | Invalid version, or wrong version on `main` |
| 9 | A step failed (including failed or missing PR checks) |
| 10 | Conflict outside the version lines (release branch or back-merge); nothing pushed for that step |

## Tests

`scripts/test-release.sh` checks the version arithmetic, the `--dry-run` output and runs
the flows in a throwaway repository with a bare fake origin and fake `npm`/`gh`. The fake
rebase-merge cherry-picks onto `main` with a new committer (new SHAs, like GitHub) and
refuses merge commits or conflicts. It runs dev → prod → dev → prod → prod `--new-month`,
resumes after failed checks, takes a hotfix back into dev, aborts a conflicting back-merge
cleanly and checks the atomic dev push. CI runs it on Linux together with
`release.sh dev --dry-run` and `prod --dry-run`.
