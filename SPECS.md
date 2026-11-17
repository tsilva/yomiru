# Product intent

Help viewers learn Japanese while watching anime in Stremio, using a paired
Japanese learning line and English meaning with clearly different appearance.

## Established direction

- Support rōmaji, hiragana, katakana and original Japanese display. Original
  Japanese preserves the source's mixed kanji/kana rather than forcing all-kanji text.
- Keep the learning line larger and pale yellow, with smaller pale-blue English below.
- Deliver styled ASS through a Stremio subtitle add-on; avoid per-episode file dragging
  in the eventual routine workflow.
- Preserve supplied source cue times unless timing adjustment is requested, and
  account for the chosen video release. A caption
  comparison is not a listening verification or a guarantee of word-level accuracy.
- Keep pronunciation corrections and provider coverage explicit. Missing Japanese
  subtitles must not be replaced with Japanese invented from an English translation.

## Automatic discovery

Starting an episode should offer Yomiru in Stremio's subtitle picker without
per-episode file downloads or dragging. Discover real Japanese and English
captions for the requested episode, then generate and cache the selected display
mode. Retain the manual-file workflow for missing coverage or corrected captions.

Coverage depends on upstream sources. Missing captions, provider failures and
ambiguous episode numbering must remain explicit; do not substitute a different
episode or claim universal availability. Preserve release uncertainty in labels.

## Source selection in Stremio

Implement Yomiru as a Stremio add-on with no browser extension installation.
Users select a source-specific Yomiru entry from Stremio's subtitle picker to
receive the Japanese learning line above that source in styled ASS. Keep source
choices explicit and preserve the selected source; failed downloads must not
silently substitute another track. Ordinary subtitles remain selectable when
the user does not want Yomiru.

The add-on API does not expose another add-on's selected track. Yomiru must serve
its own combined track rather than claim to intercept arbitrary player selections.
Keep provider/embedded-track coverage and timing limitations explicit. Retain
manual file composition for sources that discovery does not provide.

## Relative caption timing

Reduce small timing gaps between discovered Japanese and base captions when
there is consistent evidence across the caption timeline. Keep the chosen base
timeline as the reference; leave uncertain or changing offsets untouched. Support
nearby boundary alignment for clear one-to-one cue matches after a reliable fit,
preserving the text and distinct segmentation of other cues. Support
independent manual delays and an option to retain source timing. Record applied
adjustments and retain source files. Caption alignment is not audio verification
and must not claim to correct different edits or translation segmentation.

## Japanese-anchor translation experiment

Evaluate an optional AI translation pipeline independently of Stremio. Use real
Japanese subtitle anchors; generate only the target-language text and let code
retain cue identity/timestamps for both displayed languages. Compare low-cost
OpenRouter candidates on semantic quality, cue coverage and measured performance
before selecting a model. Keep validation distinct from translation accuracy.
Keep translated meaning within its own Japanese cue, preferring faithful fragments
over moving phrases to neighboring cues for smoother English word order.
The intended routine workflow must be fully automatic: episode-specific editorial
corrections are not a solution. Compare stronger models using unedited outputs,
keeping evaluation references separate from translation inputs.
For the next iteration, use Codex models through AgentBridge before further
OpenRouter trials. Compare prompts, context, batching, reasoning levels and
available Sol/Terra variants, prioritizing semantic and cue alignment accuracy
before measured throughput. Keep development checks separate from an untuned
evaluation sample; report the best tested configuration rather than claiming
universal optimality.
Prefer a single model and one zero-shot generation pass for the intended
translation workflow. Evaluate whole-episode output against batched output;
do not assume output batching is needed for context or that a separate reviewer
is required. Keep the full Japanese script available when the chosen model's
input limits allow it, while preserving each cue's own meaning and timestamps.
Reuse translations by exact subtitle content, language, prompt and model version.
Use reviewed corrected subtitles as a frozen evaluation reference, never as English
examples or drafts supplied to generation. For the current search, restrict inference
to AgentBridge Codex Sol 6.1 and Terra 6.1. Compare generic prompts and reasoning
levels on a whole episode, confirm promising settings with repeats and additional
material, and select accuracy before token and time efficiency. Report observed
errors and ambiguity rather than claiming perfect accuracy or treating stylistic
paraphrases as failures. Keep account-backed token usage separate from unavailable
monetary cost.
Experimental inputs should retain original Japanese reading and speaker annotations
as context, while translating only the cleaned dialogue. Benchmark context
compression against fidelity. Future model comparisons should use inexpensive
diagnostics to shortlist candidates, followed by whole-source confirmation on
untouched material; keep screening metrics separate from production results.
Administrators may bootstrap the shared library using Codex through their own
AgentBridge account route. Generation remains separate from public serving.

## Published subtitle library

