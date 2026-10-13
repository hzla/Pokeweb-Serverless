import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readU16, readU32 } from "../src/nds/binary";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { bw2ScriptBytesEqual, compileBw2Script } from "../src/pokeweb/bw2ScriptCompiler";
import { compileBw2ProjectScript, decompileBw2ProjectScript, replaceBw2ProjectScript } from "../src/pokeweb/bw2ScriptModel";
import { addBw2ScriptEntry, addBw2ScriptMovement, removeBw2ScriptEntry } from "../src/pokeweb/bw2ScriptStructure";
import { cacheBw2ScriptRuntimeContext } from "../src/pokeweb/bw2ScriptOverlayContext";
import { createNarcStore, type ProjectState } from "../src/pokeweb/projectStore";

// Read-only ROM audit: all edits, remapping and archive rebuilding stay in memory.
async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw new Error("Usage: vite-node scripts/verify-bw2-entry-editing.ts clean-us-white2.nds");
  const input = await readFile(path), hash = createHash("sha256").update(input).digest("hex");
  assert.equal(hash, "3e50aec3db401332175a5d2b5fe2a68ac1a05ec63995dba9d1506b1b51837446");
  const rom = new NintendoDSRom(input, { fileData: "view" });
  const scripts = new NARC(rom.getFileByName("a/0/5/6")), events = new NARC(rom.getFileByName("a/1/2/6"));
  const originals = scripts.files.map((file) => Uint8Array.from(file)), originalEvents = events.files.map((file) => Uint8Array.from(file));
  const project: ProjectState = {
    session: { romName: "audit", baseRom: "BW2", baseVersion: "W2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: rom.name, idCode: rom.idCode, fileName: "audit.nds", size: input.length },
    arm9: new Uint8Array(), overlays: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    narcs: { scripts: createNarcStore("scripts", "a/0/5/6", rom.fileId("a/0/5/6"), scripts),
      overworlds: createNarcStore("overworlds", "a/1/2/6", rom.fileId("a/1/2/6"), events),
      headers: createNarcStore("headers", "a/0/1/2", rom.fileId("a/0/1/2"), new NARC(rom.getFileByName("a/0/1/2"))) },
  };
  cacheBw2ScriptRuntimeContext(project, rom);
  const source = decompileBw2ProjectScript(project, 854).source, initial = compileBw2Script(source);
  assert(bw2ScriptBytesEqual(initial.bytes, originals[854])); assert.equal(initial.entries.length, 33);
  const entry = addBw2ScriptEntry(source), movement = addBw2ScriptMovement(entry.source, "greeting_step");
  const edited = movement.source.replace(`script :${entry.name}, entry: 34 do\n  halt`, `script :${entry.name}, entry: 34 do\n  apply_movement 3, :greeting_step\n  wait_movement\n  halt`);
  const added = replaceBw2ProjectScript(project, 854, edited, { entryMapping: entry.mapping });
  assert.equal(added.entries.length, 34); assert.equal(added.movementBlocks!.length, 51);
  assert.equal(added.entryChanges!.references.length, 0);
  for (const ref of added.relocations) assert.equal(ref.operandOffset + 4 + (readU32(added.bytes, ref.operandOffset) | 0), ref.targetOffset);
  assert(added.relocations.filter((ref) => ref.kind === "movement").every((ref) => ref.targetOffset % 2 === 0));
  const reimport = decompileBw2ProjectScript(project, 854); assert(reimport.editable); assert.equal(reimport.stats.entries, 34);
  const removal = removeBw2ScriptEntry(reimport.source, 18, 19);
  const before = Uint8Array.from(project.narcs.scripts!.rawFiles[854]), oldEvents = Uint8Array.from(project.narcs.overworlds!.rawFiles[163]);
  const preview = compileBw2ProjectScript(project, 854, removal.source, { entryMapping: removal.mapping });
  assert(bw2ScriptBytesEqual(before, project.narcs.scripts!.rawFiles[854])); assert(bw2ScriptBytesEqual(oldEvents, project.narcs.overworlds!.rawFiles[163]));
  assert(preview.entryChanges!.references.some((ref) => ref.location.startsWith("Special script table 855") && ref.before === 23 && ref.after === 22));
  assert(preview.entryChanges!.references.some((ref) => ref.location.startsWith("Events 163 footer") && ref.before === 25 && ref.after === 24));
  const removed = replaceBw2ProjectScript(project, 854, removal.source, { entryMapping: removal.mapping });
  assert.equal(removed.entries.length, 33);
  const eventBytes = project.narcs.overworlds!.rawFiles[163], footer = 8 + eventBytes[4] * 20 + eventBytes[5] * 36 + eventBytes[6] * 20 + eventBytes[7] * 22;
  assert(bw2ScriptBytesEqual(eventBytes.subarray(footer), project.narcs.scripts!.rawFiles[855]));
  assert.equal(readU16(project.narcs.scripts!.rawFiles[855], 30), readU16(originals[855], 30) - 1); assert.equal(readU16(project.narcs.scripts!.rawFiles[855], 36), readU16(originals[855], 36) - 1);
  const fresh = decompileBw2ProjectScript(structuredClone(project), 854); assert(fresh.editable); assert(bw2ScriptBytesEqual(compileBw2Script(fresh.source).bytes, removed.bytes));
  const rebuilt = new NARC(); rebuilt.files = project.narcs.scripts!.rawFiles;
  const rebuiltEvents = new NARC(); rebuiltEvents.files = project.narcs.overworlds!.rawFiles;
  const saved = new NARC(rebuilt.save()), savedEvents = new NARC(rebuiltEvents.save());
  for (const [id, file] of saved.files.entries()) if (id !== 854 && id !== 855) assert(bw2ScriptBytesEqual(file, originals[id]));
  for (const [id, file] of savedEvents.files.entries()) if (id !== 163) assert(bw2ScriptBytesEqual(file, originalEvents[id]));
  assert(bw2ScriptBytesEqual(saved.files[854], removed.bytes)); assert(bw2ScriptBytesEqual(savedEvents.files[163], eventBytes));
  assert.equal(createHash("sha256").update(input).digest("hex"), hash);
  console.log(JSON.stringify({ rom: rom.idCode, file: 854, initialEntries: 33, appendedEntries: 34, appendedMovements: 51,
    removedEntry: 18, replacementOriginalEntry: 19, finalEntries: 33, referencesUpdated: removed.entryChanges!.references,
    byteIdenticalOriginal: true, editedRoundTrip: true, allRelativeOffsetsVerified: true, previewReadOnly: true,
    changedScriptMembers: [854, 855], changedEventMembers: [163], otherMembersUnchanged: true, inputRomWritten: false }, null, 2));
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
