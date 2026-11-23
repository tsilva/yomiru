"""Run and resume private, source-grounded subtitle review in AgentBridge."""

import fcntl
import hashlib
import http.client
import json
import time
from dataclasses import asdict
from pathlib import Path

from yomiru.captions import parse_document
from yomiru.publication import load_pairs
from yomiru.source_archive import MAX_SOURCE_BYTES
from yomiru.translation import anchors, atomic_json, digest
from yomiru.translation_harness import (
    DEFAULT_MODEL,
    MAX_BATCH_PROMPT_CHARS,
    MAX_BATCHES_PER_JOB,
    MAX_SHARED_CHARS,
    agentbridge_call,
    full_anchors,
    usage_totals,
)
from yomiru.translation_review import review_batch, validate_compact_review

SCENE_CUES = 48
CONTEXT_RESERVE = 24_000
MAX_CONTEXT = 240_000
SHARED_CONTEXT = (
    "Each review packet supplies the annotated Japanese and the English draft for its "
    "targets. Review all and only those targets. Use adjacent Japanese as context only."
)
RESPONSE_PROMPT = (
    "Return one JSON object with this shape:\n"
    '{"reviewed_ids":["c00001"],"changes":[{"id":"c00001","japanese":"exact target Japanese",'
    '"text":"corrected English","issue":"meaning","reason":"specific error in context"}],'
    '"uncertain":[]}\n'
    """\
The example IDs and text are placeholders. List all actual targets in reviewed_ids.
Allowed change issues are meaning and cue_scope. For each uncertain cue return id,
exact japanese and reason. Never repeat kept English. Copy evidence from the
target japanese field, using source_annotation to interpret it when present."""
)


def review_inputs(source_path, pairs_path, *, dialogue_only):
    with source_path.open("rb") as stream:
        source_bytes = stream.read(MAX_SOURCE_BYTES + 1)
    if len(source_bytes) > MAX_SOURCE_BYTES:
        raise ValueError("Original Japanese subtitles exceed the input limit")
    cues = parse_document(source_bytes.decode("utf-8-sig"), source_path.suffix.lower()[1:])
    source = anchors(cues) if dialogue_only else full_anchors(cues)
    pairs_bytes, pairs = load_pairs(pairs_path)
    if not isinstance(pairs, dict) or not isinstance(pairs.get("cues"), list):
        raise ValueError("Expected generated translation pairs")
    metadata = pairs.get("metadata", {})
    if not isinstance(metadata, dict):
        raise ValueError("Expected translation pairs metadata")
    language = metadata.get("target") or metadata.get("translation_language")
    if language and language != "English":
        raise ValueError("This review supports English translation pairs")
    if len(source) != len(pairs["cues"]):
        raise ValueError("Draft coverage differs from the Japanese source")
    draft = {}
    for cue, row in zip(source, pairs["cues"], strict=True):
        if not isinstance(row, dict) or any(
            type(row.get(key)) is not type(value) or row[key] != value
            for key, value in asdict(cue).items()
        ):
            raise ValueError(f"Draft differs from the source at {cue.id}")
        draft[cue.id] = row.get("translation")
    return source, draft, {
        "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
        "draft_sha256": hashlib.sha256(pairs_bytes).hexdigest(),
    }


def annotated(cue):
    row = {"id": cue.id, "japanese": cue.japanese}
    if cue.reading_source and cue.reading_source != cue.japanese:
        row["source_annotation"] = cue.reading_source
    return row


