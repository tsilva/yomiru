import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { matchesPracticeTrack, practiceNameMeaning, practiceSourceRevisions, practiceVocabularySource } from "./practice-context.mjs";
import { reviewedWordSpans } from "./practice-original.mjs";
import { createPrivateSourceStore } from "./r2.mjs";
import manifest from "./practice-archive.json" with { type: "json" };

const archiveCacheSize = 16;
const maxAnalysisBytes = 12 * 1024 * 1024;
export class ReviewedPracticeUnavailable extends Error {}
export const bundledReviewedSources = Object.entries(manifest.phrases)
  .filter(([, descriptor]) => descriptor.prepared).map(([source]) => source);

function createAnalysisReader(read, catalogue) {
  const cache = new Map();
  return async (descriptor, kind, revision) => {
    const { sha256, bytes } = descriptor;
    let entry = cache.get(sha256);
    cache.delete(sha256);
    entry ??= (async () => {
      const object = await read(`analyses/${sha256}.json.gz`, bytes);
      if (object?.bytes.length !== bytes || createHash("sha256").update(object.bytes).digest("hex") !== sha256) {
        throw new Error("Practice analysis integrity check failed");
      }
      const data = JSON.parse(gunzipSync(object.bytes, { maxOutputLength: maxAnalysisBytes }));
      if (data.version !== catalogue.version || data.kind !== kind || (revision && data.sourceRevision !== revision)) {
        throw new Error("Practice analysis identity changed");
      }
      if (!revision) return data;
      const cues = new Map(data.cues.map(([id, ...cue]) => [id, cue]));
      const words = new Map();
      for (const [cue, word, gloss, ...spans] of data.examples) {
        const [kana, romaji, peeks] = cues.get(cue);
        if (!words.has(word)) words.set(word, []);
        words.get(word).push({ gloss, example: [`${revision}:${cue}`, kana, romaji, ...spans], peeks });
      }
      return { cues, words, prepared: data.prepared === true, supplementalCards: data.supplementalCards,
        coverage: data.coverage };
    })();
    cache.set(sha256, entry);
    if (cache.size > archiveCacheSize) cache.delete(cache.keys().next().value);
    try { return await entry; }
    catch (error) {
      if (cache.get(sha256) === entry) cache.delete(sha256);
      throw error;
    }
  };
}

function phraseArchive(source, { cues, prepared, supplementalCards, coverage }) {
  const rows = [...cues].map(([id, fields]) => {
    if (!prepared || !coverage?.[id]) return [id, ...fields];
    const { japanese, spans } = coverage[id];
    const [kana, romaji, peeks, translation, targets] = fields;
    // Older reviews have question offsets for exact dictionary words that the peek compiler skipped.
    const hints = [...(peeks ?? [])];
    const existing = new Set(hints.map(hint => JSON.stringify(hint.slice(0, 5))));
    for (const hint of reviewedWordSpans(targets, spans)) {
      if (!existing.has(JSON.stringify(hint))) hints.push(hint);
    }
    return [id, kana, romaji, hints.sort((a, b) => a[1] - b[1]), translation, targets, japanese, spans];
  });
  return { source, cues: rows, ...(prepared && {
    wordIds: [...new Set(rows.flatMap(row => row[5].map(([id]) => id)))], supplementalCards,
  }) };
}

function storedPracticePrivilege(sql) {
  return sql`has_table_privilege(to_regclass('yomiru_subtitle_corpus.release_review'), 'SELECT')`;
}

export async function hasStoredPracticeReviews(sql) {
  const [{ available }] = await sql`SELECT ${storedPracticePrivilege(sql)} AS available`;
  return available;
}

