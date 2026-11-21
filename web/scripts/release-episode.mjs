import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { link, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { reviewedWordSpans } from "../lib/practice-original.mjs";
import { validateRegistryAsset, resolveVocabulary, validateVocabularyAsset } from "../lib/vocabulary.mjs";
import { toPracticeCard } from "../src/practice-deck.mjs";
import { nextPhraseQuestion } from "../src/vocabulary-quiz.mjs";
import { gradePracticeCard, masteryAt, practiceCards, practiceReviewDueAt, presentPracticeCard } from "../src/vocabulary-practice.mjs";
import { stageEpisode, uploadEpisode } from "./upload-episode.mjs";
import { createAdminExecutor, verifyUploadedObject } from "./upload-library.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const origin = "https://yomiru.tsilva.eu";
const r2 = "https://assets.yomiru.tsilva.eu";
const limit = 16 * 1024 * 1024;

function run(executable, args, input, { review = false } = {}) {
  const result = spawnSync(executable, args, { cwd: root, input, timeout: 90000, maxBuffer: limit });
  if (result.status !== 0) {
    const diagnostic = review && result.stderr?.toString().match(/^Review rejected: (.*)$/m)?.[1];
    throw new Error(diagnostic || `${path.basename(executable)} failed preparing the episode`);
  }
  return result.stdout;
}

async function readLive(resource, { withPublication, ...options } = {}) {
  const response = await fetch(origin + resource, { signal: AbortSignal.timeout(15000), cache: "no-store", ...options });
  if (!response.ok) throw new Error(`Live episode check returned HTTP ${response.status}`);
  const body = await response.json();
  return withPublication ? { ...body, valid: true, revision: response.headers.get("X-Yomiru-Publication") } : body;
}

async function saveMatchFile(directory, name, contents) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(path.join(directory, ".review-"));
  try {
    const source = path.join(temporary, name);
    const destination = path.join(directory, name);
    await writeFile(source, contents, { flag: "wx", mode: 0o600 });
    try {
      await link(source, destination);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!(await lstat(destination)).isFile() || !(await readFile(destination)).equals(contents)) {
        throw new Error("Saved Practice matches differ");
      }
    }
  } finally {
    await rm(temporary, { recursive: true });
  }
}

async function vocabularyFor(bundle, entry, active, publication, videoId) {
  if (active?.anchor === entry.anchor) {
    const query = new URLSearchParams({ episode: videoId, revision: active.sha256,
      registry: publication.dictionaryRevision ?? publication.registry?.sha256 });
    return { document: await readLive(`/api/vocabulary?${query}`), revision: active.sha256 };
  }
  const document = validateVocabularyAsset(entry, bundle.assets.get(entry.path));
  const registry = bundle.index.registry;
  return { document: resolveVocabulary(document, registry && validateRegistryAsset(registry, bundle.assets.get(registry.path))),
    revision: entry.sha256 };
}

function reviewedPhrases(practice) {
  return practice.cues.filter(row => row[5].length).map(([cue, kana, romaji, , translation, targets]) => ({
    cue: `${practice.sourceRevision}:${cue}`, kana, romaji, translation, targets,
    japanese: practice.coverage[cue].japanese, japaneseTargets: targets.map(target => target[6]),
  }));
}

function verifyPeeks(cue, expected, peeks) {
  const spans = new Set(peeks.map(span => JSON.stringify(span)));
  for (const span of expected) {
    if (!spans.has(JSON.stringify(span))) throw new Error(`Missing Practice word peek in ${cue} for ${span[0]}`);
  }
}

