import { readFile } from "node:fs/promises";
import path from "node:path";
import { NARC } from "../../src/nds/narc";
import { NintendoDSRom } from "../../src/nds/rom";
import { analyzeMoveAnimationSegments, type MoveAnimationSegmentRange } from "../../src/pokeweb/moveAnimationSegments";
import { decompileMoveAnimationBytes, parseMoveAnimationScript } from "../../src/pokeweb/moveAnimationModel";
import { parseSpaArchive } from "../../src/pokeweb/nitroSpa";

export type MoveAnimationReferenceEntry = {
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
  soundIds: number[];
  cameraCommands: string[];
  phases?: MoveAnimationSegmentRange[];
  hasSpecialBackground: boolean;
  tags: string[];
  summary: string;
  error?: string;
};

export type MoveAnimationReferenceIndex = {
  generatedAt: string;
  rom: string;
  baseRom: string;
  baseVersion: string;
  moves: MoveAnimationReferenceEntry[];
};

export type DonorSearchQuery = {
  tags: string[];
  sounds: number[];
  text?: string;
  noBackground?: boolean;
  limit?: number;
};

export type DonorSearchResult = {
  score: number;
  move: MoveAnimationReferenceEntry;
  matchedTags: string[];
};

export type DonorAssetInspection = {
  animation: Uint8Array;
  script: string;
  phases: MoveAnimationSegmentRange[];
  spaFiles: Map<number, Uint8Array>;
  spaTextures: Array<{ spaId: number; resourceId: number; textureIds: number[] }>;
  calledAnimations: number[];
};

export async function readMoveAnimationReferenceIndex(filePath: string): Promise<MoveAnimationReferenceIndex> {
  const value = JSON.parse(await readFile(filePath, "utf8")) as MoveAnimationReferenceIndex;
  if (!value || !Array.isArray(value.moves)) throw new Error(`${filePath} is not a move animation reference index.`);
  return value;
}

export function searchMoveAnimationDonors(index: MoveAnimationReferenceIndex, query: DonorSearchQuery): DonorSearchResult[] {
  const wantedTags = query.tags.map(normalize);
  const wantedText = normalize(query.text ?? "");
  return [...indexMoveEntriesByLogicalId(index).values()]
    .filter((move) => !move.error)
    .filter((move) => !query.noBackground || !move.hasSpecialBackground)
    .map((move) => {
      const availableTags = new Set([
        ...move.tags.map(normalize),
        ...move.spaResources.flatMap((resource) => resource.tags.map(normalize)),
        ...inferredPhaseTags(move),
      ]);
      const matchedTags = wantedTags.filter((tag) => availableTags.has(tag));
      const soundsMatched = query.sounds.filter((sound) => move.soundIds.includes(sound));
      const haystack = normalize(`${move.moveName} ${move.moveDescription} ${move.summary} ${move.commandNames.join(" ")}`);
      const textMatched = !wantedText || haystack.includes(wantedText);
      const score = matchedTags.length * 30 + soundsMatched.length * 40 + (wantedText && textMatched ? 25 : 0) - Math.max(0, wantedTags.length - matchedTags.length) * 15;
      return { score, move, matchedTags };
    })
    .filter((result) => result.matchedTags.length === wantedTags.length)
    .filter((result) => query.sounds.every((sound) => result.move.soundIds.includes(sound)))
    .filter((result) => !wantedText || normalize(`${result.move.moveName} ${result.move.moveDescription} ${result.move.summary} ${result.move.commandNames.join(" ")}`).includes(wantedText))
    .sort((left, right) => right.score - left.score || left.move.commandCount - right.move.commandCount || left.move.moveId - right.move.moveId)
    .slice(0, query.limit ?? 12);
}

export function indexMoveEntriesByLogicalId(index: MoveAnimationReferenceIndex): Map<number, MoveAnimationReferenceEntry> {
  const entries = new Map<number, MoveAnimationReferenceEntry>();
  for (const move of index.moves) {
    const previous = entries.get(move.moveId);
    if (!previous || donorIdentityScore(move) >= donorIdentityScore(previous)) entries.set(move.moveId, move);
  }
  return entries;
}

export function inspectDonorAssets(rom: NintendoDSRom, move: MoveAnimationReferenceEntry): DonorAssetInspection {
  const animationNarc = new NARC(rom.getFileByName(move.sourcePath));
  const animation = animationNarc.files[move.fileIndex];
  if (!animation) throw new Error(`${move.sourcePath}:${move.fileIndex} is missing for donor move ${move.moveId}.`);
  const script = decompileMoveAnimationBytes(animation);
  const parsed = parseMoveAnimationScript(script);
  const spaIds = new Set<number>();
  const calledAnimations = new Set<number>();
  for (const commands of parsed.scripts.values()) {
    for (const command of commands) {
      if (command.name === "LoadSPA") spaIds.add(command.params[0] ?? -1);
      if (command.name === "CallMoveAnimation") calledAnimations.add(command.params[0] ?? -1);
    }
  }
  const spaNarc = new NARC(rom.getFileByName("a/0/0/6"));
  const spaFiles = new Map<number, Uint8Array>();
  const spaTextures: DonorAssetInspection["spaTextures"] = [];
  for (const spaId of [...spaIds].filter((id) => id >= 0).sort((left, right) => left - right)) {
    const bytes = spaNarc.files[spaId];
    if (!bytes) throw new Error(`Donor move ${move.moveId} loads missing SPA ${spaId}.`);
    spaFiles.set(spaId, bytes.slice());
    const archive = parseSpaArchive(bytes);
    archive.resources.forEach((resource) => {
      const textureIds = [...new Set([
        resource.textureIndex,
        ...(resource.texAnim?.textures.slice(0, resource.texAnim.textureCount) ?? []),
        ...(resource.childResource ? [resource.childResource.textureIndex] : []),
      ])].sort((left, right) => left - right);
      spaTextures.push({ spaId, resourceId: resource.index, textureIds });
    });
  }
  return {
    animation: animation.slice(),
    script,
    phases: analyzeMoveAnimationSegments(script).inferred,
    spaFiles,
    spaTextures,
    calledAnimations: [...calledAnimations].filter((id) => id >= 0).sort((left, right) => left - right),
  };
}

export async function loadDonorRom(romPath: string): Promise<NintendoDSRom> {
  return new NintendoDSRom(new Uint8Array(await readFile(path.resolve(romPath))));
}

function inferredPhaseTags(move: MoveAnimationReferenceEntry): string[] {
  const tags = new Set<string>(["setup", "cleanup", ...(move.phases?.map((phase) => phase.name) ?? [])]);
  if (move.commandNames.some((command) => command.includes("Projectile"))) tags.add("projectile");
  if (move.commandNames.includes("ShakeSprite")) tags.add("impact");
  if (move.commandNames.some((command) => command === "ChangeColor" || command === "SpriteOpacity")) tags.add("healing");
  if (move.hasSpecialBackground) tags.add("background");
  if (move.spaResources.some((resource) => resource.commands.some((command) => command.includes("Screen"))) && tags.has("projectile")) tags.add("gather");
  return [...tags];
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/gu, "-");
}

function donorIdentityScore(move: MoveAnimationReferenceEntry): number {
  const placeholder = normalize(move.moveName) === `move-${move.moveId}`;
  return (placeholder ? 0 : 100) + (move.moveDescription.trim() ? 20 : 0) + (move.error ? -1000 : 0) + move.commandCount / 10_000;
}
