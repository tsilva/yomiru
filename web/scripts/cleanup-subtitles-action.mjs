import { fileURLToPath } from "node:url";
import { cleanupAudience } from "../lib/subtitle-cleanup-identity.mjs";
import { subtitleCleanupBatchSize, subtitleCleanupPlanDigest } from "../lib/subtitle-cleanup.mjs";
import { readCleanupPlan } from "./cleanup-subtitles.mjs";

export async function runCleanupAction(admin, approvedDigest, report = console.log) {
  const before = await readCleanupPlan(admin);
  const digest = subtitleCleanupPlanDigest(before);
  report(JSON.stringify({ before: before.counts, bytes: before.bytes, digest }));
  if (!approvedDigest) return;
  if (approvedDigest !== digest) throw new Error("The live plan differs from the reviewed inventory");

  let removed = 0;
  for (let start = 0; start < before.candidates.length; start += subtitleCleanupBatchSize) {
    const candidates = before.candidates.slice(start, start + subtitleCleanupBatchSize);
    const result = await admin({ incremental: { action: "apply-subtitle-cleanup", previous: before.revision, candidates } });
    if (result.revision !== before.revision || !Array.isArray(result.deleted) || !Array.isArray(result.absent)) {
      throw new Error("An apply batch was not confirmed");
    }
    const accounted = new Set([...result.deleted, ...result.absent]);
    if (result.deleted.length + result.absent.length !== candidates.length
      || accounted.size !== candidates.length || candidates.some(({ key }) => !accounted.has(key))) {
      throw new Error("The apply receipt does not cover the reviewed batch");
    }
    removed += result.deleted.length;
  }

  const after = await readCleanupPlan(admin);
  const remaining = new Set(after.candidates.map(({ key }) => key));
  if (after.revision !== before.revision || after.activeKeys !== before.activeKeys
    || before.candidates.some(({ key }) => remaining.has(key))) {
    throw new Error("The post-cleanup inventory could not be confirmed");
  }
  report(JSON.stringify({ verified: true, removed, after: after.counts }));
}

async function githubCleanupRequest({ incremental }) {
  const issuerURL = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (issuerURL.protocol !== "https:" || !issuerURL.hostname.endsWith(".actions.githubusercontent.com")
    || issuerURL.username || issuerURL.password || !requestToken) throw new Error("GitHub OIDC is unavailable");
  issuerURL.searchParams.set("audience", cleanupAudience);
  const identity = await fetch(issuerURL, { headers: { Authorization: `Bearer ${requestToken}` },
    redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!identity.ok) throw new Error("GitHub rejected the OIDC request");
  const { value } = await identity.json();
  if (typeof value !== "string" || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) {
    throw new Error("GitHub did not issue a workflow identity");
  }
  const result = await fetch(cleanupAudience, { method: "POST", body: JSON.stringify(incremental),
    headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/json" },
    redirect: "error", signal: AbortSignal.timeout(65000) });
  if (!result.ok) throw new Error(`Production rejected ${incremental.action} (${result.status})`);
  return result.json();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runCleanupAction(githubCleanupRequest, process.env.YOMIRU_APPROVED_CLEANUP_DIGEST);
  } catch (error) {
    // Third-party diagnostics can contain request credentials.
    console.error(error?.cause ? "The cleanup transport failed" : error.message);
    process.exitCode = 1;
  }
}
