import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { episodeSearchText, filterLibraryRows, libraryRows, sequenceMovies, subtitleCoverage } from "./browse.mjs";
import { validateArtworkAsset } from "./episode-artwork.mjs";
import { validateAsset } from "./library.mjs";
import { videoGroups } from "./compatibility.mjs";
import { codePattern, feedbackCode, playbackVersion, renderedId } from "./feedback-links.mjs";
import { matchJmdict, seedJmdictRows, useJmdictMatch } from "./jmdict.mjs";
import { decodePublication } from "./published-library.mjs";
import { loadPublicationRows, mapBatches } from "./r2-publication.mjs";
import { verifySourceArchive } from "./source-archive.mjs";

const hash = /^[a-f0-9]{64}$/;
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const videoIdentifier = /^[A-Za-z0-9_.:-]{1,200}$/;

function playbackTrackIds(trackIds, previous) {
  if (!hash.test(previous) || !Array.isArray(trackIds) || !trackIds.length || trackIds.length > 8
    || new Set(trackIds).size !== trackIds.length || trackIds.some(id => typeof id !== "string" || !hash.test(id))) {
    throw new Error("Supply up to eight exact track IDs and the current catalogue revision");
  }
  return [...trackIds].sort();
}

async function requireReadyPlayback(tx) {
  const [{ pending }] = await tx`SELECT EXISTS (SELECT 1 FROM yomiru_incremental_track
    WHERE detail -> 'superseded' IS DISTINCT FROM 'true'::jsonb
    AND detail -> 'playbackReady' IS DISTINCT FROM 'true'::jsonb) AS pending`;
  if (pending) throw new Error("Finish migrating all active playback tracks first");
}

export async function prepareIncrementalBaseline(bytes, revision, readAsset) {
  const { index, catalogue } = decodePublication(bytes, revision);
  await mapBatches(index.artwork ?? [], async item => {
    validateArtworkAsset(item, await readAsset(item.path, item.bytes));
  });
  const { lexemes, episodes, registry } = await loadPublicationRows(index, readAsset);
  const dictionary = new Map(lexemes.map(word => [word.id, word]));
  const descriptions = new Map(registry?.dictionaries.map(source => [source.sha256, source]));
  for (const entry of registry?.entries || []) {
    if (dictionary.has(entry.id)) continue;
    const sources = new Set(Object.values(entry.sources).flat());
    dictionary.set(entry.id, { ...entry, dictionaries: [...sources].map(id => descriptions.get(id)) });
  }
  const descriptors = new Map((index.vocabulary || []).flatMap(entry => entry.videoIds.map(id => [id, entry])));
  const vocabulary = episodes.map(({ episode, header, words }) => ({
    id: episode, descriptor: descriptors.get(episode), header,
    words: words.map(({ detail }) => {
      if (registry) return detail;
      const { id, count, forms, formReadings, examples, ...lexeme } = detail;
      const canonical = { id, ...lexeme };
      const previous = dictionary.get(id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(canonical)) {
        throw new Error("Legacy titles disagree on a shared dictionary entry");
      }
      dictionary.set(id, canonical);
      return { id, count, forms, ...(formReadings && { formReadings }), examples };
    }),
  }));
  return {
    revision, tracks: index.tracks,
    catalogue: libraryRows(index, catalogue), vocabulary, dictionary: [...dictionary.values()],
    metadata: [
      ...Object.entries(catalogue.shows).map(([id, detail]) => ({ type: "series", id, detail })),
      ...Object.entries(catalogue.movies || {}).map(([id, detail]) => ({ type: "movie", id, detail })),
    ],
  };
}

export async function prepareIncrementalEpisode(bytes, revision, manifest, { readAsset, readArchive, exactVocabulary = false }) {
  const candidate = await prepareIncrementalBaseline(bytes, revision, readAsset);
  const first = candidate.tracks[0];
  if (!first || !hash.test(first.anchor) || candidate.catalogue.length !== 1
    || candidate.metadata.length !== 1 || candidate.tracks.some(track => track.superseded
      || track.anchor !== first.anchor || track.cues !== first.cues || track.type !== first.type
      || !isDeepStrictEqual(track.videoIds, first.videoIds))) {
    throw new Error("An incremental upload must contain one complete Japanese source");
  }
  const ids = new Set(candidate.vocabulary.map(row => row.id));
  if (ids.size !== first.videoIds.length || first.videoIds.some(id => !ids.has(id))
    || candidate.vocabulary.some(entry => entry.descriptor.anchor !== first.anchor)) {
    throw new Error("Matching vocabulary is required for every uploaded video ID");
  }
  const { counts, ...source } = await verifySourceArchive(manifest, first.anchor, first.cues, readArchive);
  for (const { words } of candidate.vocabulary) {
    const stagedCounts = new Map(words.map(word => [word.id, word.count]));
    if ((exactVocabulary && counts.size !== stagedCounts.size)
      || [...counts].some(([id, count]) => stagedCounts.get(id) !== count)) {
      throw new Error("Uploaded vocabulary must cover the token analysis with matching counts");
    }
  }
  await mapBatches(candidate.tracks, async track => validateAsset(track, await readAsset(track.path)));
  const wordIds = new Set(candidate.vocabulary.flatMap(row => row.words.map(word => word.id)));
  return { ...candidate, source, dictionary: candidate.dictionary.filter(word => wordIds.has(word.id)) };
}

async function insertRows(tx, table, rows) {
  for (let start = 0; start < rows.length; start += 500) {
    await tx`INSERT INTO ${tx(table)} ${tx(rows.slice(start, start + 500))}`;
  }
}

async function insertBaseline(tx, baseline) {
  await insertRows(tx, "yomiru_incremental_dictionary", baseline.dictionary.map(word => ({
    id: word.id, detail: tx.json(word),
  })));
  await insertRows(tx, "yomiru_incremental_catalogue", baseline.catalogue.map(row => ({
    id: row.id, show_id: row.id.split(":")[0], search_text: episodeSearchText(row), detail: tx.json(row),
  })));
  await insertRows(tx, "yomiru_incremental_metadata", baseline.metadata.map(({ type, id, detail }) => ({
    type, id, detail: tx.json(detail),
  })));
  await insertRows(tx, "yomiru_incremental_track", baseline.tracks.map(track => ({
    id: track.id, detail: tx.json(track),
  })));
  await insertRows(tx, "yomiru_incremental_track_video", baseline.tracks.flatMap(track =>
    [...new Set(track.videoIds)].map(video_id => ({ type: track.type, video_id, track_id: track.id }))));
  await insertRows(tx, "yomiru_incremental_vocabulary", baseline.vocabulary.map(({ id, descriptor, header }) => ({
    video_id: id, anchor: descriptor.anchor, descriptor: tx.json(descriptor), header: tx.json(header),
  })));
  await insertRows(tx, "yomiru_incremental_occurrence", baseline.vocabulary.flatMap(({ id, words }) =>
    words.map(word => ({ video_id: id, word_id: word.id, detail: tx.json(word) }))));
  await tx`INSERT INTO yomiru_incremental_word_coverage (word_id, titles)
    SELECT word_id, count(*)::int FROM yomiru_incremental_occurrence GROUP BY word_id`;
}

