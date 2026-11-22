"""Plan and execute bounded, cache-friendly administrative subtitle generation."""

import argparse
import fcntl
import hashlib
import http.client
import json
import math
import time
from collections import deque
from contextlib import ExitStack
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlencode

from yomiru.captions import load_captions
from yomiru.japanese import source_forms
from yomiru.subtitle_tracing import SubtitleTrace
from yomiru.translation import (
    CACHE_IDENTITY_FIELDS,
    Anchor,
    TranslationCache,
    anchors,
    atomic_json,
    digest,
    export_trial,
)
from yomiru.translation_context import request_annotated_context, validate_annotated_response

DEFAULT_MODEL = "codex/gpt-6.2-sol"
MAX_BATCHES_PER_JOB = 16
MAX_BATCH_PROMPT_CHARS = 30_000
MAX_SHARED_CHARS = 500_000
ROW_PROMPT = "Translate these target IDs in order: "
GENERATED_FILES = ("japanese.srt", "translated.srt", "paired.ass", "pairs.json", "review.html")


@dataclass(frozen=True)
class Limits:
    encoding: str
    context: int
    output: int
    request_reserve: int = 16_384
    exact_encoding: bool = False


@dataclass(frozen=True)
class Expansion:
    ratio: float
    floor: int
    samples: int = 0


@dataclass(frozen=True)
class Range:
    ids: tuple[str, ...]
    input_tokens: int
    estimated_output_tokens: int

    @property
    def id(self):
        return f"{self.ids[0]}-{self.ids[-1]}"

    @property
    def prompt(self):
        return ROW_PROMPT + ", ".join(self.ids)


MODEL_OUTPUT_LIMITS = {DEFAULT_MODEL: 128_000}
MODEL_REFERENCE_ENCODINGS = {DEFAULT_MODEL: "o200k_base"}
LANGUAGES = {"English": Expansion(2.2, 10), "European Portuguese": Expansion(2.6, 12)}
REASONING_RESERVE = {"low": 1024, "medium": 3072, "high": 8192, "xhigh": 16384, "max": 32768}


def load_anchors(path):
    # Keep even pure sound descriptions so the anchored track covers the source.
    return [
        Anchor(f"c{i:05}", cue.start, cue.end, source_forms(cue.text)[0] or cue.text, cue.text)
        for i, cue in enumerate(load_captions(path), 1)
    ]


def quantile(values, fraction):
    ordered = sorted(values)
    return ordered[math.ceil(len(ordered) * fraction) - 1]


def calibrate(paths, count, fallback, target):
    ratios, short = [], []
    for path in paths:
        pairs = json.loads(path.read_text())
        metadata = pairs.get("metadata", {})
        language = metadata.get("target") or metadata.get("translation_language")
        if language and language != target:
            raise ValueError("Calibration pairs must use the selected target language")
        for cue in pairs["cues"]:
            source = count(cue["japanese"])
            target = count(cue["translation"])
            if source >= 4:
                ratios.append(target / source)
            else:
                short.append(target)
    samples = len(ratios) + len(short)
    if samples < 100:
        raise ValueError("Output calibration needs at least 100 translated cue pairs")
    ratio = quantile(ratios, 0.99) * 1.12 if len(ratios) >= 30 else fallback.ratio
    floor = math.ceil(quantile(short, 0.99) * 1.12) if len(short) >= 30 else fallback.floor
    return Expansion(max(1.0, ratio), max(6, floor), samples)


