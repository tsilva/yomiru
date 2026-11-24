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
selection. Use the shared dark violet circular × close control at the upper-left
corner, without an empty header row or automatic button highlight. Keep keyboard
focus visible with a fill, underline or other borderless cue throughout the site.
Omit the “Coverage is growing” phrase.

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

Keep Library in the approved blue fade below the hero, with faint particles.
Use a down-chevron “Browse subtitles” link at the foot of the hero. On phones,
center the link with the chevron below the label. Use original box art
with the title lettered on the cover and scenes recognizable from the series or
film collection. Open groups in place with a matching gallery and a back icon
on the Library heading. Focus the opened group's heading without a visible outline.
Use season headings in a continuous episode gallery that loads more as viewers scroll.
Align the season picker beside the series title, with translation languages below.
Use numbered widescreen placeholders for episodes
and portrait placeholders for films or groups without art. Use a film icon in
movie placeholders and show movies by title in the captions and action bar.
Letter the title on each movie poster. Follow the release poster's lettering
style, dominant colors and composition while using a newly drawn scene.
Use violet card text from the button palette for hover and keyboard focus.
Underline the focused card title. Slightly enlarge the artwork and text together
on hover with a quick transition and skip the zoom when reduced motion is enabled.
Preserve the landing artwork.

Keep the selected episode or movie slightly enlarged with white text and a
white outline when it is neither hovered nor focused. Keep the personal
vocabulary bar in the main Library view. Show a sticky title action bar with a
steady border inside a group when a title is selected. Activating the card again
clears the selection and closes the action bar.
Keep both bar states compact on desktop and phones, with primary controls at
least 44 CSS pixels tall on phones.
On phones, inset the sticky bar from the top and leave space above Library.
Let the group title wrap and show the translation languages below it.
Show the selected title beside Practice and Open in Stremio, and include vocabulary
progress where available. Use matching raised violet dumbbell and play controls.
Open Vocabulary, Verbs and Word Drill from the compact Practice modal, with one labeled icon
control per row and no visible heading. Retain title-specific accessible names, visible keyboard focus,
and tooltips on hover and focus for icon-only controls. Give the bar a visible
border and shadow. Fit the card grid and bar without horizontal scrolling.
Preserve episode codes, season order and movie group order. Put search with a right-hand icon between
the vocabulary bar and the group covers, and hide it inside a group. Search the
full published library by group name, title, code and translation. Center the
outlined Yomiru mascot and spinner vertically beneath search while an empty
gallery loads. Expose a screen-reader status and honor reduced motion.
Center the empty message horizontally.
Load more automatically near the page bottom and
display only published availability. Retain timing uncertainty in subtitle details.

Use a shared vocabulary progress bar in the library summary,
selected title actions, Practice, Review, and Verb Trainer. Use thicker, glossy
tracks in the library. Use gold for
mastered words, violet for the remaining introduced words, and charcoal for
unseen words in one rounded track. Place one label below the bar with the
introduced percentage first and the mastered percentage second where labels
are visible. Keep summary counts and percentages available to screen readers. Give the selected title a wider
bar and reveal its percentages on hover or keyboard focus, with the visible label
serving as the focus cue.
Overlay a smaller bar along the bottom of group covers, episode artwork, and
movie posters with both percentages available to screen readers.
Align the type labels and progress bars across each row when titles wrap.
Give the icon-only book button an accessible name and tooltip. Omit the CSV
download action from the website.
Make keyboard focus visible on the cards.
Prompt viewers to start episode Practice when their vocabulary history is
empty. Keep Browse words and Review available.
Use English meanings for browsing and search across all subtitle
languages.
Keep dictionary and license links in documentation. Inset
the vocabulary dropdown chevrons.
Keep the selection bar's height steady while vocabulary counts update.
Center the shared close control on the upper-left corner of each dialog.
Inset it horizontally in the near-full-width mobile vocabulary list.
Place the accessible
dumbbell Review button to the left of the Browse words book in the subtitle
library. While practice opens, center the animated Yomiru fox
revealing Japanese and English subtitles above the loading text and three staggered
dots. Place the fox and its soft glow directly on the screen background.
Show a still fox and dots for reduced motion.
Load more words as learners scroll and use the app's violet scrollbar styling.
Show a spinner with a screen-reader status while vocabulary results load.
Keep the Vocabulary header compact. Leave search unfocused when opening the
dialog. Place search and category controls together,
with accessible names and no visible field labels or repeated selection count.
Show the Vocabulary heading and All words and Starred filters. On desktop, give
Meaning the most space. On phones, use compact dialog margins and a smaller
close button. Show the star, Mastery, Due in, Japanese, and Meaning without
horizontal scrolling. Hide the additional meanings control.
Center the Japanese text and readings in
their column and vertically center cell contents. Show personal Mastery
after the star in the first column, with a progress ring around the whole percentage or an em
dash when there is no score. Put Due in beside Mastery and show compact
countdowns such as “9h45m”. Show searchable
words with their readings. In the Meaning column, place the “N more” control
below the short meaning and show one additional gloss per bullet when expanded. Place the
filterable Category column before Subcategory and Frequency. Show known verb types
under Subcategory. Give every column header a sort control with arrows next to
the label at every width. Indicate keyboard
focus on the results pane through the header background without outlining the pane.
Show total occurrences in published subtitles under
“Frequency” and sort by this column in descending order by default. Omit the
Rank column and frequency-type selector.
Keep the Practice history across reloads, search, pagination and gallery
navigation. Japanese vocabulary and stable word IDs are shared across subtitle
translations. Keep the vocabulary controls below the hero.

