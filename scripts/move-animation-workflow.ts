import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { decompileMoveAnimationBytes, parseMoveAnimationScript } from "../src/pokeweb/moveAnimationModel";

const MOVE_ANIMATION_NARC = "a/0/6/5";
const MOVE_SPA_NARC = "a/0/0/6";
const DEFAULT_MIRROR_REPO = "../White2Upgrade";
const DEFAULT_BUILD_REPO = "/path/to/White2Upgrade-Original-pokeweb";

type ParsedArgs = {
  command?: string;
  options: Map<string, string[]>;
};

type StageTarget = "mirror" | "build";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.options.has("help") || args.options.has("h")) {
    printHelp();
    return;
  }
  if (args.command === "brief") {
    briefCommand();
    return;
  }
  if (args.command === "next-spa") {
    await nextSpaCommand(args);
    return;
  }
  if (args.command === "stage") {
    await stageCommand(args);
    return;
  }
  if (args.command === "verify-built") {
    await verifyBuiltCommand(args);
    return;
  }
  if (args.command === "scaffold") {
    await scaffoldCommand(args);
    return;
  }
  throw new Error(`Unknown command: ${args.command}`);
}

function briefCommand(): void {
  console.log(`
Move animation workflow quick brief

Core rules
- Visible battle animation belongs in VM move scripts and SPA assets, not C/C++.
- W2U Gen 6+ custom move animation overrides live in White2Upgrade/data/graphics/move_animations/5_XXXXXXXX.bin.
- Move SPA overrides live in White2Upgrade/data/graphics/move_spas/6_XXXXXXXX.bin and are referenced by LoadSPA/DoSPA* IDs.
- Use generator scripts under work/<slug>/ as source of truth; generated .bin files are build inputs.
- Donor recolors must inspect resource color, texture/palette colors, child color, alpha animation, and color animation curves.

High-value references
- docs/move-animation-workflow-review.md
- White2Upgrade/data/graphics/move_animations/README.md
- White2Upgrade/data/graphics/move_spas/README.md
- Pokeweb-Serverless/scripts/move-animation-helper.ts
- Pokeweb-Serverless/scripts/move-animation-index.ts

Common commands
- npm run moveanim:helper -- extract --rom ../cleanwhite2.nds --moves <ids> --out ../work/<slug>
- npm run moveanim:helper -- compile --script ../work/<slug>/generated/5_XXXXXXXX_<name>.s --out ../work/<slug>/generated/5_XXXXXXXX.bin --move <moveId>
- npm run moveanim:workflow -- next-spa
- npm run moveanim:workflow -- stage --move <moveId> --bin ../work/<slug>/generated/5_XXXXXXXX.bin --spa ../work/<slug>/generated/6_XXXXXXXX.bin
- npm run moveanim:workflow -- verify-built --rom /path/to/White2Upgrade-Original-pokeweb/build/White2Upgrade.nds --move <moveId> --expect-load-spa <id>
`.trim());
}

async function nextSpaCommand(args: ParsedArgs): Promise<void> {
  const repos = values(args, "repo").length ? values(args, "repo") : [DEFAULT_MIRROR_REPO, DEFAULT_BUILD_REPO];
  const allIds = new Set<number>();
  const scanned: Array<{ dir: string; max: number }> = [];
  for (const repoArg of repos) {
    const repo = path.resolve(repoArg);
    const dir = path.join(repo, "data/graphics/move_spas");
    const ids = await listedIds(dir, /^6_0*(\d+)\.bin$/u);
    ids.forEach((id) => allIds.add(id));
    scanned.push({ dir, max: Math.max(...ids) });
  }
  const ids = [...allIds].sort((a, b) => a - b);
  const max = Math.max(...ids);
  const gaps = gapsInRange(ids, Math.max(0, max - 32), max);
  console.log("Move SPA dirs:");
  for (const entry of scanned) console.log(`  ${entry.dir} (max ${entry.max})`);
  console.log(`Highest SPA override: ${max}`);
  console.log(`Next append-style SPA slot: ${max + 1}`);
  if (gaps.length) console.log(`Recent gaps: ${gaps.join(", ")}`);
}

