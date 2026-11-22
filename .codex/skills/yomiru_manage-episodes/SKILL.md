---
name: yomiru_manage-episodes
description: Add or maintain Yomiru episodes and movies. Prepare Kana + English and Rōmaji + English subtitles and artwork, review every eligible Practice occurrence, and verify both tracks, Practice and Verb Trainer on authorized releases.
---

# Manage episodes

Work in the canonical Yomiru checkout. Follow [AGENTS.md](../../../AGENTS.md)
for release scope and [SPECS.md](../../../SPECS.md) for the episode contract.
Use [yomiru_audit-subtitles](../yomiru_audit-subtitles/SKILL.md) for language
and Practice review, [yomiru_build-release](../yomiru_build-release/SKILL.md)
for authorized publication, and `$imagegen` when artwork is needed.

1. **Identify the title.** Verify the Cinemeta movie ID or series ID, season and
   episode, Japanese source edition and cue anchors. Record any uncertainty about
   synchronization with the video. For maintenance, pin the active track,
   paired translation, vocabulary, review and artwork. Make changes within
   the requested scope and reuse the verified inputs. Apply the same Practice
   acceptance checks to new and maintained episodes.
2. **Prepare the tracks and artwork.** After confirming the title, start
   artwork and subtitle translation in parallel. Generate English for both tracks
   with [the administrative translation command](../../../docs/translation-trial.md#administrative-generation)
   and stage Kana + English and Rōmaji + English ASS tracks together before
   review. Run `yomiru publish` with `--script kana` and `--script romaji` in the
   same library directory using the same paired translation and Japanese
   source inputs. Honor explicit language or reading-mode overrides. Keep the
   annotated Japanese, exact cue timing, paired translation and source archive together
   in private storage. For new or replacement artwork, use ImageGen to make
   an original widescreen illustration based on the verified episode.
   Match the existing gallery crop and check the result at card size. Save the
   selected asset as a 640 × 360 WebP under 1 MiB with the private episode inputs
   and pass it to the release command with `--artwork`. Reuse the work directory
   with `--resume` if translation is interrupted.
3. **Review every eligible question.** Use the
   [episode review procedure](../../../docs/subtitle-quality.md#episode-release-review)
   to build the packet and audit all cues, including repeats and exclusions.
   Verify the exact highlight and readings, contextual answer and alternatives,
   hover gloss spans, and vocabulary ID for mastery. Use the compact review
   packet and compare against its full baseline after edits to see changed cues,
   neighbors and repeats. Recompile and review supported fixes until there are
   no unresolved eligible occurrences. Run
   `release-episode.mjs --dry-run --review` with the exact staged inputs and
   replay the full exercise in subtitle order. Check expected Verb Trainer
   coverage from the staged verb occurrences and supported, unambiguous
   JMdict matches. Use the shared prepared forms and the
   [vocabulary preparation guide](../../../docs/vocabulary.md#administrator-preparation)
   if their data needs refreshing.
4. **Publish through the existing routes.** Use the release skill and
   [incremental episode workflow](../../../docs/publishing.md#incremental-episode-upload)
   for authorized publication. Use the same private `--resume-dir` during review,
   preflight and release. The library route uploads artwork with the episode,
   checks the exact review against the production dictionary, and verifies that
   approved stored cues render the staged ASS before activation. If activation
   succeeded and verification was interrupted, use `--verify-only` to resume.
5. **Verify the live title.** Check the catalogue card and artwork. Confirm
   Stremio discovery returns both expected 🦊-prefixed reading-mode labels and
   download each ASS track. Replay every question from the
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
