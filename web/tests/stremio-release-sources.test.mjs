import assert from "node:assert/strict";
import test from "node:test";
import { stremioSource } from "../../.github/scripts/stremio-source.mjs";

test("editing website search in a shared module leaves the Stremio comparison unchanged", () => {
  const path = "web/lib/browse.mjs";
  const before = `
    export function browseEpisodes() { return query("website"); }
    export function subtitleCoverage() { return query("stremio"); }
    export class BrowseError extends Error { constructor() { super("website"); } }
  `;
  const website = before.replaceAll('"website"', '"sidebar"');
  const mixed = website.replace('query("stremio")', 'query("all languages")');
  assert.equal(stremioSource(path, before), stremioSource(path, website));
  assert.notEqual(stremioSource(path, before), stremioSource(path, mixed));
  assert.notEqual(stremioSource(path, before),
    stremioSource(path, before.replace("constructor()", "static { setup(); } constructor()")));
});

test("only reviewed methods on the exported storage factories are ignored", () => {
  for (const [path, factory] of [
    ["web/lib/database.mjs", "createPublicationStore"],
    ["web/lib/incremental-publication.mjs", "createIncrementalStore"],
  ]) {
    const before = `
      export function ${factory}(sql) {
        const audit = { async browse() { return "audit"; } };
        return {
          async browse(revision) { return sql\`SELECT '\${revision}' AS website\`; },
          async tracks() { return sql\`SELECT 'stremio' AS tracks\`; },
        };
      }
    `;
    const website = before.replace("AS website", "AS sidebar");
    assert.equal(stremioSource(path, before), stremioSource(path, website));
    const stremio = stremioSource(path, before);
    for (const candidate of [
      website.replace("AS tracks", "AS subtitles"),
      website.replace('"audit"', '"iterator"'),
      website.replace("browse(revision)", "browse(revision, page)"),
      `import "./extra.mjs";\n${website}`,
    ]) {
      assert.notEqual(stremio, stremioSource(path, candidate));
    }
  }
});
