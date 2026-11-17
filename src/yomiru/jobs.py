"""Short-poll composition jobs for clients with request deadlines."""

import threading
import time
import uuid

from yomiru.compose import compose


class ComposeJobs:
    def __init__(self, library, discovery):
        self.library, self.discovery = library, discovery
        self.gate = threading.Lock()
        self.lock = threading.Lock()
        self.records = {}

    def start(self, payload):
        if not self.gate.acquire(blocking=False):
            return None
        key = uuid.uuid4().hex
        with self.lock:
            self.records = {k: v for k, v in self.records.items() if v[0] > time.monotonic()}
            while len(self.records) >= 20:
                del self.records[next(iter(self.records))]
            self.records[key] = (time.monotonic() + 300, {"state": "pending"})

        def run():
            try:
                track = compose(self.library, payload, self.discovery)
                result = {
                    "state": "ready",
                    "key": track.key,
                    "script": track.script,
                    "timing": "unverified",
                }
            except Exception:
                result = {
                    "state": "failed",
                    "error": (
                        "Could not combine these captions. "
                        "Check Japanese coverage or choose a Japanese file."
                    ),
                }
            finally:
                self.gate.release()
            with self.lock:
                self.records[key] = (time.monotonic() + 300, result)

        try:
            threading.Thread(target=run, name="yomiru-compose", daemon=True).start()
        except RuntimeError:
            self.gate.release()
            with self.lock:
                self.records.pop(key, None)
            raise
        return key

    def result(self, key):
        with self.lock:
            entry = self.records.get(key)
            if entry is None or entry[0] <= time.monotonic():
                self.records.pop(key, None)
                return None
            return entry[1].copy()
