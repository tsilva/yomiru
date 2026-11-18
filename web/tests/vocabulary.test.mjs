import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import { combineVocabulary, exportVocabulary, csvCell, summarizeVocabulary } from "../src/vocabulary-export.mjs";
import { filterVocabulary, sortVocabulary, sortVocabularyByColumn, vocabularyCategory } from "../src/vocabulary-study.mjs";
import { validateVocabularyAsset, validateVocabularyIndex } from "../lib/vocabulary.mjs";
import { createHandler } from "../api/vocabulary.mjs";
import { createSelectionHandler } from "../api/vocabulary-selection.mjs";
import { writePublicationObject } from "../lib/admin-publication.mjs";
import { fixture as libraryFixture } from "./library-fixture.mjs";
import { storage } from "../lib/published-library.mjs";
import { retainPublishedVocabulary } from "../lib/publication-io.mjs";
import { loadShowEpisodes, showSelectionState, updateShowSelection } from "../src/show-selection.mjs";
import { browseFixture } from "./browse-fixture.mjs";
import { browseEpisodes } from "../lib/browse.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const word = (key, extra = {}) => ({ id: `ja-${hash(key)}`, word: "食べる", reading: "たべる", romaji: "taberu",
  pos: "動詞/一般", forms: ["食べ"], count: 2, meanings: { eng: ["to eat"] },
  examples: [{ cue: "c00001", start: 1200, japanese: "パンを食べた。" }], ...extra });
function fixture(n, words) {
  const document = { version: 1, anchor: hash(`source-${n}`), analysis: "test", words, dictionary: null };
  const bytes = Buffer.from(JSON.stringify(document));
  const sha256 = hash(bytes);
  const descriptor = { videoIds: [`tt123:1:${n}`], anchor: document.anchor, sha256,
    bytes: bytes.length, words: words.length, path: `/library/${sha256}.vocabulary.json` };
  return { document, bytes, descriptor, episode: { id: `tt123:1:${n}`, show: "Synthetic show", season: 1,
    episode: n, vocabulary: descriptor, translations: [{ code: "eng", label: "English" }] } };
}
function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; }, end() { return this; } };
}

test("episode union deduplicates shared lexemes, adds occurrences and recomputes on deselection", () => {
  const a = fixture(1, [word("eat"), word("bread", { word: "パン" })]);
  const b = fixture(2, [word("eat"), word("today", { word: "今日" })]);
  const docs = new Map([[a.descriptor.sha256, a.document], [b.descriptor.sha256, b.document]]);
  const combined = combineVocabulary([a.episode, b.episode], docs);
  assert.equal(combined.length, 3);
  assert.equal(combined.find(w => w.id === word("eat").id).count, 4);
  assert.equal(combined.find(w => w.id === word("eat").id).episodes.length, 2);
  assert.equal(combineVocabulary([b.episode], docs).length, 2);
  assert.deepEqual(combineVocabulary([], docs), []);
});

test("missing English meanings never remove a word", () => {
  const a = fixture(1, [word("eat"), word("unknown", { meanings: {} })]);
  const docs = new Map([[a.descriptor.sha256, a.document]]);
  const words = combineVocabulary([a.episode], docs);
  assert.equal(words.length, 2);
  assert.equal(words.filter(w => !w.meanings.size).length, 1);
  assert.throws(() => combineVocabulary([a.episode], new Map()), /loading/);
});

test("vocabulary summary counts shared words and English coverage once", () => {
  const a = fixture(1, [word("eat"), word("bread"), word("window", { meanings: {} })]);
  const b = fixture(2, [word("eat", { meanings: { por: ["comer"] } }), word("bread"), word("unknown", { meanings: {} })]);
  const documents = new Map([[a.descriptor.sha256, a.document]]);
  assert.deepEqual(summarizeVocabulary(documents), { total: 3, covered: { eng: 2 } });

  documents.set(b.descriptor.sha256, b.document);
  assert.deepEqual(summarizeVocabulary(documents), { total: 4, covered: { eng: 2 } });
  documents.delete(a.descriptor.sha256);
  assert.deepEqual(summarizeVocabulary(documents), { total: 3, covered: { eng: 1 } });
  assert.deepEqual(summarizeVocabulary(new Map()), { total: 0, covered: {} });
});

