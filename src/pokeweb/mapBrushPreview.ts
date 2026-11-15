import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { buildModelPrimitives, decodeTexture, extractGameFreakContainer, parseAreaHeader, readNitroResources, type DecodedTexture, type Map3dPrimitive } from "./map3dModel";
import { GRASS_LAYERS, type MapGrassKind } from "./mapGrassGeometry";
import { LEDGE_DONORS, type LedgeDirection } from "./mapLedges";
import type { MapFenceType } from "./mapFences";
import type { MapPropType } from "./mapProps";
import type { MapStampType } from "./mapStampCatalog";
import type { MapTreeType } from "./mapTreeCatalog";
import { activeRomMatchesProject, loadActiveRomBytes } from "./persistence";
import type { ProjectState } from "./projectStore";
import { MATRIX_SEASONS, seasonalAreaId, type MatrixSeason } from "./seasonalMatrixModel";

/**
 * The palette's swatches show the game's own art, read from the project's source ROM: the grass layers from the
 * Route 1 texture packs, and the donor tree or ledge each brush cuts, drawn with the season's textures.
 */
const MAPS_PATH = "a/0/0/8";
const MAP_TEXTURES_PATH = "a/0/1/4";
const AREA_PATH = "a/0/1/3";
const ROUTE_1_PACK = 2;
const TILE = 16;

type Sources = { rom: NintendoDSRom; maps: Uint8Array[]; packs: Uint8Array[]; areas: Uint8Array };
const sources = new WeakMap<Uint8Array, Sources>();

async function sourceRom(project: ProjectState): Promise<Sources | undefined> {
  const bytes = project.originalRomBytes ?? (await activeRomMatchesProject(project) ? await loadActiveRomBytes() : undefined);
  if (!bytes) return undefined;
  let source = sources.get(bytes);
  if (!source) {
    const rom = new NintendoDSRom(bytes, { fileData: "view" });
    source = { rom, maps: new NARC(rom.getFileByName(MAPS_PATH)).files, packs: new NARC(rom.getFileByName(MAP_TEXTURES_PATH)).files, areas: rom.getFileByName(AREA_PATH) };
    sources.set(bytes, source);
  }
  return source;
}

/** The grass brush's layers, back to front, as decoded textures for the season. */
export async function grassPreview(project: ProjectState, kind: MapGrassKind, season: MatrixSeason): Promise<DecodedTexture[] | undefined> {
  const source = await sourceRom(project);
  const pack = source?.packs[ROUTE_1_PACK + MATRIX_SEASONS.indexOf(season)];
  if (!pack?.length) return undefined;
  const bank = readNitroResources(pack);
  return [...GRASS_LAYERS[kind]].reverse().flatMap(({ texture }) => {
    const image = bank.textures.find(t => t.name === texture), palette = bank.palettes.find(p => p.name === `${texture}_pl`);
    const decoded = image && decodeTexture(image, palette);
    return decoded ? [decoded] : [];
  });
}

/** Primitives of one donor map, textured with a pack, clipped to a box (world units, chunk-local). */
function donorPrimitives(source: Sources, map: number, pack: number, materials: readonly string[], box: { x0: number; x1: number; z0: number; z1: number }) {
  const donor = source.maps[map], textures = source.packs[pack];
  if (!donor?.length || !textures?.length) return undefined;
  const model = readNitroResources(extractGameFreakContainer(donor).files[0]), bank = readNitroResources(textures);
  const primitives = buildModelPrimitives({ ...model, textures: bank.textures, palettes: bank.palettes }, []);
  const slack = 1.5;
  const inside = (p: Float32Array, i: number) => p[i * 3] >= box.x0 - slack && p[i * 3] <= box.x1 + slack && p[i * 3 + 2] >= box.z0 - slack && p[i * 3 + 2] <= box.z1 + slack;
  const out: Map3dPrimitive[] = [];
  for (const primitive of primitives) {
    if (!materials.includes(primitive.material.name)) continue;
    const kept: number[] = [];
    for (let i = 0; i < primitive.indices.length; i += 3) {
      const face = [primitive.indices[i], primitive.indices[i + 1], primitive.indices[i + 2]];
      if (face.every(index => inside(primitive.positions, index))) kept.push(...face);
    }
    if (kept.length) out.push({ ...primitive, indices: Uint16Array.from(kept), textureAnimation: undefined });
  }
  return out.length ? out : undefined;
}

export async function treePreview(project: ProjectState, type: MapTreeType, season: MatrixSeason) {
  const source = await sourceRom(project);
  if (!source) return undefined;
  const x0 = (type.donor.tileX - 16) * TILE, z0 = (type.donor.tileY - 16) * TILE, span = type.size * TILE;
  return donorPrimitives(source, type.donor.map, type.texturePacks[season], type.materials, { x0, x1: x0 + span, z0, z1: z0 + span });
}

