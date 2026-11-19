import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { episodeSearchText, filterLibraryRows, libraryRows, sequenceMovies, subtitleCoverage } from "./browse.mjs";
import { validateAsset } from "./library.mjs";
import { matchJmdict, seedJmdictRows, useJmdictMatch } from "./jmdict.mjs";
import { decodePublication } from "./published-library.mjs";
import { loadPublicationRows, mapBatches } from "./r2-publication.mjs";
import { verifySourceArchive } from "./source-archive.mjs";

const hash = /^[a-f0-9]{64}$/;
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const videoIdentifier = /^[A-Za-z0-9_.:-]{1,200}$/;

export async function prepareIncrementalBaseline(bytes, revision, readAsset) {
  const { index, catalogue } = decodePublication(bytes, revision);
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
    const detail = { ...row, translations, ...(readingModes.length && { readingModes }) };
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
  const [tracks, entries, metadata] = await Promise.all([
    tx`SELECT detail FROM yomiru_incremental_track ORDER BY ordinal`,
    tx`SELECT video_id, descriptor FROM yomiru_incremental_vocabulary ORDER BY video_id`,
    tx`SELECT type, id, detail FROM yomiru_incremental_metadata ORDER BY type, id`,
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
    tracks: tracks.map(({ detail }) => detail), vocabulary: [...vocabulary.values()] },
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
    async publishEpisode(episode, previous) {
      if (!hash.test(previous)) throw new Error("Invalid expected publication revision");
      const requestKey = digest([episode.revision, episode.source.manifest.sha256]);
      return sql.begin(async tx => {
        const [head] = await tx`SELECT revision, catalogue_revision, serving
          FROM yomiru_incremental_head WHERE singleton FOR UPDATE`;
        if (!head?.serving) throw new Error("Incremental publishing is paused");
        const [replayed] = await tx`SELECT revision FROM yomiru_incremental_change WHERE request_key = ${requestKey}`;
        if (replayed) return { revision: replayed.revision, unchanged: true };
        if (head.catalogue_revision !== previous) throw new Error("Incremental catalogue changed; stage again");
        const revision = digest([head.revision, requestKey]);
        const rows = await tx`SELECT video_id, anchor, descriptor, header FROM yomiru_incremental_vocabulary
          WHERE video_id = ANY(${tx.array(episode.vocabulary.map(row => row.id), 25)})`;
        if (rows.some(row => row.anchor !== episode.source.anchor)) {
          throw new Error("Japanese source changed; explicitly migrate the title source first");
        }
        for (const { video_id: id } of rows) {
          const currentCounts = await readWordCounts(tx, id);
          if (episode.vocabulary.find(entry => entry.id === id).words.some(word =>
            currentCounts.get(word.id) !== word.count)) {
            throw new Error("Reviewed vocabulary correction required before changing published word counts");
          }
        }
        const existing = new Map(rows.map(row => [row.video_id, { publicVocabulary: {
          ...row.descriptor, ...(row.header.registry && { registry: row.header.registry }),
        } }]));
        await writeEpisodeVocabulary(tx, episode, existing);
        await writeEpisodeTracks(tx, episode);
        await writeEpisodeCatalogue(tx, episode, existing);
        await tx`INSERT INTO yomiru_incremental_change (revision, previous, request_key, payload)
          VALUES (${revision}, ${head.revision}, ${requestKey}, ${tx.json(episode)})`;
        await tx`UPDATE yomiru_incremental_head SET revision = ${revision}, catalogue_revision = ${revision}
          WHERE singleton`;
        return { revision, unchanged: false };
      });
    },
    async retireMovieTracks(videoId, trackIds, previous) {
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
        if (!vocabulary || !remaining.some(track => track.anchor === vocabulary.anchor)) {
          throw new Error("Keep a discoverable movie track with matching vocabulary");
        }
        const [row] = await tx`SELECT detail FROM yomiru_incremental_catalogue WHERE id = ${videoId}`;
        if (!row) throw new Error("Movie is missing from the catalogue");
        const detail = { ...row.detail };
        delete detail.readingModes;
        Object.assign(detail, subtitleCoverage(remaining));
        await tx`UPDATE yomiru_incremental_track SET detail = detail || '{"superseded":true}'::jsonb
          WHERE id = ANY(${tx.array(active.map(track => track.id), 25)})`;
        await tx`UPDATE yomiru_incremental_catalogue SET detail = ${tx.json(detail)},
          search_text = ${episodeSearchText(detail)} WHERE id = ${videoId}`;
        const payload = { kind: "retire-movie-tracks", videoId, trackIds: [...requested].sort() };
        const requestKey = digest([head.catalogue_revision, payload]);
        const revision = digest([head.revision, requestKey]);
        await tx`INSERT INTO yomiru_incremental_change (revision, previous, request_key, payload)
          VALUES (${revision}, ${head.revision}, ${requestKey}, ${tx.json(payload)})`;
        await tx`UPDATE yomiru_incremental_head SET revision = ${revision}, catalogue_revision = ${revision}
          WHERE singleton`;
        return { revision, unchanged: false };
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
          await tx`DELETE FROM yomiru_incremental_word_coverage AS coverage USING yomiru_incremental_occurrence AS occurrence
            WHERE coverage.word_id = occurrence.word_id AND occurrence.video_id = ${entry.id} AND coverage.titles = 1`;
          await tx`UPDATE yomiru_incremental_word_coverage AS coverage SET titles = coverage.titles - 1
            FROM yomiru_incremental_occurrence AS occurrence WHERE coverage.word_id = occurrence.word_id
              AND occurrence.video_id = ${entry.id}`;
          await tx`DELETE FROM yomiru_incremental_occurrence WHERE video_id = ${entry.id}`;
          await tx`DELETE FROM yomiru_incremental_vocabulary WHERE video_id = ${entry.id}`;
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
    async tracks(revision, type, id) {
      return sql.begin("isolation level repeatable read read only", async tx => {
        await readHead(tx, revision);
        const rows = await tx`SELECT track.detail FROM yomiru_incremental_track_video AS binding
          JOIN yomiru_incremental_track AS track ON track.id = binding.track_id
          WHERE binding.type = ${type} AND binding.video_id = ${id} ORDER BY track.ordinal`;
        return rows.map(({ detail }) => detail);
      });
    },
    async browse(revision, { show, terms, offset }, limit) {
      return sql.begin("isolation level repeatable read read only", async tx => {
        const head = await readHead(tx, revision);
        // Sequence the complete movie catalogue before filtering, including rows written
        // before movie codes were introduced or prepared as individual uploads.
        const storedMovies = await tx`SELECT catalogue.detail FROM yomiru_incremental_metadata AS metadata
          JOIN yomiru_incremental_catalogue AS catalogue ON catalogue.id = metadata.id
          WHERE metadata.type = 'movie' AND (${!show || show.startsWith("movie:")}
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
        if (ids) {
          const rows = await tx`SELECT video_id, descriptor, header FROM yomiru_incremental_vocabulary
            WHERE video_id = ANY(${tx.array(ids, 25)})`;
          const descriptions = new Map(rows.map(row => [row.video_id, row]));
          if (episodes.some(({ id, revision, registry }) => {
            const row = descriptions.get(id);
            return row?.descriptor.sha256 !== revision || registry !== (head.baseline === head.revision
              ? row.header.registry : head.revision);
          })) return null;
        }
        const selected = ids ? tx`SELECT DISTINCT word_id FROM yomiru_incremental_occurrence
          WHERE video_id = ANY(${tx.array(ids, 25)})` : tx`SELECT word_id FROM yomiru_incremental_word_coverage`;
        const [{ total, english }] = await tx`SELECT count(*)::int AS total,
          count(*) FILTER (WHERE jsonb_array_length(dictionary.detail #> '{meanings,eng}') > 0)::int AS english
          FROM (${selected}) AS words JOIN yomiru_incremental_dictionary AS dictionary ON dictionary.id = words.word_id`;
        const result = { publication: head.revision, total, covered: english ? { eng: english } : {} };
        if (ids) return result;
        const [{ episodes: episodeCount, movies: movieCount }] = await tx`SELECT count(*)::int AS episodes,
          count(*) FILTER (WHERE video_id ~ '^tt[0-9]+$')::int AS movies FROM yomiru_incremental_vocabulary`;
        return { ...result, episodeCount, ...(movieCount && { movieCount }) };
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
