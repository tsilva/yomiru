# Japanese-anchor translation trial

This standalone experiment translates Japanese subtitle text while code retains
the anchor timestamps. It does not connect generated tracks to Stremio, change
the running add-on, or certify translation quality or synchronization with audio.

The model receives Japanese cue IDs/text, nearby context and an optional glossary.
It returns only IDs and translated text. Code rejects missing, duplicate or unknown
IDs, empty text, formatting commands and attempts to supply timestamps. It then
builds Japanese and translated cues from the same anchor times and exports SRT,
styled romaji/translation ASS, a JSON review table and an escaped HTML preview.
Original pronunciation annotations are retained for the Japanese renderer.

The default is one target cue per request (`--batch-size 1`). Neighboring Japanese
cues are explicitly marked as before/after context and cannot be returned as
additional targets. The prompt prefers faithful English fragments over borrowing
words from another cue to form a complete sentence. This costs more requests and
repeated context than batching. Larger batches remain an explicit experiment;
they can move translated phrases across otherwise valid cue IDs. Even isolated
requests still require semantic review: structural isolation is not proof that a
model translated only the target's meaning.

Identical overlapping or touching captions with the same reading annotations reuse
one English translation. This prevents wording or gender changes between duplicate
caption events. Distant repetitions retain their own context and translations.

## Offline structural check

The original synthetic dialogue includes negation, uncertainty, omitted subjects,
family relationships, politeness and a sentence split across cues. Its English
references are review material and are never included in model requests.

```sh
uv run python -m yomiru.translation \
  --japanese /path/to/japanese.srt \
  --model google/gemini-2.5-flash-lite \
  --batch-size 1 --output .local/translation/prepared

PYTHONPATH=src uv run python scripts/translation_trial.py \
  --corpus examples/translation/synthetic.json \
  --fixture --batch-size 32 --work-dir .local/translation/trial
```

Preparation sends no inference request. Fixture mode uses the authored reference
translations and the separate `fixture/authored-reference` identity. It tests the
pipeline and cache, not an LLM. Running it twice should produce a cache hit on
the second pass. Its output explicitly identifies itself as an offline fixture.

## Live OpenRouter comparison

Use a separately approved MCP service exposing OpenRouter `chat`. The optional
MCP client library must already be available in the selected external client
runtime. No API key, credential discovery or personal runner is built into this
application. Supply the service's reviewed stdio command as a JSON argument array
through `--server-command`; this is a neutral executor input.

Both the Yomiru dependencies and the optional MCP client must be importable in
that interpreter. Selecting an MCP-only environment does not supply Yomiru's
Japanese renderer dependencies.

Create a model-plan JSON array with explicit model IDs and resolved revisions:

```json
[
  {
    "id": "google/gemini-2.5-flash-lite",
    "canonical_slug": "google/gemini-2.5-flash-lite",
    "strict_schema": true
  }
]
```

Check the current catalog rather than treating this example as a permanent model
choice. Providers must support the requested output parameters. Trials request
throughput routing with hard endpoint-price limits of $0.15/M input and $0.50/M
output tokens. These per-token limits are not an overall spending limit. No
model is declared the cheapest reliable choice until the translation trial passes.

An explicit model-plan `reasoning_effort` (for example `"none"`) is forwarded
through the MCP adapter and included in cache identity. Use only effort values
advertised by that model's current catalog. Reasoning can consume the output
budget without returning usable translation text; disabling it is a measured
configuration choice, not a guarantee of better speed or quality.

```sh
PYTHONPATH=src /path/to/approved-mcp-client-python scripts/translation_trial.py \
  --corpus /path/to/japanese.srt --models /path/to/model-plan.json \
  --server-command /path/to/approved-mcp-command.json \
  --live --batch-size 1 --work-dir .local/translation/trial
```

Use the same corpus, context and settings across models. Keep the trial bounded
and sequential. The trial runner never changes the requested model or credential
route. Endpoint routing remains OpenRouter's responsibility. Failed access
requires review of the existing route, not another key or route. The underlying
MCP service may have its own retries; any reliability study must account for them.
Malformed translations or incompatible model parameters are recorded as failures
for that candidate, then the next explicitly planned comparison can run. A service
or authentication failure stops the trial; it does not trigger another model/route.

For known character or place names, pass `--glossary /path/to/glossary.json`,
for example `{"シンテル": "Sintel", "スケール": "Scales"}`. Establish canonical
spellings from the work's metadata; Japanese transcription alone may be ambiguous.
The glossary enters the request and cache identity. Changing it causes a cache miss.

