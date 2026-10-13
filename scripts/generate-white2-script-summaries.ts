/** Build a deterministic summary catalog from the pinned US White 2 ROM.
 * No ROM bytes, complete dialogue banks, or decompiled source enter the catalog. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { readU16, readU32 } from "../src/nds/binary";
import { sha256Hex } from "../src/nds/sha256";
import { gen5ScriptEntries } from "../src/pokeweb/gen5ScriptCommands";
import { decodeGen5TextBank } from "../src/pokeweb/text";
import { compileBw2Script, decompileBw2Script, bw2ScriptBytesEqual } from "../src/pokeweb/bw2ScriptCompiler";
import { bw2CommandByOpcode } from "../src/pokeweb/bw2ScriptCompiler/commands";
import { parseBw2Script } from "../src/pokeweb/bw2ScriptCompiler/parser";
import { bw2WorkAlias } from "../src/pokeweb/bw2ScriptCompiler/workAliases";
import { cacheBw2ScriptRuntimeContext, findBw2ScriptOverlayDispatch } from "../src/pokeweb/bw2ScriptOverlayContext";
import type { ProjectState } from "../src/pokeweb/projectStore";
import type { Bw2ScriptSummaryCatalog, Bw2ScriptSummaryFile, Bw2RoutineSummary } from "../src/pokeweb/bw2ScriptSummaryTypes";
import { routineSummary, movementSummary, summaryEntryReachability, type SummaryRoutine, type SummaryRole, type SummaryMap } from "./lib/bw2ScriptSummaryAnalysis";
import contracts from "../src/assets/translation/white2-script-contracts.json";
import { BW2_ROUTINE_FINGERPRINT_VERSION, bw2RoutineFingerprints } from "../src/pokeweb/bw2ScriptSummaryFingerprint";

const romPath = process.argv[2];
if (!romPath) throw new Error("Usage: vite-node scripts/generate-white2-script-summaries.ts /path/to/cleanwhite2.nds [output.json]");
const output = resolve(process.argv[3] ?? "src/assets/data/white2ScriptSummaries.json"), reportDir = resolve("work/bw2-vanilla-summaries");
await mkdir(reportDir, { recursive: true });
const original = await readFile(romPath), nativeHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
if (nativeHash(original) !== contracts.sourceSha256) throw new Error("Summary generation requires the pinned unmodified US White 2 ROM.");
const rom = new NintendoDSRom(original, { fileData: "view" }), archive = (path: string) => new NARC(rom.getFileByName(path)).files;
const scripts = archive("a/0/5/6"), header = archive("a/0/1/2")[0], events = archive("a/1/2/6");
const textMap = (bytes: Uint8Array) => new Map(decodeGen5TextBank(bytes).filter(([id]) => /^0_\d+/.test(id)).map(([id, text]) => [Number(/^0_(\d+)/.exec(id)![1]), text]));
const locations = textMap(archive("a/0/0/2")[109]), items = textMap(archive("a/0/0/2")[64]);
const texts = new Map(archive("a/0/0/3").map((bytes, id) => [id, textMap(bytes)]));
const project = { session: { baseRom: "BW2" }, narcs: {}, overlays: {} } as unknown as ProjectState;
cacheBw2ScriptRuntimeContext(project, rom); const runtime = project.bw2ScriptRuntimeContext!;
const dispatch = findBw2ScriptOverlayDispatch({ ramAddress: runtime.fieldRamAddress, data: runtime.fieldBytes }, new Map(Object.entries(runtime.overlays).map(([id, bounds]) => [Number(id), bounds])));
if (!dispatch || header.length % 48) throw new Error("Cannot verify original map context.");
const maps: SummaryMap[] = Array.from({ length: header.length / 48 }, (_, zone) => {
  const p = zone * 48;
  return { zone, matrix: readU16(header, p + 4), script: readU16(header, p + 6), auxiliary: readU16(header, p + 8), bank: readU16(header, p + 10), events: readU16(header, p + 22), name: locations.get(header[p + 26] | ((header[p + 27] & 3) << 8)) ?? "", overlay: dispatch.get(zone) ?? null };
});
const roles = new Map<number, SummaryRole[]>(), activationWarnings: string[] = [];
const addRole = (map: SummaryMap, entry: number, when: string) => {
  // Auxiliary selectors can also call shared/global IDs; do not mislabel those as local entries.
  if (!entry || entry > gen5ScriptEntries(scripts[map.script]).length) return;
  const list = roles.get(map.script) ?? []; list.push({ entry, zone: map.zone, when }); roles.set(map.script, list);
};
function activation(bytes: Uint8Array, start: number, map: SummaryMap) {
  let ended = false;
  for (let p = start; p + 2 <= bytes.length; p += 6) {
    const type = readU16(bytes, p); if (type === 0) { ended = true; break; }
    if (p + 6 > bytes.length || ![1, 2, 3, 4].includes(type)) { activationWarnings.push(`Zone ${map.zone}: undecoded event type ${type}`); break; }
    if (type === 1) {
      let q = p + 6 + (readU32(bytes, p + 2) | 0), terminated = false;
      for (let n = 0; n < bytes.length / 6 && q >= start && q + 2 <= bytes.length; n++, q += 6) {
        const work = readU16(bytes, q); if (!work) { terminated = true; break; }
        if (q + 6 > bytes.length) break;
        addRole(map, readU16(bytes, q + 4), `Scene trigger when ${bw2WorkAlias(work).name} equals ${readU16(bytes, q + 2)}`);
      }
      if (!terminated) activationWarnings.push(`Zone ${map.zone}: incomplete scene selector`);
    } else addRole(map, readU32(bytes, p + 2), type === 2 ? "On map entry" : type === 3 ? "When returning to the field after a menu or battle" : "During map setup");
  }
  if (!ended) activationWarnings.push(`Zone ${map.zone}: unterminated activation table`);
}
for (const map of maps) {
  activation(scripts[map.auxiliary], 0, map);
  const bytes = events[map.events]; if (!bytes || bytes.length < 8) continue;
  let p = 8;
  for (let i = 0; i < bytes[4] && p + 20 <= bytes.length; i++, p += 20) addRole(map, readU16(bytes, p), "Interacting with a map object or sign");
  for (let i = 0; i < bytes[5] && p + 36 <= bytes.length; i++, p += 36) addRole(map, readU16(bytes, p + 10), `Talking to map actor ${readU16(bytes, p)}`);
  p += bytes[6] * 20;
  for (let i = 0; i < bytes[7] && p + 22 <= bytes.length; i++, p += 22) addRole(map, readU16(bytes, p), "Stepping into a map trigger");
  if (p < bytes.length) activation(bytes, p, map);
}
const catalog: Bw2ScriptSummaryCatalog = { version: 2, gameCode: rom.idCode, sourceRomSha256: nativeHash(original), archive: "a/0/5/6", files: {} };
const coverage = { files: scripts.length, fieldFiles: 0, activationTables: 0, unrecognized: [] as number[], byteIdenticalFiles: 0, editableFiles: 0, routines: 0, movements: 0, undecodedEntries: [] as { file: number; entry: number; offset: number }[], confidence: { reviewed: 0, inferred: 0, partial: 0 }, activationWarnings: [] as string[] };
for (const [file, bytes] of scripts.entries()) {
  const sha256 = sha256Hex(bytes); if (sha256 !== nativeHash(bytes)) throw new Error(`Browser SHA-256 mismatch for member ${file}`);
  const assigned = maps.filter((map) => map.script === file), auxiliary = maps.filter((map) => map.auxiliary === file), shared = contracts.globalRanges.filter((range) => range.member === file);
  const entries = gen5ScriptEntries(bytes), field = entries.length > 0 || bytes.length >= 2 && readU16(bytes, 0) === 0xfd13;
  const names = [...new Set((field ? assigned : auxiliary).map((m) => m.name).filter(Boolean))];
  const description = field ? entries.length ? `${names.length ? names.slice(0, 4).join(", ") : shared.length ? "Shared/global" : "Unassigned"} field script. ${entries.length} public entry slot${entries.length === 1 ? "" : "s"}.` : "Empty field-script entry table; no executable routines." : auxiliary.length ? `Map-event selection table for ${names.slice(0, 4).join(", ") || "its assigned headers"}. These records select routines in the header's main script file; they are not executable commands.` : "Unrecognized member format; no routine purposes can be established safely.";
  const record: Bw2ScriptSummaryFile = { sha256, byteLength: bytes.length, kind: field ? "field" : auxiliary.length ? "activation-table" : "unrecognized", description, variants: [] };
  catalog.files[file] = record;
  if (!field) { if (auxiliary.length) coverage.activationTables++; else coverage.unrecognized.push(file); continue; }
  coverage.fieldFiles++;
  const overlays = [...new Set(assigned.map((m) => m.overlay))];
  if (!overlays.length) overlays.push((contracts.sharedOverlays as Record<string, number>)[file] ?? null);
  for (const overlay of overlays) {
    const decompiled = decompileBw2Script(bytes, { overlayId: overlay ?? undefined }), compiled = compileBw2Script(decompiled.source), ast = parseBw2Script(decompiled.source);
    if (!bw2ScriptBytesEqual(bytes, compiled.bytes)) throw new Error(`Changed round-trip bytes for ${file}`);
    coverage.byteIdenticalFiles++; if (decompiled.editable) coverage.editableFiles++;
    const commands = compiled.instructions.map((i) => {
      const layout = bw2CommandByOpcode(i.opcode, i.dispatchId ?? overlay ?? undefined)!;
      return { ...i, dispatchId: i.dispatchId ?? overlay ?? undefined, name: layout.name, next: i.offset + 2 + layout.definition.widths.reduce((a, b) => a + b, 0), targets: Object.entries(layout.definition.relative ?? {}).map(([index, kind]) => ({ kind, to: i.offset + 2 + layout.definition.widths.slice(0, Number(index)).reduce((a, b) => a + b, 0) + 4 + (i.operands[Number(index)] | 0) })) };
    });
    const routines: SummaryRoutine[] = (compiled.codeBlocks ?? []).map((block) => ({ name: block.name, kind: ast.definitions.find((d) => d.name === block.name)!.kind, offset: block.offset, end: block.endOffset, entries: compiled.entries.filter((e) => e.offset === block.offset).map((e) => e.entry), commands: commands.filter((i) => i.offset >= block.offset && i.offset < block.endOffset) }));
    const context = { file, routines, entryReachableOffsets: summaryEntryReachability(routines), maps: assigned, roles: roles.get(file) ?? [], banks: [...new Set([...assigned.map((m) => m.bank), ...shared.map((g) => g.bank)])], texts, items, shared };
    const summaries: Bw2RoutineSummary[] = routines.map((r) => routineSummary(r, context));
    coverage.routines += routines.length;
    for (const entry of compiled.entries.filter((e) => !compiled.codeBlocks?.some((r) => r.offset === e.offset))) {
      coverage.undecodedEntries.push({ file, entry: entry.entry, offset: entry.offset });
      summaries.push({ offset: entry.offset, kind: "undecoded", entries: [entry.entry], summary: "Undecoded entry point. Its bytes are preserved, but there is not enough decoded code to explain its purpose or permit safe edits.", confidence: "partial" });
    }
    for (const movement of compiled.movementBlocks ?? []) {
      const block = ast.layout?.find((d) => d.kind === "movement" && d.name === movement.name);
      if (block?.kind !== "movement") throw new Error("Missing movement source");
      const referenced = commands.some((c) => c.targets.some((t) => t.kind === "movement" && t.to >= movement.offset && t.to < movement.endOffset));
      summaries.push(movementSummary(movement.offset, block.body, referenced)); coverage.movements++;
    }
    const fingerprints = bw2RoutineFingerprints(compiled);
    for (const summary of summaries) {
      if (summary.kind !== "undecoded") {
        const fingerprint = fingerprints.get(summary.offset);
        if (!fingerprint) throw new Error(`Cannot fingerprint routine in member ${file} at ${summary.offset}`);
        summary.fingerprint = fingerprint;
      }
      coverage.confidence[summary.confidence]++;
    }
    record.variants.push({ overlay, editable: decompiled.editable, fingerprintVersion: BW2_ROUTINE_FINGERPRINT_VERSION, routines: summaries });
    if (file === 854) await writeFile(resolve(reportDir, "aspertia-evidence.json"), JSON.stringify({ banks: context.banks, items: Object.fromEntries([354, 4, 442].map((id) => [id, items.get(id)])), roles: context.roles, summaries }, null, 2));
  }
  if (file % 100 === 0) process.stderr.write(`Summarized member ${file}/${scripts.length}\n`);
}
coverage.activationWarnings = [...new Set(activationWarnings)];
await mkdir(resolve(output, ".."), { recursive: true }); await mkdir(reportDir, { recursive: true });
await writeFile(output, JSON.stringify(catalog) + "\n");
await writeFile(resolve(reportDir, "coverage.json"), JSON.stringify(coverage, null, 2) + "\n");
console.log(JSON.stringify({ output, ...coverage, activationWarnings: coverage.activationWarnings.length }, null, 2));