export function currentStoredPractice(sql, videoId, source) {
  return sql`SELECT review.review_id, review.translation_id, review.vocabulary_revision,
        vocabulary.descriptor->>'sha256' AS active, review.practice->'prepared' = 'true'::jsonb
          AND review.practice->>'sourceRevision' = ${source}
          AND review.practice->>'translationId' = review.translation_id AS prepared
      FROM yomiru_incremental_vocabulary AS vocabulary
      JOIN yomiru_practice_context_title AS context ON context.video_id = vocabulary.video_id
        AND context.source_revision = ${source}
      JOIN yomiru_incremental_track_video AS binding ON binding.video_id = vocabulary.video_id
      JOIN yomiru_incremental_track AS track ON track.id = binding.track_id
      JOIN yomiru_subtitle_corpus.translation AS translation ON translation.source_revision = context.source_revision
      JOIN yomiru_subtitle_corpus.release_review AS review ON review.translation_id = translation.id
        AND review.video_id = vocabulary.video_id
      WHERE vocabulary.video_id = ${videoId}
        AND translation.source_revision = ${source} AND translation.language = 'eng'
        AND track.detail->>'lang' = 'eng' AND track.detail->>'superseded' IS DISTINCT FROM 'true'
        AND (translation.generation = track.detail->>'generation' OR (
          to_jsonb(context)->>'vocabulary_source_revision' = vocabulary.manifest_sha256
          AND review.practice->>'playbackTrackId' = translation.track_id
          AND ${matchesPracticeTrack(sql, sql`translation.track_id`)}
        ))
      ORDER BY track.ordinal DESC, (review.vocabulary_revision = vocabulary.descriptor->>'sha256') DESC,
        review.review_id LIMIT 1`;
}

export function reviewedPracticeTitles(sql, stored, bundled = bundledReviewedSources) {
  const bundledReview = sql`context.source_revision = ANY(${sql.array(bundled, 25)})`;
  return sql`SELECT selected.video_id
    FROM selected
    JOIN yomiru_practice_context_title AS context USING (video_id)
    JOIN yomiru_incremental_vocabulary AS vocabulary USING (video_id)
    ${stored ? sql`LEFT JOIN LATERAL
      (${currentStoredPractice(sql, sql`selected.video_id`, sql`context.source_revision`)}) AS review ON true` : sql``}
    WHERE vocabulary.anchor = context.anchor
      AND (vocabulary.manifest_sha256 IS NULL OR vocabulary.manifest_sha256 = ${practiceVocabularySource(sql)})
      AND ${stored ? sql`CASE WHEN review.review_id IS NOT NULL
        THEN review.prepared AND review.vocabulary_revision = review.active ELSE ${bundledReview} END` : bundledReview}`;
}

export async function readReviewedPracticeTitles(sql, publication, ids) {
  if (!ids.length) return new Set();
  const [{ available, stored }] = await sql`SELECT
    has_table_privilege(to_regclass('yomiru_practice_context_title'), 'SELECT') AS available,
    ${storedPracticePrivilege(sql)} AS stored`;
  if (!available) return new Set();
  const rows = await sql`
    WITH selected AS (
      SELECT unnest(${sql.array(ids, 25)}) AS video_id
      FROM yomiru_incremental_head WHERE singleton AND serving AND revision = ${publication}
    )
    ${reviewedPracticeTitles(sql, stored)}`;
  return new Set(rows.map(row => row.video_id));
}

export function createStoredPhraseReader() {
  const cache = new Map();
  return async (sql, request, episode, source) => {
    if (!await hasStoredPracticeReviews(sql)) return null;
    const [selected] = await sql`
      SELECT stored.* FROM yomiru_incremental_head AS head
      CROSS JOIN LATERAL (${currentStoredPractice(sql, episode.id, source)}) AS stored
      WHERE head.singleton AND head.serving AND head.revision = ${request.publication}`;
    if (!selected) return null;
    if (selected.vocabulary_revision !== selected.active) {
      throw new ReviewedPracticeUnavailable("Reviewed Practice needs the current vocabulary revision");
    }
    const key = selected.review_id;
    const cached = cache.get(key);
    if (cached) return cached;
    const [row] = await sql`SELECT practice FROM yomiru_subtitle_corpus.release_review
      WHERE video_id = ${episode.id} AND translation_id = ${selected.translation_id}
        AND vocabulary_revision = ${selected.vocabulary_revision} AND review_id = ${key}`;
    const practice = row?.practice;
    if (!practice?.prepared || practice.sourceRevision !== source || practice.translationId !== selected.translation_id) {
      throw new ReviewedPracticeUnavailable("Stored Practice review changed");
    }
    const archive = phraseArchive(source, { ...practice, cues: new Map(practice.cues.map(([id, ...fields]) => [id, fields])) });
    cache.set(key, archive);
    if (cache.size > archiveCacheSize) cache.delete(cache.keys().next().value);
    return archive;
  };
}