The current MCP chat tool returns response text without usage metadata. This
adapter measures end-to-end wall time and output characters/second, **not** true
token throughput, first-token latency or billed cost. Usage/cost fields remain
null. Catalog prices can inform a shortlist but do not prove the actual charge.

## Codex through AgentBridge

An explicit model-plan `"prompt_profile": "full-context"` selects the
`ja-anchor-translation-v6-full-context` prompt. It gives the model the complete
Japanese script and a separate list of target IDs. Only the requested targets
can appear in the response. The prompt emphasizes faithful cue fragments,
context-established participants, neutral fragments when a subject is ambiguous,
no imported clauses and a final source check.
It contains no episode-specific translations or corrections.

For example, with an approved MCP service that forwards AgentBridge model IDs:

```json
[
  {
    "id": "codex/gpt-6.1-sol",
    "canonical_slug": "codex/gpt-6.1-sol",
    "prompt_profile": "full-context",
    "reasoning_effort": "medium",
    "strict_schema": true
  }
]
```

```sh
PYTHONPATH=src /path/to/approved-mcp-client-python scripts/translation_trial.py \
  --corpus /path/to/japanese.ass --models /path/to/model-plan.json \
  --server-command /path/to/approved-mcp-command.json \
  --glossary /path/to/glossary.json --exclude-music-cues \
  --live --batch-size 64 --work-dir .local/translation/codex-trial
```

`--exclude-music-cues` removes source events containing `♪` before assigning
anchor IDs; omit it to retain them. Use the same source filtering for every
comparison. Pronunciation annotations remain available to the renderer but are
not sent as dialogue for translation.

For `codex/` routes, this profile omits OpenRouter routing/price options,
sampling temperature and `max_tokens` (ignored by the current Codex adapter).
Requests remain sequential through the supplied MCP
transport. Failed access stops the trial. Account-based inference still uses
account capacity; an unavailable monetary cost must not be reported as zero.
The MCP adapter exposes text only, so its standard report does not infer tokens,
reasoning usage or billed cost from character counts.

Full context repeats the Japanese script per batch. Check input limits for long
movies; the runner does not truncate context or substitute another model. More
reasoning, larger batches, source echo and extra review passes must each earn
selection through semantic checks and measured latency. Neither the profile nor
its output validator guarantees correct cue meaning or synchronization to audio.
Use an immutable backend revision when available for long-lived caches; a model
route alone may be a mutable alias.

### Single-model whole-file generation

For an explicit Codex experiment, `request_whole_context` prepares every cue in
one request using `ja-anchor-translation-v7-independent-fragments`. It includes
the complete Japanese script, optional terminology glossary and all target IDs.
It supplies no English draft or translated examples and requires no second model
or review pass. Code still owns cue times and rejects incomplete output.

```python
from yomiru.translation_context import request_whole_context
from yomiru.translation import validate_response

request = request_whole_context(
    anchors, "codex/gpt-6.1-sol", reasoning_effort="medium", glossary=glossary,
)
# Send request["payload"] through the explicitly selected AgentBridge client.
# Extract response_text from that single response.
translations = validate_response(response_text, request["ids"])
```

This request builder supports explicit `codex/` model IDs and does not change
existing batched profiles. Its output scope may exceed 64 cues. Select a client
with a suitable response deadline; a whole-file response may outlast a short MCP
client window. The builder does not change transport limits, fetch credentials,
retry failures or select another route. Model input/output limits and runtime
must accommodate the complete file. Use explicit same-model batches when those
limits require it, keeping the full source context when possible.

The batched full-context profile already sends the entire Japanese script on
every request. Whole-file generation therefore changes output scope and repeated
input processing, not the amount of Japanese context available. More coordinated
output does not guarantee better cue alignment. The v7 prompt prioritizes
independent faithful fragments and keeps reporting frames and modality within
the cue that expresses them. It does not force all English fragments into one
continuous grammatical sentence. Assess semantic fidelity separately from the
validator's complete-ID and unchanged-timestamp checks.

## Evaluate meaning separately from timing

For every response, validate complete cue coverage and exact paired timestamps.
Review negation, who did what, numbers, names, omitted subjects, idioms, register,
fragment continuation, omissions and invented information against the Japanese.
Use the synthetic references as semantic guidance, not an exact-string score.
They are model-authored checks, not an independent human gold standard; reviews
by a fluent speaker are still needed before production quality claims.
Flag reading speed above 20 characters/second for manual review; this is a trial
heuristic. Also flag Japanese characters left in the target translation.

Repeat promising models on held-out dialogue and more than one run before making
production speed/reliability claims. A well-formed response or high cache-hit rate
does not establish translation accuracy. Human review remains necessary.

