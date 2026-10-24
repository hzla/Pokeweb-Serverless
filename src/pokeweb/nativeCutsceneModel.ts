import { NintendoDSRom } from "../nds/rom";
import { NARC } from "../nds/narc";
import { activeRomMatchesProject, loadActiveRomBytes } from "./persistence";
import { getRomFileBytes, replaceRomFile } from "./fileSystemModel";
import type { ProjectState } from "./projectStore";
import { compileNitroAnimatedModel } from "./nitroAnimatedModel";
import type { NitroMatrix } from "./nitroAnimation";
import { recordGenericChange } from "./actionChangelog";
import { cameraTrackEqual, readNativeCameraTrack, type NativeCameraTrack } from "./nativeCameraTrack";
import { CUTSCENE_ORIGINAL_SIZE, readNativeCutsceneLayout } from "./nativeCutsceneRegistry";

const ARCHIVE = "a/1/5/8", TABLE = 0x021a6ecc;
export const NATIVE_SEQUENCE_IDS = Array.from({ length: 26 }, (_, i) => i + 1);
export const NATIVE_SEQUENCE_NAMES = ["", "Opening montage", "Cruise ship at port", "Ferris wheel", "Plasma Frigate at port", "Aspertia flyover", "Ending · Black variant", "Ending · White variant", "Legendary awakening · Black variant", "Legendary awakening · White variant", "Virbank boat", "Black 2 title", "White 2 title", "Plasma Frigate flight", "City airship arrival · 1", "City airship arrival · 2", "Kyurem introduction", "Black Kyurem transformation · 1", "Black Kyurem transformation · 2", "Black Kyurem transformation · 3", "White Kyurem transformation · 1", "White Kyurem transformation · 2", "White Kyurem transformation · 3", "Virbank ship departure", "Mistralton plane departure", "Lentimas plane departure", "Virbank ship · short", "Aspertia flyover · custom clone"];
/** Exported ROMs can contain private sequences beyond the built-in name catalog. */
export function nativeCutsceneName(id: number): string {
  return NATIVE_SEQUENCE_NAMES[id] ?? `Custom map sequence ${id}`;
}
export type NativeSceneCue = { opcode: number; frame: number; args: number[] };
export type NativeSceneResource = { selection: number; bundles: number[][][] };
export type NativeSceneDefinition = {
  id: number; cameraId: number; zoneId: number; fps: number; flags: number;
  fov: number; aspect: number; near: number; far: number; clearColor: number;
  dualScreen: boolean; topOffset: number; bottomOffset: number; ndc: number;
  commandsOffset: number; paramsOffset: number;
  startFade: { white: boolean; duration: number }; endFade: { white: boolean; duration: number }; resources: NativeSceneResource[]; cues: NativeSceneCue[]; endCues: NativeSceneCue[];
};
export type NativeCutsceneLibrary = { rom: NintendoDSRom; fileId: number; definitions: NativeSceneDefinition[]; overlayBytes: Uint8Array };
export type NativeSceneAssetEdit = { baseline: Uint8Array; bytes: Uint8Array };
export type NativeCutsceneDocument = { rom: NintendoDSRom; fileId: number; definition: NativeSceneDefinition; camera: NativeCameraTrack; baseline: Uint8Array; files: Uint8Array[]; cueBaseline?: Uint8Array; fadeBaseline?: Uint8Array; assets?: Map<number, NativeSceneAssetEdit>; library?: NativeCutsceneLibrary };

