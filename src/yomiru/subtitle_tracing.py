"""Metadata-only OpenTelemetry traces for the administrative subtitle runner."""

import argparse
import fcntl
import http.client
import json
import os
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from yomiru.translation import atomic_json

CONFIG = Path.home() / ".config/yomiru/subtitle-tracing.json"
RELAY_PATH = "/yomiru-subtitles/v1/traces"
STAGES = frozenset({
    "load source", "connect MCP", "subtitle batch", "call model", "validate and render",
})
COUNTERS = ("cue_count", "cache_hits", "cache_misses", "model_calls", "omitted_stages")


def _attributes(values):
    return [
        {
            "key": key,
            "value": {"intValue": str(value)} if isinstance(value, int) else {"stringValue": value},
        }
        for key, value in values.items()
    ]


class SubtitleTrace:
    def __init__(self, work_dir: Path, *, fixture: bool):
        self.outbox = work_dir / "traces" / "pending"
        self.trace_id = uuid.uuid4().hex
        self.root_id = uuid.uuid4().hex[:16]
        self.start = time.time_ns()
        self.spans = []
        self.stage_count = 0
        self.counts = dict.fromkeys(COUNTERS, 0)
        self.fixture = fixture
        self.outcome = "failed"
        self.parent_id = self.root_id

    def _span(self, name, span_id, start, end, *, parent=None, attributes=None, failed=False):
        return {
            "traceId": self.trace_id,
            "spanId": span_id,
            **({"parentSpanId": parent} if parent else {}),
            "name": name,
            "kind": 1,
            "startTimeUnixNano": str(start),
            "endTimeUnixNano": str(end),
            "attributes": _attributes(attributes or {}),
            "status": {"code": 2 if failed else 1},
        }

    @contextmanager
    def stage(self, name):
        if name not in STAGES:
            raise ValueError("Unknown subtitle trace stage")
        self.stage_count += 1
        if self.stage_count > 512:
            self.counts["omitted_stages"] += 1
            yield
            return
        parent = self.parent_id
        self.parent_id = span_id = uuid.uuid4().hex[:16]
        started = time.time_ns()
        failed = True
        try:
            yield
            failed = False
        finally:
            self.spans.append(self._span(
                name, span_id, started, time.time_ns(), parent=parent, failed=failed,
            ))
            self.parent_id = parent

    def complete(self, exit_code):
        if exit_code == 0:
            fully_cached = self.counts["cache_hits"] and not self.counts["cache_misses"]
            self.outcome = "cached" if fully_cached else "success"

    def __enter__(self):
        return self

    def __exit__(self, exception_type, *_):
        if exception_type is not None:
            self.outcome = "failed"
        root = self._span(
            "Process subtitles", self.root_id, self.start, time.time_ns(),
            attributes={
                "yomiru.outcome": self.outcome,
                "yomiru.mode": "fixture" if self.fixture else "live",
                **{f"yomiru.{name}": value for name, value in self.counts.items()},
            },
            failed=self.outcome == "failed",
        )
        payload = {"resourceSpans": [{
            "resource": {"attributes": _attributes({"service.name": "yomiru"})},
            "scopeSpans": [{
                "scope": {"name": "yomiru.subtitle_tracing"},
                "spans": [root, *self.spans],
            }],
        }]}
        path = self.outbox / f"{self.trace_id}.json"
        try:
            atomic_json(path, payload)
            flush(self.outbox, first=path)
        except (OSError, ValueError, http.client.HTTPException):
            print("Subtitle trace delivery failed. Check the local trace outbox.", file=sys.stderr)


def _relay_port():
    endpoint = os.environ.get("YOMIRU_SUBTITLE_TRACE_ENDPOINT")
    if endpoint is None:
        try:
            config = json.loads(CONFIG.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        endpoint = config.get("endpoint") if isinstance(config, dict) else None
        if not isinstance(endpoint, str):
            raise ValueError("Expected a subtitle trace relay endpoint")
    if not endpoint:
        return None
    url = urlsplit(endpoint)
    if (url.scheme != "http" or url.hostname != "127.0.0.1" or url.port is None
            or url.path != RELAY_PATH or url.username or url.password or url.query or url.fragment):
        raise ValueError("Expected the local Yomiru subtitle trace relay URL")
    return url.port


def flush(outbox: Path, *, first: Path | None = None):
    """Send pending traces to the configured local relay and retain rejected items."""
    port = _relay_port()
    if port is None:
        return 0
    if not outbox.is_dir():
        return 0
    with (outbox / ".delivery.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | (fcntl.LOCK_NB if first else 0))
        except BlockingIOError:
            return 0
        paths = sorted(outbox.glob("*.json"))
        if first in paths:
            paths.remove(first)
            paths.insert(0, first)
        if first is not None:
            paths = paths[:3]
        for path in paths:
            _deliver(port, path.read_bytes())
            # A retry uses the same trace and span IDs if delivery was interrupted.
            path.unlink()
        return len(paths)


def _deliver(port: int, payload: bytes):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
    try:
        connection.request("POST", RELAY_PATH, body=payload, headers={
            "Content-Type": "application/json",
        })
        if connection.getresponse().status != 204:
            raise OSError("Subtitle trace relay did not acknowledge delivery")
    finally:
        connection.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Retry pending metadata-only subtitle traces")
    parser.add_argument("--work-dir", required=True, type=Path)
    options = parser.parse_args()
    try:
        print(f"Delivered {flush(options.work_dir / 'traces' / 'pending')} subtitle traces.")
    except (OSError, ValueError, http.client.HTTPException):
        raise SystemExit(
            "Subtitle trace delivery failed. Check the relay and configuration."
        ) from None
