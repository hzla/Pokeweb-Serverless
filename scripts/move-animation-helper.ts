import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readU16 } from "../src/nds/binary";
import { decompressCode } from "../src/nds/codeCompression";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { VERSION_BY_ARM9_SAMPLE, type BaseRom, type BaseVersion } from "../src/pokeweb/constants";
import { compileMoveAnimation, decompileMoveAnimationBytes, parseMoveAnimationScript } from "../src/pokeweb/moveAnimationModel";
import type { ProjectState } from "../src/pokeweb/projectStore";

const MOVE_SPA_PATH = "a/0/0/6";
const BATTLE_ANIMATION_OFFSET = 561;
const SPA_COMMANDS = new Set([
  "LoadSPA",
  "Emit",
  "EmitFromCoordinates",
  "EmitOrtho",
  "EmitAll",
  "EmitProjectile",
  "EmitProjectileFromCoordinates",
  "EmitOrthoProjectile",
  "EmitOrthoProjectileFromCoordinates",
  "EmitCircle",
  "EmitOrthoCircle",
  "DoSPAAnimation",
  "DoSPAScreenAnimation",
  "DoSPAAnimation2",
  "DoSPAAllAnimations",
  "DoSPAProjectileAnimation",
  "DoSPAProjectileAnimation2",
  "DoSPAProjectileAnimation3",
  "DoSPAProjectileAnimationOrthoCoordinate",
  "DoSPACircleAnimation",
  "DoSPAOrthoCircleAnimation",
]);

type RomVersion = {
  baseRom: BaseRom;
  baseVersion: BaseVersion;
};

type AnimationPaths = {
  moveAnimations: string;
  battleAnimations: string;
};

const ANIMATION_PATHS: Record<BaseRom, AnimationPaths> = {
  BW: { moveAnimations: "a/0/6/6", battleAnimations: "a/0/6/7" },
  BW2: { moveAnimations: "a/0/6/5", battleAnimations: "a/0/6/6" },
};

type ParsedArgs = {
  command?: string;
  options: Map<string, string[]>;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.options.has("help") || args.options.has("h")) {
    printHelp();
    return;
  }

  if (args.command === "extract") {
    await extractCommand(args);
    return;
  }
  if (args.command === "compile") {
    await compileCommand(args);
    return;
  }
  if (args.command === "append-spa") {
    await appendSpaCommand(args);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

async function extractCommand(args: ParsedArgs): Promise<void> {
  const romPath = requiredOption(args, "rom");
  const outDir = requiredOption(args, "out");
  const moveIds = parseMoveIds(requiredOption(args, "moves"));
  const rom = new NintendoDSRom(await readFileBytes(romPath));
  const version = detectRomVersion(rom, option(args, "base"));
  const paths = ANIMATION_PATHS[version.baseRom];
  const moveAnimations = new NARC(rom.getFileByName(paths.moveAnimations));
  const battleAnimations = new NARC(rom.getFileByName(paths.battleAnimations));
  const moveSpas = new NARC(rom.getFileByName(MOVE_SPA_PATH));
  const manifest = {
    rom: path.basename(romPath),
    baseRom: version.baseRom,
    baseVersion: version.baseVersion,
    moveSpaPath: MOVE_SPA_PATH,
    moves: [] as Array<{
      moveId: number;
      sourcePath: string;
      fileIndex: number;
      binary: string;
      script: string;
      spaIds: number[];
      spas: string[];
    }>,
  };

  await mkdir(outDir, { recursive: true });
  for (const moveId of moveIds) {
    const target = animationTarget(moveId, moveAnimations, battleAnimations, paths);
    const bytes = target.narc.files[target.index];
    if (!bytes) throw new Error(`Move ${moveId} animation file ${target.index} is missing from ${target.sourcePath}`);
    const script = decompileMoveAnimationBytes(bytes);
    const binaryName = `move_${moveId}_animation.bin`;
    const scriptName = `move_${moveId}_animation.s`;
    await writeFile(path.join(outDir, binaryName), bytes);
    await writeFile(path.join(outDir, scriptName), script);

    const spaIds = referencedSpaIds(script);
    const spaNames: string[] = [];
    for (const spaId of spaIds) {
      const spaBytes = moveSpas.files[spaId];
      if (!spaBytes) throw new Error(`Move ${moveId} references missing SPA ${spaId}`);
      const spaName = `spa_${spaId}.spa`;
      await writeFile(path.join(outDir, spaName), spaBytes);
      spaNames.push(spaName);
    }

    manifest.moves.push({
      moveId,
      sourcePath: target.sourcePath,
      fileIndex: target.index,
      binary: binaryName,
      script: scriptName,
      spaIds,
      spas: spaNames,
    });
  }

  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Extracted ${moveIds.length} move animation(s) to ${outDir}`);
}

async function compileCommand(args: ParsedArgs): Promise<void> {
  const scriptPath = requiredOption(args, "script");
  const outPath = requiredOption(args, "out");
  const moveId = Number.parseInt(option(args, "move") ?? "0", 10);
  const scriptText = await readFile(scriptPath, "utf8");
  const bytes = compileMoveAnimation(dummyProject(), moveId, scriptText);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, bytes);
  console.log(`Wrote ${bytes.length} byte(s) to ${outPath}`);
}

async function appendSpaCommand(args: ParsedArgs): Promise<void> {
  const romPath = requiredOption(args, "rom");
  const outPath = requiredOption(args, "out");
  const spaPaths = values(args, "spa");
  if (spaPaths.length === 0) throw new Error("append-spa requires at least one --spa <file.spa>");

  const romBytes = await readFileBytes(romPath);
  const rom = new NintendoDSRom(romBytes);
  const moveSpaFileId = rom.fileId(MOVE_SPA_PATH);
  const moveSpas = new NARC(rom.files[moveSpaFileId]);
  const appended: Array<{ source: string; spaId: number; size: number }> = [];

  for (const spaPath of spaPaths) {
    const bytes = await readFileBytes(spaPath);
    const spaId = moveSpas.files.length;
    moveSpas.files.push(bytes);
    appended.push({ source: spaPath, spaId, size: bytes.length });
  }

  const nextRom = rom.save({ files: new Map([[moveSpaFileId, moveSpas.save()]]) });
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, nextRom);

  const manifestPath = option(args, "manifest");
  if (manifestPath) {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          sourceRom: romPath,
          outputRom: outPath,
          moveSpaPath: MOVE_SPA_PATH,
          moveSpaFileId,
          appended,
        },
        null,
        2,
      )}\n`,
    );
  }

  console.log(`Appended ${appended.length} SPA file(s) into ${MOVE_SPA_PATH}:`);
  for (const entry of appended) console.log(`  SPA ${entry.spaId}: ${entry.source} (${entry.size} bytes)`);
  console.log(`Wrote ROM: ${outPath}`);
}