def plan_review(source, draft, args):
    indices = {cue.id: index for index, cue in enumerate(source)}
    if ((args.first_cue and args.first_cue not in indices)
            or (args.last_cue and args.last_cue not in indices)):
        raise ValueError("Review bounds must be IDs in the exact Japanese source")
    start = indices[args.first_cue] if args.first_cue else 0
    stop = indices[args.last_cue] + 1 if args.last_cue else len(source)
    if start >= stop:
        raise ValueError("Review bounds must be in source order")
    shared = SHARED_CONTEXT
    if args.full_context:
        shared += "\nEpisode Japanese for context only:\n" + json.dumps(
            [annotated(cue) for cue in source], ensure_ascii=False, separators=(",", ":"),
        )
    if len(shared) > MAX_SHARED_CHARS or len(shared.encode()) + CONTEXT_RESERVE > MAX_CONTEXT:
        raise ValueError("Episode context exceeds the request limit; omit --full-context")

    packets = {}
    while start < stop:
        end = min(start + SCENE_CUES, stop)
        if end < stop:
            gap, boundary = max(
                (source[i].start - source[i - 1].end, i) for i in range(end - 8, end + 1)
            )
            if gap >= 2000:
                end = boundary

        while True:
            request = review_batch(
                source, draft, start, end - start, args.model, compact=True, clause_scope=True,
                explain=True, reasoning_effort=args.reasoning_effort,
            )
            instruction, user = request["payload"]["messages"]
            body = json.loads(user["content"])
            for row in body["cues"] + body["context_only"]:
                row.update(annotated(source[indices[row["id"]]]))
            prompt = RESPONSE_PROMPT + "\nReview packet:\n" + json.dumps(
                body, ensure_ascii=False, separators=(",", ":"),
            )
            context = sum(len(s.encode()) for s in (instruction["content"], shared, prompt))
            context += CONTEXT_RESERVE
            if len(prompt) <= MAX_BATCH_PROMPT_CHARS and context <= MAX_CONTEXT:
                break
            if end == start + 1:
                raise ValueError(f"Review over request limit at {source[start].id}")
            end = start + (end - start) // 2
        ids = request["ids"]
        key = f"{ids[0]}-{ids[-1]}"
        packets[key] = {"request": request, "prompt": prompt, "context": context}
        start = end

    plan = {
        "format": 1,
        "model": args.model,
        "reasoning_effort": args.reasoning_effort,
        "instructions": instruction["content"],
        "prompt_version": request["prompt_version"],
        "shared_context_sha256": digest(shared),
        "batches": [
            {
                "id": key, "reviewed_ids": packet["request"]["ids"],
                "prompt_sha256": digest(packet["prompt"]),
                "context_bound": packet["context"],
            }
            for key, packet in packets.items()
        ],
    }
    return plan, shared, packets


def validate_packet(output, packet):
    return validate_compact_review(output, packet["request"], explain=True)


