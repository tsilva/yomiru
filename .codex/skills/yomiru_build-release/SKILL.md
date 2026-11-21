---
name: yomiru_build-release
description: Build, publish, or verify a Yomiru hosted website and Stremio add-on release, or publish a validated staged subtitle library package. Use for Yomiru production releases and explicit push-live requests.
---

# Yomiru Build Release

Work from the canonical `tsilva/yomiru` checkout. Read the release policy in
[AGENTS.md](../../../AGENTS.md) and the shared `$private-skills_release-workflow`
skill. Read `$private-skills_push` before any Git push. Hosted releases use a
scoped `main` commit and the approved Runbox routes.

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
   authorized changes. Keep the manifest URL and ID stable. Reuse the chosen
   version when retrying the same release. If that version is already live,
   confirm the deployed commit and verify the feature.
2. Review and validate the scoped candidate. Use an isolated snapshot if the
   checkout contains concurrent changes. Include the manifest bump. Run the
   web build and applicable checks from `.github/workflows/ci.yml`. Stage only
   the intended changes, review the index, and commit on `main`.
3. Push the exact commit to the configured upstream using `$private-skills_push`
   and record the repository description result. Wait for successful `ci.yml`
   on the exact SHA, `main`, and `push` event. Follow the Production configuration
   sync guidance in the [publishing guide](../../../docs/publishing.md) when
   the release depends on changed configuration.
4. Read `.internal/reference/yomiru-vercel-production/README.md` and use the
   `vercel-production` Runbox profile. Run its `plan` with the committed `web`
   archive and full SHA. Confirm the SHA, version, CI run, and version readiness,
   then run `deploy` with the same inputs. Check the returned deployment with
   `status`. After an ambiguous write, inspect deployment state before retrying.
5. Verify the expected commit and version are `READY` on the production domain.
   Confirm the public manifest and exercise the changed feature there. For UI
   changes, use Brave and verify the relevant interaction and viewport sizes.
   Check public Stremio discovery for affected or representative titles.

## Publish a staged subtitle library

Use `.internal/reference/yomiru-library-production/README.md` and the approved
`vercel-library-production` profile. Verify that the pending package is validated
and matches the requested titles and active base revision. Use the runbook's
publisher to verify object bytes, activate the package, and check the public
revision. For subtitle-only releases, keep the current app manifest version.

Verify the live library listing, Stremio discovery and downloadable tracks for
the affected titles, and the selection summary or Practice when affected. If the
revision is already active, resume verification. If the base is stale, preserve
the package and validate a restaged candidate against the new live revision.
Episode preparation and semantic review follow the [episode release review](../../../docs/subtitle-quality.md#episode-release-review).
For reviewed English Practice, run the episode dry run and live replay so both
check compound peek spans. For a cue containing a compound and a second quiz
word, open the compound peek while the second word is tested. Confirm the
full kana and rōmaji readings and the gloss. Check that the peek disappears
when the compound is the target.

Use the configured Runbox checks and access policy for both routes. Report a
missing runbook, denied route, failed gate, or unverified publication with its
actual state. Report Git push, description reconciliation, and live verification
separately, with the version, commit or library revision, and CI link as applicable.