/** Resolve bounded native pointers rather than assuming the scene tables are contiguous. */
export function readNativeSceneDefinition(bytes: Uint8Array, ramAddress: number, id = 5): NativeSceneDefinition {
  const layout = bytes.length >= CUTSCENE_ORIGINAL_SIZE ? readNativeCutsceneLayout(bytes) : { count: 27, tableOffset: TABLE - ramAddress };
  if (!Number.isInteger(id) || id < 1 || id >= layout.count) throw new Error(`Choose an installed sequence from 1 to ${layout.count - 1}.`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = (address: number, size: number) => { const at = address - ramAddress; if (!Number.isSafeInteger(at) || at < 0 || at + size > bytes.length) throw new Error("Native scene table points outside overlay 293. This ROM layout is unsupported."); return at; };
  const ptr = (at: number, size: number) => offset(v.getUint32(at, true), size);
  const count = (n: number, max: number) => { if (n < 1 || n > max) throw new Error("Invalid native scene resource count."); return n; };
  const header = offset(ramAddress + layout.tableOffset + id * 20, 20), params = ptr(header, 84), flags = v.getUint16(params + 6, true);
  const readCues = (address: number) => {
    const result: NativeSceneCue[] = [];
    for (let i = 0; i < 1024; i++) {
      const at = offset(address + i * 40, 40), opcode = v.getInt32(at, true);
      if (opcode === 19) return result;
      const frame = v.getInt32(at + 4, true);
      if (opcode < 0 || opcode > 18 || frame < -1 || frame > 65535) throw new Error("Unsupported native scene command table.");
      result.push({ opcode, frame, args: Array.from({ length: 8 }, (_, j) => v.getInt32(at + 8 + j * 4, true)) });
    }
    throw new Error("Native scene command list has no terminator.");
  };
  const n = count(v.getUint32(header + 16, true), 64), table = ptr(header + 12, n * 8);
  const resources = Array.from({ length: n }, (_, i) => {
    const at = table + i * 8, nBundles = count(v.getUint16(at + 4, true), 32), bundleTable = ptr(at, nBundles * 8), selection = v.getUint16(at + 6, true);
    if (selection > 3) throw new Error("Unknown scene resource selection mode.");
    const bundles = Array.from({ length: nBundles }, (_, j) => {
      const b = bundleTable + j * 8, nGroups = count(v.getUint32(b + 4, true), 16), groupTable = ptr(b, nGroups * 8);
      return Array.from({ length: nGroups }, (_, k) => {
        const g = groupTable + k * 8, size = count(v.getUint32(g + 4, true), 32), ids = ptr(g, size * 2);
        return Array.from({ length: size }, (_, l) => v.getUint16(ids + l * 2, true));
      });
    });
    return { selection, bundles };
  });
  const fx = (at: number) => v.getInt32(params + at, true) / 4096, ndc = fx(28), fov = fx(12), aspect = fx(16), near = fx(20) / ndc, far = fx(24) / ndc;
  if (fov <= 0 || fov >= 180 || aspect <= 0 || near <= 0 || far <= near || ![near, far].every(Number.isFinite)) throw new Error("Unsupported scene projection.");
  // The native player advances 1.0 sample at 30 Hz or 0.5 at 60 Hz.
  return { id, cameraId: v.getUint16(params, true), zoneId: v.getUint16(params + 4, true), flags, fps: 30,
    dualScreen: Boolean(flags & 2), topOffset: v.getInt16(params + 32, true) / 4096, bottomOffset: v.getInt16(params + 34, true) / 4096, ndc,
    commandsOffset: ptr(header + 4, 40), paramsOffset: params,
    fov, aspect, near, far, clearColor: v.getUint16(params + 40, true), startFade: { white: bytes[params + 78] !== 0, duration: bytes[params + 79] }, endFade: { white: bytes[params + 80] !== 0, duration: bytes[params + 81] }, resources,
    cues: readCues(v.getUint32(header + 4, true)), endCues: readCues(v.getUint32(header + 8, true)) };
}

export async function loadNativeCutsceneLibrary(project: ProjectState): Promise<NativeCutsceneLibrary> {
  if (project.session.baseVersion !== "W2" || project.romInfo.idCode !== "IRDO") throw new Error("Native cutscenes currently support US White 2 only.");
  if (!project.originalRomBytes && !await activeRomMatchesProject(project)) throw new Error("Reconnect this project's source ROM to load cutscenes.");
  const source = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!source) throw new Error("Reconnect the source ROM to load cutscenes.");
  const rom = new NintendoDSRom(source, { fileData: "view" }), overlay = rom.loadArm9Overlays([293]).get(293);
  if (!overlay || overlay.ramAddress !== 0x021a1ba0) throw new Error("Unsupported White 2 scene overlay.");
  const overlayBytes = new Uint8Array(project.overlays[293] ?? overlay.data);
  return { rom, fileId: rom.fileId(ARCHIVE), overlayBytes, definitions: Array.from({ length: readNativeCutsceneLayout(overlayBytes).count - 1 }, (_, i) => readNativeSceneDefinition(overlayBytes, overlay.ramAddress, i + 1)) };
}
export function openNativeCutscene(project: ProjectState, library: NativeCutsceneLibrary, id = 5): NativeCutsceneDocument {
  const { rom, fileId } = library, overlay = project.overlays[293] ?? library.overlayBytes;
  const definition = readNativeSceneDefinition(overlay, 0x021a1ba0, id);
  const files = new NARC(getRomFileBytes(project, rom, fileId)).files, cameraBytes = files[definition.cameraId];
  if (!cameraBytes) throw new Error("Scene camera resource is missing.");
  // Also own these arrays when a Node caller supplied a Buffer (whose slice borrows storage).
  return { rom, fileId, definition, files, baseline: new Uint8Array(cameraBytes), camera: readNativeCameraTrack(new Uint8Array(cameraBytes)), library,
    cueBaseline: new Uint8Array(overlay.subarray(definition.commandsOffset, definition.commandsOffset + (definition.cues.length + 1) * 40)), fadeBaseline: new Uint8Array(overlay.subarray(definition.paramsOffset + 78, definition.paramsOffset + 82)), assets: new Map() };
}
export async function loadNativeCutscene(project: ProjectState, id = 5): Promise<NativeCutsceneDocument> { return openNativeCutscene(project, await loadNativeCutsceneLibrary(project), id); }

