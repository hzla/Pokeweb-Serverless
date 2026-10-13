import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { bw2ScriptBytesEqual, compileBw2Script, decompileBw2Script } from "../pokeweb/bw2ScriptCompiler";
import { bw2EntryTableSignature, compileBw2ProjectScript, decompileBw2ProjectScript, replaceBw2ProjectScript } from "../pokeweb/bw2ScriptModel";
import { addBw2ScriptEntry, clearBw2ScriptEntry, removeBw2ScriptEntry, addBw2ScriptMovement, removeBw2ScriptMovement } from "../pokeweb/bw2ScriptStructure";
import { planBw2ScriptEntryReferences } from "../pokeweb/bw2ScriptEntryReferences";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import { splitBw2ScriptSource } from "../pokeweb/bw2ScriptSourceParts";
import type { ProjectState, NarcStore } from "../pokeweb/projectStore";

const SOURCE = "preserve_layout\nmovement_alignment 2\nscript :first, entry: 1 do\n  nop\n  halt\nend\nscript :second, entry: 2 do\n  sleep 3\n  halt\nend\nscript :third, entry: 3 do\n  halt\nend\n";
function store(name: NarcStore["name"], rawFiles: Uint8Array[]): NarcStore { return { name, sourcePath: "test", fileId: 1, fileCount: rawFiles.length, rawFiles, records: new Map(), dirty: new Set() }; }
function project(source = SOURCE, initialization = false): ProjectState {
  const special = initialization ? Uint8Array.from([2, 0, 3, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0, 0, 0xa1, 0x40, 6, 0, 2, 0, 0, 0]) : new Uint8Array(2);
  const events = new Uint8Array(8 + 20 + 2 * 36 + 22 + special.length);
  writeU32(events, 0, events.length - 4); events.set([1, 2, 0, 1], 4);
  writeU16(events, 8, 3); // Sign/furniture.
  writeU16(events, 28, 77); writeU16(events, 38, 2); // Actor ID is independent.
  writeU16(events, 74, 10002); // Global script stays untouched.
  writeU16(events, 100, 3); writeU16(events, 102, 2); // Trigger target vs condition.
  events.set(special, 122);
  const headers = new Uint8Array(48); writeU16(headers, 6, 0); writeU16(headers, 8, 1); writeU16(headers, 22, 0);
  return {
    session: { romName: "test", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "TEST", fileName: "fixture.nds", size: 1 },
    arm9: new Uint8Array(), overlays: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    narcs: { scripts: store("scripts", [compileBw2Script(source).bytes, special]), headers: store("headers", [headers]), overworlds: store("overworlds", [events]) },
  };
}
function imported(p: ProjectState): string { return decompileBw2ProjectScript(p, 0, { overlayId: undefined }).source; }

