"""Forward Yomiru subtitle traces through an explicitly configured host executor."""

import argparse
import base64
import json
import os
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

LOCAL_PATH = "/yomiru-subtitles/v1/traces"
UPSTREAM = "https://aws.api.smith.langchain.com/otel/v1/traces"
MEDIA_TYPE = "application/x-protobuf"
MAX_BODY = 1024 * 1024
ACK = b"Yomiru Subtitles accepted"
STAGES = {"load source", "connect MCP", "subtitle batch", "call model", "validate and render"}
COUNTERS = {"cue_count", "cache_hits", "cache_misses", "model_calls", "omitted_stages"}
ROOT_ATTRIBUTES = {
    "yomiru.outcome": {"success", "cached", "failed"},
    "yomiru.mode": {"fixture", "live"},
}


def _check(condition):
    if not condition:
        raise ValueError("Invalid metadata-only subtitle trace")


def _object(value, keys):
    _check(isinstance(value, dict) and set(value) == set(keys))
    return value


def _base64_id(value, length):
    _check(isinstance(value, str) and re.fullmatch(f"[0-9a-f]{{{length}}}", value))
    _check(int(value, 16) != 0)
    return base64.b64encode(bytes.fromhex(value)).decode("ascii")


def _valid_int(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9]{1,19}", value)


def _root_metadata(attributes):
    keys = set(ROOT_ATTRIBUTES) | {f"yomiru.{name}" for name in COUNTERS}
    _check(isinstance(attributes, list) and len(attributes) == len(keys))
    for entry in attributes:
        _object(entry, ("key", "value"))
        key = entry["key"]
        _check(isinstance(key, str) and key in keys)
        keys.remove(key)
        value = entry["value"]
        if key in ROOT_ATTRIBUTES:
            _object(value, ("stringValue",))
            _check(isinstance(value["stringValue"], str))
            _check(value["stringValue"] in ROOT_ATTRIBUTES[key])
        else:
            _object(value, ("intValue",))
            _check(_valid_int(value["intValue"]))


def protobuf_trace(raw):
    """Validate the complete wire shape before passing it to the serializer."""
    from google.protobuf.json_format import ParseDict
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

    body = json.loads(raw)
    [resource] = _object(body, ("resourceSpans",))["resourceSpans"]
    _object(resource, ("resource", "scopeSpans"))
    _check(resource["resource"] == {"attributes": [
        {"key": "service.name", "value": {"stringValue": "yomiru"}},
    ]})
    [scope] = resource["scopeSpans"]
    _object(scope, ("scope", "spans"))
    _check(scope["scope"] == {"name": "yomiru.subtitle_tracing"})
    spans = scope["spans"]
    _check(isinstance(spans, list) and 0 < len(spans) <= 513)
    keys = (
        "traceId", "spanId", "name", "kind", "startTimeUnixNano", "endTimeUnixNano",
        "attributes", "status",
    )
    _object(spans[0], keys)
    trace_id = spans[0]["traceId"]
    seen = set()
    parents = set()
    for index, span in enumerate(spans):
        _object(span, keys + ("parentSpanId",) if index else keys)
        _check(span["traceId"] == trace_id and span["kind"] == 1)
        _check(_valid_int(span["startTimeUnixNano"]) and _valid_int(span["endTimeUnixNano"]))
        _check(_object(span["status"], ("code",))["code"] in (1, 2))
        span["traceId"] = _base64_id(span["traceId"], 32)
        span["spanId"] = _base64_id(span["spanId"], 16)
        _check(span["spanId"] not in seen)
        seen.add(span["spanId"])
        if index == 0:
            _check(span["name"] == "Process subtitles")
            _root_metadata(span["attributes"])
        else:
            _check(isinstance(span["name"], str) and span["name"] in STAGES)
            _check(span["attributes"] == [])
            span["parentSpanId"] = _base64_id(span["parentSpanId"], 16)
            parents.add(span["parentSpanId"])
    _check(parents <= seen)
    message = ParseDict(body, ExportTraceServiceRequest())
    return message.SerializeToString()


def send():
    from google.protobuf.json_format import ParseDict
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceResponse
    from requests import Session

    proxy = os.getenv("HTTPS_PROXY") or os.getenv("https_proxy")
    ca = os.getenv("REQUESTS_CA_BUNDLE")
    if (os.getenv("YOMIRU_LANGSMITH_RELAY") != "true" or not proxy
            or urlsplit(proxy).hostname != "127.0.0.1" or urlsplit(proxy).port != 8283
            or not ca or not Path(ca).is_file()):
        return 1
    raw = sys.stdin.buffer.read(MAX_BODY + 1)
    if not 0 < len(raw) <= MAX_BODY:
        return 1

    try:
        payload = protobuf_trace(raw)
        with Session() as session:
            session.trust_env = False
            response = session.post(
                UPSTREAM, data=payload, headers={"Content-Type": MEDIA_TYPE},
                proxies={"https": proxy}, verify=ca, timeout=(3, 6), allow_redirects=False,
            )
        if (response.status_code != 200
                or response.headers.get("X-Agent-Vault-Decision", "").lower() != "brokered"):
            return 1
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0]
        acknowledgement = ExportTraceServiceResponse()
        if response.content and content_type == "application/json":
            ParseDict(response.json(), acknowledgement)
        else:
            acknowledgement.ParseFromString(response.content)
        if acknowledgement.partial_success.rejected_spans:
            return 1
    except Exception:
        return 1
    print(ACK.decode("ascii"), flush=True)
    return 0


def serve(port, command):
    class Relay(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(3)

        def reply(self, status):
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            self.reply(204 if self.path == "/health" else 404)

        def do_POST(self):
            if self.path != LOCAL_PATH:
                return self.reply(404)
            if self.headers.get("Content-Type") != "application/json":
                return self.reply(415)
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_BODY:
                    return self.reply(413)
                body = self.rfile.read(length)
                if len(body) != length:
                    return self.reply(400)
            except (OSError, ValueError):
                return self.reply(400)
            try:
                with subprocess.Popen(
                    command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                ) as child:
                    try:
                        output, _ = child.communicate(input=body, timeout=13)
                    except subprocess.TimeoutExpired:
                        child.terminate()
                        try:
                            child.communicate(timeout=3)
                        except subprocess.TimeoutExpired:
                            child.kill()
                            child.communicate()
                        return self.reply(503)
                self.reply(204 if child.returncode == 0 and ACK in output.splitlines() else 503)
            except OSError:
                self.reply(503)

        def log_message(self, *_):
            pass

    with HTTPServer(("127.0.0.1", port), Relay) as server:
        server.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    modes.add_parser("send")
    relay = modes.add_parser("serve")
    relay.add_argument("--port", type=int, default=4319)
    relay.add_argument("command", nargs=argparse.REMAINDER)
    options = parser.parse_args()
    if options.mode == "send":
        raise SystemExit(send())
    command = options.command[1:] if options.command[:1] == ["--"] else options.command
    if not command or not Path(command[0]).is_absolute():
        parser.error("Supply an explicit absolute sender command")
    serve(options.port, command)
