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
`release: <version>`, tags `v<version>` and pushes branch and tag.

### prod

Run from a clean, up-to-date `dev` with `gh` authenticated.

1. Branch `release/<version>` with the release version (`26.10.0-dev.3` -> `26.10.0`;
   `--new-month` uses the current local year and month with MICRO 0).
2. Pull request into `main`, wait for green checks (`gh pr checks --watch`).
3. Rebase-merge.
4. Fetch `main` and verify that `package.json` on `main` equals the version. On a
   mismatch the script aborts before tagging.
5. Tag `v<version>` on `main`, push the tag (publishes the release).
6. Back-merge PR `chore/back-merge-<version>` into `dev` that bumps dev to the next
   `YY.M.(MICRO+1)-dev.0`.

Nothing is pushed on a failed precondition. The script aborts on every error.

## Exit codes

| Code | Meaning |
|------|---------|
| 2 | Usage error |
| 3 | Not on `dev` |
| 4 | Working tree not clean |
| 5 | `dev` differs from `origin/dev` |
| 6 | Missing tool, `gh` not logged in, fetch failed |
| 7 | Tag already exists (local or remote) |
| 8 | Invalid version, or wrong version on `main` |
| 9 | A step failed |

## Tests

`scripts/test-release.sh` checks the version arithmetic, the `--dry-run` output and runs
both flows in a throwaway repository with a bare fake origin and fake `npm`/`gh`. CI runs
it on Linux together with `release.sh dev --dry-run` and `prod --dry-run`.
