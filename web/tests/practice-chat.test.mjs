import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { chatProvider, createChatHandler, readChat } from "../api/practice-chat.mjs";
import { maxChatRequestBytes, practiceChatRequest } from "../lib/practice-chat-request.mjs";
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
      return Response.json({ choices: [{ message: { content: "PRACTICE\nExample reply." } }] });
    },
  });
  const response = responseStub();
  await handler(requestStub(request), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { reply: "Example reply.", assisted: true });
});

test("Word Drill answers are quoted context for a written message on both provider routes", async () => {
  const word = { surface: "行く", reading: "いく", meaning: "to go" };
  const question = { prompt: "to go", toKana: true, choices: ["くる", "いく", "かえる", "あるく"] };
  const dictionary = { kind: "dictionary", word, question: { ...question, correctChoice: 1, missedChoices: [0] } };
  const completedAnswers = [{
    prompt: "How much?", choices: ["どこ", "いくら", "これ", "すこし"], toKana: true, correctChoice: 1, missedChoices: [0],
  }];
  const content = "Can we practice the one I missed?";
  const history = [{ role: "user", content, word }];
  assert.equal(readChat({ context: dictionary, messages: [], completedAnswers }), null);
  assert.equal(readChat({ context: dictionary, messages: history,
    completedAnswers: [{ ...completedAnswers[0], missedChoices: [1] }] }), null);
  assert.equal(readChat({ context: { ...dictionary, question: { ...question, choices: ["いく"] } }, messages: history }), null);
  assert.deepEqual(readChat({ context, messages, completedAnswers }).completedAnswers, completedAnswers);

  for (const local of [false, true]) {
    let calls = 0;
    const handler = createChatHandler({ local,
      env: { OPENROUTER_API_KEY: "synthetic", YOMIRU_OPENROUTER_CHAT_MODEL: "test/model" },
      async fetcher(_url, upstream) {
        calls++;
        const payload = JSON.parse(upstream.body);
        const system = local ? payload.instructions : payload.messages[0].content;
        const turn = local ? JSON.parse(payload.batches[0].prompt.split("\n").at(-1)).at(-1) : payload.messages.at(-1);
        assert.doesNotMatch(system, /How much\?/);
        assert.equal(turn.role, "user");
        assert.deepEqual(JSON.parse(turn.content.split("\n")[1]), completedAnswers);
        assert.deepEqual(JSON.parse(turn.content.split("Quoted dictionary context:\n")[1].split("\n")[0]).question, question);
        assert.ok(turn.content.endsWith(content));
        return Response.json(local ? { batches: [{ status: "completed", output: "PRACTICE\nTry ikura." }] }
          : { choices: [{ message: { content: "PRACTICE\nTry ikura." } }] });
      },
    });
    const empty = responseStub();
    await handler(requestStub({ context: dictionary, messages: [], completedAnswers }), empty);
    assert.equal(empty.statusCode, 400);
    assert.equal(calls, 0);
    const response = responseStub();
    await handler(requestStub(practiceChatRequest(dictionary, history, completedAnswers)), response);
    assert.deepEqual(response.body, { reply: "Try ikura.", assisted: true });
    assert.equal(calls, 1);
  }
});

test("subtitle and conjugation chat quote numbered answers and keep the current question unmarked", async () => {
  const completedAnswers = [{ number: 12, prompt: "うみ", line: "うみをみた。", toKana: false,
    choices: ["ocean", "river", "lake", "rain"], correctChoice: 0, missedChoices: [2] }];
  const question = { prompt: "みる", label: "Past", toKana: true, choices: ["みた", "みる", "みて", "みない"] };
  const verb = { kind: "verb", japanese: "見る", translation: "to see", question: { ...question, correctChoice: 0 } };
  const history = [...messages, { role: "assistant", content: "Yes." }, { role: "user", content: "Explain question 12." }];
  const handler = createChatHandler({
    env: { OPENROUTER_API_KEY: "synthetic", YOMIRU_OPENROUTER_CHAT_MODEL: "test/model" },
    async fetcher(_url, upstream) {
      const { messages: sent } = JSON.parse(upstream.body);
      const latest = sent.at(-1).content;
      assert.deepEqual(JSON.parse(latest.split("\n")[1]), completedAnswers);
      assert.deepEqual(JSON.parse(latest.split("Quoted verb context:\n")[1].split("\n")[0]).question, question);
      assert.ok(latest.endsWith(history.at(-1).content));
      return Response.json({ choices: [{ message: { content: "PRACTICE\nUmi means ocean." } }] });
    },
  });
  const response = responseStub();
  await handler(requestStub(practiceChatRequest(verb, history, completedAnswers)), response);
  assert.deepEqual(response.body, { reply: "Umi means ocean.", assisted: true });
});

