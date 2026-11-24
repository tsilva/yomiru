import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

script = Path(__file__).resolve().parents[1] / ".github/scripts/release_yomiru.py"
spec = importlib.util.spec_from_file_location("release_yomiru", script)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

SHA = "1" * 40
REPO = {"id": release.REPO_ID}


def run(event, **changes):
    return {
        "id": 1, "run_attempt": 1, "path": ".github/workflows/production-delivery.yml",
        "head_branch": "main", "head_sha": SHA, "event": event, "repository": REPO,
        "head_repository": REPO, "actor": {"id": release.OWNER_ID},
        "triggering_actor": {"id": release.OWNER_ID}, "conclusion": "success",
        "created_at": "2026-11-23T12:00:00Z", "display_title": f"Release Yomiru {SHA}",
        **changes,
    }


class ReleaseDeliveryTests(unittest.TestCase):
    def test_reuse_checks_match_the_pinned_workflows_and_sync_job(self):
        workflow = script.parents[1] / "workflows" / release.WORKFLOW
        source = workflow.read_text(encoding="utf-8")
        for path, _ in release.TRUSTED_WORKFLOWS:
            self.assertIn(f"uses: {path}\n", source)
        self.assertIn(f"name: {release.SYNC_JOB.removesuffix(' / deliver')}\n", source)

    def test_reuse_requires_successful_pinned_jobs_and_a_settings_fetch_after_dispatch(self):
        trusted = [{"path": path, "sha": sha} for path, sha in release.TRUSTED_WORKFLOWS]
        automatic = run("workflow_run", id=2, referenced_workflows=trusted)
        dispatch = run("workflow_dispatch")
        step = {"name": release.SYNC_STEP, "conclusion": "success",
                "started_at": "2026-11-23T12:00:01Z"}
        jobs = [{"name": release.SCAN_JOB, "conclusion": "success"},
                {"name": release.SYNC_JOB, "conclusion": "success", "steps": [step]}]

        def read(path):
            if "/workflows/" in path:
                return {"workflow_runs": [automatic]}
            self.assertTrue(path.endswith("/runs/2/attempts/1/jobs"))
            return {"jobs": jobs}

        self.assertEqual(release.find_reusable_sync(read, dispatch), 2)
        for entry in (
            {"head_sha": "2" * 40}, {"conclusion": "failure"}, {"head_repository": {"id": 0}},
            {"referenced_workflows": trusted[:-1]}, {"event": "workflow_dispatch"},
        ):
            with self.subTest(entry=entry), patch.dict(automatic, entry):
                self.assertIsNone(release.find_reusable_sync(read, dispatch))
        with patch.dict(dispatch, {"run_attempt": 2}):
            self.assertIsNone(release.find_reusable_sync(read, dispatch))
        with patch.dict(step, {"started_at": "2026-11-23T11:59:59Z"}):
            self.assertIsNone(release.find_reusable_sync(read, dispatch))
        with patch.dict(step, {"conclusion": "skipped"}):
            self.assertIsNone(release.find_reusable_sync(read, dispatch))
        with patch.dict(jobs[0], {"conclusion": "failure"}):
            self.assertIsNone(release.find_reusable_sync(read, dispatch))

    def test_dispatch_recovers_a_lost_response_without_a_second_write(self):
        found = run("workflow_dispatch", id=9)
        checks = iter([[], [found], [found]])

        def read(path):
            if "/workflows/" in path:
                return {"workflow_runs": next(checks)}
            return {"object": {"sha": SHA}}

        manifest = {"id": release.ADDON, "version": "0.65.0"}
        with tempfile.TemporaryFile(mode="w+") as journal, patch.object(
            release, "command", side_effect=release.ReleaseError("ambiguous dispatch"),
        ) as command, patch.object(release, "public_json", return_value=manifest):
            self.assertEqual(release.dispatch_release(read, SHA, "0.65.1", {}, journal), found)
            self.assertEqual(release.dispatch_release(read, SHA, "0.65.1", {}, journal), found)
            command.assert_called_once()

    def test_recorded_dispatch_attempt_is_looked_up_without_resubmitting(self):
        found = run("workflow_dispatch", id=9)
        checks = iter([[], [found]])
        def read(_):
            return {"workflow_runs": next(checks)}

        with (tempfile.TemporaryFile(mode="w+") as journal,
              patch.object(release, "command") as command):
            journal.write("Dispatch attempted\n")
            result = release.dispatch_release(read, SHA, "0.65.1", {}, journal)
            self.assertEqual(result, found)
            command.assert_not_called()

    def test_deployment_receipt_requires_the_exact_commit_and_version(self):
        marker = f"publish\tYOMIRU_RELEASE={SHA} 0.65.1 dpl_123\n"
        self.assertEqual(release.deployment_receipt(marker, SHA, "0.65.1"), "dpl_123")
        bad_logs = ("", marker.replace("0.65.1", "0.65.2"),
                    marker + marker.replace("dpl_123", "dpl_456"))
        for log in bad_logs:
            with self.subTest(log=log), self.assertRaises(release.ReleaseError):
                release.deployment_receipt(log, SHA, "0.65.1")

    def test_command_resumes_an_existing_dispatch_and_returns_a_verified_receipt(self):
        ci = run("push", id=2, path=".github/workflows/ci.yml", status="completed")
        dispatch = run("workflow_dispatch", id=3, status="completed")
        manifest = {"id": release.ADDON, "version": "0.65.1"}
        public_data = {
            "/manifest.json": manifest,
            "/catalog/series/published-series.json": {"metas": [{"id": "tt0112159"}]},
            "/subtitles/series/tt0112159:1:1.json": {"subtitles": [{"url": "https://example.test/a.ass"}]},
        }

        def read(path, env=None):
            if path == "user":
                return {"id": release.OWNER_ID}
            if path.endswith("/git/ref/heads/main"):
                return {"object": {"sha": SHA}}
            if "/workflows/ci.yml/runs?" in path:
                return {"workflow_runs": [ci]}
            if "/workflows/production-delivery.yml/runs?" in path:
                return {"workflow_runs": [dispatch]}
            if path.endswith("/runs/2"):
                return ci
            if path.endswith("/runs/3"):
                return dispatch
            self.assertTrue(path.endswith("/runs/3/attempts/1/jobs"))
            return {"jobs": [{"id": 4, "name": release.PUBLISH_JOB, "conclusion": "success"}]}

        def command(args, operation, **kwargs):
            if args[:2] == ["git", "symbolic-ref"]:
                return "main\n"
            if args[:2] == ["git", "show"]:
                return json.dumps(manifest)
            self.assertEqual(args[:7], ["gh", "run", "view", "3", "--job", "4", "--log"])
            return f"YOMIRU_RELEASE={SHA} 0.65.1 dpl_123\n"

        output = io.StringIO()
        with (tempfile.TemporaryDirectory() as root,
              patch.object(
                  release, "__file__", str(Path(root) / ".github" / "scripts" / script.name)),
              patch.object(release, "api", side_effect=read),
              patch.object(release, "command", side_effect=command),
              patch.object(release, "public_json", side_effect=public_data.__getitem__),
              redirect_stdout(output),
              redirect_stderr(io.StringIO())):
            release.release(SHA)
        self.assertEqual(json.loads(output.getvalue()), {
            "version": "0.65.1", "sha": SHA, "deployment": "dpl_123",
            "ci": release.run_url(2), "release": release.run_url(3),
            "public": {"manifest": "0.65.1", "series": "tt0112159", "subtitleCount": 1},
        })
