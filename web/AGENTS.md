# Prototype Instructions

Keep the public landing page minimal: Yomiru identity, one cinematic subtitle
preview, one headline, one sentence and one install action. Use Stremio's dark
palette and violet accent. The artwork fills the entire viewport behind the
logo and copy, with a portrait composition for narrow screens. Use a subtle
dark overlay so the headline and install action stand out. Preserve the
approved Cinema Frame direction. Keep the hero free of navigation, feature
sections, steps, selectors or decorative UI; the subtitle library belongs below it.

Use a raised violet install button with a centered label and no icon. Its face
depresses while pressed; keep the hit area stable and preserve keyboard focus
and reduced-motion support.
The main install button opens the installation guide; omit a separate help link.
Only the install button inside the modal opens the hosted manifest through
`stremio://`. Keep the manual URL in the guide. Preserve the
Yomiru icon in the manifest and the stable installation URL across updates.
The modal uses a numbered guide with an Install in Stremio button in the
installation step, ASS styling as step 2, Available on Yomiru catalogue discovery, Japanese
subtitle/default-language guidance and explicit Yomiru track selection. Use a
light circular × close control overlapping the upper-left corner outside the
dialog bounds, without an empty header row or automatic button highlight;
preserve visible keyboard focus. Omit the “Coverage is growing” phrase.

Keep artwork calm and welcoming, with characters clearly away from railway
tracks and unprotected edges. The current scene shows a reader seated on a
bench in the sheltered station courtyard. Keep both background compositions free
of baked-in captions. Render a larger pale-yellow Japanese reading above smaller
pale-blue English using responsive HTML/CSS. Play the paired examples as a fixed
scene sequence with natural cue durations and minimal gaps between pairs,
including when looping from the beginning. Start with “Koko wa ochitsuku ne.” / “It’s peaceful here,
isn’t it?” Allow pausing, pause the clock in hidden tabs and while the installation
modal is visible, and resume from the same position without overriding manual pause.
Show a static first
cue for reduced motion. This is staged scene dialogue, not verified audio sync.

Keep the header wordmark as “Yomiru” above smaller hiragana “よみる”, left-aligned
within a text block vertically centered beside the fox icon.

Place the searchable subtitle library below the hero with compact rows and controls,
no separate header/navigation, aggregate counts or footer notes. Use full-width
search and collapsible show groups, initially expanded. Each group has separate
Episode (S01E01), Title and Translations columns with Stremio links. On narrow
screens, reflow the rows without horizontal scrolling. Sort by
numeric season then episode; omit separate season groups. Searching automatically
reveals matching episodes even inside previously collapsed shows. Omit search
helper text.
Omit the timing column and reading-mode selector. Load more rows automatically
near the page bottom; search the whole published library. Show translations by
target language, separately from derived Japanese reading modes; display only
published availability. Retain timing uncertainty in source/subtitle details.
Omit catalogue media artwork unless Yomiru need neither
scrape nor host it. Preserve the landing artwork.
Add a secondary “Browse subtitles” link beneath the install button, scrolling to
the library and respecting reduced motion.

Episode vocabulary selection is the exception to the exclusion of aggregate
counts. Show the live unique-word count, word browser and CSV controls only
while episodes are selected. Use a book icon beside Browse words and a download
icon beside Download CSV. Use the checkboxes to deselect episodes and shows.
Keep dictionary and license attribution without a master-vocabulary explanation
in the toolbar. Inset the vocabulary dropdown chevrons.
Keep the selection bar's height steady while vocabulary counts update.
Match the installation guide's upper-left close control and use labelled
chevron buttons for vocabulary pagination. Show searchable words with their
readings, filterable grammatical categories in the first column, a short meaning and expandable
remaining meanings. Rank by occurrences across the selection by default.
Export the full selection in study order.
Keep selection across search, pagination and show collapse. Japanese vocabulary
and stable word IDs are shared across target languages; missing meanings remain
visible and never remove words. Keep the selection controls below the hero.
Put each show's select-all checkbox above its episode checkboxes. Give it an
accessible name and omit the visible label. It covers all
vocabulary-ready episodes, including those hidden by search or pagination.
Preserve individual selection and display a mixed checkbox state when only
some show episodes are selected.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
