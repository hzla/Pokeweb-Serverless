import { readAscii, readU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes } from "./fileSystemModel";
import {
  buildModelPrimitives,
  buildNitroTexturePreviews,
  readNitroResources,
  type Map3dBounds,
  type Map3dPrimitive,
  type NitroTexturePreview,
} from "./map3dModel";
import { loadActiveRomBytes } from "./persistence";
import type { ProjectState } from "./projectStore";

const BATTLE_GRAPHICS_PATH = "a/0/1/1";
const KNOWN_TABLE_PATHS = ["a/1/5/1", "a/1/5/2", "a/1/6/0"] as const;
const BACKGROUND_TABLE_RECORD_BYTES = 64;
const MINIMUM_TABLE_MODEL_REFERENCES = 5;
const SEASON_NAMES = ["Spring", "Summer", "Autumn", "Winter"] as const;
const NO_RESOURCE = 0xffffffff;

export type BattleBackgroundVariant = {
  tableIndex: number;
  seasonIndex: number;
  seasonName: (typeof SEASON_NAMES)[number];
  resourceId: number;
  variantCount: number;
  shapeKind: BattleBackgroundShapeKind;
};

export type BattleBackgroundShapeKind = "standard" | "non-standard" | "unknown";

export type BattleBackgroundCatalog = {
  graphicsPath: string;
  tablePath: string;
  graphicsEntryCount: number;
  tableEntryCount: number;
  variants: BattleBackgroundVariant[];
};

export type BattleBackgroundScene = {
  resourceId: number;
  primitives: Map3dPrimitive[];
  bounds: Map3dBounds;
  primitiveCount: number;
  triangleCount: number;
  textureCount: number;
  textures: NitroTexturePreview[];
  shapeKind: BattleBackgroundShapeKind;
  warnings: string[];
};

export async function loadBattleBackgroundCatalog(project: ProjectState): Promise<BattleBackgroundCatalog> {
  const rom = await loadProjectRom(project);
  const graphicsFileId = rom.fileId(BATTLE_GRAPHICS_PATH);
  const graphics = new NARC(getRomFileBytes(project, rom, graphicsFileId));
  const table = findBattleBackgroundTable(project, rom, graphics);
  const backgroundRows = table.narc.files[1];
  if (!backgroundRows) throw new Error("The battle-background table does not contain its field-model lookup file.");
  const tableEntryCount = Math.floor(backgroundRows.length / BACKGROUND_TABLE_RECORD_BYTES);
  const variants: BattleBackgroundVariant[] = [];
  const shapeByResource = new Map<number, BattleBackgroundShapeKind>();

  for (let tableIndex = 0; tableIndex < tableEntryCount; tableIndex += 1) {
    const rowOffset = tableIndex * BACKGROUND_TABLE_RECORD_BYTES;
    const rowVariants: BattleBackgroundVariant[] = [];
    for (let seasonIndex = 0; seasonIndex < SEASON_NAMES.length; seasonIndex += 1) {
      const packedId = readU32(backgroundRows, rowOffset + seasonIndex * 4);
      const resourceId = resolveModelResourceId(packedId, graphics, rom.idCode);
      if (resourceId === undefined) continue;
      const shapeKind = shapeByResource.get(resourceId) ?? classifyBattleBackgroundResource(graphics.files[resourceId]);
      shapeByResource.set(resourceId, shapeKind);
      rowVariants.push({
        tableIndex,
        seasonIndex,
        seasonName: SEASON_NAMES[seasonIndex],
        resourceId,
        variantCount: 0,
        shapeKind,
      });
    }
    const uniqueVariants = rowVariants.filter(
      (variant, index) => rowVariants.findIndex((candidate) => candidate.resourceId === variant.resourceId) === index,
    );
    for (const variant of uniqueVariants) variant.variantCount = uniqueVariants.length;
    variants.push(...uniqueVariants);
  }

  if (variants.length === 0) throw new Error("No NSBMD field models were referenced by the battle-background table.");
  return {
    graphicsPath: BATTLE_GRAPHICS_PATH,
    tablePath: table.path,
    graphicsEntryCount: graphics.files.length,
    tableEntryCount,
    variants,
  };
}