def plan(source, request, count, limits, expansion, *, minimum_batches=1, batch_budget=None):
    system, context, _ = request["payload"]["messages"]
    effort = request["payload"]["reasoning_effort"]
    visible = count(system["content"]) + count(context["content"])
    base = visible + limits.request_reserve
    head = count(ROW_PROMPT)
    reasoning = REASONING_RESERVE[effort]
    output_headroom = int(limits.output * 0.70) - reasoning
    output_cap = min(batch_budget, output_headroom) if batch_budget is not None else output_headroom
    cap = limits.context - base - head - reasoning
    if len(context["content"]) > MAX_SHARED_CHARS or min(cap, output_cap) <= 0:
        raise ValueError("Full Japanese context leaves insufficient room for output")
    if minimum_batches > len(source):
        raise ValueError("More minimum batches than source cues")

    estimates = [
        count(f"{cue.id}|\n")
        + max(expansion.floor, math.ceil(count(cue.japanese) * expansion.ratio))
        for cue in source
    ]
    weights = [size + count(f"{cue.id}, ") for cue, size in zip(source, estimates, strict=True)]

    def pack(budget):
        groups = []
        start, used, output, chars = 0, 0, 0, len(ROW_PROMPT)
        for index, weight in enumerate(weights):
            row_chars = len(source[index].id) + 2
            tokens = estimates[index]
            if weight > budget or tokens > output_cap:
                return []
            if index > start and (
                used + weight > budget
                or output + tokens > output_cap
                or chars + row_chars > MAX_BATCH_PROMPT_CHARS
            ):
                groups.append((start, index))
                start, used, output, chars = index, 0, 0, len(ROW_PROMPT)
            used += weight
            output += tokens
            chars += row_chars
        return [*groups, (start, len(source))]

    groups = pack(cap)
    if not groups:
        raise ValueError("A single cue exceeds the model's safe output budget")
    target_count = max(len(groups), minimum_batches)
    low, high = max(weights), cap
    while low < high:
        middle = (low + high) // 2
        if len(pack(middle)) <= target_count:
            high = middle
        else:
            low = middle + 1
    groups = pack(low)
    while len(groups) < target_count:
        index = max(range(len(groups)), key=lambda i: groups[i][1] - groups[i][0])
        start, end = groups[index]
        split = (start + end) // 2
        groups[index : index + 1] = [(start, split), (split, end)]

    ranges = []
    for start, end in groups:
        ids = tuple(cue.id for cue in source[start:end])
        suffix = count(ROW_PROMPT + ", ".join(ids))
        output = sum(estimates[start:end])
        if base + suffix + output + reasoning > limits.context or output > output_cap:
            raise ValueError("Planned range exceeds the safe token budget")
        ranges.append(Range(ids, base + suffix, output))
    return ranges, visible


def _agentbridge_json(port, path, *, payload=None, timeout=30):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        if payload is None:
            connection.request("GET", path)
        else:
            connection.request(
                "POST",
                path,
                json.dumps(payload, ensure_ascii=False).encode(),
                {"Content-Type": "application/json"},
            )
        response = connection.getresponse()
        maximum = 32 * 1024**2
        body = response.read(maximum + 1)
        if response.status != 200 or len(body) > maximum:
            raise ValueError(f"AgentBridge request failed (HTTP {response.status})")
        return json.loads(body)
    finally:
        connection.close()


def agentbridge_call(port, payload):
    return _agentbridge_json(
        port,
        "/api/v1/agent/batch-runs",
        payload=payload,
        timeout=payload["timeout_seconds"] + 10,
    )


def agentbridge_model_limits(port, model):
    query = urlencode({"model": model})
    try:
        limits = _agentbridge_json(port, f"/api/v1/codex/model-limits?{query}")
    except (OSError, http.client.HTTPException, ValueError) as error:
        raise ValueError(
            "AgentBridge could not advertise the selected Codex context window"
        ) from error
    if not isinstance(limits, dict):
        raise ValueError("AgentBridge returned invalid Codex context limits")
    window = limits.get("context_window_tokens")
    compact = limits.get("auto_compact_token_limit")
    if (
        limits.get("model") != model
        or type(window) is not int
        or window <= 0
        or type(compact) is not int
        or compact < 0
    ):
        raise ValueError("AgentBridge returned invalid Codex context limits")
    return limits


def usage_totals(receipts):
    keys = (
        "input_tokens",
        "cached_input_tokens",
        "cache_write_input_tokens",
        "output_tokens",
        "reasoning_output_tokens",
    )
    totals = {}
    for key in keys:
        values = [receipt["usage"].get(key) for receipt in receipts]
        totals[key] = (
            sum(values) if values and all(type(value) is int for value in values) else None
        )
    return totals


def _cache_request(request, ids):
    identity = {field: request[field] for field in CACHE_IDENTITY_FIELDS}
    identity["prompt_version"] += "+agentbridge-fork-v1"
    identity["ids"] = list(ids)
    payload = request["payload"]
    identity["payload"] = {
        **payload,
        "messages": [
            *payload["messages"][:2],
            {"role": "user", "content": ROW_PROMPT + ", ".join(ids)},
        ],
    }
    return {"key": digest(identity), **identity}