export function encodeNativeSceneCues(cues: NativeSceneCue[], baseline: Uint8Array): Uint8Array {
  if (baseline.length !== (cues.length + 1) * 40) throw new Error("Keep the native command slot count. Edit existing cues in this version.");
  const bytes = new Uint8Array(baseline), view = new DataView(bytes.buffer);
  const integer = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  cues.forEach((cue, i) => {
    if (cue.opcode === 0) throw new Error("Native opcode 0 has no callback. Remove or disable this event in the JSON timeline instead.");
    if (!integer(cue.opcode, 0, 18) || !integer(cue.frame, -1, 65535) || cue.args.length !== 8 || cue.args.some(n => !integer(n, -2147483648, 2147483647))) throw new Error("Cue values must be valid native integers; frame must be -1 through 65535.");
    if (cue.opcode === 18 && (cue.args[0] <= 0 || cue.args[0] >= 180 * 4096 || cue.args[1] <= 0 || cue.args[1] >= 180 * 4096)) throw new Error("Projection field of view must be between 0 and 180 degrees.");
    [cue.opcode, cue.frame, ...cue.args].forEach((n, j) => view.setInt32(i * 40 + j * 4, n, true));
  });
  return bytes;
}
export function nativeCutsceneDirty(document: NativeCutsceneDocument) {
  return !cameraTrackEqual(document.camera.bytes, document.baseline) || [...document.assets?.values() ?? []].some(a => !cameraTrackEqual(a.bytes, a.baseline)) || Boolean(document.cueBaseline && !cameraTrackEqual(encodeNativeSceneCues(document.definition.cues, document.cueBaseline), document.cueBaseline)) || Boolean(document.fadeBaseline && !cameraTrackEqual(encodeNativeSceneFades(document.definition, document.fadeBaseline), document.fadeBaseline));
}
export function encodeNativeSceneFades(definition: NativeSceneDefinition, baseline: Uint8Array) {
  const bytes = new Uint8Array(baseline);
  [definition.startFade, definition.endFade].forEach((fade, i) => {
    if (!Number.isInteger(fade.duration) || fade.duration < 0 || fade.duration > 255) throw new Error("Opening/closing fades must last 0 through 255 frames.");
    if (Boolean(baseline[i * 2]) !== fade.white) bytes[i * 2] = Number(fade.white);
    bytes[i * 2 + 1] = fade.duration;
  });
  return bytes;
}

