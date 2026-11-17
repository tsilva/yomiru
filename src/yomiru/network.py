"""Bounded anonymous provider requests and a size-limited persistent HTTP cache."""

import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class ProviderError(ValueError):
    """A safe, user-readable upstream failure, without response bodies or URLs."""


HOSTS = {
    "kitsunekko.net",
    "v3-cinemeta.strem.io",
    "opensubtitles-v3.strem.io",
    "graphql.anilist.co",
    "kitsu.io",
    "kitsu.app",
}


def validate_url(url: str) -> None:
    parts = urlsplit(url)
    host = parts.hostname or ""
    if (
        parts.scheme != "https"
        or parts.username
        or parts.password
        or parts.fragment
        or parts.port not in {None, 443}
        or not (host in HOSTS or (host.startswith("subs") and host.endswith(".strem.io")))
    ):
        raise ProviderError("Provider returned an unsupported download address")


class Redirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class HttpClient:
    def __init__(self, directory: Path, timeout: float = 10, budget: int = 96 * 1024 * 1024):
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "http.sqlite3"
        self.timeout, self.budget = timeout, budget
        self.lock = threading.RLock()
        with sqlite3.connect(self.path) as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS cache "
                "(key TEXT PRIMARY KEY, expires REAL, touched REAL, body BLOB)"
            )

    def peek(self, url: str, *, limit: int = 8 * 1024 * 1024) -> bytes | None:
        """Read a fresh anonymous response without starting a provider request."""
        validate_url(url)
        key = hashlib.sha256(url.encode()).hexdigest()
        with self.lock, sqlite3.connect(self.path) as db:
            row = db.execute("SELECT expires, body FROM cache WHERE key=?", (key,)).fetchone()
            if row is None or row[0] <= time.time():
                return None
            if len(row[1]) > limit:
                raise ProviderError("Cached provider response exceeds the size limit")
            return row[1]

    def get(
        self,
        url: str,
        *,
        ttl: int = 3600,
        limit: int = 8 * 1024 * 1024,
        payload: dict | None = None,
    ) -> bytes:
        validate_url(url)
        data = json.dumps(payload, sort_keys=True).encode() if payload is not None else None
        key = hashlib.sha256(url.encode() + (data or b"")).hexdigest()
        # Serialize misses so repeated Stremio requests share one upstream operation.
        with self.lock:
            with sqlite3.connect(self.path) as db:
                row = db.execute("SELECT expires, body FROM cache WHERE key=?", (key,)).fetchone()
                if row and row[0] > time.time():
                    if len(row[1]) > limit:
                        raise ProviderError("Cached provider response exceeds the size limit")
                    db.execute("UPDATE cache SET touched=? WHERE key=?", (time.time(), key))
                    return row[1]
            headers = {
                "User-Agent": "Yomiru/0.1 (Japanese learning subtitle add-on)",
                "Accept-Encoding": "identity",
            }
            if data is not None:
                headers["Content-Type"] = "application/json"
            for attempt in range(2):
                try:
                    with build_opener(Redirects()).open(
                        Request(url, data=data, headers=headers), timeout=self.timeout
                    ) as response:
                        validate_url(response.url)
                        body = response.read(limit + 1)
                    break
                except HTTPError as error:
                    raise ProviderError(f"Provider HTTP {error.code}") from None
                except (URLError, TimeoutError, OSError):
                    if attempt:
                        raise ProviderError("Provider connection failed or timed out") from None
            if len(body) > limit:
                raise ProviderError("Provider response exceeds the size limit")
            with sqlite3.connect(self.path) as db:
                now = time.time()
                db.execute("DELETE FROM cache WHERE expires <= ?", (now,))
                db.execute(
                    "INSERT OR REPLACE INTO cache VALUES (?, ?, ?, ?)", (key, now + ttl, now, body)
                )
                total = db.execute("SELECT COALESCE(SUM(length(body)),0) FROM cache").fetchone()[0]
                for old, size in db.execute(
                    "SELECT key, length(body) FROM cache ORDER BY touched"
                ).fetchall():
                    if total <= self.budget:
                        break
                    db.execute("DELETE FROM cache WHERE key=?", (old,))
                    total -= size
            return body

    def json(self, url: str, **kwargs):
        try:
            return json.loads(self.get(url, limit=3 * 1024 * 1024, **kwargs))
        except (UnicodeError, json.JSONDecodeError):
            raise ProviderError("Provider returned invalid JSON") from None