async function clearUnusedBaseline(tx) {
  const [{ modified }] = await tx`SELECT EXISTS (SELECT 1 FROM yomiru_incremental_change)
    OR EXISTS (SELECT 1 FROM yomiru_incremental_dictionary WHERE jmdict_entry_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM yomiru_incremental_source_archive)
    OR EXISTS (SELECT 1 FROM yomiru_incremental_word_review) AS modified`;
  if (modified) throw new Error("The incremental catalogue has independent changes to preserve");
  for (const table of ["yomiru_incremental_word_coverage", "yomiru_incremental_occurrence",
    "yomiru_incremental_vocabulary", "yomiru_incremental_dictionary", "yomiru_incremental_track_video",
    "yomiru_incremental_track", "yomiru_incremental_metadata", "yomiru_incremental_catalogue",
    "yomiru_incremental_head"]) {
    await tx`DELETE FROM ${tx(table)}`;
  }
}

async function writeArchiveReceipt(tx, source) {
  const { anchor, manifest } = source;
  await tx`INSERT INTO yomiru_incremental_source_archive (anchor, manifest_sha256, manifest)
    VALUES (${anchor}, ${manifest.sha256}, ${tx.json(source)}) ON CONFLICT DO NOTHING`;
}

async function readWordCounts(tx, videoId) {
  const words = await tx`SELECT word_id, detail ->> 'count' AS count FROM yomiru_incremental_occurrence
    WHERE video_id = ${videoId}`;
  return new Map(words.map(word => [word.word_id, Number(word.count)]));
}

async function removeEpisodeVocabulary(tx, id) {
  await tx`DELETE FROM yomiru_incremental_word_coverage AS coverage USING yomiru_incremental_occurrence AS occurrence
    WHERE coverage.word_id = occurrence.word_id AND occurrence.video_id = ${id} AND coverage.titles = 1`;
  await tx`UPDATE yomiru_incremental_word_coverage AS coverage SET titles = coverage.titles - 1
    FROM yomiru_incremental_occurrence AS occurrence
    WHERE coverage.word_id = occurrence.word_id AND occurrence.video_id = ${id}`;
  await tx`DELETE FROM yomiru_incremental_occurrence WHERE video_id = ${id}`;
  await tx`DELETE FROM yomiru_incremental_vocabulary WHERE video_id = ${id}`;
}

async function writeEpisodeVocabulary(tx, episode, existing) {
  const known = await tx`SELECT id FROM yomiru_incremental_dictionary
    WHERE id = ANY(${tx.array(episode.dictionary.map(word => word.id), 25)})`;
  const knownIds = new Set(known.map(({ id }) => id));
  const newWords = episode.dictionary.filter(word => !knownIds.has(word.id));
  const matches = await matchJmdict(tx, newWords);
  const rows = newWords.map(word => {
    const match = matches.get(word.id);
    return { id: word.id, jmdict_entry_id: match?.sourceId ?? null,
      detail: tx.json(match ? useJmdictMatch(word, match) : word) };
  });
  await insertRows(tx, "yomiru_incremental_dictionary", rows);
  const { anchor, manifest } = episode.source;
  await writeArchiveReceipt(tx, episode.source);
  for (const entry of episode.vocabulary) {
    if (existing.has(entry.id)) {
      await tx`UPDATE yomiru_incremental_vocabulary SET manifest_sha256 = ${manifest.sha256}
        WHERE video_id = ${entry.id} AND manifest_sha256 IS NULL`;
      continue;
    }
    await tx`INSERT INTO yomiru_incremental_vocabulary (video_id, anchor, descriptor, header, manifest_sha256)
      VALUES (${entry.id}, ${anchor}, ${tx.json(entry.descriptor)}, ${tx.json(entry.header)}, ${manifest.sha256})`;
    await insertRows(tx, "yomiru_incremental_occurrence", entry.words.map(word => ({
      video_id: entry.id, word_id: word.id, detail: tx.json(word),
    })));
    await tx`INSERT INTO yomiru_incremental_word_coverage (word_id, titles)
      SELECT word_id, 1 FROM yomiru_incremental_occurrence WHERE video_id = ${entry.id}
      ON CONFLICT (word_id) DO UPDATE SET titles = yomiru_incremental_word_coverage.titles + 1`;
  }
  await tx`INSERT INTO yomiru_incremental_word_review (word_id)
    SELECT id FROM yomiru_incremental_dictionary
    WHERE id = ANY(${tx.array(episode.dictionary.map(word => word.id), 25)})
      AND COALESCE(jsonb_array_length(detail #> '{meanings,eng}'), 0) = 0
      AND detail #>> '{meaningStatus,eng}' IS DISTINCT FROM 'curated'
    ON CONFLICT (word_id) DO NOTHING`;
}

async function writeEpisodeTracks(tx, episode) {
  const activeIds = new Set(episode.tracks.map(track => track.id));
  for (const track of episode.tracks) {
    const [saved] = await tx`SELECT detail FROM yomiru_incremental_track WHERE id = ${track.id}`;
    if (saved) {
      const { superseded, ...original } = saved.detail;
      const { superseded: incomingState, ...incoming } = track;
      if (incomingState || !isDeepStrictEqual(original, incoming)) {
        throw new Error("Existing track ID has changed identity");
      }
      if (superseded) await tx`UPDATE yomiru_incremental_track SET detail = ${tx.json(track)} WHERE id = ${track.id}`;
    } else {
      await tx`INSERT INTO yomiru_incremental_track (id, detail) VALUES (${track.id}, ${tx.json(track)})`;
      await insertRows(tx, "yomiru_incremental_track_video", track.videoIds.map(video_id => ({
        type: track.type, video_id, track_id: track.id,
      })));
    }
    const previous = await tx`SELECT DISTINCT prior.id, prior.detail FROM yomiru_incremental_track_video AS binding
      JOIN yomiru_incremental_track AS prior ON prior.id = binding.track_id
      WHERE binding.type = ${track.type} AND binding.video_id = ANY(${tx.array(track.videoIds, 25)})
        AND prior.detail ->> 'lang' = ${track.lang} AND prior.detail ->> 'script' = ${track.script}
        AND prior.detail -> 'source' = ${tx.json(track.source)}`;
    for (const { id, detail } of previous) {
      if (!activeIds.has(id) && !detail.superseded) {
        if (detail.videoIds.some(video => !track.videoIds.includes(video))) {
          throw new Error("Revised subtitle omits an existing video ID alias");
        }
        await tx`UPDATE yomiru_incremental_track SET detail = ${tx.json({ ...detail, superseded: true })} WHERE id = ${id}`;
      }
    }
  }
}

