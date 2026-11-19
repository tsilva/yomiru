import { parseArgs } from "node:util";
import { createAgentBridgeReviewClient, reviewNextWord } from "../lib/word-review.mjs";
import { createAdminExecutor } from "./upload-library.mjs";

const { values } = parseArgs({ options: {
  deployment: { type: "string" }, executor: { type: "string" }, limit: { type: "string", default: "3" },
} });
const limit = Number(values.limit);
if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Review between 1 and 50 words per invocation");
const admin = createAdminExecutor(values.executor, values.deployment);
const store = {
  claim: () => admin({ incremental: { action: "review-claim" } }).job,
  finish: (job, answer) => admin({ incremental: { action: "review-finish",
    job: { word: { id: job.word.id }, lease: job.lease }, answer } }),
};
const complete = createAgentBridgeReviewClient();
const outcomes = {};
for (let i = 0; i < limit; i++) {
  const result = await reviewNextWord(store, complete);
  if (!result) break;
  outcomes[result.state] = (outcomes[result.state] || 0) + 1;
}
console.log(JSON.stringify(outcomes));
