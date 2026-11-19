import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createFeedbackLinks, feedbackContext, decorateSubtitles, renderedId, playbackVersion } from "../lib/feedback-links.mjs";
import { createHandler as trackHandler } from "../api/track.mjs";
import { createHandler as feedbackHandler } from "../api/compatibility.mjs";
import { createHandler as ratingHandler } from "../api/feedback.mjs";
import { createBlobRatings } from "../lib/subtitle-ratings.mjs";
import { createCompatibilityStore, requestRelease } from "../lib/compatibility.mjs";
import { storage } from "../lib/published-library.mjs";
import { fixture } from "./library-fixture.mjs";

export const syntheticAss = `[Script Info]
PlayResX: 1440
PlayResY: 1080
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,20,20,40,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,Original synthetic text.
`;
function data(ass = syntheticAss) {
  const result = fixture(); result.body = Buffer.from(ass);
  const t = result.index.tracks[0]; t.sha256 = createHash("sha256").update(result.body).digest("hex");
  t.path = `/library/${t.sha256}.ass`; t.bytes = result.body.length; return result;
}
function memory() {
  const files = new Map(); let count = 0;
  const io = { read: async path => files.has(path) ? structuredClone(files.get(path)) : null,
    write: async (path, state, etag) => {
      if ((files.get(path)?.etag || null) !== etag) return false;
      files.set(path, { state: structuredClone(state), etag: String(++count) }); return true;
    } };
  return { links: createFeedbackLinks(io), store: createCompatibilityStore(io), ratings: createBlobRatings(io), files };
}
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code=n; return this; },
  end(body) { this.body=body; }, send(body) { this.body=body; }, json(body) { this.body=body; } });
const release = requestRelease({ filename: "Synthetic.mkv" });
function context(d, r = release) {
  return feedbackContext(d.index, d.catalogue, "series", "tt1234567:1:1", d.index.tracks[0].id, r);
}

test("short links preserve historical revision, isolate source and mode identity, and never include voter tokens", async () => {
  const d = data(), { links } = memory(), c = context(d);
  await links.ensure(c); await links.ensure(c);
  assert.deepEqual(await links.get(c.code), c);
  assert.notEqual(context(d, requestRelease({ filename: "Different.mkv" })).code, c.code);
  assert.notEqual(context(d, null).code, c.code);
  const tracks = [{ id: d.index.tracks[0].id, url: "old" }];
  decorateSubtitles(tracks, d.index, "series", "tt1234567:1:1", release);
  assert.equal(tracks[0].id, renderedId(d.index.tracks[0].id,c.code));
  assert.equal(new URL(tracks[0].url).searchParams.get("filename"), "Synthetic.mkv");
  assert.equal(new URL(tracks[0].url).searchParams.get("v"), String(playbackVersion));
  assert.equal(tracks[0].id, createHash("sha256")
    .update(JSON.stringify([3, d.index.tracks[0].id, c.code])).digest("hex"));
  d.index.tracks[0].id = "f".repeat(64);
  assert.equal((await links.get(c.code)).group.id,c.group.id);
  assert.equal(await links.get("invalid"),null);
});

test("first asset request caches without a feedback cue; corrupt originals and old cache URLs are rejected", async () => {
  const d = data(), { links } = memory(), c = context(d); let reads=0, puts=0;
  const query = { trackId:d.index.tracks[0].id,code:c.code,type:"series",id:"tt1234567:1:1",filename:release.filename };
  const cache = { get: async () => null, put: async path => {
    assert.equal(path, `playback-tracks/v${playbackVersion}/${renderedId(query.trackId, c.code)}.ass`);
    puts++;
  } };
  const handler = trackHandler({ readLibrary: async()=>d, links, cache, read:async()=>{ reads++; return d.body; } });
  let result=response(); await handler({method:"GET",query},result);
  assert.equal(result.code,200); assert.deepEqual(result.body, d.body);
  assert.equal(reads,1); assert.equal(puts,1); assert(await links.get(c.code));
  const hit = trackHandler({links:{get:async()=>{throw Error("offline");}},cache:{get:async path=>`${storage.origin}/${path}`}});
  result=response(); await hit({method:"GET",query},result); assert.equal(result.code,307);
  const stale = trackHandler({ cache: { get: async () => `${storage.origin}/feedback-tracks/v3/old.ass` } });
  result=response(); await stale({method:"GET",query},result); assert.equal(result.code,503);
  const corrupt=trackHandler({links,cache,read:async()=>Buffer.from("corrupt")});
  result=response(); await corrupt({method:"GET",query},result); assert.equal(result.code,503);
  const unknown=response(); await handler({method:"GET",query:{...query,code:"Different123"}},unknown); assert.equal(unknown.code,404);
});