async function requireEpisodeReviews(tx, episode, current, reviewId) {
  const bilingual = episode.tracks.filter(track => ["eng", "por"].includes(track.lang));
  const conflicts = [];
  if (!bilingual.length) return conflicts;
  const [{ available }] = await tx`
    SELECT to_regclass('yomiru_subtitle_corpus.release_review') IS NOT NULL AS available`;
  if (!available) throw new Error("Install the episode review schema before publishing bilingual tracks");
  for (const track of bilingual) {
    if (!hash.test(track.generation)) throw new Error("Bilingual track has no paired translation generation");
    for (const video of track.videoIds) {
      const vocabulary = current.find(row => row.video_id === video)?.descriptor
        ?? episode.vocabulary.find(row => row.id === video).descriptor;
      const [approved] = await tx`
        SELECT COALESCE((SELECT jsonb_agg(problem ORDER BY cue, position) FROM (
          SELECT cue.line ->> 0 AS cue, prompt.target ->> 0 AS "wordId", prompt.position,
            CASE WHEN card.word_id IS NULL THEN 'missing-practice-card' ELSE 'distractor-is-dictionary-meaning' END AS reason
          FROM jsonb_array_elements(review.practice -> 'cues') AS cue(line)
          CROSS JOIN LATERAL jsonb_array_elements(cue.line -> 5) WITH ORDINALITY AS prompt(target, position)
          LEFT JOIN yomiru_incremental_occurrence AS word
            ON word.video_id = ${video} AND word.word_id = prompt.target ->> 0
          LEFT JOIN yomiru_public_practice_card AS card ON card.word_id = word.word_id
          WHERE (card.word_id IS NULL AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(review.practice -> 'supplementalCards') AS extra(packed)
            WHERE extra.packed ->> 0 = prompt.target ->> 0
          )) OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(prompt.target -> 5) WITH ORDINALITY AS option(label, position)
            WHERE option.position > 1 AND yomiru_practice_key(option.label) = ANY(card.meaning_keys)
          ) ORDER BY cue, position LIMIT 50
        ) AS problem), '[]'::jsonb) AS conflicts
          FROM yomiru_subtitle_corpus.release_review AS review
          JOIN yomiru_subtitle_corpus.translation AS translation ON translation.id = review.translation_id
          JOIN yomiru_subtitle_corpus.track AS asset ON asset.translation_id = review.translation_id
          WHERE review.video_id = ${video} AND review.vocabulary_revision = ${vocabulary.sha256}
            AND (${reviewId ?? null}::text IS NULL OR review.review_id = ${reviewId ?? null})
            AND translation.source_revision = ${episode.source.manifest.sha256}
            AND translation.language = ${track.lang} AND translation.generation = ${track.generation}
            AND asset.id = ${track.id} AND asset.descriptor = ${tx.json(track)}
            AND (translation.language <> 'eng' OR review.practice IS NOT NULL)
          LIMIT 1`;
      if (!approved) conflicts.push({ videoId: video, reason: "missing-matching-review" });
      else for (const item of approved.conflicts) conflicts.push({ videoId: video, ...item });
    }
  }
  return conflicts;
}

async function writeEpisodeCatalogue(tx, episode, existing) {
  for (const { type, id, detail } of episode.metadata) {
    await tx`INSERT INTO yomiru_incremental_metadata (type, id, detail) VALUES (${type}, ${id}, ${tx.json(detail)})
      ON CONFLICT (type, id) DO UPDATE SET detail = excluded.detail`;
  }
  for (const row of episode.catalogue) {
    const [old] = await tx`SELECT detail FROM yomiru_incremental_catalogue WHERE id = ${row.id}`;
    const translations = [...new Map([...(old?.detail.translations || []), ...row.translations]
      .map(item => [item.code, item])).values()].sort((a, b) => a.label.localeCompare(b.label));
    const readingModes = [...new Map([...(old?.detail.readingModes || []), ...(row.readingModes || [])]
      .map(item => [item.code, item])).values()];
    const artwork = row.artwork ?? old?.detail.artwork;
    const detail = { ...row, translations, ...(readingModes.length && { readingModes }), ...(artwork && { artwork }) };
    if (existing.has(row.id)) detail.vocabulary = existing.get(row.id).publicVocabulary;
    await tx`INSERT INTO yomiru_incremental_catalogue (id, show_id, search_text, detail)
      VALUES (${detail.id}, ${detail.id.split(":")[0]}, ${episodeSearchText(detail)}, ${tx.json(detail)})
      ON CONFLICT (id) DO UPDATE SET show_id = excluded.show_id, search_text = excluded.search_text,
        detail = excluded.detail`;
  }
}

async function readHead(tx, expected) {
  const [head] = await tx`SELECT baseline, revision FROM yomiru_incremental_head WHERE singleton`;
  if (!head || (expected && expected !== head.revision)) throw new Error("Incremental publication changed");
  return head;
}

async function verifyBaselineParity(tx, revision) {
  const [parity] = await tx`WITH legacy_tracks AS (
    SELECT media_type AS type, video_id, detail FROM yomiru_episode_track WHERE revision = ${revision}
  ), current_tracks AS (
    SELECT binding.type, binding.video_id, track.detail FROM yomiru_incremental_track_video AS binding
    JOIN yomiru_incremental_track AS track ON track.id = binding.track_id
  ), legacy_vocabulary AS (
    SELECT episode AS id, header FROM yomiru_episode_vocabulary WHERE revision = ${revision}
  ), current_vocabulary AS (
    SELECT video_id AS id, header FROM yomiru_incremental_vocabulary
  ), legacy_words AS (
    SELECT occurrence.episode AS id, occurrence.id AS word_id,
      COALESCE(dictionary.detail, '{}'::jsonb) || occurrence.detail AS detail
    FROM yomiru_episode_word AS occurrence LEFT JOIN yomiru_lexeme AS dictionary
      ON (dictionary.revision, dictionary.id) = (occurrence.revision, occurrence.id)
    WHERE occurrence.revision = ${revision}
  ), current_words AS (
    SELECT occurrence.video_id AS id, occurrence.word_id, dictionary.detail || occurrence.detail AS detail
    FROM yomiru_incremental_occurrence AS occurrence
    JOIN yomiru_incremental_dictionary AS dictionary ON dictionary.id = occurrence.word_id
  ) SELECT
    NOT EXISTS ((SELECT * FROM legacy_tracks EXCEPT ALL SELECT * FROM current_tracks)
      UNION ALL (SELECT * FROM current_tracks EXCEPT ALL SELECT * FROM legacy_tracks)) AS tracks,
    NOT EXISTS ((SELECT * FROM legacy_vocabulary EXCEPT ALL SELECT * FROM current_vocabulary)
      UNION ALL (SELECT * FROM current_vocabulary EXCEPT ALL SELECT * FROM legacy_vocabulary)) AS vocabulary,
    NOT EXISTS ((SELECT * FROM legacy_words EXCEPT ALL SELECT * FROM current_words)
      UNION ALL (SELECT * FROM current_words EXCEPT ALL SELECT * FROM legacy_words)) AS words`;
  return parity;
}

function browseRow(row, head) {
  if (head.baseline === head.revision || !row.vocabulary) return row;
  return { ...row, vocabulary: { ...row.vocabulary, registry: head.revision } };
}

