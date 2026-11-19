"""Run a standalone translation trial using an explicitly supplied MCP transport."""

import argparse
import asyncio
import json
import re
import time
from contextlib import AsyncExitStack
from pathlib import Path

from yomiru.captions import Cue, load_captions
from yomiru.subtitle_tracing import SubtitleTrace
from yomiru.translation import (
    TranslationCache,
    anchors,
    atomic_json,
    export_trial,
    normalize_overlapping_repeats,
    request_batch,
)
from yomiru.translation_context import (
    request_annotated_context,
    request_full_context,
    validate_annotated_response,
)


class ServiceAccessError(RuntimeError):
    pass


def corpus(path: Path, *, exclude_music_cues: bool = False):
    if path.suffix != ".json":
        cues = load_captions(path)
        if exclude_music_cues:
            cues = [cue for cue in cues if "♪" not in cue.text]
        return anchors(cues), {}
    data = json.loads(path.read_text())
    cues = [Cue(5000 + i * 5000, 9000 + i * 5000, row["japanese"])
            for i, row in enumerate(data["cases"])]
    source = anchors(cues)
    references = {c.id: row["reference"] for c, row in zip(source, data["cases"], strict=True)}
    return source, references


async def trial(args, session=None):
    with SubtitleTrace(args.work_dir, fixture=args.fixture) as trace:
        if args.fixture or session is not None:
            result = await _translate(args, session, trace)
        else:
            result = await _run_live(args, trace)
        trace.complete(result)
        return result


async def _translate(args, session, trace):
    with trace.stage("load source"):
        source, references = corpus(
            args.corpus, exclude_music_cues=getattr(args, "exclude_music_cues", False),
        )
        glossary_path = getattr(args, "glossary", None)
        glossary = json.loads(glossary_path.read_text()) if glossary_path else {}
        if not isinstance(glossary, dict) or not all(
            isinstance(k, str) and isinstance(v, str) and k.strip() and v.strip()
            for k, v in glossary.items()
        ):
            raise ValueError("Glossary must map Japanese terms to nonempty target-language names")
        models = json.loads(args.models.read_text()) if not args.fixture else [{
            "id": "fixture/authored-reference", "canonical_slug": "synthetic-v1",
            "strict_schema": True,
        }]
        if args.batch_size > 64 and any(
            model.get("prompt_profile") != "annotated-full-context" for model in models
        ):
            raise ValueError("Batch sizes above 64 require the annotated-full-context profile")
        trace.counts["cue_count"] = len(source)
    cache = TranslationCache(getattr(args, "cache_dir", None) or args.work_dir / "cache")
    reports = []
    for model in models:
        identity = model["id"]
        profile = model.get("prompt_profile", "isolated")
        if profile not in {"isolated", "full-context", "annotated-full-context"}:
            raise ValueError(f"Unknown translation prompt profile: {profile}")
        annotated = profile == "annotated-full-context"
        settings = {
            "model_revision": model.get("canonical_slug", identity), "glossary": glossary,
            "reasoning_effort": model.get("reasoning_effort", "low" if annotated else None),
        }
        translated, calls, hits, timings, errors = {}, 0, 0, [], []
        access_failed = False
        directory = args.work_dir / args.corpus.stem / identity.replace("/", "--")
        print(f"Starting {identity}: {len(source)} cues", flush=True)
        for first in range(0, len(source), args.batch_size):
            if annotated:
                ids = [cue.id for cue in source[first:first + args.batch_size]]
                request = request_annotated_context(source, ids, identity, args.target, **settings)
            else:
                builder = request_full_context if profile == "full-context" else request_batch
                request = builder(
                    source, first, args.batch_size, identity, args.target,
                    strict_schema=model.get("strict_schema", True), **settings,
                )
            atomic_json(directory / f"request-{first:04}.json", request)
            with cache.claim(request):
                cached = cache.get(request)
                if cached is not None:
                    trace.counts["cache_hits"] += 1
                    hits += 1
                    translated.update(cached)
                    continue
                trace.counts["cache_misses"] += 1
                started = time.monotonic()
                try:
                    with trace.stage("subtitle batch"):
                        if args.fixture:
                            if not references:
                                raise ValueError("Fixture mode requires original reference cases")
                            text = json.dumps({"translations": [
                                {"id": key, "text": references[key]} for key in request["ids"]
                            ]})
                        else:
                            calls += 1
                            try:
                                trace.counts["model_calls"] += 1
                                with trace.stage("call model"):
                                    result = await session.call_tool(
                                        "chat", arguments={**request["payload"], "store": False},
                                    )
                            except Exception as error:
                                raise ServiceAccessError(
                                    f"Model service call failed: {type(error).__name__}"
                                ) from None
                            text = "".join(c.text for c in result.content if c.type == "text")
                            if result.isError:
                                code = re.search(r"\berror\s+(\d{3})", text, re.I)
                                if code and int(code[1]) in {400, 404, 422}:
                                    raise ValueError(
                                        f"Model request is incompatible (HTTP {code[1]})"
                                    )
                                raise ServiceAccessError(
                                    "MCP request failed; review approved access"
                                )
                        elapsed = time.monotonic() - started
                        atomic_json(directory / f"response-{first:04}.json", {
                            "response": text, "elapsed_seconds": elapsed,
                            "source": (
                                "authored reference fixture" if args.fixture else "live MCP chat"
                            ),
                        })
                        if annotated:
                            # Preserve the original text in the response artifact.
                            # The local translation cache uses the common JSON format.
                            rows = validate_annotated_response(text, request["ids"])
                            cache_text = json.dumps({"translations": [
                                {"id": cue_id, "text": value} for cue_id, value in rows.items()
                            ]}, ensure_ascii=False)
                        else:
                            cache_text = text
                        translated.update(cache.put(request, cache_text))
                        if not args.fixture:
                            timings.append({"seconds": round(elapsed, 4), "characters": len(text),
                                            "characters_per_second": round(len(text) / elapsed, 2)})
                        print(f"Validated batch {first // args.batch_size + 1}", flush=True)
                except ServiceAccessError as error:
                    errors.append(str(error))
                    access_failed = True
                    break
                except (ValueError, OSError, TimeoutError) as error:
                    errors.append(str(error))
                    break  # No trial-level model fallback or retry.
        report = {
            "model": identity, "model_metadata": model, "live_calls": calls,
            "cache_hits": hits, "timings": timings, "errors": errors,
            "mode": (
                "offline authored-reference fixture" if args.fixture else "live model via MCP"
            ),
            "billed_tokens": None, "billed_cost_usd": None,
            "measurement_note": "MCP chat returns text only; characters/sec is not tokens/sec.",
            "review_status": "not semantically reviewed",
        }
        if not errors:
            with trace.stage("validate and render"):
                translated, report["overlap_consistency_changes"] = normalize_overlapping_repeats(
                    source, translated,
                )
                report["validation"] = export_trial(source, translated, directory, report)
                if references:
                    atomic_json(directory / "reference.json", references)
        atomic_json(directory / "report.json", report)
        reports.append(report)
        state = "failed" if errors else "valid"
        print(f"Finished {identity}: {state}; cache hits {hits}", flush=True)
        if access_failed:
            break  # Failed access is not permission to try another model or route.
    atomic_json(args.work_dir / f"{args.corpus.stem}-summary.json", reports)
    return 1 if any(r["errors"] for r in reports) else 0