export function createArchivedPhraseReader(read, catalogue = manifest, readStored) {
  const load = createAnalysisReader(read, catalogue);
  return async (sql, request, rank) => {
    const episode = request.episodes[request.episodes.length - rank];
    if (!episode) return null;
    const [row] = await sql`
      SELECT ${practiceSourceRevisions(sql, { episodes: [episode] }, true)} AS revisions
      FROM yomiru_incremental_head WHERE singleton AND serving AND revision = ${request.publication}`;
    const [source] = row?.revisions ?? [];
    if (!source) return null;
    const stored = await readStored?.(sql, request, episode, source).catch(error => {
      if (error instanceof ReviewedPracticeUnavailable) throw error;
      throw new ReviewedPracticeUnavailable("Stored Practice review is unavailable", { cause: error });
    });
    if (stored) return stored;
    const descriptor = catalogue.phrases?.[source];
    if (!descriptor) return null;
    const { cues, prepared, supplementalCards, coverage } = await load(descriptor, "practice-cues", source).catch(error => {
      if (descriptor.prepared) throw new ReviewedPracticeUnavailable("Reviewed Practice is unavailable", { cause: error });
      throw error;
    });
    if (descriptor.prepared && !prepared) throw new ReviewedPracticeUnavailable("Reviewed Practice data changed");
    return phraseArchive(source, { cues, prepared, supplementalCards, coverage });
  };
}

export const readArchivedPhraseCues = createArchivedPhraseReader(
  (path, limit) => createPrivateSourceStore().read(path, limit), manifest, createStoredPhraseReader(),
);

function sourcesForCards(sourceIds, index, cards) {
  if (sourceIds.length === 1) return [[sourceIds[0], cards]];
  const selected = new Set(sourceIds);
  const candidates = new Map(sourceIds.map(id => [id, []]));
  for (const card of cards) {
    for (const position of index.words[card[0]] ?? []) {
      const id = index.sources[position];
      if (selected.has(id)) candidates.get(id).push(card);
    }
  }
  return [...candidates].filter(([, words]) => words.length)
    .sort((a, b) => b[1].length - a[1].length);
}

async function lookupGlosses(sql, words, names, revision) {
  const [{ valid, meanings, name_meanings }] = await sql`
    SELECT EXISTS (SELECT 1 FROM yomiru_incremental_head WHERE singleton AND serving AND revision = ${revision}) AS valid,
      coalesce((SELECT jsonb_object_agg(dictionary.id, jsonb_build_array(meaning.gloss, dictionary.detail->>'word'))
        FROM yomiru_incremental_dictionary AS dictionary
        CROSS JOIN LATERAL (
          SELECT btrim(value) AS gloss FROM jsonb_array_elements_text(dictionary.detail #> '{meanings,eng}')
            WITH ORDINALITY AS entry(value, position)
          WHERE length(btrim(value)) BETWEEN 1 AND 100 ORDER BY position LIMIT 1
        ) AS meaning WHERE dictionary.id = ANY(${sql.array(words, 25)})), '{}'::jsonb) AS meanings,
      ${names.length ? sql`coalesce((SELECT jsonb_agg(jsonb_build_array(name.ref, meaning.id, meaning.gloss, name.ref->>0))
        FROM jsonb_array_elements(${sql.json(names)}::jsonb) AS name(ref)
        CROSS JOIN LATERAL ${practiceNameMeaning(sql, sql`name.ref`)} AS meaning), '[]'::jsonb)`
        : sql`'[]'::jsonb`} AS name_meanings`;
  return { valid, meanings, nameMeanings: new Map(name_meanings.map(([ref, ...hint]) => [JSON.stringify(ref), hint])) };
}

