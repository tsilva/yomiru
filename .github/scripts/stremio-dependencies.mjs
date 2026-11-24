import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { releaseTool, stremioPackages } from "./stremio-source.mjs";

const dependencyTypes = ["optionalDependencies", "dependencies", "devDependencies"];
const registryId = /^(?:@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;

function snapshotKey(name, reference) {
  if (typeof reference !== "string") throw new Error(`Invalid dependency reference for ${name}.`);
  // Aliases carry the actual package name. Regular references start with a version.
  if (registryId.test(reference.split("(", 1)[0])) return reference;
  const key = `${name}@${reference}`;
  if (registryId.test(key.split("(", 1)[0])) return key;
  throw new Error(`Unsupported dependency reference for ${name}.`);
}

export function dependencyTree(lock, runtimePackages) {
  const { lockfileVersion, importers, packages, snapshots, overrides, catalogs, ...settings } = lock;
  const importer = importers?.["."];
  if (lockfileVersion !== "9.0" || !importer || !packages || !snapshots) {
    throw new Error("Expected a pnpm 9 project lockfile.");
  }

  const roots = new Map();
  for (const name of runtimePackages) {
    const type = dependencyTypes.find(section => Object.hasOwn(importer[section] ?? {}, name));
    if (!type) throw new Error(`The lockfile does not declare the Stremio dependency ${name}.`);
    roots.set(name, { type, key: snapshotKey(name, importer[type][name].version) });
  }

  const reachable = new Map();
  const pending = [...roots.values()].map(({ key }) => key);
  while (pending.length) {
    const key = pending.pop();
    if (reachable.has(key)) continue;
    const id = key.split("(", 1)[0];
    const info = packages[id];
    const snapshot = snapshots[key];
    if (!info || !snapshot) throw new Error(`The lockfile is missing a resolved Stremio dependency: ${id}.`);
    reachable.set(key, { info, snapshot });
    // pnpm records resolved peer providers in these maps too. Keep the full
    // snapshot key, including the peer context and any patch hash.
    for (const [name, reference] of Object.entries({ ...snapshot.dependencies, ...snapshot.optionalDependencies })) {
      pending.push(snapshotKey(name, reference));
    }
  }
  return { settings, roots, reachable };
}

export function stremioDependencies({ manifest, lockfile, sources }) {
  const { parse } = releaseTool("yaml");
  const options = Object.fromEntries(Object.entries(JSON.parse(manifest)).filter(([key]) => !dependencyTypes.includes(key)));
  return { options, lock: dependencyTree(parse(lockfile, { maxAliasCount: 0 }), stremioPackages(sources)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { base, candidate } = JSON.parse(readFileSync(0, "utf8"));
  console.log(isDeepStrictEqual(stremioDependencies(base), stremioDependencies(candidate)) ? "unchanged" : "changed");
}