async function readIncrementalLibrary(tx, head) {
  if (head.baseline === head.revision) {
    const [base] = await tx`SELECT snapshot FROM yomiru_publication WHERE revision = ${head.baseline}`;
    return decodePublication(base.snapshot, head.baseline);
  }
  const [tracks, entries, metadata, artwork] = await Promise.all([
    tx`SELECT detail FROM yomiru_incremental_track ORDER BY ordinal`,
    tx`SELECT video_id, descriptor FROM yomiru_incremental_vocabulary ORDER BY video_id`,
    tx`SELECT type, id, detail FROM yomiru_incremental_metadata ORDER BY type, id`,
    tx`SELECT detail -> 'artwork' AS item FROM yomiru_incremental_catalogue
      WHERE detail ? 'artwork' AND detail ->> 'unlisted' IS DISTINCT FROM 'true' ORDER BY id`,
  ]);
  const vocabulary = new Map();
  for (const { video_id, descriptor } of entries) {
    if (!vocabulary.has(descriptor.sha256)) vocabulary.set(descriptor.sha256, { ...descriptor, videoIds: [] });
    vocabulary.get(descriptor.sha256).videoIds.push(video_id);
  }
  const catalogue = { version: 1, libraryRevision: head.revision, shows: {} };
  for (const { type, id, detail } of metadata) {
    if (type === "series") catalogue.shows[id] = detail;
    else (catalogue.movies ||= {})[id] = detail;
  }
  return { index: { version: 1, revision: head.revision, dictionaryRevision: head.revision,
    tracks: tracks.map(({ detail }) => detail), vocabulary: [...vocabulary.values()],
    ...(artwork.length && { artwork: artwork.map(({ item }) => item) }) },
  catalogue, publication: head.revision };
}

