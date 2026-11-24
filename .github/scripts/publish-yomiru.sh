#!/usr/bin/env bash
set -euo pipefail

site=yomiru.tsilva.eu
project=prj_XOoHoudrOS7bHy5wrqPSGJivsKXM
team=team_eE2Iv7IMqPOx8ZVN2xNfR2f0
sha="${YOMIRU_RELEASE_SHA:-}"

fail() { printf '%s\n' "$*" >&2; exit 1; }

[[ "${GITHUB_EVENT_NAME:-}" == workflow_dispatch && "${GITHUB_REF:-}" == refs/heads/main &&
   "${GITHUB_REPOSITORY_ID:-}" == 1462854175 && "${GITHUB_ACTOR_ID:-}" == 26742 &&
   "${GITHUB_TRIGGERING_ACTOR:-}" == tsilva && "$sha" =~ ^[0-9a-f]{40}$ &&
   "$sha" == "${GITHUB_SHA:-}" && "$(git rev-parse HEAD)" == "$sha" ]] ||
  fail 'Dispatch this workflow as the owner with the exact approved main commit.'
[[ -n "${VERCEL_TOKEN:-}" ]] || fail 'Missing the GitHub Production VERCEL_TOKEN.'

verify_main() {
  local current_sha
  current_sha="$(gh api repos/tsilva/yomiru/git/ref/heads/main --jq .object.sha)"
  [[ "$current_sha" == "$sha" ]] || fail 'GitHub main changed during release.'
}

vercel_json() { vercel api "$1" 2>/dev/null; }

deployment_is() {
  jq -e --arg id "$1" --arg project "$project" --arg sha "$sha" --arg version "$version" '
    .id == $id and .projectId == $project and .target == "production"
    and .meta.yomiruReleaseCommit == $sha and .meta.yomiruReleaseVersion == $version
  ' >/dev/null
}

public_manifest() { curl -fsS --max-time 15 "https://$site/manifest.json"; }

check_manifest() {
  public_manifest | python3 .github/scripts/release_yomiru.py check-manifest "$manifest"
}

check_release() {
  local base
  base="$(jq -er '.meta.yomiruReleaseCommit | strings | select(test("^[a-f0-9]{40}$"))' <<< "$1")" ||
    fail 'Cannot verify the source commit of the live deployment.'
  public_manifest | python3 .github/scripts/release_yomiru.py check-release "$base" "$sha" \
    --summary "$GITHUB_STEP_SUMMARY"
}

report_release() {
  printf 'Yomiru is live at https://%s/ (%s, Stremio add-on %s)\n' "$site" "$1" "$version" |
    tee -a "$GITHUB_STEP_SUMMARY"
  printf 'YOMIRU_RELEASE=%s %s %s\n' "$sha" "$version" "$1"
}

live_deployment() {
  vercel_json "/v4/aliases/$site?teamId=$team" |
    jq -er --arg project "$project" 'select(.projectId == $project) | .deploymentId |
      select(test("^dpl_[A-Za-z0-9]+$"))'
}

live_release() {
  vercel_json "/v13/deployments/$1?teamId=$team" |
    jq -e --arg id "$1" --arg project "$project" '
      select(.id == $id and .projectId == $project and .target == "production"
        and .readyState == "READY" and (.aliasError | not))'
}

verify_public_release() {
  local id="$1"
  for _ in {1..24}; do
    if [[ "$(live_deployment)" == "$id" ]] && check_manifest 2>/dev/null; then
      report_release "$id"
      return
    fi
    sleep 5
  done
  fail 'The release is not confirmed on the public domain. Inspect the deployment before retrying.'
}

verify_main
archive="$(mktemp -d "$RUNNER_TEMP/yomiru-web.XXXXXXXX")"
trap 'rm -rf -- "$archive"' EXIT
git archive --format=tar "$sha:web" | tar -xf - -C "$archive"
manifest="$archive/public/manifest.json"
version="$(jq -er 'select(.id == "community.yomiru.published") | .version | strings' "$manifest")"
current_id="$(live_deployment)" || fail 'Cannot verify the current Vercel production domain.'
current_release="$(live_release "$current_id")" || fail 'Cannot verify the live release metadata.'
if deployment_is "$current_id" <<< "$current_release"; then
  printf '## Release classification\n\nAlready deployed. This retry verifies the existing release.\n\n' \
    >> "$GITHUB_STEP_SUMMARY"
  verify_public_release "$current_id"
  exit 0
fi
check_release "$current_release"

mkdir "$archive/.vercel"
vercel_json "/v9/projects/$project?teamId=$team" |
  jq -e --arg project "$project" --arg team "$team" '
    select(.id == $project and .accountId == $team and .name == "yomiru" and .rootDirectory == null
      and (.link.repoId | tostring) == "1462854175" and .link.org == "tsilva" and .link.repo == "yomiru")
    | {projectId: .id, orgId: .accountId, projectName: .name}
  ' > "$archive/.vercel/project.json" || fail 'Cannot verify the linked Yomiru Vercel project.'

# Reuse an in-progress or staged build for this exact release on a rerun.
deployments="$(vercel_json "/v6/deployments?teamId=$team&projectId=$project&target=production&limit=20&meta-yomiruReleaseCommit=$sha")" ||
  fail 'Cannot check for an existing deployment before submitting.'
id="$(jq -r --arg sha "$sha" --arg version "$version" '
  [.deployments[] | select(.meta.yomiruReleaseCommit == $sha and .meta.yomiruReleaseVersion == $version
     and (.readyState | IN("QUEUED", "INITIALIZING", "BUILDING", "READY")))]
    | first | .uid // ""
' <<< "$deployments")"
if [[ -z "$id" ]]; then
  verify_main
  result="$(cd "$archive" && vercel deploy --prod --skip-domain --archive=tgz --yes --non-interactive \
    --meta "yomiruReleaseCommit=$sha" --meta "yomiruReleaseVersion=$version")"
  id="$(jq -er 'select(.status == "ok") | .deployment.id' <<< "$result")"
fi
[[ "$id" =~ ^dpl_[A-Za-z0-9]+$ ]] || fail 'Vercel did not return a recognized deployment ID.'
printf 'Vercel deployment %s for %s\n' "$id" "$sha"

for _ in {1..45}; do
  deployment="$(vercel_json "/v13/deployments/$id?teamId=$team")" || fail 'Cannot read the staged deployment.'
  deployment_is "$id" <<< "$deployment" || fail 'The staged deployment does not match the approved release.'
  state="$(jq -r .readyState <<< "$deployment")"
  case "$state" in
    READY) break ;;
    QUEUED|INITIALIZING|BUILDING) sleep 10 ;;
    ERROR|CANCELED) fail "Vercel build stopped in state $state." ;;
    *) fail 'Vercel returned an unknown build state.' ;;
  esac
done
[[ "$state" == READY ]] || fail 'Timed out waiting for the staged build.'

current_id="$(live_deployment)" || fail 'Cannot verify the current Vercel production domain.'
if [[ "$current_id" != "$id" ]]; then
  current_release="$(live_release "$current_id")" || fail 'Cannot verify the live release metadata.'
  check_release "$current_release"
  verify_main
  [[ "$(live_deployment)" == "$current_id" ]] || fail 'The live deployment changed before promotion.'
  vercel api "/v10/projects/$project/promote/$id?teamId=$team" --method POST >/dev/null
fi

verify_public_release "$id"
