"""Dispatch and verify an approved Yomiru release, or check sync reuse in Actions."""

import argparse
import fcntl
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

REPO = "tsilva/yomiru"
REPO_ID = 1462854175
OWNER_ID = 26742
API = f"repos/{REPO}/actions"
WORKFLOW = "production-delivery.yml"
SITE = "https://yomiru.tsilva.eu"
ADDON = "community.yomiru.published"
SHA = re.compile(r"[a-f0-9]{40}")
VERSION = re.compile(r"(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})")
MANIFEST_PATH = "web/public/manifest.json"
ROUTING_PATH = "web/vercel.json"
PACKAGE_PATH = "web/package.json"
LOCKFILE_PATH = "web/pnpm-lock.yaml"
SHARED_WEBSITE_BODIES = (
    "web/lib/browse.mjs", "web/lib/database.mjs", "web/lib/incremental-publication.mjs",
)
# Stremio handlers, their shared runtime modules, and files used to build or serve them.
# Update this list when adding a runtime dependency to the Stremio surface.
ADDON_INPUTS = (
    "web/api/catalogue.mjs", "web/api/library.mjs", "web/api/retired-subtitles.mjs",
    "web/api/subtitles.mjs", "web/db/incremental.sql", "web/db/schema.sql", "web/db/serving.sql",
    "web/db/subtitle-uploads.sql", "web/library-storage.json", PACKAGE_PATH,
    LOCKFILE_PATH, "web/pnpm-workspace.yaml", "web/public/assets/fox.png",
    "web/lib/ass-storage.mjs", "web/lib/browse.mjs", "web/lib/catalogue.mjs",
    "web/lib/compatibility-storage.mjs", "web/lib/compatibility.mjs", "web/lib/conjugations.mjs",
    "web/lib/database-feedback.mjs", "web/lib/database.mjs", "web/lib/episode-artwork.mjs",
    "web/lib/feedback-links.mjs", "web/lib/incremental-publication.mjs", "web/lib/jmdict.mjs",
    "web/lib/library.mjs", "web/lib/publication-io.mjs", "web/lib/published-library.mjs",
    "web/lib/r2-publication.mjs", "web/lib/r2.mjs", "web/lib/sentry-event.mjs",
    "web/lib/sentry-server.mjs", "web/lib/source-archive.mjs", "web/lib/storage-config.mjs",
    "web/lib/subtitle-cleanup.mjs", "web/lib/vocabulary.mjs", "web/src/library-episodes.mjs",
    "web/src/library-movies.mjs",
)
WORKFLOW_PINS = {
    "secret-scanning.yml": "0d0ba90f60d8f3affcb5d61941e9729367db4702",
    WORKFLOW: "22ae9ec7263f27ba0115d78bce448700273b0d7d",
}
TRUSTED_WORKFLOWS = {
    (f"tsilva/.github/.github/workflows/{name}@{pin}", pin)
    for name, pin in WORKFLOW_PINS.items()
}
SCAN_JOB = "Check committed secrets before Production sync / Scan committed secrets"
SYNC_JOB = "Sync Yomiru configuration to Production / deliver"
SYNC_STEP = "Fetch the caller's allowlisted secrets and sync Production"
PUBLISH_JOB = "Stage, verify, and publish the approved release"


class ReleaseError(Exception):
    pass


def run_url(run_id):
    return f"https://github.com/{REPO}/actions/runs/{run_id}"


def progress(message):
    print(message, file=sys.stderr, flush=True)


