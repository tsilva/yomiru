import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { addFeedbackCue } from "../lib/feedback-cue.mjs";
import { createFeedbackLinks, feedbackContext, decorateSubtitles, renderedId } from "../lib/feedback-links.mjs";
import { createHandler as trackHandler } from "../api/track.mjs";
import { createHandler as feedbackHandler } from "../api/compatibility.mjs";
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
function data() {
  const result = fixture(); result.body = Buffer.from(syntheticAss);
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
  return { links: createFeedbackLinks(io), store: createCompatibilityStore(io), files };
}
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code=n; return this; },
  end(body) { this.body=body; }, send(body) { this.body=body; }, json(body) { this.body=body; } });
const release = requestRelease({ filename: "Synthetic.mkv" });
function context(d, r = release) {
  return feedbackContext(d.index, d.catalogue, "series", "tt1234567:1:1", d.index.tracks[0].id, r);
}

test("ASS cue lasts precisely three seconds and leaves original dialogue intact in both geometries", () => {
  for (const width of [1440,1920]) {
    const input = syntheticAss.replace("1440", String(width));
    const result = addFeedbackCue(Buffer.from(input), "Abcd1234_-xy").toString();
    assert(result.includes(input.slice(input.indexOf("[Events]"))));
    const events = result.split("\n").filter(s => s.startsWith("Dialogue: 10"));
    assert(events.length >= 7);
    assert(events.every(s => s.includes(",0:00:00.00,0:00:03.00,YomiruFeedbackV1,")));
    assert(result.includes("Please leave your feedback"));
    assert(result.includes("Scan or go to link for feedback"));
    assert(result.includes("yomiru.tsilva.eu/f/Abcd1234_-xy"));
    assert(!result.includes("Erai-raws"));
    assert.throws(() => addFeedbackCue(Buffer.from(result), "Abcd1234_-xy"));
  }
  assert(addFeedbackCue(Buffer.from(syntheticAss.replace("0:00:10.00", "0:00:01.00")), "Abcd1234_-xy").toString().includes("\\pos(110,68)"));
  assert.throws(() => addFeedbackCue(Buffer.from(syntheticAss), "bad{\\N}"));
});

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
  d.index.tracks[0].id = "f".repeat(64);
  assert.equal((await links.get(c.code)).group.id,c.group.id);
  assert.equal(await links.get("invalid"),null);
});

test("first asset request composes once; cache works independently; corrupt original is rejected", async () => {
  const d = data(), { links } = memory(), c = context(d); let reads=0, puts=0;
  const query = { trackId:d.index.tracks[0].id,code:c.code,type:"series",id:"tt1234567:1:1",filename:release.filename };
  const cache = { get: async () => null, put: async () => { puts++; } };
  const handler = trackHandler({ readLibrary: async()=>d, links, cache, read:async()=>{ reads++; return d.body; } });
  let result=response(); await handler({method:"GET",query},result);
  assert.equal(result.code,200); assert(result.body.includes("YomiruFeedbackV1"));
  assert.equal(reads,1); assert.equal(puts,1); assert(await links.get(c.code));
  const hit = trackHandler({links:{get:async()=>{throw Error("offline");}},cache:{get:async path=>`${storage.origin}/${path}`}});
  result=response(); await hit({method:"GET",query},result); assert.equal(result.code,307);
  const corrupt=trackHandler({links,cache,read:async()=>Buffer.from("corrupt")});
  result=response(); await corrupt({method:"GET",query},result); assert.equal(result.code,503);
  const unknown=response(); await handler({method:"GET",query:{...query,code:"Different123"}},unknown); assert.equal(unknown.code,404);
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