def generated_files(directory):
    hashes = {}
    for name in GENERATED_FILES:
        file = directory / name
        if file.is_file() and not file.is_symlink():
            with file.open("rb") as stream:
                hashes[name] = hashlib.file_digest(stream, "sha256").hexdigest()
    return hashes


def execute(
    source,
    request,
    ranges,
    report,
    work_dir,
    *,
    workers,
    timeout,
    retries,
    call,
    trace,
    cache=None,
    resume=False,
):
    started = time.monotonic()
    system, shared, _ = request["payload"]["messages"]
    translated = {}
    receipts = []
    source_ids = [cue.id for cue in source]
    required_context = (
        max(entry.input_tokens + entry.estimated_output_tokens for entry in ranges)
        + REASONING_RESERVE[request["payload"]["reasoning_effort"]]
    )
    attempts = work_dir / "attempts"
    if attempts.exists() and not resume:
        raise ValueError("Choose a fresh work directory for a separate generation")
    previous = work_dir / "report.json"
    splits = set()
    if resume and previous.exists():
        saved = json.loads(previous.read_bytes())
        if saved.get("plan_key") != report["plan_key"]:
            raise ValueError("The previous generation used different inputs or a different plan")
        if saved.get("status") == "completed" and "artifacts" in saved:
            if len(saved["artifacts"]) != len(GENERATED_FILES) or (
                generated_files(work_dir) != saved["artifacts"]
            ):
                raise ValueError(
                    "Completed generation files changed; restore them or use a new directory"
                )
            return {
                **saved,
                "reused_generation": True,
                "elapsed_seconds": round(time.monotonic() - started, 3),
                "model_calls": 0,
                "usage": usage_totals([]),
            }
        splits = {tuple(ids) for ids in saved.get("split_ranges", [])}
    elif resume and attempts.exists():
        raise ValueError("No generation plan was saved in this work directory")
    attempts.mkdir(parents=True, exist_ok=True)
    attempt = max(
        (int(file.stem) for file in attempts.glob("*.json") if file.stem.isdecimal()), default=0
    )

    def pending(ids, depth):
        if ids in splits and depth < retries and len(ids) > 1:
            middle = len(ids) // 2
            yield from pending(ids[:middle], depth + 1)
            yield from pending(ids[middle:], depth + 1)
        else:
            yield ids, depth

    remaining = deque(item for entry in ranges for item in pending(entry.ids, 0))

    def persist():
        report["usage"] = usage_totals(receipts)
        report["elapsed_seconds"] = round(time.monotonic() - started, 3)
        report["valid_cues"] = len(translated)
        report["local_cache_hits"] = trace.counts["cache_hits"]
        report["model_calls"] = trace.counts["model_calls"]
        report["range_splits"] = len(splits)
        report["split_ranges"] = sorted(splits)
        atomic_json(work_dir / "report.json", report)

    try:
        persist()
        while remaining:
            wave = [remaining.popleft() for _ in range(min(len(remaining), MAX_BATCHES_PER_JOB))]
            with ExitStack() as locks:
                keys = {}
                if cache is not None:
                    keys = {ids: _cache_request(request, ids) for ids, _ in wave}
                    for key in sorted(keys.values(), key=lambda key: key["key"]):
                        locks.enter_context(cache.claim(key))
                    misses = []
                    for ids, depth in wave:
                        rows = cache.get(keys[ids])
                        if rows is None:
                            misses.append((ids, depth))
                        else:
                            translated.update(rows)
                            trace.counts["cache_hits"] += 1
                    wave = misses
                if not wave:
                    continue
                trace.counts["cache_misses"] += len(wave)
                payload = {
                    "model": request["payload"]["model"],
                    "reasoning_effort": request["payload"]["reasoning_effort"],
                    "instructions": system["content"],
                    "shared_context": shared["content"],
                    "parallelism": workers,
                    "minimum_context_window": required_context,
                    "timeout_seconds": timeout,
                    "batches": [
                        {"id": f"{ids[0]}-{ids[-1]}", "prompt": ROW_PROMPT + ", ".join(ids)}
                        for ids, _ in wave
                    ],
                }
                with trace.stage("call model"):
                    result = call(payload)
                attempt += 1
                atomic_json(attempts / f"{attempt:03}.json", result)
                receipts.append(result)
                warmup_calls = int(result.get("warmup", True) is not None)
                trace.counts["model_calls"] += len(wave) + warmup_calls

                batches = result["batches"]
                if [batch["id"] for batch in batches] != [
                    batch["id"] for batch in payload["batches"]
                ]:
                    raise ValueError("AgentBridge returned the wrong cue ranges")
                failures = []
                for (ids, depth), batch in zip(wave, batches, strict=True):
                    if (
                        batch["status"] != "completed"
                        and batch.get("error") != "contextWindowExceeded"
                    ):
                        failures.append(f"AgentBridge did not complete cue range {batch['id']}")
                        continue
                    try:
                        rows = validate_annotated_response(batch["output"], list(ids))
                    except ValueError as error:
                        if depth >= retries or len(ids) < 2:
                            failures.append(f"Invalid response for {batch['id']}: {error}")
                            continue
                        middle = len(ids) // 2
                        remaining.extend(((ids[:middle], depth + 1), (ids[middle:], depth + 1)))
                        splits.add(ids)
                    else:
                        if translated.keys() & rows.keys():
                            raise ValueError("AgentBridge returned a previously validated cue")
                        translated.update(rows)
                        if cache is not None:
                            cache.put(
                                keys[ids],
                                json.dumps(
                                    {
                                        "translations": [
                                            {"id": cue_id, "text": text}
                                            for cue_id, text in rows.items()
                                        ]
                                    },
                                    ensure_ascii=False,
                                ),
                            )
                if failures:
                    raise ValueError("; ".join(failures))
            persist()
        with trace.stage("validate and render"):
            ordered = {cue_id: translated[cue_id] for cue_id in source_ids}
            report["validation"] = export_trial(
                source,
                ordered,
                work_dir,
                {**report, "status": "completed"},
            )
            artifacts = generated_files(work_dir)
            if artifacts:
                report["artifacts"] = artifacts
        report["status"] = "completed"
    finally:
        persist()
    return report


