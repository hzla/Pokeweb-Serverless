import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  inspectMoveAnimationZip,
  writeMoveAnimationZipWorkspace,
  type MoveAnimationZipBundle,
} from "./lib/move-animation-zip-import";
import { resolveMoveAnimationWorkflowConfig } from "./lib/move-animation-workflow-config";

const SERVERLESS_ROOT = path.resolve(import.meta.dirname, "..");

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("help") || args.has("h")) {
    printHelp();
    return;
  }

  const zipPath = path.resolve(required(args, "zip"));
  const slug = required(args, "slug");
  const requestedMoveId = args.has("move") ? parseId(required(args, "move"), "--move") : undefined;
  const config = await resolveMoveAnimationWorkflowConfig({ serverlessRoot: SERVERLESS_ROOT });
  const outDir = path.resolve(value(args, "out") ?? path.join(config.workspaceRoot, "work", slug));
  const zipBytes = new Uint8Array(await readFile(zipPath));
  const bundle = inspectMoveAnimationZip(zipBytes, requestedMoveId);

  await assertSpaSlotsDoNotConflict(bundle, [config.values.mirrorRepo, config.values.buildRepo]);
  await assertActiveReservationsDoNotConflict(bundle, path.join(config.workspaceRoot, "work"), outDir);

  const generatorModule = path.join(SERVERLESS_ROOT, "scripts/lib/move-animation-zip-import");
  const manifestPath = await writeMoveAnimationZipWorkspace({
    bundle,
    outDir,
    slug,
    sourceArchiveName: path.basename(zipPath),
    sourceArchiveSha256: sha256(zipBytes),
    generatorImportPath: moduleImportPath(outDir, generatorModule),
  });

  console.log(`Imported move ${bundle.moveId} with ${bundle.spas.length} SPA file(s) into ${outDir}`);
  console.log(`Manifest: ${manifestPath}`);
  if (bundle.ignoredEntries.length) console.log(`Ignored inert entries: ${bundle.ignoredEntries.join(", ")}`);

  if (args.has("finish")) {
    await runFinish(manifestPath);
  } else {
    console.log(`Finish with: npm run moveanim:workflow -- finish --manifest ${manifestPath}`);
  }
}

async function assertSpaSlotsDoNotConflict(bundle: MoveAnimationZipBundle, repositories: string[]): Promise<void> {
  for (const spa of bundle.spas) {
    const name = `6_${spa.id.toString().padStart(8, "0")}.bin`;
    for (const repository of repositories) {
      const stagedPath = path.join(repository, "data/graphics/move_spas", name);
      try {
        const existing = new Uint8Array(await readFile(stagedPath));
        if (!bytesEqual(existing, spa.bytes)) throw new Error(`SPA ${spa.id} conflicts with existing staged file ${stagedPath}.`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}

async function assertActiveReservationsDoNotConflict(
  bundle: MoveAnimationZipBundle,
  workRoot: string,
  outDir: string,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(workRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const wanted = new Set(bundle.spas.map((spa) => spa.id));
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "archive") continue;
    const manifestPath = path.join(workRoot, entry.name, "moveanim.json");
    if (path.resolve(path.dirname(manifestPath)) === path.resolve(outDir)) continue;
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { reservedSpaIds?: number[] };
      const conflicts = (manifest.reservedSpaIds ?? []).filter((id) => wanted.has(id));
      if (conflicts.length) throw new Error(`SPA ${conflicts.join(", ")} is already reserved by ${manifestPath}.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function runFinish(manifestPath: string): Promise<void> {
  const viteNode = path.join(SERVERLESS_ROOT, "node_modules/.bin/vite-node");
  const workflow = path.join(SERVERLESS_ROOT, "scripts/move-animation-workflow.ts");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(viteNode, [workflow, "finish", "--manifest", manifestPath], {
      cwd: SERVERLESS_ROOT,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`moveanim:workflow finish failed (${signal ?? code ?? "unknown"}).`));
    });
  });
}

function parseArgs(argv: string[]): Map<string, string[]> {
  const args = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw?.startsWith("--")) throw new Error(`Unexpected positional argument: ${raw}`);
    const key = raw.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) args.set(key, [...(args.get(key) ?? []), "true"]);
    else {
      args.set(key, [...(args.get(key) ?? []), next]);
      index += 1;
    }
  }
  return args;
}

function required(args: Map<string, string[]>, key: string): string {
  const result = value(args, key);
  if (!result || result === "true") throw new Error(`Missing required --${key}`);
  return result;
}

function value(args: Map<string, string[]>, key: string): string | undefined {
  return args.get(key)?.at(-1);
}

function parseId(raw: string, label: string): number {
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id < 0 || String(id) !== raw.trim()) throw new Error(`${label} must be a non-negative integer.`);
  return id;
}

function moduleImportPath(fromDirectory: string, modulePath: string): string {
  const relative = path.relative(fromDirectory, modulePath).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function printHelp(): void {
  console.log(`
Import a move-animation zip into a generator-backed workspace.

Usage:
  npm run moveanim:import-zip -- --zip <bundle.zip> --slug <slug> [--move <id>] [--out <dir>] [--finish]

Accepted assets:
  move_<id>_animation.bin or 5_<8-digit-id>.bin
  zero or more spa_<id>.spa or 6_<8-digit-id>.bin files

Every SPA loaded directly by the script must be present, and every bundled SPA must be used.
Use --finish to generate, compile, lint, stage, build, verify, and copy White2Upgrade.nds.
`.trim());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