function animationTarget(moveId: number, moveAnimations: NARC, battleAnimations: NARC, paths: AnimationPaths): { narc: NARC; sourcePath: string; index: number } {
  if (moveId > 559) return { narc: battleAnimations, sourcePath: paths.battleAnimations, index: moveId - BATTLE_ANIMATION_OFFSET };
  return { narc: moveAnimations, sourcePath: paths.moveAnimations, index: moveId };
}

function referencedSpaIds(scriptText: string): number[] {
  const parsed = parseMoveAnimationScript(scriptText);
  const ids = new Set<number>();
  for (const commands of parsed.scripts.values()) {
    for (const command of commands) {
      if (SPA_COMMANDS.has(command.name) && command.params.length > 0) ids.add(command.params[0] ?? 0);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

function detectRomVersion(rom: NintendoDSRom, forced?: string): RomVersion {
  if (forced) {
    const normalized = forced.toUpperCase();
    if (normalized === "BW") return { baseRom: "BW", baseVersion: "W" };
    if (normalized === "BW2") return { baseRom: "BW2", baseVersion: "W2" };
    throw new Error(`Unsupported --base value: ${forced}`);
  }
  const arm9 = decompressCode(rom.arm9);
  return VERSION_BY_ARM9_SAMPLE[readU16(arm9, 14)] ?? { baseRom: "BW2", baseVersion: "W2" };
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv[0]?.startsWith("--")) return { options: new Map([[argv[0].slice(2), ["true"]]]) };
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

function parseMoveIds(value: string): number[] {
  const ids = value
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => Number.isInteger(id) && id >= 0);
  if (ids.length === 0) throw new Error("No valid move IDs were provided");
  return ids;
}

async function readFileBytes(filePath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(filePath));
}

function dummyProject(): ProjectState {
  return {
    session: { romName: "helper", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "helper", idCode: "HELP", fileName: "helper.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}

function printHelp(): void {
  console.log(`
Move animation helper

Usage:
  npm run moveanim:helper -- extract --rom cleanwhite2.nds --moves 8,127 --out work/jet-punch-sources
  npm run moveanim:helper -- compile --script work/jet-punch.s --out work/jet-punch.bin
  npm run moveanim:helper -- append-spa --rom cleanwhite2.nds --spa custom.spa --out cleanwhite2-extra-spa.nds --manifest work/appended-spa.json

Commands:
  extract
    Decompile raw move animation binaries to semantic scripts and export referenced SPA files.
    Options: --rom, --moves comma-separated IDs, --out, optional --base BW|BW2

  compile
    Compile a semantic or numeric move animation script to raw binary.
    Options: --script, --out, optional --move <id>

  append-spa
    Append one or more .spa files to a ROM's move_spas NARC and report the new SPA IDs.
    Options: --rom, repeated --spa, --out, optional --manifest

Notes:
  Extracted scripts use friendly command names and parameters, e.g. EmitProjectile with SIDE_ATTACKER, 2px, 30f, and 1x tokens.
  Raw integers, hex values, legacy DoSPA* names, and CMD_* aliases still compile for older scripts.
  This helper does not create sound banks or sound effects.
  Appended SPA files are referenced by the printed SPA IDs in LoadSPA/Emit* commands.
`.trim());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
