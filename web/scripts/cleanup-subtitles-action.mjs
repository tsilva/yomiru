import { fileURLToPath } from "node:url";
import { cleanupAudience } from "../lib/subtitle-cleanup-identity.mjs";
import { subtitleCleanupBatchSize, subtitleCleanupPlanDigest } from "../lib/subtitle-cleanup.mjs";
import { readCleanupPlan } from "./cleanup-subtitles.mjs";
import { workflowRequest } from "./workflow-request.mjs";

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runCleanupAction(({ incremental }) => workflowRequest(cleanupAudience, incremental),
      process.env.YOMIRU_APPROVED_CLEANUP_DIGEST);
  } catch (error) {
    // Third-party diagnostics can contain request credentials.
    console.error(error?.cause ? "The cleanup transport failed" : error.message);
    process.exitCode = 1;
  }
}