export async function loadBattleBackgroundScene(project: ProjectState, resourceId: number): Promise<BattleBackgroundScene> {
  const rom = await loadProjectRom(project);
  const graphicsFileId = rom.fileId(BATTLE_GRAPHICS_PATH);
  const graphics = new NARC(getRomFileBytes(project, rom, graphicsFileId));
  const bytes = graphics.files[resourceId];
  if (!bytes) throw new Error(`Battle graphics resource ${resourceId} does not exist.`);
  if (readAscii(bytes, 0, Math.min(4, bytes.length)) !== "BMD0") {
    throw new Error(`Battle graphics resource ${resourceId} is not an NSBMD model.`);
  }
  const warnings: string[] = [];
  const resources = readNitroResources(bytes);
  const primitives = buildModelPrimitives(resources, warnings, { recoverSkippedPieces: true });
  const textures = buildNitroTexturePreviews(resources);
  if (primitives.length === 0) throw new Error(`Battle graphics resource ${resourceId} contains no renderable model geometry.`);
  return {
    resourceId,
    primitives,
    bounds: primitiveBounds(primitives),
    primitiveCount: primitives.length,
    triangleCount: primitives.reduce((sum, primitive) => sum + primitive.indices.length / 3, 0),
    textureCount: textures.length,
    textures,
    shapeKind: classifyBattleBackgroundTextureNames(
      resources.models.flatMap((model) => model.materials.map((material) => material.textureName).filter((name): name is string => Boolean(name))),
    ),
    warnings,
  };
}

export function parseBattleBackgroundVariants(
  backgroundRows: Uint8Array,
  graphicsFiles: Uint8Array[],
  idCode: string,
): BattleBackgroundVariant[] {
  if (backgroundRows.length % BACKGROUND_TABLE_RECORD_BYTES !== 0) return [];
  const graphics = new NARC();
  graphics.files = graphicsFiles;
  const variants: BattleBackgroundVariant[] = [];
  const shapeByResource = new Map<number, BattleBackgroundShapeKind>();
  const tableEntryCount = backgroundRows.length / BACKGROUND_TABLE_RECORD_BYTES;
  for (let tableIndex = 0; tableIndex < tableEntryCount; tableIndex += 1) {
    const rowOffset = tableIndex * BACKGROUND_TABLE_RECORD_BYTES;
    const rowVariants: BattleBackgroundVariant[] = [];
    for (let seasonIndex = 0; seasonIndex < SEASON_NAMES.length; seasonIndex += 1) {
      const resourceId = resolveModelResourceId(readU32(backgroundRows, rowOffset + seasonIndex * 4), graphics, idCode);
      if (resourceId === undefined) continue;
      const shapeKind = shapeByResource.get(resourceId) ?? classifyBattleBackgroundResource(graphics.files[resourceId]);
      shapeByResource.set(resourceId, shapeKind);
      rowVariants.push({ tableIndex, seasonIndex, seasonName: SEASON_NAMES[seasonIndex], resourceId, variantCount: 0, shapeKind });
    }
    const uniqueVariants = rowVariants.filter(
      (variant, index) => rowVariants.findIndex((candidate) => candidate.resourceId === variant.resourceId) === index,
    );
    for (const variant of uniqueVariants) variant.variantCount = uniqueVariants.length;
    variants.push(...uniqueVariants);
  }
  return variants;
}

async function loadProjectRom(project: ProjectState): Promise<NintendoDSRom> {
  const bytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!bytes) throw new Error("Reload the ROM before opening Battle Backgrounds.");
  return new NintendoDSRom(bytes);
}