function verifyQuestions(phrases, cards) {
  let count = 0;
  for (const phrase of phrases) {
    for (const [index, [id, hs, he, rs, re, answers]] of phrase.targets.entries()) {
      const question = nextPhraseQuestion([phrase], cards, 0, index);
      const first = question?.choices.find(choice => choice.id === id);
      if (question?.word !== index || question.card.id !== id || first?.meaning !== answers[0]
        || !isDeepStrictEqual(question.example.slice(3, 7), [hs, he, rs, re])
        || !isDeepStrictEqual(question.choices.map(choice => choice.meaning).sort(), [...answers].sort())) {
        throw new Error(`Reviewed question cannot be reproduced in ${phrase.cue}`);
      }
      const shown = presentPracticeCard(question.card, undefined, "question", 1000);
      const outcome = { choices: question.choices.length, spaced: true, at: 1000 };
      const correct = gradePracticeCard(shown.word, shown.event, { ...outcome, correct: true });
      const missed = gradePracticeCard(shown.word, shown.event, { ...outcome, correct: false });
      const due = practiceReviewDueAt(correct);
      if (shown.event.wordId !== id || correct.id !== id || missed.id !== id
        || masteryAt(correct, 1000) <= 0 || masteryAt(missed, 1000) !== 0) {
        throw new Error(`Reviewed mastery credit differs in ${phrase.cue}`);
      }
      const reviewed = presentPracticeCard(question.card, correct, "review", due);
      const delayed = gradePracticeCard(reviewed.word, reviewed.event, { ...outcome, correct: true, review: true, at: due });
      if (!reviewed.event.due || reviewed.event.wordId !== id || delayed.id !== id
        || masteryAt(delayed, due) <= masteryAt(correct, due)) {
        throw new Error(`Delayed review credit differs in ${phrase.cue}`);
      }
      count++;
    }
  }
  return count;
}

export function verifyPreparedPractice(practice, vocabulary) {
  for (const [cue, , , peeks, , targets] of practice.cues) {
    verifyPeeks(cue, reviewedWordSpans(targets, practice.coverage[cue].spans), peeks);
  }
  const cards = new Map((practice.supplementalCards ?? []).map(row => [row[0], toPracticeCard(row)]));
  for (const card of practiceCards(vocabulary.words.filter(word => word.meanings?.eng?.length)
    .map(word => ({ ...word, meanings: word.meanings.eng })))) cards.set(card.id, card);
  const questions = verifyQuestions(reviewedPhrases(practice), [...cards.values()]);
  if (!questions) throw new Error("Reviewed episode has no playable questions");
  return questions;
}

export async function verifyLivePractice(videoId, publication, practice, source, read = readLive) {
  const expected = reviewedPhrases(practice);
  const authoredPeeks = new Map(practice.cues.map(([cue, , , peeks]) => [cue,
    peeks.filter(peek => peek.length === 7).map(([id, hs, he, rs, re, written, gloss]) =>
      [id, gloss, hs, he, rs, re, written])]));
  const cueTimes = new Map(source.cues.map(cue => [`${source.id}:${cue.id}`, cue.start]));
  const wordIds = new Set(expected.flatMap(phrase => phrase.targets.map(([id]) => id)));
  let after;
  let offset = 0;
  let questions = 0;
  do {
    const page = await read("/api/vocabulary-selection", {
      method: "POST", headers: { "Content-Type": "application/json" },
      withPublication: true,
      body: JSON.stringify({ mode: "practice-page", scope: "titles", titles: [videoId], order: "phrase",
        publication, practice: { after } }),
    });
    if (!page.valid || page.revision !== publication || !page.phrases?.length
      || (!after && (page.total !== wordIds.size || !isDeepStrictEqual(new Set(page.playableIds), wordIds)))) {
      throw new Error("Live Practice does not match the reviewed episode roster");
    }
    for (const phrase of page.phrases) {
      const wanted = expected[offset++];
      if (!wanted || phrase.time !== cueTimes.get(phrase.cue)
        || Object.keys(wanted).some(key => !isDeepStrictEqual(wanted[key], phrase[key]))) {
        throw new Error(`Live Practice differs from the reviewed cue at position ${offset}`);
      }
      const cue = phrase.cue.split(":")[1];
      const resolved = (phrase.peeks ?? []).flatMap(([id, gloss, hs, he, rs, re]) =>
        gloss?.trim() ? [[id, hs, he, rs, re]] : []);
      verifyPeeks(cue, reviewedWordSpans(phrase.targets, practice.coverage[cue].spans), resolved);
      verifyPeeks(cue, authoredPeeks.get(cue), phrase.peeks ?? []);
    }
    questions += verifyQuestions(page.phrases, page.cards.map(toPracticeCard));
    after = page.next;
  } while (after);
  if (offset !== expected.length) throw new Error("Live Practice ended before the last reviewed cue");
  return questions;
}

