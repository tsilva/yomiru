import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isSubtitleCleanupCandidate, subtitleCleanupBatchSize } from "../lib/subtitle-cleanup.mjs";
import { createAdminExecutor } from "./upload-library.mjs";

const revisionPattern = /^[a-f0-9]{64}$/;

export async function readCleanupPlan(admin) {
  const plan = { dryRun: true, revision: null, activeKeys: 0,
    counts: { active: 0, staged: 0, recent: 0, candidates: 0 }, bytes: 0, candidates: [] };
  const cursors = new Set();
  let after;
  do {
    const page = await admin({ incremental: { action: "plan-subtitle-cleanup",
      ...(after && { after, previous: plan.revision }) } });
    if (!revisionPattern.test(page.revision) || (plan.revision && page.revision !== plan.revision)
      || !Number.isSafeInteger(page.activeKeys) || page.activeKeys < 0
      || (plan.revision && plan.activeKeys !== page.activeKeys)
      || !Array.isArray(page.candidates) || page.candidates.length !== page.counts?.candidates
      || !page.candidates.every(isSubtitleCleanupCandidate)
      || (page.next !== null && (typeof page.next !== "string" || !page.next.startsWith("library/")
        || cursors.has(page.next)))) throw new Error("Invalid subtitle cleanup report");
    plan.revision = page.revision;
    plan.activeKeys = page.activeKeys;
    for (const reason of Object.keys(plan.counts)) {
      const count = page.counts[reason];
      if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid subtitle cleanup count");
      plan.counts[reason] += count;
    }
    plan.candidates.push(...page.candidates);
    after = page.next;
    cursors.add(after);
  } while (after);
  if (plan.counts.active !== plan.activeKeys
    || new Set(plan.candidates.map(({ key }) => key)).size !== plan.candidates.length) {
    throw new Error("R2 inventory did not match the active catalogue");
  }
  plan.bytes = plan.candidates.reduce((total, { bytes }) => total + bytes, 0);
  return plan;
}

async function main() {
  const { values } = parseArgs({ options: {
    deployment: { type: "string" }, executor: { type: "string" }, "apply-plan": { type: "string" },
  } });
  const admin = createAdminExecutor(values.executor, values.deployment);
  if (values["apply-plan"] === undefined) {
    const plan = await readCleanupPlan(admin);
    console.log(JSON.stringify({ ...plan, deployment: values.deployment }, null, 2));
    return;
  }

  const plan = JSON.parse(await readFile(values["apply-plan"], "utf8"));
  const { revision: previous, candidates } = plan;
  if (plan.dryRun !== true || plan.deployment !== values.deployment || !revisionPattern.test(previous)
    || !Array.isArray(candidates) || !candidates.every(isSubtitleCleanupCandidate)
    || new Set(candidates.map(({ key }) => key)).size !== candidates.length) {
    throw new Error("Supply a dry-run report for this deployment");
  }
  for (let start = 0; start < candidates.length; start += subtitleCleanupBatchSize) {
    const result = await admin({ incremental: { action: "apply-subtitle-cleanup", previous,
      candidates: candidates.slice(start, start + subtitleCleanupBatchSize) } });
    if (result.revision !== previous) throw new Error("Subtitle cleanup was not confirmed");
    console.log(JSON.stringify(result));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
