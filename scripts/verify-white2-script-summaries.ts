import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { sha256Hex } from "../src/nds/sha256";
import { compileBw2Script, bw2ScriptBytesEqual } from "../src/pokeweb/bw2ScriptCompiler";
import { compileBw2ProjectScript, decompileBw2ProjectScript, replaceBw2ProjectScript } from "../src/pokeweb/bw2ScriptModel";
import { WHITE2_SCRIPT_SUMMARIES, matchBw2VanillaScriptSummary } from "../src/pokeweb/bw2ScriptSummaries";
import { cacheBw2ScriptRuntimeContext } from "../src/pokeweb/bw2ScriptOverlayContext";
import { splitBw2ScriptSource, joinBw2ScriptSource } from "../src/pokeweb/bw2ScriptSourceParts";
import { buildBw2ScriptSourceContext } from "../src/pokeweb/bw2ScriptContextModel";
import { bw2ScriptMessageReference } from "../src/pokeweb/bw2ScriptTextModel";
import type { ProjectState } from "../src/pokeweb/projectStore";

// Read-only ROM verification. The one edited member is applied only to an in-memory project.
const path = process.argv[2]; if (!path) throw new Error("Usage: vite-node scripts/verify-white2-script-summaries.ts /path/to/cleanwhite2.nds");
const romBytes = await readFile(path), hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
assert.equal(hash(romBytes), WHITE2_SCRIPT_SUMMARIES.sourceRomSha256);
const rom = new NintendoDSRom(romBytes, { fileData: "view" }), archive = new NARC(rom.getFileByName("a/0/5/6"));
const project: ProjectState = {
  session: { romName: "summary audit", baseRom: "BW2", baseVersion: "W2", fairy: false, fileIds: {}, blacklist: [] },
  romInfo: { title: rom.name, idCode: rom.idCode, fileName: "audit.nds", size: romBytes.length }, arm9: new Uint8Array(), overlays: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
  narcs: { scripts: { name: "scripts", fileId: 1, sourcePath: "a/0/5/6", fileCount: archive.files.length, rawFiles: archive.files, records: new Map(), dirty: new Set() } },
};
cacheBw2ScriptRuntimeContext(project, rom);
const dir = "work/bw2-vanilla-summaries/annotated"; await mkdir(dir, { recursive: true });
let files = 0, notes = 0, unknown = 0, mismatchesRejected = 0, dialogueLookups = 0;
for (const [file, bytes] of archive.files.entries()) {
  const member = matchBw2VanillaScriptSummary(project, file, bytes)!;
  assert(member); assert.equal(member.sha256, hash(bytes)); assert.equal(sha256Hex(bytes), hash(bytes));
  for (const offset of new Set([0, bytes.length - 1])) {
    const modified = Uint8Array.from(bytes); modified[offset] ^= 1;
    assert.equal(matchBw2VanillaScriptSummary(project, file, modified), undefined); mismatchesRejected++;
  }
  if (member.kind !== "field") continue;
  const imported = decompileBw2ProjectScript(project, file), compiled = compileBw2Script(imported.source), variant = member.variants.find((v) => v.overlay === (compiled.overlayId ?? null))!;
  assert(variant); assert(bw2ScriptBytesEqual(compiled.bytes, bytes)); assert.equal(imported.editable, variant.editable);
  assert.equal(joinBw2ScriptSource(splitBw2ScriptSource(imported.source)), imported.source);
  const normalized = imported.source.split("\n").filter((line) => /^\s*#/.test(line)).map((line) => line.replace(/^\s*#\s*/, "")).join(" ");
  for (const routine of variant.routines) { assert(normalized.includes(routine.summary.replace(/\s+/g, " ")), `Missing summary: file ${file}, byte ${routine.offset}`); notes++; if (routine.kind === "undecoded") unknown++; }
  const context = buildBw2ScriptSourceContext(imported.source);
  for (const instruction of compiled.instructions.filter((i) => [0x3c, 0x3d, 0x43].includes(i.opcode))) {
    const call = context.callAt(instruction.line); assert(call, `Lost dialogue context after comments in ${file}`);
    const reference = bw2ScriptMessageReference(call, context.constantBindings, compiled.overlayId);
    assert(reference, `Lost message reference after comments in ${file}`);
    const index = instruction.opcode === 0x43 ? 0 : 1;
    const bank = instruction.opcode === 0x43 ? 0x400 : instruction.operands[0];
    if (bank < 0x4000 && instruction.operands[index] < 0x4000) assert.equal(reference.entryId, instruction.operands[index]);
    dialogueLookups++;
  }
  await writeFile(`${dir}/${file}.bws`, imported.source); files++;
}
assert.equal(files, 673); assert.equal(notes, 8192); assert.equal(unknown, 0); assert.equal(project.narcs.scripts!.dirty.size, 0);
const baseline = project.bw2ScriptEditor!.drafts[854].source, original = archive.files[854];
const edited = baseline.replace("script :script_6, entry: 6 do\n", "script :script_6, entry: 6 do\n  nop\n");
assert.notEqual(edited, baseline); const applied = replaceBw2ProjectScript(project, 854, edited);
assert.equal(applied.roundTrip?.verified, true); assert.equal(applied.roundTrip?.editable, true); assert.equal(applied.bytes.length, original.length + 2);
assert.equal(matchBw2VanillaScriptSummary(project, 854, applied.bytes), undefined);
const refreshed = decompileBw2ProjectScript(project, 854);
assert(refreshed.source.includes("# Vanilla White 2 notes: only matching routines"));
const originalPlacement = WHITE2_SCRIPT_SUMMARIES.files[854].variants[0].routines.find((r) => r.entries?.includes(6))!;
const unchangedGym = WHITE2_SCRIPT_SUMMARIES.files[854].variants[0].routines.find((r) => r.entries?.includes(23))!;
const refreshedNotes = refreshed.source.split("\n").filter((line) => /^\s*#/.test(line)).map((line) => line.replace(/^\s*#\s*/, "")).join(" ");
assert(!refreshedNotes.includes(originalPlacement.summary));
assert(refreshedNotes.includes(unchangedGym.summary));
assert(bw2ScriptBytesEqual(compileBw2Script(refreshed.source).bytes, applied.bytes));
assert.deepEqual([...project.narcs.scripts!.dirty], [854]);
// Unknown/truncated data still blocks changes; the stock field corpus is now fully decoded.
const unsupported = { ...project, bw2ScriptEditor: undefined, narcs: { ...project.narcs, scripts: { ...project.narcs.scripts!, rawFiles: project.narcs.scripts!.rawFiles.slice(), records: new Map(), dirty: new Set<number>() } } };
unsupported.narcs.scripts.rawFiles[854] = Uint8Array.from([2, 0, 0, 0, 0x13, 0xfd, 0xff, 0xff, 1, 2, 3]);
const unverified = decompileBw2ProjectScript(unsupported, 854);
assert.equal(unverified.editable, false);
assert.throws(() => compileBw2ProjectScript(unsupported, 854, unverified.source + "\ndata :unverified, 1\n"), /read-only/);
assert.equal(hash(romBytes), WHITE2_SCRIPT_SUMMARIES.sourceRomSha256);
const result = { game: rom.idCode, memberHashesVerified: archive.files.length, byteIdenticalAnnotatedFiles: files, routineAndMovementComments: notes, undecodedEntryComments: unknown, dialogueLookupsVerified: dialogueLookups, modifiedMemberChecksRejected: mismatchesRejected, applyWithCommentsVerified: true, unchangedRelocatedRoutineKeepsNotes: true, editedRoutineGetsNoVanillaNotes: true, readOnlyGatePreserved: true, inputRomWritten: false, inGameTestPerformed: false };
await writeFile("work/bw2-vanilla-summaries/verification.json", JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result, null, 2));
