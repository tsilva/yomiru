---
name: yomiru_manage-episodes
description: Add or maintain Yomiru episodes. Prepare Kana and English subtitles and artwork, review every eligible Practice occurrence, and verify Practice and Verb Trainer on authorized releases.
---

# Manage episodes

Work in the canonical Yomiru checkout. Follow [AGENTS.md](../../../AGENTS.md)
for release scope and [SPECS.md](../../../SPECS.md) for the episode contract.
Use [yomiru_audit-subtitles](../yomiru_audit-subtitles/SKILL.md) for language
and Practice review, [yomiru_build-release](../yomiru_build-release/SKILL.md)
for authorized publication, and `$imagegen` when artwork is needed.

1. **Identify the episode.** Verify the Cinemeta series ID, season and episode,
   Japanese source edition and cue anchors. Record any uncertainty about
   synchronization with the video. For maintenance, pin the active track,
   paired translation, vocabulary, review and artwork. Make changes within
   the requested scope and reuse the verified inputs. Apply the same Practice
   acceptance checks to new and maintained episodes.
2. **Prepare the track and artwork.** For a new episode, generate English
   with [the administrative translation command](../../../docs/translation-trial.md#administrative-generation)
   and stage one Kana + English ASS track with `--script kana`, unless the
   owner selects another reading mode or language. Keep the annotated
   Japanese, exact cue timing, paired translation and source archive together
   in private storage. For new or replacement artwork, use ImageGen to make
   an original widescreen illustration based on the verified episode.
   Match the existing gallery crop and check the result at card size. Save
   the selected asset as a 640 × 360 WebP at
   `web/src/library-art/episodes/<imdb>-<season>-<episode>.webp`.
3. **Review every eligible question.** Use the
   [episode review procedure](../../../docs/subtitle-quality.md#episode-release-review)
   to build the packet and audit all cues, including repeats and exclusions.
   Verify the exact highlight and readings, contextual answer and alternatives,
   hover gloss spans, and vocabulary ID for mastery. Recompile and review
   supported fixes until there are no unresolved eligible occurrences. Run
   `release-episode.mjs --dry-run --review` with the exact staged inputs and
   replay the full exercise in subtitle order. Check expected Verb Trainer
   coverage from the staged verb occurrences and supported, unambiguous
   JMdict matches. Use the shared prepared forms and the
   [vocabulary preparation guide](../../../docs/vocabulary.md#administrator-preparation)
   if their data needs refreshing.
4. **Publish through the existing routes.** Use the release skill and
   [incremental episode workflow](../../../docs/publishing.md#incremental-episode-upload)
   for authorized publication. If artwork changes, release and verify the
   app asset before activating the episode's library revision. Use the
   library route alone for subtitle or Practice data changes. Confirm that
   the approved stored cues render the staged ASS.
5. **Verify the live episode.** Check the catalogue card and artwork, Stremio
   discovery and the downloadable track. Replay every question from the
   live service against the accepted packet. Verify cue and within-cue order,
   exact highlights and choices, and mastery credit to the intended IDs for
   correct, incorrect and due-review outcomes. Check all expected hover
   gloss spans and spot-check in Brave that a compound's gloss appears
   during another question and hides when it would reveal the answer. Verify
   live Verb Trainer coverage against the staged expectations. Verify four
   prepared choices with the correct Japanese, kana and rōmaji, and check
   frequency and due-review scheduling. Confirm each conjugation credits its
   own verb ID and form, meaning questions credit the vocabulary ID, and
   attempted forms enter Review. Record the released revision, Practice
   question count, Verb Trainer coverage and any remaining blocker.
