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

function resolvedEdges({ info, snapshot }) {
  const edges = new Map();
  for (const [name, reference] of Object.entries({ ...snapshot.dependencies, ...snapshot.optionalDependencies })) {
    const optional = Object.hasOwn(snapshot.optionalDependencies ?? {}, name);
    const peer = Object.hasOwn(info.peerDependencies ?? {}, name);
    const kind = peer ? (optional ? "optional peer" : "peer") : (optional ? "optional" : "transitive");
    edges.set(name, { key: snapshotKey(name, reference), kind });
  }
  return edges;
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
    for (const { key } of resolvedEdges({ info, snapshot }).values()) pending.push(key);
  }
  return { settings, roots, reachable };
}

export function stremioDependencies({ manifest, lockfile, sources }) {
  const { parse } = releaseTool("yaml");
  const options = Object.fromEntries(Object.entries(JSON.parse(manifest)).filter(([key]) => !dependencyTypes.includes(key)));
  return { options, lock: dependencyTree(parse(lockfile, { maxAliasCount: 0 }), stremioPackages(sources)) };
}

function changedKeys(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].sort().filter(key =>
    !isDeepStrictEqual(before.get(key), after.get(key)));
}

function snapshotLabel(key) {
  return /^[\w@/.()+\-=]+$/.test(key) ? key : `${key.split("(", 1)[0]} (peer context omitted)`;
}

function aliasLabel(name) {
  return /^[\w@/.-]+$/.test(name) ? name : JSON.stringify(name);
}

function dependencyOrigins(tree) {
  const origins = new Map([...tree.roots.values()].map(({ key }) => [key, "direct"]));
  for (const [parent, entry] of tree.reachable) {
    for (const { key, kind } of resolvedEdges(entry).values()) {
      if (!origins.has(key)) origins.set(key, `${kind} via ${snapshotLabel(parent)}`);
    }
  }
  return origins;
}

export function describeDependencyChanges(before, after) {
  const details = [];
  for (const [left, right, label] of [
    [before.options, after.options, "Package settings"],
    [before.lock.settings, after.lock.settings, "Lockfile settings"],
  ]) {
    const fields = changedKeys(new Map(Object.entries(left)), new Map(Object.entries(right)));
    if (fields.length) details.push(`${label} changed (${fields.map(field => JSON.stringify(field)).join(", ")})`);
  }

  const reported = new Set();
  function resolutionChange(label, previous, current, kind) {
    const format = entry => entry ? `${snapshotLabel(entry.key)} (${entry[kind]})` : "none";
    details.push(`${label} · ${format(previous)} → ${format(current)}`);
    if (previous) reported.add(previous.key);
    if (current) reported.add(current.key);
  }

  const { roots: oldRoots, reachable: oldPackages } = before.lock;
  const { roots: newRoots, reachable: newPackages } = after.lock;
  const oldOrigins = dependencyOrigins(before.lock);
  const newOrigins = dependencyOrigins(after.lock);
  for (const name of changedKeys(oldRoots, newRoots)) {
    resolutionChange(`Direct dependency ${aliasLabel(name)}`, oldRoots.get(name), newRoots.get(name), "type");
  }

  const changed = changedKeys(oldPackages, newPackages);
  for (const key of changed) {
    const previous = oldPackages.get(key);
    const current = newPackages.get(key);
    if (!previous || !current) continue;
    const label = `${snapshotLabel(key)} (${newOrigins.get(key)})`;
    const { resolution: oldResolution, ...oldInfo } = previous.info;
    const { resolution: newResolution, ...newInfo } = current.info;
    if (!isDeepStrictEqual(oldResolution, newResolution)) details.push(`${label} · resolution changed`);
    if (!isDeepStrictEqual(oldInfo, newInfo)) details.push(`${label} · package metadata changed`);
    const oldEdges = resolvedEdges(previous);
    const newEdges = resolvedEdges(current);
    const changedEdges = changedKeys(oldEdges, newEdges);
    for (const name of changedEdges) {
      resolutionChange(`${snapshotLabel(key)} → ${aliasLabel(name)}`, oldEdges.get(name), newEdges.get(name), "kind");
    }
    const { dependencies: oldDeps, optionalDependencies: oldOptional, ...oldMetadata } = previous.snapshot;
    const { dependencies: newDeps, optionalDependencies: newOptional, ...newMetadata } = current.snapshot;
    if (!isDeepStrictEqual(oldMetadata, newMetadata)) details.push(`${label} · snapshot metadata changed`);
    if (!changedEdges.length && !isDeepStrictEqual([oldDeps, oldOptional], [newDeps, newOptional])) {
      details.push(`${label} · dependency declarations changed`);
    }
  }

  for (const key of changed) {
    if (reported.has(key) || (oldPackages.has(key) && newPackages.has(key))) continue;
    const added = newPackages.has(key);
    const origin = (added ? newOrigins : oldOrigins).get(key);
    details.push(`${added ? "Added" : "Removed"} ${snapshotLabel(key)} (${origin})`);
  }
  return details;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { base, candidate } = JSON.parse(readFileSync(0, "utf8"));
  const before = stremioDependencies(base);
  const after = stremioDependencies(candidate);
  const changed = !isDeepStrictEqual(before, after);
  console.log(JSON.stringify({ changed, details: changed ? describeDependencyChanges(before, after) : [] }));
}