test("study order uses selected counts and search matches readings, forms and meanings", () => {
  const bread = word("bread", { word: "パン", reading: "ぱん", romaji: "pan", forms: ["パン"],
    meanings: { eng: ["bread"], por: ["pão"] }, count: 6 });
  const eat = word("eat");
  const window = word("window", { word: "窓", reading: "まど", romaji: "mado", forms: ["窓"], meanings: {} });
  const a = fixture(1, [eat, bread, window]);
  const b = fixture(2, [{ ...eat, count: 5 }]);
  const docs = new Map([[a.descriptor.sha256, a.document], [b.descriptor.sha256, b.document]]);
  const first = sortVocabulary(combineVocabulary([a.episode], docs), "frequency");
  assert.equal(first[0].word, "パン");
  const all = sortVocabulary(combineVocabulary([a.episode, b.episode], docs), "frequency");
  assert.deepEqual(all.map(w => [w.word, w.count]), [["食べる", 7], ["パン", 6], ["窓", 2]]);
  const byReading = sortVocabulary(all, "reading");
  assert.deepEqual(byReading.map(w => w.word), ["食べる", "パン", "窓"]);
  assert.deepEqual(filterVocabulary(all, "タベル EAT").map(w => w.word), ["食べる"]);
  assert.deepEqual(filterVocabulary(all, "食べ").map(w => w.word), ["食べる"]);
  assert.deepEqual(filterVocabulary(all, "mado").map(w => w.word), ["窓"]);
  assert.deepEqual(filterVocabulary(all, "pao"), []);
  assert.deepEqual(filterVocabulary(all, "no match"), []);
  assert.equal(exportVocabulary(all).trim().split("\r\n").length, 4);
});

test("study filters use broad grammatical categories independently of missing meanings", () => {
  const a = fixture(1, [
    word("eat"),
    word("meal", { word: "食事", reading: "しょくじ", pos: "名詞/普通名詞", meanings: { eng: ["meal"] } }),
    word("particle", { word: "を", reading: "を", pos: "助詞/格助詞", meanings: {} }),
  ]);
  const words = combineVocabulary([a.episode], new Map([[a.descriptor.sha256, a.document]]));
  assert.deepEqual(filterVocabulary(words, "食", "Verb").map(w => w.word), ["食べる"]);
  assert.deepEqual(filterVocabulary(words, "食", "Noun").map(w => w.word), ["食事"]);
  assert.deepEqual(filterVocabulary(words, "", "Particle").map(w => w.word), ["を"]);
  assert.deepEqual(filterVocabulary(words, "meal", "Verb"), []);
  assert.equal(vocabularyCategory("名詞/固有名詞"), "Noun");
  assert.equal(vocabularyCategory("形状詞/一般"), "Adjective");
  assert.equal(vocabularyCategory("unknown"), "Other");
  assert.equal(exportVocabulary(words).trim().split("\r\n").length, 4);
});

test("column sorts preserve the frequency baseline for ties and leave missing values last", () => {
  const words = [
    { id: "eat", word: "食べる", reading: "たべる", meanings: ["to eat", "dine"], pos: "動詞", count: 9, writtenRank: 1 },
    { id: "bread", word: "パン", reading: "ぱん", meanings: ["bread", "loaf"], pos: "名詞", count: 4, writtenRank: 2 },
    { id: "window", word: "窓", reading: "まど", meanings: [], pos: "名詞", count: 4, writtenRank: null },
  ];
  for (const [column, direction, expected] of [
    ["category", "ascending", ["bread", "window", "eat"]],
    ["japanese", "descending", ["window", "bread", "eat"]],
    ["meaning", "ascending", ["bread", "eat", "window"]],
    ["otherMeanings", "descending", ["bread", "eat", "window"]],
    ["rank", "descending", ["bread", "eat", "window"]],
    ["frequency", "ascending", ["bread", "window", "eat"]],
  ]) {
    assert.deepEqual(sortVocabularyByColumn(words, "written", { column, direction }).map(w => w.id), expected);
  }
  assert.deepEqual(sortVocabularyByColumn(words, "frequency", { column: "rank", direction: "descending" })
    .map(w => w.id), ["window", "bread", "eat"]);
  assert.deepEqual(words.map(w => w.id), ["eat", "bread", "window"]);
});

