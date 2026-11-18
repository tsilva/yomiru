# Public landing page

The landing page at `https://yomiru.tsilva.eu` introduces Yomiru with one subtitle
preview and one installation action. Artwork fills the viewport behind the logo
and copy, with a subtle dark overlay to emphasize the headline and install
action; portrait screens use a dedicated composition to retain the subtitle
example. Both backgrounds are text-free; responsive HTML/CSS places a larger
pale-yellow Japanese reading above smaller pale-blue English. Six pairs in
`web/src/hero-captions.mjs` play in a fixed 22.6-second scene: each stays visible
for 3.4–4 seconds, with only 100ms between pairs, including the loop restart.
Lines appear together as complete subtitles. The small pause control
appears on hover or keyboard focus and stays visible on touch devices. Hidden
tabs and the open installation modal pause the clock; closing the modal resumes
from the same position while preserving a manual pause. Reduced-motion preferences
keep the first pair static.
Opening help or searching the library does not restart the sequence. Examples
are original staged dialogue, separate from recorded audio and the episode library; Japanese
source, pronunciation and English meaning remain distinct in the data.
The main **Install in Stremio** button opens the installation guide. Its own
**Install in Stremio** button opens `stremio://yomiru.tsilva.eu/manifest.json`;
the viewer confirms installation in Stremio. There is no separate help link.
The guide includes the manual manifest URL if the app does not open. The
help dialog has a light circular × close button overlapping its upper-left corner
outside the panel bounds, and a numbered guide: open Stremio and confirm installation
with the in-guide button, enable **Style ASS subtitles** as step 2, open an
episode from your usual Stremio catalogue, choose Japanese subtitles or make
Japanese the preferred language, then select a Yomiru reading mode.
Keyboard users retain visible focus on controls. The same
domain serves the manifest and exact-episode subtitle API. With R2 and Neon
configured, immutable ASS files are delivered from Cloudflare R2 and the
catalogue is read from Neon. Existing website asset URLs still resolve.
Viewers need no local process. Public
requests never trigger generation. See [publishing](publishing.md).

The manifest supplies the 256×256 Yomiru fox icon and uses revalidation caching
so subsequent fetches check the current deployment. Its URL and add-on ID stay
stable. Server updates apply to subsequent requests; the library reader checks
the current publication on every API request. Stremio controls refreshes of saved
manifest metadata; changing cache headers cannot force that refresh. See
[updates](usage.md#updates) for the distinction.

The raised violet install button has a centered label and depresses while
pressed. Its hit area stays stationary, keyboard focus remains visible, and
reduced-motion settings remove the transition while retaining the pressed state.

Below the full-viewport hero, a compact searchable library groups published subtitle
episodes by show. The **Browse subtitles** link beneath the install button scrolls
to it. Shows start expanded and can be collapsed with mouse or keyboard. Each
group has separate **Episode**, **Title** and **Translations** columns. On narrow
screens, rows reflow to keep all fields and controls in view without horizontal
scrolling. Episode codes such as **S01E01** and **S02E02** sort numerically by
season, then episode, without
separate season groups. It has no artwork, reading-mode selector or timing column.
Search by show, episode title or episode code covers all published episodes and
automatically expands matching groups, including previously collapsed shows;
additional rows load automatically as the viewer approaches the page bottom.
Each row links to the exact episode in Stremio, where the viewer chooses a stream
and a Yomiru subtitle variant.

Episode checkboxes select vocabulary independently of Stremio playback. Selecting
an episode reveals a sticky bar with the combined unique-word count,
**Browse words**, and **Download CSV**. Search and
collapsed groups preserve the selection. Clearing the search reveals selected
rows again. Words shared by episodes appear once, with accumulated occurrences
and episode references.
The checkbox above each show's episode rows selects the whole show. It includes
vocabulary-ready episodes hidden by search or pagination and reflects partial
selection. You can still select individual episodes. Selecting or clearing one
show preserves other shows' selections.
The counter requests the exact unique-word count and English meaning coverage across the
selection. Browse words and Download CSV load word details on demand. The bar
keeps its space while the count loads and provides recovery instructions for
failed or stale selections.
Episodes without published vocabulary have disabled checkboxes.
**Browse words** starts with grammatical category, followed by Japanese with
readings, a short English meaning, expandable definitions and the number of uses across
the selection. The most frequent words appear first. Filter by category, search
by spelling, reading or English meaning, or switch to written or spoken Japanese
frequency. CSV includes all selected words in that order with English meanings.
Shared master meanings come from JMdict, JMnedict and supported corrections.
The browser and export keep words with missing meanings visible. Meanings are
dictionary-level definitions. Exports include dictionary attribution.
See [vocabulary exports](vocabulary.md) for grouping, fields and Anki preparation.

## Development

The frontend lives in `web/` and uses the committed pnpm lockfile. Use Node.js
22 or newer and the package manager version declared in `web/package.json`.

```sh
cd web
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev -- --port auto
```

The server prints its selected URL and refuses an occupied explicit port.
Terminate it when finished. To create the static build:

```sh
pnpm build
pnpm test:hero
pnpm test:vocabulary
pnpm test:sites
```

`web/dist/client/` contains the public files. Keep generated builds and
`node_modules` out of Git. The bundled hosting worker is retained for optional
Sites compatibility.

To preview a complete unpublished library candidate without uploading, set
`YOMIRU_LIBRARY_DIR=/absolute/path/to/library` when starting `pnpm dev -- --port auto`.
The development server validates that library and reads its vocabulary locally;
omitting the setting uses the live public library. This setting is development-only.

## Vercel

The `yomiru` project uses `web/` as the application directory when deploying
from this checkout. Its settings are in `web/vercel.json`. The build requires
no application secrets and includes no generated subtitles. The add-on reads the
current library from Vercel Blob at runtime. Adding episodes uses the separate
[administrator upload command](publishing.md), without a website deployment.
The protected Production upload endpoint uses the store's OIDC connection.
Domain assignment and authoritative DNS are separate
from deployment; preserve unrelated DNS records.

Direct CLI deployment does not establish automatic delivery from Git. For Git
delivery, configure a remote, set up the maintained production-delivery workflow,
and verify its CI and exact-commit production gates.

## Artwork

The fox is the existing Yomiru brand asset. Native image edits remove the former
subtitle lettering from both station-courtyard backgrounds. The edit brief is
to remove only the two subtitle lines and their shadows, reconstruct the paving,
and preserve the scene, lighting and framing without adding text or objects.
All captions, page copy and controls are rendered separately. Desktop uses the
wide scene, cropped toward the right; narrow screens use the portrait scene
with a centered crop. Caption position, wrapping and type size adapt to the
viewport independently of the artwork. The reader sits on a bench under the station
awning, with broad paving and a railing separating the courtyard from the sea.
