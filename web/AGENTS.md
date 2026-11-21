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
Match the mobile browser toolbar to the top color of the install button face.
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

Keep the searchable library in the approved blue fade below the hero, with
faint particles and the secondary “Browse subtitles” link. Use original box art
with the title lettered on the cover and scenes recognizable from the series or
film collection. Open groups in place with a matching gallery and a ← Library
control. Focus the opened group's heading without a visible outline, and inset
the season selector chevron. Use numbered widescreen placeholders for episodes
and portrait placeholders for films or groups without art. Use a film icon in
movie placeholders and show movies by title in the captions and action bar.
Letter the title on each movie poster. Follow the release poster's lettering
style, dominant colors and composition while using a newly drawn scene.
Use pink artwork outlines and card text for hover and keyboard focus. Slightly
enlarge the artwork and text together on hover with a quick transition. Keep a
single outline and skip the zoom when reduced motion is enabled.
Preserve the landing artwork.

Keep the selected episode or movie slightly enlarged with white text and a
white outline when it is neither hovered nor focused. The sticky title action
bar replaces the favorites vocabulary bar below search at the same height.
Activating the card again clears the selection and restores the favorites bar.
Crossfade the two bar states quickly. Use a thicker border and a single brief
highlight when a title is selected, including when switching titles. Skip the
fade and highlight for reduced motion.
Keep both bar states compact on desktop and phones, with primary controls at
least 44 CSS pixels tall on phones.
On phones, inset the sticky bar from the top and leave space above Library.
Keep the season selector at the right of the group title and let the title wrap.
Show the selected title, its translations and mastery, a favorite star, Practice and
Open in Stremio. Reuse the raised violet Practice control and retain
title-specific accessible names and keyboard focus. Give the bar a visible border
and shadow. Fit the card grid and bar without horizontal scrolling. Preserve
episode codes, season order and movie
group order. Search the full published library by group name, title, code and
translation. Load more automatically near the page bottom and display only
published availability. Retain timing uncertainty in subtitle details.

Show the live unique-word count and mastery for starred titles together, with an icon-only
book button with an accessible name and tooltip. Omit the CSV download action
from the website. Use a compact mastery bar and percentage in the selected
title's action bar. Overlay a slim mastery bar along the bottom of group covers,
episode artwork, and movie posters. Reveal the exact percentage above it on
hover or keyboard focus. On phones, show group mastery in opened group details
and title mastery in the selected episode or movie's action bar. Keep the glossy
violet fill clipped to the rounded track. Align the type labels and mastery bars
across each row when titles wrap.
Make keyboard focus visible on the cards.
Prompt viewers to star a title for vocabulary browsing when they have no
favorites. Hide Browse words and keep Review available.
Show the count of words without an English meaning after the starred title count.
Use English meanings for browsing and search across all subtitle
languages.
Keep dictionary and license links in documentation. Inset
the vocabulary dropdown chevrons.
Keep the selection bar's height steady while vocabulary counts update.
Match the installation guide's upper-left close control. Place the accessible
dumbbell Review button to the left of the Browse words book in the subtitle
library. While practice opens, center the animated Yomiru fox
revealing Japanese and English subtitles above the loading text and three staggered
dots. Place the fox and its soft glow directly on the screen background.
Show a still fox and dots for reduced motion.
Load more words as learners scroll and use the app's violet scrollbar styling.
Show a spinner with a screen-reader status while vocabulary results load.
Keep the Vocabulary header compact. Place search and category controls together,
with accessible names and no visible field labels or repeated selection count.
On phones, use compact dialog margins and a smaller close button. Fit all six
columns without horizontal scrolling. Center the Japanese text and readings in
their column and vertically center cell contents. Show personal Mastery
in the first column, with a progress ring around the whole percentage or an em
dash when there is no score. Put Next review beside Mastery and show compact
countdowns such as “in 9h45m”. Show searchable
words with their readings. In the Meaning column, place the “N more” control
below the short meaning and show one additional gloss per bullet when expanded. Place the
filterable Category column immediately before Frequency. Give every column header
a sort control with a direction indicator for the active column. Indicate keyboard
focus on the results pane through the header background without outlining the pane.
Show total occurrences across starred episodes and movies under
“Frequency” and sort by this column in descending order by default. Omit the
Rank column and frequency-type selector.
Keep favorites across reloads, search, pagination and gallery navigation. Japanese vocabulary
and stable word IDs are shared across subtitle translations. Keep words with
missing English meanings visible. Keep the selection controls below the hero.
Put accessible stars in opened group headers and in the selected title's
action bar. Group stars toggle every title with vocabulary, including titles
hidden by search or pagination. Show the mixed state.

Title the episode screen “Practice” and the global queue “Review”.
Give the Review toolbar top clearance while keeping the title aligned with
Library. Offer a raised Review again button on round completion.
Keep the mobile app portrait-only. Show a phone rotation icon and a prompt in
landscape. Resume the open screen in portrait. Request fullscreen and portrait
lock on the mobile Review action where the browser permits them. Exit the
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
Place Library, centered Practice and Combo in one compact row. Show the series
name, episode code and episode title or just the film title beside mastery and
the mastered count above the full-width progress bar. Stack the title and
mastery on phones and leave top clearance for the camera cutout in fullscreen.
Use a two-by-two answer grid on narrow screens and a single row when a short
screen has enough width. In the
quiz, keep answers at the bottom of the viewport and center the subtitle prompt
in the space above them. Show multiple answer choices on every question,
including delayed reviews. Use kana as the largest reading. Place the small gray
original Japanese line close above it, with rōmaji and English below. Give answer buttons a
shallow raised edge and a quick press and release. Compact the controls and
spacing before reducing text size on short screens. Keep all lines readable
and answer controls at least 44 CSS pixels tall.
Exclude particles from practice prompts, answer choices and mastery. Highlight
one eligible word occurrence at a time in the order it appears in the phrase.
Skip targets without an aligned contextual example. On a miss, mark only the
chosen tile red and retry the same word. A correct answer advances to the next
eligible word or, at the end of the phrase, to the next subtitle.
Highlight the target in violet with an underline in kana, rōmaji and aligned
original Japanese. Omit the
helper question. Use dotted underlines for words with a meaning to peek at.
Hover or focus highlights the matching word in both lines. Click or tap either
spelling to open a tooltip anchored to the matching rōmaji word and reset the
combo silently. Show the kanji spelling when available, kana, rōmaji, the English
gloss and the word's mastery.
Let prompts and answer labels wrap without their own scroll areas. Let the whole
Practice screen scroll if the contents still exceed an extremely small viewport
or the learner enlarges the text.
Use the subtitle library's glossy violet progress style.
For timed episode practice, keep the mastery text and use the bar's space for
a read-only Episode progress indicator. Place the current time before the track
and the duration after it.
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
