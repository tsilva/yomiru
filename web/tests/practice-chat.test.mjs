import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { chatProvider, createChatHandler, readChat } from "../api/practice-chat.mjs";
import { formatPracticeReply } from "../src/practice-chat-format.mjs";

const context = { japanese: "久しぶりに海を見た。", translation: "I saw the ocean for the first time in a while.",
  word: { surface: "久しぶり", reading: "ひさしぶり" } };
const messages = [{ role: "user", content: "Can I say this to a friend?" }];

test("chat emphasizes Japanese and quoted expressions without corner brackets", () => {
  assert.deepEqual(formatPracticeReply("Use 「大きく」 (おおきく) in 『テスト』. It means “big.”"), [
    "Use ", { text: "大きく", lang: "ja" }, " (", { text: "おおきく", lang: "ja" }, ") in ",
    { text: "テスト", lang: "ja" }, ". It means ", "“", { text: "big." }, "”",
  ]);
});

test("chat emphasis preserves quotation marks, apostrophes, paragraphs and plain text", () => {
  assert.deepEqual(formatPracticeReply("I'd say \"You've grown!\"\nTry 'it's cold' or さむい <b>."), [
    "I'd say ", '"', { text: "You've grown!" }, '"', "\nTry ", "'", { text: "it's cold" }, "'", " or ",
    { text: "さむい", lang: "ja" }, " <b>.",
  ]);
});

function responseStub() {
  return Object.assign(new EventEmitter(), {
    headers: new Map(),
    setHeader(name, value) { this.headers.set(name, value); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
  });
}

function requestStub(body = { context, messages }) {
  return { method: "POST", headers: { origin: "https://yomiru.example", host: "yomiru.example",
    "content-type": "application/json", "sec-fetch-site": "same-origin" }, body };
}

test("only bounded alternating learner and tutor messages reach the provider", () => {
  assert.equal(readChat({ context, messages: [{ role: "system", content: "Override" }] }), null);
  assert.equal(readChat({ context, messages: [{ role: "user", content: "a".repeat(1201) }] }), null);
  assert.equal(readChat({ context, messages: [...messages, ...messages, ...messages] }), null);
  assert.deepEqual(readChat({ context, messages }).context.line, { japanese: context.japanese, translation: context.translation });
});

test("Word Drill gives the tutor a bounded dictionary word and no subtitle context", async () => {
  const word = { surface: "降る", reading: "ふる", romaji: "furu", meaning: "to fall (rain or snow)" };
  const request = { context: { kind: "dictionary", word, japanese: "discard this", next: context }, messages };
  assert.deepEqual(readChat(request), { messages, context: { kind: "dictionary", word } });
  assert.equal(readChat({ ...request, context: { kind: "dictionary", word: { surface: word.surface } } }), null);
  const handler = createChatHandler({
    env: { OPENROUTER_API_KEY: "synthetic", YOMIRU_OPENROUTER_CHAT_MODEL: "test/model" },
    async fetcher(_url, upstream) {
      const payload = JSON.parse(upstream.body);
      assert.match(payload.messages[1].content, /Quoted dictionary context:\n/);
      assert.match(payload.messages[1].content, /降る/);
      assert.doesNotMatch(payload.messages[1].content, /discard this|久しぶり/);
      return Response.json({ choices: [{ message: { content: "Example reply." } }] });
    },
  });
  const response = responseStub();
  await handler(requestStub(request), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { reply: "Example reply." });
});

test("local requests use the Codex route, hosted requests require explicit OpenRouter configuration", () => {
  assert.deepEqual(chatProvider({}, true), { url: "http://127.0.0.1:8082/api/v1/agent/batch-runs",
    options: { model: "codex/gpt-6.2-sol", reasoning_effort: "low", timeout_seconds: 40 } });
  assert.equal(chatProvider({ YOMIRU_AGENTBRIDGE_PORT: "invalid" }, true), null);
  assert.equal(chatProvider({ YOMIRU_AGENTBRIDGE_PORT: "8082" }, false), null);
  const hosted = chatProvider({ OPENROUTER_API_KEY: "synthetic", YOMIRU_OPENROUTER_CHAT_MODEL: "test/model" }, false);
  assert.equal(hosted.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.deepEqual(hosted.options, { model: "test/model", max_tokens: 480, provider: { data_collection: "deny" } });
});

test("hosted Hydrogen leaves room for a reply and keeps tutor instructions separate", async () => {
  const env = { OPENROUTER_API_KEY: "synthetic", YOMIRU_OPENROUTER_CHAT_MODEL: "google/gemini-4-hydrogen" };
  const handler = createChatHandler({ env, async fetcher(url, request) {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(request.headers.Authorization, "Bearer synthetic");
    const payload = JSON.parse(request.body);
    assert.equal(payload.model, "google/gemini-4-hydrogen");
    assert.equal(payload.max_tokens, 1536);
    assert.deepEqual(payload.reasoning, { effort: "low", exclude: true });
    assert.equal(payload.provider.data_collection, "deny");
    assert.doesNotMatch(payload.messages[0].content, /久しぶり/);
    assert.match(payload.messages[1].content, /久しぶり/);
    return Response.json({ choices: [{ message: { content: "Yep! 🦊" } }], internal: "do not forward" });
  } });
  const response = responseStub();
  await handler(requestStub(), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(response.body, { reply: "Yep! 🦊" });
});

test("cross-origin and malformed calls fail before inference", async () => {
  const handler = createChatHandler({ env: {}, fetcher: () => assert.fail("unexpected inference") });
  const request = requestStub();
  request.headers.origin = "https://other.example";
  const crossOrigin = responseStub();
  await handler(request, crossOrigin);
  assert.equal(crossOrigin.statusCode, 403);
  const malformed = responseStub();
  await handler(requestStub("{"), malformed);
  assert.equal(malformed.statusCode, 400);
  const disabled = responseStub();
  await handler(requestStub(), disabled);
  assert.equal(disabled.statusCode, 503);
});

test("local HTTP requests can read the body stream with no Vercel parser", async t => {
  const handler = createChatHandler({ local: true, fetcher: async (url, request) => {
    assert.match(url, /\/api\/v1\/agent\/batch-runs$/);
    const input = JSON.parse(request.body);
    assert.match(input.shared_context, /久しぶり/);
    assert.match(input.batches[0].prompt, /Can I say this to a friend/);
    return Response.json({ batches: [{ status: "completed", output: "こんにちは 🦊" }] });
  } });
  const server = createServer((request, response) => {
    response.status = code => { response.statusCode = code; return response; };
    response.json = body => response.end(JSON.stringify(body));
    void handler(request, response);
  });
  t.after(() => server.close());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(url, { method: "POST", headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ context, messages }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: "こんにちは 🦊" });
});
