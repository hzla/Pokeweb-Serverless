import { getHeaderPackedValue, parseHeaders, type HeaderCollection } from "./headerModel";
import { loadBattleEnvironmentArchives } from "./battleBackgroundModel";
import type { ProjectState } from "./projectStore";

export const BATTLE_ZONE_SPEC_RECORD_BYTES = 36;
export const BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT = 17;

export const BATTLE_BACKGROUND_TYPE_NAMES = [
  "Grass",
  "Seasonal grass",
  "City",
  "Seasonal city",
  "Cave",
  "Dark cave",
  "Forest",
  "Mountain",
  "Sea",
  "Room",
  "Sand",
  "Elite Four · Ghost",
  "Elite Four · Fighting",
  "Elite Four · Dark",
  "Elite Four · Psychic",
  "N's Castle",
  "Champion",
  "Dragonspiral Tower 7F",
  "WCS",
] as const;

export const BATTLE_BACKGROUND_ATTRIBUTE_NAMES = [
  "Lawn",
  "Ground",
  "Seasonal ground 1",
  "Seasonal ground 2",
  "Normal",
  "Encounter grass",
  "Water",
  "Snow",
  "Sand",
  "Marsh",
  "Cave",
  "Pool",
  "Shoal",
  "Ice",
  "Indoor encounter",
  "Palace",
  "Sage",
] as const;

export type BattleEnvironmentUsageRoute = {
  battleBackgroundType: number;
  battleBackgroundTypeName: string;
  attributeIndexes: number[];
  attributeNames: string[];
};

export type BattleEnvironmentLocationUsage = {
  locationName: string;
  headerIndexes: number[];
  routes: BattleEnvironmentUsageRoute[];
};

export type BattleEnvironmentUsageCatalog = {
  backgrounds: Map<number, BattleEnvironmentLocationUsage[]>;
  platforms: Map<number, BattleEnvironmentLocationUsage[]>;
};

type UsageAccumulator = {
  locationName: string;
  headerIndexes: Set<number>;
  routes: Map<number, Set<number>>;
};

export async function loadBattleEnvironmentUsage(project: ProjectState): Promise<BattleEnvironmentUsageCatalog> {
  const { table } = await loadBattleEnvironmentArchives(project);
  const zoneSpecRows = table.narc.files[0];
  if (!zoneSpecRows) throw new Error("The battle-background table does not contain its zone-spec lookup file.");
  return parseBattleEnvironmentUsage(project.headers ?? parseHeaders(project), zoneSpecRows);
}

export function parseBattleEnvironmentUsage(
  headers: HeaderCollection,
  zoneSpecRows: Uint8Array,
): BattleEnvironmentUsageCatalog {
  const backgroundAccumulators = new Map<number, Map<string, UsageAccumulator>>();
  const platformAccumulators = new Map<number, Map<string, UsageAccumulator>>();
  const rowCount = Math.floor(zoneSpecRows.length / BATTLE_ZONE_SPEC_RECORD_BYTES);

  for (const header of Object.values(headers.rows).sort((left, right) => left.index - right.index)) {
    const battleBackgroundType = (getHeaderPackedValue(header, "map_behavior") >>> 5) & 0x1f;
    if (battleBackgroundType >= rowCount) continue;
    const rowOffset = battleBackgroundType * BATTLE_ZONE_SPEC_RECORD_BYTES;

    for (let attributeIndex = 0; attributeIndex < BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT; attributeIndex += 1) {
      const backgroundIndex = zoneSpecRows[rowOffset + 2 + attributeIndex];
      const platformIndex = zoneSpecRows[rowOffset + 2 + BATTLE_ZONE_SPEC_ATTRIBUTE_COUNT + attributeIndex];
      if (backgroundIndex !== undefined && backgroundIndex !== 0xff) {
        accumulateUsage(backgroundAccumulators, backgroundIndex, header.location_name, header.index, battleBackgroundType, attributeIndex);
      }
      if (platformIndex !== undefined && platformIndex !== 0xff) {
        accumulateUsage(platformAccumulators, platformIndex, header.location_name, header.index, battleBackgroundType, attributeIndex);
      }
    }
  }

  return {
    backgrounds: finalizeUsage(backgroundAccumulators),
    platforms: finalizeUsage(platformAccumulators),
  };
}

function accumulateUsage(
  modelUsage: Map<number, Map<string, UsageAccumulator>>,
  modelIndex: number,
  locationName: string,
  headerIndex: number,
  battleBackgroundType: number,
  attributeIndex: number,
): void {
  let locations = modelUsage.get(modelIndex);
  if (!locations) {
    locations = new Map();
    modelUsage.set(modelIndex, locations);
  }
  const locationKey = normalizeLocationName(locationName);
  let usage = locations.get(locationKey);
  if (!usage) {
    usage = { locationName: locationKey, headerIndexes: new Set(), routes: new Map() };
    locations.set(locationKey, usage);
  }
  usage.headerIndexes.add(headerIndex);
  let attributes = usage.routes.get(battleBackgroundType);
  if (!attributes) {
    attributes = new Set();
    usage.routes.set(battleBackgroundType, attributes);
  }
  attributes.add(attributeIndex);
}

function finalizeUsage(
  accumulators: Map<number, Map<string, UsageAccumulator>>,
): Map<number, BattleEnvironmentLocationUsage[]> {
  return new Map(
    [...accumulators.entries()].map(([modelIndex, locations]) => [
      modelIndex,
      [...locations.values()]
        .map((usage) => ({
          locationName: usage.locationName,
          headerIndexes: [...usage.headerIndexes].sort((left, right) => left - right),
          routes: [...usage.routes.entries()]
            .sort(([left], [right]) => left - right)
            .map(([battleBackgroundType, attributes]) => {
              const attributeIndexes = [...attributes].sort((left, right) => left - right);
              return {
                battleBackgroundType,
                battleBackgroundTypeName: BATTLE_BACKGROUND_TYPE_NAMES[battleBackgroundType] ?? `Type ${battleBackgroundType}`,
                attributeIndexes,
                attributeNames: attributeIndexes.map(
                  (attributeIndex) => BATTLE_BACKGROUND_ATTRIBUTE_NAMES[attributeIndex] ?? `Attribute ${attributeIndex}`,
                ),
              };
            }),
        }))
        .sort((left, right) => compareLocationNames(left.locationName, right.locationName) || (left.headerIndexes[0] ?? 0) - (right.headerIndexes[0] ?? 0)),
    ]),
  );
}

function normalizeLocationName(locationName: string): string {
  const trimmed = locationName.trim();
  return trimmed && !/(?:\\x[0-9a-f]{2})+/iu.test(trimmed) ? trimmed : "Unnamed location";
}

function compareLocationNames(left: string, right: string): number {
  if (left === "Unnamed location") return right === "Unnamed location" ? 0 : 1;
  if (right === "Unnamed location") return -1;
  return left.localeCompare(right);
}