export function createIncrementalStore(sql) {
  return {
    incremental: true,
    async seedJmdict(rows) {
      if (!(await sql`SELECT 1 FROM yomiru_incremental_head WHERE singleton`).length) {
        throw new Error("Bootstrap the incremental catalogue before importing JMdict");
      }
      return seedJmdictRows(sql, rows);
    },
    async bootstrap(baseline) {
      if (!hash.test(baseline.revision)) throw new Error("Invalid incremental baseline revision");
      return sql.begin(async tx => {
        // Serialize against the existing publisher during the final baseline comparison.
        const [legacy] = await tx`SELECT revision FROM yomiru_active WHERE singleton FOR UPDATE`;
        if (legacy?.revision !== baseline.revision) throw new Error("Legacy publication changed during migration");
        const [head] = await tx`SELECT baseline, revision, serving FROM yomiru_incremental_head WHERE singleton FOR UPDATE`;
        if (head) {
          if (head.baseline === baseline.revision && head.revision === baseline.revision) return false;
          if (head.serving || head.revision !== head.baseline) {
            throw new Error("An independent incremental publication already exists");
          }
          await clearUnusedBaseline(tx);
        }
        await insertBaseline(tx, baseline);
        await tx`INSERT INTO yomiru_incremental_head (baseline, revision, catalogue_revision)
          VALUES (${baseline.revision}, ${baseline.revision}, ${baseline.revision})`;
        return true;
      });
    },
    async state() {
      const [head] = await sql`SELECT baseline, revision, catalogue_revision AS "catalogueRevision", serving
        FROM yomiru_incremental_head WHERE singleton`;
      return head ?? null;
    },
    async archiveTarget(videoId) {
      if (typeof videoId !== "string" || !videoIdentifier.test(videoId)) throw new Error("Invalid archive video ID");
      const [target] = await sql`SELECT anchor FROM yomiru_incremental_vocabulary WHERE video_id = ${videoId}`;
      if (!target || !hash.test(target.anchor)) throw new Error("No matching published Japanese source");
      return { anchor: target.anchor };
    },
    async attachArchive(videoId, { counts, ...source }) {
      return sql.begin(async tx => {
        const [head] = await tx`SELECT serving FROM yomiru_incremental_head WHERE singleton FOR SHARE`;
        if (!head?.serving) throw new Error("Incremental publishing is paused");
        const [target] = await tx`SELECT anchor, manifest_sha256 FROM yomiru_incremental_vocabulary
          WHERE video_id = ${videoId} FOR UPDATE`;
        if (target?.anchor !== source.anchor) throw new Error("Published Japanese source changed");
        const sha256 = source.manifest.sha256;
        if (target.manifest_sha256 === sha256) return { sha256, unchanged: true };
        if (target.manifest_sha256) throw new Error("Published Japanese source already has an archive");
        const current = await readWordCounts(tx, videoId);
        if ([...counts].some(([id, count]) => current.get(id) !== count)) {
          throw new Error("The token analysis does not match published vocabulary");
        }
        await writeArchiveReceipt(tx, source);
        await tx`UPDATE yomiru_incremental_vocabulary SET manifest_sha256 = ${sha256} WHERE video_id = ${videoId}`;
        return { sha256, unchanged: false };
      });
    },
    async baselineParity(expected) {
      return sql.begin("isolation level repeatable read read only", async tx => {
        const head = await readHead(tx, expected);
        const [legacy] = await tx`SELECT revision FROM yomiru_active WHERE singleton`;
        if (legacy?.revision !== head.revision) throw new Error("Legacy publication changed; refresh the baseline");
        return verifyBaselineParity(tx, expected);
      });
    },
    async current() {
      return (await readHead(sql)).revision;
    },
    async library(revision) {
      return sql.begin("isolation level repeatable read read only", async tx =>
        readIncrementalLibrary(tx, await readHead(tx, revision)));
    },
    async setServing(expected, serving) {
      if (!hash.test(expected) || typeof serving !== "boolean") throw new Error("Invalid cutover request");
      return sql.begin(async tx => {
        const [legacy] = await tx`SELECT revision FROM yomiru_active WHERE singleton FOR UPDATE`;
        const [head] = await tx`SELECT revision, serving FROM yomiru_incremental_head WHERE singleton FOR UPDATE`;
        if (!head || head.revision !== expected) throw new Error("Incremental publication changed");
        if (head.serving === serving) return false;
        if (legacy?.revision !== head.revision) {
          throw new Error(serving ? "Legacy publication changed; refresh the baseline"
            : "Replay incremental changes before rolling back the reader");
        }
        if (serving && Object.values(await verifyBaselineParity(tx, expected)).some(equal => !equal)) {
          throw new Error("Incremental baseline differs from the live tracks or vocabulary");
        }
        await tx`UPDATE yomiru_incremental_head SET serving = ${serving} WHERE singleton`;
        return true;
      });
    },
    async restoreLegacy(expected, recoveryRevision, activate) {
      if (!hash.test(expected) || !hash.test(recoveryRevision)) throw new Error("Invalid recovery revision");
      return sql.begin(async tx => {
        const [legacy] = await tx`SELECT revision FROM yomiru_active WHERE singleton FOR UPDATE`;
        const [head] = await tx`SELECT revision, serving FROM yomiru_incremental_head WHERE singleton FOR UPDATE`;
        if (head?.revision !== expected) throw new Error("Incremental publication changed during recovery");
        if (!head.serving) {
          if (legacy?.revision === recoveryRevision) return false;
          throw new Error("Incremental publishing is not serving");
        }
        await tx`UPDATE yomiru_incremental_head SET serving = false WHERE singleton`;
        await activate(tx, legacy.revision);
        return true;
      });
    },
    async publishEpisode(episode, previous, { preflight = false, reviewId, verifyTracks } = {}) {
      if (!hash.test(previous)) throw new Error("Invalid expected publication revision");
      if ((preflight || reviewId !== undefined) && (typeof reviewId !== "string" || !hash.test(reviewId))) {
        throw new Error("Supply the exact episode review ID");
      }
      const requestKey = digest([episode.revision, episode.source.manifest.sha256]);
      const rollback = new Error("Rollback episode preflight");
      const checked = { checked: true, previous, snapshot: episode.revision, reviewId, conflicts: [] };
      const activate = async tx => {
        const [head] = await tx`SELECT revision, catalogue_revision, serving
          FROM yomiru_incremental_head WHERE singleton FOR UPDATE`;
        if (!head?.serving) throw new Error("Incremental publishing is paused");
        const [replayed] = await tx`SELECT revision FROM yomiru_incremental_change WHERE request_key = ${requestKey}`;
        if (replayed && !preflight) return { revision: replayed.revision, unchanged: true };
        if (head.catalogue_revision !== previous) throw new Error("Incremental catalogue changed; stage again");
        const [{ purged }] = await tx`SELECT EXISTS (SELECT 1 FROM yomiru_incremental_change
          WHERE payload ->> 'kind' IN ('purge-retired-movie-romaji', 'purge-superseded-tracks')
          AND (payload -> 'keys') ?| ${tx.array(episode.tracks.map(track => track.path.slice(1)), 25)}) AS purged`;
        if (purged) throw new Error("A permanently removed subtitle file cannot be republished");
        const revision = digest([head.revision, requestKey]);
        const rows = await tx`SELECT vocabulary.video_id, vocabulary.anchor, descriptor, header, archive.manifest
          FROM yomiru_incremental_vocabulary AS vocabulary
          LEFT JOIN yomiru_incremental_source_archive AS archive USING (anchor, manifest_sha256)
          WHERE video_id = ANY(${tx.array(episode.vocabulary.map(row => row.id), 25)})`;
        if (rows.some(row => row.anchor !== episode.source.anchor)) {
          throw new Error("Japanese source changed; explicitly migrate the title source first");
        }
        for (const { video_id: id, manifest } of rows) {
          const incoming = episode.vocabulary.find(entry => entry.id === id);
          // A translation of the same original reuses the published vocabulary and
          // any reviewed exclusions. New analysis never overwrites those rows.
          if (manifest?.original.sha256 === episode.source.original.sha256
            && incoming.header.analysis === "unidic-lite-1.0.8-words-v4") continue;
          const currentCounts = await readWordCounts(tx, id);
          if (incoming.words.some(word => currentCounts.get(word.id) !== word.count)) {
            throw new Error("Reviewed vocabulary correction required before changing published word counts");
          }
        }
        const existing = new Map(rows.map(row => [row.video_id, { publicVocabulary: {
          ...row.descriptor, ...(row.header.registry && { registry: row.header.registry }),
        } }]));
        if (!replayed) {
          await verifyTracks?.(episode.tracks);
          await writeEpisodeVocabulary(tx, episode, existing);
          await writeEpisodeTracks(tx, episode);
          await writeEpisodeCatalogue(tx, episode, existing);
        }
        const conflicts = await requireEpisodeReviews(tx, episode, rows, reviewId);
        if (preflight) {
          checked.conflicts = conflicts.slice(0, 50);
          throw rollback;
        }
        if (conflicts.some(item => item.reason === "missing-matching-review")) {
          throw new Error("Publish bilingual tracks through the reviewed episode release");
        }
        if (conflicts.length) throw new Error("Reviewed questions conflict with the staged Practice dictionary");
        await tx`INSERT INTO yomiru_incremental_change (revision, previous, request_key, payload)
          VALUES (${revision}, ${head.revision}, ${requestKey}, ${tx.json(episode)})`;
        await tx`UPDATE yomiru_incremental_head SET revision = ${revision}, catalogue_revision = ${revision}
          WHERE singleton`;
        return { revision, unchanged: false };
      };
      try {
        return await sql.begin(activate);
      } catch (error) {
        if (error !== rollback) throw error;
        return checked;
      }
    },
    async retireMovieTracks(videoId, trackIds, previous, { withdraw = false } = {}) {
      if (typeof videoId !== "string" || !/^tt\d{1,20}$/.test(videoId)
        || typeof previous !== "string" || !hash.test(previous)
        || !Array.isArray(trackIds) || !trackIds.length || trackIds.length > 10000
        || trackIds.some(id => typeof id !== "string" || !hash.test(id))
        || new Set(trackIds).size !== trackIds.length) {
        throw new Error("Supply an exact movie ID, current catalogue revision, and distinct track IDs");
      }
      return sql.begin(async tx => {
        const [head] = await tx`SELECT revision, catalogue_revision, serving
          FROM yomiru_incremental_head WHERE singleton FOR UPDATE`;
        if (!head?.serving) throw new Error("Incremental publishing is paused");
        const tracks = (await tx`SELECT track.detail FROM yomiru_incremental_track_video AS binding
          JOIN yomiru_incremental_track AS track ON track.id = binding.track_id
          WHERE binding.type = 'movie' AND binding.video_id = ${videoId}`).map(({ detail }) => detail);
        const requested = new Set(trackIds);
        const retiring = tracks.filter(track => requested.has(track.id));
        if (retiring.length !== requested.size || retiring.some(track => track.videoIds.some(id => id !== videoId))) {
          throw new Error("Every retired track must belong exclusively to this movie");
        }
        const active = retiring.filter(track => !track.superseded);
        if (!active.length) return { revision: head.revision, unchanged: true };
        if (head.catalogue_revision !== previous) throw new Error("Incremental catalogue changed; refresh tracks");
        const remaining = tracks.filter(track => !track.superseded && !requested.has(track.id));
        const [vocabulary] = await tx`SELECT anchor FROM yomiru_incremental_vocabulary WHERE video_id = ${videoId}`;
        const withdrawMovie = withdraw && remaining.length === 0;
        if (!vocabulary || (!withdrawMovie && !remaining.some(track => track.anchor === vocabulary.anchor))) {
          throw new Error("Keep a discoverable movie track with matching vocabulary");
        }
        const [row] = await tx`SELECT detail FROM yomiru_incremental_catalogue WHERE id = ${videoId}`;
        if (!row) throw new Error("Movie is missing from the catalogue");
        const detail = { ...row.detail };
        delete detail.readingModes;
        Object.assign(detail, subtitleCoverage(remaining));
        if (withdrawMovie) detail.unlisted = true;
        await tx`UPDATE yomiru_incremental_track SET detail = detail || '{"superseded":true}'::jsonb
          WHERE id = ANY(${tx.array(active.map(track => track.id), 25)})`;
        await tx`UPDATE yomiru_incremental_catalogue SET detail = ${tx.json(detail)},
          search_text = ${episodeSearchText(detail)} WHERE id = ${videoId}`;
        const payload = { kind: withdraw ? "withdraw-movie-tracks" : "retire-movie-tracks",
          videoId, trackIds: [...requested].sort() };
        const requestKey = digest([head.catalogue_revision, payload]);
        const revision = digest([head.revision, requestKey]);
        await tx`INSERT INTO yomiru_incremental_change (revision, previous, request_key, payload)
          VALUES (${revision}, ${head.revision}, ${requestKey}, ${tx.json(payload)})`;
        await tx`UPDATE yomiru_incremental_head SET revision = ${revision}, catalogue_revision = ${revision}
          WHERE singleton`;
        return { revision, unchanged: false };
      });
    },
    async purgeRetiredMovieRomaji(videoId, trackId, previous) {
      if (typeof videoId !== "string" || !/^tt\d{1,20}$/.test(videoId)
        || typeof trackId !== "string" || !hash.test(trackId) || typeof previous !== "string" || !hash.test(previous)) {
        throw new Error("Supply the movie and retired track IDs and the current catalogue revision");
      }
      const kind = "purge-retired-movie-romaji";
      const requestKey = digest([kind, videoId, trackId]);
      return sql.begin(async tx => {
        const [head] = await tx`SELECT revision, catalogue_revision, serving
          FROM yomiru_incremental_head WHERE singleton FOR UPDATE`;
        if (!head?.serving) throw new Error("Incremental publishing is paused");
        const [replayed] = await tx`SELECT revision, payload FROM yomiru_incremental_change
          WHERE request_key = ${requestKey}`;
        if (replayed) return { revision: replayed.revision, keys: replayed.payload.keys, unchanged: true };
        if (head.catalogue_revision !== previous) throw new Error("Incremental catalogue changed; refresh tracks");
        const tracks = (await tx`SELECT track.detail FROM yomiru_incremental_track_video AS binding
          JOIN yomiru_incremental_track AS track ON track.id = binding.track_id
          WHERE binding.type = 'movie' AND binding.video_id = ${videoId}`).map(({ detail }) => detail);
        const track = tracks.find(track => track.id === trackId);
        if (track?.superseded !== true || track.lang !== "jpn" || track.script !== "romaji"
          || !isDeepStrictEqual(track.videoIds, [videoId]) || !hash.test(track.sha256)
          || track.path !== `/library/${track.sha256}.ass`) {
          throw new Error("Purge requires an exclusive, retired standalone romaji movie track");
        }
        const [vocabulary] = await tx`SELECT anchor FROM yomiru_incremental_vocabulary WHERE video_id = ${videoId}`;
        if (!vocabulary || !tracks.some(candidate => !candidate.superseded && candidate.lang === "eng"
          && candidate.script === "romaji" && candidate.anchor === vocabulary.anchor)) {
          throw new Error("Publish the English romaji replacement and its vocabulary first");
        }
        const [{ shared }] = await tx`SELECT EXISTS (SELECT 1 FROM yomiru_incremental_track
          WHERE id <> ${trackId} AND detail ->> 'path' = ${track.path}) AS shared`;
        if (shared) throw new Error("The subtitle file is referenced by another track");
        const group = videoGroups({ tracks }, "movie", videoId).find(group => group.trackIds.includes(trackId));
        const links = await tx`SELECT code, detail FROM yomiru_feedback_link
          WHERE (detail #> '{group,trackIds}') ? ${trackId}`;
        if (!isDeepStrictEqual(group.trackIds, [trackId]) || links.some(({ code, detail }) =>
          !codePattern.test(code) || !isDeepStrictEqual(detail.group.trackIds, [trackId]))) {
          throw new Error("The retired track shares a playback link with another track");
        }
        const codes = new Set([feedbackCode(group, null, trackId), feedbackCode(group, null), ...links.map(link => link.code)]);
        const keys = [track.path.slice(1), ...[...codes].sort().map(code =>
          `feedback-tracks/v${playbackVersion}/${renderedId(trackId, code)}.ass`)];
        await tx`DELETE FROM yomiru_feedback_link WHERE code = ANY(${tx.array(links.map(link => link.code), 25)})`;
        await tx`DELETE FROM yomiru_incremental_track_video WHERE track_id = ${trackId}`;
        await tx`DELETE FROM yomiru_incremental_track WHERE id = ${trackId}`;
        const revision = digest([head.revision, requestKey]);
        await tx`INSERT INTO yomiru_incremental_change (revision, previous, request_key, payload)
          VALUES (${revision}, ${head.revision}, ${requestKey}, ${tx.json({ kind, videoId, trackId, keys })})`;
        await tx`UPDATE yomiru_incremental_head SET revision = ${revision}, catalogue_revision = ${revision}
          WHERE singleton`;
        return { revision, keys, unchanged: false };
      });
    },
    async correctVocabulary(episode, previous, wordId) {
      if (!hash.test(previous) || !/^ja-[a-f0-9]{64}$/.test(wordId)) throw new Error("Invalid vocabulary correction");
      const requestKey = digest(["tokenization-correction", wordId, episode.revision, episode.source.manifest.sha256]);
      return sql.begin(async tx => {
        const [head] = await tx`SELECT revision, catalogue_revision, serving
          FROM yomiru_incremental_head WHERE singleton FOR UPDATE`;
        if (!head?.serving) throw new Error("Incremental publishing is paused");
        const [replayed] = await tx`SELECT revision FROM yomiru_incremental_change WHERE request_key = ${requestKey}`;
        if (replayed) return { revision: replayed.revision, unchanged: true };
        if (head.catalogue_revision !== previous) throw new Error("Incremental catalogue changed; stage again");
        const revision = digest([head.revision, requestKey]);
        const [review] = await tx`SELECT result FROM yomiru_incremental_word_review
          WHERE word_id = ${wordId} AND state = 'needs_review' FOR UPDATE`;
        const correction = review?.result;
        const affected = episode.vocabulary.find(({ id }) => id === correction?.videoId);
        if (correction?.outcome !== "tokenization_error" || !affected) throw new Error("No matching tokenization review");
        const [prior] = await tx`SELECT detail FROM yomiru_incremental_occurrence
          WHERE video_id = ${affected.id} AND word_id = ${wordId}`;
        if (!prior || (affected.words.find(word => word.id === wordId)?.count || 0) >= prior.detail.count) {
          throw new Error("The corrected analysis must resolve the reviewed occurrence");
        }
        for (const track of episode.tracks) {
          const [stored] = await tx`SELECT detail FROM yomiru_incremental_track WHERE id = ${track.id}`;
          if (!isDeepStrictEqual(stored?.detail, track)) throw new Error("Vocabulary corrections cannot change subtitle files");
        }
        const saved = [];
        for (const entry of episode.vocabulary) {
          const [old] = await tx`SELECT vocabulary.descriptor, archive.manifest FROM yomiru_incremental_vocabulary AS vocabulary
            JOIN yomiru_incremental_source_archive AS archive USING (anchor, manifest_sha256) WHERE video_id = ${entry.id}`;
          if (old?.manifest.anchor !== episode.source.anchor || old.manifest.original.sha256 !== episode.source.original.sha256
            || old.manifest.analysis.sha256 === episode.source.analysis.sha256) {
            throw new Error("A correction must reuse the archived original and supply a revised analysis");
          }
          saved.push({ id: entry.id, ...old });
          await removeEpisodeVocabulary(tx, entry.id);
        }
        await writeEpisodeVocabulary(tx, episode, new Map());
        for (const { id, descriptor } of episode.vocabulary) {
          await tx`UPDATE yomiru_incremental_catalogue SET detail = jsonb_set(detail, '{vocabulary}', ${tx.json(descriptor)})
            WHERE id = ${id}`;
        }
        await tx`UPDATE yomiru_incremental_word_review SET state = CASE WHEN EXISTS (
          SELECT 1 FROM yomiru_incremental_word_coverage WHERE word_id = ${wordId}
        ) THEN 'pending' ELSE 'resolved' END, attempts = 0, result = ${tx.json({ ...correction, revision })},
          updated_at = now() WHERE word_id = ${wordId}`;
        await tx`INSERT INTO yomiru_incremental_change (revision, previous, request_key, payload) VALUES
          (${revision}, ${head.revision}, ${requestKey}, ${tx.json({ kind: "vocabulary-correction", previous: saved, episode })})`;
        await tx`UPDATE yomiru_incremental_head SET revision = ${revision}, catalogue_revision = ${revision}
          WHERE singleton`;
        return { revision, unchanged: false };
      });
    },
    async cleanStudyVocabulary(staged, previous) {
      const targetIds = staged.flatMap(item => item.descriptor.videoIds);
      if (!hash.test(previous) || new Set(targetIds).size !== targetIds.length) {
        throw new Error("Supply the current catalogue revision and distinct cleanup titles");
      }
      const requestKey = digest(["study-vocabulary", staged.map(({ descriptor, source }) =>
        [descriptor.sha256, [...descriptor.videoIds].sort(), source.manifest.sha256]).sort()]);
      return sql.begin(async tx => {
        const [head] = await tx`SELECT revision, catalogue_revision, serving
          FROM yomiru_incremental_head WHERE singleton FOR UPDATE`;
        if (!head?.serving) throw new Error("Incremental publishing is paused");
        const [replayed] = await tx`SELECT revision FROM yomiru_incremental_change WHERE request_key = ${requestKey}`;
        if (replayed) return { revision: replayed.revision, unchanged: true };
        if (head.catalogue_revision !== previous) throw new Error("Incremental catalogue changed; stage again");
        const replaced = [];
        for (const { descriptor, source, occurrences, header, previousVocabulary } of staged) {
          const vocabulary = [];
          for (const id of descriptor.videoIds) {
            const [old] = await tx`SELECT vocabulary.descriptor, archive.manifest
              FROM yomiru_incremental_vocabulary AS vocabulary
              JOIN yomiru_incremental_source_archive AS archive USING (anchor, manifest_sha256)
              WHERE video_id = ${id}`;
            if (old?.manifest.anchor !== source.anchor || old.manifest.original.sha256 !== source.original.sha256) {
              throw new Error(`Vocabulary cleanup must use the original archived source for ${id}`);
            }
            if (old.descriptor.sha256 === descriptor.sha256) continue;
            if (old.descriptor.sha256 !== previousVocabulary) {
              throw new Error(`Published vocabulary changed; review the cleanup again for ${id}`);
            }
            const prior = await readWordCounts(tx, id);
            if (occurrences.some(word => (prior.get(word.id) ?? 0) < word.count)) {
              throw new Error(`Vocabulary cleanup cannot add words or occurrences for ${id}`);
            }
            replaced.push({ id, before: old.descriptor, manifest: old.manifest.manifest, after: descriptor });
            await removeEpisodeVocabulary(tx, id);
            vocabulary.push({ id, descriptor, header: { ...header, dictionary: null }, words: occurrences });
          }
          if (!vocabulary.length) continue;
          await writeEpisodeVocabulary(tx, { source, vocabulary, dictionary: [] }, new Map());
          for (const { id } of vocabulary) {
            await tx`UPDATE yomiru_incremental_catalogue SET detail = jsonb_set(detail, '{vocabulary}', ${tx.json(descriptor)})
              WHERE id = ${id}`;
          }
        }
        if (!replaced.length) return { revision: head.revision, unchanged: true };
        const revision = digest([head.revision, requestKey]);
        await tx`INSERT INTO yomiru_incremental_change (revision, previous, request_key, payload) VALUES
          (${revision}, ${head.revision}, ${requestKey}, ${tx.json({ kind: "study-vocabulary", replaced })})`;
        await tx`UPDATE yomiru_incremental_head SET revision = ${revision}, catalogue_revision = ${revision}
          WHERE singleton`;
        return { revision, unchanged: false };
      });
    },
    async tracks(revision, type, id) {
      return sql.begin("isolation level repeatable read read only", async tx => {
        await readHead(tx, revision);
        const rows = await tx`SELECT track.detail FROM yomiru_incremental_track_video AS binding
          JOIN yomiru_incremental_track AS track ON track.id = binding.track_id
          WHERE binding.type = ${type} AND binding.video_id = ${id} ORDER BY track.ordinal`;
        return rows.map(({ detail }) => detail);
      });
    },
    async migratePlaybackTracks(trackIds, previous, prepare, verifyTracks) {
      const ids = playbackTrackIds(trackIds, previous);
      const kind = "migrate-playback-tracks";
      const requestKey = digest([kind, ids]);
      const receipt = async database => {
        const [saved] = await database`SELECT revision, payload FROM yomiru_incremental_change WHERE request_key = ${requestKey}`;
        return saved && { revision: saved.revision, tracks: saved.payload.tracks, unchanged: true };
      };
      const saved = await receipt(sql);
      if (saved) return saved;
      const current = await this.state();
      if (!current?.serving || current.catalogueRevision !== previous) {
        throw new Error("Incremental catalogue changed or is paused; refresh tracks");
      }
      const rows = await sql`SELECT detail FROM yomiru_incremental_track WHERE id = ANY(${sql.array(ids, 25)}) ORDER BY id`;
      if (rows.length !== ids.length || rows.some(({ detail }) => detail.superseded || detail.playbackReady)) {
        throw new Error("Playback migration requires active legacy tracks");
      }
      const replacements = await mapBatches(rows, ({ detail }) => prepare(detail));
      return sql.begin(async tx => {
        const [head] = await tx`SELECT revision, catalogue_revision, serving
          FROM yomiru_incremental_head WHERE singleton FOR UPDATE`;
        const replayed = await receipt(tx);
        if (replayed) return replayed;
        if (!head?.serving || head.catalogue_revision !== previous) {
          throw new Error("Incremental catalogue changed or is paused; refresh tracks");
        }
        await verifyTracks?.(replacements);
        await insertRows(tx, "yomiru_incremental_track", replacements.map(track => ({ id: track.id, detail: tx.json(track) })));
        await insertRows(tx, "yomiru_incremental_track_video", replacements.flatMap(track => track.videoIds.map(video_id => ({
          type: track.type, video_id, track_id: track.id,
        }))));
        for (const { detail } of rows) {
          await tx`UPDATE yomiru_incremental_track SET detail = ${tx.json({ ...detail, superseded: true })} WHERE id = ${detail.id}`;
        }
        const tracks = replacements.map(({ id }, i) => ({ previous: rows[i].detail.id, id }));
        const revision = digest([head.revision, requestKey]);
        await tx`INSERT INTO yomiru_incremental_change (revision, previous, request_key, payload)
          VALUES (${revision}, ${head.revision}, ${requestKey}, ${tx.json({ kind, tracks })})`;
        await tx`UPDATE yomiru_incremental_head SET revision = ${revision}, catalogue_revision = ${revision} WHERE singleton`;
        return { revision, tracks, unchanged: false };
      });
    },
    async purgeSupersededTracks(trackIds, previous) {
      const ids = playbackTrackIds(trackIds, previous);
      const kind = "purge-superseded-tracks";
      const requestKey = digest([kind, ids]);
      return sql.begin(async tx => {
        const [head] = await tx`SELECT revision, catalogue_revision, serving
          FROM yomiru_incremental_head WHERE singleton FOR UPDATE`;
        const [saved] = await tx`SELECT revision, payload FROM yomiru_incremental_change WHERE request_key = ${requestKey}`;
        if (saved) return { revision: saved.revision, keys: saved.payload.keys, unchanged: true };
        if (!head?.serving || head.catalogue_revision !== previous) throw new Error("Incremental catalogue changed or is paused");
        await requireReadyPlayback(tx);
        const rows = await tx`SELECT detail FROM yomiru_incremental_track WHERE id = ANY(${tx.array(ids, 25)})`;
        if (rows.length !== ids.length || rows.some(({ detail }) => detail.superseded !== true
          || !hash.test(detail.sha256) || detail.path !== `/library/${detail.sha256}.ass`)) {
          throw new Error("Purge requires exact superseded subtitle revisions");
        }
        const paths = [...new Set(rows.map(({ detail }) => detail.path))];
        const remaining = await tx`SELECT DISTINCT detail ->> 'path' AS path FROM yomiru_incremental_track
          WHERE NOT (id = ANY(${tx.array(ids, 25)})) AND (detail ->> 'path') = ANY(${tx.array(paths, 25)})`;
        const shared = new Set(remaining.map(({ path }) => path));
        const keys = paths.filter(path => !shared.has(path)).map(path => path.slice(1)).sort();
        await tx`DELETE FROM yomiru_incremental_track_video WHERE track_id = ANY(${tx.array(ids, 25)})`;
        await tx`DELETE FROM yomiru_incremental_track WHERE id = ANY(${tx.array(ids, 25)})`;
        const revision = digest([head.revision, requestKey]);
        await tx`INSERT INTO yomiru_incremental_change (revision, previous, request_key, payload)
          VALUES (${revision}, ${head.revision}, ${requestKey}, ${tx.json({ kind, keys, tracks: ids })})`;
        await tx`UPDATE yomiru_incremental_head SET revision = ${revision}, catalogue_revision = ${revision} WHERE singleton`;
        return { revision, keys, unchanged: false };
      });
    },
    async requirePlaybackCutover(previous) {
      if (!hash.test(previous)) throw new Error("Invalid expected catalogue revision");
      return sql.begin("isolation level repeatable read read only", async tx => {
        const [head] = await tx`SELECT catalogue_revision, serving FROM yomiru_incremental_head WHERE singleton`;
        if (!head?.serving || head.catalogue_revision !== previous) throw new Error("Incremental catalogue changed or is paused");
        await requireReadyPlayback(tx);
      });
    },
    async browse(revision, { show, terms, offset }, limit) {
      return sql.begin("isolation level repeatable read read only", async tx => {
        const head = await readHead(tx, revision);
        // Sequence the complete movie catalogue before filtering, including rows written
        // before movie codes were introduced or prepared as individual uploads.
        const storedMovies = await tx`SELECT catalogue.detail FROM yomiru_incremental_metadata AS metadata
          JOIN yomiru_incremental_catalogue AS catalogue ON catalogue.id = metadata.id
          WHERE metadata.type = 'movie' AND catalogue.detail ->> 'unlisted' IS DISTINCT FROM 'true'
            AND (${!show || show.startsWith("movie:")}
            OR EXISTS (SELECT 1 FROM yomiru_incremental_metadata WHERE type = 'movie' AND id = ${show}))`;
        const movies = new Map(filterLibraryRows(sequenceMovies(storedMovies.map(({ detail }) => detail)),
          { show, terms }).map(row => [row.id, row]));
        const rows = await tx`SELECT id, detail FROM (
          (SELECT id, detail, 0 AS section, ordinal FROM yomiru_incremental_catalogue
            WHERE (detail ->> 'type') IS DISTINCT FROM 'movie'
              AND (${show} = '' OR show_id = ${show} OR id = ${show})
              AND NOT EXISTS (SELECT 1 FROM unnest(${tx.array(terms, 25)}::text[]) AS token(value)
                WHERE position(token.value IN search_text) = 0)
            ORDER BY ordinal LIMIT ${offset + limit})
          UNION ALL
          SELECT id, NULL, 1, ordinal
            FROM unnest(${tx.array([...movies.keys()], 25)}::text[]) WITH ORDINALITY AS movie(id, ordinal)
        ) AS matching ORDER BY section, ordinal LIMIT ${limit} OFFSET ${offset}`;
        return rows.map(({ id, detail }) => browseRow(detail ?? movies.get(id), head));
      });
    },
    async episodeRows(revision, ids) {
      return sql.begin("isolation level repeatable read read only", async tx => {
        const head = await readHead(tx, revision);
        const rows = await tx`SELECT id, detail FROM yomiru_incremental_catalogue WHERE id = ANY(${tx.array(ids, 25)})`;
        return new Map(rows.map(({ id, detail }) => [id, browseRow(detail, head)]));
      });
    },
    async selectionSummary(episodes) {
      return sql.begin("isolation level repeatable read read only", async tx => {
        const head = await readHead(tx);
        const ids = episodes?.map(({ id }) => id);
        const rows = await tx`SELECT vocabulary.video_id, vocabulary.descriptor, vocabulary.header
          FROM yomiru_incremental_vocabulary AS vocabulary
          JOIN yomiru_incremental_catalogue AS catalogue ON catalogue.id = vocabulary.video_id
          WHERE catalogue.detail ->> 'unlisted' IS DISTINCT FROM 'true'
            AND ${ids ? tx`vocabulary.video_id = ANY(${tx.array(ids, 25)})` : tx`true`}`;
        if (ids) {
          const descriptions = new Map(rows.map(row => [row.video_id, row]));
          if (episodes.some(({ id, revision, registry }) => {
            const row = descriptions.get(id);
            return row?.descriptor.sha256 !== revision || registry !== (head.baseline === head.revision
              ? row.header.registry : head.revision);
          })) return null;
        }
        const publicIds = rows.map(({ video_id }) => video_id);
        const [{ total, english }] = await tx`SELECT count(*)::int AS total,
          count(*) FILTER (WHERE jsonb_array_length(dictionary.detail #> '{meanings,eng}') > 0)::int AS english
          FROM (SELECT DISTINCT word_id FROM yomiru_incremental_occurrence
            WHERE video_id = ANY(${tx.array(publicIds, 25)})) AS words
          JOIN yomiru_incremental_dictionary AS dictionary ON dictionary.id = words.word_id`;
        const result = { publication: head.revision, total, covered: english ? { eng: english } : {} };
        if (ids) return result;
        const movieCount = publicIds.filter(id => /^tt\d+$/.test(id)).length;
        return { ...result, episodeCount: publicIds.length, ...(movieCount && { movieCount }) };
      });
    },
    async documents(revision, ids) {
      return sql.begin("isolation level repeatable read read only", async tx => {
        const head = await readHead(tx, revision);
        const rows = await tx`SELECT vocabulary.video_id, vocabulary.header, COALESCE((
          SELECT jsonb_agg(dictionary.detail || occurrence.detail ORDER BY occurrence.word_id)
          FROM yomiru_incremental_occurrence AS occurrence
          JOIN yomiru_incremental_dictionary AS dictionary ON dictionary.id = occurrence.word_id
          WHERE occurrence.video_id = vocabulary.video_id
        ), '[]'::jsonb) AS words FROM yomiru_incremental_vocabulary AS vocabulary
        WHERE vocabulary.video_id = ANY(${tx.array(ids, 25)})`;
        return new Map(rows.map(({ video_id, header, words }) => [video_id, {
          ...header, ...(head.revision !== head.baseline && { registry: head.revision }), words,
        }]));
      });
    },
  };
}
