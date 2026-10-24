import { describe, expect, it } from "vitest";
import { cameraTrackEqual, interpolateNativeCamera, nativeCameraPose, readNativeCameraTrack, writeNativeCameraPose } from "../pokeweb/nativeCameraTrack";
import { encodeNativeSceneCues, nativeCutsceneName, nativeSceneFade, nativeSceneProjection, readNativeSceneDefinition, saveNativeCutsceneCamera, type NativeCutsceneDocument, type NativeSceneDefinition } from "../pokeweb/nativeCutsceneModel";
import { NARC } from "../nds/narc";
import type { ProjectState } from "../pokeweb/projectStore";
import { nitroBillboard } from "../pokeweb/nitroAnimatedModel";
import { nitroIdentity, nitroScale, nitroTranslation, nitroMul } from "../pokeweb/nitroAnimation";

function track(scale = false) {
  const bytes = new Uint8Array(8 + 5 * (scale ? 36 : 24)), v = new DataView(bytes.buffer);
  v.setUint32(0, 5, true); bytes.set([Number(scale), 1, 1, 0x7c], 4);
  for (let at = 8; at < bytes.length; at += 4) v.setFloat32(at, at / 32, true);
  return readNativeCameraTrack(bytes);
}

describe("native cutscene names", () => {
  it("labels exported custom sequences beyond the built-in catalog without losing original names", () => {
    expect(nativeCutsceneName(5)).toBe("Aspertia flyover");
    expect(nativeCutsceneName(27)).toBe("Aspertia flyover · custom clone");
    for (let id = 28; id < 64; id++) expect(nativeCutsceneName(id)).toBe(`Custom map sequence ${id}`);
    expect(new Set(Array.from({ length: 63 }, (_, i) => nativeCutsceneName(i + 1))).size).toBe(63);
  });
});

describe("native cutscene camera editing", () => {
  it("reads and writes unchanged samples bit for bit, including scale and reserved header data", () => {
    for (const withScale of [false, true]) {
      const camera = track(withScale), before = camera.bytes.slice();
      for (let f = 0; f < camera.frameCount; f++) writeNativeCameraPose(camera, f, nativeCameraPose(camera, f));
      expect(camera.bytes).toEqual(before);
      writeNativeCameraPose(camera, 2, { position: [14, 20, -30], rotation: [10, 20, 30] });
      const at = 8 + camera.stride * 2 + (withScale ? 12 : 0);
      expect(camera.bytes.subarray(0, at)).toEqual(before.subarray(0, at));
      expect(camera.bytes.subarray(at + 24)).toEqual(before.subarray(at + 24));
      expect(nativeCameraPose(camera, 2).position).toEqual([14, 20, -30]);
    }
  });

  it("rejects bad sizes, invalid presence flags, nonfinite values, frames and partial writes", () => {
    const camera = track(), before = camera.bytes.slice();
    expect(() => readNativeCameraTrack(camera.bytes.subarray(0, -1))).toThrow(/length/);
    const bad = before.slice(); bad[4] = 2; expect(() => readNativeCameraTrack(bad)).toThrow(/channels/);
    new DataView(bad.buffer).setFloat32(8, NaN, true); bad[4] = 0; expect(() => readNativeCameraTrack(bad)).toThrow(/finite/);
    expect(() => nativeCameraPose(camera, 5)).toThrow(/timeline/);
    expect(() => writeNativeCameraPose(camera, 0, { position: [1, Infinity, 3], rotation: [1, 2, 3] })).toThrow();
    expect(() => writeNativeCameraPose(camera, 0, { position: [524287.999, 2, 3], rotation: [1, 2, 3] })).toThrow();
    expect(camera.bytes).toEqual(before);
  });

  it("bakes only the range interior, preserves endpoints, and interpolates angles across zero", () => {
    const camera = track(true);
    writeNativeCameraPose(camera, 1, { position: [0, 0, 0], rotation: [350, 0, 0] });
    writeNativeCameraPose(camera, 3, { position: [10, 20, 30], rotation: [10, 20, 30] });
    const before = camera.bytes.slice(); interpolateNativeCamera(camera, 1, 3, "linear");
    expect(nativeCameraPose(camera, 2)).toEqual({ position: [5, 10, 15], rotation: [360, 10, 15] });
    expect(camera.bytes.subarray(0, 8 + 2 * camera.stride + 12)).toEqual(before.subarray(0, 8 + 2 * camera.stride + 12));
    expect(camera.bytes.subarray(8 + 3 * camera.stride)).toEqual(before.subarray(8 + 3 * camera.stride));
    expect(() => interpolateNativeCamera(camera, 3, 1, "smooth")).toThrow(/after/);
  });

  it("smooth interpolation eases the start and end without changing the native duration", () => {
    const camera = track(); writeNativeCameraPose(camera, 0, { position: [0, 0, 0], rotation: [0, 0, 0] });
    writeNativeCameraPose(camera, 4, { position: [8, 8, 8], rotation: [0, 0, 0] });
    const length = camera.bytes.length; interpolateNativeCamera(camera, 0, 4, "smooth");
    expect(nativeCameraPose(camera, 1).position).toEqual([1.25, 1.25, 1.25]);
    expect(nativeCameraPose(camera, 3).position).toEqual([6.75, 6.75, 6.75]); expect(camera.bytes.length).toBe(length);
  });
});