test("desho finds an observed kana form and skips a match inside an English word", async () => {
  const copula = word("copula", { word: "です", reading: "です", romaji: "Desu", pos: "助動詞",
    forms: ["でしょう", "でしょ"], meanings: { eng: ["be"] } });
  const loop = word("loop", { word: "ループ", reading: "るーぷ", romaji: "Ru- pu", pos: "名詞",
    forms: ["ループ"], meanings: { eng: ["loop", "looping (of a video, slideshow, etc.)"] } });
  const asset = fixture(1, [copula, loop]);
  const { index, catalogue, publication } = browseFixture(1);
  const id = index.tracks[0].videoIds[0];
  index.vocabulary = [{ ...asset.descriptor, videoIds: [id] }];
  const handler = createSelectionHandler({
    readLibrary: async () => ({ index, catalogue, publication }),
    store: () => null,
    readVocabulary: async () => asset.document,
  });
  const study = response();
  await handler({ method: "POST", body: { mode: "study", episodes: [{ id, revision: asset.descriptor.sha256 }] } }, study);
  assert.equal(study.statusCode, 200);
  for (const query of ["desho", "deshō", "deshou", "desho be", "でしょう"]) {
    assert.deepEqual(filterVocabulary(study.body.words, query).map(w => w.word), ["です"], query);
  }
  assert.deepEqual(filterVocabulary(study.body.words, "slide").map(w => w.word), ["ループ"]);
  assert.deepEqual(filterVocabulary(study.body.words, "loopi").map(w => w.word), ["ループ"]);
  assert.deepEqual(filterVocabulary(study.body.words, ".*"), []);
});

test("written and spoken ranks drive study and CSV without changing selected counts", async () => {
  const verb = "動詞/非自立可能";
  const see = word(JSON.stringify(["見る", "ミル", verb]),
    { word: "見る", reading: "みる", pos: verb, count: 1 });
  const doWord = word(JSON.stringify(["為る", "スル", verb]),
    { word: "為る", reading: "する", pos: verb, aliases: ["為る", "する"], count: 4 });
  const particle = word(JSON.stringify(["ね", "ネ", "助詞/終助詞"]),
    { word: "ね", reading: "ね", pos: "助詞/終助詞", count: 5 });
  const name = word("name", { word: "見る", reading: "みる", pos: "名詞/固有名詞", count: 9 });
  const unknown = word("unknown", { word: "架空未登録語", reading: "かくうみとうろくご", count: 12 });
  const asset = fixture(1, [see, particle, doWord, name, unknown]);
  const { index, catalogue, publication } = browseFixture(1);
  const id = index.tracks[0].videoIds[0];
  index.vocabulary = [{ ...asset.descriptor, videoIds: [id] }];
  const handler = createSelectionHandler({
    readLibrary: async () => ({ index, catalogue, publication }),
    store: () => null,
    readVocabulary: async () => asset.document,
  });
  const episodes = [{ id, revision: asset.descriptor.sha256 }];
  const study = response();
  await handler({ method: "POST", body: { mode: "study", episodes } }, study);
  assert.equal(study.statusCode, 200);
  assert.deepEqual(study.body.words.map(w => [w.id, w.count, w.writtenRank, w.spokenRank]), [
    [unknown.id, 12, null, null], [name.id, 9, null, null], [particle.id, 5, 57, 16],
    [doWord.id, 4, 9, 8], [see.id, 1, 38, 38],
  ]);
  for (const [order, expected, sort] of [
    ["written", [doWord.id, see.id, particle.id, unknown.id, name.id]],
    ["spoken", [doWord.id, particle.id, see.id, unknown.id, name.id]],
    ["written", [see.id, doWord.id, particle.id, name.id, unknown.id], { column: "frequency", direction: "ascending" }],
    ["spoken", [see.id, particle.id, doWord.id, unknown.id, name.id], { column: "rank", direction: "descending" }],
  ]) {
    const words = sortVocabulary(study.body.words, order);
    assert.deepEqual((sort ? sortVocabularyByColumn(words, order, sort) : words).map(w => w.id), expected);
    const csv = Object.assign(new PassThrough(), response());
    delete csv.end;
    const chunks = [];
    csv.on("data", chunk => chunks.push(chunk));
    await handler({ method: "POST", body: { mode: "csv", episodes, order, sort } }, csv);
    assert.equal(csv.statusCode, 200);
    const rows = Buffer.concat(chunks).toString().trimEnd().split("\r\n").slice(1);
    assert.deepEqual(rows.map(row => row.split(",")[0]), expected);
  }
  const invalid = response();
  await handler({ method: "POST", body: { mode: "csv", episodes, sort: { column: "rank", direction: "invalid" } } }, invalid);
  assert.equal(invalid.statusCode, 400);
});

