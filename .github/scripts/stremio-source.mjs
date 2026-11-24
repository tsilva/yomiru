import { readFileSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Keep declarations and signatures in the comparison. Only bodies reviewed
// as website-only can be omitted from the Stremio source comparison.
const websiteDeclarations = new Set([
  "browseSelection", "browsePage", "browseEpisodes",
]);
const websiteMethods = new Set(["browse", "episodeRows", "selectionSummary", "documents"]);
const storeFactories = {
  "web/lib/database.mjs": "createPublicationStore",
  "web/lib/incremental-publication.mjs": "createIncrementalStore",
};

const webRequire = createRequire(new URL("../../web/package.json", import.meta.url));

export function releaseTool(name) {
  const tools = process.env.YOMIRU_RELEASE_TOOLS;
  if (tools) return createRequire(join(tools, "package.json"))(name);
  if (name === "rollup/parseAst") return createRequire(webRequire.resolve("vite/package.json"))(name);
  return webRequire(name);
}

function websiteBodies(path, program) {
  if (path === "web/lib/browse.mjs") {
    return program.body.flatMap(node => {
      const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : null;
      if (declaration?.type === "FunctionDeclaration" && websiteDeclarations.has(declaration.id.name)) {
        return [declaration.body];
      }
      if (declaration?.type === "ClassDeclaration" && declaration.id.name === "BrowseError") {
        return declaration.body.body.filter(member => member.kind === "constructor").map(member => member.value.body);
      }
      return [];
    });
  }

  if (!Object.hasOwn(storeFactories, path)) return [];
  const factory = program.body.find(node => node.type === "ExportNamedDeclaration"
    && node.declaration?.type === "FunctionDeclaration"
    && node.declaration.id.name === storeFactories[path]);
  const returns = factory?.declaration.body.body.filter(node => node.type === "ReturnStatement");
  const store = returns?.length === 1 ? returns[0].argument : null;
  return store?.type === "ObjectExpression" ? store.properties.flatMap(property =>
    property.type === "Property" && property.method && !property.computed
    && websiteMethods.has(property.key.name) ? [property.value.body] : []) : [];
}

export function stremioSource(path, source) {
  const { parseAst } = releaseTool("rollup/parseAst");
  const bodies = websiteBodies(path, parseAst(source)).sort((left, right) => right.start - left.start);
  for (const { start, end } of bodies) {
    source = source.slice(0, start) + "{}" + source.slice(end);
  }
  return source;
}

export function stremioPackages(sources) {
  const { parseAst } = releaseTool("rollup/parseAst");
  const packages = new Set();
  for (const [path, source] of Object.entries(sources)) {
    const tree = parseAst(source);
    const website = new Set(websiteBodies(path, tree));
    const pending = [tree];
    while (pending.length) {
      const node = pending.pop();
      if (!node?.type || website.has(node)) continue;
      let reference;
      if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type)) {
        reference = node.source;
      } else if (node.type === "ImportExpression") {
        reference = node.source;
      } else if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require") {
        [reference] = node.arguments;
      }
      if (reference) {
        const name = reference.value;
        if (typeof name !== "string") throw new Error(`Cannot resolve a nonliteral import in ${path}.`);
        if (!name.startsWith(".") && !isBuiltin(name)) {
          const match = /^(?:@[\w.-]+\/)?[\w.-]+(?=\/|$)/.exec(name);
          if (!match) throw new Error(`Cannot resolve a package import in ${path}.`);
          packages.add(match[0]);
        }
      }
      for (const child of Object.values(node)) {
        if (Array.isArray(child)) pending.push(...child);
        else if (child && typeof child === "object" && "type" in child) pending.push(child);
      }
    }
  }
  return packages;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { path, base, candidate } = JSON.parse(readFileSync(0, "utf8"));
  console.log(stremioSource(path, base) === stremioSource(path, candidate) ? "unchanged" : "changed");
}