export function saveNativeCutsceneCamera(project: ProjectState, document: NativeCutsceneDocument): void {
  readNativeCameraTrack(document.camera.bytes);
  const archive = new NARC(getRomFileBytes(project, document.rom, document.fileId)), id = document.definition.cameraId;
  if (!archive.files[id] || !cameraTrackEqual(archive.files[id], document.baseline)) throw new Error("The scene camera changed elsewhere. Reload the cutscene before saving.");
  if (document.camera.bytes.length !== document.baseline.length || !cameraTrackEqual(document.camera.bytes.subarray(0, 8), document.baseline.subarray(0, 8))) throw new Error("Keep the original camera header and duration to preserve native cue timing.");
  const edits = new Map(document.assets ?? []);
  edits.set(id, { baseline: document.baseline, bytes: document.camera.bytes });
  for (const [member, edit] of edits) if (!archive.files[member] || !cameraTrackEqual(archive.files[member], edit.baseline)) throw new Error(`Scene resource ${member} changed elsewhere. Reload before saving.`);
  const overlay = project.overlays[293] ?? document.library?.overlayBytes;
  let newOverlay: Uint8Array | undefined, commands: Uint8Array | undefined;
  if (document.cueBaseline) {
    const at = document.definition.commandsOffset;
    if (!overlay || !cameraTrackEqual(overlay.subarray(at, at + document.cueBaseline.length), document.cueBaseline)) throw new Error("Native cues changed elsewhere. Reload before saving.");
    commands = encodeNativeSceneCues(document.definition.cues, document.cueBaseline);
    if (!cameraTrackEqual(commands, document.cueBaseline)) { newOverlay = new Uint8Array(overlay); newOverlay.set(commands, at); }
  }
  const fades = document.fadeBaseline && encodeNativeSceneFades(document.definition, document.fadeBaseline);
  if (document.fadeBaseline) {
    const at = document.definition.paramsOffset + 78;
    if (!overlay || !cameraTrackEqual(overlay.subarray(at, at + 4), document.fadeBaseline)) throw new Error("Scene fades changed elsewhere. Reload before saving.");
    if (!cameraTrackEqual(fades!, document.fadeBaseline)) { newOverlay ??= new Uint8Array(overlay); newOverlay.set(fades!, at); }
  }
  let changed = false;
  for (const [member, edit] of edits) if (!cameraTrackEqual(edit.bytes, edit.baseline)) { archive.files[member] = new Uint8Array(edit.bytes); changed = true; }
  if (changed) replaceRomFile(project, document.rom, document.fileId, archive.save());
  if (newOverlay) {
    project.overlays[293] = newOverlay;
    project.patches ??= { dirtyOverlayIds: [] };
    if (!project.patches.dirtyOverlayIds.includes(293)) project.patches.dirtyOverlayIds.push(293);
    recordGenericChange(project, "file_system", `Native sequence ${document.definition.id}: timed commands and fades updated.`, `Cutscene ${document.definition.id}`, { key: `native-cutscene-cues:${document.definition.id}` });
  }
  document.baseline = document.camera.bytes.slice(); document.files[id] = document.baseline.slice();
  for (const [member, edit] of document.assets ?? []) { edit.baseline = new Uint8Array(edit.bytes); document.files[member] = edit.bytes; }
  if (commands) document.cueBaseline = commands;
  if (fades) document.fadeBaseline = fades;
}

