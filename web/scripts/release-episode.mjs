import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { validateRegistryAsset, resolveVocabulary, validateVocabularyAsset } from "../lib/vocabulary.mjs";
import { toPracticeCard } from "../src/practice-deck.mjs";
import { nextEpisodeQuestion } from "../src/vocabulary-quiz.mjs";
import { stageEpisode, uploadEpisode } from "./upload-episode.mjs";
import { createAdminExecutor, verifyUploadedObject } from "./upload-library.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const origin = "https://yomiru.tsilva.eu";
const r2 = "https://assets.yomiru.tsilva.eu";
const limit = 16 * 1024 * 1024;

function run(executable, args, input) {
  const result = spawnSync(executable, args, { cwd: root, input, timeout: 90000, maxBuffer: limit });
  if (result.status !== 0) throw new Error(`${path.basename(executable)} failed preparing the episode`);
  return result.stdout;
}

async function readLive(resource, options) {
  const response = await fetch(origin + resource, { signal: AbortSignal.timeout(15000), cache: "no-store", ...options });
  if (!response.ok) throw new Error(`Live episode check returned HTTP ${response.status}`);
  return response.json();
}

async function vocabularyFor(bundle, entry, active, publication, videoId) {
  if (active?.anchor === entry.anchor) {
    const query = new URLSearchParams({ episode: videoId, revision: active.sha256,
      registry: publication.dictionaryRevision ?? publication.registry?.sha256 });
    return readLive(`/api/vocabulary?${query}`);
  }
  const document = validateVocabularyAsset(entry, bundle.assets.get(entry.path));
  const registry = bundle.index.registry;
  return resolveVocabulary(document, registry && validateRegistryAsset(registry, bundle.assets.get(registry.path)));
}

export async function verifyOpeningQuestion(videoId, publication) {
  let after;
  for (let page = 0; page < 8; page += 1) {
    const { cards: packed, next } = await readLive("/api/vocabulary-selection", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "practice-page", scope: "titles", titles: [videoId], order: "subtitle",
        publication, practice: { after } }),
    });
    const cards = packed.map(toPracticeCard);
    const question = nextEpisodeQuestion({ cards, fresh: cards, next },
      { turn: 0, seen: new Set(), retries: new Map(), forward: 0 });
    if (question?.example && question.choices.length === 4) return;
    if (!next) break;
    after = next;
  }
  throw new Error("Live Practice did not open a contextual question");
}

async function release(values) {
  const { "library-dir": library, "archive-dir": archive, "archive-manifest": manifest,
    pairs, "corpus-executor": executor, "dry-run": dryRun, deployment } = values;
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
  const vocabulary = await vocabularyFor(bundle, entry, active, before, videoId);
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
    const packed = gunzipSync(await readFile(file("corpus.json.gz")), { maxOutputLength: limit });
    const { translations, contexts } = JSON.parse(packed);
    assert.equal(translations.length, 1);
    assert.equal(translations[0].provenance, "paired");
    if (track.lang === "eng" && !contexts[0].examples.length) throw new Error("Episode has no contextual quiz examples");
    if (dryRun) return { valid: true, videoId, examples: contexts[0].examples.length };

    if (!executor || !path.isAbsolute(executor)) throw new Error("Supply the approved absolute corpus executor");
    // Capture its protected cue output instead of logging subtitle text.
    const response = run(executor, [], packed).toString("utf8").split("\n")
      .filter(line => line.startsWith("YOMIRU_CORPUS ")).map(line => line.slice("YOMIRU_CORPUS ".length)).join("");
    const canonical = JSON.parse(Buffer.from(response, "base64").toString("utf8"));
    assert.equal(canonical.videoId, videoId);
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
    if (track.lang === "eng") await verifyOpeningQuestion(videoId, live.revision);
    return { valid: true, videoId, revision: live.revision, tracks: bundle.index.tracks.length,
      ...(track.lang === "eng" && { practiceVerified: true }) };
  } finally {
    await rm(scratch, { recursive: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    "library-dir": { type: "string" }, "archive-dir": { type: "string" }, "archive-manifest": { type: "string" },
    "corpus-executor": { type: "string" }, pairs: { type: "string" }, python: { type: "string" },
    deployment: { type: "string" }, executor: { type: "string" }, "dry-run": { type: "boolean" },
  } });
  console.log(JSON.stringify(await release(values)));
}
