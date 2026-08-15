import { recordGenericChange } from "./actionChangelog";
import {
  loadBattleBackgroundCatalog,
  loadBattleEnvironmentArchives,
  type BattleBackgroundCatalog,
  type BattleEnvironmentArchives,
} from "./battleBackgroundModel";
import {
  BATTLE_BACKGROUND_ATTRIBUTE_NAMES,
  BATTLE_BACKGROUND_TYPE_NAMES,
  BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT,
  BATTLE_ZONE_SPEC_RECORD_BYTES,
} from "./battleEnvironmentUsage";
import { loadBattlePlatformCatalog, type BattlePlatformCatalog } from "./battlePlatformModel";
import { replaceRomFile } from "./fileSystemModel";
import { getHeaderPackedValue, updateHeaderPackedField, type HeaderCollection } from "./headerModel";
import type { ProjectState } from "./projectStore";

export const MAX_BATTLE_BACKGROUND_TYPES = 32;
export const NO_BATTLE_ENVIRONMENT_MODEL = 0xff;

export type BattleEnvironmentZoneSpec = {
  timeZone: boolean;
  season: boolean;
  backgrounds: number[];
  platforms: number[];
};

export type BattleEnvironmentEditorData = {
  archives: BattleEnvironmentArchives;
  backgroundCatalog: BattleBackgroundCatalog;
  platformCatalog: BattlePlatformCatalog;
  rows: BattleEnvironmentZoneSpec[];
};

export type BattleEnvironmentValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export async function loadBattleEnvironmentEditorData(project: ProjectState): Promise<BattleEnvironmentEditorData> {
  const [archives, backgroundCatalog, platformCatalog] = await Promise.all([
    loadBattleEnvironmentArchives(project),
    loadBattleBackgroundCatalog(project),
    loadBattlePlatformCatalog(project),
  ]);
  const zoneSpecBytes = archives.table.narc.files[0];
  if (!zoneSpecBytes) throw new Error("The battle-background table does not contain its zone-spec lookup file.");
  const rows = parseBattleEnvironmentZoneSpecs(zoneSpecBytes);
  if (rows.length === 0) throw new Error("The battle-background zone-spec lookup does not contain any complete rows.");
  return { archives, backgroundCatalog, platformCatalog, rows };
}

export function parseBattleEnvironmentZoneSpecs(bytes: Uint8Array): BattleEnvironmentZoneSpec[] {
  const rows: BattleEnvironmentZoneSpec[] = [];
  const rowCount = Math.floor(bytes.length / BATTLE_ZONE_SPEC_RECORD_BYTES);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const offset = rowIndex * BATTLE_ZONE_SPEC_RECORD_BYTES;
    rows.push({
      timeZone: bytes[offset] === 1,
      season: bytes[offset + 1] === 1,
      backgrounds: Array.from(bytes.subarray(offset + 2, offset + 2 + BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT)),
      platforms: Array.from(
        bytes.subarray(
          offset + 2 + BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT,
          offset + 2 + BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT * 2,
        ),
      ),
    });
  }
  return rows;
}

export function serializeBattleEnvironmentZoneSpecs(rows: readonly BattleEnvironmentZoneSpec[]): Uint8Array {
  if (rows.length > MAX_BATTLE_BACKGROUND_TYPES) {
    throw new Error(`The header field can address at most ${MAX_BATTLE_BACKGROUND_TYPES} battle environment types.`);
  }
  const bytes = new Uint8Array(rows.length * BATTLE_ZONE_SPEC_RECORD_BYTES);
  rows.forEach((row, rowIndex) => {
    assertZoneSpecShape(row);
    const offset = rowIndex * BATTLE_ZONE_SPEC_RECORD_BYTES;
    bytes[offset] = row.timeZone ? 1 : 0;
    bytes[offset + 1] = row.season ? 1 : 0;
    bytes.set(row.backgrounds, offset + 2);
    bytes.set(row.platforms, offset + 2 + BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT);
  });
  return bytes;
}

export function cloneBattleEnvironmentZoneSpec(row: BattleEnvironmentZoneSpec): BattleEnvironmentZoneSpec {
  return {
    timeZone: row.timeZone,
    season: row.season,
    backgrounds: [...row.backgrounds],
    platforms: [...row.platforms],
  };
}

export function battleEnvironmentTypeName(typeIndex: number): string {
  return BATTLE_BACKGROUND_TYPE_NAMES[typeIndex] ?? `Custom type ${typeIndex}`;
}

export function battleEnvironmentTypeUsage(headers: HeaderCollection, typeIndex: number): Array<{ headerIndex: number; rowId: number; locationName: string }> {
  return Object.entries(headers.rows)
    .map(([rowId, row]) => ({ rowId: Number(rowId), row }))
    .filter(({ row }) => ((getHeaderPackedValue(row, "map_behavior") >>> 5) & 0x1f) === typeIndex)
    .map(({ rowId, row }) => ({ headerIndex: row.index, rowId, locationName: row.location_name }))
    .sort((left, right) => left.headerIndex - right.headerIndex);
}