def add_arguments(parser):
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument(
        "--dialogue-only",
        action="store_true",
        help="Use the Japanese dialogue cues from standalone romaji publication",
    )
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--glossary", type=Path)
    parser.add_argument("--target", choices=LANGUAGES, default="English")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--reasoning-effort", choices=REASONING_RESERVE, default="low")
    parser.add_argument("--encoding")
    parser.add_argument("--context-limit", type=int)
    parser.add_argument("--output-limit", type=int)
    parser.add_argument("--request-reserve", type=int)
    parser.add_argument("--calibration-pairs", type=Path, action="append", default=[])
    parser.add_argument("--min-batches", type=int, choices=range(1, 17), default=1)
    parser.add_argument(
        "--batch-output-budget",
        type=int,
        help="Optional cap on estimated output tokens per chunk",
    )
    parser.add_argument("--workers", type=int, choices=(1, 2, 3, 4), default=1)
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--validation-retries", type=int, choices=range(0, 4), default=2)
    parser.add_argument("--port", type=int, default=8082)
    cache = parser.add_mutually_exclusive_group()
    cache.add_argument("--cache-dir", type=Path)
    cache.add_argument(
        "--no-cache", action="store_true", help="Disable reuse for controlled trials"
    )
    parser.add_argument(
        "--resume", action="store_true", help="Resume the exact plan in an existing work directory"
    )
    parser.add_argument("--plan-only", action="store_true")


def validate_arguments(args):
    if args.resume and args.no_cache:
        raise ValueError("Resuming requires the validated-range cache")
    if not 1 <= args.port <= 65_535 or not 30 <= args.timeout <= 1200:
        raise ValueError("Choose a valid loopback port and timeout of 30–1,200 seconds")
    for limit in (
        args.context_limit,
        args.output_limit,
        args.request_reserve,
        args.batch_output_budget,
    ):
        if limit is not None and limit <= 0:
            raise ValueError("Token limits and reserves must be positive")


