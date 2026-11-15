import { appendBrushPieces, brushPieceKey, nativeFaces, readBrushPieces, rootIsIdentity, type BrushKind, type BrushMember, type BrushPart, type BrushVertex } from "./mapBrushGeometry";
import { MAP_TREE_TYPES, mapTreeTypeForMaterials, type MapTreeType } from "./mapTreeCatalog";
import { ensure } from "./nitroResourceWriter";

export { decodeFaces } from "./mapBrushGeometry";

/** Trees planted by the tree brush: shapes "t1_<native material>", one tagged run per tree (see mapBrushGeometry). */
export const TREE_BRUSH: BrushKind = { prefixes: { 1: "t1_", 2: "t2_" }, magic: 0x7e, tool: "tree brush" };
export type TreeMember = BrushMember;
const TILE = 16;

export function treeTileKey(index: number, member: TreeMember) {
  return index + (member - 1) * 1024;
}

/** Positions are relative to the footprint's top-left corner and its ground height. */
export type TreeVertex = BrushVertex;
export type TreeTemplatePart = BrushPart;
export type MapTreeTemplate = { type: MapTreeType; parts: TreeTemplatePart[] };
export type TreePlacement = { tileIndex: number; ground: number; template: MapTreeTemplate };

/** Tag payload: footprint top-left tile, size, and the catalog entry (1-based; 0 in trees placed before types shared materials). */
const treePayload = (tileIndex: number, type: MapTreeType) => ((MAP_TREE_TYPES.indexOf(type) + 1) << 12) | ((type.size - 2) << 10) | tileIndex;

/** Cut one tree out of a vanilla map: every face of the tree's materials inside its footprint. */
export function cutMapTree(donorModel: Uint8Array, type: MapTreeType, ground: number): MapTreeTemplate {
  const changed = `The source ROM's ${type.label.toLowerCase()} (map ${type.donor.map}) is not the vanilla tree.`;
  ensure(rootIsIdentity(donorModel), changed);
  const x0 = (type.donor.tileX - 16) * TILE, z0 = (type.donor.tileY - 16) * TILE, span = type.size * TILE, slack = 1.5;
  const inside = ([x, , z]: readonly number[]) => x >= x0 - slack && x <= x0 + span + slack && z >= z0 - slack && z <= z0 + span + slack;
  const parts = nativeFaces(donorModel, type.materials, "tree brush").map(part => ({
    ...part,
    faces: part.faces.filter(face => face.every(vertex => inside(vertex.position)))
      .map(face => face.map(vertex => ({ ...vertex, position: [vertex.position[0] - x0, vertex.position[1] - ground, vertex.position[2] - z0] as const }))),
  })).filter(part => part.faces.length);
  const count = parts.reduce((total, part) => total + part.faces.reduce((sum, face) => sum + face.length - 2, 0), 0);
  ensure(count === type.donor.faces && type.materials.every(name => parts.some(part => part.record.name === name)), changed);
  return { type, parts };
}

/** Add trees to a terrain model. The native node data, material records and display lists are kept. */
export function appendMapTrees(modelFile: Uint8Array, trees: readonly TreePlacement[], member: TreeMember = 1) {
  return appendBrushPieces(modelFile, TREE_BRUSH, trees.map(({ tileIndex, ground, template }) => {
    const x0 = (tileIndex % 32 - 16) * TILE, z0 = (Math.floor(tileIndex / 32) - 16) * TILE;
    return {
      payload: treePayload(tileIndex, template.type),
      parts: template.parts.map(part => ({
        ...part,
        faces: part.faces.map(face => face.map(vertex => ({ ...vertex, position: [x0 + vertex.position[0], ground + vertex.position[1], z0 + vertex.position[2]] as const }))),
      })),
    };
  }), member);
}

export type PlacedMapTree = { type?: MapTreeType; member: TreeMember; tileIndex: number; size: number };

/** Find trees planted by the tree brush, keyed by treeTileKey. */
export function readPlacedMapTrees(file: Uint8Array) {
  const read = readBrushPieces(file, TREE_BRUSH);
  const trees = new Map<number, PlacedMapTree>();
  const pieceKeys = new Map<number, number>();
  for (const [pieceKey, { member, payload, materials }] of read.pieces) {
    const tileIndex = payload & 1023, key = treeTileKey(tileIndex, member);
    trees.set(key, { type: mapTreeTypeForMaterials(materials, MAP_TREE_TYPES[((payload >>> 12) & 255) - 1]?.id), member, tileIndex, size: ((payload >>> 10) & 3) + 2 });
    pieceKeys.set(key, pieceKey);
  }
  return {
    trees,
    remove(keys: ReadonlySet<number>) {
      return read.remove(new Set([...keys].flatMap(key => pieceKeys.has(key) ? [pieceKeys.get(key)!] : [])));
    },
  };
}

export { brushPieceKey };