function findBattleBackgroundTable(
  project: ProjectState,
  rom: NintendoDSRom,
  graphics: NARC,
): { path: string; narc: NARC } {
  for (const path of KNOWN_TABLE_PATHS) {
    const fileId = rom.filenames.idOf(path);
    if (fileId === undefined) continue;
    const narc = tryNarc(getRomFileBytes(project, rom, fileId));
    if (narc && battleBackgroundTableScore(narc, graphics, rom.idCode) >= MINIMUM_TABLE_MODEL_REFERENCES) return { path, narc };
  }

  let best: { path: string; narc: NARC; score: number } | undefined;
  for (let fileId = 0; fileId < rom.files.length; fileId += 1) {
    const narc = tryNarc(getRomFileBytes(project, rom, fileId));
    if (!narc) continue;
    const score = battleBackgroundTableScore(narc, graphics, rom.idCode);
    if (score < MINIMUM_TABLE_MODEL_REFERENCES || score <= (best?.score ?? 0)) continue;
    best = { path: pathForFileId(rom, fileId) ?? `ROM file ${fileId}`, narc, score };
  }
  if (!best) throw new Error("Could not locate the three-file battle-background lookup table in this ROM.");
  return best;
}

function battleBackgroundTableScore(narc: NARC, graphics: NARC, idCode: string): number {
  if (narc.files.length !== 3) return 0;
  const zoneRows = narc.files[0];
  const backgroundRows = narc.files[1];
  if (!zoneRows || !backgroundRows || zoneRows.length < 16 || backgroundRows.length < BACKGROUND_TABLE_RECORD_BYTES * 5) return 0;
  if (backgroundRows.length % BACKGROUND_TABLE_RECORD_BYTES !== 0) return 0;
  if ((zoneRows[0] ?? 2) > 1 || (zoneRows[1] ?? 2) > 1) return 0;
  return parseBattleBackgroundVariants(backgroundRows, graphics.files, idCode).length;
}

function resolveModelResourceId(packedId: number, graphics: NARC, idCode: string): number | undefined {
  if (packedId === NO_RESOURCE) return undefined;
  if (packedId < graphics.files.length && isModel(graphics.files[packedId])) return packedId;
  const low = packedId & 0xffff;
  const high = packedId >>> 16;
  const whiteVersion = idCode.length >= 3 && (idCode[2] === "A" || idCode[2] === "D");
  const candidates = whiteVersion ? [high, low] : [low, high];
  return candidates.find((candidate) => candidate !== 0xffff && candidate < graphics.files.length && isModel(graphics.files[candidate]));
}

export function classifyBattleBackgroundTextureNames(textureNames: string[]): BattleBackgroundShapeKind {
  if (textureNames.length === 0) return "unknown";
  return textureNames.some((name) => /^batt_(?:field|fd)/u.test(name.toLowerCase())) ? "standard" : "non-standard";
}

function classifyBattleBackgroundResource(bytes: Uint8Array | undefined): BattleBackgroundShapeKind {
  if (!bytes || !isModel(bytes)) return "unknown";
  try {
    const resources = readNitroResources(bytes);
    return classifyBattleBackgroundTextureNames(
      resources.models.flatMap((model) => model.materials.map((material) => material.textureName).filter((name): name is string => Boolean(name))),
    );
  } catch {
    return "unknown";
  }
}

function isModel(bytes: Uint8Array | undefined): boolean {
  return Boolean(bytes && readAscii(bytes, 0, Math.min(4, bytes.length)) === "BMD0");
}

function tryNarc(bytes: Uint8Array): NARC | undefined {
  if (readAscii(bytes, 0, Math.min(4, bytes.length)) !== "NARC") return undefined;
  try {
    return new NARC(bytes);
  } catch {
    return undefined;
  }
}

function pathForFileId(rom: NintendoDSRom, wantedId: number): string | undefined {
  const visit = (folder: NintendoDSRom["filenames"], prefix = ""): string | undefined => {
    const localIndex = wantedId - folder.firstId;
    if (localIndex >= 0 && localIndex < folder.files.length) {
      const name = folder.files[localIndex];
      return prefix ? `${prefix}/${name}` : name;
    }
    for (const [name, child] of folder.folders) {
      const found = visit(child, prefix ? `${prefix}/${name}` : name);
      if (found) return found;
    }
    return undefined;
  };
  return visit(rom.filenames);
}

function primitiveBounds(primitives: Map3dPrimitive[]): Map3dBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const primitive of primitives) {
    for (let index = 0; index + 2 < primitive.positions.length; index += 3) {
      const x = primitive.positions[index] ?? 0;
      const y = primitive.positions[index + 1] ?? 0;
      const z = primitive.positions[index + 2] ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}
