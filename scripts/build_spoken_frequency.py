"""Build Yomiru's spoken ranks from the public YODAS Japanese caption shards."""

import argparse
import hashlib
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

from yomiru.vocabulary import ANALYSIS, extract_words

REVISION = "0cad6a0ebec75e945fef92084052be69457fe9d1"
TEXT_URL = f"https://huggingface.co/datasets/espnet/yodas/resolve/{REVISION}/data/ja000/text"
SHARDS = 112
SOURCE_BYTES = 93_471_753
SOURCE_SHA256 = "bb30755128baef4a22cd52aefcb5920a3cd9cb1646638e44cf6c26a405aa9eb1"
MIN_OCCURRENCES = 10
CAPTION_ID = re.compile(r"[A-Za-z0-9_-]{11}-[0-9]+-[0-9]+-[0-9]+")
NON_SPEECH = re.compile(r"[\[［【](?:音楽|拍手|笑い|music|applause|laughter)[\]］】]", re.I)


def download_shard(index: int) -> bytes:
    limit = 2 * 1024 * 1024
    with urlopen(f"{TEXT_URL}/{index:08d}.txt", timeout=30) as response:
        data = response.read(limit + 1)
    if not data or len(data) > limit:
        raise ValueError(f"Invalid caption shard size at index {index}")
    return data


def count_words() -> Counter[str]:
    counts: Counter[str] = Counter()
    source = hashlib.sha256()
    total_bytes = 0
    captions = 0
    videos: set[str] = set()
    with ThreadPoolExecutor(max_workers=4) as pool:
        for start in range(0, SHARDS, 4):
            for data in pool.map(download_shard, range(start, min(start + 4, SHARDS))):
                source.update(data)
                total_bytes += len(data)
                rows = []
                for line in data.decode("utf-8").split("\n"):
                    if not line.strip():
                        continue
                    caption_id, *text = line.split(maxsplit=1)
                    if not CAPTION_ID.fullmatch(caption_id):
                        raise ValueError("Invalid YODAS caption identifier")
                    if text:
                        rows.append({
                            "id": caption_id, "start": 0,
                            "japanese": NON_SPEECH.sub(" ", text[0]),
                        })
                        videos.add(caption_id[:11])
                captions += len(rows)
                for word in extract_words(rows):
                    if word["pos"] != "名詞/固有名詞":
                        counts[word["id"]] += word["count"]
    if total_bytes != SOURCE_BYTES or source.hexdigest() != SOURCE_SHA256:
        raise ValueError("Caption input differs from the pinned YODAS text snapshot")
    print(f"{ANALYSIS}: {captions:,} captions from {len(videos):,} videos")
    print(f"Counted {counts.total():,} tokens, source SHA-256 {source.hexdigest()}")
    return counts


def rank_rows(counts: Counter[str]):
    yield "rank\tvocabulary_id\tcount\n"
    previous = 0
    rank = 0
    for index, (word, count) in enumerate(
        sorted(counts.items(), key=lambda pair: (-pair[1], pair[0])), 1
    ):
        if count < MIN_OCCURRENCES:
            break
        if count != previous:
            rank, previous = index, count
        yield f"{rank}\t{word}\t{count}\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.write_text("".join(rank_rows(count_words())), encoding="utf-8", newline="\n")
