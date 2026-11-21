"""Render from canonical cue rows supplied by the database reader."""

import json
import sys

from yomiru.subtitle_corpus import rebuild_ass

if __name__ == "__main__":
    verify = sys.argv[1:] == ["--verify"]
    count = 0
    for line in sys.stdin:
        request = json.loads(line)
        contents = rebuild_ass(request["source"], request["translation"], request["script"],
                               subtitle_readings=request.get("subtitleReadings"))
        if "\nDialogue:" not in contents:
            raise ValueError("Regenerated ASS has no subtitle events")
        if not verify:
            sys.stdout.buffer.write(contents.encode("utf-8"))
        count += 1
    if verify:
        print(count)
