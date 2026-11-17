"""Run an automatic Japanese cue-scope review through an explicit MCP transport."""

import argparse
import asyncio
import json
import time
from pathlib import Path

from yomiru.translation import (
    Anchor,
    atomic_json,
    export_trial,
    normalize_overlapping_repeats,
    paired_cues,
)
from yomiru.translation_review import review_batch, validate_compact_review, validate_review


async def trial(args, session):
    started = time.monotonic()
    data = json.loads(args.draft_pairs.read_text())
    source = [Anchor(row["id"], row["start"], row["end"], row["japanese"],
                     row.get("reading_source", "")) for row in data["cues"]]
    if len({cue.id for cue in source}) != len(source):
        raise ValueError("Draft has duplicate anchor IDs")
    draft = {row["id"]: row["translation"] for row in data["cues"]}
    paired_cues(source, draft)
    translated, changes, uncertain, calls, hits, errors = {}, [], [], [], 0, []
    args.work_dir.mkdir(parents=True, exist_ok=True)
    validator = validate_compact_review if getattr(args, "compact", False) else validate_review
    for first in range(0, len(source), args.batch_size):
        request = review_batch(
            source, draft, first, args.batch_size, args.model,
            reasoning_effort=args.reasoning_effort, full_context=True, clause_scope=True,
            compact=getattr(args, "compact", False),
        )
        atomic_json(args.work_dir / f"request-{first:04}.json", request)
        cache = args.work_dir / "cache" / f"{request['key']}.json"
        response = None
        if cache.is_file() and not cache.is_symlink():
            try:
                cached = json.loads(cache.read_text())
                if cached["key"] == request["key"]:
                    validator(cached["response"], request)
                    response = cached["response"]
                    hits += 1
            except (ValueError, KeyError, TypeError, OSError):
                pass
        try:
            if response is None:
                tick = time.monotonic()
                try:
                    result = await session.call_tool("chat", arguments=request["payload"])
                except Exception as error:
                    raise RuntimeError(
                        f"Model service failed: {type(error).__name__}; no retry or fallback"
                    ) from None
                response = "".join(c.text for c in result.content if c.type == "text")
                elapsed = time.monotonic() - tick
                calls.append({"key": request["key"], "seconds": elapsed})
                atomic_json(args.work_dir / f"response-{first:04}.json", {
                    "response": response, "seconds": elapsed, "is_error": bool(result.isError),
                })
                if result.isError:
                    raise RuntimeError("Model service failed; no retry or model/route fallback")
            reviewed = validator(response, request)
            atomic_json(cache, {"key": request["key"], "response": response,
                                "review_status": "unreviewed automatic proposal"})
            translated.update(reviewed["translations"])
            changes.extend(reviewed["changes"])
            uncertain.extend(reviewed["uncertain"])
            print(f"Reviewed {len(translated)}/{len(source)} cues; "
                  f"{len(changes)} changes; {len(uncertain)} uncertain", flush=True)
        except (ValueError, RuntimeError, OSError) as error:
            errors.append(str(error))
            break
    report = {
        "model": args.model, "reasoning_effort": args.reasoning_effort,
        "profile": ("ja-cue-review-v4-compact" if getattr(args, "compact", False)
                    else "ja-cue-review-v3-clause-scope"), "batch_size": args.batch_size,
        "cues": len(source), "validated_cues": len(translated), "calls": calls,
        "live_calls": len(calls), "cache_hits": hits, "errors": errors,
        "changes": changes, "uncertain": uncertain, "manual_corrections": 0,
        "billed_cost_usd": None, "reported_tokens": None,
        "review_status": "automatic review; not independently human verified",
        "draft_metadata": data.get("metadata", {}),
        "mode": "live model via explicit MCP; automatic source-grounded review",
    }
    atomic_json(args.work_dir / "draft-translations.json", draft)
    if not errors:
        atomic_json(args.work_dir / "reviewed-translations.json", translated)
        translated, report["overlap_consistency_changes"] = normalize_overlapping_repeats(
            source, translated,
        )
        report["validation"] = export_trial(source, translated, args.work_dir / "artifacts", report)
    report["review_pipeline_seconds"] = time.monotonic() - started
    atomic_json(args.work_dir / "report.json", report)
    return 1 if errors else 0


async def main(args):
    command = json.loads(args.server_command.read_text())
    if not isinstance(command, list) or not command or not all(isinstance(s, str) for s in command):
        raise ValueError("MCP command must be an explicit JSON argument array")
    from mcp import ClientSession
    from mcp.client.stdio import StdioServerParameters, stdio_client

    started = time.monotonic()
    async with stdio_client(StdioServerParameters(command=command[0], args=command[1:])) as streams:
        async with ClientSession(*streams) as session:
            await session.initialize()
            status = await trial(args, session)
    report_path = args.work_dir / "report.json"
    report = json.loads(report_path.read_text())
    report["transport_pipeline_seconds"] = time.monotonic() - started
    atomic_json(report_path, report)
    return status


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--draft-pairs", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--reasoning-effort", default="medium")
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument(
        "--compact", action="store_true", help="Return corrections and uncertainty only",
    )
    parser.add_argument("--server-command", type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 64:
        parser.error("--batch-size must be between 1 and 64")
    raise SystemExit(asyncio.run(main(args)))
