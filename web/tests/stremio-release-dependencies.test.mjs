import assert from "node:assert/strict";
import test from "node:test";
import { dependencyTree, stremioDependencies } from "../../.github/scripts/stremio-dependencies.mjs";
import { stremioPackages } from "../../.github/scripts/stremio-source.mjs";

const server = "@example/server@1.0.0(peer@1.0.0)";
const lock = {
  lockfileVersion: "9.0",
  importers: {
    ".": {
      dependencies: {
        "@example/server": { specifier: "1.0.0", version: "1.0.0(peer@1.0.0)" },
        browser: { specifier: "1.0.0", version: "1.0.0" },
      },
    },
  },
  packages: {
    "@example/server@1.0.0": { resolution: { integrity: "server" } },
    "leaf@1.0.0": { resolution: { integrity: "leaf" } },
    "peer@1.0.0": { resolution: { integrity: "peer" } },
    "browser@1.0.0": { resolution: { integrity: "browser" } },
  },
  snapshots: {
    [server]: { dependencies: { aliasedLeaf: "leaf@1.0.0" }, optionalDependencies: { peer: "1.0.0" } },
    "leaf@1.0.0": {},
    "peer@1.0.0": { dependencies: { "@example/server": "1.0.0(peer@1.0.0)" } },
    "browser@1.0.0": {},
  },
};

const sources = {
  "web/api/subtitles.mjs": `import server from "@example/server/subtitles"; export default server;`,
  "web/lib/incremental-publication.mjs": `export function createIncrementalStore() {
    return { async browse() { return import("browser"); }, async tracks() { return []; } };
  }`,
};

test("a website dependency update in both package files leaves Stremio's graph unchanged", () => {
  function compare(browserVersion, input) {
    return stremioDependencies({
      manifest: JSON.stringify({ dependencies: { "@example/server": "1.0.0", browser: browserVersion } }),
      lockfile: JSON.stringify(input),
      sources,
    });
  }
  const website = structuredClone(lock);
  website.importers["."].dependencies.browser = { specifier: "2.0.0", version: "2.0.0" };
  delete website.packages["browser@1.0.0"];
  delete website.snapshots["browser@1.0.0"];
  website.packages["browser@2.0.0"] = { resolution: { integrity: "new-browser" } };
  website.snapshots["browser@2.0.0"] = {};
  const compared = compare("2.0.0", website);
  assert.deepEqual(compared, compare("1.0.0", lock));
  assert.deepEqual([...compared.lock.reachable.keys()].sort(), [server, "leaf@1.0.0", "peer@1.0.0"]);
});

test("changes to a direct dependency, transitive package, or resolved peer affect the graph", () => {
  const packages = stremioPackages(sources);
  const baseline = dependencyTree(lock, packages);
  for (const key of ["@example/server@1.0.0", "leaf@1.0.0", "peer@1.0.0"]) {
    const updated = structuredClone(lock);
    updated.packages[key].resolution.integrity = "changed";
    assert.notDeepEqual(dependencyTree(updated, packages), baseline);
  }

  const updated = structuredClone(lock);
  updated.importers["."].dependencies["@example/server"].version = "2.0.0(peer@1.0.0)";
  updated.packages["@example/server@2.0.0"] = updated.packages["@example/server@1.0.0"];
  updated.snapshots["@example/server@2.0.0(peer@1.0.0)"] = updated.snapshots[server];
  assert.notDeepEqual(dependencyTree(updated, packages), baseline);

  delete updated.snapshots["peer@1.0.0"];
  assert.throws(() => dependencyTree(updated, packages), /missing a resolved Stremio dependency/);
});

test("runtime imports include dynamic packages and exclude built-ins and website bodies", () => {
  const packages = stremioPackages({ ...sources,
    "web/lib/sentry-server.mjs": `import { readFile } from "node:fs";
      export const load = () => import("monitoring");`,
  });
  assert.deepEqual(packages, new Set(["@example/server", "monitoring"]));
  assert.throws(() => stremioPackages({ "web/api/subtitles.mjs": "import(packageName);" }), /nonliteral import/);
});
