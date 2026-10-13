import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { bw2ScriptOverlayContextForZones, findBw2ScriptOverlayDispatch, resolveBw2ScriptOverlay } from "../pokeweb/bw2ScriptOverlayContext";
import type { ProjectState } from "../pokeweb/projectStore";

function fixture(fieldBase = 0x02000000, commandBase = 0x02100000) {
  const field = { ramAddress: fieldBase, data: new Uint8Array(0x1000) };
  const overlays = new Map<number, { ramAddress: number; data: Uint8Array }>();
  const ids = [50, 51, 52, 53, 54, 55, 55, 58, 61, 62, 63, 64, 65, 66, 67, 68];
  writeU32(field.data, 0x38, 0xffffffff);
  ids.forEach((id, index) => {
    const segment = { ramAddress: commandBase + id * 0x1000, data: new Uint8Array(0x200) };
    overlays.set(id, segment);
    const p = 0x40 + index * 20;
    writeU32(field.data, p, segment.ramAddress + 0x20);
    writeU32(field.data, p + 4, fieldBase + 0x500 + index * 2);
    writeU32(field.data, p + 8, 1);
    writeU32(field.data, p + 12, id);
    writeU32(field.data, p + 16, index === 5 ? 56 : index === 6 ? 57 : index === 7 ? 59 : 0xffffffff);
    writeU16(field.data, 0x500 + index * 2, index === 13 ? 427 : index + 100);
  });
  return { field, overlays };
}
describe("BW2 ROM-derived command overlay context", () => {
  it.each([[0x02000000, 0x02100000], [0x02004000, 0x02110000]])("finds the complete dispatcher independently of regional addresses", (fieldBase, commandBase) => {
    const { field, overlays } = fixture(fieldBase, commandBase);
    const dispatch = findBw2ScriptOverlayDispatch(field, overlays)!;
    expect(dispatch.size).toBe(16);
    expect(bw2ScriptOverlayContextForZones(dispatch, [427])).toMatchObject({ kind: "detected", overlayId: 66 });
    expect(bw2ScriptOverlayContextForZones(dispatch, [105, 106])).toMatchObject({ kind: "detected", overlayId: 55 });
    expect(bw2ScriptOverlayContextForZones(dispatch, [1]).kind).toBe("base");
    expect(bw2ScriptOverlayContextForZones(dispatch, [1]).overlayId).toBeUndefined();
  });
  it("requires consistent map contexts instead of choosing the first plausible overlay", () => {
    const { field, overlays } = fixture(), dispatch = findBw2ScriptOverlayDispatch(field, overlays)!;
    expect(bw2ScriptOverlayContextForZones(dispatch, [427, 100]).kind).toBe("ambiguous");
    expect(bw2ScriptOverlayContextForZones(dispatch, [427, 1]).kind).toBe("ambiguous");
    expect(bw2ScriptOverlayContextForZones(dispatch, [])).toMatchObject({ kind: "unavailable", unassigned: true });
  });
  it("resolves persisted context after the full ROM is released and rechecks map/native changes", () => {
    const { field, overlays } = fixture();
    const project = {
      session: { baseRom: "BW2" }, overlays: {}, narcs: {},
      headers: { rows: { 428: { index: 427, script_id: 854 } } },
      bw2ScriptRuntimeContext: { fieldRamAddress: field.ramAddress, fieldBytes: field.data,
        overlays: Object.fromEntries([...overlays].map(([id, segment]) => [id, { ramAddress: segment.ramAddress, byteLength: segment.data.length }])) },
    } as unknown as ProjectState;
    const saved = structuredClone(project);
    expect(saved.originalRomBytes).toBeUndefined();
    expect(resolveBw2ScriptOverlay(saved, 854)).toMatchObject({ kind: "detected", overlayId: 66 });
    saved.headers!.rows[428].index = 100;
    expect(resolveBw2ScriptOverlay(saved, 854)).toMatchObject({ kind: "detected", overlayId: 50 });
    saved.overlays[12] = field.data.slice();
    writeU32(saved.overlays[12]!, 0x48, 101);
    expect(resolveBw2ScriptOverlay(saved, 854).kind).toBe("unavailable");
    expect(resolveBw2ScriptOverlay(saved, 854).unassigned).toBeUndefined();
  });
  it.each(["zone pointer", "command pointer", "count", "overlay order", "duplicate zone", "sub-overlay", "missing overlay"])("rejects an unverified dispatcher: %s", (fault) => {
    const { field, overlays } = fixture();
    if (fault === "zone pointer") writeU32(field.data, 0x44, 0);
    if (fault === "command pointer") writeU32(field.data, 0x40, 0);
    if (fault === "count") writeU32(field.data, 0x48, 101);
    if (fault === "overlay order") writeU32(field.data, 0x4c, 51);
    if (fault === "duplicate zone") writeU16(field.data, 0x502, 100);
    if (fault === "sub-overlay") writeU32(field.data, 0x50, 1);
    if (fault === "missing overlay") overlays.delete(66);
    expect(findBw2ScriptOverlayDispatch(field, overlays)).toBeUndefined();
  });
});