async function stageCommand(args: ParsedArgs): Promise<void> {
  const moveId = Number.parseInt(requiredOption(args, "move"), 10);
  if (!Number.isInteger(moveId) || moveId < 0) throw new Error("--move must be a non-negative integer");
  const bin = requiredOption(args, "bin");
  const spaPaths = values(args, "spa");
  const mirrorRepo = path.resolve(option(args, "mirror") ?? DEFAULT_MIRROR_REPO);
  const buildRepo = option(args, "build-repo") ?? DEFAULT_BUILD_REPO;
  const targets = stageTargets(args);

  for (const target of targets) {
    const repo = target === "mirror" ? mirrorRepo : buildRepo;
    await copyMoveAnimation(repo, moveId, bin);
    for (const spaPath of spaPaths) await copySpa(repo, spaPath);
  }
}

async function verifyBuiltCommand(args: ParsedArgs): Promise<void> {
  const romPath = requiredOption(args, "rom");
  const moveId = Number.parseInt(requiredOption(args, "move"), 10);
  const rom = new NintendoDSRom(new Uint8Array(await readFile(romPath)));
  const moveAnimations = new NARC(rom.getFileByName(MOVE_ANIMATION_NARC));
  const moveSpas = new NARC(rom.getFileByName(MOVE_SPA_NARC));
  const moveBytes = moveAnimations.files[moveId];
  if (!moveBytes) throw new Error(`${MOVE_ANIMATION_NARC} member ${moveId} is missing.`);
  const script = decompileMoveAnimationBytes(moveBytes);
  const parsed = parseMoveAnimationScript(script);
  const loadSpas = new Set<number>();
  const backgrounds = new Set<number>();
  for (const commands of parsed.scripts.values()) {
    for (const command of commands) {
      if (command.name === "LoadSPA" && command.params[0] !== undefined) loadSpas.add(command.params[0]);
      if (command.name === "LoadBackground" && command.params[0] !== undefined) backgrounds.add(command.params[0]);
    }
  }

  for (const expected of numberValues(args, "expect-load-spa")) {
    if (!loadSpas.has(expected)) throw new Error(`Move ${moveId} does not LoadSPA ${expected}; saw ${[...loadSpas].join(",") || "none"}`);
  }
  for (const forbidden of numberValues(args, "forbid-load-spa")) {
    if (loadSpas.has(forbidden)) throw new Error(`Move ${moveId} unexpectedly LoadSPA ${forbidden}`);
  }
  for (const expected of numberValues(args, "expect-background")) {
    if (!backgrounds.has(expected)) throw new Error(`Move ${moveId} does not LoadBackground ${expected}; saw ${[...backgrounds].join(",") || "none"}`);
  }
  for (const expected of numberValues(args, "expect-spa-file")) {
    if (!moveSpas.files[expected]) throw new Error(`${MOVE_SPA_NARC} member ${expected} is missing.`);
  }
  for (const expectedText of values(args, "expect-text")) {
    if (!script.includes(expectedText)) throw new Error(`Move ${moveId} script does not include expected text: ${expectedText}`);
  }

  console.log(`ROM: ${romPath}`);
  console.log(`${MOVE_ANIMATION_NARC}:${moveId} bytes=${moveBytes.length} sha256=${sha256(moveBytes)}`);
  console.log(`LoadSPA ids=${[...loadSpas].sort((a, b) => a - b).join(",") || "none"}`);
  console.log(`LoadBackground ids=${[...backgrounds].sort((a, b) => a - b).join(",") || "none"}`);
  for (const spaId of numberValues(args, "expect-spa-file")) {
    const spaBytes = moveSpas.files[spaId];
    console.log(`${MOVE_SPA_NARC}:${spaId} bytes=${spaBytes.length} sha256=${sha256(spaBytes)}`);
  }
  if (args.options.has("dump-script")) console.log(script);
}

