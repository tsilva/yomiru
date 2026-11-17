"""A loopback-only Stremio subtitle add-on with no filesystem browsing."""

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from urllib.parse import parse_qs, unquote, urlsplit

from yomiru import __version__
from yomiru.compose import compose
from yomiru.discovery import Discovery
from yomiru.jobs import ComposeJobs
from yomiru.library import Library

MANIFEST = {
    "id": "community.yomiru",
    "version": __version__,
    "name": "Yomiru",
    "description": "Japanese readings above the subtitle source you choose in Stremio.",
    "resources": ["subtitles"],
    "types": ["movie", "series"],
    "catalogs": [],
}


def make_server(
    library: Library, port: int = 0, discovery: Discovery | None = None
) -> ThreadingHTTPServer:
    jobs = ComposeJobs(library, discovery)
    compose_lock = jobs.gate

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            # Subtitle request URLs may contain private release information.
            pass

        def reply(self, payload: bytes, content_type: str, status: int = 200):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Access-Control-Allow-Origin", self.allowed_origin())
            self.send_header("Vary", "Origin")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)

        def json(self, data, status=200):
            self.reply(json.dumps(data).encode(), "application/json; charset=utf-8", status)

        def allowed_origin(self):
            # Stremio desktop and Web use different page origins. Public add-on
            # GET resources carry no credentials; keep composition API restricted.
            if self.command == "GET" and not self.path.startswith("/api/"):
                return "*"
            origin = self.headers.get("Origin")
            local_origin = f"http://127.0.0.1:{self.server.server_port}"
            return origin if origin == local_origin else "https://web.stremio.com"

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", self.allowed_origin())
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_POST(self):
            origin = self.headers.get("Origin")
            local_origin = f"http://127.0.0.1:{self.server.server_port}"
            if origin not in {None, "https://web.stremio.com", local_origin}:
                return self.reply(b"Origin not allowed", "text/plain", 403)
            if self.path != "/api/compose":
                return self.reply(b"Not found", "text/plain", 404)
            if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
                return self.reply(b"Send caption documents as JSON", "text/plain", 415)
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4 * 1024 * 1024 or self.headers.get("Transfer-Encoding"):
                    return self.reply(b"Caption request exceeds the size limit", "text/plain", 413)
                self.connection.settimeout(15)
                payload = json.loads(self.rfile.read(length))
                if isinstance(payload, dict) and payload.pop("async", False) is True:
                    job = jobs.start(payload)
                    if job is None:
                        return self.json(
                            {"error": "Another track is being composed; try again"}, 429
                        )
                    return self.json({"job": job}, 202)
                if not compose_lock.acquire(blocking=False):
                    return self.reply(
                        b"Another track is being composed; try again", "text/plain", 429
                    )
                try:
                    track = compose(library, payload, discovery)
                finally:
                    compose_lock.release()
                return self.json(
                    {
                        "url": f"{local_origin}/files/{track.key}.ass",
                        "script": track.script,
                        "timing": "unverified",
                    }
                )
            except (ValueError, TypeError, OSError):
                return self.reply(
                    b"Could not compose these tracks; check the captions and episode",
                    "text/plain",
                    400,
                )

        def do_GET(self):
            path = urlsplit(self.path).path
            if re.fullmatch(r"/api/compose/[a-f0-9]{32}", path):
                result = jobs.result(path.split("/")[-1])
                if result is None:
                    return self.json({"error": "Composition expired; try again"}, 404)
                if result.get("state") == "ready":
                    key = result.pop("key")
                    result["url"] = f"http://127.0.0.1:{self.server.server_port}/files/{key}.ass"
                return self.json(result)
            if path == "/manifest.json":
                origin = f"http://127.0.0.1:{self.server.server_port}"
                return self.json({**MANIFEST, "logo": f"{origin}/assets/icon.png"})
            if path == "/assets/icon.png":
                return self.reply(
                    files("yomiru").joinpath("assets/icon.png").read_bytes(), "image/png"
                )
            if discovery and re.fullmatch(r"/generate/[a-f0-9]{64}\.ass", path):
                try:
                    payload = discovery.generate(path.split("/")[-1].removesuffix(".ass"))
                    if payload is not None:
                        return self.reply(payload, "text/x-ssa; charset=utf-8")
                except (ValueError, OSError):
                    return self.reply(
                        b"Subtitle generation failed; retry or choose another Yomiru track",
                        "text/plain; charset=utf-8",
                        503,
                    )
            if path.startswith("/files/") and path.endswith(".ass"):
                payload = library.subtitle(path.removeprefix("/files/").removesuffix(".ass"))
                if payload is not None:
                    return self.reply(payload, "text/x-ssa; charset=utf-8")
            parts = path.strip("/").split("/")
            if (
                len(parts) in {3, 4}
                and parts[0] == "subtitles"
                and parts[1] in {"movie", "series"}
                and parts[-1].endswith(".json")
            ):
                video_id = unquote(parts[2].removesuffix(".json") if len(parts) == 3 else parts[2])
                extra = parse_qs(parts[3].removesuffix(".json")) if len(parts) == 4 else {}
                filename = extra.get("filename", [""])[0]
                parameters = {k: v[0] for k, v in extra.items() if v}
                if len(video_id) > 200 or len(self.path) > 5000:
                    return self.reply(b"Request too long", "text/plain", 400)
                origin = f"http://127.0.0.1:{self.server.server_port}"
                subtitles = []
                for track in library.tracks(video_id, parts[1], filename):
                    if track.discovery_key:
                        continue  # Automatic tracks belong to their exact discovery request.
                    hint = track.release_hint or "release not matched"
                    subtitles.append(
                        {
                            "id": track.key,
                            "lang": "eng",
                            "label": f"Yomiru: {track.script} + English [{hint}]",
                            "url": f"{origin}/files/{track.key}.ass",
                        }
                    )
                status = {"status": "disabled", "message": "Automatic discovery is disabled"}
                if discovery:
                    selections, status = discovery.search(video_id, parts[1], parameters)
                    for variant, selection in enumerate(selections, start=1):
                        source = selection.japanese.filename[:85]
                        base = selection.base.filename[:85]
                        timing = " (auto timing)" if selection.timing.align else ""
                        subtitles.append(
                            {
                                "id": selection.key,
                                "lang": selection.base.language,
                                "label": (
                                    f"Yomiru #{variant}: {selection.script}{timing} + {base} · "
                                    f"{selection.base.provider} [JP: {source}; timing unverified]"
                                ),
                                "url": f"{origin}/generate/{selection.key}.ass",
                            }
                        )
                return self.json({"subtitles": subtitles, "cacheMaxAge": 0, "yomiru": status})
            self.reply(b"Not found", "text/plain; charset=utf-8", 404)

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)
