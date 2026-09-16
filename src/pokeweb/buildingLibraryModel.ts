import { readAscii, readU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { loadActiveRomBytes } from "./persistence";
import type { ProjectState } from "./projectStore";
import { getRomFileBytes } from "./fileSystemModel";
import { modelAssetHash } from "./buildingGlb";
import { buildModelPrimitives, extractGameFreakContainer, readNitroModelNames, readNitroResources, type Map3dPrimitive, type Map3dSceneData } from "./map3dModel";

export type BuildingBundleKind = "exterior" | "interior";
export type BuildingLibraryEntry = {
  id: string;
  kind: BuildingBundleKind;
  bundleId: number;
  resourceIndex: number;
  uid: number;
  name: string;
  modelBytes: Uint8Array;
  metadataBytes: Uint8Array;
};
export type BuildingLibraryAsset = BuildingLibraryEntry & {
  primitives: Map3dPrimitive[];
  warnings: string[];
};
export type BuildingLibrary = {
  entries: BuildingLibraryEntry[];
  warnings: string[];
  load: (id: string) => BuildingLibraryAsset;
};

/** Keep variants separate: UIDs are local to a bundle, not globally unique. */
export function indexBuildingBundles(kind: BuildingBundleKind, files: Uint8Array[], warnings: string[] = []): BuildingLibraryEntry[] {
  const entries: BuildingLibraryEntry[] = [];
  files.forEach((bytes, bundleId) => {
    if (!bytes.length) return;
    try {
      const bundle = extractGameFreakContainer(bytes);
      if (bundle.files.length % 2) throw new Error("Unpaired building metadata and models");
      const count = bundle.files.length / 2;
      for (let resourceIndex = 0; resourceIndex < count; resourceIndex += 1) {
        const metadataBytes = bundle.files[resourceIndex];
        const modelBytes = bundle.files[count + resourceIndex];
        if (metadataBytes.length < 2 || readAscii(modelBytes, 0, 4) !== "BMD0") {
          warnings.push(`${kind} bundle ${bundleId}, resource ${resourceIndex}: missing metadata or BMD0 model.`);
          continue;
        }
        entries.push({ id: `${kind}:${bundleId}:${resourceIndex}`, kind, bundleId, resourceIndex, uid: readU16(metadataBytes, 0),
          name: readNitroModelNames(modelBytes).join(" / ") || "Unnamed model", metadataBytes, modelBytes });
      }
    } catch (error) {
      warnings.push(`${kind} bundle ${bundleId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return entries;
}

const libraries = new WeakMap<ProjectState, Promise<BuildingLibrary>>();
export function invalidateBuildingLibrary(project: ProjectState): void { libraries.delete(project); }
export function loadBuildingLibrary(project: ProjectState): Promise<BuildingLibrary> {
  const previous = libraries.get(project);
  if (previous) return previous;
  const loading = readBuildingLibrary(project).catch((error) => { libraries.delete(project); throw error; });
  libraries.set(project, loading);
  return loading;
}

async function readBuildingLibrary(project: ProjectState): Promise<BuildingLibrary> {
  const game = project.session.baseRom;
  if (game !== "BW" && game !== "BW2") throw new Error("The building library currently supports BW and BW2.");
  const bytes = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!bytes) throw new Error("Reload the ROM to browse its buildings.");
  const rom = new NintendoDSRom(bytes);
  const paths = game === "BW2"
    ? { exterior: ["a/2/2/5", "a/1/7/4"], interior: ["a/2/2/6", "a/1/7/5"] }
    : { exterior: ["a/2/2/9", "a/1/7/6"], interior: ["a/2/3/0", "a/1/7/7"] };
  const warnings: string[] = [];
  const entries: BuildingLibraryEntry[] = [];
  const textures = new Map<BuildingBundleKind, Uint8Array[]>();
  for (const kind of ["exterior", "interior"] as const) {
    const [modelPath, texturePath] = paths[kind];
    try {
      const models = new NARC(project.narcs ? getRomFileBytes(project, rom, rom.fileId(modelPath)) : rom.getFileByName(modelPath));
      entries.push(...indexBuildingBundles(kind, models.files, warnings));
    } catch (error) {
      warnings.push(`${kind} models: ${error instanceof Error ? error.message : String(error)}`);
    }
    try { textures.set(kind, new NARC(project.narcs ? getRomFileBytes(project, rom, rom.fileId(texturePath)) : rom.getFileByName(texturePath)).files); }
    catch (error) { warnings.push(`${kind} textures: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const decoded = new Map<string, BuildingLibraryAsset>();
  return {
    entries, warnings,
    load(id) {
      const cached = decoded.get(id);
      if (cached) return cached;
      const entry = byId.get(id);
      if (!entry) throw new Error("Choose a building from the library.");
      const model = readNitroResources(entry.modelBytes);
      const warnings: string[] = [];
      const textureBytes = textures.get(entry.kind)?.[entry.bundleId];
      if (textureBytes?.length) {
        try {
          const external = readNitroResources(textureBytes);
          model.textures.push(...external.textures);
          model.palettes.push(...external.palettes);
        } catch (error) { warnings.push(`Textures: ${error instanceof Error ? error.message : String(error)}`); }
      }
      const primitives = buildModelPrimitives(model, warnings);
      if (!primitives.some((primitive) => primitive.indices.length)) throw new Error("This building contains no supported geometry.");
      const asset = { ...entry, primitives, warnings };
      // Avoid retaining decoded geometry/textures for the entire game while browsing.
      if (decoded.size >= 8) decoded.delete(decoded.keys().next().value!);
      decoded.set(id, asset);
      return asset;
    },
  };
}

export function buildingLibraryScene(asset: BuildingLibraryAsset): Map3dSceneData {
  return {
    zoneId: -1, label: `${asset.name} · ${asset.kind} bundle ${asset.bundleId} · UID ${asset.uid}`,
    season: "spring", matrixId: -1, sourceMatrixId: -1, areaId: -1, sourceAreaId: -1, textureId: asset.bundleId, buildingsId: asset.bundleId,
    areaMetadata: { buildingsId: asset.bundleId, texturesId: asset.bundleId, srtAnimeIdx: 255, patAnimeIdx: 255, isExterior: asset.kind === "exterior" },
    seasonal: false, chunkSpan: 512, chunkCount: 0, buildingCount: 1, textureCount: 0, entityCount: 0, npcModelCount: 0, permissionTileCount: 0,
    chunks: [], buildings: [{ uid: asset.uid, chunkId: -1, sourceChunkId: -1, worldX: 0, worldY: 0, worldZ: 0, rotationY: 0, primitives: asset.primitives }],
    entities: [], npcModels: [], warnings: asset.warnings,
  };
}

export async function exportBuildingGlb(asset: BuildingLibraryAsset) {
  const { exportMap3dGlb } = await import("./map3dExport");
  const name = asset.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60);
  return exportMap3dGlb(buildingLibraryScene(asset), {
    filename: `building-${asset.kind}-bundle-${asset.bundleId}-uid-${asset.uid}-resource-${asset.resourceIndex}${name ? `-${name}` : ""}.glb`,
    metadata: { content: "Static building model", bundleKind: asset.kind, bundleId: asset.bundleId, uid: asset.uid, resourceIndex: asset.resourceIndex, modelName: asset.name,
      buildingImportVersion: 1, sourceModelHash: await modelAssetHash(asset.modelBytes) },
  });
}