describe("native scene resource persistence", () => {
  function fixture() {
    const camera = track(), archive = new NARC(); archive.files = [new Uint8Array([4, 5, 6]), camera.bytes.slice(), new Uint8Array([8, 9])];
    const project = { narcs: {}, overlays: {}, fileSystem: { replacements: { 17: archive.save() } }, actionChangelog: [] } as unknown as ProjectState;
    const doc = { rom: { files: [] }, fileId: 17, definition: { cameraId: 1 }, baseline: camera.bytes.slice(), camera } as unknown as NativeCutsceneDocument;
    return { project, doc, archive };
  }
  it("saves only the camera member and preserves unrelated concurrent archive changes", () => {
    const { project, doc, archive } = fixture();
    archive.files[2] = new Uint8Array([11, 12, 13]); project.fileSystem!.replacements[17] = archive.save();
    writeNativeCameraPose(doc.camera, 2, { position: [99, 2, 3], rotation: [4, 5, 6] });
    doc.files = archive.files;
    saveNativeCutsceneCamera(project, doc);
    const saved = new NARC(project.fileSystem!.replacements[17]);
    expect(saved.files[0]).toEqual(archive.files[0]); expect(saved.files[2]).toEqual(archive.files[2]);
    expect(saved.files[1]).toEqual(doc.camera.bytes); expect(cameraTrackEqual(doc.baseline, doc.camera.bytes)).toBe(true);
  });
  it("rejects a stale camera instead of overwriting another edit", () => {
    const { project, doc, archive } = fixture(); archive.files[1][8] ^= 1; project.fileSystem!.replacements[17] = archive.save();
    const before = project.fileSystem!.replacements[17].slice();
    expect(() => saveNativeCutsceneCamera(project, doc)).toThrow(/changed elsewhere/);
    expect(project.fileSystem!.replacements[17]).toEqual(before);
  });
  it("rejects camera header changes even when the resource byte length stays the same", () => {
    const { project, doc } = fixture(); doc.camera.bytes[7] ^= 1;
    expect(() => saveNativeCutsceneCamera(project, doc)).toThrow(/header and duration/);
  });
  function withCues() {
    const state = fixture(), overlay = new Uint8Array(320), commandsOffset = 16, paramsOffset = 200;
    const cues = [{ opcode: 6, frame: -1, args: [1102, 0, 0, 0, 0, 0, 0, 0] }];
    const commands = new Uint8Array(80); new DataView(commands.buffer).setInt32(40, 19, true);
    overlay.set(encodeNativeSceneCues(cues, commands), commandsOffset); overlay.set([2, 30, 0, 20], paramsOffset + 78);
    Object.assign(state.doc.definition, { id: 5, commandsOffset, paramsOffset, cues, startFade: { white: true, duration: 30 }, endFade: { white: false, duration: 20 } });
    state.doc.files = state.archive.files; state.doc.cueBaseline = overlay.slice(16, 96); state.doc.fadeBaseline = overlay.slice(278, 282);
    state.doc.library = { overlayBytes: overlay } as NativeCutsceneDocument["library"];
    return { ...state, overlay };
  }
  it("saves cue and fade edits to the dirty overlay without changing sibling bytes or the archive", () => {
    const { project, doc, overlay } = withCues(), archiveBefore = project.fileSystem!.replacements[17].slice();
    doc.definition.cues[0].args[0] = 1103; doc.definition.startFade.duration = 40;
    saveNativeCutsceneCamera(project, doc);
    expect(project.patches?.dirtyOverlayIds).toContain(293);
    expect(project.fileSystem!.replacements[17]).toEqual(archiveBefore);
    const expected = overlay.slice(); new DataView(expected.buffer).setInt32(24, 1103, true); expected[279] = 40;
    expect(project.overlays[293]).toEqual(expected); expect(overlay[279]).toBe(30);
    expect(doc.fadeBaseline).toEqual(Uint8Array.of(2, 40, 0, 20));
  });
  it("preflights stale cues before writing any camera or asset changes", () => {
    const { project, doc, overlay } = withCues(), archiveBefore = project.fileSystem!.replacements[17].slice();
    project.overlays[293] = overlay.slice(); project.overlays[293]![24] ^= 1;
    writeNativeCameraPose(doc.camera, 2, { position: [99, 2, 3], rotation: [4, 5, 6] });
    expect(() => saveNativeCutsceneCamera(project, doc)).toThrow(/cues changed elsewhere/);
    expect(project.fileSystem!.replacements[17]).toEqual(archiveBefore); expect(project.patches).toBeUndefined();
  });
});

