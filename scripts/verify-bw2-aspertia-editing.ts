import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readU32 } from "../src/nds/binary";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { bw2ScriptBytesEqual, compileBw2Script, decompileBw2Script } from "../src/pokeweb/bw2ScriptCompiler";
import { compileBw2ProjectScript, decompileBw2ProjectScript, replaceBw2ProjectScript } from "../src/pokeweb/bw2ScriptModel";
import { cacheBw2ScriptRuntimeContext, resolveBw2ScriptOverlay } from "../src/pokeweb/bw2ScriptOverlayContext";
import { joinBw2ScriptSource, splitBw2ScriptSource } from "../src/pokeweb/bw2ScriptSourceParts";
import type { ProjectState } from "../src/pokeweb/projectStore";

// Read-only audit: edits and NARC rebuilding happen only in memory.
async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw new Error("Usage: vite-node scripts/verify-bw2-aspertia-editing.ts clean-us-white2.nds");
  const romBytes = await readFile(path);
  assert.equal(createHash("sha256").update(romBytes).digest("hex"), "3e50aec3db401332175a5d2b5fe2a68ac1a05ec63995dba9d1506b1b51837446", "Expected the audited US White 2 revision.");
  const rom = new NintendoDSRom(romBytes, { fileData: "view" }), archive = new NARC(rom.getFileByName("a/0/5/6"));
  const original = archive.files[854], originals = archive.files.map((file) => file.slice());
  const project: ProjectState = {
    originalRomBytes: romBytes,
    session: { romName: "audit", baseRom: "BW2", baseVersion: "W2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: rom.name, idCode: rom.idCode, fileName: "audit.nds", size: romBytes.length },
    arm9: new Uint8Array(), overlays: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    narcs: { scripts: { name: "scripts", fileId: 1, fileCount: archive.files.length, sourcePath: "a/0/5/6", rawFiles: archive.files, records: new Map(), dirty: new Set() } },
  };
  cacheBw2ScriptRuntimeContext(project, rom);
  assert(project.bw2ScriptRuntimeContext);
  assert(project.bw2ScriptRuntimeContext.fieldBytes.length < 1_000_000);
  project.bw2ScriptRuntimeContext = structuredClone(project.bw2ScriptRuntimeContext);
  delete project.originalRomBytes; // Autosave/persistence releases this buffer.
  const context = resolveBw2ScriptOverlay(project, 854);
  assert.equal(context.overlayId, 66); assert.equal(context.kind, "detected");
  const native = rom.loadArm9Overlays([12, 66]), field = native.get(12)!, overlay = native.get(66)!;
  const commandEvidence = [1000, 1011].map((opcode) => {
    const pointer = readU32(overlay.data, 0x3a0 + (opcode - 1000) * 4), offset = (pointer & ~1) - overlay.ramAddress;
    const code = overlay.data.subarray(offset, offset + 16);
    // push r3/lr; use event work (r1); BL accessor; BL effect; return CONTINUE.
    assert.deepEqual([...code.subarray(0, 4)], [0x08, 0xb5, 0x08, 0x1c]);
    assert.deepEqual([...code.subarray(12, 16)], [0, 0x20, 0x08, 0xbd]);
    assert.equal(code[5] & 0xf8, 0xf0); assert.equal(code[7] & 0xf8, 0xf8);
    assert.equal(code[9] & 0xf8, 0xf0); assert.equal(code[11] & 0xf8, 0xf8);
    return { opcode, handler: `0x${pointer.toString(16)}`, operandBytes: 0 };
  });
  const imported = decompileBw2ProjectScript(project, 854);
  assert.equal(imported.editable, true); assert.deepEqual(imported.warnings, []);
  assert(bw2ScriptBytesEqual(compileBw2Script(imported.source).bytes, original));
  const parts = splitBw2ScriptSource(imported.source);
  assert.equal(joinBw2ScriptSource(parts), imported.source);
  assert(!/^movement :/m.test(parts.script));
  assert.equal((parts.definitions.match(/^movement :/gm) ?? []).length, 50);
  assert(imported.source.includes("aspertia_start_petals"));
  assert(imported.source.includes("aspertia_initialize_ending"));
  const companionMacro = "stop_companion_following script: 1, movement: :none";
  assert(imported.source.includes(companionMacro));
  assert(imported.source.match(/script :script_22, entry: 22 do[\s\S]*?\nend/)?.[0].includes(companionMacro));
  const macroProject: ProjectState = { ...project, bw2ScriptEditor: structuredClone(project.bw2ScriptEditor), narcs: { ...project.narcs, scripts: { ...project.narcs.scripts!, rawFiles: project.narcs.scripts!.rawFiles.slice(), records: new Map(), dirty: new Set() } } };
  const macroEdit = replaceBw2ProjectScript(macroProject, 854, imported.source.replace(companionMacro, "stop_companion_following script: 2, movement: :none"));
  assert.equal(macroEdit.bytes.length, original.length);
  assert.equal(macroEdit.roundTrip?.verified, true);
  assert.equal(macroEdit.roundTrip?.editable, true);
  const macroProposed = decompileBw2Script(macroEdit.bytes, { overlayId: 66 });
  assert(macroProposed.source.includes("stop_companion_following script: 2, movement: :none"));
  assert(bw2ScriptBytesEqual(compileBw2Script(macroProposed.source).bytes, macroEdit.bytes));
  assert.equal(original.reduce((count, byte, offset) => count + (byte !== macroEdit.bytes[offset] ? 1 : 0), 0), 1);
  const oddEdit = compileBw2ProjectScript(project, 854, imported.source.replace("script :script_6, entry: 6 do\n", "script :script_6, entry: 6 do\n  if bianca_intro_progress == 0\n    nop\n  end\n"));
  assert(oddEdit.relocations.filter((ref) => ref.kind === "movement").every((ref) => ref.targetOffset % 2 === 0));
  const edited = imported.source.replace("script :script_6, entry: 6 do\n", "script :script_6, entry: 6 do\n  nop\n")
    .replace(/(movement :movement_1db0 do\n(?:[ \t]*#[^\n]*\n)*)  wait_8 2/, "$1  walk_down 1\n  wait_8 2");
  assert.notEqual(edited, imported.source);
  const preview = compileBw2ProjectScript(project, 854, edited);
  assert.equal(preview.bytes.length, original.length + 6);
  assert.equal(project.narcs.scripts!.dirty.size, 0);
  assert(bw2ScriptBytesEqual(project.narcs.scripts!.rawFiles[854], original));
  const applied = replaceBw2ProjectScript(project, 854, edited);
  assert.equal(applied.roundTrip?.verified, true);
  assert.equal(applied.roundTrip?.editable, true);
  const proposed = decompileBw2Script(applied.bytes, { overlayId: 66 });
  assert(proposed.editable); assert(bw2ScriptBytesEqual(compileBw2Script(proposed.source).bytes, applied.bytes));
  for (const ref of applied.relocations) assert.equal(ref.operandOffset + 4 + (readU32(applied.bytes, ref.operandOffset) | 0), ref.targetOffset);
  assert.deepEqual([...project.narcs.scripts!.dirty], [854]);
  const rebuilt = new NARC(archive.save());
  assert(bw2ScriptBytesEqual(rebuilt.files[854], applied.bytes));
  for (const [id, bytes] of rebuilt.files.entries()) if (id !== 854) assert(bw2ScriptBytesEqual(bytes, originals[id]));
  const baseline = project.bw2ScriptEditor!.drafts[854].imported!;
  assert(bw2ScriptBytesEqual(baseline.baselineBytes, original));
  const current = project.narcs.scripts!.rawFiles[854];
  assert.throws(() => replaceBw2ProjectScript(project, 854, `${edited}\ndata :unknown, 1, 2`), /cannot be safely verified/);
  assert.equal(project.narcs.scripts!.rawFiles[854], current);
  const actorHandler = readU32(field.data, 0x1b178 + 0x64 * 4);
  console.log(JSON.stringify({ rom: rom.idCode, file: 854, overlay: context.overlayId, commandEvidence,
    actorMovementHandler: `0x${actorHandler.toString(16)}`, fieldRamAddress: `0x${field.ramAddress.toString(16)}`,
    originalBytes: original.length, editedBytes: applied.bytes.length, byteIdenticalOriginal: true, editedRoundTrip: true,
    stats: imported.stats, relocationsChecked: applied.relocations.length, changedMembers: [854], unsupportedEditRejected: true, oddControlFlowAlignmentVerified: true,
    persistedOverlayContextVerified: true, companionMacroRecovered: true, companionMacroEditVerified: true, inputRomWritten: false }, null, 2));
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
