import { describe, expect, it } from "vitest";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { createCameraRectangle, decodeCameraPreset, decodeCameraRegions, encodeCameraRegions, evaluateFieldCamera,
  loadFieldCamera, readFieldCameraBindings, saveFieldCamera, type CameraPreset, type CameraRectangle } from "../pokeweb/fieldCameraModel";
import { cameraViewport } from "../ui/map3dCameraEditor";
import { indexedCameraLookup, FIELD_CAMERA_LOOKUP_ADDRESS } from "../pokeweb/fieldCameraLookup";
import { makeEditProject } from "./fixtures/editProject";

const preset: CameraPreset = { pitch: 30, yaw: 0, roll: 0, distance: 200, fov: 50, near: 1, far: 1024, followsPlayer: true, offset: { x: 0, y: 4, z: 0 } };
const rect = () => createCameraRectangle(preset, 10, 20);
function nativeArm9() {
  const arm = new Uint8Array(0x46b00), at = 0x2018e3e - 0x2004000, v = new DataView(arm.buffer);
  arm.set([8, 75, 0, 36, 97, 0, 89, 90, 74, 5, 82, 13, 144, 66, 2, 209, 8, 4, 192, 14, 16, 189, 100, 28, 2, 44, 243, 211], at);
  arm.set(indexedCameraLookup(1).subarray(0, 6), at - 6); v.setUint32(at + 38, 65535, true);
  arm.set([0x18, 0xb5, 0x95, 0xb0, 0x01, 0x1c, 0x00, 0x20, 0x03, 0xac], 0x0204a9e4 - 0x02004000);
  arm.set([0x38, 0xb5, 0x92, 0xb0, 0x02, 0x1c, 0x00, 0xad, 0x0c, 0x1c], 0x0204aa30 - 0x02004000);
  v.setUint32(at + 34, 0x2018000, true); v.setUint16(0x14000, 561, true); v.setUint16(0x14002, 564, true);
  return arm;
}
async function fixture() {
  const header = new Uint8Array(0x4000); new DataView(header.buffer).setUint32(0x28, 0x2004000, true);
  const rom = new NintendoDSRom(header); rom.idCode = "IRDO"; rom.arm9RamAddress = 0x2004000; rom.arm9 = nativeArm9();
  const regions = new NARC(); regions.files = [encodeCameraRegions([rect()])];
  const defaults = new NARC(), bytes = new Uint8Array(88), v = new DataView(bytes.buffer);
  for (const at of [0, 44]) {
    v.setInt32(at, 200, true); v.setInt32(at + 4, 8192, true); v.setInt16(at + 18, 3640, true);
    v.setInt32(at + 20, 4096, true); v.setInt32(at + 24, 4194304, true); v.setInt32(at + 28, 1, true);
  }
  defaults.files = [bytes];
  const bounds = new NARC(); bounds.files = [Uint8Array.of(0, 0, 0, 0)];
  const original = rom.save({ addedFiles: [{ path: "a/1/5/6", bytes: regions.save() }, { path: "a/0/5/9", bytes: defaults.save() }, { path: "a/1/0/9", bytes: bounds.save() }] });
  const project = makeEditProject(); project.session.baseVersion = "W2"; project.romInfo.idCode = "IRDO";
  project.narcs = {}; project.originalRomBytes = original; project.arm9 = nativeArm9();
  project.headers = { count: 3, rows: { 101: { index: 100, location_name: "New zone", camera_id: 0, unknown_3: 0 }, 562: { index: 561, location_name: "Test", camera_id: 3, unknown_3: 0 }, 565: { index: 564, location_name: "Other", camera_id: 0, unknown_3: 0 } } };
  return { project, doc: await loadFieldCamera(project, 561) };
}