describe("native sequence interpretation", () => {
  it("bounds native pointers and rejects unsupported sequence IDs", () => {
    expect(() => readNativeSceneDefinition(new Uint8Array(40), 0x021a1ba0)).toThrow(/outside/);
    expect(() => readNativeSceneDefinition(new Uint8Array(40), 0x021a1ba0, 27)).toThrow(/1 to 26/);
  });
  it("evaluates fades deterministically even when scrubbing backwards", () => {
    const definition = { startFade: { white: true, duration: 30 }, cues: [{ opcode: 10, frame: 940, args: [3, 60, 0, -16] }] } as NativeSceneDefinition;
    expect(nativeSceneFade(definition, 15)).toEqual({ color: "white", opacity: .5 });
    expect(nativeSceneFade(definition, 970)).toEqual({ color: "black", opacity: .5 });
    expect(nativeSceneFade(definition, 200).opacity).toBe(0);
  });
  it("keeps fades independent for each screen and supports fade-out/in commands", () => {
    const definition = { startFade: { white: false, duration: 0 }, cues: [{ opcode: 11, frame: 20, args: [1, 0, 16, 0, 10, 10] }] } as NativeSceneDefinition;
    expect(nativeSceneFade(definition, 25, 1)).toEqual({ color: "white", opacity: .5 });
    expect(nativeSceneFade(definition, 25, 2).opacity).toBe(0);
    expect(nativeSceneFade(definition, 35, 1).opacity).toBe(.5);
    expect(nativeSceneFade(definition, 40, 1).opacity).toBe(0);
  });
  it("evaluates projection changes when seeking backwards without retaining later cues", () => {
    const definition = { fov: 40, topOffset: .03, bottomOffset: -.03, cues: [{ opcode: 18, frame: 90, args: [57344, 57344, 75, -65] }] } as NativeSceneDefinition;
    expect(nativeSceneProjection(definition, 100).fov).toBe(14);
    expect(nativeSceneProjection(definition, 10).fov).toBe(40);
  });
  it("encodes fixed native command slots and retains the terminator bytes", () => {
    const raw = new Uint8Array(120); raw.fill(0x41, 80); new DataView(raw.buffer).setInt32(80, 19, true);
    const cues = [{ opcode: 6, frame: -1, args: [1102, 0, 0, 0, 0, 0, 0, 0] }, { opcode: 10, frame: 200, args: [3, 20, 0, -16, 0, 0, 0, 0] }];
    const result = encodeNativeSceneCues(cues, raw), view = new DataView(result.buffer);
    expect(view.getInt32(4, true)).toBe(-1); expect(view.getInt32(8, true)).toBe(1102); expect(result.subarray(80)).toEqual(raw.subarray(80));
    expect(() => encodeNativeSceneCues(cues.slice(1), raw)).toThrow(/slot count/);
    expect(() => encodeNativeSceneCues([{ ...cues[0], opcode: 19 }, cues[1]], raw)).toThrow(/native integers/);
    expect(() => encodeNativeSceneCues([{ ...cues[0], opcode: 18, args: [0, 0, 0, 0, 0, 0, 0, 0] }, cues[1]], raw)).toThrow(/field of view/);
  });
  it("billboards face the camera while retaining the animated origin and per-axis scale", () => {
    const position = nitroMul(nitroTranslation([10, 20, 30]), nitroScale([2, 3, 4]));
    const result = nitroBillboard({ position, normal: nitroIdentity() }, nitroIdentity(), false);
    expect(result.position).toEqual(position);
    const yawCamera = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1];
    const rotated = nitroBillboard({ position, normal: nitroIdentity() }, yawCamera, true).position;
    expect([rotated[3], rotated[7], rotated[11]]).toEqual([10, 20, 30]);
    expect(rotated[2]).toBeCloseTo(4); expect(rotated[8]).toBeCloseTo(-2); expect(rotated[5]).toBeCloseTo(3);
  });
});
