import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { parseHeaders } from "./headerModel";
import { getRomFileBytes, replaceRomFile } from "./fileSystemModel";
import { activeRomMatchesProject, loadActiveRomBytes } from "./persistence";
import type { ProjectState } from "./projectStore";
import { FIELD_CAMERA_LOOKUP_ADDRESS, indexedCameraLookup, readFieldCameraBindings, readFieldCameraLayout, validateCameraArchiveReaders, type FieldCameraLayout } from "./fieldCameraLookup";
export { readFieldCameraBindings, readFieldCameraLayout } from "./fieldCameraLookup";

export type CameraVector = { x: number; y: number; z: number };
export type CameraEndpoint = { pitch: number; yaw: number; distance: number; fov: number; offset: CameraVector };
export type CameraPreset = CameraEndpoint & { near: number; far: number; followsPlayer: boolean; roll: number };
export type CameraRectangle = {
  kind: "rectangle"; raw: Uint8Array; x: number; z: number; width: number; height: number;
  axis: "x" | "z"; start: CameraEndpoint; end: CameraEndpoint;
  disableDelay: boolean; stay: number; enter: number; exit: number;
};
export type CameraRegion = CameraRectangle | { kind: "unsupported"; raw: Uint8Array; type: number };
export type CameraBoundary = { type: number; target: number; west: number; east: number; north: number; south: number };
export type CameraPose = { position: CameraVector; target: CameraVector; fov: number; near: number; far: number; regionIndex?: number; weight: number };
export type FieldCameraDocument = {
  rom: NintendoDSRom; zoneId: number; presetId: number; preset: CameraPreset;
  layout: FieldCameraLayout; memberId?: number; bindingOffset?: number; sharedZones: number[];
  regions: CameraRegion[]; baseline: Uint8Array; boundaries: CameraBoundary[];
};
const REGION_PATH = "a/1/5/6";
const TILE = 16;
const ANGLE = 360 / 65536;
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
export const cameraBytesEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const vector = (v: DataView, at: number): CameraVector => ({ x: v.getInt32(at, true) / 4096, y: v.getInt32(at + 4, true) / 4096, z: v.getInt32(at + 8, true) / 4096 });

export function decodeCameraPreset(bytes: Uint8Array): CameraPreset {
  if (bytes.length !== 44) throw new Error("Camera preset must be 44 bytes.");
  const v = view(bytes);
  return { distance: v.getInt32(0, true), pitch: v.getInt32(4, true) * ANGLE, yaw: v.getInt32(8, true) * ANGLE,
    roll: v.getInt32(12, true) * ANGLE, fov: v.getUint16(18, true) * ANGLE * 2,
    near: v.getInt32(20, true) / 4096, far: v.getInt32(24, true) / 4096,
    followsPlayer: v.getUint32(28, true) === 1, offset: vector(v, 32) };
}

export function decodeCameraRegions(bytes: Uint8Array): CameraRegion[] {
  if (bytes.length % 72) throw new Error("Camera region data is not a whole number of 72-byte records.");
  return Array.from({ length: bytes.length / 72 }, (_, index) => {
    const raw = bytes.slice(index * 72, (index + 1) * 72), v = view(raw), type = v.getUint16(64, true);
    if (type !== 1) return { kind: "unsupported", raw, type };
    const horizontal = v.getUint16(4, true) === 1;
    const endpoint = (at: number, offset: number, fov: number): CameraEndpoint => ({
      pitch: v.getUint16(at, true) * ANGLE, yaw: v.getUint16(at + 2, true) * ANGLE,
      distance: v.getInt32(at + 4, true) / 4096, offset: vector(v, offset), fov: v.getUint16(fov, true) * ANGLE * 2,
    });
    return { kind: "rectangle", raw, x: v.getUint16(0, true), z: v.getUint16(2, true),
      width: v.getUint16(horizontal ? 8 : 4, true), height: v.getUint16(horizontal ? 6 : 8, true), axis: horizontal ? "x" : "z",
      start: endpoint(12, 32, 56), end: endpoint(20, 44, 58), disableDelay: v.getUint32(28, true) === 1,
      stay: v.getInt16(66, true), enter: v.getInt16(68, true), exit: v.getInt16(70, true) };
  });
}