describe("native field camera records", () => {
  it("round trips both orientations, fixed point values, reserved bytes and unsupported shapes", () => {
    const a = rect(), b = rect(); b.axis = "x"; b.width = 1; b.height = 8; b.end.yaw = 350.25; b.end.offset = { x: -6.125, y: 14.5, z: 0.25 };
    a.raw[10] = 0xab; a.raw[60] = 0xcd;
    const unknown = new Uint8Array(72).fill(0x78); new DataView(unknown.buffer).setUint16(64, 0, true);
    const bytes = encodeCameraRegions([a, b, { kind: "unsupported", raw: unknown, type: 0 }]);
    expect(encodeCameraRegions(decodeCameraRegions(bytes))).toEqual(bytes);
    expect((decodeCameraRegions(bytes)[1] as CameraRectangle).end.offset).toEqual(b.end.offset);
    expect(bytes[10]).toBe(0xab); expect(bytes[60]).toBe(0xcd);
  });
  it("rejects malformed data, ambiguous vertical widths, overflow and invalid projections", () => {
    expect(() => decodeCameraRegions(new Uint8Array(73))).toThrow(/72/);
    for (const bad of [{ width: 1 }, { height: 0 }, { x: -1 }, { z: 1.5 }, { x: 65535, width: 4 }]) expect(() => encodeCameraRegions([{ ...rect(), ...bad }])).toThrow();
    const r = rect(); r.start.distance = NaN; expect(() => encodeCameraRegions([r])).toThrow(/Distance/);
    r.start.distance = 200; r.end.fov = 0; expect(() => encodeCameraRegions([r])).toThrow(/view/);
  });
  it("preserves zero FOV/offsets used by native angle-only functions", () => {
    const r = rect(); r.stay = 2; r.start.fov = r.end.fov = 0;
    const decoded = decodeCameraRegions(encodeCameraRegions([r]));
    expect(evaluateFieldCamera(preset, decoded, { x: 176, y: 0, z: 336 }).fov).toBe(50);
  });
  it("reads the integer distance, angular containers and clipping planes independently", () => {
    const b = new Uint8Array(44), v = new DataView(b.buffer); v.setInt32(0, 237, true); v.setInt32(4, 16384, true); v.setInt16(18, 3640, true); v.setInt32(20, 4096, true); v.setInt32(24, 4194304, true); v.setUint32(28, 1, true);
    expect(decodeCameraPreset(b)).toMatchObject({ distance: 237, pitch: 90, fov: 3640 * 720 / 65536, near: 1, far: 1024, followsPlayer: true });
  });
});

describe("stationary field camera", () => {
  it("clamps the tracked anchor before deriving the camera position and applies position bounds separately", () => {
    const player = { x: 200, y: 30, z: 400 };
    const b = { type: 1, target: 0, west: 10, east: 100, north: 20, south: 300 };
    const clamped = evaluateFieldCamera(preset, [], player, [b]);
    expect(clamped.target).toEqual({ x: 100, y: 34, z: 300 });
    expect(clamped.position.x).toBe(100);
    expect(clamped.position.z).toBeCloseTo(300 + Math.cos(Math.PI / 6) * 200);
    const boundedPosition = evaluateFieldCamera(preset, [], player, [{ ...b, target: 1 }]);
    expect(boundedPosition.position.z).toBe(300); expect(boundedPosition.target.z).toBe(400);
    expect(() => evaluateFieldCamera(preset, [], player, [{ ...b, type: 2 }])).toThrow(/boundaries/);
  });

  it("uses first-match priority and exclusive east/south edges in global tile coordinates", () => {
    const a = rect(), b = rect(); a.end.pitch = 70; b.start.pitch = b.end.pitch = 80;
    const middle = evaluateFieldCamera(preset, [a, b], { x: 12 * 16, y: 20, z: 22 * 16 });
    expect(middle.regionIndex).toBe(0); expect(middle.weight).toBe(0.5);
    expect(middle.position.y).toBeCloseTo(20 + Math.sin(50 * Math.PI / 180) * 200);
    expect(evaluateFieldCamera(preset, [a], { x: 14 * 16, y: 0, z: 22 * 16 }).regionIndex).toBeUndefined();
    expect(evaluateFieldCamera(preset, [a], { x: 12 * 16, y: 0, z: 24 * 16 }).regionIndex).toBeUndefined();
  });
  it("interpolates horizontal offsets/FOV and yaw numerically across the encoded angle interval", () => {
    const r = rect(); r.axis = "x"; r.start.yaw = 350; r.end.yaw = 10; r.end.fov = 70; r.end.offset.y = 12;
    const pose = evaluateFieldCamera(preset, [r], { x: 12 * 16, y: 20, z: 22 * 16 });
    expect(pose.fov).toBe(60); expect(pose.target.y).toBe(28); expect(pose.position.z).toBeCloseTo(22 * 16 - Math.cos(Math.PI / 6) * 200);
  });
  it("supports fixed targets, rejects unknown stationary functions and keeps 4:3 within wide or tall views", () => {
    const fixed = evaluateFieldCamera({ ...preset, followsPlayer: false }, [], { x: 999, y: 999, z: 999 });
    expect(fixed.target).toEqual(preset.offset);
    const r = rect(); r.stay = 99; expect(() => evaluateFieldCamera(preset, [r], { x: 176, y: 0, z: 336 })).toThrow(/99/);
    expect(cameraViewport(1200, 600)).toEqual({ x: 200, y: 0, width: 800, height: 600 });
    expect(cameraViewport(400, 600)).toEqual({ x: 0, y: 150, width: 400, height: 300 });
  });
});

