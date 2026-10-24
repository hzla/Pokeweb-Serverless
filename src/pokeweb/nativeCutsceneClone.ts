import { readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { getRomFileBytes, replaceRomFile } from "./fileSystemModel";
import { recordGenericChange } from "./actionChangelog";
import type { ProjectState } from "./projectStore";
import { openNativeCutscene, readNativeSceneDefinition, type NativeCutsceneLibrary } from "./nativeCutsceneModel";
import { readNativeCameraTrack } from "./nativeCameraTrack";
import { CUTSCENE_ID_CHECK, CUTSCENE_MAX_OVERLAY_SIZE, CUTSCENE_ORIGINAL_SIZE, CUTSCENE_OVERLAY_BASE, CUTSCENE_REGISTRY_HEADER_SIZE, CUTSCENE_TABLE_READERS, readNativeCutsceneLayout } from "./nativeCutsceneRegistry";

/** Build everything in owned buffers before publishing any project changes. */
export function buildAspertiaCutsceneClone(sourceOverlay: Uint8Array, sourceFiles: readonly Uint8Array[]) {
  const layout = readNativeCutsceneLayout(sourceOverlay);
  if (layout.kind !== "original") throw new Error("Sequence 27 already exists. Open it to continue editing.");
  const source = readNativeSceneDefinition(sourceOverlay, CUTSCENE_OVERLAY_BASE, 5);
  readNativeCameraTrack(sourceFiles[source.cameraId]);
  const files = [...sourceFiles], assetMap = new Map<number, number>();
  const copyAsset = (id: number) => {
    let target = assetMap.get(id);
    if (target !== undefined) return target;
    if (!sourceFiles[id] || files.length >= 65535) throw new Error("The scene archive is missing an asset or has no free native member IDs.");
    target = files.length; assetMap.set(id, target); files.push(new Uint8Array(sourceFiles[id])); return target;
  };
  const cameraId = copyAsset(source.cameraId);
  const output = new Uint8Array(CUTSCENE_MAX_OVERLAY_SIZE); output.set(sourceOverlay);
  let cursor = sourceOverlay.length;
  const reserve = (size: number) => {
    cursor = (cursor + 3) & ~3; const at = cursor; cursor += size;
    if (cursor > output.length) throw new Error("Custom cutscene metadata exceeds the supported overlay budget.");
    return at;
  };
  const pointer = (at: number, value: number) => writeU32(output, at, CUTSCENE_OVERLAY_BASE + value);
  const header = reserve(CUTSCENE_REGISTRY_HEADER_SIZE), table = reserve(28 * 20);
  output.set(sourceOverlay.subarray(layout.tableOffset, layout.tableOffset + 27 * 20), table);
  const params = reserve(84); output.set(sourceOverlay.subarray(source.paramsOffset, source.paramsOffset + 84), params); writeU16(output, params, cameraId);
  const cues = reserve((source.cues.length + 1) * 40); output.set(sourceOverlay.subarray(source.commandsOffset, source.commandsOffset + (source.cues.length + 1) * 40), cues);
  const oldEnd = readU32(sourceOverlay, layout.tableOffset + 5 * 20 + 8) - CUTSCENE_OVERLAY_BASE;
  const end = reserve((source.endCues.length + 1) * 40); output.set(sourceOverlay.subarray(oldEnd, oldEnd + (source.endCues.length + 1) * 40), end);
  const roots = reserve(source.resources.length * 8);
  source.resources.forEach((resource, i) => {
    const bundles = reserve(resource.bundles.length * 8), root = roots + i * 8;
    pointer(root, bundles); writeU16(output, root + 4, resource.bundles.length); writeU16(output, root + 6, resource.selection);
    resource.bundles.forEach((bundle, j) => {
      const groups = reserve(bundle.length * 8), entry = bundles + j * 8;
      pointer(entry, groups); writeU32(output, entry + 4, bundle.length);
      bundle.forEach((group, k) => {
        const ids = reserve(group.length * 2), at = groups + k * 8;
        pointer(at, ids); writeU32(output, at + 4, group.length);
        group.forEach((id, n) => writeU16(output, ids + n * 2, copyAsset(id)));
      });
    });
  });
  const descriptor = table + 27 * 20;
  [params, cues, end, roots].forEach((at, i) => pointer(descriptor + i * 4, at)); writeU32(output, descriptor + 16, source.resources.length);
  output.set(new TextEncoder().encode("PWCS"), header);
  const size = (cursor + 3) & ~3;
  [1, size, table, 28, 5, cameraId, assetMap.size].forEach((n, i) => writeU32(output, header + 4 + i * 4, n));
  output[CUTSCENE_ID_CHECK + 4] = 28;
  for (const { address, field } of CUTSCENE_TABLE_READERS) pointer(address - CUTSCENE_OVERLAY_BASE, table + field);
  const overlay = output.slice(0, size);
  readNativeCutsceneLayout(overlay); readNativeSceneDefinition(overlay, CUTSCENE_OVERLAY_BASE, 27);
  return { overlay, files, cameraId, assetMap };
}

export function createAspertiaCutsceneClone(project: ProjectState, library: NativeCutsceneLibrary) {
  if (project.session.baseVersion !== "W2" || project.romInfo.idCode !== "IRDO") throw new Error("Custom cutscenes currently require US White 2.");
  const original = library.rom.loadArm9Overlays([293]).get(293)!;
  if (original.bssSize || original.ramAddress !== CUTSCENE_OVERLAY_BASE || original.staticInitEnd > CUTSCENE_OVERLAY_BASE + CUTSCENE_ORIGINAL_SIZE) throw new Error("Unsupported native cutscene overlay memory layout.");
  const archive = new NARC(getRomFileBytes(project, library.rom, library.fileId));
  const result = buildAspertiaCutsceneClone(project.overlays[293] ?? library.overlayBytes, archive.files);
  archive.files = result.files;
  replaceRomFile(project, library.rom, library.fileId, archive.save());
  project.overlays[293] = result.overlay;
  project.patches ??= { dirtyOverlayIds: [] };
  if (!project.patches.dirtyOverlayIds.includes(293)) project.patches.dirtyOverlayIds.push(293);
  library.overlayBytes = result.overlay;
  library.definitions = Array.from({ length: 27 }, (_, i) => readNativeSceneDefinition(result.overlay, CUTSCENE_OVERLAY_BASE, i + 1));
  recordGenericChange(project, "file_system", "Created native sequence 27 as an independent Aspertia clone.", "Cutscene 27", { key: "native-cutscene-create:27" });
  return { document: openNativeCutscene(project, library, 27), assetMap: result.assetMap };
}
