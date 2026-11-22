import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { link, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { reviewedWordSpans } from "../lib/practice-original.mjs";
import { readPublic } from "../lib/publication-io.mjs";
import { mapBatches } from "../lib/r2-publication.mjs";
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
const digest = value => createHash("sha256").update(value).digest("hex");
const identity = value => digest(JSON.stringify(value));

function run(executable, args, input, { review = false } = {}) {
  const result = spawnSync(executable, args, { cwd: root, input, timeout: 90000, maxBuffer: limit });
  if (result.status !== 0) {
    const diagnostic = review && result.stderr?.toString().match(/^Review rejected: (.*)$/m)?.[1];
    throw new Error(diagnostic || `${path.basename(executable)} failed preparing the episode`);
  }
  return result.stdout;
}

function verifyRenditions(bundle, python, source, translation, subtitleReadings) {
  for (const item of bundle.index.tracks) {
    const ass = run(python, [path.join(root, "scripts/render-subtitle-corpus.py")],
      JSON.stringify({ source, translation, script: item.script, subtitleReadings, playbackReady: item.playbackReady }));
    if (!ass.equals(bundle.assets.get(item.path))) throw new Error("Cue rendering differs from the staged subtitle");
  }
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

async function savedStage(directory, stage, key) {
  if (!directory) return null;
  const filename = path.join(directory, `${stage}-${key}`);
  try {
    const info = await lstat(filename);
    if (!info.isFile() || info.size > 4 * limit) throw new Error("Invalid episode checkpoint file");
    const bytes = await readFile(filename);
    const body = bytes.subarray(65);
    if (bytes[64] !== 10 || digest(body) !== bytes.toString("ascii", 0, 64)) {
      throw new Error(`Corrupt ${stage} checkpoint`);
    }
    return body;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

async function saveStage(directory, stage, key, body) {
  if (directory) await saveMatchFile(directory, `${stage}-${key}`, Buffer.concat([Buffer.from(`${digest(body)}\n`), body]));
}

async function toolingIdentity(python) {
  const version = run(python, ["-c", "import sys; from importlib.metadata import version; "
    + "print(sys.version, *(version(p) for p in ('yomiru', 'cutlet', 'fugashi', 'unidic-lite', 'jaconv')))"], undefined).toString();
  const files = ["uv.lock", "scripts/prepare-subtitle-corpus.py", "scripts/prepare-episode-review.py",
    "scripts/render-subtitle-corpus.py", "web/scripts/release-episode.mjs"];
  for (const name of (await readdir(path.join(root, "src/yomiru"))).sort()) {
    if (name.endsWith(".py")) files.push(`src/yomiru/${name}`);
  }
  return identity([process.version, version, await mapBatches(files, async name => [name, digest(await readFile(path.join(root, name)))])]);
}

function hasEpisode(index, bundle) {
  return bundle.index.tracks.every(item => index.tracks.some(old => old.id === item.id && !old.superseded))
    && (bundle.index.artwork ?? []).every(item => index.artwork?.some(old => old.videoId === item.videoId && old.sha256 === item.sha256));
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
    "prepare-review": reviewOutput, review, "matches-dir": matchesDir, "save-reviewed-matches": saveMatches,
    "resume-dir": resumeDirectory, "review-packet": packet, "baseline-packet": baseline,
    "verify-only": verifyOnly, preflight, artwork } = values;
  if (Boolean(reviewOutput) === Boolean(review) || (reviewOutput && (executor || values.executor || deployment))) {
    throw new Error("Choose --prepare-review for a private draft or --review for validation and release");
  }
  if (reviewOutput && saveMatches) throw new Error("Saving matches requires a completed review");
  if ([reviewOutput, dryRun, preflight, verifyOnly, packet].filter(Boolean).length > 1 || (baseline && !packet)) {
    throw new Error("Choose one episode operation; --baseline-packet requires --review-packet");
  }
  if ((dryRun || verifyOnly || packet) && (executor || values.executor || deployment)) {
    throw new Error("Local review and live verification do not use publishing executors");
  }
  const checkpoint = resumeDirectory && path.resolve(resumeDirectory);
  const reused = [];
  const started = performance.now();
  const timings = {};
  const matches = path.resolve(matchesDir ?? path.join(root, ".local/practice-matches"));
  const python = values.python ?? path.join(root, ".venv/bin/python");
  const staged = await stageEpisode(path.resolve(library), path.resolve(archive), manifest, { artwork });
  const { publicBundle: bundle } = staged;
  const { artwork: stagedArtwork, ...subtitleIndex } = bundle.index;
  const [track] = bundle.index.tracks;
  const [entry] = bundle.index.vocabulary;
  const [videoId] = track.videoIds;
  if (track.videoIds.length !== 1 || bundle.index.vocabulary.length !== 1
    || !["eng", "por"].includes(track.lang)
    || bundle.index.tracks.some(item => item.lang !== track.lang || item.generation !== track.generation)) {
    throw new Error("Release one video ID and one translation generation at a time");
  }
  const before = await readLive("/library/index.json?check=corpus-release");
  const alreadyLive = hasEpisode(before, bundle);
  if (verifyOnly && !alreadyLive) throw new Error("The exact staged tracks and artwork are not live");
  const active = before.vocabulary.find(item => item.videoIds.includes(videoId));
  const paired = await readFile(path.resolve(pairs));
  const reviewBytes = review && await readFile(path.resolve(review));
  const baseKey = checkpoint && identity([subtitleIndex, manifest, digest(paired), await toolingIdentity(python)]);
  const reviewedKey = checkpoint && reviewBytes && identity([baseKey, digest(reviewBytes)]);
  const savedReview = !packet && reviewedKey && await savedStage(checkpoint, "review", reviewedKey);
  const prior = savedReview && JSON.parse(savedReview);
  // After activation, the live dictionary can supply different definitions from
  // the exact vocabulary document the original review was compiled against.
  const { document: vocabulary, revision: vocabularyRevision } = alreadyLive && prior
    ? prior.vocabulary : await vocabularyFor(bundle, entry, active, before, videoId);
  const vocabularyKey = identity([vocabularyRevision, vocabulary]);
  timings.inputs = Math.round(performance.now() - started);
  const scratch = await mkdtemp(path.join(tmpdir(), "yomiru-corpus-release-"));
  try {
    const compileStart = performance.now();
    const file = name => path.join(scratch, name);
    const files = {
      "index.json": subtitleIndex,
      "archive-index.json": { [track.anchor]: path.resolve(archive, staged.manifest.path) },
      "pair-index.json": { [track.generation]: file("pairs.json") },
      [`${track.anchor}.json`]: vocabulary,
    };
    for (const [name, value] of Object.entries(files)) {
      await writeFile(file(name), JSON.stringify(value), { flag: "wx", mode: 0o600 });
    }
    const corpusKey = checkpoint && identity([baseKey, vocabularyKey]);
    let corpus = await savedStage(checkpoint, "corpus", corpusKey);
    if (corpus) {
      reused.push("corpus");
      await writeFile(file("corpus.json.gz"), corpus, { flag: "wx", mode: 0o600 });
    } else {
      await writeFile(file("pairs.json"), paired, { flag: "wx", mode: 0o600 });
      run(python, [path.join(root, "scripts/prepare-subtitle-corpus.py"),
        "--index", file("index.json"), "--archive-index", file("archive-index.json"),
        "--pair-index", file("pair-index.json"), "--assets", path.resolve(library),
        "--vocabularies", scratch, "--out", file("corpus.json.gz")]);
      corpus = await readFile(file("corpus.json.gz"));
      await saveStage(checkpoint, "corpus", corpusKey, corpus);
    }
    const { translations, sources } = JSON.parse(gunzipSync(corpus, { maxOutputLength: limit }));
    assert.equal(translations.length, 1);
    assert.equal(translations[0].provenance, "paired");
    const reviewArgs = [path.join(root, "scripts/prepare-episode-review.py"), file("corpus.json.gz"),
      file(`${track.anchor}.json`), vocabularyRevision];
    if (reviewOutput) {
      run(python, [...reviewArgs, "--draft", path.resolve(reviewOutput), "--matches-dir", matches], undefined, { review: true });
      return { videoId, review: "pending", cues: sources[0].cues.length, reused };
    }
    await writeFile(file("review.json"), reviewBytes, { flag: "wx", mode: 0o600 });
    if (packet) {
      run(python, [...reviewArgs, "--preview-review", file("review.json"), "--out", path.resolve(packet),
        ...(baseline ? ["--baseline-packet", path.resolve(baseline)] : [])], undefined, { review: true });
      return { videoId, packet: path.resolve(packet), focused: Boolean(baseline), reused };
    }
    const reviewedPath = file("reviewed-corpus.json");
    const shouldSaveMatches = saveMatches || (!dryRun && !verifyOnly && !preflight);
    const stagedMatches = file("reviewed-matches");
    let packed;
    let matchBytes;
    if (prior?.vocabularyKey === vocabularyKey) {
      reused.push("review");
      packed = Buffer.from(prior.packed, "base64");
      matchBytes = prior.match && Buffer.from(prior.match, "base64");
    } else {
      run(python, [...reviewArgs, "--review", file("review.json"), "--out", reviewedPath,
        ...((checkpoint || shouldSaveMatches) ? ["--matches-dir", stagedMatches] : [])], undefined, { review: true });
      packed = await readFile(reviewedPath);
      const { releaseReview } = JSON.parse(packed);
      if (releaseReview.practice && (checkpoint || shouldSaveMatches)) {
        matchBytes = await readFile(path.join(stagedMatches, `${releaseReview.reviewId}.json`));
      }
    }
    if (packed.length > limit) throw new Error("Reviewed episode exceeds the corpus transfer limit");
    const { releaseReview } = JSON.parse(packed);
    const questions = releaseReview.practice ? verifyPreparedPractice(releaseReview.practice, vocabulary) : 0;
    const subtitleReadings = releaseReview.practice?.subtitleReadings;
    if (subtitleReadings) {
      if (!bundle.index.tracks.some(item => item.script === "kana")) {
        throw new Error("Reviewed readings require a kana track");
      }
      verifyRenditions(bundle, python, sources[0], translations[0], subtitleReadings);
    }
    if (questions && shouldSaveMatches) {
      const name = `${releaseReview.reviewId}.json`;
      await saveMatchFile(matches, name, matchBytes);
    }
    if (checkpoint && !prior) await saveStage(checkpoint, "review", reviewedKey, Buffer.from(JSON.stringify({
      vocabularyKey, vocabulary: { document: vocabulary, revision: vocabularyRevision }, packed: packed.toString("base64"),
      ...(matchBytes && { match: matchBytes.toString("base64") }),
    })));
    timings.compileAndReplay = Math.round(performance.now() - compileStart);
    if (dryRun) return { valid: true, videoId, reviewId: releaseReview.reviewId, questions, reused, timings };

    if (!alreadyLive || preflight) {
      const publishStart = performance.now();
      if (!executor || !path.isAbsolute(executor)) throw new Error("Supply the approved absolute corpus executor");
      const admin = createAdminExecutor(values.executor, deployment);
      // Capture its protected cue output instead of logging subtitle text.
      const response = run(executor, [], packed).toString("utf8").split("\n")
        .filter(line => line.startsWith("YOMIRU_CORPUS ")).map(line => line.slice("YOMIRU_CORPUS ".length)).join("");
      const canonical = JSON.parse(Buffer.from(response, "base64").toString("utf8"));
      assert.equal(canonical.videoId, videoId);
      if (canonical.reviewId !== releaseReview.reviewId) throw new Error("Database did not confirm the reviewed episode");
      verifyRenditions(bundle, python, canonical.source, canonical.translation, subtitleReadings);
      const result = await uploadEpisode(staged, async body => {
        if (body.incremental?.action === "preflight-episode") {
          await mapBatches([...bundle.assets, [bundle.pointer.path, bundle.bytes]],
            ([asset, bytes]) => verifyUploadedObject(r2 + asset, bytes));
        }
        return admin(body);
      }, { reviewId: releaseReview.reviewId, preflight,
        readPublicObject: async (asset, size) => (await readPublic(r2 + asset, fetch, size))?.bytes });
      timings.preflightAndPublication = Math.round(performance.now() - publishStart);
      if (result.conflicts?.length) {
        throw new Error(`Episode preflight rejected ${videoId}: ${JSON.stringify(result.conflicts)}`);
      }
      if (preflight) return { ...result, videoId, questions, reused, timings };
    } else {
      reused.push("activation");
    }
    const verifyStart = performance.now();
    const live = await readLive(`/library/index.json?episode=${encodeURIComponent(videoId)}&check=${Date.now()}`);
    if (!hasEpisode(live, bundle)) {
      throw new Error("The exact released tracks and artwork are not visible in the live library");
    }
    const [{ subtitles }] = await Promise.all([
      readLive(`/subtitles/${track.type}/${videoId}.json?check=${Date.now()}`),
      mapBatches([...bundle.index.tracks, ...(stagedArtwork ?? [])],
        async item => {
          if (item.videoId) {
            const response = await fetch(origin + item.path, { method: "HEAD", redirect: "manual",
              signal: AbortSignal.timeout(15000) });
            if (response.status !== 307 || response.headers.get("location") !== r2 + item.path) {
              throw new Error("Public episode artwork does not resolve to the released asset");
            }
          }
          await verifyUploadedObject(r2 + item.path, bundle.assets.get(item.path));
        }),
    ]);
    if (!bundle.index.tracks.every(item => subtitles.some(result => result.lang === item.lang
      && new URL(result.url).pathname === item.path))) {
      throw new Error("Stremio discovery is missing the released track");
    }
    if (releaseReview.practice) await verifyLivePractice(videoId, live.revision, releaseReview.practice, sources[0]);
    timings.liveVerification = Math.round(performance.now() - verifyStart);
    return { valid: true, videoId, revision: live.revision, tracks: bundle.index.tracks.length, reused, timings,
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
    "resume-dir": { type: "string" }, "verify-only": { type: "boolean" }, preflight: { type: "boolean" },
    "review-packet": { type: "string" }, "baseline-packet": { type: "string" }, artwork: { type: "string" },
  } });
  console.log(JSON.stringify(await release(values)));
}
