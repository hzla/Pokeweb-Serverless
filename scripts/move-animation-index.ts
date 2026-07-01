import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import moveNamesText from "../src/assets/data/vanilla_moves.txt?raw";
import { readU16 } from "../src/nds/binary";
import { decompressCode } from "../src/nds/codeCompression";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { VERSION_BY_ARM9_SAMPLE, type BaseRom, type BaseVersion } from "../src/pokeweb/constants";
import { getMoveAnimationDisplayCommandName } from "../src/pokeweb/moveAnimationCommandNames";
import { decompileMoveAnimationBytes, parseMoveAnimationScript, type ParsedMoveAnimationCommand } from "../src/pokeweb/moveAnimationModel";
import { parseSpaArchive } from "../src/pokeweb/nitroSpa";
import { decodeGen5TextBank } from "../src/pokeweb/text";

const MOVE_SPA_PATH = "a/0/0/6";
const MESSAGE_TEXT_PATH = "a/0/0/2";
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
const BACKGROUND_COMMANDS = new Set(["LoadBackground"]);
const SOUND_COMMANDS = new Set(["PlaySound", "AdjustSound", "SwitchAudioSide", "AudioContainer"]);
const CAMERA_COMMANDS = new Set(["MoveCamera", "AdjustCamera", "CameraMoveAngle", "CameraProjection", "CameraPosPush", "ShakeScreen", "ShakeSprite"]);

type RomVersion = {
  baseRom: BaseRom;
  baseVersion: BaseVersion;
};

type AnimationPaths = {
  moveAnimations: string;
  battleAnimations: string;
};

type ParsedArgs = {
  options: Map<string, string[]>;
};

type SpaDocEntry = {
  id: number;
  name: string;
  emitters?: number;
  particles?: string;
  description: string;
  notes: string;
  tags: string[];
};

type BackgroundDocEntry = {
  id: number;
  name: string;
  moves: string[];
  tags: string[];
};

type MoveIndexEntry = {
  moveId: number;
  moveName: string;
  moveDescription: string;
  sourcePath: string;
  fileIndex: number;
  byteLength: number;
  estimatedWaitFrames: number;
  commandCount: number;
  commandNames: string[];
  spaIds: number[];
  spaResources: Array<{ spaId: number; resourceId?: number; commands: string[]; description?: string; tags: string[] }>;
  backgroundIds: number[];
  backgrounds: Array<{ backgroundId: number; moves: string[]; tags: string[] }>;
  soundIds: number[];
  cameraCommands: string[];
  hasSpecialBackground: boolean;
  tags: string[];
  summary: string;
  error?: string;
};

type ReferenceIndex = {
  generatedAt: string;
  rom: string;
  baseRom: BaseRom;
  baseVersion: BaseVersion;
  docs: {
    spaDocPath?: string;
    backgroundDocPath?: string;
    moveDescriptionBank: number;
  };
  moves: MoveIndexEntry[];
  spas: SpaDocEntry[];
  backgrounds: BackgroundDocEntry[];
};

const ANIMATION_PATHS: Record<BaseRom, AnimationPaths> = {
  BW: { moveAnimations: "a/0/6/6", battleAnimations: "a/0/6/7" },
  BW2: { moveAnimations: "a/0/6/5", battleAnimations: "a/0/6/6" },
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.options.has("help") || args.options.has("h")) {
    printHelp();
    return;
  }
  const romPath = requiredOption(args, "rom");
  const docsDir = option(args, "docs") ?? "../moveanimationdocs";
  const outDir = option(args, "out") ?? "move-animation-reference";

  const rom = new NintendoDSRom(await readFileBytes(romPath));
  const version = detectRomVersion(rom, option(args, "base"));
  const spaDocs = await loadSpaDocs(path.join(docsDir, version.baseRom === "BW2" ? "SPA Documentation(BW2).html" : "SPA Documentation (BW).html"));
  const backgroundDocs = await loadBackgroundDocs(path.join(docsDir, version.baseRom === "BW2" ? "Background List (B2W2).html" : "Background List (BW).html"));
  const index = buildIndex(rom, version, romPath, spaDocs, backgroundDocs);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "move-animation-reference.json"), `${JSON.stringify(index, null, 2)}\n`);
  await writeFile(path.join(outDir, "move-animation-reference.md"), renderMarkdown(index));
  await writeFile(path.join(outDir, "spa-reference.json"), `${JSON.stringify(index.spas, null, 2)}\n`);
  await writeFile(path.join(outDir, "background-reference.json"), `${JSON.stringify(index.backgrounds, null, 2)}\n`);
  console.log(`Indexed ${index.moves.length} move animation(s), ${index.spas.length} SPA doc row(s), and ${index.backgrounds.length} background row(s).`);
  console.log(`Wrote reference files to ${outDir}`);
}

