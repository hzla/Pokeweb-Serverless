import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { readU32 } from "../src/nds/binary";
import { bw2ScriptBytesEqual, compileBw2Script, decompileBw2Script } from "../src/pokeweb/bw2ScriptCompiler";
import { decompileBw2ProjectScript, replaceBw2ProjectScript } from "../src/pokeweb/bw2ScriptModel";
import { cacheBw2ScriptRuntimeContext } from "../src/pokeweb/bw2ScriptOverlayContext";
import { WHITE2_SCRIPT_SUMMARIES } from "../src/pokeweb/bw2ScriptSummaries";
import type { ProjectState } from "../src/pokeweb/projectStore";
import { bw2CommandByOpcode } from "../src/pokeweb/bw2ScriptCompiler/commands";

// Byte changes are applied only to independent in-memory projects. No ROM is written.
const path = process.argv[2]; if (!path) throw new Error("Usage: vite-node scripts/verify-bw2-full-editing.ts cleanwhite2.nds");
const bytes = await readFile(path), sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
assert.equal(sha256(bytes), WHITE2_SCRIPT_SUMMARIES.sourceRomSha256);
const rom = new NintendoDSRom(bytes, { fileData: "view" }), archive = new NARC(rom.getFileByName("a/0/5/6"));
const project: ProjectState = { session: { romName: "native edit audit", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] }, romInfo: { title: rom.name, idCode: rom.idCode, fileName: "audit.nds", size: bytes.length }, arm9: new Uint8Array(), overlays: {}, formats: {}, trpokInfo: [], texts: { banks: {} }, narcs: { scripts: { name: "scripts", fileId: 1, sourcePath: "a/0/5/6", fileCount: archive.files.length, rawFiles: archive.files, records: new Map(), dirty: new Set() } } };
cacheBw2ScriptRuntimeContext(project, rom);
let imported = 0, grown = 0, empty = 0, relocations = 0, pointers = 0, shopMenus = 0;
const results: { file: number; originalBytes: number; editedBytes?: number; overlay: number | null; entries: number }[] = [];
for (const [id, member] of Object.entries(WHITE2_SCRIPT_SUMMARIES.files)) {
  if (member.kind !== "field") continue;
  const file = Number(id), original = archive.files[file], decoded = decompileBw2ProjectScript(project, file), compiled = compileBw2Script(decoded.source);
  assert.equal(decoded.editable, true, `Member ${file}: ${decoded.warnings.join(" ")}`); assert(bw2ScriptBytesEqual(compiled.bytes, original)); imported++;
  for (const command of compiled.instructions) {
    const layout = bw2CommandByOpcode(command.opcode, command.dispatchId ?? compiled.overlayId)!.definition;
    for (const index of Object.keys(layout.relative ?? {}).map(Number)) {
      const operand = command.offset + 2 + layout.widths.slice(0, index).reduce((a, b) => a + b, 0), expected = operand + 4 + (readU32(original, operand) | 0);
      assert(compiled.relocations.some((ref) => ref.operandOffset === operand && ref.targetOffset === expected)); pointers++;
    }
    if (command.dispatchId === 60) shopMenus++;
  }
  const edited = decoded.source.replace(/^(script :\w+, entry: \d+ do)\n/m, "$1\n  nop\n");
  if (edited === decoded.source) { assert.equal(compiled.entries.length, 0); empty++; results.push({ file, originalBytes: original.length, overlay: compiled.overlayId ?? null, entries: 0 }); continue; }
  const staged: ProjectState = { ...project, bw2ScriptEditor: { drafts: { [file]: structuredClone(project.bw2ScriptEditor!.drafts[file]) } }, narcs: { ...project.narcs, scripts: { ...project.narcs.scripts!, rawFiles: archive.files.slice(), records: new Map(), dirty: new Set() } } };
  const applied = replaceBw2ProjectScript(staged, file, edited);
  assert.equal(applied.roundTrip?.verified, true); assert.equal(applied.roundTrip?.editable, true); assert.equal(applied.bytes.length, original.length + 2);
  for (const ref of applied.relocations) { assert.equal(ref.operandOffset + 4 + (readU32(applied.bytes, ref.operandOffset) | 0), ref.targetOffset); relocations++; }
  const recovered = decompileBw2ProjectScript(staged, file); assert.equal(recovered.editable, true); assert(bw2ScriptBytesEqual(compileBw2Script(recovered.source).bytes, applied.bytes));
  assert.deepEqual([...staged.narcs.scripts!.dirty], [file]);
  for (const [other, value] of staged.narcs.scripts!.rawFiles.entries()) if (other !== file) assert.equal(value, archive.files[other]);
  grown++; results.push({ file, originalBytes: original.length, editedBytes: applied.bytes.length, overlay: compiled.overlayId ?? null, entries: applied.entries.length });
  if (file % 100 === 0) process.stderr.write(`Verified native edits through member ${file}\n`);
}
assert.equal(imported, 673); assert.equal(grown, 585); assert.equal(empty, 88); assert(shopMenus > 0);
assert.equal(sha256(bytes), WHITE2_SCRIPT_SUMMARIES.sourceRomSha256); assert.equal(project.narcs.scripts!.dirty.size, 0);
const report = { game: rom.idCode, byteIdenticalEditableFiles: imported, codeGrowthAppliedAndReimported: grown, emptyFieldFiles: empty, originalCodePointersVerified: pointers, editedRelocationsVerified: relocations, joinAvenueShopCallsVerified: shopMenus, inputRomWritten: false, inGameTestPerformed: false, files: results };
await mkdir("work/bw2-support", { recursive: true }); await writeFile("work/bw2-support/edit-verification.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, files: results.length }, null, 2));