function ranged(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return value;
}
const integer = (n: number, min: number, max: number, label: string) => {
  ranged(n, min, max, label); if (!Number.isInteger(n)) throw new Error(`${label} must be a whole number.`); return n;
};
export function encodeCameraRegions(regions: CameraRegion[]): Uint8Array {
  const bytes = new Uint8Array(regions.length * 72);
  regions.forEach((r, i) => {
    if (r.raw.length !== 72) throw new Error("Camera record must be 72 bytes.");
    const raw = r.raw.slice();
    if (r.kind === "rectangle") {
      const v = view(raw);
      for (const key of ["x", "z"] as const) integer(r[key], 0, 65535, key);
      integer(r.width, r.axis === "z" ? 2 : 1, 65535, "Width"); integer(r.height, 1, 65535, "Height");
      if (r.x + r.width > 65536 || r.z + r.height > 65536) throw new Error("Camera rectangle extends beyond the coordinate range.");
      v.setUint16(0, r.x, true); v.setUint16(2, r.z, true);
      v.setUint16(4, r.axis === "x" ? 1 : r.width, true);
      // Keep the reserved orientation word unchanged for vertical records.
      if (r.axis === "x") v.setUint16(6, r.height, true);
      v.setUint16(8, r.axis === "x" ? r.width : r.height, true);
      const putVector = (at: number, p: CameraVector) => [p.x, p.y, p.z].forEach((n, j) => v.setInt32(at + j * 4, Math.round(ranged(n, -524288, 524287.9997, "Target offset") * 4096), true));
      const putEndpoint = (e: CameraEndpoint, at: number, offset: number, fov: number) => {
        v.setUint16(at, Math.round(ranged(e.pitch, 0, 359.999, "Pitch") / ANGLE) & 65535, true);
        v.setUint16(at + 2, Math.round(ranged(e.yaw, 0, 359.999, "Yaw") / ANGLE) & 65535, true);
        v.setInt32(at + 4, Math.round(ranged(e.distance, 0.001, 524287, "Distance") * 4096), true);
        putVector(offset, e.offset);
        ranged(e.fov, r.stay >= 5 ? 1 : 0, 179, "Field of view");
        v.setUint16(fov, Math.round(e.fov / (ANGLE * 2)), true);
      };
      putEndpoint(r.start, 12, 32, 56); putEndpoint(r.end, 20, 44, 58);
      v.setUint32(28, r.disableDelay ? 1 : 0, true); v.setUint16(64, 1, true);
      for (const [at, val] of [[66, r.stay], [68, r.enter], [70, r.exit]]) v.setInt16(at, integer(val, -32768, 32767, "Calculation function"), true);
    }
    bytes.set(raw, i * 72);
  });
  return bytes;
}

export function createCameraRectangle(preset: CameraPreset, x: number, z: number): CameraRectangle {
  const raw = new Uint8Array(72); view(raw).setUint16(6, 1, true);
  return { kind: "rectangle", raw, x, z, width: 4, height: 4, axis: "z", start: structuredClone(preset), end: structuredClone(preset), disableDelay: false, stay: 5, enter: 6, exit: 7 };
}

export function cameraRectangleContains(r: CameraRectangle, tileX: number, tileZ: number): boolean {
  return tileX >= r.x && tileZ >= r.z && tileX < r.x + r.width && tileZ < r.z + r.height;
}

