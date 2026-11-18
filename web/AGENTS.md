# Prototype Instructions

Keep the public landing page minimal: Yomiru identity, one cinematic subtitle
preview, one headline, one sentence and one install action. Use Stremio's dark
palette and violet accent. The artwork fills the entire viewport behind the
logo and copy, with a portrait composition for narrow screens. Use a subtle
dark overlay so the headline and install action stand out. Preserve the
approved Cinema Frame direction. Place a circular, icon-only GitHub repository
link opposite the wordmark, with an accessible name and visible keyboard focus.
Keep the hero free of other navigation, feature sections, steps, selectors or
decorative UI; the subtitle library belongs below it.

Use a raised violet install button with a centered label and no icon. Its face
depresses while pressed; keep the hit area stable and preserve keyboard focus
and reduced-motion support.
The main install button opens the installation guide; omit a separate help link.
Only the install button inside the modal opens the hosted manifest through
`stremio://`. Keep the manual URL in the guide. Preserve the
Yomiru icon in the manifest and the stable installation URL across updates.
The modal uses a numbered guide with an Install in Stremio button in the
installation step, ASS styling as step 2, regular Stremio catalogue playback,
guidance to choose a supported translation language, and explicit Yomiru track
selection. Use a light circular × close control overlapping the upper-left corner
outside the dialog bounds, without an empty header row or automatic button highlight;
preserve visible keyboard focus. Omit the “Coverage is growing” phrase.

Keep artwork calm and welcoming, with characters clearly away from railway
tracks and unprotected edges. The current scene shows a reader seated on a
bench in the sheltered station courtyard. Keep both background compositions free
of baked-in captions. Render a larger pale-yellow Japanese reading above smaller
pale-blue English using responsive HTML/CSS. Play the paired examples as a fixed
scene sequence with natural cue durations and minimal gaps between pairs,
including when looping from the beginning. Start with “Koko wa ochitsuku ne.” / “It’s peaceful here,
isn’t it?” Show the pause control on desktop and hide it in the mobile layout.
Pause the clock in hidden tabs and while the installation modal is visible.
Resume from the same position, preserving a manual pause.
Show a static first
cue for reduced motion. This is staged scene dialogue, not verified audio sync.

Keep the header wordmark as “Yomiru” above smaller hiragana “よみる”, left-aligned
within a text block vertically centered beside the fox icon.

Place the searchable subtitle library below the hero with compact rows and controls,
no separate header/navigation, aggregate counts or footer notes. Use full-width
search and collapsible show groups, initially expanded. Each group has separate
Episode (S01E01), Title and Translations columns with Stremio links shown as
compact, glossy, raised violet buttons with white play icons and space above and
below them. Center each button vertically across the full episode row on mobile.
Reuse the Install button's pressed and focus states and retain episode-specific
accessible names.
On narrow screens, reflow the rows without horizontal scrolling. Sort by
numeric season then episode; omit separate season groups. Searching automatically
reveals matching episodes even inside previously collapsed shows. Omit search
helper text.
Use the approved cool blue fade from the hero into the library. Keep a few faint
blue particles above the search field and leave them static for reduced motion.
Omit the timing column and reading-mode selector. Load more rows automatically
near the page bottom; search the whole published library. Show translations by
target language, separately from derived Japanese reading modes; display only
published availability. Retain timing uncertainty in source/subtitle details.
Omit catalogue media artwork unless Yomiru need neither
scrape nor host it. Preserve the landing artwork.
Add a secondary “Browse subtitles” link beneath the install button, scrolling to
the library and respecting reduced motion.

Episode vocabulary selection is the exception to the exclusion of aggregate
counts. Always show the live unique-word count, word browser and CSV controls.
When no episodes are checked, use all vocabulary-ready episodes in the library.
Use icon-only book and download buttons with accessible names and tooltips.
Show the count of words without an English meaning after the episode scope.
Use English meanings for browsing, search and CSV exports across all subtitle
languages.
Use the checkboxes to deselect episodes and shows.
Keep dictionary and license links in export metadata and documentation. Inset
the vocabulary dropdown chevrons.
Keep the selection bar's height steady while vocabulary counts update.
Match the installation guide's upper-left close control. Place the accessible
CSV download icon in the word browser's upper-right corner. Load more words as
learners scroll and use the app's violet scrollbar styling. Show searchable words
with their readings, filterable grammatical categories in the first column, a
short meaning and expandable remaining meanings labeled “N more”, with one
gloss per bullet. Give visible column headers sort controls with a direction
indicator for the active column. Show selected-episode occurrences under
“Frequency” and sort by this column in descending order by default. Omit the
Rank column and frequency-type selector.
Export the full selection in study order.
Keep selection across search, pagination and show collapse. Japanese vocabulary
and stable word IDs are shared across subtitle translations. Keep words with
missing English meanings visible. Keep the selection controls below the hero.
Put each show's select-all checkbox above its episode checkboxes. Give it an
accessible name and omit the visible label. It covers all
vocabulary-ready episodes, including those hidden by search or pagination.
Keep the desktop checkbox column close to the episode codes.
Preserve individual selection and display a mixed checkbox state when only
some show episodes are selected.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Keep the subtitle feedback page faithful to the approved mockup. Show read-only
episode and subtitle track details, five stars, an optional comment and one
submit button. Omit episode, subtitle and video selectors or aggregate results.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