export function createArchivedPracticeReader(read, catalogue = manifest) {
  const load = createAnalysisReader(read, catalogue);
  return async (sql, request, page) => {
    if (!page?.valid || (!page.cards.length && !page.reviews.length)) return page;
    const cards = [...page.cards, ...page.reviews];
    if (page.canonicalContext && !cards.some(card => card[10]?.some(example => !example[7]?.length))) return page;
    const [{ revisions }] = await sql`SELECT ${practiceSourceRevisions(sql, request, true)} AS revisions`;
    const available = revisions.filter(id => Object.hasOwn(catalogue.sources, id)).sort();
    if (!available.length) return page;
    const found = new Map();
    if (page.canonicalContext) {
      // Preserve the prompts used for subtitle timing and translation.
      const sources = new Set(available);
      for (const card of cards) {
        let hasPeeks = false;
        const examples = [];
        for (const example of card[10] ?? []) {
          const [key, kana, romaji] = example;
          const [revision, id] = key.split(":");
          let peeks;
          if (!example[7]?.length && sources.has(revision)) {
            const { cues } = await load(catalogue.sources[revision], "practice-cues", revision);
            const cue = cues.get(id);
            if (cue?.[0] === kana && cue[1] === romaji) peeks = cue[2];
          }
          if (peeks?.length) hasPeeks = true;
          examples.push({ example, peeks });
        }
        if (hasPeeks) found.set(card[0], examples);
      }
    } else {
      const index = available.length > 1 ? await load(catalogue.index, "practice-index") : null;
      // Broad selections open only as many archives as their current page needs.
      for (const [revision, candidates] of sourcesForCards(available, index, cards)) {
        const needed = candidates.filter(card => !found.has(card[0]));
        if (!needed.length) continue;
        const { words } = await load(catalogue.sources[revision], "practice-cues", revision);
        for (const card of needed) {
          const matches = words.get(card[0])?.filter(row => row.gloss === card[5]);
          if (matches?.length) found.set(card[0], matches);
        }
      }
    }
    if (!found.size) return page;
    const peekIds = new Set(), names = new Map();
    for (const examples of found.values()) {
      for (const { peeks } of examples) {
        for (const [ref] of peeks ?? []) {
          if (Array.isArray(ref)) names.set(JSON.stringify(ref), ref);
          else peekIds.add(ref);
        }
      }
    }
    const { valid, meanings, nameMeanings } = await lookupGlosses(sql, [...peekIds], [...names.values()], page.revision);
    if (!valid) return { ...page, valid };
    const enrich = card => {
      const examples = found.get(card[0])?.map(({ example, peeks }) => {
        const hints = (peeks ?? []).flatMap(([ref, ...spans]) => {
          const hint = Array.isArray(ref) ? nameMeanings.get(JSON.stringify(ref))
            : Object.hasOwn(meanings, ref) && [ref, ...meanings[ref]];
          if (!hint) return [];
          const [id, gloss, written] = hint;
          return id !== card[0] ? [[id, gloss, ...spans, written]] : [];
        });
        return hints.length ? [...example.slice(0, 7), hints] : example;
      });
      if (!examples) return card;
      const preferred = !page.canonicalContext && request.order === "subtitle" && card[10]?.[0];
      const contextual = preferred
        ? [examples.find(([cue]) => cue === preferred[0]) ?? preferred, ...examples.filter(([cue]) => cue !== preferred[0])]
        : examples;
      return [...card.slice(0, 10), contextual, ...card.slice(11)];
    };
    return { ...page, cards: page.cards.map(enrich), reviews: page.reviews.map(enrich) };
  };
}

let readProductionPractice;
export function addArchivedPractice(sql, request, page) {
  if (process.env.VERCEL_ENV !== "production" || process.env.YOMIRU_PRACTICE_CONTEXT === "0"
    || !page?.valid) return page;
  readProductionPractice ??= createArchivedPracticeReader((path, limit) => createPrivateSourceStore().read(path, limit));
  return readProductionPractice(sql, request, page);
}