/** A deterministic stationary view. Entry/exit transitions and script overrides require running the game. */
export function evaluateFieldCamera(preset: CameraPreset, regions: CameraRegion[], player: CameraVector, boundaries: CameraBoundary[] = []): CameraPose {
  let selected: CameraRectangle | undefined, regionIndex: number | undefined;
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (r.kind !== "rectangle") throw new Error("This zone contains a camera shape that cannot yet be previewed.");
    if (cameraRectangleContains(r, player.x / TILE, player.z / TILE)) { selected = r; regionIndex = i; break; }
  }
  let endpoint: CameraEndpoint = structuredClone(preset), weight = 0;
  if (selected) {
    const r = selected;
    if (![2, 5].includes(r.stay)) throw new Error(`Stationary camera function ${r.stay} is not supported by this preview.`);
    weight = r.axis === "x" ? (player.x / TILE - r.x) / r.width : (player.z / TILE - r.z) / r.height;
    const lerp = (a: number, b: number) => a + (b - a) * weight;
    endpoint.pitch = lerp(r.start.pitch, r.end.pitch); endpoint.yaw = lerp(r.start.yaw, r.end.yaw); endpoint.distance = lerp(r.start.distance, r.end.distance);
    if (r.stay === 5) {
      endpoint.fov = lerp(r.start.fov, r.end.fov);
      endpoint.offset = { x: lerp(r.start.offset.x, r.end.offset.x), y: lerp(r.start.offset.y, r.end.offset.y), z: lerp(r.start.offset.z, r.end.offset.z) };
    }
  }
  const anchor = { ...(preset.followsPlayer ? player : preset.offset) };
  const clampBoundary = (p: CameraVector, b: CameraBoundary) => {
    p.x = Math.min(b.east, Math.max(b.west, p.x)); p.z = Math.min(b.south, Math.max(b.north, p.z));
  };
  for (const b of boundaries) {
    if (b.type === 0) continue;
    if (b.type !== 1 || ![0, 1].includes(b.target)) throw new Error("This zone uses camera boundaries that cannot yet be previewed.");
    if (b.target === 0) clampBoundary(anchor, b);
  }
  const pitch = endpoint.pitch * Math.PI / 180, yaw = endpoint.yaw * Math.PI / 180;
  const position = { x: anchor.x + Math.sin(yaw) * Math.cos(pitch) * endpoint.distance,
    y: anchor.y + Math.sin(pitch) * endpoint.distance, z: anchor.z + Math.cos(yaw) * Math.cos(pitch) * endpoint.distance };
  const target = preset.followsPlayer ? { x: anchor.x + endpoint.offset.x, y: anchor.y + endpoint.offset.y, z: anchor.z + endpoint.offset.z } : { ...anchor };
  for (const b of boundaries) {
    if (b.type === 0) continue;
    if (b.type !== 1 || ![0, 1].includes(b.target)) throw new Error("This zone uses camera boundaries that cannot yet be previewed.");
    if (b.target === 1) clampBoundary(position, b);
  }
  if (endpoint.fov <= 0 || endpoint.fov >= 180 || preset.near <= 0 || preset.far <= preset.near || preset.roll !== 0) throw new Error("This camera preset has an unsupported projection.");
  return { position, target, fov: endpoint.fov, near: preset.near, far: preset.far, regionIndex, weight };
}

export async function loadFieldCamera(project: ProjectState, zoneId: number): Promise<FieldCameraDocument> {
  if (project.session.baseVersion !== "W2" || project.romInfo.idCode !== "IRDO") throw new Error("Camera regions currently support US White 2 only.");
  if (!project.originalRomBytes && !await activeRomMatchesProject(project)) throw new Error("Reconnect this project's ROM to load camera data.");
  const source = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!source) throw new Error("Reconnect the source ROM to load camera data.");
  const rom = new NintendoDSRom(source, { fileData: "view" });
  const layout = readFieldCameraLayout(project.arm9!, rom.arm9RamAddress);
  const archive = new NARC(getRomFileBytes(project, rom, rom.fileId(REGION_PATH)));
  const bindings = readFieldCameraBindings(project.arm9!, rom.arm9RamAddress, archive.files), binding = bindings.find(b => b.zoneId === zoneId);
  project.headers ??= parseHeaders(project);
  const row = Object.values(project.headers.rows).find(r => r.index === zoneId);
  if (!row) throw new Error("Zone header is missing.");
  // Camera index occupies bits 9..15 of the packed weather/projection/camera word.
  const presetId = Number(row.camera_id) >>> 1;
  const presets = new NARC(getRomFileBytes(project, rom, rom.fileId("a/0/5/9"))).files[0];
  if (!presets || presetId * 44 + 44 > presets.length) throw new Error(`Camera preset ${presetId} is missing.`);
  const baseline = binding ? archive.files[binding.memberId] : new Uint8Array();
  if (!baseline) throw new Error("Camera region member is missing.");
  const boundaryId = Number(row.unknown_3), boundsArchive = new NARC(getRomFileBytes(project, rom, rom.fileId("a/1/0/9")));
  const bounds = boundaryId === 65535 ? undefined : boundsArchive.files[boundaryId];
  if (boundaryId !== 65535 && !bounds) throw new Error(`Camera boundaries ${boundaryId} are missing.`);
  const boundaries: CameraBoundary[] = [];
  if (bounds) {
    const v = view(bounds), count = v.getUint32(0, true);
    if (count > 1024 || bounds.length !== 4 + count * 24) throw new Error("Camera boundary data has an unsupported layout.");
    for (let i = 0; i < count; i++) {
      const at = 4 + i * 24;
      boundaries.push({ type: v.getUint32(at, true), target: v.getUint32(at + 4, true), west: v.getInt32(at + 8, true), east: v.getInt32(at + 12, true), north: v.getInt32(at + 16, true), south: v.getInt32(at + 20, true) });
    }
  }
  return { rom, zoneId, presetId, preset: decodeCameraPreset(presets.subarray(presetId * 44, (presetId + 1) * 44)), layout, memberId: binding?.memberId, bindingOffset: binding?.offset,
    sharedZones: binding ? bindings.filter(b => b.memberId === binding.memberId).map(b => b.zoneId) : [], regions: decodeCameraRegions(baseline), baseline: baseline.slice(), boundaries };
}

