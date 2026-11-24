import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

function loadParser() {
  const tools = process.env.YOMIRU_RELEASE_TOOLS;
  const from = tools ? join(tools, "package.json")
    : createRequire(new URL("../../web/package.json", import.meta.url)).resolve("vite/package.json");
  return createRequire(from)("rollup/parseAst").parseAst;
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
  const bodies = websiteBodies(path, loadParser()(source)).sort((left, right) => right.start - left.start);
  for (const { start, end } of bodies) {
    source = source.slice(0, start) + "{}" + source.slice(end);
  }
  return source;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { path, base, candidate } = JSON.parse(readFileSync(0, "utf8"));
  console.log(stremioSource(path, base) === stremioSource(path, candidate) ? "unchanged" : "changed");
}