function buildIndex(
  rom: NintendoDSRom,
  version: RomVersion,
  romPath: string,
  spaDocs: SpaDocEntry[],
  backgroundDocs: BackgroundDocEntry[],
): ReferenceIndex {
  const paths = ANIMATION_PATHS[version.baseRom];
  const moveAnimations = new NARC(rom.getFileByName(paths.moveAnimations));
  const battleAnimations = new NARC(rom.getFileByName(paths.battleAnimations));
  const moveSpas = new NARC(rom.getFileByName(MOVE_SPA_PATH));
  const moveDescriptions = loadMoveDescriptions(rom, version.baseRom);
  const moveNames = parseMoveNames();
  const spaDocById = new Map(spaDocs.map((entry) => [entry.id, entry]));
  const backgroundDocById = new Map(backgroundDocs.map((entry) => [entry.id, entry]));
  const moves: MoveIndexEntry[] = [];

  for (let moveId = 1; moveId < moveAnimations.files.length; moveId += 1) {
    moves.push(indexMove(moveId, paths.moveAnimations, moveId, moveAnimations.files[moveId], moveNames, moveDescriptions, spaDocById, backgroundDocById, moveSpas));
  }
  for (let index = 0; index < battleAnimations.files.length; index += 1) {
    const moveId = BATTLE_ANIMATION_OFFSET + index;
    moves.push(indexMove(moveId, paths.battleAnimations, index, battleAnimations.files[index], moveNames, moveDescriptions, spaDocById, backgroundDocById, moveSpas));
  }

  return {
    generatedAt: new Date().toISOString(),
    rom: path.basename(romPath),
    baseRom: version.baseRom,
    baseVersion: version.baseVersion,
    docs: {
      spaDocPath: version.baseRom === "BW2" ? "SPA Documentation(BW2).html" : "SPA Documentation (BW).html",
      backgroundDocPath: version.baseRom === "BW2" ? "Background List (B2W2).html" : "Background List (BW).html",
      moveDescriptionBank: version.baseRom === "BW2" ? 402 : 202,
    },
    moves,
    spas: spaDocs,
    backgrounds: backgroundDocs,
  };
}