describe("project camera persistence", () => {
  it("verifies the native lookup code and rejects unknown executables", () => {
    const arm = nativeArm9(); expect(readFieldCameraBindings(arm, 0x2004000).map(b => b.zoneId)).toEqual([561, 564]);
    arm[0x14e3e] = 0; expect(() => readFieldCameraBindings(arm, 0x2004000)).toThrow(/not supported/);
  });
  it("decodes the packed header preset and isolates a shared member without altering its sibling", async () => {
    const { project, doc } = await fixture(); expect(doc.presetId).toBe(1); expect(doc.sharedZones).toEqual([561, 564]);
    const original = doc.baseline.slice(), next = structuredClone(doc.regions); (next[0] as CameraRectangle).width = 7;
    const oldArm = project.arm9!.slice(); saveFieldCamera(project, doc, next);
    expect(doc.memberId).toBe(1); expect(project.arm9Dirty).toBe(true);
    const diffs = project.arm9!.reduce<number[]>((out, n, i) => { if (n !== oldArm[i]) out.push(i); return out; }, []);
    expect(diffs).toEqual([0x14001]);
    expect((await loadFieldCamera(project, 564)).baseline).toEqual(original);
    expect(((await loadFieldCamera(project, 561)).regions[0] as CameraRectangle).width).toBe(7);
    // Already-isolated edits must not append another member.
    (next[0] as CameraRectangle).width = 8; saveFieldCamera(project, doc, next); expect(doc.memberId).toBe(1);
  });
  it("refuses stale saves and leaves project bytes unchanged after validation failures", async () => {
    const { project, doc } = await fixture(), stale = await loadFieldCamera(project, 561);
    const next = structuredClone(doc.regions); (next[0] as CameraRectangle).width = 1;
    expect(() => saveFieldCamera(project, doc, next)).toThrow(); expect(project.fileSystem).toBeUndefined();
    (next[0] as CameraRectangle).width = 8; saveFieldCamera(project, doc, next);
    expect(() => saveFieldCamera(project, stale, stale.regions)).toThrow(/binding changed/);
    const now = await loadFieldCamera(project, 561), another = await loadFieldCamera(project, 561);
    const moved = structuredClone(now.regions); (moved[0] as CameraRectangle).x++;
    saveFieldCamera(project, now, moved); expect(() => saveFieldCamera(project, another, another.regions)).toThrow(/another editor/);
  });
});