export function nativeSceneGroups(document: NativeCutsceneDocument, season = 0, dayPart = 0, gender = 0, parameter = 0) {
  return document.definition.resources.map(resource => {
    const selection = resource.selection === 3 ? season : resource.selection === 1 ? gender : resource.selection === 2 ? parameter : 0;
    const bundle = resource.bundles[selection] ?? resource.bundles[0]; return bundle[dayPart] ?? bundle[0];
  });
}
export function compileNativeCutscene(document: NativeCutsceneDocument, season = 0, dayPart = 0, gender = 0, parameter = 0) {
  const models = nativeSceneGroups(document, season, dayPart, gender, parameter).map((ids, index) => {
    for (const id of ids) if (!document.files[id] || document.files[id].length < 4) throw new Error(`Scene resource ${id} is missing or truncated.`);
    const asset = (stamp: string) => ids.map(id => document.files[id]).find(b => b && String.fromCharCode(...b.subarray(0, 4)) === stamp);
    const model = asset("BMD0"); if (!model) throw new Error(`Scene resource ${index} has no model.`);
    for (const id of ids) if (!["BMD0", "BCA0", "BTA0", "BTP0", "BMA0", "BVA0"].includes(String.fromCharCode(...document.files[id].subarray(0, 4)))) throw new Error(`Scene resource ${id} uses an unsupported animation format.`);
    return compileNitroAnimatedModel(model, asset("BCA0"), asset("BTA0"), { patternBytes: asset("BTP0"), materialBytes: asset("BMA0"), visibilityBytes: asset("BVA0"), neutralLight: true, sceneFrames: document.camera.frameCount });
  });
  return { models, sample: (frame: number, cameraRotation?: NitroMatrix) => models.forEach(model => model.sample(frame, cameraRotation)) };
}

export function nativeSceneProjection(definition: NativeSceneDefinition, frame: number) {
  let result = { fov: definition.fov, topOffset: definition.topOffset, bottomOffset: definition.bottomOffset };
  for (const cue of [...definition.cues].sort((a, b) => a.frame - b.frame)) if (cue.opcode === 18 && cue.frame <= frame) result = { fov: cue.args[1] / 4096, topOffset: cue.args[2] / 4096, bottomOffset: cue.args[3] / 4096 };
  return result;
}

export function nativeSceneFade(definition: NativeSceneDefinition, frame: number, screen = 3, frameCount?: number): { color: string; opacity: number } {
  const start = definition.startFade;
  let result = { color: start.white ? "white" : "black", opacity: start.duration ? Math.max(0, 1 - frame / start.duration) : 0 };
  for (const cue of [...definition.cues].sort((a, b) => a.frame - b.frame)) if (cue.opcode === 10 && frame >= cue.frame && cue.args[0] & screen) {
    const [, duration, from, to] = cue.args, t = duration > 0 ? Math.min(1, (frame - cue.frame) / duration) : 1, value = from + (to - from) * t;
    result = { color: value < 0 ? "black" : "white", opacity: Math.min(1, Math.abs(value) / 16) };
  } else if (cue.opcode === 11 && frame >= cue.frame && cue.args[0] & screen) {
    const [, from, peak, to, out, back] = cue.args, elapsed = frame - cue.frame;
    const value = elapsed < out ? from + (peak - from) * elapsed / Math.max(1, out) : peak + (to - peak) * Math.min(1, (elapsed - out) / Math.max(1, back));
    result = { color: value < 0 ? "black" : "white", opacity: Math.min(1, Math.abs(value) / 16) };
  }
  const ending = definition.endFade;
  if (frameCount && ending?.duration && frame >= frameCount - ending.duration) result = { color: ending.white ? "white" : "black", opacity: Math.min(1, (frame - frameCount + ending.duration) / ending.duration) };
  return result;
}

export const NATIVE_CUE_NAMES = ["No operation", "Sound effect", "Stop sound", "Sound volume", "Sound pan", "Sound pitch", "Play music", "Stop music", "Fade music", "Change music", "Screen fade", "Extended fade", "Light color", "Light direction", "Message", "2D graphic", "Motion blur on", "Motion blur off", "Projection"];