Use “Practice”, “Review” and “Word Drill” when the exercise has no source title. Give the
toolbars top clearance. Offer a raised Review again button on round completion.
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
Use the full available width for the exercise toolbar. Place Library on the left,
the source or mode title in the center, and the compact round count and Combo
where applicable on the right. Stack the episode code and title below the series
name. Give the timestamp its own line on narrow screens, and keep the mobile
toolbar compact when browser controls are visible. Place the thick vocabulary
bar across the full width below the row,
with percentages available to assistive technology. Leave clearance for the camera
cutout in fullscreen. Center the disappointed fox and message on unsupported Practice links.
Use a two-by-two answer grid on narrow screens and a single row when a short
screen has enough width. In the
quiz, keep answers at the bottom of the viewport and center the subtitle prompt
in the space above them in every quiz mode. Highlights, feedback and tooltips
should leave the prompt in place. Show multiple answer choices on every question,
including delayed reviews. Show four choices in episode Practice, prefer related
distractors, and randomize the direction on each new question. Use kana as the
largest reading. Place the small gray
original Japanese line close above it, with rōmaji and English below. Give answer buttons a
shallow raised edge and a quick press and release. Compact the controls and
spacing before reducing text size on short screens. Keep all lines readable
and answer controls at least 44 CSS pixels tall.
Use the same desktop number badge as the quiz answers on the New word button.
Label it `1` and omit the arrow icon.
Quiz reviewed particles with four contextual English choices and count their
mastery. Highlight one eligible word occurrence at a time in the order it
appears in the phrase.
Skip targets without an aligned contextual example. On a miss, mark only the
chosen tile red and retry the same word. A correct answer advances to the next
eligible word or, at the end of the phrase, to the next subtitle.
Highlight the target in violet with an underline in the question language.
Apply Japanese highlights to kana, rōmaji and aligned original Japanese. Keep
the full subtitles visible in episode Practice and use the Verb Trainer card
format for Japanese choices, using four distinct forms from the current subtitle.
Use Japanese-to-English when the subtitle lacks enough plausible Japanese
distractors. Omit the helper question. In Japanese-to-English
questions, use dotted underlines for words that support peeking. In
English-to-Japanese questions, render the Japanese lines as plain text.
Hover or focus highlights the matching word in both lines. Click or tap either
spelling to open a tooltip anchored to the matching rōmaji word and reset the
combo silently. Use a compact three-row tooltip. Separate kanji spelling, kana
and rōmaji with middle dots. Put the English gloss on the second row and the
part of speech on the bottom left, with the conjugation class inline for
verbs when known. Align mastery to the right and show it for practised particles.
Let prompts and answer labels wrap without their own scroll areas. Let the whole
Practice screen scroll if the contents still exceed an extremely small viewport
or the learner enlarges the text.
Place the Episode scrubber below vocabulary progress when timing is available.
Show the current time before the scrubber with space before the drag handle and
show the duration after it. Omit the visible Episode label. In Review,
show the source title and timestamp beside the round position for subtitle
meaning questions.
Use a short violet pop on matches and gold
with three small sparks at multiples of five. Place the animated logo fox
beside the combo number at a prominent size on phones and desktop. Keep its
signature eyes, paws and subtitle bars. Give it a subtle breathing loop between
the reactions in the vocabulary practice specification.

Make the toolbar fox the Ask control in episode and movie Practice. Dock the
chat beside the quiz on desktop and use a bottom sheet on phones. Start with a
greeting from Yomiru without a chat toolbar. Put the subtitle attachment above
the composer until it is sent with the learner's first message. Use the fox
avatar on the left and the mildly mischievous anime student on the right as the
visible speaker cues. Bold Japanese and quoted expressions in Yomiru's replies
and omit Japanese corner brackets.
In Word Drill chat, show one compact learner-side bubble per completed question.
Put the prompt above all choices, with a check beside the correct answer and a
cross beside each missed choice the learner selected.

Show the smaller form label below the English gloss and open the conjugation
guide in a tooltip. Show the current verb type first with its rule row
highlighted. Fill the question-mark icon's background on keyboard focus.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