### Source-grounded review pass

`yomiru.translation_review.review_batch` builds a separate review request from the
Japanese anchors and a complete draft translation. `validate_review` requires
every reviewed ID and an exact copy of that ID's Japanese source. A review can
keep, replace, or flag a cue as uncertain. Keeping or flagging uncertainty must
preserve its existing text; replacements must identify a meaning or cue-scope
issue. No-op and quotation-style-only corrections are rejected. Context-only cues
cannot become replacement targets. Review requests do
not contain timestamps, and changed draft text changes their cache identity.

```python
from yomiru.translation_review import review_batch, validate_review

request = review_batch(anchors, draft, 0, 24, model, reasoning_effort="none")
# Send request["payload"] through the explicitly selected model transport.
review = validate_review(model_response_text, request)
# Inspect review["changes"] and resolve review["uncertain"] before publication.
draft.update(review["translations"])
```

This additional model pass checks meaning rather than smoothing complete English
sentences across cue boundaries. Include its latency and token usage in pipeline
comparisons. Exact Japanese evidence prevents review-ID/source mismatches; it is
not proof of semantic correctness. Review uncertainty is explicit and must not be
silently treated as approval. Preserve the draft, raw reviews and change list.

### Automatic clause-scope review trial

The optional `clause_scope=True` review profile explicitly checks reporting frames,
conjunctions, modifiers and modality against each cue's own Japanese. Use
`full_context=True` to resolve references from the complete Japanese script.
`compact=True` returns all reviewed target IDs, only proposed corrections with
exact Japanese evidence, and explicit uncertainties. Code validates complete ID
coverage, rejects duplicate or out-of-scope proposals, expands implicit keeps
without editing them, and applies the same source/no-op/text guards as dense review.
Compact output reduces repetition; measure its latency rather than assuming it
will be faster. A reviewer's coverage declaration is not proof of correctness.

Run it on the exported `pairs.json` from a generation trial:

```sh
PYTHONPATH=src /path/to/approved-mcp-client-python scripts/translation_review_trial.py \
  --draft-pairs /path/to/generation/pairs.json \
  --model codex/gpt-6.1-terra --reasoning-effort low --batch-size 64 --compact \
  --server-command /path/to/approved-mcp-command.json \
  --work-dir .local/translation/reviewed
```

The runner preserves the draft, raw proposals, automatic change list and
uncertainty IDs, and exports a complete reviewed ASS/SRT/JSON/HTML set only when
all batches validate. Uncertain cues keep their draft text and remain flagged;
they are not silently approved. Identical overlapping source events retain the
same automatic consistency normalization as generation. Neither the review nor
its validator adjusts timestamps or uses manually corrected English references.

Review results use a local validated cache keyed by the complete review request,
including the draft and model settings. The runner is sequential; concurrent
review-worker coordination is not implemented. Choose separate work directories
for comparisons, and account for cache hits when measuring cold latency. Failed
service access stops with no retry or model/route fallback. Report generation
and review execution times separately and include both in pipeline comparisons.

An additional reproducible corpus is the Japanese subtitle file published with
the animated short *Sintel*: [Japanese SRT](https://download.blender.org/durian/subs/sintel_jp.srt).
The Blender Foundation releases the project under CC BY 3.0; retain attribution,
the applicable license and a notice of translation/modification with derivative
outputs. Source and license: [download page](https://durian.blender.org/download/),
[sharing information](https://durian.blender.org/sharing/).
Keep downloaded corpora and run-specific reports outside tracked source.

## Reuse across viewers

Validated batch results are content-addressed by the complete Japanese anchor
text/times, target language, exact request/prompt, glossary, model revision and
response format. User/account/session identity is absent. Different video edits
or subtitle timings generate different keys. Cache reads revalidate identity and
cue coverage; failed outputs never enter the cache. Local filesystem claims
coordinate workers so concurrent requests can reuse one completed generation.
Use `--cache-dir /path/to/cache` to share that cache across separate trial-output
directories without overwriting earlier measurement reports.

Cache entries remain marked `unreviewed`: structural validation is not a quality
approval. A shared production service would need a trusted generation worker,
distributed claims for multiple hosts, a review/promotion policy, storage limits,
source attribution/rights handling and immutable published revisions. No shared
server, public subtitle distribution or deployment is part of the trial itself.
Complete inspected results can be promoted separately through the
[administrator publication workflow](publishing.md).

OpenRouter references: [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection),
[structured output](https://openrouter.ai/docs/guides/features/structured-outputs).