function indexMove(
  moveId: number,
  sourcePath: string,
  fileIndex: number,
  bytes: Uint8Array | undefined,
  moveNames: Map<number, string>,
  moveDescriptions: Map<number, string>,
  spaDocById: Map<number, SpaDocEntry>,
  backgroundDocById: Map<number, BackgroundDocEntry>,
  moveSpas: NARC,
): MoveIndexEntry {
  const moveName = moveNames.get(moveId) ?? `Move ${moveId}`;
  const moveDescription = moveDescriptions.get(moveId) ?? "";
  const base: MoveIndexEntry = {
    moveId,
    moveName,
    moveDescription,
    sourcePath,
    fileIndex,
    byteLength: bytes?.length ?? 0,
    estimatedWaitFrames: 0,
    commandCount: 0,
    commandNames: [],
    spaIds: [],
    spaResources: [],
    backgroundIds: [],
    backgrounds: [],
    soundIds: [],
    cameraCommands: [],
    hasSpecialBackground: false,
    tags: [],
    summary: "",
  };
  if (!bytes || bytes.length < 4) return { ...base, error: "Missing or empty animation binary" };

  try {
    const script = decompileMoveAnimationBytes(bytes);
    const parsed = parseMoveAnimationScript(script);
    const commands = [...parsed.scripts.values()].flat();
    const commandNames = unique(commands.map((command) => getMoveAnimationDisplayCommandName(command.name)));
    const spaResourceMap = new Map<string, { spaId: number; resourceId?: number; commands: Set<string>; tags: Set<string> }>();
    const spaIds = new Set<number>();
    const backgroundIds = new Set<number>();
    const soundIds = new Set<number>();
    const cameraCommands = new Set<string>();
    let estimatedWaitFrames = 0;

    for (const command of commands) {
      if (command.name === "Wait") estimatedWaitFrames += Math.max(0, command.params[0] ?? 0);
      if (SPA_COMMANDS.has(command.name) && command.params.length > 0) {
        const spaId = command.params[0] ?? 0;
        const resourceId = command.name === "LoadSPA" ? undefined : command.params[1];
        spaIds.add(spaId);
        const doc = spaDocById.get(spaId);
        const tags = new Set([...(doc?.tags ?? []), ...tagsFromSpaBinary(moveSpas.files[spaId])]);
        const key = `${spaId}:${resourceId ?? "load"}`;
        const entry = spaResourceMap.get(key) ?? { spaId, resourceId, commands: new Set<string>(), tags: new Set<string>() };
        entry.commands.add(getMoveAnimationDisplayCommandName(command.name));
        for (const tag of tags) entry.tags.add(tag);
        spaResourceMap.set(key, entry);
      }
      if (BACKGROUND_COMMANDS.has(command.name) && command.params.length > 0) backgroundIds.add(command.params[0] ?? 0);
      if (command.name === "PlaySound" && command.params.length > 0) soundIds.add(command.params[0] ?? 0);
      if (CAMERA_COMMANDS.has(command.name)) cameraCommands.add(command.name);
    }

    const spaResources = [...spaResourceMap.values()].map((entry) => ({
      spaId: entry.spaId,
      resourceId: entry.resourceId,
      commands: [...entry.commands].sort(),
      description: spaDocById.get(entry.spaId)?.description,
      tags: [...entry.tags].sort(),
    }));
    const backgrounds = [...backgroundIds].sort((a, b) => a - b).map((backgroundId) => ({
      backgroundId,
      moves: backgroundDocById.get(backgroundId)?.moves ?? [],
      tags: backgroundDocById.get(backgroundId)?.tags ?? [],
    }));
    const tags = inferMoveTags(moveName, moveDescription, commands, spaResources, backgrounds);
    const summary = summarizeMove(moveName, moveDescription, [...spaIds], backgrounds, tags, commandNames);

    return {
      ...base,
      estimatedWaitFrames,
      commandCount: commands.length,
      commandNames,
      spaIds: [...spaIds].sort((a, b) => a - b),
      spaResources,
      backgroundIds: [...backgroundIds].sort((a, b) => a - b),
      backgrounds,
      soundIds: [...soundIds].sort((a, b) => a - b),
      cameraCommands: [...cameraCommands].sort(),
      hasSpecialBackground: backgroundIds.size > 0,
      tags,
      summary,
    };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}

function inferMoveTags(
  moveName: string,
  moveDescription: string,
  commands: ParsedMoveAnimationCommand[],
  spaResources: MoveIndexEntry["spaResources"],
  backgrounds: MoveIndexEntry["backgrounds"],
): string[] {
  const text = [
    moveName,
    moveDescription,
    ...spaResources.flatMap((entry) => [entry.description ?? "", ...entry.tags]),
    ...backgrounds.flatMap((entry) => [...entry.moves, ...entry.tags]),
    ...commands.map((command) => command.name),
  ].join(" ");
  const tags = new Set(tagsFromText(text));
  if (commands.some((command) => command.name.includes("Projectile"))) tags.add("projectile");
  if (commands.some((command) => command.name.includes("Screen"))) tags.add("screen-wide");
  if (commands.some((command) => command.name === "ShakeScreen" || command.name === "ShakeSprite")) tags.add("shake");
  if (commands.some((command) => CAMERA_COMMANDS.has(command.name))) tags.add("camera");
  if (backgrounds.length > 0) tags.add("background");
  return [...tags].sort();
}

function summarizeMove(moveName: string, moveDescription: string, spaIds: number[], backgrounds: MoveIndexEntry["backgrounds"], tags: string[], commandNames: string[]): string {
  const parts = [`${moveName}`];
  if (moveDescription) parts.push(moveDescription);
  if (tags.length) parts.push(`tags: ${tags.slice(0, 10).join(", ")}`);
  if (spaIds.length) parts.push(`SPAs: ${spaIds.join(", ")}`);
  if (backgrounds.length) parts.push(`backgrounds: ${backgrounds.map((entry) => entry.backgroundId).join(", ")}`);
  parts.push(`commands: ${commandNames.slice(0, 8).join(", ")}`);
  return parts.join(" / ");
}

function tagsFromSpaBinary(bytes?: Uint8Array): string[] {
  if (!bytes || bytes.length < 32) return [];
  try {
    const archive = parseSpaArchive(bytes);
    const tags = new Set<string>();
    for (const resource of archive.resources) {
      const [r, g, b] = resource.color;
      if (b > 0.65 && r < 0.45) tags.add("blue");
      if (r > 0.65 && g < 0.45 && b < 0.45) tags.add("red");
      if (g > 0.65 && r < 0.55) tags.add("green");
      if (r > 0.7 && g > 0.7 && b < 0.4) tags.add("yellow");
      if (r > 0.75 && g > 0.75 && b > 0.75) tags.add("white");
      if (resource.childResource) tags.add("child-particles");
      if (resource.behaviors.some((behavior) => behavior.type === "gravity")) tags.add("falling");
      if (resource.behaviors.some((behavior) => behavior.type === "spin")) tags.add("spin");
      if (resource.emissionType === 2 || resource.emissionType === 3) tags.add("ring");
      if (resource.emissionType === 4 || resource.emissionType === 8 || resource.emissionType === 9) tags.add("burst");
      if (resource.drawType > 0) tags.add("directional");
    }
    return [...tags];
  } catch {
    return [];
  }
}

async function loadSpaDocs(filePath: string): Promise<SpaDocEntry[]> {
  const rows = parseHtmlTableRows(await readFile(filePath, "utf8"));
  const out: SpaDocEntry[] = [];
  for (const row of rows.slice(2)) {
    const id = idFromCommand(row[1] ?? "", "LoadSPA");
    if (id === undefined) continue;
    const description = row[4] ?? "";
    const notes = row[5] ?? "";
    out.push({
      id,
      name: row[1] ?? `LoadSPA ${id}`,
      emitters: numberOrUndefined(row[2]),
      particles: row[3] || undefined,
      description,
      notes,
      tags: tagsFromText(`${description} ${notes}`),
    });
  }
  return out;
}

async function loadBackgroundDocs(filePath: string): Promise<BackgroundDocEntry[]> {
  const rows = parseHtmlTableRows(await readFile(filePath, "utf8"));
  const out: BackgroundDocEntry[] = [];
  for (const row of rows.slice(2)) {
    const id = idFromCommand(row[1] ?? "", "LoadBackground");
    if (id === undefined) continue;
    const moves = (row[2] ?? "")
      .split(",")
      .map((move) => move.trim())
      .filter(Boolean);
    out.push({
      id,
      name: row[1] ?? `LoadBackground ${id}`,
      moves,
      tags: tagsFromText(moves.join(" ")),
    });
  }
  return out;
}

function parseHtmlTableRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/giu)) {
      row.push(decodeHtml(stripTags(cellMatch[1])).replace(/\s+/gu, " ").trim());
    }
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

