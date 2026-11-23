import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { createCleanupHandler } from "../api/subtitle-cleanup.mjs";
import { authorizedCleanupIdentity, cleanupAudience } from "../lib/subtitle-cleanup-identity.mjs";
import { subtitleCleanupPlanDigest } from "../lib/subtitle-cleanup.mjs";
import { runCleanupAction } from "../scripts/cleanup-subtitles-action.mjs";

test("cleanup accepts only the owner's production workflow identity", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const issuer = "https://token.actions.githubusercontent.com";
  const seconds = 1800000000;
  const sha = "a".repeat(40);
  const claims = {
    iss: issuer, aud: cleanupAudience, repository: "tsilva/yomiru", repository_id: "1462854175",
    repository_owner_id: "26742", actor_id: "26742", ref: "refs/heads/main",
    workflow_ref: "tsilva/yomiru/.github/workflows/subtitle-cleanup.yml@refs/heads/main",
    event_name: "workflow_dispatch", environment: "Production", runner_environment: "github-hosted",
    sha, workflow_sha: sha, exp: seconds + 300, iat: seconds, nbf: seconds,
  };
  const encode = data => Buffer.from(JSON.stringify(data)).toString("base64url");
  const testToken = (changed = {}, header = { alg: "RS256", kid: "fixture" }) => {
    const signed = `${encode(header)}.${encode({ ...claims, ...changed })}`;
    return `Bearer ${signed}.${sign("RSA-SHA256", Buffer.from(signed), privateKey).toString("base64url")}`;
  };
  let requests = 0;
  const options = { now: () => seconds * 1000, fetcher: async url => {
    requests++;
    assert.equal(url, `${issuer}/.well-known/jwks`);
    return Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), alg: "RS256", use: "sig", kid: "fixture" }] });
  } };
  for (const changed of [
    { aud: "other" }, { actor_id: "1" }, { ref: "refs/heads/other" }, { sha: "b".repeat(40) },
    { workflow_ref: "other" }, { exp: seconds - 1 }, { event_name: "schedule" }, { environment: "Preview" },
  ]) assert.equal(await authorizedCleanupIdentity(testToken(changed), options), false);
  assert.equal(requests, 0);
  assert.equal(await authorizedCleanupIdentity(testToken(), options), true);
  assert.equal(await authorizedCleanupIdentity(testToken().replace(/\.[^.]+$/, ".AAAA"), options), false);
});

test("public cleanup endpoint requires authentication and declines unrelated publisher operations", async () => {
  const response = { setHeader() {}, status(code) { this.code = code; return this; }, end() {} };
  const request = { method: "POST", headers: { host: "yomiru.tsilva.eu" } };
  const handler = createCleanupHandler({ environment: { VERCEL_ENV: "production" },
    authorize: token => token === "fixture", getDatabase: () => assert.fail("touched production state") });
  await handler(request, response);
  assert.equal(response.code, 401);
  await handler({ ...request, headers: { ...request.headers, authorization: "fixture" },
    body: { action: "publish" } }, response);
  assert.equal(response.code, 400);
  await handler({ ...request, method: "GET" }, response);
  assert.equal(response.code, 404);
});

test("the workflow applies only an identical live plan and verifies the inventory afterwards", async () => {
  const revision = "a".repeat(64);
  const entry = { key: `library/${"b".repeat(64)}.ass`, bytes: 9, modified: "2026-01-01T00:00:00.000Z" };
  const fingerprint = subtitleCleanupPlanDigest({ revision, candidates: [entry] });
  let applies = 0;
  const messages = [];
  const admin = async ({ incremental }) => {
    if (incremental.action === "plan-subtitle-cleanup") {
      return { revision, activeKeys: 1, counts: { active: 1, staged: 0, recent: 0, candidates: 1 - applies },
        candidates: applies ? [] : [entry], next: null };
    }
    assert.deepEqual(incremental, { action: "apply-subtitle-cleanup", previous: revision, candidates: [entry] });
    applies++;
    return { revision, deleted: [entry.key], absent: [] };
  };
  const report = line => messages.push(JSON.parse(line));
  await runCleanupAction(admin, "", report);
  await assert.rejects(runCleanupAction(admin, "c".repeat(64), report), /differs from the reviewed inventory/);
  assert.equal(applies, 0);
  await runCleanupAction(admin, fingerprint, report);
  assert.deepEqual(messages.at(-1), { verified: true, removed: 1,
    after: { active: 1, staged: 0, recent: 0, candidates: 0 } });
});