test("served learning tracks use nearby explicit anchors and preserve dialogue text and timing", async () => {
  const learning = "Dialogue: 0,0:00:10.00,0:00:12.00,Japanese,,0,0,0,,Koko de, yasumou.";
  const translation = "Dialogue: 0,0:00:10.20,0:00:12.00,English,,0,0,0,,{\\fs28}Let's rest,\\Nright here.";
  const positioned = "Dialogue: 0,0:00:12.00,0:00:14.00,English,,0,0,0,,{\\pos(100,100)}Keep this position.";
  const englishStyle = "Style: English,Arial,42,&H00FFE6A8,&H000000FF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,2.5,1,8,83,83";
  const japaneseStyle = "Style: Japanese,Arial,58,&H00B5EAFF,&H000000FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,83,83";
  for (const [width, height, bottomMargin, topMargin, learningY] of [
    [1440, 1080, 184, 900, 896],
    [1280, 720, 122, 601, 598],
  ]) {
    const ass = syntheticAss.replace("PlayResX: 1440", `PlayResX: ${width}`).replace("PlayResY: 1080", `PlayResY: ${height}`)
      .replace("[Events]", `${japaneseStyle},${bottomMargin},1\n${englishStyle},${topMargin},1\n[Events]`)
      + [learning, translation, positioned, ""].join("\n");
    const d = data(ass), { links } = memory(), c = context(d, null);
    const tracks = [{ id: d.index.tracks[0].id }];
    decorateSubtitles(tracks, d.index, "series", "tt1234567:1:1", null);
    const url = new URL(tracks[0].url);
    assert.equal(url.searchParams.get("code"), c.code);
    assert.equal(url.searchParams.get("v"), String(playbackVersion));
    const query = { trackId: d.index.tracks[0].id, ...Object.fromEntries(url.searchParams) };
    const cache = { get: async () => null, put: async (path, body) => {
      assert.equal(path, `playback-tracks/v${playbackVersion}/${tracks[0].id}.ass`);
      assert(body.includes(`\\pos(${width / 2},${learningY})`));
    } };
    const handler = trackHandler({ readLibrary: async () => d, links, cache, read: async () => d.body });
    const result = response();
    await handler({ method: "GET", query }, result);
    assert.equal(result.code, 200);
    assert.doesNotMatch(result.body.toString(), /YomiruFeedback|\/f\//);
    const output = result.body.toString().split("\n");
    assert.equal(output.filter(line => line.startsWith("Dialogue:")).length, 4);
    assert(output.includes(learning.replace(",,Koko", `,,{\\pos(${width / 2},${learningY})}Koko`)));
    assert(output.includes(translation.replace(",,{", `,,{\\pos(${width / 2},${topMargin})}{`)));
    assert(output.includes(positioned));
    assert(output.includes(`${japaneseStyle},${bottomMargin},1`));
    assert(output.includes(`${englishStyle},${topMargin},1`));
  }
});

test("uncached legacy tracks still render and a track-specific link cannot render a different mode", async () => {
  const d = data(), { links } = memory();
  const track = d.index.tracks[0];
  const hiragana = { ...track, id: "b".repeat(64), script: "hiragana" };
  d.index.tracks.push(hiragana);
  const current = context(d);
  const legacy = feedbackContext(d.index, d.catalogue, "series", "tt1234567:1:1", track.id, release, true);
  const handler = trackHandler({ readLibrary: async () => d, links, read: async () => d.body,
    cache: { get: async () => null, put: async () => {} } });
  const query = { trackId: track.id, type: "series", id: "tt1234567:1:1", filename: release.filename };
  const old = response();
  await handler({ method: "GET", query: { ...query, code: legacy.code, v: "3" } }, old);
  assert.equal(old.code, 200);
  assert.equal((await links.get(legacy.code)).trackId, undefined);
  await links.ensure(current);
  const mismatched = response();
  await handler({ method: "GET", query: { ...query, trackId: hiragana.id, code: current.code } }, mismatched);
  assert.equal(mismatched.code, 404);
});

test("feedback link selects only its exact source and retains the old revision after a library update", async () => {
  const d=data(), {links,store}=memory(), c=context(d); await links.ensure(c);
  await store.observe(c.group,release);
  await store.observe(c.group,requestRelease({filename:"Other.mkv"}));
  d.index.tracks[0].id="e".repeat(64);
  const handler=feedbackHandler({readLibrary:async()=>d,links,store});
  const headers={host:"yomiru.tsilva.eu",origin:"https://yomiru.tsilva.eu","content-type":"application/json"};
  let result=response(); await handler({method:"GET",query:{feedback:c.code},headers},result);
  assert.equal(result.code,200); assert.equal(result.body.groups[0].id,c.group.id);
  assert.equal(result.body.groups[0].releases.length,1); assert.equal(result.body.groups[0].releases[0].total,0);
  const body={type:c.episode.type,id:c.episode.id,groupId:c.group.id,releaseId:release.id,voter:"a".repeat(64),works:true,feedback:c.code};
  result=response(); await handler({method:"POST",query:{},headers,body},result); assert.equal(result.code,200);
  assert.equal(result.body.groups[0].releases[0].total,1);
  result=response(); await handler({method:"POST",query:{},headers,body:{...body,releaseId:requestRelease({filename:"Other.mkv"}).id}},result);
  assert.equal(result.code,400);
});

test("rating forms identify the exact track and only return the requesting browser’s rating", async () => {
  const d = data(), { links, ratings, files } = memory();
  d.catalogue.shows.tt1234567.videos = [{ id: "tt1234567:1:1", title: "Last Train" }];
  const original = d.index.tracks[0];
  const hiragana = { ...original, id: "b".repeat(64), script: "hiragana" };
  d.index.tracks.push(hiragana);
  const romajiLink = context(d);
  const hiraganaLink = feedbackContext(d.index, d.catalogue, "series", "tt1234567:1:1", hiragana.id, release);
  const legacy = feedbackContext(d.index, d.catalogue, "series", "tt1234567:1:1", original.id, release, true);
  assert.equal(new Set([romajiLink.code, hiraganaLink.code, legacy.code]).size, 3);
  await Promise.all([romajiLink, hiraganaLink, legacy].map(link => links.ensure(link)));
  const handler = ratingHandler({ links, ratings });
  const voter = "c".repeat(64);
  const headers = { host: "yomiru.tsilva.eu", origin: "https://yomiru.tsilva.eu", "content-type": "application/json" };
  async function call(link, { method = "GET", body, header = {}, form = "1" } = {}) {
    const result = response();
    await handler({ method, query: { code: link.code, form }, headers: { ...headers, ...header }, body }, result);
    return result;
  }
  const metadata = await call(romajiLink);
  assert.deepEqual(metadata.body, { title: "Synthetic show", detail: "Season 1, Episode 1 · Last Train",
    subtitles: "Yomiru · Rōmaji + English", rating: null });
  assert.equal((await call(hiraganaLink)).body.subtitles, "Yomiru · Hiragana + English");
  assert.equal((await call(legacy)).body.subtitles, "Yomiru · English");
  assert.equal((await call(legacy, { form: "0" })).headers.Location, `/compatibility?feedback=${legacy.code}`);

  const post = body => call(romajiLink, { method: "POST", body: { voter, ...body } });
  assert.equal((await post({ stars: 0 })).code, 400);
  assert.equal((await post({ stars: 4, comment: "x".repeat(1001) })).code, 400);
  assert.equal((await call(romajiLink, { method: "POST", body: { voter, stars: 4 },
    header: { origin: "https://example.test" } })).code, 403);
  assert.equal((await post({ stars: 4 })).code, 204);
  assert.deepEqual(await ratings.get(romajiLink.code, voter), { stars: 4, comment: "" });
  assert.equal((await post({ stars: 2, comment: "  Synthetic timing note.  " })).code, 204);
  const own = { header: { "x-yomiru-voter": voter } };
  assert.deepEqual((await call(romajiLink, own)).body.rating, { stars: 2, comment: "Synthetic timing note." });
  assert.equal((await call(romajiLink)).body.rating, null);
  assert.equal((await call(hiraganaLink, own)).body.rating, null);
  assert.equal((await call(romajiLink, { header: { "x-yomiru-voter": "d".repeat(64) } })).body.rating, null);
  assert(!JSON.stringify([...files.values()]).includes(voter));
});