test("all-episode vocabulary includes unpaged episodes, excludes missing coverage and pins details", async () => {
  const { index, catalogue, publication } = browseFixture(32);
  index.tracks = index.tracks.filter(track => !track.videoIds.includes("tt1234567:1:1") || track.lang === "por");
  const a = fixture(1, [word("eat")]);
  const b = fixture(32, [word("eat"), word("bread", { word: "パン", meanings: { por: ["pão"] } })]);
  a.descriptor.videoIds = ["tt1234567:1:1"];
  b.descriptor.videoIds = ["tt1234567:1:32"];
  index.vocabulary = [a.descriptor, b.descriptor];
  const documents = new Map([[a.descriptor.sha256, a.document], [b.descriptor.sha256, b.document]]);
  const handler = createSelectionHandler({
    readLibrary: async () => ({ index, catalogue, publication }),
    store: () => null,
    readVocabulary: async (_index, descriptor) => documents.get(descriptor.sha256),
  });
  const all = { scope: "all" };
  async function post(body, res = response()) {
    await handler({ method: "POST", body }, res);
    return res;
  }

  const summary = await post({ ...all, mode: "summary" });
  assert.equal(summary.statusCode, 200);
  assert.deepEqual(summary.body, {
    total: 2, covered: { eng: 1 }, publication, episodeCount: 2,
  });
  const episodes = [{ id: a.descriptor.videoIds[0], revision: a.descriptor.sha256 }];
  assert.deepEqual((await post({ mode: "summary", episodes })).body, { total: 1, covered: { eng: 1 } });
  assert.equal((await post({ ...all, mode: "summary", episodes })).statusCode, 400);
  assert.equal((await post({ ...all, mode: "study" })).statusCode, 400);
  assert.equal((await post({ ...all, mode: "study", publication: hash("stale") })).statusCode, 409);
  for (const mode of ["study", "csv"]) {
    assert.equal((await post({ mode, episodes, language: "por" })).statusCode, 400);
  }
  const portugueseEpisode = await post({ mode: "study", episodes, language: "eng" });
  assert.deepEqual(portugueseEpisode.body.words[0].meanings, ["to eat"]);

  const study = await post({ ...all, mode: "study", publication });
  assert.equal(study.statusCode, 200);
  assert.deepEqual(study.body.words.map(word => word.meanings), [["to eat"], []]);
  assert.deepEqual(study.body.words.map(({ id, count }) => [id, count]), [
    [a.document.words[0].id, 4], [b.document.words[1].id, 2],
  ]);
  const csv = Object.assign(new PassThrough(), response());
  delete csv.end;
  const chunks = [];
  csv.on("data", chunk => chunks.push(chunk));
  await post({ ...all, mode: "csv", publication }, csv);
  assert.equal(csv.statusCode, 200);
  const csvText = Buffer.concat(chunks).toString();
  assert.match(csvText, /meaning_eng/);
  assert.doesNotMatch(csvText, /pão/);
  assert.deepEqual(csvText.trimEnd().split("\r\n").slice(1).map(row => row.split(",")[0]),
    study.body.words.map(({ id }) => id));

  index.vocabulary = [];
  assert.deepEqual((await post({ ...all, mode: "summary" })).body,
    { total: 0, covered: {}, publication, episodeCount: 0 });
});

