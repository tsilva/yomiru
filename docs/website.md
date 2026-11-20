# Public landing page

The landing page at `https://yomiru.tsilva.eu` introduces Yomiru with one subtitle
preview and one installation action. Artwork fills the viewport behind the logo
and copy, with a subtle dark overlay to emphasize the headline and install
action; portrait screens use a dedicated composition to retain the subtitle
example. Both backgrounds are text-free; responsive HTML/CSS places a larger
pale-yellow Japanese reading above smaller pale-blue English. Six pairs in
`web/src/hero-captions.mjs` play in a fixed 22.6-second scene: each stays visible
for 3.4–4 seconds, with only 100ms between pairs, including the loop restart.
Lines appear together as complete subtitles. The small pause control appears on
desktop hover or keyboard focus and is hidden on mobile. Hidden tabs and the
open installation modal pause the clock. Closing the modal resumes from the same
position while preserving a manual pause. Reduced-motion preferences keep the
first pair static. The circular GitHub icon in the upper-right corner opens the
[Yomiru repository](https://github.com/tsilva/yomiru) in a new tab.
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
episode from your usual Stremio catalogue, choose a supported translation
language, then select a Yomiru reading mode.
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
On mobile, the browser theme color matches the top of the install button gradient.

Below the full-viewport hero, a cool blue fade leads into the searchable
subtitle gallery. Faint particles stay still with reduced motion. **Browse
subtitles** scrolls to the gallery. Open a series or film collection to see
its published titles in the same section. The gallery uses original collection
covers and widescreen episode illustrations. Rebuild of Evangelion and One Piece
Movies have newly illustrated portrait posters with title lettering inspired by
each film's release poster. Movies without artwork use a film icon. The full
title appears below each image or placeholder.

Episode captions include codes such as **S01E01**, and series have a season
selector. Movie codes such as **M01** are searchable. **Rebuild of Evangelion**
and **One Piece Movies** follow their film sequence. **Other Movies** is ordered
by release year and title.
Select a card to show its translations and mastery, favorite it, open Practice,
or open it in Stremio. Hovering or selecting a card enlarges its artwork and
text together and turns the text white. A selected title keeps a single violet
outline. Reduced motion disables the zoom. **← Library** returns to the covers.
Search covers all published titles, and results load automatically near the page
bottom.

The favorites summary shows the combined unique-word count, mastery, and
**Browse words** for starred titles with published vocabulary. Stars beside
groups toggle that group's titles, including titles hidden by search or
pagination. Search and gallery navigation preserve favorites. Words shared
by titles appear once, with accumulated occurrences and references.
**Browse words** shows mastery, Japanese with readings, meaning, grammatical
category and frequency across the selection. In the **Meaning** column,
select **N more** beneath the first definition to reveal additional meanings.
The most frequent words appear first. Filter by category, search
by spelling, reading or English meaning, and select a column heading to sort.
Shared master meanings come from JMdict, JMnedict and supported corrections.
Words with missing meanings stay visible. Meanings are dictionary-level
definitions. See the [vocabulary guide](vocabulary.md) for browsing and practice.

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

## Monitoring and analytics

Configure these values in Vercel Production. The public browser settings are
read at build time and require a fresh Production deployment.

| Setting | Purpose |
| --- | --- |
| `VITE_SENTRY_DSN` | Sentry ingest DSN for the browser on `yomiru.tsilva.eu` |
| `SENTRY_DSN` | Sentry ingest DSN for unexpected failures handled by the public Vercel APIs |
| `VITE_GA_MEASUREMENT_ID` | Measurement ID for the dedicated Yomiru GA4 web stream |

Without the corresponding setting, collection stays disabled. Sentry sends
error types and stack frames with release metadata when available. It omits
error messages, request data, user data, and browsing history. Source map
upload, tracing, and session replay are disabled.

Configure the GA4 stream for the production homepage with enhanced measurement
disabled. Visitors can opt in or change their choice in **Analytics settings**.
Analytics loads after consent and measures the homepage without query
parameters. Advertising features are disabled. Feedback and compatibility pages
are outside the analytics scope.

[Lighthouse CI](../.github/workflows/lighthouse-ci.yml) runs on pushes to
`main` and on manual dispatch. It audits the public homepage through the
shared workflow and publishes the representative desktop scores in the
GitHub Actions summary.

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