async function scaffoldCommand(args: ParsedArgs): Promise<void> {
  const slug = requiredOption(args, "slug");
  const moveId = Number.parseInt(requiredOption(args, "move"), 10);
  if (!/^[a-z0-9-]+$/u.test(slug)) throw new Error("--slug should use lowercase letters, digits, and dashes only");
  if (!Number.isInteger(moveId) || moveId < 0) throw new Error("--move must be a non-negative integer");
  const generatedName = `5_${moveId.toString().padStart(8, "0")}_${slug.replaceAll("-", "_")}.s`;
  const repoRoot = path.resolve("..");
  const outDir = path.resolve(option(args, "out") ?? `../work/${slug}`);
  if (!isInsideOrEqual(outDir, repoRoot)) throw new Error(`--out must stay inside ${repoRoot}; use the default work/<slug> location for portable scaffold imports.`);
  const serverlessRoot = path.resolve(".");
  const rootRelative = relativeImport(outDir, repoRoot);
  const moveModelImport = relativeImport(outDir, path.join(serverlessRoot, "src/pokeweb/moveAnimationModel"));
  const narcImport = relativeImport(outDir, path.join(serverlessRoot, "src/nds/narc"));
  const romImport = relativeImport(outDir, path.join(serverlessRoot, "src/nds/rom"));
  const scriptForCompile = toPosix(path.relative(serverlessRoot, path.join(outDir, "generated", generatedName)));
  const binForCompile = toPosix(path.relative(serverlessRoot, path.join(outDir, "generated", `5_${moveId.toString().padStart(8, "0")}.bin`)));

  await mkdir(path.join(outDir, "generated"), { recursive: true });
  await writeFile(path.join(outDir, `make-${slug}.ts`), makeGeneratorTemplate(slug, moveId, generatedName, rootRelative, scriptForCompile, binForCompile));
  await writeFile(path.join(outDir, "inspect-generated.ts"), makeInspectGeneratedTemplate(moveId, moveModelImport));
  await writeFile(path.join(outDir, "inspect-built-w2u.ts"), makeInspectBuiltTemplate(moveId, moveModelImport, narcImport, romImport));
  console.log(`Created move animation work scaffold at ${outDir}`);
}

async function copyMoveAnimation(repo: string, moveId: number, source: string): Promise<void> {
  const targetDir = path.join(repo, "data/graphics/move_animations");
  const target = path.join(targetDir, `5_${moveId.toString().padStart(8, "0")}.bin`);
  await mkdir(targetDir, { recursive: true });
  await copyFile(source, target);
  console.log(`Copied ${source} -> ${target}`);
}

async function copySpa(repo: string, source: string): Promise<void> {
  const basename = path.basename(source);
  if (!/^6_0*\d+\.bin$/u.test(basename)) throw new Error(`SPA filename must look like 6_00000779.bin: ${source}`);
  const targetDir = path.join(repo, "data/graphics/move_spas");
  const target = path.join(targetDir, basename);
  await mkdir(targetDir, { recursive: true });
  await copyFile(source, target);
  console.log(`Copied ${source} -> ${target}`);
}

async function listedIds(dir: string, pattern: RegExp): Promise<number[]> {
  const names = await readdir(dir);
  const ids = names.flatMap((name) => {
    const match = pattern.exec(name);
    return match ? [Number.parseInt(match[1] ?? "", 10)] : [];
  });
  if (!ids.length) throw new Error(`No matching files found in ${dir}`);
  return ids.sort((a, b) => a - b);
}

function gapsInRange(ids: number[], start: number, end: number): number[] {
  const set = new Set(ids);
  const gaps: number[] = [];
  for (let id = start; id <= end; id += 1) if (!set.has(id)) gaps.push(id);
  return gaps;
}

function stageTargets(args: ParsedArgs): StageTarget[] {
  const raw = option(args, "target") ?? "both";
  if (raw === "both") return ["mirror", "build"];
  if (raw === "mirror" || raw === "build") return [raw];
  throw new Error("--target must be mirror, build, or both");
}

function makeGeneratorTemplate(slug: string, moveId: number, generatedName: string, rootRelative: string, scriptForCompile: string, binForCompile: string): string {
  return `import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "${rootRelative}");
const WORK_DIR = import.meta.dirname;
const OUT_DIR = path.join(WORK_DIR, "generated");
const OUT_SCRIPT = path.join(OUT_DIR, "${generatedName}");

await mkdir(OUT_DIR, { recursive: true });
const script = makeScript();
await writeFile(OUT_SCRIPT, script);

console.log(\`Wrote \${OUT_SCRIPT}\`);
console.log(\`script sha256 \${sha256(new TextEncoder().encode(script))}\`);
console.log("Compile with: npm run moveanim:helper -- compile --script ${scriptForCompile} --out ${binForCompile} --move ${moveId}");

function makeScript(): string {
  return \`
TerminateMoveScript
\`.trimStart();
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
`;
}

