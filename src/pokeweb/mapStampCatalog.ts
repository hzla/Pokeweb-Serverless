/**
 * Native objects the stamp brush can place: street lights, benches, plants and other small pieces of terrain art.
 * Nothing from the game is bundled. Each entry names one object in a vanilla map — the box around its faces, the
 * footprint's top-left tile and which footprint tiles the game blocks — and the brush cuts it out of the user's own
 * source ROM. Its textures come from the donor area's texture packs. The face count guards against an edited donor.
 */
export type MapStampCategory = "Fencing" | "Lighting" | "Vegetation" | "Misc";
export const MAP_STAMP_CATEGORIES: readonly MapStampCategory[] = ["Fencing", "Lighting", "Vegetation", "Misc"];

export type MapStampType = {
  id: string;
  label: string;
  category: MapStampCategory;
  /** Objects that look the same from every side are placed as they are; the rest can turn in 90° steps. */
  rotatable: boolean;
  /**
   * `area` is the donor's area (its texture packs per season). `box` is [x0, x1, z0, z1] in chunk units around the
   * object's faces, and `faces` counts its triangles, a quad being two.
   */
  donor: { map: number; area: number; tileX: number; tileY: number; box: readonly [number, number, number, number]; faces: number };
  materials: readonly string[];
  /**
   * The footprint, one string per row of tiles from the top: "#" where the object blocks movement. This follows the
   * donor's tiles, except where the donor sits in blocked scenery: there only the tiles under a post or base block,
   * so the player can walk under overhanging lamp arms, banners and the gate's crossbeam.
   */
  blocked: readonly string[];
};

