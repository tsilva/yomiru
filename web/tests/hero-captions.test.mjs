import assert from "node:assert/strict";
import test from "node:test";
import { heroCaptions, heroFrameAt, heroLoopDuration } from "../src/hero-captions.mjs";

test("subtitles enter and leave together with a minimal gap between cues", () => {
  assert.equal(heroFrameAt(0).caption, heroCaptions[0]);
  assert.equal(heroFrameAt(3799).caption, heroCaptions[0]);
  assert.deepEqual(heroFrameAt(3800), { caption: null, nextChange: 100 });
  assert.equal(heroFrameAt(3899).caption, null);
  assert.equal(heroFrameAt(3900).caption, heroCaptions[1]);
});

test("a complete scene visits every cue in order and rolls over after the same minimal gap", () => {
  const seen = [];
  let elapsed = 0;
  while (elapsed < heroLoopDuration) {
    const frame = heroFrameAt(elapsed);
    assert(frame.nextChange > 0);
    if (frame.caption) seen.push(frame.caption.reading);
    elapsed += frame.nextChange;
  }
  assert.deepEqual(seen, heroCaptions.map(cue => cue.reading));
  assert.deepEqual(heroFrameAt(22500), { caption: null, nextChange: 100 });
  assert.equal(heroFrameAt(22599).caption, null);
  assert.equal(heroFrameAt(22600).caption, heroCaptions[0]);
});

test("every transition is 100ms while subtitle reading durations stay unchanged", () => {
  assert.deepEqual(heroCaptions.map(cue => cue.end - cue.start), [3800, 3400, 3800, 3400, 4000, 3600]);
  for (let i = 0; i < heroCaptions.length; i++) {
    assert.equal((heroCaptions[i + 1]?.start ?? heroLoopDuration) - heroCaptions[i].end, 100);
  }
});

test("delayed callbacks retain the scene position across multiple loops", () => {
  assert.deepEqual(heroFrameAt(3 * heroLoopDuration + 8700), heroFrameAt(8700));
  assert.equal(heroFrameAt(-1).caption, heroCaptions[0]);
  for (let i = 0; i < heroCaptions.length; i++) {
    const cue = heroCaptions[i];
    assert(cue.end > cue.start);
    assert(cue.end <= (heroCaptions[i + 1]?.start ?? heroLoopDuration));
    assert(cue.japanese && cue.reading && cue.meaning);
  }
});