export function validateBattleEnvironmentZoneSpec(
  row: BattleEnvironmentZoneSpec,
  backgroundCatalog: Pick<BattleBackgroundCatalog, "tableEntryCount" | "variants">,
  platformCatalog: Pick<BattlePlatformCatalog, "tableEntryCount" | "variants">,
): BattleEnvironmentValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    assertZoneSpecShape(row);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { valid: false, errors, warnings };
  }

  const renderableBackgrounds = new Set(backgroundCatalog.variants.map((variant) => variant.tableIndex));
  const renderablePlatforms = new Set(platformCatalog.variants.map((variant) => variant.tableIndex));
  for (let attributeIndex = 0; attributeIndex < BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT; attributeIndex += 1) {
    const label = BATTLE_BACKGROUND_ATTRIBUTE_NAMES[attributeIndex] ?? `Attribute ${attributeIndex}`;
    const background = row.backgrounds[attributeIndex] ?? NO_BATTLE_ENVIRONMENT_MODEL;
    const platform = row.platforms[attributeIndex] ?? NO_BATTLE_ENVIRONMENT_MODEL;
    if (background === NO_BATTLE_ENVIRONMENT_MODEL) warnings.push(`${label} has no background assigned.`);
    else if (background >= backgroundCatalog.tableEntryCount) errors.push(`${label} references background ${background}, outside the background table.`);
    else if (!renderableBackgrounds.has(background)) warnings.push(`${label} references background ${background}, which has no renderable model.`);
    if (platform === NO_BATTLE_ENVIRONMENT_MODEL) warnings.push(`${label} has no platform assigned.`);
    else if (platform >= platformCatalog.tableEntryCount) errors.push(`${label} references platform ${platform}, outside the platform table.`);
    else if (!renderablePlatforms.has(platform)) warnings.push(`${label} references platform ${platform}, which has no renderable model.`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function updateSharedBattleEnvironmentType(
  project: ProjectState,
  data: BattleEnvironmentEditorData,
  typeIndex: number,
  nextRow: BattleEnvironmentZoneSpec,
): void {
  if (!data.rows[typeIndex]) throw new Error(`Battle environment type ${typeIndex} does not exist.`);
  const validation = validateBattleEnvironmentZoneSpec(nextRow, data.backgroundCatalog, data.platformCatalog);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  data.rows[typeIndex] = cloneBattleEnvironmentZoneSpec(nextRow);
  commitBattleEnvironmentRows(project, data);
  recordGenericChange(
    project,
    "battle_backgrounds",
    `${battleEnvironmentTypeName(typeIndex)} (type ${typeIndex}) terrain mappings changed.`,
    `Battle environment type ${typeIndex}`,
    { key: `battle-environment-type:${typeIndex}` },
  );
}

export function createHeaderSpecificBattleEnvironmentType(
  project: ProjectState,
  data: BattleEnvironmentEditorData,
  headerRowId: number,
  nextRow: BattleEnvironmentZoneSpec,
): number {
  if (data.rows.length >= MAX_BATTLE_BACKGROUND_TYPES) {
    throw new Error("All 32 values addressable by the header's 5-bit battle environment field are already in use.");
  }
  const validation = validateBattleEnvironmentZoneSpec(nextRow, data.backgroundCatalog, data.platformCatalog);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  const typeIndex = data.rows.length;
  data.rows.push(cloneBattleEnvironmentZoneSpec(nextRow));
  commitBattleEnvironmentRows(project, data);
  updateHeaderPackedField(project, headerRowId, "map_behavior", "battle_bg_type", String(typeIndex));
  recordGenericChange(
    project,
    "battle_backgrounds",
    `Created custom battle environment type ${typeIndex} for header ${headerRowId - 1}.`,
    `Battle environment type ${typeIndex}`,
    { key: `battle-environment-type:${typeIndex}` },
  );
  return typeIndex;
}

function commitBattleEnvironmentRows(project: ProjectState, data: BattleEnvironmentEditorData): void {
  data.archives.table.narc.files[0] = serializeBattleEnvironmentZoneSpecs(data.rows);
  replaceRomFile(project, data.archives.rom, data.archives.table.fileId, data.archives.table.narc.save());
}

function assertZoneSpecShape(row: BattleEnvironmentZoneSpec): void {
  if (row.backgrounds.length !== BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT || row.platforms.length !== BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT) {
    throw new Error(`Every battle environment type must define ${BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT} background and platform mappings.`);
  }
  for (const [kind, values] of [["background", row.backgrounds], ["platform", row.platforms]] as const) {
    for (const value of values) {
      if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new Error(`Every ${kind} mapping must be a byte value from 0 to 255.`);
    }
  }
}