export async function ledgePreview(project: ProjectState, direction: LedgeDirection, season: MatrixSeason) {
  const source = await sourceRom(project);
  const game = project.session.baseRom === "BW" ? "BW" : "BW2";
  if (!source) return undefined;
  const donor = LEDGE_DONORS[game][direction];
  const column = direction === "left" || direction === "right";
  const x0 = (donor.tileX - 16) * TILE, z0 = (donor.tileY - 16) * TILE;
  const box = column ? { x0: x0 - TILE, x1: x0 + 2 * TILE, z0, z1: z0 + donor.length * TILE } : { x0, x1: x0 + donor.length * TILE, z0: z0 - TILE, z1: z0 + 2 * TILE };
  return donorPrimitives(source, donor.map, ROUTE_1_PACK + MATRIX_SEASONS.indexOf(season), ["dansa01a"], box);
}

/** A stamp's donor object, drawn with its area's textures for the season (or the nearest season that has them). */
export async function stampPreview(project: ProjectState, type: MapStampType, season: MatrixSeason) {
  const source = await sourceRom(project);
  if (!source) return undefined;
  const [x0, x1, z0, z1] = type.donor.box;
  const start = MATRIX_SEASONS.indexOf(season);
  for (const step of [0, 1, 2, 3]) {
    const pack = parseAreaHeader(source.areas, seasonalAreaId("BW2", type.donor.area, MATRIX_SEASONS[(start - step + 4) % 4])).texturesId;
    const art = donorPrimitives(source, type.donor.map, pack, type.materials, { x0, x1, z0, z1 });
    if (art?.every(primitive => primitive.material.texture)) return art;
  }
  return undefined;
}

/** A vanilla thick grass patch (map 62, area 38), drawn with the season's textures. */
export async function thickGrassPreview(project: ProjectState, materials: readonly string[], season: MatrixSeason) {
  const source = await sourceRom(project);
  if (!source) return undefined;
  const pack = parseAreaHeader(source.areas, seasonalAreaId("BW2", 38, season)).texturesId;
  return donorPrimitives(source, 62, pack, materials, { x0: -256, x1: 256, z0: -256, z1: 256 });
}

/** A fence's donor run, drawn with its area's textures for the season. */
export async function fencePreview(project: ProjectState, type: MapFenceType, season: MatrixSeason) {
  const source = await sourceRom(project);
  if (!source) return undefined;
  const donor = type.donors.find(entry => entry.axis === "x") ?? type.donors[0];
  const [x0, x1, z0, z1] = donor.box;
  const start = MATRIX_SEASONS.indexOf(season);
  for (const step of [0, 1, 2, 3]) {
    const pack = parseAreaHeader(source.areas, seasonalAreaId("BW2", donor.area, MATRIX_SEASONS[(start - step + 4) % 4])).texturesId;
    // The game draws long runs as single faces, so show the whole run.
    const art = donorPrimitives(source, donor.map, pack, type.materials, { x0, x1, z0, z1 });
    if (!art?.every(primitive => primitive.material.texture)) continue;
    if (donor.axis === "x") return art;
    // A fence the game only runs north–south is shown turned, face on like the others.
    return art.map(primitive => {
      const positions = primitive.positions.slice();
      for (let i = 0; i < positions.length; i += 3) [positions[i], positions[i + 2]] = [primitive.positions[i + 2], -primitive.positions[i]];
      return { ...primitive, positions };
    });
  }
  return undefined;
}

/** A prop's building model from its donor area's bundle, with the bundle's textures (not seasonal). */
export async function propPreview(project: ProjectState, type: MapPropType) {
  const source = await sourceRom(project);
  if (!source) return undefined;
  const area = parseAreaHeader(source.areas, type.donor.area);
  const bundle = new NARC(source.rom.getFileByName("a/2/2/5")).files[area.buildingsId], textures = new NARC(source.rom.getFileByName("a/1/7/4")).files[area.buildingsId];
  if (!bundle?.length || !textures?.length) return undefined;
  const files = extractGameFreakContainer(bundle).files, count = files.length / 2;
  const index = files.slice(0, count).findIndex(meta => (meta[0] | (meta[1] << 8)) === type.donor.uid);
  if (index < 0) return undefined;
  const model = readNitroResources(files[count + index]), bank = readNitroResources(textures);
  const art = buildModelPrimitives({ ...model, textures: [...model.textures, ...bank.textures], palettes: [...model.palettes, ...bank.palettes] }, []);
  return art.length ? art.map(primitive => ({ ...primitive, textureAnimation: undefined })) : undefined;
}