export async function release(values) {
  const { "library-dir": library, "archive-dir": archive, "archive-manifest": manifest,
    pairs, "corpus-executor": executor, "dry-run": dryRun, deployment,
    "prepare-review": reviewOutput, review, "matches-dir": matchesDir, "save-reviewed-matches": saveMatches } = values;
  if (Boolean(reviewOutput) === Boolean(review) || (reviewOutput && (executor || values.executor || deployment))) {
    throw new Error("Choose --prepare-review for a private draft or --review for validation and release");
  }
  if (reviewOutput && saveMatches) throw new Error("Saving matches requires a completed review");
  const matches = path.resolve(matchesDir ?? path.join(root, ".local/practice-matches"));
  const python = values.python ?? path.join(root, ".venv/bin/python");
  const staged = await stageEpisode(path.resolve(library), path.resolve(archive), manifest);
  const { publicBundle: bundle } = staged;
  const [track] = bundle.index.tracks;
  const [entry] = bundle.index.vocabulary;
  const [videoId] = track.videoIds;
  if (track.videoIds.length !== 1 || bundle.index.vocabulary.length !== 1
    || !["eng", "por"].includes(track.lang)
    || bundle.index.tracks.some(item => item.lang !== track.lang || item.generation !== track.generation)) {
    throw new Error("Release one video ID and one translation generation at a time");
  }
  const before = await readLive("/library/index.json?check=corpus-release");
  const active = before.vocabulary.find(item => item.videoIds.includes(videoId));
  const { document: vocabulary, revision: vocabularyRevision } = await vocabularyFor(bundle, entry, active, before, videoId);
  const scratch = await mkdtemp(path.join(tmpdir(), "yomiru-corpus-release-"));
  try {
    const file = name => path.join(scratch, name);
    const files = {
      "index.json": bundle.index,
      "archive-index.json": { [track.anchor]: path.resolve(archive, staged.manifest.path) },
      "pair-index.json": { [track.generation]: path.resolve(pairs) },
      [`${track.anchor}.json`]: vocabulary,
    };
    for (const [name, value] of Object.entries(files)) {
      await writeFile(file(name), JSON.stringify(value), { flag: "wx", mode: 0o600 });
    }
    run(python, [path.join(root, "scripts/prepare-subtitle-corpus.py"),
      "--index", file("index.json"), "--archive-index", file("archive-index.json"),
      "--pair-index", file("pair-index.json"), "--assets", path.resolve(library),
      "--vocabularies", scratch, "--out", file("corpus.json.gz")]);
    const { translations, sources } = JSON.parse(gunzipSync(await readFile(file("corpus.json.gz")), { maxOutputLength: limit }));
    assert.equal(translations.length, 1);
    assert.equal(translations[0].provenance, "paired");
    const reviewArgs = [path.join(root, "scripts/prepare-episode-review.py"), file("corpus.json.gz"),
      file(`${track.anchor}.json`), vocabularyRevision];
    if (reviewOutput) {
      run(python, [...reviewArgs, "--draft", path.resolve(reviewOutput), "--matches-dir", matches], undefined, { review: true });
      return { videoId, review: "pending", cues: sources[0].cues.length };
    }
    const reviewedPath = file("reviewed-corpus.json");
    const shouldSaveMatches = saveMatches || !dryRun;
    const stagedMatches = file("reviewed-matches");
    run(python, [...reviewArgs, "--review", path.resolve(review), "--out", reviewedPath,
      ...(shouldSaveMatches ? ["--matches-dir", stagedMatches] : [])], undefined, { review: true });
    const packed = await readFile(reviewedPath);
    if (packed.length > limit) throw new Error("Reviewed episode exceeds the corpus transfer limit");
    const { releaseReview } = JSON.parse(packed);
    const questions = releaseReview.practice ? verifyPreparedPractice(releaseReview.practice, vocabulary) : 0;
    if (questions && shouldSaveMatches) {
      const name = `${releaseReview.reviewId}.json`;
      await saveMatchFile(matches, name, await readFile(path.join(stagedMatches, name)));
    }
    if (dryRun) return { valid: true, videoId, reviewId: releaseReview.reviewId, questions };

    if (!executor || !path.isAbsolute(executor)) throw new Error("Supply the approved absolute corpus executor");
    // Capture its protected cue output instead of logging subtitle text.
    const response = run(executor, [], packed).toString("utf8").split("\n")
      .filter(line => line.startsWith("YOMIRU_CORPUS ")).map(line => line.slice("YOMIRU_CORPUS ".length)).join("");
    const canonical = JSON.parse(Buffer.from(response, "base64").toString("utf8"));
    assert.equal(canonical.videoId, videoId);
    if (canonical.reviewId !== releaseReview.reviewId) throw new Error("Database did not confirm the reviewed episode");
    for (const item of bundle.index.tracks) {
      const ass = run(python, [path.join(root, "scripts/render-subtitle-corpus.py")],
        JSON.stringify({ source: canonical.source, translation: canonical.translation, script: item.script }));
      if (!ass.equals(bundle.assets.get(item.path))) throw new Error("Database cues render a different subtitle revision");
      bundle.assets.set(item.path, ass);
    }
    const alreadyLive = bundle.index.tracks.every(item => before.tracks.some(old => old.id === item.id && !old.superseded));
    if (!alreadyLive) {
      const admin = createAdminExecutor(values.executor, deployment);
      await uploadEpisode(staged, async body => {
        if (body.incremental?.action === "publish") {
          for (const [asset, bytes] of bundle.assets) await verifyUploadedObject(r2 + asset, bytes);
          await verifyUploadedObject(r2 + bundle.pointer.path, bundle.bytes);
        }
        return admin(body);
      });
    }
    const live = await readLive(`/library/index.json?episode=${encodeURIComponent(videoId)}&check=${Date.now()}`);
    if (!bundle.index.tracks.every(item => live.tracks.some(old => old.id === item.id && !old.superseded))) {
      throw new Error("The episode release is not visible in the live library");
    }
    for (const item of bundle.index.tracks) await verifyUploadedObject(r2 + item.path, bundle.assets.get(item.path));
    const { subtitles } = await readLive(`/subtitles/${track.type}/${videoId}.json?check=${Date.now()}`);
    if (!bundle.index.tracks.every(item => subtitles.some(result => result.lang === item.lang
      && new URL(result.url).pathname === `/track/${item.id}.ass`))) {
      throw new Error("Stremio discovery is missing the released track");
    }
    if (releaseReview.practice) await verifyLivePractice(videoId, live.revision, releaseReview.practice, sources[0]);
    return { valid: true, videoId, revision: live.revision, tracks: bundle.index.tracks.length,
      reviewId: releaseReview.reviewId, ...(releaseReview.practice && { practiceVerified: true, questions }) };
  } finally {
    await rm(scratch, { recursive: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    "library-dir": { type: "string" }, "archive-dir": { type: "string" }, "archive-manifest": { type: "string" },
    "corpus-executor": { type: "string" }, pairs: { type: "string" }, python: { type: "string" },
    deployment: { type: "string" }, executor: { type: "string" }, "dry-run": { type: "boolean" },
    "prepare-review": { type: "string" }, review: { type: "string" },
    "matches-dir": { type: "string" }, "save-reviewed-matches": { type: "boolean" },
  } });
  console.log(JSON.stringify(await release(values)));
}