def review_job(manifest, shared, packets, args, call):
    directory = args.work_dir
    manifest_path = directory / "manifest.json"
    checkpoint = directory / "checkpoint.json"
    if manifest_path.exists():
        if not args.resume:
            raise ValueError("Choose a fresh review directory or use --resume")
        if json.loads(manifest_path.read_bytes()) != manifest:
            raise ValueError("Review inputs or plan changed; use a separate directory")
    elif args.resume or checkpoint.exists():
        raise ValueError("No saved review plan to resume")
    else:
        if any(path.name != ".lock" for path in directory.iterdir()):
            raise ValueError("Choose an empty work directory for a new review")
        atomic_json(manifest_path, manifest)

    state = {"plan_key": manifest["plan_key"], "results": {}, "attempts": []}
    if checkpoint.exists():
        state = json.loads(checkpoint.read_bytes())
        if (not isinstance(state, dict) or state.get("plan_key") != manifest["plan_key"]
                or not isinstance(state.get("results"), dict)
                or not isinstance(state.get("attempts"), list)
                or state["results"].keys() - packets.keys()):
            raise ValueError("Review checkpoint does not match the saved plan")
    results = {}
    for key, saved in state["results"].items():
        if (not isinstance(saved, dict) or not isinstance(saved.get("output"), str)
                or digest(saved["output"]) != saved.get("sha256")):
            raise ValueError(f"Saved review output changed for {key}")
        results[key] = validate_packet(saved["output"], packets[key])

    started = time.monotonic()
    pending = [key for key in packets if key not in results]
    previous_attempts = len(state["attempts"])
    for start in range(0, len(pending), MAX_BATCHES_PER_JOB):
        wave = pending[start:start + MAX_BATCHES_PER_JOB]
        before = time.monotonic()
        try:
            reply = call({
                "model": manifest["model"],
                "reasoning_effort": manifest["reasoning_effort"],
                "instructions": manifest["instructions"],
                "shared_context": shared,
                "parallelism": min(args.workers, len(wave)),
                "minimum_context_window": max(packets[key]["context"] for key in wave),
                "timeout_seconds": args.timeout,
                "batches": [{"id": key, "prompt": packets[key]["prompt"]} for key in wave],
            })
        except (OSError, http.client.HTTPException, ValueError) as error:
            reply = {}
            failure = str(error) if isinstance(error, ValueError) else type(error).__name__
        else:
            failure = None

        failures = {}
        if not isinstance(reply, dict) or not isinstance(reply.get("batches"), list) or [
            row.get("id") if isinstance(row, dict) else None for row in reply["batches"]
        ] != wave:
            failures = dict.fromkeys(wave, failure or "Unexpected AgentBridge batch IDs")
            reply = reply if isinstance(reply, dict) else {}
        else:
            for key, batch in zip(wave, reply["batches"], strict=True):
                if batch.get("status") != "completed":
                    failures[key] = "AgentBridge did not complete this batch"
                    continue
                output = batch.get("output")
                try:
                    results[key] = validate_packet(output, packets[key])
                except ValueError as error:
                    failures[key] = str(error)
                else:
                    state["results"][key] = {"output": output, "sha256": digest(output)}

        state["attempts"].append({
            "batch_ids": wave,
            "run_id": reply.get("id"),
            "model_calls": len(reply["batches"]) + int(reply.get("warmup") is not None)
            if isinstance(reply.get("batches"), list) else None,
            "usage": reply.get("usage") or {},
            "elapsed_seconds": round(time.monotonic() - before, 3),
            "failures": failures,
        })
        atomic_json(checkpoint, state)
        if len(failures) == len(wave):
            break

    reviewed = [key for key in packets if key in results]
    attempts = state["attempts"][previous_attempts:]
    calls = [attempt["model_calls"] for attempt in attempts]
    report = {
        "status": "complete" if len(reviewed) == len(packets) else "incomplete",
        "plan_key": manifest["plan_key"],
        "reviewed_ids": [cue for key in reviewed for cue in packets[key]["request"]["ids"]],
        "changes": [change for key in reviewed for change in results[key]["changes"]],
        "uncertain": [cue for key in reviewed for cue in results[key]["uncertain"]],
        "pending_batches": [key for key in packets if key not in results],
        "reused_batches": len(packets) - len(pending),
        "model_calls": sum(calls) if all(call is not None for call in calls) else None,
        "usage": usage_totals(attempts),
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "attempts": state["attempts"],
    }
    atomic_json(directory / "proposals.json", report)
    return report


def add_arguments(parser):
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--pairs", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--dialogue-only", action="store_true")
    parser.add_argument("--first-cue")
    parser.add_argument("--last-cue")
    parser.add_argument("--full-context", action="store_true")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--reasoning-effort", choices=("low", "medium", "high"), default="low")
    parser.add_argument("--workers", type=int, choices=(1, 2, 3, 4), default=1)
    parser.add_argument(
        "--timeout", type=int, choices=range(30, 1201), metavar="30..1200", default=600,
    )
    parser.add_argument("--port", type=int, default=8082)
    parser.add_argument("--resume", action="store_true")


def run(args):
    if not args.model.startswith("codex/") or not 1 <= args.port <= 65535:
        raise ValueError("Choose a codex/ model and a valid AgentBridge port")
    source, draft, identity = review_inputs(
        args.source, args.pairs, dialogue_only=args.dialogue_only,
    )
    plan, shared, packets = plan_review(source, draft, args)
    manifest = {**plan, **identity}
    manifest["plan_key"] = digest(manifest)
    args.work_dir.mkdir(parents=True, exist_ok=True)
    with (args.work_dir / ".lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("A review is already running in this directory") from None
        report = review_job(
            manifest, shared, packets, args, lambda payload: agentbridge_call(args.port, payload),
        )

    print(json.dumps({
        "status": report["status"],
        "proposal_file": str(args.work_dir / "proposals.json"),
        "reviewed_cues": len(report["reviewed_ids"]),
        "changes": len(report["changes"]),
        "uncertain": len(report["uncertain"]),
        "pending_batches": report["pending_batches"],
        "reused_batches": report["reused_batches"],
        "model_calls": report["model_calls"],
        "usage": report["usage"],
        "elapsed_seconds": report["elapsed_seconds"],
    }))
    return int(report["status"] != "complete")
