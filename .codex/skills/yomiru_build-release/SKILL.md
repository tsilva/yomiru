---
name: yomiru_build-release
description: Build, publish, or verify a Yomiru hosted website and Stremio add-on release, or publish a validated staged subtitle library package. Use for Yomiru production releases and explicit push-live requests.
---

# Yomiru Build Release

Work from the canonical `tsilva/yomiru` checkout. Read the release policy in
[AGENTS.md](../../../AGENTS.md) and the shared `$private-skills_release-workflow`
skill. Read `$private-skills_push` before any Git push. Hosted releases use a
scoped `main` commit and the manual GitHub Actions production release. Subtitle
packages use the approved Runbox publishing route.

## Select the scope

- For a status request or bare invocation, inspect the published version,
  deployment, and relevant CI. For a local build, run `pnpm run build` in `web/`
  and report the result. Production publication requires an explicit owner request.
- For publication, resolve the authorized scope from the request and
  `AGENTS.md`. A named fix limits the release to that fix. A general push-live
  request also covers the validated package at `.local/release/pending-library.json`
  when present. Publish and verify the app first when both are in scope.
- Check the current branch, upstream, worktree, active publication, and any
  release already underway. The app route requires the exact current GitHub
  `main` tip. If its unreleased commits exceed the requested scope, resolve
  that dependency before submitting the deployment. Preserve other work.

## Release the hosted app

1. Read the [public manifest](https://yomiru.tsilva.eu/manifest.json) and
   `web/public/manifest.json`. Apply the `AGENTS.md` version rules to the
   authorized changes. Keep the whole manifest for website-only releases. Bump
   the version only if the release changes the Stremio add-on, including mixed
   releases. Keep the manifest URL and ID stable. Identify the live release by
   deployed commit and deployment ID. To preview the automatic classification
   for two commits, run `python3 .github/scripts/release_yomiru.py classify LIVE_SHA CANDIDATE_SHA`.
   Reuse the commit and manifest when retrying the same release.
2. Review and validate the scoped candidate. Use an isolated snapshot if the
   checkout contains concurrent changes. Include the version bump for add-on
   releases. Run the web build and applicable checks from
   `.github/workflows/ci.yml`. Stage only the intended changes, review the index,
   and commit on `main`.
3. Push the exact commit to the configured upstream using `$private-skills_push`
   and record the repository description result. A main push only syncs Production
   configuration.
4. After explicit push-live approval, run
   `python3 .github/scripts/release_yomiru.py publish FULL_SHA` once. The command waits
   for exact-commit main push CI, dispatches Production delivery or resumes
   its matching run. Production delivery detects the release kind and verifies
   the version. The command prints the verified deployment ID, manifest, and
   representative Stremio discovery in one receipt. Follow the command through
   completion. On interruption or an ambiguous dispatch, resume the same SHA.
   Use the [publishing guide](../../../docs/publishing.md) for deliberate retries.
5. Exercise the changed feature on production. For UI changes, use Brave and
   verify the relevant interaction and viewport sizes. Check affected Stremio
   titles when the representative discovery check does not cover them.

## Publish a staged subtitle library

Use `.internal/reference/yomiru-library-production/README.md` and the approved
`vercel-library-production` profile. Verify that the pending package is validated
and matches the requested titles and active base revision. Use the runbook's
publisher to verify object bytes, activate the package, and check the public
revision. For subtitle-only releases, keep the current Stremio manifest version.

Verify the live library listing, Stremio discovery and downloadable tracks for
the affected titles, and the selection summary or Practice when affected. If the
revision is already active, resume verification. If the base is stale, preserve
the package and validate a restaged candidate against the new live revision.
Episode preparation and semantic review follow the [episode release review](../../../docs/subtitle-quality.md#episode-release-review).
For reviewed English Practice, run the episode dry run and live replay so both
check compound peek spans. For a cue containing a compound and a second quiz
word, open the compound peek while the second word is tested. Confirm the
full kana and rōmaji readings and the gloss. Check that the peek disappears
when the compound is the target. Include a compound with an existing
component peek. Test a question outside the compound for the full gloss and
a question inside it for the remaining non-target component peeks.

Use the configured Runbox checks and access policy for both routes. Report a
missing runbook, denied route, failed gate, or unverified publication with its
actual state. Report Git push, description reconciliation, and live verification
separately, with the version, commit or library revision, and CI link as applicable.