def command(args, operation, *, root=None, env=None, input=None):
    try:
        result = subprocess.run(args, cwd=root, env=env, input=input, capture_output=True,
                                text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ReleaseError(f"{operation} could not complete.") from error
    if result.returncode:
        raise ReleaseError(f"{operation} failed. Check the command and GitHub access.")
    return result.stdout


def api(path, env=None):
    return json.loads(command(["gh", "api", "--hostname", "github.com", path],
                              "Reading GitHub metadata", env=env))


def list_runs(read, workflow, sha, event):
    path = f"{API}/workflows/{workflow}/runs?head_sha={sha}&branch=main&event={event}&per_page=20"
    return [run for run in read(path)["workflow_runs"]
            if matches_run(run, workflow, sha, event)]


def matches_run(run, workflow, sha, event):
    return (run["path"] == f".github/workflows/{workflow}" and run["head_sha"] == sha
            and run["head_branch"] == "main" and run["event"] == event
            and run["repository"]["id"] == REPO_ID and run["head_repository"]["id"] == REPO_ID)


def owner_dispatch(run, sha):
    return (matches_run(run, WORKFLOW, sha, "workflow_dispatch") and run["actor"]["id"] == OWNER_ID
            and run["display_title"] == f"Release Yomiru {sha}")


def run_jobs(read, run):
    return read(f"{API}/runs/{run['id']}/attempts/{run['run_attempt']}/jobs")["jobs"]


def successful_job(jobs, name):
    return next((job for job in jobs
                 if job["name"] == name and job["conclusion"] == "success"), None)


def sync_step(jobs):
    job = successful_job(jobs, SYNC_JOB)
    return next((step for step in (job or {}).get("steps", [])
                 if step["name"] == SYNC_STEP and step["conclusion"] == "success"), None)


def find_reusable_sync(read, dispatch):
    sha = dispatch["head_sha"]
    if (not SHA.fullmatch(sha) or not owner_dispatch(dispatch, sha)
            or dispatch["triggering_actor"]["id"] != OWNER_ID or dispatch["run_attempt"] != 1):
        return None
    approved_at = datetime.fromisoformat(dispatch["created_at"])
    for automatic in list_runs(read, WORKFLOW, sha, "workflow_run"):
        pinned = {(ref["path"], ref["sha"]) for ref in automatic.get("referenced_workflows") or []}
        if automatic["conclusion"] != "success" or not TRUSTED_WORKFLOWS <= pinned:
            continue
        jobs = run_jobs(read, automatic)
        step = sync_step(jobs)
        if (successful_job(jobs, SCAN_JOB) and step
                and datetime.fromisoformat(step["started_at"]) >= approved_at):
            return automatic["id"]
    return None


def check_reuse():
    try:
        dispatch = api(f"{API}/runs/{int(os.environ['GITHUB_RUN_ID'])}")
        reused = find_reusable_sync(api, dispatch)
    except (ReleaseError, ValueError, KeyError, TypeError):
        reused = None
    if reused:
        print(f"Reusing the automatic scan and sync from {run_url(reused)}.")
    else:
        print("No qualifying automatic sync. Running the standard scan and sync.")
    with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
        print(f"reusable={'true' if reused else 'false'}", file=output)


def verify_retry_sync():
    run_id = int(os.environ["GITHUB_RUN_ID"])
    attempt = int(os.environ["GITHUB_RUN_ATTEMPT"])
    jobs = run_jobs(api, {"id": run_id, "run_attempt": attempt})
    if not sync_step(jobs) or not successful_job(jobs, SCAN_JOB):
        raise ReleaseError("This attempt needs a fresh scan and sync. Re-run all jobs.")


def wait_for(operation, timeout, description):
    deadline = time.monotonic() + timeout
    while True:
        result = operation()
        if result is not None:
            return result
        if time.monotonic() >= deadline:
            raise ReleaseError(
                f"Timed out waiting for {description}. Check GitHub and resume the same SHA.")
        time.sleep(5)


def completed(run):
    return run if run["status"] == "completed" else None


def require_success(run, stage):
    if run["conclusion"] != "success":
        raise ReleaseError(f"{stage} ended with {run['conclusion']}. See {run_url(run['id'])}.")


def existing_dispatch(read, sha):
    return next((run for run in list_runs(read, WORKFLOW, sha, "workflow_dispatch")
                 if owner_dispatch(run, sha)), None)


def public_json(path):
    try:
        with urlopen(SITE + path, timeout=15) as response:
            if response.geturl() != SITE + path:
                raise ReleaseError(f"Unexpected redirect from the public {path} endpoint.")
            return json.loads(response.read(2 * 1024 * 1024))
    except (URLError, TimeoutError, ValueError) as error:
        raise ReleaseError(f"Could not verify the public {path} endpoint.") from error


def manifest_version(manifest):
    version = manifest.get("version") if isinstance(manifest, dict) else None
    if (not isinstance(version, str) or manifest.get("id") != ADDON
            or not VERSION.fullmatch(version)):
        raise ReleaseError("Invalid Yomiru add-on identity or version.")
    return version


def committed_text(sha, path, root):
    return command(["git", "show", f"{sha}:{path}"], f"Reading {path} at {sha[:7]}", root=root)


def committed_json(sha, path, root):
    return json.loads(committed_text(sha, path, root))


def stremio_routing(config):
    # Practice page rewrites target the website and never serve Stremio routes.
    return {**config, "rewrites": [rule for rule in config.get("rewrites", [])
                                  if not (rule.get("destination") == "/index.html"
                                          and rule.get("source", "").endswith("/practice"))]}


def stremio_source_changed(path, base, candidate, root):
    contents = {
        key: committed_text(sha, path, root)
        for key, sha in (("base", base), ("candidate", candidate))
    }
    compare = Path(__file__).with_name("stremio-source.mjs")
    result = command(["node", str(compare)], f"Comparing Stremio source in {path}",
                     root=root, input=json.dumps({"path": path, **contents}))
    return result.strip() != "unchanged"


def committed_dependency_inputs(sha, root):
    runtime_sources = [path for path in ADDON_INPUTS if path.endswith(".mjs")]
    tracked = command(["git", "ls-tree", "-r", "--name-only", "-z", sha, "--", *runtime_sources],
                      f"Finding Stremio source files at {sha[:7]}", root=root)
    return {
        "manifest": committed_text(sha, PACKAGE_PATH, root),
        "lockfile": committed_text(sha, LOCKFILE_PATH, root),
        "sources": {path: committed_text(sha, path, root) for path in tracked.split("\0") if path},
    }


def stremio_dependencies_changed(base, candidate, root):
    payload = {key: committed_dependency_inputs(sha, root)
               for key, sha in (("base", base), ("candidate", candidate))}
    compare = Path(__file__).with_name("stremio-dependencies.mjs")
    result = command(["node", str(compare)], "Comparing resolved Stremio dependencies",
                     root=root, input=json.dumps(payload))
    return result.strip() != "unchanged"


def addon_changes(base, candidate, root, base_manifest, candidate_manifest):
    paths = command(["git", "diff", "--no-renames", "--name-status", "-z", base, candidate,
                     "--", ROUTING_PATH, *ADDON_INPUTS],
                    "Comparing the deployed and candidate add-on inputs", root=root)
    fields = iter(paths.split("\0")[:-1])
    statuses = {path: status for status, path in zip(fields, fields, strict=True)}
    changes = set(statuses)
    if statuses.get(ROUTING_PATH) == "M":
        if stremio_routing(committed_json(base, ROUTING_PATH, root)) == stremio_routing(
            committed_json(candidate, ROUTING_PATH, root)
        ):
            changes.remove(ROUTING_PATH)
    for path in SHARED_WEBSITE_BODIES:
        if statuses.get(path) == "M" and not stremio_source_changed(path, base, candidate, root):
            changes.remove(path)
    dependency_changes = changes & {PACKAGE_PATH, LOCKFILE_PATH}
    if (dependency_changes and all(statuses[path] == "M" for path in dependency_changes)
            and not stremio_dependencies_changed(base, candidate, root)):
        changes.difference_update(dependency_changes)
    if ({key: value for key, value in base_manifest.items() if key != "version"}
            != {key: value for key, value in candidate_manifest.items() if key != "version"}):
        changes.add(MANIFEST_PATH)
    return sorted(changes)


def check_manifest(candidate, live, kind):
    candidate_version = manifest_version(candidate)
    live_version = manifest_version(live)
    if kind == "website":
        if candidate != live:
            raise ReleaseError("A website release must keep the public Stremio manifest unchanged.")
        return
    candidate_parts = tuple(map(int, candidate_version.split(".")))
    live_parts = tuple(map(int, live_version.split(".")))
    if candidate_parts <= live_parts:
        raise ReleaseError(
            f"Add-on version {candidate_version} must be newer than public version {live_version}.")


def classify_release(base, candidate, root, live=None):
    if not SHA.fullmatch(base) or not SHA.fullmatch(candidate):
        raise ReleaseError("Supply the deployed and candidate full commit SHAs.")
    base_manifest = committed_json(base, MANIFEST_PATH, root)
    candidate_manifest = committed_json(candidate, MANIFEST_PATH, root)
    manifest_version(base_manifest)
    manifest_version(candidate_manifest)
    changes = addon_changes(base, candidate, root, base_manifest, candidate_manifest)
    if live is not None and live != base_manifest:
        raise ReleaseError("The public manifest does not match the deployed commit.")
    kind = "addon" if changes else "website"
    print(f"Detected {kind} release against {base[:7]}.")
    if changes:
        print("Changed add-on inputs:", *changes, sep="\n  ")
    if live is not None:
        check_manifest(candidate_manifest, live, kind)


def verify_public(manifest):
    version = manifest_version(manifest)
    if public_json("/manifest.json") != manifest:
        raise ReleaseError(f"Public manifest does not match the committed manifest ({version}).")
    series = public_json("/catalog/series/published-series.json")["metas"]
    tracks = public_json("/subtitles/series/tt0112159:1:1.json")["subtitles"]
    if (not isinstance(series, list) or not any(item.get("id") == "tt0112159" for item in series)
            or not isinstance(tracks, list) or not tracks
            or not all(str(track.get("url", "")).startswith("https://") for track in tracks)):
        raise ReleaseError("Representative Stremio catalogue or subtitle discovery did not match.")
    return {"manifest": version, "series": "tt0112159", "subtitleCount": len(tracks)}


def deployment_receipt(log, sha, version):
    pattern = rf"\bYOMIRU_RELEASE={sha} {re.escape(version)} (dpl_[a-zA-Z0-9]+)$"
    matches = set(re.findall(pattern, log, re.M))
    if len(matches) != 1:
        raise ReleaseError("Could not verify the exact deployment ID in the publish job log.")
    return matches.pop()


def dispatch_release(read, sha, env, journal):
    previous = existing_dispatch(read, sha)
    if previous:
        return previous
    journal.seek(0)
    if journal.read():
        progress("Checking GitHub for the previous dispatch attempt.")
    else:
        if read(f"repos/{REPO}/git/ref/heads/main")["object"]["sha"] != sha:
            raise ReleaseError("GitHub main changed before dispatch.")
        journal.write("Dispatch attempted\n")
        journal.flush()
        os.fsync(journal.fileno())
        try:
            response = command(["gh", "workflow", "run", WORKFLOW, "--repo", f"github.com/{REPO}",
                                "--ref", "main", "-f", f"release_sha={sha}"],
                               "Dispatching Production delivery", env=env)
            match = re.fullmatch(rf"{re.escape(run_url(''))}(\d+)", response.strip())
            if match:
                run = read(f"{API}/runs/{match[1]}")
                if owner_dispatch(run, sha):
                    return run
        except ReleaseError:
            progress("Dispatch response was inconclusive. Checking GitHub for the run.")
    return wait_for(lambda: existing_dispatch(read, sha), 45, "the single Production dispatch")


def release(sha):
    if not SHA.fullmatch(sha):
        raise ReleaseError("Supply the full approved 40-character main commit SHA.")
    root = Path(__file__).resolve().parents[2]
    branch = command(["git", "symbolic-ref", "--short", "HEAD"], "Checking local branch", root=root)
    if branch.strip() != "main":
        raise ReleaseError("Start the release from the canonical checkout on main.")
    manifest = committed_json(sha, MANIFEST_PATH, root)
    version = manifest_version(manifest)
    token_variables = {"GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"}
    env = {key: value for key, value in os.environ.items() if key not in token_variables}

    def read(path):
        return api(path, env)

    if read("user")["id"] != OWNER_ID:
        raise ReleaseError("The stored GitHub login must be the Yomiru repository owner.")
    remote_sha = read(f"repos/{REPO}/git/ref/heads/main")["object"]["sha"]
    if remote_sha != sha and not existing_dispatch(read, sha):
        raise ReleaseError("Push the approved commit to GitHub main before starting its release.")

    directory = root / ".local" / "release"
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / f"dispatch-{sha}").open("a+", encoding="utf-8") as journal:
        try:
            fcntl.flock(journal, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ReleaseError("Another local process is already handling this SHA.") from error
        progress(f"Waiting for exact-commit CI for {sha[:7]}.")
        ci = wait_for(lambda: next(iter(list_runs(read, "ci.yml", sha, "push")), None),
                      120, "the main push CI run")
        ci = wait_for(lambda: completed(read(f"{API}/runs/{ci['id']}")), 1200, "CI")
        require_success(ci, "CI")
        progress(f"CI passed. {run_url(ci['id'])}")
        run = dispatch_release(read, sha, env, journal)
        progress(f"Waiting for Production delivery. {run_url(run['id'])}")
        run = wait_for(lambda: completed(read(f"{API}/runs/{run['id']}")),
                       5400, "Production delivery")
        require_success(run, "Production delivery")
        try:
            job = successful_job(run_jobs(read, run), PUBLISH_JOB)
            if not job:
                raise ReleaseError("The publish job did not run successfully.")
            log = command(["gh", "run", "view", str(run["id"]), "--job", str(job["id"]),
                           "--log", "--repo", f"github.com/{REPO}"],
                          "Reading the final publish job log", env=env)
            deployment = deployment_receipt(log, sha, version)
            public = verify_public(manifest)
        except ReleaseError as error:
            raise ReleaseError(f"{error} See {run_url(run['id'])}.") from error
        print(json.dumps({
            "version": version, "sha": sha, "deployment": deployment, "public": public,
            "ci": run_url(ci["id"]), "release": run_url(run["id"]),
        }))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="mode", required=True)
    publish = subcommands.add_parser("publish", help="Publish an approved main commit")
    publish.add_argument("sha")
    validate = subcommands.add_parser("check-manifest", help="Compare with live JSON on stdin")
    validate.add_argument("manifest", type=Path)
    for mode, help_text in (
        ("classify", "Compare the add-on inputs of two commits without deploying"),
        ("check-release", "Detect the release kind and enforce its manifest policy"),
    ):
        classify = subcommands.add_parser(mode, help=help_text)
        classify.add_argument("base")
        classify.add_argument("candidate")
    subcommands.add_parser("reuse-sync", help="Check automatic sync evidence in GitHub Actions")
    subcommands.add_parser("verify-retry-sync", help="Check the current GitHub Actions retry")
    args = parser.parse_args()
    try:
        if args.mode == "publish":
            release(args.sha)
        elif args.mode == "check-manifest":
            manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
            check_manifest(manifest, json.load(sys.stdin), "website")
        elif args.mode in ("classify", "check-release"):
            live = json.load(sys.stdin) if args.mode == "check-release" else None
            if args.mode == "check-release":
                manifest_version(live)
            classify_release(args.base, args.candidate, Path(__file__).resolve().parents[2], live)
        elif args.mode == "reuse-sync":
            check_reuse()
        else:
            verify_retry_sync()
    except ReleaseError as error:
        parser.exit(1, f"{error}\n")
    except (KeyError, ValueError, TypeError):
        parser.exit(1, "Invalid release metadata. Inspect the matching GitHub run.\n")


if __name__ == "__main__":
    main()
