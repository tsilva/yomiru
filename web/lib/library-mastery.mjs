import { BrowseError, browseSelection, libraryRows } from "./browse.mjs";
import { mapBatches } from "./r2-publication.mjs";
import { libraryGroupId } from "../src/library-episodes.mjs";
import { practiceCards } from "../src/vocabulary-practice.mjs";
import { masteryBatchSize } from "../src/library-mastery.mjs";
import { vocabularyCacheKey } from "../src/vocabulary-export.mjs";

const titleId = /^[A-Za-z0-9_.:-]{1,200}$/;

export function readMasteryRequest(input, publicRead) {
  const { publication, titles = [], groups = [], selection } = input;
  if (typeof publication !== "string" || !/^[a-f0-9]{64}$/.test(publication)) return null;
  const readList = (value, limit) => {
    const list = publicRead && typeof value === "string" ? value.split(",") : value;
    return Array.isArray(list) && list.length <= limit && new Set(list).size === list.length
      && list.every(id => typeof id === "string" && id.length > 0 && id.length <= 200) ? list : null;
  };
  const titleIds = readList(titles, masteryBatchSize);
  const groupIds = readList(groups, masteryBatchSize);
  if (!titleIds?.every(id => titleId.test(id)) || !groupIds) return null;
  try {
    if (groupIds.some(show => browseSelection(null, { show }).show !== show)) return null;
  } catch (error) {
    if (error instanceof BrowseError) return null;
    throw error;
  }
  if (selection !== undefined && selection !== "all" && (publicRead || !Array.isArray(selection)
    || !selection.length || !readList(selection, 10_000) || !selection.every(id => titleId.test(id)))) return null;
  if (!titleIds.length && !groupIds.length && selection === undefined) return null;
  return { publication, titles: titleIds, groups: groupIds, selection };
}

// Refer to each public word ID once even when it belongs to many requested scopes.
export function packMastery(scopes) {
  const ids = new Map();
  const packed = scopes.map(([kind, scope, words]) => [kind, scope, Array.from(words, id => {
    if (!ids.has(id)) ids.set(id, ids.size);
    return ids.get(id);
  })]);
  return { words: [...ids.keys()], scopes: packed };
}

export async function readSnapshotMastery(library, request, readVocabulary, store) {
  const { index, catalogue, publication: revision } = library;
  if (revision !== request.publication) return { revision, valid: false };
  const titles = new Set(request.titles), groups = new Set(request.groups);
  const selected = new Set(Array.isArray(request.selection) ? request.selection : []);
  const all = request.selection === "all";
  const rows = libraryRows(index, catalogue).filter(row => row.vocabulary
    && (all || titles.has(row.id) || selected.has(row.id) || groups.has(libraryGroupId(row))));
  const descriptors = new Map(rows.map(row => [vocabularyCacheKey(row.vocabulary), row.vocabulary]));
  const stored = rows.length && store && await store.documents(revision, rows.map(row => row.id));
  const documents = stored ? new Map(rows.map(row => [vocabularyCacheKey(row.vocabulary), stored.get(row.id)]))
    : new Map(await mapBatches([...descriptors], async ([key, descriptor]) =>
      [key, await readVocabulary(index, descriptor)]));
  const playable = new Map([...documents].map(([key, document]) => [key, practiceCards(document.words.map(word => ({
    ...word, meanings: word.meanings.eng ?? [],
  }))).map(card => card.id)]));
  const byGroup = new Map(request.groups.map(id => [id, new Set()]));
  const bySelection = new Set();
  const scopes = [];
  for (const row of rows) {
    const words = playable.get(vocabularyCacheKey(row.vocabulary));
    if (titles.has(row.id)) scopes.push(["title", row.id, words]);
    const group = byGroup.get(libraryGroupId(row));
    if (group) for (const id of words) group.add(id);
    if (all || selected.has(row.id)) for (const id of words) bySelection.add(id);
  }
  for (const [id, words] of byGroup) scopes.push(["group", id, words]);
  if (request.selection !== undefined) scopes.push(["selection", "", bySelection]);
  return { revision, valid: true, scopes };
}