test("CSV retains Unicode, quotes fields and protects spreadsheet formula cells", () => {
  assert.equal(csvCell('A,"B"'), '"A,""B"""');
  assert.equal(csvCell("\n=HYPERLINK()"), '"\'\n=HYPERLINK()"');
  assert.equal(csvCell("=1+1"), "'=1+1");
  const a = fixture(1, [word("eat")]);
  const words = combineVocabulary([a.episode], new Map([[a.descriptor.sha256, a.document]]));
  const csv = exportVocabulary(words);
  assert.ok(csv.startsWith("\uFEFFvocabulary_id,japanese,"));
  assert.ok(csv.includes("食べる,たべる,taberu,to eat"));
  assert.equal(csv.trim().split("\r\n").length, 2);
  assert.ok(csv.includes(a.document.anchor));
});

test("vocabulary assets require matching checksum, count, anchor and unique word IDs", () => {
  const a = fixture(1, [word("eat")]);
  assert.deepEqual(validateVocabularyAsset(a.descriptor, a.bytes), a.document);
  assert.throws(() => validateVocabularyAsset({ ...a.descriptor, words: 2 }, a.bytes), /identity/);
  assert.throws(() => validateVocabularyAsset(a.descriptor, Buffer.from("{}")), /integrity/);
  const bad = fixture(2, [word("eat"), word("eat")]);
  assert.throws(() => validateVocabularyAsset(bad.descriptor, bad.bytes), /word/);
  const index = { vocabulary: [a.descriptor], tracks: [{ videoIds: a.descriptor.videoIds, anchor: a.document.anchor }] };
  validateVocabularyIndex(index);
  assert.throws(() => validateVocabularyIndex({ ...index, tracks: [...index.tracks,
    { videoIds: a.descriptor.videoIds, anchor: hash("other source") }] }), /different Japanese/);
});

test("public API is read-only and rejects stale selections, unavailable episodes and corrupt storage", async () => {
  const a = fixture(1, [word("eat")]);
  const readLibrary = async () => ({ index: { vocabulary: [a.descriptor] }, publication: hash("snapshot") });
  const handler = createHandler({ readLibrary, fetcher: async () => new Response(a.bytes) });
  const request = { method: "GET", query: { episode: a.episode.id, revision: a.descriptor.sha256 } };
  const ok = response(); await handler(request, ok); assert.equal(ok.statusCode, 200); assert.deepEqual(ok.body, a.document);
  for (const [change, status] of [[{ method: "POST" }, 405], [{ query: { ...request.query, revision: hash("stale") } }, 409],
    [{ query: { ...request.query, episode: "tt123:1:5" } }, 404], [{ query: { ...request.query, revision: [a.descriptor.sha256] } }, 400]]) {
    const res = response(); await handler({ ...request, ...change }, res); assert.equal(res.statusCode, status);
  }
  const broken = createHandler({ readLibrary, fetcher: async () => new Response("{}") });
  const failed = response(); await broken(request, failed); assert.equal(failed.statusCode, 503);
});

test("administrator uploads accept only validated immutable vocabulary documents", async () => {
  const a = fixture(1, [word("eat")]);
  const puts = [];
  await writePublicationObject({ path: a.descriptor.path, content: a.bytes.toString("base64") }, {
    head: async () => null, put: async (...args) => puts.push(args),
  });
  assert.equal(puts.length, 1);
  assert.equal(puts[0][2].allowOverwrite, false);
  const bytes = Buffer.from("{}");
  await assert.rejects(writePublicationObject({ path: `/library/${hash(bytes)}.vocabulary.json`, content: bytes.toString("base64") }, {
    head: async () => null, put: async () => assert.fail("No invalid upload"),
  }), /Invalid vocabulary/);
});

