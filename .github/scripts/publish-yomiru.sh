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

check_version() {
  python3 - "$1" "$2" <<'PY'
import re
import sys

def version(text):
    if not re.fullmatch(r"(0|[1-9][0-9]{0,5})(\.(0|[1-9][0-9]{0,5})){2}", text):
        sys.exit("Invalid manifest version.")
    return tuple(map(int, text.split(".")))

candidate, live = map(version, sys.argv[1:])
if candidate <= live:
    sys.exit("The candidate manifest must be newer than the live manifest.")
PY
}

vercel_json() { vercel api "$1" 2>/dev/null; }

deployment_is() {
  jq -e --arg id "$1" --arg project "$project" --arg sha "$sha" --arg version "$version" '
    .id == $id and .projectId == $project and .target == "production"
    and .meta.yomiruReleaseCommit == $sha and .meta.yomiruReleaseVersion == $version
  ' >/dev/null
}

public_version() {
  curl -fsS --max-time 15 "https://$site/manifest.json" |
    jq -er 'select(.id == "community.yomiru.published") | .version'
}

live_deployment() {
  vercel_json "/v4/aliases/$site?teamId=$team" |
    jq -er --arg project "$project" 'select(.projectId == $project) | .deploymentId |
      select(test("^dpl_[A-Za-z0-9]+$"))'
}

verify_main
archive="$(mktemp -d "$RUNNER_TEMP/yomiru-web.XXXXXXXX")"
trap 'rm -rf -- "$archive"' EXIT
git archive --format=tar "$sha:web" | tar -xf - -C "$archive"
version="$(jq -er 'select(.id == "community.yomiru.published") | .version' "$archive/public/manifest.json")"
deployed_version="$(public_version)"
current_id="$(live_deployment)" || fail 'Cannot verify the current Vercel production domain.'
if [[ "$deployed_version" == "$version" ]]; then
  vercel_json "/v13/deployments/$current_id?teamId=$team" |
    jq -e 'select(.readyState == "READY" and (.aliasError | not))' |
    deployment_is "$current_id" ||
    fail 'This manifest version is already live on a different candidate.'
  printf 'Yomiru %s already live at %s (%s)\n' "$version" "$site" "$current_id"
  exit 0
fi
check_version "$version" "$deployed_version"

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

if [[ "$(live_deployment)" != "$id" ]]; then
  verify_main
  check_version "$version" "$(public_version)"
  vercel api "/v10/projects/$project/promote/$id?teamId=$team" --method POST >/dev/null
fi

for _ in {1..24}; do
  if [[ "$(live_deployment)" == "$id" && "$(public_version)" == "$version" ]]; then
    printf 'Yomiru %s is live at https://%s/ (%s)\n' "$version" "$site" "$id" |
      tee -a "$GITHUB_STEP_SUMMARY"
    exit 0
  fi
  sleep 5
done
fail 'The release is not confirmed on the public domain. Inspect the deployment before retrying.'
