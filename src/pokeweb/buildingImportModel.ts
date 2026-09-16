import { readAscii, readU16, readU32, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { modelAssetHash, readBuildingGlb } from "./buildingGlb";
import { invalidateBuildingLibrary, type BuildingLibraryAsset } from "./buildingLibraryModel";
import { getRomFileBytes } from "./fileSystemModel";
import { buildModelPrimitives, extractGameFreakContainer, invalidateMap3dAssets, readNitroResources } from "./map3dModel";
import { writeStaticNitroModel } from "./nitroModelWriter";
import { loadActiveRomBytes } from "./persistence";
import { createNarcStore, markDirty, type ProjectState } from "./projectStore";

export type BuildingImport = {
  original: BuildingLibraryAsset;
  converted: BuildingLibraryAsset;
  originalTriangles: number;
  convertedTriangles: number;
};

export function assertStaticBuilding(asset: BuildingLibraryAsset): void {
  const metadata = asset.metadataBytes;
  if (metadata.length < 36 || metadata[16] !== 0 || metadata[18] !== 0 || metadata[19] !== 0
    || [20, 24, 28, 32].some(offset => readU32(metadata, offset) !== 0xffffffff)) {
    throw new Error("Animated buildings are not supported by this first static importer. Choose a non-animated building.");
  }
}

/** Static geometry may retain material-only animation; joint animation cannot survive node flattening. */
export function assertMaterialAnimatedBuilding(asset: BuildingLibraryAsset): void {
  const metadata = asset.metadataBytes;
  if (metadata.length < 36 || metadata[17] !== 0) throw new Error("Procedural building animation is unsupported.");
  let animations = 0;
  for (const offset of [20, 24, 28, 32]) {
    const relative = readU32(metadata, offset); if (relative === 0xffffffff) continue;
    const start = 16 + relative;
    if (start < 36 || start + 16 > metadata.length || !["BTA0", "BMA0"].includes(readAscii(metadata, start, 4)) || start + readU32(metadata, start + 8) > metadata.length) {
      throw new Error("This building uses joint or texture-pattern animation. Only existing texture-transform and material-color animations can accompany imported geometry.");
    }
    animations++;
  }
  if (!animations) assertStaticBuilding(asset);
}

export async function prepareBuildingImport(asset: BuildingLibraryAsset, glb: Uint8Array): Promise<BuildingImport> {
  assertStaticBuilding(asset);
  const imported = readBuildingGlb(glb);
  const id = imported.metadata;
  if (id.bundleKind !== asset.kind || id.bundleId !== asset.bundleId || id.resourceIndex !== asset.resourceIndex || id.uid !== asset.uid) {
    throw new Error("This GLB belongs to a different building. Select its original type, bundle, and UID.");
  }
  if (id.sourceModelHash !== await modelAssetHash(asset.modelBytes)) {
    throw new Error("The building changed since this GLB was exported. Export the current building again before importing edits.");
  }
  const modelBytes = writeStaticNitroModel(asset.modelBytes, imported.meshes);
  const warnings: string[] = [];
  const primitives = buildModelPrimitives(readNitroResources(modelBytes), warnings);
  if (warnings.length || !primitives.length) throw new Error(`Converted model failed validation: ${warnings.join("; ") || "no geometry"}`);
  // The first milestone retains the original native texture pack. Preview those exact bindings.
  for (const primitive of primitives) primitive.material.texture = asset.primitives.find(p => p.material.name === primitive.material.name)?.material.texture;
  const converted = { ...asset, modelBytes, primitives, warnings };
  return { original: asset, converted,
    originalTriangles: asset.primitives.reduce((n, p) => n + p.indices.length / 3, 0),
    convertedTriangles: primitives.reduce((n, p) => n + p.indices.length / 3, 0) };
}

/** Replace one native member without losing other members, header padding, or trailing data. */
export function replaceBuildingModelMember(bundle: Uint8Array, member: number, model: Uint8Array): Uint8Array {
  const container = extractGameFreakContainer(bundle);
  if (!Number.isInteger(member) || member < 0 || member >= container.files.length) throw new Error("Invalid building bundle member.");
  const start = readU32(bundle, 4 + member * 4), end = readU32(bundle, 8 + member * 4);
  if (start < 4 + (container.files.length + 1) * 4) throw new Error("Building member overlaps the bundle header.");
  // Keep native padding following the old BMD0 when present.
  const old = container.files[member], oldSize = readU32(old, 8);
  if (oldSize < 16 || oldSize > old.length) throw new Error("Invalid source building model size.");
  const padding = old.subarray(oldSize);
  const replacementSize = model.length + padding.length;
  const delta = replacementSize - (end - start);
  const result = new Uint8Array(bundle.length + delta);
  result.set(bundle.subarray(0, start)); result.set(model, start); result.set(padding, start + model.length);
  result.set(bundle.subarray(end), start + replacementSize);
  for (let i = member + 1; i <= container.files.length; i++) writeU32(result, 4 + i * 4, readU32(bundle, 4 + i * 4) + delta);
  return result;
}

export async function applyBuildingImport(project: ProjectState, result: BuildingImport, undo = false): Promise<void> {
  if (project.session.baseRom !== "BW2") throw new Error("Building import currently supports Black 2 and White 2 projects.");
  const asset = result.original;
  const bytes = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!bytes) throw new Error("Reload the ROM before importing a building.");
  const rom = new NintendoDSRom(bytes);
  const path = asset.kind === "exterior" ? "a/2/2/5" : "a/2/2/6";
  const storeName = asset.kind === "exterior" ? "exterior_building_models" : "interior_building_models";
  const fileId = rom.fileId(path);
  const narc = new NARC(getRomFileBytes(project, rom, fileId));
  const bundle = narc.files[asset.bundleId];
  if (!bundle) throw new Error("The building bundle no longer exists.");
  const members = extractGameFreakContainer(bundle).files;
  const memberIndex = members.length / 2 + asset.resourceIndex;
  if (members.length % 2 || !members[asset.resourceIndex] || readU16(members[asset.resourceIndex], 0) !== asset.uid || !members[memberIndex]) {
    throw new Error("The building bundle changed. Reload the building before importing.");
  }
  const expected = undo ? result.converted.modelBytes : result.original.modelBytes;
  const current = members[memberIndex];
  const nativeLength = readU32(current, 8);
  const expectedLength = readU32(expected, 8);
  if (nativeLength !== expectedLength || !current.subarray(0, nativeLength).every((byte, i) => byte === expected[i])
    || members[asset.resourceIndex].length !== asset.metadataBytes.length
    || !members[asset.resourceIndex].every((byte, i) => byte === asset.metadataBytes[i])) {
    throw new Error("The building changed while this import was open. Reload it before applying.");
  }
  const replacement = undo ? result.original.modelBytes.subarray(0, readU32(result.original.modelBytes, 8))
    : result.converted.modelBytes;
  const rebuilt = replaceBuildingModelMember(bundle, memberIndex, replacement);
  // Everything above is read-only. Commit a complete, validated bundle in one mutation.
  const store = project.narcs[storeName] ?? createNarcStore(storeName, path, fileId, narc);
  if (store.fileId !== fileId || store.sourcePath !== path) throw new Error("Conflicting building archive store.");
  project.narcs[storeName] = store;
  store.rawFiles[asset.bundleId] = rebuilt; store.records.delete(asset.bundleId);
  markDirty(project, storeName, asset.bundleId);
  invalidateBuildingLibrary(project); invalidateMap3dAssets();
}
