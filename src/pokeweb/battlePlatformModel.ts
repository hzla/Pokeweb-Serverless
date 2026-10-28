import { readU16, readU32 } from "../nds/binary";
import {
  loadBattleEnvironmentArchives,
  resolveBattleResourceId,
} from "./battleBackgroundModel";
import { decodeBattleModelScene, type BattleModelScene } from "./battleModelScene";
import type { ProjectState } from "./projectStore";

export const BATTLE_PLATFORM_RECORD_BYTES = 66;

const SEASON_NAMES = ["Spring", "Summer", "Autumn", "Winter"] as const;
const NO_RESOURCE = 0xffffffff;
const RESOURCE_ROWS = [
  { key: "nsbmdResourceId", magic: "BMD0" },
  { key: "nsbcaResourceId", magic: "BCA0" },
  { key: "nsbtaResourceId", magic: "BTA0" },
  { key: "nsbmaResourceId", magic: "BMA0" },
] as const;

export type BattlePlatformVariant = {
  tableIndex: number;
  seasonIndex: number;
  seasonName: (typeof SEASON_NAMES)[number];
  resourceId: number;
  opponentResourceId?: number;
  nsbcaResourceId?: number;
  nsbtaResourceId?: number;
  nsbmaResourceId?: number;
  edgeColor: number;
  variantCount: number;
  modelFallback: boolean;
};

export type BattlePlatformCatalog = {
  graphicsPath: string;
  tablePath: string;
  graphicsEntryCount: number;
  tableEntryCount: number;
  renderableEntryCount: number;
  variants: BattlePlatformVariant[];
};

export type BattlePlatformScene = BattleModelScene;

type ResolvedSeasonResources = {
  nsbmdResourceId?: number;
  nsbcaResourceId?: number;
  nsbtaResourceId?: number;
  nsbmaResourceId?: number;
};

export async function loadBattlePlatformCatalog(project: ProjectState): Promise<BattlePlatformCatalog> {
  const { rom, graphics, table } = await loadBattleEnvironmentArchives(project);
  const stageRows = table.narc.files[2];
  if (!stageRows) throw new Error("The battle-background table does not contain its stage/platform lookup file.");
  const tableEntryCount = Math.floor(stageRows.length / (/^IR[DE]/u.test(rom.idCode) ? BATTLE_PLATFORM_RECORD_BYTES : 68));
  const variants = parseBattlePlatformVariants(stageRows, graphics.files, rom.idCode);
  if (variants.length === 0) throw new Error("No renderable NSBMD platform models were referenced by the stage table.");
  return {
    graphicsPath: "a/0/1/1",
    tablePath: table.path,
    graphicsEntryCount: graphics.files.length,
    tableEntryCount,
    renderableEntryCount: new Set(variants.map((variant) => variant.tableIndex)).size,
    variants,
  };
}

export async function loadBattlePlatformScene(project: ProjectState, resourceId: number): Promise<BattlePlatformScene> {
  const { graphics } = await loadBattleEnvironmentArchives(project);
  const bytes = graphics.files[resourceId];
  if (!bytes) throw new Error(`Battle graphics resource ${resourceId} does not exist.`);
  return decodeBattleModelScene(bytes, resourceId);
}