function makeInspectGeneratedTemplate(moveId: number, moveModelImport: string): string {
  return `import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { decompileMoveAnimationBytes, parseMoveAnimationScript } from "${moveModelImport}";

const scriptBytes = new Uint8Array(await readFile(new URL("./generated/5_${moveId.toString().padStart(8, "0")}.bin", import.meta.url)));
const script = decompileMoveAnimationBytes(scriptBytes);
const parsed = parseMoveAnimationScript(script);
const spaIds = new Set<number>();
for (const commands of parsed.scripts.values()) {
  for (const command of commands) if (command.name === "LoadSPA" && command.params[0] !== undefined) spaIds.add(command.params[0]);
}

console.log(\`5_${moveId.toString().padStart(8, "0")}.bin bytes=\${scriptBytes.length} sha256=\${sha256(scriptBytes)}\`);
console.log(\`LoadSPA ids=\${[...spaIds].sort((a, b) => a - b).join(",") || "none"}\`);
console.log(script);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
`;
}

function makeInspectBuiltTemplate(moveId: number, moveModelImport: string, narcImport: string, romImport: string): string {
  return `import { readFile } from "node:fs/promises";
import { NARC } from "${narcImport}";
import { NintendoDSRom } from "${romImport}";
import { decompileMoveAnimationBytes } from "${moveModelImport}";

const romPath = process.argv[2];
if (!romPath) throw new Error("Usage: vite-node inspect-built-w2u.ts <rom.nds>");

const rom = new NintendoDSRom(new Uint8Array(await readFile(romPath)));
const moveAnimations = new NARC(rom.getFileByName("a/0/6/5"));
const bytes = moveAnimations.files[${moveId}];
if (!bytes) throw new Error("a/0/6/5 member ${moveId} is missing.");
console.log(decompileMoveAnimationBytes(bytes));
`;
}

function relativeImport(fromDir: string, targetWithoutExtension: string): string {
  const relative = toPosix(path.relative(fromDir, targetWithoutExtension));
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function isInsideOrEqual(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv[0]?.startsWith("--")) return { command: undefined, options: new Map([[argv[0].slice(2), ["true"]]]) };
  const [command, ...rest] = argv;
  const options = new Map<string, string[]>();
  for (let index = 0; index < rest.length; index += 1) {
    const raw = rest[index];
    if (!raw.startsWith("--")) throw new Error(`Unexpected positional argument: ${raw}`);
    const key = raw.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      options.set(key, [...(options.get(key) ?? []), "true"]);
      continue;
    }
    options.set(key, [...(options.get(key) ?? []), next]);
    index += 1;
  }
  return { command, options };
}

function requiredOption(args: ParsedArgs, key: string): string {
  const value = option(args, key);
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}

function option(args: ParsedArgs, key: string): string | undefined {
  return args.options.get(key)?.at(-1);
}

function values(args: ParsedArgs, key: string): string[] {
  return args.options.get(key) ?? [];
}

function numberValues(args: ParsedArgs, key: string): number[] {
  return values(args, key).map((value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed)) throw new Error(`--${key} expects an integer: ${value}`);
    return parsed;
  });
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function printHelp(): void {
  console.log(`
Move animation workflow helper

Usage:
  npm run moveanim:workflow -- brief
  npm run moveanim:workflow -- next-spa
  npm run moveanim:workflow -- stage --move 621 --bin ../work/hyperspace-fury-darkvoid/generated/5_00000621.bin --spa ../work/hyperspace-fury-darkvoid/generated/6_00000775.bin --spa ../work/hyperspace-fury-darkvoid/generated/6_00000779.bin
  npm run moveanim:workflow -- verify-built --rom /path/to/White2Upgrade-Original-pokeweb/build/White2Upgrade.nds --move 621 --expect-load-spa 775 --expect-load-spa 779 --forbid-load-spa 644 --expect-background 126 --expect-spa-file 775 --expect-spa-file 779
  npm run moveanim:workflow -- scaffold --slug new-move-name --move 624

Commands:
  brief
    Print the short battle animation workflow briefing.

  next-spa
    Report the highest staged SPA override and next likely free slot.
    Options: optional repeated --repo. Defaults to scanning ../White2Upgrade and /path/to/White2Upgrade-Original-pokeweb.

  stage
    Copy generated move animation and SPA binaries into the local mirror and/or W2U build repo.
    Options: --move, --bin, repeated --spa, optional --mirror, optional --build-repo, optional --target mirror|build|both

  verify-built
    Decompile a move animation from a built W2U ROM and assert expected SPAs/backgrounds/text.
    Options: --rom, --move, repeated --expect-load-spa, --forbid-load-spa, --expect-background, --expect-spa-file, --expect-text, optional --dump-script

  scaffold
    Create a minimal work/<slug> generator and inspector skeleton.
    Options: --slug, --move, optional --out. The output directory must stay inside /path/to/Port-Pokeweb.
`.trim());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
