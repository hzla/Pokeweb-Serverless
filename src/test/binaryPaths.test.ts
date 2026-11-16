import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import unmapped from "./fixtures/unmappedBuildScripts.json";

/**
 * Built binaries must not carry machine-specific paths (they end up in users' ROMs and in the repo), and every C
 * build must map the repo root away with -fmacro-prefix-map / -fdebug-prefix-map (or -ffile-prefix-map, which sets
 * both). See the project's binary rules.
 */
const ROOT = join(__dirname, "../..");
const MACHINE_PATH = /\/home\/|\/Users\/|\/sessions\/|\/root\/|[A-Za-z]:\\/;

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** Like `strings -n 6`: runs of at least six printable ASCII bytes. */
function printableRuns(bytes: Uint8Array) {
  const runs: string[] = [];
  let start = -1;
  for (let i = 0; i <= bytes.length; i++) {
    const printable = i < bytes.length && ((bytes[i]! >= 0x20 && bytes[i]! < 0x7f) || bytes[i] === 0x09);
    if (printable && start < 0) start = i;
    else if (!printable && start >= 0) {
      if (i - start >= 6) runs.push(new TextDecoder("latin1").decode(bytes.subarray(start, i)));
      start = -1;
    }
  }
  return runs;
}

const RUNTIME = join(ROOT, "runtime");
const runtimeDirs = readdirSync(RUNTIME).map(name => join(RUNTIME, name)).filter(path => statSync(path).isDirectory());

describe("built binaries", () => {
  const binaries = [
    ...filesUnder(join(ROOT, "src/assets/codeinjection")),
    ...runtimeDirs.flatMap(dir => filesUnder(join(dir, "build"))),
  ].filter(path => !/\.(json|md|txt|ts|js)$/.test(path));

  it("hold no absolute paths, usernames or home folders", () => {
    expect(binaries.length).toBeGreaterThan(0);
    const leaks = binaries.flatMap(path => {
      const hit = printableRuns(readFileSync(path)).find(run => MACHINE_PATH.test(run));
      return hit ? [`${relative(ROOT, path)}: ${hit.slice(0, 120)}`] : [];
    });
    // Fix the build script's path flags and rebuild; never patch the binary by hand.
    expect(leaks).toEqual([]);
  });
});

describe("C build scripts", () => {
  const compiles = (text: string) => /arm-none-eabi-g(cc|\+\+)/.test(text);
  const scripts = [RUNTIME, ...runtimeDirs].flatMap(dir => readdirSync(dir)
    .filter(name => /^build.*\.py$|_build\.py$/.test(name))
    .map(name => join(dir, name)))
    .filter(path => compiles(readFileSync(path, "utf8")));
  // A script may take its flags from a helper module beside it, as item-expansion does.
  const mapsRepoRoot = (path: string) => readdirSync(dirname(path)).filter(name => name.endsWith(".py")).some(name => {
    const text = readFileSync(join(dirname(path), name), "utf8");
    return /-ffile-prefix-map=/.test(text) || (/-fmacro-prefix-map=/.test(text) && /-fdebug-prefix-map=/.test(text));
  });

  it("map the repo root out of __FILE__ and debug info", () => {
    expect(scripts.length).toBeGreaterThan(0);
    const missing = scripts.filter(path => !mapsRepoRoot(path)).map(path => relative(ROOT, path)).sort();
    const known = new Set<string>(unmapped);
    // New scripts need the flags. Older scripts listed in fixtures/unmappedBuildScripts.json predate the rule; their
    // binaries pass the scan above, but each still needs the flags (and a rebuild of everything it produces).
    expect(missing.filter(path => !known.has(path))).toEqual([]);
    // Once a listed script gains the flags, take it off the list so it can't lose them again.
    expect(unmapped.filter(path => !missing.includes(path))).toEqual([]);
  });

  it("lists only real scripts", () => {
    expect(unmapped.filter(path => !existsSync(join(ROOT, path)) || !basename(path).endsWith(".py"))).toEqual([]);
  });
});
