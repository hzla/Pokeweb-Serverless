import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { buildAspertiaCutsceneClone } from "../pokeweb/nativeCutsceneClone";
import { readNativeSceneDefinition } from "../pokeweb/nativeCutsceneModel";
import { CUTSCENE_ID_CHECK, CUTSCENE_OVERLAY_BASE, CUTSCENE_TABLE_READERS, readNativeCutsceneLayout } from "../pokeweb/nativeCutsceneRegistry";
import { appendCutsceneTestScript, appendCutsceneTestTrigger, installCutsceneTestFixture } from "../pokeweb/nativeCutsceneTest";
import { compileBw2Script, decompileBw2Script } from "../pokeweb/bw2ScriptCompiler";
import { gen5ScriptEntries } from "../pokeweb/gen5ScriptCommands";

import { nativeCutsceneFixture as fixture } from "./fixtures/nativeCutscene";

describe("independent native sequence 27", () => {
  it("copies descriptors, both event programs and assets while preserving the original sequence", () => {
    const f = fixture(), before = f.overlay.slice(), result = buildAspertiaCutsceneClone(f.overlay, f.files);
    const layout = readNativeCutsceneLayout(result.overlay), original = readNativeSceneDefinition(result.overlay, CUTSCENE_OVERLAY_BASE, 5), custom = readNativeSceneDefinition(result.overlay, CUTSCENE_OVERLAY_BASE, 27);
    expect(layout.count).toBe(28); expect(result.overlay[CUTSCENE_ID_CHECK + 4]).toBe(28);
    for (const { address, field } of CUTSCENE_TABLE_READERS) expect(readU32(result.overlay, address - CUTSCENE_OVERLAY_BASE)).toBe(CUTSCENE_OVERLAY_BASE + layout.tableOffset + field);
    expect(result.overlay.subarray(layout.tableOffset, layout.tableOffset + 27 * 20)).toEqual(before.subarray(f.table, f.table + 27 * 20));
    expect(custom.cameraId).toBe(2); expect(original.cameraId).toBe(0); expect(custom.resources[0].bundles[0][0]).toEqual([3]);
    expect(custom.flags & 1).toBe(1); expect(custom.fps).toBe(30);
    expect(custom.cues).toEqual(original.cues); expect(custom.endCues).toEqual(original.endCues);
    expect(custom.commandsOffset).not.toBe(original.commandsOffset); expect(custom.paramsOffset).not.toBe(original.paramsOffset);
    result.files[custom.cameraId][8] = 99; result.files[3][4] = 99; result.overlay[custom.commandsOffset + 8] = 99;
    expect(f.files[0][8]).toBe(0); expect(f.files[1][4]).not.toBe(99); expect(result.overlay[original.commandsOffset + 8]).toBe(before[original.commandsOffset + 8]);
    expect(f.overlay).toEqual(before);
  });
  it("rejects altered executable readers, partial registration and duplicate creation", () => {
    const f = fixture(); f.overlay[0xe7e] ^= 1;
    expect(() => buildAspertiaCutsceneClone(f.overlay, f.files)).toThrow(/modified sequence lookup/);
    const good = fixture(), result = buildAspertiaCutsceneClone(good.overlay, good.files);
    expect(() => buildAspertiaCutsceneClone(result.overlay, result.files)).toThrow(/already exists/);
    result.overlay[CUTSCENE_TABLE_READERS[2].address - CUTSCENE_OVERLAY_BASE] ^= 4;
    expect(() => readNativeCutsceneLayout(result.overlay)).toThrow(/registry/);
    expect(() => readNativeSceneDefinition(good.overlay, CUTSCENE_OVERLAY_BASE, 27)).toThrow(/1 to 26/);
  });
});

describe("isolated cutscene test trigger", () => {
  it('reuses an exported fixture for a new sequence and removes duplicate owned step triggers',()=>{
    const original=compileBw2Script('preserve_layout\nscript :original, entry: 1 do\n halt\nend\n').bytes,events=new Uint8Array(12),position={gridX:53,gridY:1,gridZ:730};writeU32(events,0,4);events.set([8,9,10,11],8);
    const first=installCutsceneTestFixture(original,events,28,position),updated=installCutsceneTestFixture(first.scripts,first.events,29,position);
    expect(updated.scripts.length).toBe(first.scripts.length);expect(updated.events).toEqual(first.events);expect(updated.entryId).toBe(first.entryId);
    const entries=gen5ScriptEntries(updated.scripts),routine=updated.scripts.subarray(entries[updated.entryId-1]),call=routine.findIndex((n,i)=>n===0x54&&routine[i+1]===1);expect(readU16(routine,call+2)).toBe(29);
    expect(installCutsceneTestFixture(updated.scripts,updated.events,29,position)).toEqual(updated);
    const extra=appendCutsceneTestScript(updated.scripts,30),duplicate=appendCutsceneTestTrigger(updated.events,extra.entryId,position),deduped=installCutsceneTestFixture(extra.bytes,duplicate,31,position);
    expect(deduped.events[7]).toBe(1);expect(deduped.events.subarray(-4)).toEqual(events.subarray(-4));expect(gen5ScriptEntries(deduped.scripts)).toEqual(gen5ScriptEntries(extra.bytes));
    const different=updated.events.slice();writeU16(different,8+10,54);const kept=installCutsceneTestFixture(updated.scripts,different,31,position);expect(kept.events[7]).toBe(2);
    expect(original).toEqual(compileBw2Script('preserve_layout\nscript :original, entry: 1 do\n halt\nend\n').bytes);
  });
  it("appends an entry without changing old entry IDs or relative code/movement bytes", () => {
    const source = compileBw2Script("script :original, entry: 1 do\n  apply_movement 3, :walk\n  wait_movement\nend\nmovement :walk do\n  walk_down 1\nend\n").bytes;
    const entries = gen5ScriptEntries(source), result = appendCutsceneTestScript(source), after = gen5ScriptEntries(result.bytes);
    expect(result.entryId).toBe(2); expect(after[0]).toBe(entries[0] + 4);
    expect(result.bytes.subarray(entries.length * 4 + 4, source.length + 4)).toEqual(source.subarray(entries.length * 4));
    const decoded = decompileBw2Script(result.bytes); expect(decoded.editable).toBe(true); expect(compileBw2Script(decoded.source).bytes).toEqual(result.bytes);
    const routine = result.bytes.subarray(after[1]), call = routine.findIndex((n, i) => n === 0x54 && routine[i + 1] === 1);
    expect(readU16(routine, call + 2)).toBe(27); expect(readU16(routine, call + 4)).toBe(0);
  });
  it("inserts a repeatable step trigger and preserves the opaque event footer", () => {
    const source = new Uint8Array(12); writeU32(source, 0, 4); source.set([8, 9, 10, 11], 8);
    const result = appendCutsceneTestTrigger(source, 34, { gridX: 53, gridY: 1, gridZ: 730 });
    expect(result[7]).toBe(1); expect(readU32(result, 0)).toBe(26); expect(result.subarray(30)).toEqual(source.subarray(8));
    expect(Array.from({ length: 11 }, (_, i) => readU16(result, 8 + i * 2))).toEqual([34, 0, 0, 0, 0, 53, 731, 1, 1, 16, 0]);
    expect(source[7]).toBe(0); expect(() => appendCutsceneTestTrigger(source, 1, { gridX: -1, gridY: 1, gridZ: 730 })).toThrow(/coordinate/);
  });
});