/** Black 2 and White 2 donors. Ids are stable keys saved with placed stamps. */
export const MAP_STAMP_TYPES: readonly MapStampType[] = [
  { id: "street-light-nacrene", label: "Street light (Nacrene)", category: "Lighting", rotatable: true,
    donor: { map: 18, area: 10, tileX: 28, tileY: 5, box: [197.391, 214.719, -171.656, -163.609], faces: 72 },
    materials: ["c2_lamp01", "c2_lamp02"], blocked: ["#."] },
  { id: "round-street-light", label: "Round street light", category: "Lighting", rotatable: true,
    donor: { map: 48, area: 34, tileX: 18, tileY: 24, box: [40.234, 56.219, 131.297, 140.969], faces: 146 },
    materials: ["out09_ight", "out09_hikari"], blocked: ["#."] },
  { id: "overhead-street-light", label: "Overhead street light", category: "Lighting", rotatable: true,
    donor: { map: 50, area: 34, tileX: 10, tileY: 14, box: [-96, -71, -32, -24], faces: 26 },
    materials: ["slamp03", "slamp03_2"], blocked: [".#"] },
  { id: "red-street-light", label: "Red street light", category: "Lighting", rotatable: true,
    donor: { map: 31, area: 22, tileX: 16, tileY: 15, box: [10.625, 37.375, -16.656, -7.344], faces: 220 },
    materials: ["r04_b_lamp01", "r04_b_lamp02"], blocked: [".#."] },
  { id: "street-light-aspertia", label: "Street light (Aspertia)", category: "Lighting", rotatable: true,
    donor: { map: 280, area: 210, tileX: 1, tileY: 5, box: [-237.875, -226.25, -173.812, -162.187], faces: 204 },
    materials: ["C12_ight", "C12_l_hikari"], blocked: ["#"] },
  { id: "lamp-post-nimbasa", label: "Lamp post", category: "Lighting", rotatable: true,
    donor: { map: 38, area: 26, tileX: 6, tileY: 19, box: [-158.859, -145.141, 44.141, 57.859], faces: 30 },
    materials: ["out7gai01", "out7gai02", "out7hata01", "out7hata02"], blocked: ["#"] },
  { id: "half-arched-lights", label: "Half arched lights", category: "Lighting", rotatable: true,
    donor: { map: 38, area: 26, tileX: 25, tileY: 25, box: [151.75, 216.25, 151.75, 160.25], faces: 128 },
    materials: ["out7gai01", "out7gai02", "out7hata01", "out7hata02"], blocked: ["#...#"] },
  { id: "city-shrubbery", label: "City shrubbery", category: "Vegetation", rotatable: true,
    donor: { map: 11, area: 6, tileX: 8, tileY: 24, box: [-129.547, -94.453, 136.563, 151.438], faces: 88 },
    materials: ["c01thicket_c"], blocked: ["##", "##"] },
  { id: "stage-plant", label: "Stage plant", category: "Vegetation", rotatable: false,
    donor: { map: 18, area: 10, tileX: 25, tileY: 9, box: [143.328, 160.672, -113.469, -96.062], faces: 28 },
    materials: ["c_etc01"], blocked: ["#"] },
  { id: "dark-green-bushes", label: "Dark green bushes", category: "Vegetation", rotatable: true,
    donor: { map: 30, area: 22, tileX: 5, tileY: 28, box: [-176, -96, 192, 256], faces: 64 },
    materials: ["plant01"], blocked: ["#####", "#####", "#####", "#####"] },
  { id: "tall-flowers", label: "Tall flowers", category: "Vegetation", rotatable: true,
    donor: { map: 285, area: 214, tileX: 17, tileY: 16, box: [17, 44, 2.859, 12], faces: 2 },
    materials: ["lav"], blocked: [".."] },
  { id: "dead-tree", label: "Dead tree", category: "Vegetation", rotatable: true,
    donor: { map: 297, area: 226, tileX: 28, tileY: 5, box: [191.906, 224, -178.437, -148.687], faces: 8 },
    materials: ["out57_kusa02"], blocked: ["##", "##"] },
  { id: "flower-planter", label: "Flower planter", category: "Vegetation", rotatable: true,
    donor: { map: 294, area: 218, tileX: 12, tileY: 25, box: [-54.328, -42.375, 150.578, 192.547], faces: 12 },
    materials: ["out55_fl"], blocked: ["##", "##", "##"] },
  { id: "white-bench", label: "White bench", category: "Misc", rotatable: true,
    donor: { map: 17, area: 10, tileX: 9, tileY: 5, box: [-104, -72, -176, -161], faces: 50 },
    materials: ["c2_obj02"], blocked: ["###"] },
  { id: "stage-sign", label: "Stage sign", category: "Misc", rotatable: true,
    donor: { map: 17, area: 10, tileX: 9, tileY: 8, box: [-106.078, -85.922, -131.75, -117.844], faces: 50 },
    materials: ["c2_obj05"], blocked: ["##"] },
  { id: "flag-pole", label: "Colored flag pole", category: "Misc", rotatable: true,
    donor: { map: 38, area: 26, tileX: 15, tileY: 20, box: [-16, 32, 60.906, 71.094], faces: 56 },
    materials: ["out7gai01", "out7gai02", "out7hata01", "out7hata02"], blocked: [".#."] },
  { id: "dock-pole", label: "Dock pole", category: "Misc", rotatable: false,
    donor: { map: 102, area: 86, tileX: 16, tileY: 24, box: [2.469, 13.531, 130.469, 141.531], faces: 102 },
    materials: ["un_etc01", "un_etc02"], blocked: ["#"] },
  { id: "dock-bollard", label: "Dock bollard", category: "Misc", rotatable: false,
    donor: { map: 102, area: 86, tileX: 23, tileY: 25, box: [112.656, 123.344, 146.406, 156.422], faces: 36 },
    materials: ["un_etc01"], blocked: ["#"] },
  { id: "pwt-flag", label: "PWT flag", category: "Misc", rotatable: true,
    donor: { map: 51, area: 222, tileX: 13, tileY: 13, box: [-43.844, -25.75, -40, -40], faces: 2 },
    materials: ["out56_hata_1"], blocked: [".#"] },
  { id: "pwt-bench", label: "PWT bench", category: "Misc", rotatable: true,
    donor: { map: 51, area: 222, tileX: 23, tileY: 9, box: [116, 140, -110, -99], faces: 18 },
    materials: ["out56_bench"], blocked: ["##"] },
  { id: "orange-cone", label: "Orange cone", category: "Misc", rotatable: false,
    donor: { map: 535, area: 296, tileX: 9, tileY: 5, box: [-110.5, -97.5, -174.5, -161.5], faces: 8 },
    materials: ["in15_cone"], blocked: ["#"] },
  { id: "tree-stump", label: "Tree stump", category: "Vegetation", rotatable: false,
    donor: { map: 68, area: 42, tileX: 15, tileY: 8, box: [-16, 0, -126.047, -110.031], faces: 2 },
    materials: ["stake"], blocked: ["#"] },
  { id: "driftwood", label: "Driftwood", category: "Vegetation", rotatable: true,
    donor: { map: 68, area: 42, tileX: 17, tileY: 10, box: [16, 48, -96, -64], faces: 2 },
    materials: ["stake2"], blocked: ["##", "##"] },
  { id: "wooden-bench", label: "Wooden bench", category: "Misc", rotatable: true,
    donor: { map: 284, area: 214, tileX: 14, tileY: 24, box: [-22.031, -11.031, 140, 164], faces: 18 },
    materials: ["isu"], blocked: ["##", "##", "##"] },
  { id: "wooden-gate", label: "Large wooden gate", category: "Misc", rotatable: true,
    donor: { map: 285, area: 214, tileX: 11, tileY: 21, box: [-69, 19, 80, 93], faces: 156 },
    materials: ["gate"], blocked: [".#...#."] },
  { id: "caution-barrier", label: "Caution barrier", category: "Fencing", rotatable: true,
    donor: { map: 48, area: 34, tileX: 6, tileY: 12, box: [-150, -128, -63, -53], faces: 10 },
    materials: ["saku_001"], blocked: ["##"] },
];

export function mapStampTypes(game: string | undefined) {
  return game === "BW2" ? MAP_STAMP_TYPES : [];
}

export function mapStampType(id: string) {
  return MAP_STAMP_TYPES.find(type => type.id === id);
}

export type StampRotation = 0 | 1 | 2 | 3;

/** Footprint in tiles after turning `rotation` quarter turns clockwise (seen from above, north up). */
export function stampSize(type: Pick<MapStampType, "blocked">, rotation: StampRotation = 0): [width: number, depth: number] {
  const width = type.blocked[0].length, depth = type.blocked.length;
  return rotation % 2 ? [depth, width] : [width, depth];
}

/** Whether a tile of the turned footprint is blocked. */
export function stampBlocked(type: Pick<MapStampType, "blocked">, rotation: StampRotation, x: number, z: number) {
  const width = type.blocked[0].length, depth = type.blocked.length;
  let [u, v] = [x, z];
  // Undo each clockwise quarter turn: (x, z) came from (z, depth - 1 - x) in the footprint before it.
  let w = rotation % 2 ? depth : width, d = rotation % 2 ? width : depth;
  for (let turn = 0; turn < rotation; turn++) {
    [u, v] = [v, w - 1 - u];
    [w, d] = [d, w];
  }
  return type.blocked[v]?.[u] === "#";
}
