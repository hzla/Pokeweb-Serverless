import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { compileBw2ProjectScript, decompileBw2ProjectScript } from "../src/pokeweb/bw2ScriptModel";
import { cacheBw2ScriptRuntimeContext, resolveBw2ScriptOverlay } from "../src/pokeweb/bw2ScriptOverlayContext";
import { gen5ScriptEntries } from "../src/pokeweb/gen5ScriptCommands";
import { readU16 } from "../src/nds/binary";
import { Bw2ScriptDecompileError } from "../src/pokeweb/bw2ScriptCompiler";
import type { ProjectState } from "../src/pokeweb/projectStore";

async function main(): Promise<void> {
  if (process.argv.length < 3 || process.argv.length > 4) throw new Error("Usage: npm run scripts:bw2-audit -- path/to/bw2.nds [report.json]");
  if (process.argv[3]) {
    const inputStat = await stat(process.argv[2]), outputStat = await stat(process.argv[3]).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return; throw error; });
    if (outputStat && inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino) throw new Error("The report output must be a different file from the input ROM.");
  }
  const input = await readFile(process.argv[2]), hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex"), sourceRomSha256 = hash(input);
  const rom = new NintendoDSRom(input, { fileData: "view" });
  if (!/^IR[DE][A-Z]$/.test(rom.idCode)) throw new Error("Expected a Black 2 or White 2 ROM.");
  const files = new NARC(rom.getFileByName("a/0/5/6")).files;
  const project: ProjectState = {
    session: { romName: "script audit", baseRom: "BW2", baseVersion: rom.idCode[2] === "D" ? "W2" : "B2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: rom.name, idCode: rom.idCode, fileName: "audit.nds", size: rom.data.length },
    arm9: new Uint8Array(), overlays: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    narcs: { scripts: { name: "scripts", fileId: 1, sourcePath: "a/0/5/6", fileCount: files.length, rawFiles: files, records: new Map(), dirty: new Set() } },
  };
  cacheBw2ScriptRuntimeContext(project, rom);
  const headers = project.bw2ScriptRuntimeContext?.headers, auxiliary = new Set<number>();
  if (headers && headers.length % 48 === 0) for (let p = 0; p < headers.length; p += 48) auxiliary.add(readU16(headers, p + 8));
  type MemberResult = { fileId: number; bytes: number; kind: "field" | "empty-field" | "activation-table" | "unrecognized"; entries: number; overlayId?: number; zones?: number[]; editable?: boolean; verifiedRoundTrip?: boolean; verifiedCodeGrowth?: boolean; warnings?: string[]; error?: string; errorOffset?: number; failurePhase?: "decompile" | "code-growth" };
  const members: MemberResult[] = [];
  const report = { romCode: rom.idCode, sourceRomSha256, members: files.length, nonemptyFieldFiles: 0, emptyFieldFiles: 0, activationTables: 0, unrecognizedMembers: 0, emptyOrUnrecognizedTables: 0, verifiedRoundTrips: 0, editable: 0, readOnly: 0, recoveredBlocks: 0, recoveredMovements: 0, verifiedCodeGrowth: 0, failures: [] as { fileId: number; phase: string; error: string }[] };
  for (const [fileId, bytes] of files.entries()) {
    const entries = gen5ScriptEntries(bytes);
    const kind = entries.length ? "field" : bytes.length >= 2 && readU16(bytes, 0) === 0xfd13 ? "empty-field" : auxiliary.has(fileId) ? "activation-table" : "unrecognized";
    const member: MemberResult = { fileId, bytes: bytes.length, kind, entries: entries.length }; members.push(member);
    if (kind === "activation-table" || kind === "unrecognized") { report.emptyOrUnrecognizedTables++; if (kind === "activation-table") report.activationTables++; else report.unrecognizedMembers++; continue; }
    if (kind === "empty-field") { report.emptyFieldFiles++; report.emptyOrUnrecognizedTables++; } else report.nonemptyFieldFiles++;
    const context = resolveBw2ScriptOverlay(project, fileId); member.overlayId = context.overlayId; member.zones = context.zones;
    let phase: "decompile" | "code-growth" = "decompile";
    try {
      const result = decompileBw2ProjectScript(project, fileId);
      member.verifiedRoundTrip = true; member.editable = result.editable; member.warnings = result.warnings;
      report.verifiedRoundTrips++; report.recoveredBlocks += result.stats.structuredBlocks;
      report.recoveredMovements += result.stats.movements;
      if (!result.editable) { report.readOnly++; continue; }
      report.editable++;
      if (!entries.length) continue;
      // Exercise entry, branch, helper, and data relocation without saving a ROM.
      const edited = result.source.replace(/^(script :\w+, entry: \d+ do)\n/m, "$1\n  nop\n");
      if (edited === result.source) throw new Error("Editable member has no decoded public entry");
      phase = "code-growth";
      const compiled = compileBw2ProjectScript(project, fileId, edited);
      if (compiled.bytes.length !== bytes.length + 2 || !compiled.roundTrip?.editable) throw new Error("Code-growth relocation verification failed");
      member.verifiedCodeGrowth = true; report.verifiedCodeGrowth++;
    } catch (error) {
      member.error = error instanceof Error ? error.message : String(error); member.failurePhase = phase;
      if (error instanceof Bw2ScriptDecompileError) member.errorOffset = error.offset;
      report.failures.push({ fileId, phase, error: member.error });
    }
  }
  const groups = new Map<string, Set<number>>();
  for (const member of members) for (const message of [...(member.warnings ?? []), ...(member.error ? [member.error] : [])]) {
    const issue = message.replace(/\(byte 0x[0-9a-f]+\)|at 0x[0-9a-f]+|byte offset \d+/gi, "").replace(/\s+/g, " ").trim();
    const group = groups.get(issue) ?? new Set<number>(); group.add(member.fileId); groups.set(issue, group);
  }
  const issueGroups = [...groups].map(([issue, ids]) => ({ issue, count: ids.size, files: [...ids].sort((a, b) => a - b) })).sort((a, b) => b.count - a.count || a.issue.localeCompare(b.issue));
  assert.equal(hash(input), sourceRomSha256); assert.equal(project.narcs.scripts!.dirty.size, 0);
  const summary = { ...report, editableNonemptyFieldFiles: members.filter((member) => member.kind === "field" && member.editable).length,
    readOnlyNonemptyFieldFiles: members.filter((member) => member.kind === "field" && member.editable === false).length,
    failedNonemptyFieldFiles: members.filter((member) => member.kind === "field" && !member.verifiedRoundTrip).length,
    issueGroups, inputRomWritten: false, inGameTestPerformed: false };
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify({ ...summary, files: members }, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
  if (report.failures.length) process.exitCode = 1;
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