async def _run_live(args, trace):
    if not args.live or args.server_command is None:
        raise ValueError("Live requests require --live and an approved external MCP command file")
    command = json.loads(args.server_command.read_text())
    if not isinstance(command, list) or not command or not all(isinstance(s, str) for s in command):
        raise ValueError("MCP command must be an explicit JSON argument array")
    # Optional transport dependencies belong to the selected MCP client's runtime.
    from mcp import ClientSession
    from mcp.client.stdio import StdioServerParameters, stdio_client

    async with AsyncExitStack() as stack:
        with trace.stage("connect MCP"):
            parameters = StdioServerParameters(command=command[0], args=command[1:])
            streams = await stack.enter_async_context(stdio_client(parameters))
            session = await stack.enter_async_context(ClientSession(*streams))
            await session.initialize()
        return await _translate(args, session, trace)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--models", type=Path)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument(
        "--cache-dir", type=Path, help="Reuse an existing cache across trial directories",
    )
    parser.add_argument("--target", default="English")
    parser.add_argument(
        "--exclude-music-cues", action="store_true",
        help="Exclude source events containing ♪ before assigning Japanese anchor IDs",
    )
    parser.add_argument(
        "--glossary", type=Path, help="JSON map of Japanese terms to canonical names",
    )
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--server-command", type=Path)
    parser.add_argument("--fixture", action="store_true")
    parser.add_argument("--live", action="store_true")
    options = parser.parse_args()
    if not 1 <= options.batch_size <= 15000:
        parser.error("--batch-size must be between 1 and 15000")
    if not options.fixture and options.models is None:
        parser.error("--models is required for a live trial")
    raise SystemExit(asyncio.run(trial(options)))
