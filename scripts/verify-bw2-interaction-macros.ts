import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readU16, readU32 } from "../src/nds/binary";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { bw2ScriptBytesEqual, compileBw2Script, decompileBw2Script } from "../src/pokeweb/bw2ScriptCompiler";
import { buildBw2ScriptSourceContext } from "../src/pokeweb/bw2ScriptContextModel";
import { decompileBw2ProjectScript, replaceBw2ProjectScript } from "../src/pokeweb/bw2ScriptModel";
import { cacheBw2ScriptRuntimeContext } from "../src/pokeweb/bw2ScriptOverlayContext";
import { bw2ScriptMessageReference, bw2ScriptTextEntries } from "../src/pokeweb/bw2ScriptTextModel";
import { decodeGen5TextBank } from "../src/pokeweb/text";
import type { HeaderRow } from "../src/pokeweb/headerModel";
import type { ProjectState } from "../src/pokeweb/projectStore";

// Native ROM reads and project edits stay in memory; this audit never exports a ROM.
async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw new Error("Usage: vite-node scripts/verify-bw2-interaction-macros.ts clean-us-white2.nds");
  const romBytes = await readFile(path);
  const sha256 = createHash("sha256").update(romBytes).digest("hex");
  assert.equal(sha256, "3e50aec3db401332175a5d2b5fe2a68ac1a05ec63995dba9d1506b1b51837446", "Expected the audited stock US White 2 revision.");
  const rom = new NintendoDSRom(romBytes, { fileData: "view" });
  const archiveBytes = rom.getFileByName("a/0/5/6"), archive = new NARC(archiveBytes);
  const headers = new NARC(rom.getFileByName("a/0/1/2")).files[0];
  const story = new NARC(rom.getFileByName("a/0/0/3"));
  const names = new Map(decodeGen5TextBank(new NARC(rom.getFileByName("a/0/0/2")).files[109])
    .filter(([id]) => /^0_\d+/.test(id)).map(([id, name]) => [Number(/^0_(\d+)/.exec(id)![1]), name]));
  const rows: Record<number, HeaderRow> = {};
  const selected: { area: string; file: number; zone: number }[] = [];
  for (let offset = 0; offset < headers.length; offset += 48) {
    const zone = offset / 48, file = readU16(headers, offset + 6);
    const area = names.get(headers[offset + 26] | (headers[offset + 27] & 3) << 8) ?? "";
    rows[zone + 1] = { index: zone, location_name: area, script_id: file, level_script_id: readU16(headers, offset + 8), text_bank_id: readU16(headers, offset + 10) } as HeaderRow;
    if (readU16(headers, offset + 4) === 0 && (/ (?:City|Town)$/.test(area) || /^Route \d+$/.test(area))) selected.push({ area, file, zone });
  }
  assert.equal(selected.length, 39);
  assert.equal(new Set(selected.map((header) => header.file)).size, 39);
  const project: ProjectState = {
    originalRomBytes: romBytes,
    session: { romName: "audit", baseRom: "BW2", baseVersion: "W2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: rom.name, idCode: rom.idCode, fileName: "audit.nds", size: romBytes.length },
    arm9: new Uint8Array(), overlays: {}, formats: {}, trpokInfo: [], texts: { banks: {} }, headers: { count: headers.length / 48, rows },
    narcs: {
      scripts: { name: "scripts", sourcePath: "a/0/5/6", fileId: 1, fileCount: archive.files.length, rawFiles: archive.files, records: new Map(), dirty: new Set() },
      story_texts: { name: "story_texts", sourcePath: "a/0/0/3", fileId: 2, fileCount: story.files.length, rawFiles: story.files, records: new Map(), dirty: new Set() },
    },
  };
  cacheBw2ScriptRuntimeContext(project, rom);
  const totals: Record<string, number> = { talk: 0, read_sign: 0, give_item: 0, finish_interaction: 0 };
  let linkedMessages = 0;
  const files = selected.map(({ area, file, zone }) => {
    const original = archive.files[file], imported = decompileBw2ProjectScript(project, file);
    const compiled = compileBw2Script(imported.source);
    assert(bw2ScriptBytesEqual(compiled.bytes, original));
    const expanded = decompileBw2Script(original, { overlayId: compiled.overlayId, recoverMacros: false });
    assert(bw2ScriptBytesEqual(compileBw2Script(expanded.source).bytes, original));
    const context = buildBw2ScriptSourceContext(imported.source);
    const counts = Object.fromEntries(Object.keys(totals).map((name) => [name, imported.source.split("\n").filter((line) => new RegExp(`^\\s*${name}(?:\\s|$)`).test(line)).length]));
    for (const name of Object.keys(totals)) totals[name] += counts[name];
    for (const instruction of compiled.instructions) {
      const call = context.callAt(instruction.line);
      if (call?.name !== "talk" && call?.name !== "read_sign") continue;
      if (instruction.opcode !== 0x3d && instruction.opcode !== 0x43) continue;
      const reference = bw2ScriptMessageReference(call, context.constantBindings, compiled.overlayId)!;
      assert.equal(reference.defaultBank, true); assert.equal(reference.reason, undefined);
      assert.equal(reference.entryId, instruction.operands[instruction.opcode === 0x43 ? 0 : 1]);
      const bank = Number(rows[zone + 1].text_bank_id);
      assert(bw2ScriptTextEntries(project, bank).some((entry) => entry.block === 0 && entry.entry === reference.entryId));
      linkedMessages++;
    }
    return { area, file, overlay: compiled.overlayId ?? null, byteIdentical: true, editable: imported.editable, counts };
  });
  assert.deepEqual(totals, { talk: 195, read_sign: 113, give_item: 25, finish_interaction: 442 });
  assert.equal(linkedMessages, 308);
  const baseline = project.bw2ScriptEditor!.drafts[854].source;
  const edits = [
    { macro: "talk", source: baseline.replace(/talk message: (\d+)/, (_, id: string) => `talk message: ${Number(id) + 1}`) },
    { macro: "read_sign", source: baseline.replace(/(read_sign message: \d+, style: ):town/, "$1:road") },
    { macro: "give_item", source: baseline.replace(/(give_item item: \d+, quantity: )(\d+)/, (_, prefix: string, quantity: string) => `${prefix}${Number(quantity) + 1}`) },
    { macro: "finish_interaction", source: baseline.replace("finish_interaction", "sleep 1\n  finish_interaction") },
  ];
  const editChecks = edits.map(({ macro, source }) => {
    assert.notEqual(source, baseline);
    const staged: ProjectState = { ...project, bw2ScriptEditor: structuredClone(project.bw2ScriptEditor), narcs: { ...project.narcs,
      scripts: { ...project.narcs.scripts!, rawFiles: archive.files.slice(), records: new Map(), dirty: new Set() } } };
    const result = replaceBw2ProjectScript(staged, 854, source);
    assert.equal(result.roundTrip?.verified, true); assert.equal(result.roundTrip?.editable, true);
    const recovered = decompileBw2Script(result.bytes, { overlayId: 66 });
    assert(recovered.editable); assert(bw2ScriptBytesEqual(compileBw2Script(recovered.source).bytes, result.bytes));
    assert.deepEqual([...staged.narcs.scripts!.dirty], [854]);
    for (const ref of result.relocations) assert.equal(ref.operandOffset + 4 + (readU32(result.bytes, ref.operandOffset) | 0), ref.targetOffset);
    const rebuilt = new NARC(archiveBytes); rebuilt.files[854] = result.bytes;
    const saved = new NARC(rebuilt.save());
    for (const [id, bytes] of saved.files.entries()) assert(bw2ScriptBytesEqual(bytes, id === 854 ? result.bytes : archive.files[id]));
    assert(bw2ScriptBytesEqual(staged.bw2ScriptEditor!.drafts[854].imported!.baselineBytes, archive.files[854]));
    return { macro, originalBytes: archive.files[854].length, editedBytes: result.bytes.length, editedRoundTrip: true, relocationsChecked: result.relocations.length, changedMembers: [854] };
  });
  assert.equal(project.narcs.scripts!.dirty.size, 0);
  assert.equal(project.narcs.story_texts!.dirty.size, 0);
  console.log(JSON.stringify({ rom: rom.idCode, sha256, matrix: 0, byteIdenticalFiles: files.length, editableFiles: files.filter((file) => file.editable).length,
    recoveredMacros: totals, verifiedLinkedMessages: linkedMessages, files, editChecks, inputRomWritten: false, inGameTestPerformed: false }, null, 2));
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