describe("BW2 extendable entries and movement definitions", () => {
  it("appends an entry without renumbering existing IDs, and recomputes all relative targets", () => {
    const p = project(SOURCE.replace("  nop", "  call :helper" ) + "def helper\n  return\nend\n"), source = imported(p), before = structuredClone(p);
    const edit = addBw2ScriptEntry(source), result = compileBw2ProjectScript(p, 0, edit.source, { entryMapping: edit.mapping });
    expect(edit.entry).toBe(4); expect(result.entryChanges?.references).toEqual([]); expect(p).toEqual(before);
    const old = compileBw2Script(source);
    expect(result.entries.slice(0, 3).map((entry) => entry.offset)).toEqual(old.entries.map((entry) => entry.offset + 4));
    for (const ref of result.relocations) expect(ref.operandOffset + 4 + (readU32(result.bytes, ref.operandOffset) | 0)).toBe(ref.targetOffset);
    replaceBw2ProjectScript(p, 0, edit.source, { entryMapping: edit.mapping });
    expect([...p.narcs.scripts!.dirty]).toEqual([0]); expect(p.narcs.overworlds!.dirty.size).toBe(0);
  });
  it("accepts newly defined unused movements, persists their verified decoding hints, and removes them", () => {
    const p = project(), edit = addBw2ScriptMovement(imported(p), "greeting");
    const applied = replaceBw2ProjectScript(p, 0, edit.source);
    expect(applied.movementBlocks).toHaveLength(1); expect(splitBw2ScriptSource(edit.source).definitions).toContain("movement :greeting");
    const reimport = decompileBw2ProjectScript(structuredClone(p), 0, { overlayId: undefined });
    expect(reimport.editable).toBe(true); expect(reimport.source).toContain("movement :movement_");
    expect(compileBw2Script(reimport.source).bytes).toEqual(applied.bytes);
    const removed = removeBw2ScriptMovement(edit.source, "greeting");
    expect(replaceBw2ProjectScript(p, 0, removed.source).bytes).toEqual(compileBw2Script(SOURCE).bytes);
  });
  it("relocates a new movement and keeps it aligned after odd-length control flow growth", () => {
    const p = project(), added = addBw2ScriptMovement(imported(p), "greeting");
    const source = "work :progress, 0x40a1\n" + added.source.replace("  nop", "  if progress == 0\n    nop\n  end\n  apply_movement 77, :greeting");
    const result = replaceBw2ProjectScript(p, 0, source), motion = result.relocations.find((ref) => ref.kind === "movement")!;
    expect(motion.targetOffset % 2).toBe(0);
    expect(decompileBw2Script(result.bytes).editable).toBe(true);
    expect(() => removeBw2ScriptMovement(source, "greeting")).toThrow(/still used/);
  });
  it("compacts entry IDs and detaches NPCs while remapping signs and triggers atomically", () => {
    const p = project(), edit = removeBw2ScriptEntry(imported(p), 2), before = structuredClone(p);
    const preview = compileBw2ProjectScript(p, 0, edit.source, { entryMapping: edit.mapping });
    expect(preview.entryChanges?.mapping).toEqual([1, 0, 2]); expect(preview.entryChanges?.references).toHaveLength(3); expect(p).toEqual(before);
    replaceBw2ProjectScript(p, 0, edit.source, { entryMapping: edit.mapping });
    const events = p.narcs.overworlds!.rawFiles[0];
    expect(readU16(events, 8)).toBe(2); expect(readU16(events, 38)).toBe(0); expect(readU16(events, 74)).toBe(10002);
    expect(readU16(events, 100)).toBe(2); expect(readU16(events, 102)).toBe(2); expect(readU16(events, 28)).toBe(77);
    const archive = new NARC(); archive.files = p.narcs.scripts!.rawFiles;
    expect(new NARC(archive.save()).files[0]).toEqual(compileBw2Script(edit.source).bytes);
  });
  it("updates static and conditional initialization in both the event footer and special-script member", () => {
    const p = project(SOURCE, true), edit = removeBw2ScriptEntry(imported(p), 1, 3);
    const result = replaceBw2ProjectScript(p, 0, edit.source, { entryMapping: edit.mapping });
    expect(result.entryChanges?.references).toHaveLength(7);
    expect(readU32(p.narcs.scripts!.rawFiles[1], 2)).toBe(2); expect(readU16(p.narcs.scripts!.rawFiles[1], 18)).toBe(1);
    expect(p.narcs.overworlds!.rawFiles[0].subarray(122)).toEqual(p.narcs.scripts!.rawFiles[1]);
    expect([...p.narcs.scripts!.dirty]).toEqual([0, 1]); expect([...p.narcs.overworlds!.dirty]).toEqual([0]);
  });
  it.each(["initialization", "shared events", "shared special", "unknown footer"])("rejects %s before changing any project state", (reason) => {
    const p = project(SOURCE, true), source = imported(p);
    if (reason.startsWith("shared")) {
      const header = new Uint8Array(96); header.set(p.narcs.headers!.rawFiles[0]); header.set(header.subarray(0, 48), 48);
      writeU16(header, 54, 9); if (reason === "shared events") writeU16(header, 56, 0xffff); else writeU16(header, 70, 0xffff);
      p.narcs.headers!.rawFiles[0] = header;
    }
    if (reason === "unknown footer") p.narcs.overworlds!.rawFiles[0][122] = 0xff, p.narcs.overworlds!.rawFiles[0][123] = 0xff;
    const edit = removeBw2ScriptEntry(source, 2, reason === "initialization" ? 0 : 3), before = structuredClone(p);
    expect(() => replaceBw2ProjectScript(p, 0, edit.source, { entryMapping: edit.mapping })).toThrow(reason === "initialization" ? /replacement entry/ : reason.startsWith("shared") ? /shared with another/ : /unrecognized/);
    expect(p).toEqual(before);
  });
  it("keeps internally called code when its public entry is removed", () => {
    const source = SOURCE.replace("  nop", "  call :second"), p = project(source), edit = removeBw2ScriptEntry(imported(p), 2);
    expect(edit.source).toContain("block :script_2 do"); expect(edit.source).toContain("sleep");
    const result = replaceBw2ProjectScript(p, 0, edit.source, { entryMapping: edit.mapping });
    const call = result.relocations.find((ref) => ref.kind === "call")!;
    expect(readU16(result.bytes, call.targetOffset)).toBe(3);
  });
  it("clears a public entry without changing shared aliases, callers or initialization", () => {
    const source = SOURCE.replace("  nop", "  call :second") + "movement :unused do\n  face_up 1\nend\n", p = project(source);
    // Unused definition is supplied by verified source before editing.
    p.bw2ScriptEditor = { drafts: { 0: { source, appliedSource: source } } };
    const edit = clearBw2ScriptEntry(imported(p), 2), special = p.narcs.scripts!.rawFiles[1].slice();
    expect(splitBw2ScriptSource(edit.source).script).not.toContain("movement :");
    const result = replaceBw2ProjectScript(p, 0, edit.source, { entryMapping: edit.mapping });
    expect(result.entries).toHaveLength(3); expect(readU16(result.bytes, result.entries[1].offset)).toBe(2);
    expect(readU16(result.bytes, result.relocations.find((ref) => ref.kind === "call")!.targetOffset)).toBe(3);
    expect(p.narcs.scripts!.rawFiles[1]).toEqual(special); expect(p.narcs.overworlds!.dirty.size).toBe(0);
  });
  it("handles alias-only removal without dropping code still used by another public slot", () => {
    const source = "preserve_layout\nentry 2, :first\nscript :first, entry: 1 do\n  nop\n  halt\nend\n", p = project(source);
    const edit = removeBw2ScriptEntry(imported(p), 1, 2);
    const result = replaceBw2ProjectScript(p, 0, edit.source, { entryMapping: edit.mapping });
    expect(result.entries).toHaveLength(1); expect(readU16(result.bytes, result.entries[0].offset)).toBe(0);
  });
  it("round-trips empty tables and can add their first entry", () => {
    const p = project("preserve_layout\nscript :only, entry: 1 do\n  halt\nend\n");
    // Detach local fixture references to that only entry.
    writeU16(p.narcs.overworlds!.rawFiles[0], 38, 0);
    const removed = removeBw2ScriptEntry(imported(p), 1);
    expect(replaceBw2ProjectScript(p, 0, removed.source, { entryMapping: removed.mapping }).bytes).toEqual(Uint8Array.from([0x13, 0xfd]));
    expect(imported(p)).toContain("preserve_layout");
    const added = addBw2ScriptEntry(imported(p)); expect(added.entry).toBe(1);
    expect(replaceBw2ProjectScript(p, 0, added.source, { entryMapping: added.mapping }).entries).toHaveLength(1);
  });
  it("materializes pending overworld edits before remapping and preserves their other fields", () => {
    const p = project(), edit = removeBw2ScriptEntry(imported(p), 2);
    const store = p.narcs.overworlds!;
    // Decode through the normal model, then change a coordinate and script assignment.
    store.records.set(0, { id: 0, bytes: store.rawFiles[0], raw: { file_length: 120, furniture_count: 1, npc_count: 2, warp_count: 0, trigger_count: 1,
      furniture_0_script_id: 2, npc_0_overworld_id: 77, npc_0_script_id: 3, npc_0_x_cord: 19, npc_1_script_id: 10002, trigger_0_entity_id: 3 } });
    store.dirty.add(0);
    replaceBw2ProjectScript(p, 0, edit.source, { entryMapping: edit.mapping }); materializeProjectEdits(p);
    expect(readU16(store.rawFiles[0], 8)).toBe(0); expect(readU16(store.rawFiles[0], 38)).toBe(2); expect(readU16(store.rawFiles[0], 56)).toBe(19);
  });
  it("refuses affected runtime scheduling and unknown bytes instead of guessing", () => {
    const p = project(SOURCE.replace("  nop", "  rt_reserve_script 3")), edit = removeBw2ScriptEntry(imported(p), 2), before = structuredClone(p);
    expect(() => replaceBw2ProjectScript(p, 0, edit.source, { entryMapping: edit.mapping })).toThrow(/rt_reserve_script/); expect(p).toEqual(before);
    const clean = project(), source = imported(clean), motion = addBw2ScriptMovement(source);
    expect(() => replaceBw2ProjectScript(clean, 0, motion.source.replace("face_up 1", "raw_step 0xffff, 1"))).toThrow(/cannot be safely verified/);
  });
  it("infers unambiguous manual entry changes and refuses unsupported mapless renumbering", () => {
    const p = project(), edit = removeBw2ScriptEntry(imported(p), 2);
    expect(compileBw2ProjectScript(p, 0, edit.source).entryChanges?.mapping).toEqual([1, 0, 2]);
    writeU16(p.narcs.headers!.rawFiles[0], 6, 99);
    expect(() => planBw2ScriptEntryReferences(p, 0, edit.mapping!)).toThrow(/no map assignment/);
  });
  it("copies Node buffer views before staging changes to keep preview and baseline immutable", () => {
    const p = project(SOURCE, true);
    for (const store of Object.values(p.narcs)) if (store) store.rawFiles = store.rawFiles.map((file) => Buffer.from(file));
    const edit = removeBw2ScriptEntry(imported(p), 1, 3), bytes = p.narcs.scripts!.rawFiles.map((file) => Uint8Array.from(file));
    const events = Uint8Array.from(p.narcs.overworlds!.rawFiles[0]);
    const baseline = p.bw2ScriptEditor!.drafts[0].imported!.baselineBytes;
    compileBw2ProjectScript(p, 0, edit.source, { entryMapping: edit.mapping });
    expect(p.narcs.scripts!.rawFiles.map((file) => Uint8Array.from(file))).toEqual(bytes); expect(Uint8Array.from(p.narcs.overworlds!.rawFiles[0])).toEqual(events);
    p.narcs.scripts!.rawFiles[0][6] ^= 1;
    expect(bw2ScriptBytesEqual(baseline, p.narcs.scripts!.rawFiles[0])).toBe(false);
  });
  it("does not apply a stale pending removal mapping after undo restores the original entries", () => {
    const p = project(), source = imported(p), edit = removeBw2ScriptEntry(source, 2), draft = p.bw2ScriptEditor!.drafts[0];
    draft.source = edit.source; draft.entryMapping = edit.mapping; draft.entryMappingSignature = bw2EntryTableSignature(compileBw2Script(edit.source));
    expect(compileBw2ProjectScript(structuredClone(p), 0, edit.source).entryChanges?.mapping).toEqual([1, 0, 2]);
    const events = p.narcs.overworlds!.rawFiles[0].slice();
    expect(replaceBw2ProjectScript(p, 0, source).entryChanges).toBeUndefined();
    expect(p.narcs.overworlds!.rawFiles[0]).toEqual(events); expect(p.narcs.overworlds!.dirty.size).toBe(0);
  });
  it.each(["actor_pair_set 0, 0, 0, 2, 3", "actor_pair_end 0x8000, 0", "stop_companion_following script: 3, movement: :none", "rt_call_global 10536"])("blocks ambiguous persistent assignment: %s", (command) => {
    const p = project(SOURCE.replace("  nop", `  ${command}`)), source = imported(p), edit = removeBw2ScriptEntry(source, 2), before = structuredClone(p);
    expect(() => replaceBw2ProjectScript(p, 0, edit.source, { entryMapping: edit.mapping })).toThrow(/Keep the entry slots/); expect(p).toEqual(before);
    expect(replaceBw2ProjectScript(p, 0, clearBw2ScriptEntry(source, 2).source).entries).toHaveLength(3);
  });
  it("retains overlay context when clearing the last entry table and adding its first entry again", () => {
    const p = project("preserve_layout\noverlay 66\nscript :only, entry: 1 do\n  halt\nend\n"), source = decompileBw2ProjectScript(p, 0, { overlayId: 66 }).source;
    writeU16(p.narcs.overworlds!.rawFiles[0], 38, 0);
    const edit = removeBw2ScriptEntry(source, 1);
    expect(replaceBw2ProjectScript(p, 0, edit.source, { entryMapping: edit.mapping }).bytes.length).toBe(2);
    const empty = decompileBw2ProjectScript(p, 0, { overlayId: 66 }); expect(empty.source).toContain("overlay 66");
    expect(replaceBw2ProjectScript(p, 0, addBw2ScriptEntry(empty.source).source).entries).toHaveLength(1);
  });
});