Serve administrator-published, complete learning tracks through a public HTTPS
Stremio add-on. Viewers need no local process, provider key or AgentBridge setup.
Keep generation under Yomiru's administrative control; user-generated uploads
and user-supplied inference credentials are outside the initial delivery.
Publish only complete validated episodes with explicit source attribution and
release/timing uncertainty. Structural validation does not certify translation
accuracy or synchronization with audio. Preserve immutable track revisions and
existing coverage when adding episodes or updating the website. Keep downloaded
sources, translation traces and generated subtitle files outside tracked source.
Store published tracks in a shared object bucket, separate from website deployments.
An administrator can add complete episodes without rebuilding or redeploying the
website. Publish immutable assets and a matching catalogue snapshot before
atomically updating the current-library pointer. Refresh serving instances from
that pointer, preserve existing coverage, and keep uploads restricted to the
administrator. Public playback never runs translation or language-model inference.
Serving may deterministically compose and cache the published ASS with a feedback
card; preserve the original dialogue, styling, geometry and timing.
Bootstrap Evangelion episodes 1 and 2, verify hosted discovery and serving, then
retire their local Stremio alternatives while retaining reconstruction evidence.

Offer an "Available with Yomiru" catalogue in Stremio, derived from the published
library. Show which shows and episodes have subtitles, identify subtitle sources,
and distinguish subtitle availability from release compatibility. Current tracks
must retain explicit unverified timing labels; catalogue presence never implies
synchronization with every video release. Keep standard episode identities for
playback through the user's existing stream add-ons.

Use the original series title, synopsis and episode names in the Stremio
catalogue. Do not add episode counts, availability text or timing warnings to
those fields. Keep subtitle source and compatibility details in their dedicated
episode information, picker and feedback surfaces.

Build a catalogue of video versions seen in Stremio subtitle requests, using
available video hashes, file sizes and sanitized filenames. A request is evidence
that a source was seen, not proof of playback or selection of our subtitle.
Keep sources with no feedback visible as unrated. Collect only binary
"works" / "doesn't work" feedback initially, pooled as the percentage of positive
votes with positive, negative and total counts. Zero votes mean unknown, not
failure. Scope feedback to the video version and subtitle revision; a changed
revision must not inherit its predecessor's rating. Share reports across reading
modes of the same generated source revision. Anonymous browser votes are
changeable and are community reports, not administrator verification. Expose
source/feedback pages through Yomiru catalogue links and summary labels in the
subtitle picker; do not claim a custom native player confirmation button exists.

Show a feedback card at 00:00–00:03 in hosted subtitle tracks, replayable by
seeking back. Use “Please leave your feedback” and “Scan or go to link for
feedback”, with Yomiru branding, a real QR code and a short HTTPS destination.
Omit the episode/source footer. Bind feedback to the subtitle revision and video
source when Stremio supplies it; otherwise require manual source selection.
ASS links are not clickable; scanning or typing opens the feedback page, without
casting a vote.

Keep subtitle picker labels compact: identify Yomiru with a fox emoji and put
the reading mode first. Offer rōmaji first while retaining the other modes,
source attribution and explicit timing uncertainty. Group hosted learning tracks
under Japanese so viewers can choose Japanese as their preferred subtitle language;
keep the English meaning line and published target-language metadata intact.
Stremio controls automatic
selection; do not claim the add-on can force a default variant.

## Delivery boundary

Publish a minimal public landing page at `yomiru.tsilva.eu`, using the approved
cinematic layout, Stremio's dark palette and violet accent, Yomiru branding,
one subtitle preview and one install action. Fill the viewport with artwork
behind the logo and copy, including on portrait screens. Use a subtle dark
overlay to emphasize the headline and install action. Artwork should feel
calm and welcoming, with people clearly away from railway
tracks and unprotected edges. Use “Koko wa ochitsuku ne.” / “It’s peaceful here, isn’t it?”
for the desktop and portrait artwork subtitle example. The install action opens
the hosted add-on directly in Stremio, with its Yomiru icon; Stremio controls
installation confirmation. Keep manual instructions behind optional installation
help rather than adding navigation or feature sections. Preserve the stable
manifest URL so published subtitle and server updates reach existing installations.
Do not claim the add-on can force Stremio to refresh saved manifest metadata.

Place a compact searchable subtitle library below the landing hero, without a
separate header or navigation. Use a full-width search field and compact Show,
Season, Episode and Translations columns with an action to open the episode in
Stremio. Omit the timing column and reading-mode selector from this table.
Load additional rows automatically as the viewer approaches the page bottom;
search covers the published library, not just the rows already loaded.
Show available translations from Japanese into target languages independently
of Japanese reading modes. Original Japanese retains its mixed kanji/kana;
rōmaji, hiragana and katakana are derived displays, not separate translations.
Show only actual published coverage. Omit aggregate counts and catalogue footer
notes; preserve timing uncertainty in subtitle/source details outside this table.
Add a secondary “Browse subtitles” anchor beneath the hero's install action to
scroll to the library; respect reduced-motion preferences.
Omit catalogue media artwork unless Yomiru
need neither scrape nor host it. This section is the exception to the minimal
landing page's exclusion of additional sections; preserve the hero above it.

The install button has a raised violet face, a centered label and no arrow.
Its face visibly depresses while pressed with mouse, touch or keyboard.

Keep the local subtitle add-on available for manual/offline work. Synthetic
examples provide a reproducible offline result. Downloaded episode content is
not bundled in source.

Offer persistent local startup so watching does not depend on an active chat or
terminal session. Preserve unrelated processes and service configurations.

Stronger release matching and per-show reading corrections remain future work.
No specific upstream provider or
hosting platform is a permanent commitment.
