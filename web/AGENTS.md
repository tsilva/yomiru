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
no separate header/navigation, coverage totals or footer notes. Use full-width
search and collapsible show groups, collapsed by default. Manually opening a group
collapses all other groups. Show one sticky Code, Title, Translations and Mastery header
below the vocabulary summary when at least one group is expanded. Style Play,
Exercise and Browse words with white icons, the same matte purple face, a visible
raised base and a thin top highlight. Keep the row actions compact with space above and
below them, and center them vertically across the episode row on mobile. Reuse
the Install button's pressed and focus states and retain episode-specific accessible names.
On narrow screens, reflow the rows without horizontal scrolling. Display episode
codes such as S01E01 and sort by season then episode. Display movie codes such
as M01 in each group's film order. Keep Rebuild of Evangelion, One Piece Movies
and Other Movies as separate collapsible groups with direct Stremio links.
Search group names, titles and codes and automatically reveal matching groups.
Omit search helper text.
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

Show the live unique-word count and mastery for starred titles together, with an icon-only
book button with an accessible name and tooltip. Omit the CSV download action
from the website. Use thick mastery bars and percentages for episodes, films and
groups. Keep the glossy violet fill clipped to the rounded track. Omit the
group scope label and keep group mastery visible when collapsed.
Indicate keyboard focus on the group toggle by underlining the group name.
Prompt viewers to star a title when they have no favorites.
Show the count of words without an English meaning after the starred title count.
Use English meanings for browsing and search across all subtitle
languages.
Keep dictionary and license links in documentation. Inset
the vocabulary dropdown chevrons.
Keep the selection bar's height steady while vocabulary counts update.
Match the installation guide's upper-left close control. Place the accessible
dumbbell Exercise button to the left of the Browse words book in the subtitle
library. Place an episode-specific Exercise button to the left of Play in each
row, including movies. While practice opens, center the animated Yomiru fox
revealing Japanese and English subtitles above the loading text and three staggered
dots. Place the fox and its soft glow directly on the screen background.
Show a still fox and dots for reduced motion.
Load more words as learners scroll and use the app's violet scrollbar styling.
On phones, use compact dialog margins and a smaller close button. Fit all five
columns without horizontal scrolling. Center the Japanese text and readings in
their column and vertically center cell contents. Show personal Mastery
in the first column, with a short, thick bar directly above the percentage or
“Not practiced” when no practice record exists. Show searchable words with their
readings. In the Meaning column, place the “N more” control below the short
meaning and show one additional gloss per bullet when expanded. Place the
filterable Category column immediately before Frequency. Give vocabulary data
column headers sort controls with a direction indicator for the active column.
Show selected-episode occurrences under
“Frequency” and sort by this column in descending order by default. Omit the
Rank column and frequency-type selector.
Keep favorites across reloads, search, pagination and show collapse. Japanese vocabulary
and stable word IDs are shared across subtitle translations. Keep words with
missing English meanings visible. Keep the selection controls below the hero.
Put an accessible star in each title row and group heading. Group stars
toggle every vocabulary-ready title in the group, including titles hidden by
search or pagination. Show a mixed state when only some titles are starred.
Keep the desktop star column close to the episode codes.

Title the practice screen “Practice”.
Keep the mobile app portrait-only. Show a phone rotation icon and a prompt in
landscape. Resume the open screen in portrait. Request fullscreen and portrait
lock on the mobile Exercise action where the browser permits them. Exit the
fullscreen session when leaving Practice.
Use raised, visibly depressible matching tiles. Let learners start in either
language. Play a soft, ascending three-note chime on correct matches. Fade
matched tiles out over 1.8 seconds after green feedback, holding their slots
until the fade completes. On a miss, keep the
selected tiles in place and fade their red color back to normal over 1.8 seconds.
Disable tiles showing feedback and keep other tiles playable during the fade.
Fade replacement pairs in over about 100 ms. Match the English text to the
rōmaji in font, size, and weight. Keep the language names
for assistive technology and omit visible language headings above the tiles.
Keep keyboard focus visible on tiles and omit the outline around the board.
Show number labels only on the row that accepts the next shortcut.
On phones, match the visible gaps horizontally and vertically, and fit up to
six rows without crowding the tap targets.
On phones, place Library, Practice and Combo on one row. Show mastery and the
mastered count near the full-width progress bar. Use a two-by-two answer grid on
narrow screens and a single row when a short screen has enough width. In the
quiz, keep answers at the bottom of the viewport and center the Japanese subtitle
and rōmaji in the space above them. Compact the controls and spacing before
reducing text size on short screens. Keep both scripts readable and answer
controls at least 44 CSS pixels tall.
Exclude particles from practice prompts, answer choices and mastery.
Show every quiz target in a mixed-kana subtitle line above the smaller rōmaji
line. Skip targets without an aligned contextual example.
Highlight the target in violet with an underline on both contextual lines. Omit the
helper question. Use dotted underlines for words with a meaning to peek at.
Hover or focus highlights the matching word in both lines. Click or tap either
spelling to show its meaning in a tooltip and reset the combo silently.
Let prompts and answer labels wrap without their own scroll areas. Let the whole
Practice screen scroll if the contents still exceed an extremely small viewport
or the learner enlarges the text.
On desktop, align Combo on the right with the Practice heading. Place mastery
and the mastered count below, close to the full-width bar. Use the subtitle
library's glossy violet progress style.
For timed episode practice, keep the mastery text and use that bar's space for
the single-row Episode scrubber. Place the current time before the track and the
duration after it. Give the scrubber a lavender handle and show a timestamp
preview above the destination before a pointer jump.
Use a short violet pop on matches and gold
with three small sparks at multiples of five. Place the animated logo fox
beside the combo number at a prominent size on phones and desktop. Keep its
signature eyes, paws and subtitle bars. Give it a subtle breathing loop between
the reactions in the vocabulary practice specification.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Keep the subtitle feedback page faithful to the approved mockup. Show read-only
episode and subtitle track details, five stars, an optional comment and one
submit button. Omit episode, subtitle and video selectors or aggregate results.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