export function parseBattlePlatformVariants(
  stageRows: Uint8Array,
  graphicsFiles: Uint8Array[],
  idCode: string,
): BattlePlatformVariant[] {
  const variants: BattlePlatformVariant[] = [];
  const recordSize = /^IR[DE]/u.test(idCode) ? BATTLE_PLATFORM_RECORD_BYTES : 68;
  const tableEntryCount = Math.floor(stageRows.length / recordSize);

  for (let tableIndex = 0; tableIndex < tableEntryCount; tableIndex += 1) {
    const rowOffset = tableIndex * recordSize;
    const edgeColor = readU16(stageRows, rowOffset);
    const springModel = resolveResource(stageRows, rowOffset, 0, 0, graphicsFiles, idCode);
    const rowVariants: Array<{ variant: BattlePlatformVariant; signature: string }> = [];

    for (let seasonIndex = 0; seasonIndex < SEASON_NAMES.length; seasonIndex += 1) {
      const explicit = resolveSeasonResources(stageRows, rowOffset, seasonIndex, graphicsFiles, idCode);
      if (seasonIndex > 0 && Object.values(explicit).every((resourceId) => resourceId === undefined)) continue;
      const resources = explicit.nsbmdResourceId === undefined ? resolveSeasonResources(stageRows, rowOffset, 0, graphicsFiles, idCode) : explicit;
      const resourceId = resources.nsbmdResourceId ?? springModel;
      if (resourceId === undefined) continue;
      const opponent = resolveSeasonResources(stageRows, rowOffset, explicit.nsbmdResourceId === undefined ? 0 : seasonIndex, graphicsFiles, idCode, 1);
      const variant: BattlePlatformVariant = {
        tableIndex,
        seasonIndex,
        seasonName: SEASON_NAMES[seasonIndex],
        resourceId,
        opponentResourceId: opponent.nsbmdResourceId,
        nsbcaResourceId: resources.nsbcaResourceId,
        nsbtaResourceId: resources.nsbtaResourceId,
        nsbmaResourceId: resources.nsbmaResourceId,
        edgeColor,
        variantCount: 0,
        modelFallback: seasonIndex > 0 && explicit.nsbmdResourceId === undefined,
      };
      rowVariants.push({ variant, signature: `${resourceSignature(variant)}:${RESOURCE_ROWS.map(row => opponent[row.key] ?? "-").join(":")}` });
    }

    const uniqueVariants = rowVariants.filter(
      (entry, index) => rowVariants.findIndex((candidate) => candidate.signature === entry.signature) === index,
    );
    for (const { variant } of uniqueVariants) variant.variantCount = uniqueVariants.length;
    variants.push(...uniqueVariants.map(entry => entry.variant));
  }
  return variants;
}

function resolveSeasonResources(
  rows: Uint8Array,
  rowOffset: number,
  seasonIndex: number,
  graphicsFiles: Uint8Array[],
  idCode: string,
  side = 0,
): ResolvedSeasonResources {
  const resolved: ResolvedSeasonResources = {};
  for (let resourceRow = 0; resourceRow < RESOURCE_ROWS.length; resourceRow += 1) {
    const definition = RESOURCE_ROWS[resourceRow];
    const resourceId = resolveResource(rows, rowOffset, resourceRow, seasonIndex, graphicsFiles, idCode, side);
    if (resourceId !== undefined) resolved[definition.key] = resourceId;
  }
  return resolved;
}

function resolveResource(
  rows: Uint8Array,
  rowOffset: number,
  resourceRow: number,
  seasonIndex: number,
  graphicsFiles: Uint8Array[],
  idCode: string,
  side = 0,
): number | undefined {
  const definition = RESOURCE_ROWS[resourceRow];
  if (!definition) return undefined;
  const packedId = readU32(rows, rowOffset + (/^IR[DE]/u.test(idCode) ? 2 : 4) + (resourceRow * SEASON_NAMES.length + seasonIndex) * 4);
  if (packedId === NO_RESOURCE) return undefined;
  if (/^IR[DE]/u.test(idCode)) {
    // The low/high halfwords are player/opponent resources, not game versions.
    const id = (packedId >>> (side * 16)) & 0xffff;
    const file = graphicsFiles[id];
    return id !== 0xffff && file && String.fromCharCode(...file.subarray(0, 4)) === definition.magic ? id : undefined;
  }
  return resolveBattleResourceId(packedId, graphicsFiles, idCode, definition.magic);
}

function resourceSignature(variant: BattlePlatformVariant): string {
  return [variant.resourceId, variant.nsbcaResourceId, variant.nsbtaResourceId, variant.nsbmaResourceId]
    .map((resourceId) => resourceId ?? "-")
    .join(":");
}
