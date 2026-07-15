import { readU16, readU32 } from "../nds/binary";
import {
  loadBattleEnvironmentArchives,
  resolveBattleResourceId,
} from "./battleBackgroundModel";
import { decodeBattleModelScene, type BattleModelScene } from "./battleModelScene";
import type { ProjectState } from "./projectStore";

export const BATTLE_PLATFORM_RECORD_BYTES = 68;

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
  const tableEntryCount = Math.floor(stageRows.length / BATTLE_PLATFORM_RECORD_BYTES);
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
  if (stageRows.length % BATTLE_PLATFORM_RECORD_BYTES !== 0) return [];
  const variants: BattlePlatformVariant[] = [];
  const tableEntryCount = stageRows.length / BATTLE_PLATFORM_RECORD_BYTES;

  for (let tableIndex = 0; tableIndex < tableEntryCount; tableIndex += 1) {
    const rowOffset = tableIndex * BATTLE_PLATFORM_RECORD_BYTES;
    const edgeColor = readU16(stageRows, rowOffset);
    const springModel = resolveResource(stageRows, rowOffset, 0, 0, graphicsFiles, idCode);
    const rowVariants: BattlePlatformVariant[] = [];

    for (let seasonIndex = 0; seasonIndex < SEASON_NAMES.length; seasonIndex += 1) {
      const explicit = resolveSeasonResources(stageRows, rowOffset, seasonIndex, graphicsFiles, idCode);
      if (seasonIndex > 0 && Object.values(explicit).every((resourceId) => resourceId === undefined)) continue;
      const resourceId = explicit.nsbmdResourceId ?? springModel;
      if (resourceId === undefined) continue;
      rowVariants.push({
        tableIndex,
        seasonIndex,
        seasonName: SEASON_NAMES[seasonIndex],
        resourceId,
        nsbcaResourceId: explicit.nsbcaResourceId,
        nsbtaResourceId: explicit.nsbtaResourceId,
        nsbmaResourceId: explicit.nsbmaResourceId,
        edgeColor,
        variantCount: 0,
        modelFallback: seasonIndex > 0 && explicit.nsbmdResourceId === undefined,
      });
    }

    const uniqueVariants = rowVariants.filter(
      (variant, index) => rowVariants.findIndex((candidate) => resourceSignature(candidate) === resourceSignature(variant)) === index,
    );
    for (const variant of uniqueVariants) variant.variantCount = uniqueVariants.length;
    variants.push(...uniqueVariants);
  }
  return variants;
}

function resolveSeasonResources(
  rows: Uint8Array,
  rowOffset: number,
  seasonIndex: number,
  graphicsFiles: Uint8Array[],
  idCode: string,
): ResolvedSeasonResources {
  const resolved: ResolvedSeasonResources = {};
  for (let resourceRow = 0; resourceRow < RESOURCE_ROWS.length; resourceRow += 1) {
    const definition = RESOURCE_ROWS[resourceRow];
    const resourceId = resolveResource(rows, rowOffset, resourceRow, seasonIndex, graphicsFiles, idCode);
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
): number | undefined {
  const definition = RESOURCE_ROWS[resourceRow];
  if (!definition) return undefined;
  const packedId = readU32(rows, rowOffset + 4 + (resourceRow * SEASON_NAMES.length + seasonIndex) * 4);
  if (packedId === NO_RESOURCE) return undefined;
  return resolveBattleResourceId(packedId, graphicsFiles, idCode, definition.magic);
}

function resourceSignature(variant: BattlePlatformVariant): string {
  return [variant.resourceId, variant.nsbcaResourceId, variant.nsbtaResourceId, variant.nsbmaResourceId]
    .map((resourceId) => resourceId ?? "-")
    .join(":");
}
