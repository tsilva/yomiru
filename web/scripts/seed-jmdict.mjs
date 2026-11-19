import { parseArgs } from "node:util";
import { createAdminExecutor } from "./upload-library.mjs";
import { importJmdict } from "../lib/jmdict.mjs";

const { values } = parseArgs({ options: { deployment: { type: "string" }, executor: { type: "string" } } });
const admin = createAdminExecutor(values.executor, values.deployment);
const stats = await importJmdict(process.stdin, async rows => {
  const { inserted } = admin({ incremental: { action: "seed-jmdict", rows } });
  if (!Number.isInteger(inserted) || inserted < 0 || inserted > rows.length) throw new Error("JMdict batch was unconfirmed");
  return inserted;
});
let after = "", linked = 0;
do {
  const page = admin({ incremental: { action: "link-jmdict", after } });
  if (!Number.isInteger(page.linked) || page.linked < 0 || page.linked > 250
    || (page.next !== null && (!/^ja-[a-f0-9]{64}$/.test(page.next) || page.next <= after))) {
    throw new Error("JMdict linking was unconfirmed");
  }
  linked += page.linked;
  after = page.next;
} while (after !== null);
const { enqueued } = admin({ incremental: { action: "enqueue-reviews" } });
console.log(JSON.stringify({ ...stats, linked, enqueued }));