function stripTags(value: string): string {
  return value.replace(/<br\s*\/?>/giu, " ").replace(/<[^>]+>/gu, " ");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&#(\d+);/gu, (_match, code) => String.fromCharCode(Number(code)));
}

function idFromCommand(value: string, command: string): number | undefined {
  const match = new RegExp(`${command}\\s+(\\d+)`, "iu").exec(value);
  if (!match) return undefined;
  return Number.parseInt(match[1], 10);
}

function tagsFromText(value: string): string[] {
  const text = value.toLowerCase();
  const dictionary: Array<[string, RegExp]> = [
    ["water", /\b(water|bubble|aqua|hydro|surf|wave|rain|steam)\b/u],
    ["fire", /\b(fire|flame|burn|ember|blast|heat|lava)\b/u],
    ["ice", /\b(ice|icy|freeze|frost|snow|blizzard|hail)\b/u],
    ["electric", /\b(electric|thunder|bolt|shock|lightning|spark)\b/u],
    ["rock", /\b(rock|stone|boulder|sand|ground|earth|gem|diamond|crystal)\b/u],
    ["grass", /\b(grass|leaf|leaves|vine|seed|petal|flower|plant)\b/u],
    ["poison", /\b(poison|toxic|sludge|acid|gunk)\b/u],
    ["psychic", /\b(psychic|psy|mind|dream|hypno|confusion)\b/u],
    ["dark", /\b(dark|night|shadow|black)\b/u],
    ["light", /\b(light|flash|shine|sparkle|star|glow|white)\b/u],
    ["punch", /\b(punch|fist|hit|strike|impact|kick|contact)\b/u],
    ["slash", /\b(slash|cut|claw|scratch|blade)\b/u],
    ["beam", /\b(beam|laser|ray|cannon)\b/u],
    ["storm", /\b(storm|twister|tornado|wind|hurricane|cyclone)\b/u],
    ["explosion", /\b(explosion|explode|blast|burst|boom)\b/u],
    ["heal", /\b(heal|recover|wish|lunar dance)\b/u],
    ["status", /\b(sleep|poison|paraly|confus|burn|freeze)\b/u],
  ];
  return dictionary.filter(([, regex]) => regex.test(text)).map(([tag]) => tag);
}