/** Stage archive and executable changes together; original members retain their indices and bytes. */
export function saveFieldCamera(project: ProjectState, doc: FieldCameraDocument, regions: CameraRegion[]): void {
  const base = doc.rom.arm9RamAddress, layout = readFieldCameraLayout(project.arm9!, base);
  const fileId = doc.rom.fileId(REGION_PATH), archive = new NARC(getRomFileBytes(project, doc.rom, fileId));
  const bindings = readFieldCameraBindings(project.arm9!, base, archive.files), current = bindings.find(b => b.zoneId === doc.zoneId);
  if (layout.kind !== doc.layout.kind || current?.memberId !== doc.memberId || current?.offset !== doc.bindingOffset) throw new Error("Camera binding changed. Reload this map before saving.");
  const currentBytes = current ? archive.files[current.memberId] : new Uint8Array();
  if (!currentBytes || !cameraBytesEqual(currentBytes, doc.baseline)) throw new Error("Camera data changed in another editor. Reload this map before saving.");
  const encoded = encodeCameraRegions(regions);
  if (cameraBytesEqual(encoded, doc.baseline)) return;
  const shared = current && bindings.filter(b => b.memberId === current.memberId).length > 1;
  let nextArm: Uint8Array | undefined, nextLayout = layout, bindingOffset = current?.offset;
  let memberId = current?.memberId;
  if (layout.kind === "native" && (!current || shared && archive.files.length >= 32)) {
    validateCameraArchiveReaders(project.arm9!, base);
    const prefix = archive.files.slice(), firstZoneMember = prefix.length;
    const zoneCount = Math.max(doc.zoneId + 1, ...bindings.map(b => b.zoneId + 1), ...Object.values(project.headers!.rows).map(row => row.index + 1));
    if (!Number.isInteger(zoneCount) || firstZoneMember + zoneCount > 65535) throw new Error("The expanded camera archive exceeds the native 65535-member limit.");
    archive.files = [...prefix, ...Array.from({ length: zoneCount }, () => new Uint8Array())];
    for (const binding of bindings) {
      const source = prefix[binding.memberId];
      if (!source) throw new Error(`Camera member ${binding.memberId} is missing.`);
      decodeCameraRegions(source);
      archive.files[firstZoneMember + binding.zoneId] = source.slice();
    }
    nextArm = project.arm9!.slice(); nextArm.set(indexedCameraLookup(firstZoneMember), FIELD_CAMERA_LOOKUP_ADDRESS - base);
    nextLayout = { kind: "indexed", firstZoneMember }; memberId = firstZoneMember + doc.zoneId; bindingOffset = undefined;
  } else if (layout.kind === "indexed") {
    memberId = layout.firstZoneMember + doc.zoneId;
    if (memberId >= 65535) throw new Error("This zone exceeds the native camera archive index range.");
    while (archive.files.length <= memberId) archive.files.push(new Uint8Array());
  } else if (shared) {
    memberId = archive.files.length; archive.files.push(new Uint8Array());
    nextArm = project.arm9!.slice(); view(nextArm).setUint16(bindingOffset!, (memberId << 11) | doc.zoneId, true);
  }
  if (memberId === undefined) throw new Error("Camera member could not be assigned.");
  archive.files[memberId] = encoded;
  const saved = archive.save();
  replaceRomFile(project, doc.rom, fileId, saved);
  if (nextArm) { project.arm9 = nextArm; project.arm9Dirty = true; }
  doc.layout = nextLayout;
  doc.memberId = nextLayout.kind === "indexed" && !encoded.length ? undefined : memberId;
  doc.bindingOffset = bindingOffset; doc.sharedZones = encoded.length ? [doc.zoneId] : [];
  doc.baseline = encoded.slice(); doc.regions = decodeCameraRegions(encoded);
}