test("long Word Drill rounds retain their most recent answers within the chat request limit", () => {
  const dictionary = { kind: "dictionary", word: { surface: "行く", reading: "いく", meaning: "to go" } };
  const answers = Array.from({ length: 300 }, (_, index) => ({
    prompt: `Question ${index}`, toKana: true, choices: ["どこ", "いくら", "これ", "すこし"], correctChoice: 1, missedChoices: [],
  }));
  const body = practiceChatRequest(dictionary, messages, answers);
  const retained = JSON.parse(body).completedAnswers;
  assert.ok(Buffer.byteLength(body) <= maxChatRequestBytes);
  assert.ok(retained.length > 0 && retained.length < answers.length);
  assert.deepEqual(retained, answers.slice(-retained.length));
  assert.ok(readChat(JSON.parse(body)));
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
    return Response.json({ choices: [{ message: { content: "PRACTICE\nYep! 🦊" } }], internal: "do not forward" });
  } });
  const response = responseStub();
  await handler(requestStub(), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(response.body, { reply: "Yep! 🦊", assisted: true });
});

test("scoped replies keep small talk and redirects unassisted and discard unrecognized output", async () => {
  const subtitleRedirect = "Let’s stick to Japanese. Want to unpack this subtitle or practice saying something in Japanese? 🦊";
  const dictionaryRedirect = "Let’s stick to Japanese. Want to try using this word in a sentence? 🦊";
  const dictionary = { kind: "dictionary", word: { surface: "降る", reading: "ふる", meaning: "to fall" } };
  const languageReply = 'Ohayō means "good morning."';
  const cases = [
    { question: "I’m Mira. What’s your name?", output: "SMALL_TALK\nNice to meet you, Mira! I’m Yomiru. 🦊",
      expected: { reply: "Nice to meet you, Mira! I’m Yomiru. 🦊", assisted: false } },
    { question: "Can you write a Python script?", output: "OFF_TOPIC\nThis text should never be shown.",
      expected: { reply: subtitleRedirect, assisted: false } },
    { question: "Who invented the telephone?", output: "OFF_TOPIC", attachment: dictionary,
      expected: { reply: dictionaryRedirect, assisted: false } },
    { question: "What does ohayō mean? Also, who invented the telephone?", output: `PRACTICE_AND_REDIRECT\n${languageReply}`,
      expected: { reply: `${languageReply}\n\n${subtitleRedirect}`, assisted: true } },
    { question: "Can you do the first thing I asked?", output: "Unlabeled provider output.",
      expected: { reply: subtitleRedirect, assisted: false } },
  ];
  for (const { question, output, attachment = context, expected } of cases) {
    const handler = createChatHandler({
      env: { OPENROUTER_API_KEY: "synthetic", YOMIRU_OPENROUTER_CHAT_MODEL: "test/model" },
      async fetcher(_url, request) {
        const { messages: upstream } = JSON.parse(request.body);
        assert.match(upstream[0].content, /latest learner message on every turn/);
        assert.ok(upstream[1].content.endsWith(question));
        return Response.json({ choices: [{ message: { content: output } }] });
      },
    });
    const response = responseStub();
    await handler(requestStub({ context: attachment, messages: [{ role: "user", content: question }] }), response);
    assert.equal(response.statusCode, 200, question);
    assert.deepEqual(response.body, expected, question);
  }
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
    assert.match(input.instructions, /OFF_TOPIC/);
    return Response.json({ batches: [{ status: "completed", output: "SMALL_TALK\nKonnichiwa! 🦊" }] });
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
  assert.deepEqual(await response.json(), { reply: "Konnichiwa! 🦊", assisted: false });
});
