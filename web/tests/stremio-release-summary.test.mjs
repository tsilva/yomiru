import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";

const manifest = { id: "community.yomiru.published", version: "0.74.0" };
const releaseScripts = new URL("../../.github/scripts/", import.meta.url);
const installedDependencies = fileURLToPath(new URL("../node_modules/", import.meta.url));

function writeReleaseInputs(root, dependencyVersion, addonVersion) {
  const dependencies = { postgres: dependencyVersion };
  const packageKey = `postgres@${dependencyVersion}`;
  const lock = {
    lockfileVersion: "9.0",
    importers: { ".": { dependencies: {
      postgres: { specifier: dependencyVersion, version: dependencyVersion },
    } } },
    packages: { [packageKey]: {} },
    snapshots: { [packageKey]: {} },
  };
  writeFileSync(join(root, "web/package.json"), JSON.stringify({ dependencies }));
  writeFileSync(join(root, "web/pnpm-lock.yaml"), stringify(lock));
  writeFileSync(join(root, "web/public/manifest.json"), JSON.stringify({ ...manifest, version: addonVersion }));
}

for (const { name, addonVersion, exitStatus, manifestCheck } of [
  {
    name: "blocks a Stremio dependency change with the same manifest version",
    addonVersion: "0.74.0",
    exitStatus: 1,
    manifestCheck: "Blocked. Add-on version 0.74.0 must be newer than public version 0.74.0.",
  },
  {
    name: "passes a Stremio dependency change with a newer manifest version",
    addonVersion: "0.74.1",
    exitStatus: 0,
    manifestCheck: "Passed",
  },
]) {
  test(name, (t) => {
    const root = mkdtempSync(join(tmpdir(), "yomiru-release-summary-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const git = (...args) => execFileSync("git", [
      "-c", "user.name=Release fixture", "-c", "user.email=release-fixture@example.test",
      "-c", "commit.gpgSign=false", "-c", "core.hooksPath=/dev/null", ...args,
    ], { cwd: root, encoding: "utf8" }).trim();

    git("init", "--quiet", "--template=");
    for (const directory of ["web/api", "web/public", ".github/scripts"]) {
      mkdirSync(join(root, directory), { recursive: true });
    }
    writeFileSync(join(root, "web/api/subtitles.mjs"), 'export { default } from "postgres";');
    writeReleaseInputs(root, "3.4.8", manifest.version);
    git("add", "web");
    git("commit", "--quiet", "-m", "Baseline release fixture");
    const base = git("rev-parse", "HEAD");

    writeReleaseInputs(root, "3.4.9", addonVersion);
    git("commit", "--quiet", "-am", "Change a Stremio dependency");
    const candidate = git("rev-parse", "HEAD");
    for (const script of ["release_yomiru.py", "stremio-dependencies.mjs", "stremio-source.mjs"]) {
      copyFileSync(new URL(script, releaseScripts), join(root, ".github/scripts", script));
    }
    symlinkSync(installedDependencies, join(root, "web/node_modules"), "dir");

    const summary = join(root, "summary.md");
    const env = { ...process.env };
    delete env.YOMIRU_RELEASE_TOOLS;
    const result = spawnSync("python3", [
      ".github/scripts/release_yomiru.py", "check-release", base, candidate, "--summary", summary,
    ], { cwd: root, encoding: "utf8", env, input: JSON.stringify(manifest), timeout: 45_000 });
    assert.ifError(result.error);
    assert.equal(result.status, exitStatus, result.stderr);

    const lines = readFileSync(summary, "utf8").split("\n");
    for (const line of [
      "## Release classification",
      "- **Type** Stremio add-on",
      `- **Commit** \`${base.slice(0, 7)}\` → \`${candidate.slice(0, 7)}\``,
      `- **Stremio version** \`${manifest.version}\` → \`${addonVersion}\``,
      `- **Manifest check** ${manifestCheck}`,
      "- `web/package.json`",
      "- `web/pnpm-lock.yaml`",
      "### Stremio dependency changes",
      "    Direct dependency postgres · postgres@3.4.8 (dependencies) → postgres@3.4.9 (dependencies)",
    ]) {
      assert.ok(lines.includes(line), `Missing summary line ${JSON.stringify(line)}\n${lines.join("\n")}`);
    }
  });
}
