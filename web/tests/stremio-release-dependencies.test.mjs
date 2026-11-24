import assert from "node:assert/strict";
import test from "node:test";
import { dependencyTree, describeDependencyChanges, stremioDependencies } from "../../.github/scripts/stremio-dependencies.mjs";
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
  assert.deepEqual(describeDependencyChanges(compare("1.0.0", lock), compared), []);
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

test("reports dependency resolutions and same-version integrity changes", () => {
  const packages = stremioPackages(sources);
  const baseline = { options: {}, lock: dependencyTree(lock, packages) };
  const updated = structuredClone(lock);
  updated.snapshots[server].dependencies.aliasedLeaf = "leaf@1.1.0";
  updated.packages["leaf@1.1.0"] = updated.packages["leaf@1.0.0"];
  updated.snapshots["leaf@1.1.0"] = {};
  updated.packages["peer@1.0.0"].resolution.integrity = "different-integrity";
  updated.packages["@example/server@1.0.0"].peerDependencies = { peer: "^1.0.0" };
  const details = describeDependencyChanges(baseline, { options: {}, lock: dependencyTree(updated, packages) });
  assert.ok(details.includes(`${server} → aliasedLeaf · leaf@1.0.0 (transitive) → leaf@1.1.0 (transitive)`));
  assert.ok(details.includes(`peer@1.0.0 (optional peer via ${server}) · resolution changed`));
  assert.ok(details.includes(`${server} (direct) · package metadata changed`));
  assert.doesNotMatch(details.join("\n"), /different-integrity/);
});

test("reports a direct package version change with both exact versions", () => {
  const direct = { lockfileVersion: "9.0", importers: { ".": { dependencies: {
    postgres: { version: "3.4.8" },
  } } }, packages: { "postgres@3.4.8": {} }, snapshots: { "postgres@3.4.8": {} } };
  const changed = { ...direct, importers: { ".": { dependencies: { postgres: { version: "3.4.9" } } } },
    packages: { "postgres@3.4.9": {} }, snapshots: { "postgres@3.4.9": {} } };
  assert.deepEqual(describeDependencyChanges(
    { options: {}, lock: dependencyTree(direct, ["postgres"]) },
    { options: {}, lock: dependencyTree(changed, ["postgres"]) },
  ), ["Direct dependency postgres · postgres@3.4.8 (dependencies) → postgres@3.4.9 (dependencies)"]);
});
