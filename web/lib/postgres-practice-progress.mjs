import { readArchivedPhraseCues, readReviewedPracticeTitles, ReviewedPracticeUnavailable } from "./archived-practice.mjs";
import { moviePositions } from "./browse.mjs";
import { mapBatches } from "./r2-publication.mjs";
import { reviewedPracticeWords, reviewedRosterInput } from "./reviewed-practice-words.mjs";
import { libraryGroupId } from "../src/library-episodes.mjs";

const movieGroups = new Map(moviePositions.map(({ id, name }) => [id, name]));

export async function readPostgresPracticeProgress(sql, publication, {
  readTitles = readReviewedPracticeTitles, readArchive = readArchivedPhraseCues,
} = {}) {
  let head;
  try {
    [head] = await sql`
      SELECT revision, revision = ${publication} AS valid, ARRAY(
        SELECT jsonb_build_object('id', id, 'type', detail->>'type')
        FROM yomiru_incremental_catalogue
        WHERE head.revision = ${publication} AND detail->>'unlisted' IS DISTINCT FROM 'true'
        ORDER BY id
      ) AS titles FROM yomiru_incremental_head AS head WHERE singleton AND serving`;
  } catch (error) {
    if (error.code === "42P01" && /yomiru_incremental_(head|catalogue)/.test(error.message)) return undefined;
    throw error;
  }
  if (!head) return undefined;
  if (!head.valid) return { revision: head.revision, valid: false };

  const supported = await readTitles(sql, publication, head.titles.map(({ id }) => id));
  const titles = head.titles.filter(({ id }) => supported.has(id));
  const archives = await mapBatches(titles, title => readArchive(sql, { publication, episodes: [title] }, 1));
  const rosters = titles.flatMap(({ id }, index) => archives[index]?.wordIds
    ? [reviewedRosterInput(id, archives[index])] : []);
  const [result] = await sql`
    SELECT revision, revision = ${publication} AS valid,
      CASE WHEN revision = ${publication} THEN ARRAY(
        SELECT jsonb_build_array(video_id, word_id, reading_key, meaning_keys)
        FROM (${reviewedPracticeWords(sql, rosters)}) AS words ORDER BY video_id, word_id
      ) END AS words FROM yomiru_incremental_head WHERE singleton AND serving`;
  if (!result?.valid) return { revision: result?.revision, valid: false };
  if (rosters.length !== titles.length) throw new ReviewedPracticeUnavailable("Reviewed vocabulary progress is unavailable");

  const groupFor = new Map(titles.map(title => [title.id,
    libraryGroupId({ ...title, show: movieGroups.get(title.id) ?? "Other Movies" })]));
  const entries = new Map();
  const groups = new Map();
  const definitions = new Map();
  for (const [videoId, ...definition] of result.words) {
    const groupId = groupFor.get(videoId);
    const key = JSON.stringify(definition);
    if (!definitions.has(key)) definitions.set(key, definition);
    const word = definitions.get(key);
    if (!entries.has(videoId)) entries.set(videoId, []);
    if (!groups.has(groupId)) groups.set(groupId, new Set());
    entries.get(videoId).push(word);
    groups.get(groupId).add(word);
  }
  return { revision: result.revision, valid: true, scopes: [
    ...Array.from(entries, ([id, words]) => ["title", id, words]),
    ...Array.from(groups, ([id, words]) => ["group", id, words]),
    ["selection", "", definitions.values()],
  ] };
}
