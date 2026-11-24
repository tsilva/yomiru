import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createChatHandler, readChat } from "../api/practice-chat.mjs";

const firstWord = { surface: "乗る", reading: "のる", meaning: "to board", romaji: "noru" };
const nextWord = { surface: "降りる", reading: "おりる", meaning: "to get off", romaji: "oriru" };
const first = { role: "user", content: "Can I use this for a train?", word: firstWord };
const reply = { role: "assistant", content: "Yes, you can use it for a train." };
const next = { role: "user", content: "How does this compare with that word?", word: nextWord };

function turn(word, messages) {
  return { context: { kind: "dictionary", word }, messages };
}

test("each Word Drill turn keeps its own dictionary context in a stable provider prefix", async () => {
  const sent = [];
  const handler = createChatHandler({
    env: { OPENROUTER_API_KEY: "synthetic", YOMIRU_OPENROUTER_CHAT_MODEL: "test/model" },
    async fetcher(_url, request) {
      sent.push(JSON.parse(request.body).messages);
      return Response.json({ choices: [{ message: { content: "PRACTICE\nExample reply." } }] });
    },
  });
  for (const body of [turn(firstWord, [first]), turn(nextWord, [first, reply, next])]) {
    const response = Object.assign(new EventEmitter(), {
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json() {},
    });
    await handler({ method: "POST", headers: { origin: "https://yomiru.example",
      host: "yomiru.example", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body }, response);
    assert.equal(response.statusCode, 200);
  }
  assert.deepEqual(sent[1].slice(0, sent[0].length), sent[0]);
  assert.match(sent[1][1].content, /乗る/);
  assert.doesNotMatch(sent[1][1].content, /降りる/);
  assert.deepEqual(sent[1][2], reply);
  assert.match(sent[1][3].content, /降りる/);
});

test("dictionary history rejects malformed and partially tagged exchanges", () => {
  assert.equal(readChat(turn(nextWord, [{ ...first, word: { surface: "乗る" } }, reply, next])), null);
  assert.equal(readChat(turn(nextWord, [{ role: first.role, content: first.content }, reply, next])), null);
  assert.ok(readChat(turn(nextWord, [next])));
});