describe("camera regions on previously unbound zones", () => {
  it("installs an indexed lookup, retains original members and native zone regions, then creates an independent set", async () => {
    const { project, doc } = await fixture(), existing = doc.baseline.slice(), beforeArm = project.arm9!.slice();
    const unbound = await loadFieldCamera(project, 100); expect(unbound.memberId).toBeUndefined();
    saveFieldCamera(project, unbound, [createCameraRectangle(unbound.preset, 5, 6)]);
    expect(unbound.layout).toEqual({ kind: "indexed", firstZoneMember: 1 }); expect(unbound.memberId).toBe(101);
    const rom = unbound.rom, arc = new NARC(project.fileSystem!.replacements[rom.fileId("a/1/5/6")]);
    expect(arc.files[0]).toEqual(existing); expect(arc.files[562]).toEqual(existing); expect(arc.files[565]).toEqual(existing);
    expect((await loadFieldCamera(project, 100)).regions).toHaveLength(1);
    expect((await loadFieldCamera(project, 561)).memberId).not.toBe((await loadFieldCamera(project, 564)).memberId);
    expect(arc.files[200]).toHaveLength(0);
    const at = FIELD_CAMERA_LOOKUP_ADDRESS - rom.arm9RamAddress;
    expect(project.arm9!.subarray(0, at)).toEqual(beforeArm.subarray(0, at));
    expect(project.arm9!.subarray(at + 48)).toEqual(beforeArm.subarray(at + 48));
    expect(() => saveFieldCamera(project, doc, doc.regions)).toThrow(/binding changed/);
  });
  it("supports more than 32 authored maps and extends for newly added headers", async () => {
    const { project } = await fixture();
    for (let zone = 100; zone < 140; zone++) {
      project.headers!.rows[zone + 1] = { index: zone, location_name: "New zone", camera_id: 0, unknown_3: 0 };
      const doc = await loadFieldCamera(project, zone); saveFieldCamera(project, doc, [createCameraRectangle(doc.preset, zone, 10)]);
    }
    expect((await loadFieldCamera(project, 139)).memberId).toBe(140);
    project.headers!.rows[1001] = { index: 1000, location_name: "New header", camera_id: 0, unknown_3: 0 };
    const added = await loadFieldCamera(project, 1000); saveFieldCamera(project, added, [createCameraRectangle(added.preset, 0, 0)]);
    expect((await loadFieldCamera(project, 1000)).memberId).toBe(1001);
    saveFieldCamera(project, added, []);
    expect((await loadFieldCamera(project, 1000)).memberId).toBeUndefined();
    expect((await loadFieldCamera(project, 139)).regions).toHaveLength(1);
  });
  it("does not patch an empty unbound edit or mutate the project if native readers are unsupported", async () => {
    const { project } = await fixture(), doc = await loadFieldCamera(project, 100), original = project.arm9!.slice();
    saveFieldCamera(project, doc, []); expect(project.fileSystem).toBeUndefined(); expect(project.arm9Dirty).toBeUndefined();
    project.arm9![0x0204aa30 - 0x02004000] = 0;
    expect(() => saveFieldCamera(project, doc, [rect()])).toThrow(/archive readers/);
    expect(project.fileSystem).toBeUndefined(); project.arm9![0x0204aa30 - 0x02004000] = original[0x0204aa30 - 0x02004000];
    expect(project.arm9).toEqual(original);
  });
  it("expands a full native archive rather than exceeding its packed five-bit member indices", async () => {
    const { project, doc } = await fixture();
    const arc = new NARC(); arc.files = Array.from({ length: 32 }, () => doc.baseline.slice());
    project.fileSystem = { replacements: { [doc.rom.fileId("a/1/5/6")]: arc.save() } };
    const next = structuredClone(doc.regions); (next[0] as CameraRectangle).width++;
    saveFieldCamera(project, doc, next);
    expect(doc.layout).toEqual({ kind: "indexed", firstZoneMember: 32 }); expect(doc.memberId).toBe(593);
    expect((await loadFieldCamera(project, 564)).baseline).toEqual(arc.files[0]);
    const saved = new NARC(project.fileSystem.replacements[doc.rom.fileId("a/1/5/6")]);
    expect(saved.files.slice(0, 32)).toEqual(arc.files);
  });
});