test("publication cannot commit missing or corrupt vocabulary and preserves the prior pointer", async () => {
  const a = fixture(1, [word("eat")]);
  const library = libraryFixture();
  a.descriptor.videoIds = library.index.tracks[0].videoIds;
  library.index.tracks[0].anchor = a.document.anchor;
  library.index.vocabulary = [a.descriptor];
  const snapshot = JSON.parse(library.bytes);
  snapshot.index = library.index;
  const bytes = Buffer.from(JSON.stringify(snapshot));
  const pointer = { version: 1, sha256: hash(bytes), path: `/library/snapshots/${hash(bytes)}.json` };
  let writes = 0;
  const payload = { path: storage.pointer, content: Buffer.from(JSON.stringify(pointer)).toString("base64") };
  for (const stored of [null, Buffer.from("corrupt")]) {
    await assert.rejects(writePublicationObject(payload, {
      head: async path => path === storage.pointer.slice(1) ? null : { size: library.index.tracks[0].bytes },
      put: async () => { writes += 1; },
      fetcher: async url => new URL(url).pathname === pointer.path ? new Response(bytes)
        : stored ? new Response(stored) : new Response(null, { status: 404 }),
    }), /vocabulary|Vocabulary/);
  }
  assert.equal(writes, 0);
});

test("a later subtitle publisher retains vocabulary only for the exact known Japanese source", () => {
  const a = fixture(1, [word("eat")]);
  const previous = { tracks: [{ videoIds: a.descriptor.videoIds, generation: hash("generation"), anchor: a.document.anchor }], vocabulary: [a.descriptor] };
  const incoming = { tracks: [{ videoIds: a.descriptor.videoIds, generation: hash("generation") }] };
  const retained = retainPublishedVocabulary(previous, incoming);
  assert.deepEqual(retained.vocabulary, [a.descriptor]);
  assert.equal(retained.tracks[0].anchor, a.document.anchor);
  assert.equal(incoming.vocabulary, undefined);
  assert.throws(() => retainPublishedVocabulary(previous, { tracks: [{ ...incoming.tracks[0], generation: hash("different") }] }), /source change/);
});

test("show selection includes unloaded episodes, supports individual exclusions and preserves other shows", () => {
  const rows = Array.from({ length: 65 }, (_, n) => ({ id: `tt123:1:${n + 1}`, vocabulary: n === 64 ? null : {} }));
  const other = { id: "tt456:1:1", vocabulary: {} };
  const initial = new Map([[other.id, other]]);
  const all = updateShowSelection(initial, rows, true);
  assert.equal(all.size, 65); // 64 selectable episodes plus the other show.
  assert.equal(showSelectionState(rows, all).checked, true);
  assert.equal(showSelectionState(rows, all).mixed, false);
  all.delete(rows[12].id);
  assert.equal(showSelectionState(rows, all).checked, false);
  assert.equal(showSelectionState(rows, all).mixed, true);
  const restored = updateShowSelection(all, rows, true);
  assert.equal(showSelectionState(rows, restored).checked, true);
  assert.deepEqual([...updateShowSelection(restored, rows, false).keys()], [other.id]);
  assert.equal(initial.size, 1);
  assert.equal(showSelectionState([rows[64]], initial).mixed, false);
});

test("show loader traverses every page independently of the visible search and rejects changed publications", async () => {
  const library = browseFixture(65);
  const requests = [];
  const fetcher = async url => {
    const query = new URL(url, "https://example.test").searchParams;
    requests.push(Object.fromEntries(query));
    return new Response(JSON.stringify(browseEpisodes(library, Object.fromEntries(query))), {
      headers: { "X-Yomiru-Publication": library.publication },
    });
  };
  const rows = await loadShowEpisodes("tt1234567", library.publication, { fetcher });
  assert.equal(rows.length, 65);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(query => query.show === "tt1234567" && !query.search));
  await assert.rejects(loadShowEpisodes("tt1234567", "changed", { fetcher }), /library changed/);
  await assert.rejects(loadShowEpisodes("tt1234567", library.publication, {
    fetcher: async () => new Response(JSON.stringify({ rows: [{ id: "tt7654321:1:1" }], nextCursor: null }), {
      headers: { "X-Yomiru-Publication": library.publication },
    }),
  }), /verify/);
});