function renderMarkdown(index: ReferenceIndex): string {
  const tagged = new Map<string, MoveIndexEntry[]>();
  for (const move of index.moves) {
    for (const tag of move.tags) {
      const bucket = tagged.get(tag) ?? [];
      bucket.push(move);
      tagged.set(tag, bucket);
    }
  }
  const lines: string[] = [
    "# Move Animation Reference",
    "",
    `Generated from \`${index.rom}\` on ${index.generatedAt}.`,
    "",
    "## Files",
    "",
    "- `move-animation-reference.json`: full machine-readable move index.",
    "- `spa-reference.json`: parsed SPA documentation rows.",
    "- `background-reference.json`: parsed background documentation rows.",
    "",
    "## Search Strategy",
    "",
    "Use tags and SPA descriptions to shortlist donor moves before composing a new animation.",
    "For example, a diamond or crystal move should start with `rock`, `light`, `ice`, `storm`, and `burst` candidates.",
    "",
    "## Tags",
    "",
  ];
  for (const [tag, moves] of [...tagged.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`### ${tag}`);
    lines.push("");
    for (const move of moves.slice(0, 30)) {
      lines.push(`- **${move.moveId}: ${move.moveName}** - ${move.summary}`);
    }
    if (moves.length > 30) lines.push(`- ... ${moves.length - 30} more in JSON`);
    lines.push("");
  }

  lines.push("## Moves With Special Backgrounds", "");
  for (const move of index.moves.filter((entry) => entry.hasSpecialBackground).slice(0, 120)) {
    lines.push(`- **${move.moveId}: ${move.moveName}** - backgrounds ${move.backgroundIds.join(", ")}; tags ${move.tags.join(", ") || "none"}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
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

function parseMoveNames(): Map<number, string> {
  const map = new Map<number, string>();
  moveNamesText.split(/\r?\n/u).forEach((name, index) => {
    const trimmed = name.trim();
    if (trimmed) map.set(index, titleCaseMove(trimmed));
  });
  return map;
}

function loadMoveDescriptions(rom: NintendoDSRom, baseRom: BaseRom): Map<number, string> {
  const bankId = baseRom === "BW2" ? 402 : 202;
  const map = new Map<number, string>();
  try {
    const messageTexts = new NARC(rom.getFileByName(MESSAGE_TEXT_PATH));
    const bank = decodeGen5TextBank(messageTexts.files[bankId] ?? new Uint8Array());
    for (const entry of bank) {
      const match = /^\d+_(\d+)/u.exec(entry[0]);
      const moveId = match ? Number.parseInt(match[1], 10) : map.size;
      const description = cleanText(entry[1]);
      if (description) map.set(moveId, description);
    }
  } catch (error) {
    console.warn(`Could not load move description text bank ${bankId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return map;
}

function cleanText(value: string): string {
  return value.replace(/\\n/gu, " ").replace(/\\[fr]/gu, " ").replace(/\s+/gu, " ").trim();
}

function titleCaseMove(name: string): string {
  return name
    .toLowerCase()
    .split(/([ -])/u)
    .map((part) => (part === " " || part === "-" ? part : part.replace(/^\w/u, (match) => match.toUpperCase())))
    .join("");
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function numberOrUndefined(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const options = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) throw new Error(`Unexpected positional argument: ${raw}`);
    const key = raw.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options.set(key, [...(options.get(key) ?? []), "true"]);
      continue;
    }
    options.set(key, [...(options.get(key) ?? []), next]);
    index += 1;
  }
  return { options };
}

function requiredOption(args: ParsedArgs, key: string): string {
  const value = option(args, key);
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}

function option(args: ParsedArgs, key: string): string | undefined {
  return args.options.get(key)?.at(-1);
}

async function readFileBytes(filePath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(filePath));
}

function printHelp(): void {
  console.log(`
Move animation reference indexer

Usage:
  npm run moveanim:index -- --rom ../cleanwhite2.nds --docs ../moveanimationdocs --out move-animation-reference

Options:
  --rom <file.nds>       ROM to index.
  --docs <folder>        Folder containing SPA/background HTML exports. Defaults to ../moveanimationdocs.
  --out <folder>         Output folder. Defaults to move-animation-reference.
  --base BW|BW2          Optional ROM family override.

Notes:
  Indexed scripts are decompiled through the same semantic formatter used by the editor and helper CLI.
  Command names in the generated index use friendly names such as EmitProjectile instead of legacy DoSPA* aliases.
`.trim());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
