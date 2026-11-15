import type { MatrixSeason } from "./seasonalMatrixModel";

/**
 * Native trees the tree brush can plant. Nothing from the game is bundled: each entry names one isolated tree in a
 * vanilla map (its top-left footprint tile) and the brush cuts that tree out of the user's own source ROM. The face
 * count guards against a source ROM whose donor map was edited.
 */
export type MapTreeType = {
  id: string;
  label: string;
  games: readonly ("BW" | "BW2")[];
  /** Footprint in tiles, square. */
  size: 2 | 3;
  /** `faces` counts triangles, a quad being two. */
  donor: { map: number; tileX: number; tileY: number; faces: number };
  /** Native terrain materials that make up the tree, in draw order. */
  materials: readonly string[];
  /** Map texture packs (a/0/1/4) that hold this tree's textures in spring, summer, autumn and winter. */
  texturePacks: Readonly<Record<MatrixSeason, number>>;
};

const ROUTE_1_PACKS = { spring: 2, summer: 3, autumn: 4, winter: 5 } as const;

/** Ids are stable keys saved with placed trees ("round" is the conifer, "pine" the broadleaf); labels are what users see. */
export const MAP_TREE_TYPES: readonly MapTreeType[] = [
  {
    id: "round", label: "Pine tree", games: ["BW", "BW2"], size: 2,
    donor: { map: 0, tileX: 16, tileY: 0, faces: 10 },
    materials: ["ki02c", "ki02ax", "ki02bx", "ki02dx"], texturePacks: ROUTE_1_PACKS,
  },
  {
    id: "tall-pine", label: "Tall pine tree", games: ["BW", "BW2"], size: 2,
    donor: { map: 0, tileX: 14, tileY: 0, faces: 10 },
    materials: ["ki02c", "ki02ax", "ki02bx", "ki02dx"], texturePacks: ROUTE_1_PACKS,
  },
  {
    id: "pine", label: "Round tree", games: ["BW", "BW2"], size: 2,
    donor: { map: 48, tileX: 23, tileY: 14, faces: 10 },
    materials: ["ki02c", "ki03ax", "ki03bx", "ki03dx"], texturePacks: ROUTE_1_PACKS,
  },
  {
    id: "palm", label: "Palm tree", games: ["BW2"], size: 2,
    donor: { map: 265, tileX: 19, tileY: 16, faces: 18 },
    materials: ["ki04c", "ki04ax", "ki04bx", "ki04dx"], texturePacks: { spring: 70, summer: 70, autumn: 70, winter: 70 },
  },
  {
    id: "large", label: "Large tree", games: ["BW2"], size: 3,
    donor: { map: 286, tileX: 16, tileY: 14, faces: 10 },
    materials: ["ki02c1", "ki02ax1", "ki02bx1", "ki02dx1"], texturePacks: { spring: 214, summer: 215, autumn: 216, winter: 217 },
  },
];

export function mapTreeTypes(game: string | undefined) {
  return MAP_TREE_TYPES.filter(type => type.games.includes(game as "BW" | "BW2"));
}

export function mapTreeType(id: string) {
  return MAP_TREE_TYPES.find(type => type.id === id);
}

/** The tree type whose native materials a placed tree uses. */
export function mapTreeTypeForMaterials(materials: ReadonlySet<string>, payloadType?: string) {
  const matches = MAP_TREE_TYPES.filter(type => type.materials.length === materials.size && type.materials.every(name => materials.has(name)));
  return matches.find(type => type.id === payloadType) ?? matches[0];
}