def _limits(args, gateway_limits):
    try:
        import tiktoken
    except ImportError as error:
        raise SystemExit(
            "Install the translation extra with uv sync --extra translation"
        ) from error
    try:
        known_encoding = tiktoken.encoding_for_model(args.model.removeprefix("codex/")).name
    except KeyError:
        known_encoding = None
    encoding = args.encoding or known_encoding or MODEL_REFERENCE_ENCODINGS.get(args.model)
    context = args.context_limit or 0
    if gateway_limits is not None:
        advertised = min(
            gateway_limits["context_window_tokens"],
            gateway_limits["auto_compact_token_limit"],
        )
        context = min(context, advertised) if context else advertised
    output = args.output_limit or MODEL_OUTPUT_LIMITS.get(args.model, 0)
    reserve = args.request_reserve if args.request_reserve is not None else Limits.request_reserve
    if not encoding or output <= 0 or not 0 < reserve < context:
        raise ValueError("Supply an encoding and valid context, output and request-reserve limits")
    tokenizer = tiktoken.get_encoding(encoding)
    return Limits(encoding, context, output, reserve, encoding == known_encoding), tokenizer


def run(args):
    validate_arguments(args)
    gateway_limits = None
    saved = args.work_dir / "report.json"
    if args.resume and saved.is_file():
        gateway_limits = json.loads(saved.read_bytes())["agentbridge_limits"]
    elif not (args.plan_only and args.context_limit is not None):
        gateway_limits = agentbridge_model_limits(args.port, args.model)
    limits, tokenizer = _limits(args, gateway_limits)

    def count(text):
        return len(tokenizer.encode_ordinary(text))

    source = (
        anchors(load_captions(args.source)) if args.dialogue_only else load_anchors(args.source)
    )
    glossary = json.loads(args.glossary.read_text()) if args.glossary else {}
    if not isinstance(glossary, dict) or any(
        not isinstance(key, str)
        or not key.strip()
        or not isinstance(value, str)
        or not value.strip()
        for key, value in glossary.items()
    ):
        raise ValueError("Glossary must map Japanese terms to nonempty target-language names")
    request = request_annotated_context(
        source,
        [cue.id for cue in source],
        args.model,
        args.target,
        glossary=glossary,
        reasoning_effort=args.reasoning_effort,
    )
    expansion = LANGUAGES[args.target]
    if args.calibration_pairs:
        expansion = calibrate(args.calibration_pairs, count, expansion, args.target)
    ranges, visible = plan(
        source,
        request,
        count,
        limits,
        expansion,
        minimum_batches=args.min_batches,
        batch_budget=args.batch_output_budget,
    )
    report = {
        "mode": "AgentBridge annotated translation",
        "status": "planned",
        "source_hash": request["source_hash"],
        "request_key": request["key"],
        "target": args.target,
        "model": args.model,
        "reasoning_effort": args.reasoning_effort,
        "prompt_version": request["prompt_version"],
        "workers": args.workers,
        "limits": asdict(limits),
        "agentbridge_limits": gateway_limits,
        "language_expansion": asdict(expansion),
        "visible_prefix_tokens": visible,
        "range_splits": 0,
        "batches": [asdict(item) for item in ranges],
    }
    report["plan_key"] = digest(
        {
            **{key: value for key, value in report.items() if key != "workers"},
            "validation_retries": args.validation_retries,
        }
    )
    if args.plan_only:
        print(json.dumps(report, indent=2))
        return 0

    def call(payload):
        return agentbridge_call(args.port, payload)

    report["status"] = "failed"
    args.work_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (
        (args.work_dir / ".generation.lock").open("a") as lock,
        SubtitleTrace(args.work_dir, fixture=False) as trace,
    ):
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError("A generation already owns this work directory") from error
        trace.counts["cue_count"] = len(source)
        result = execute(
            source,
            request,
            ranges,
            report,
            args.work_dir,
            workers=args.workers,
            timeout=args.timeout,
            retries=args.validation_retries,
            call=call,
            trace=trace,
            cache=None
            if args.no_cache
            else TranslationCache(args.cache_dir or args.work_dir / "validated-ranges"),
            resume=args.resume,
        )
        trace.complete(0)
    print(
        json.dumps(
            {
                key: result[key]
                for key in (
                    "status",
                    "usage",
                    "elapsed_seconds",
                    "valid_cues",
                    "model_calls",
                    "local_cache_hits",
                    "reused_generation",
                )
                if key in result
            }
        )
    )
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    add_arguments(parser)
    try:
        return run(parser.parse_args(argv))
    except (OSError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
