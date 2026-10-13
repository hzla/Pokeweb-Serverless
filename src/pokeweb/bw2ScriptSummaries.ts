import vanillaCatalog from "../assets/data/white2ScriptSummaries.json";
import { sha256Hex } from "../nds/sha256";
import { compileBw2Script, bw2ScriptBytesEqual } from "./bw2ScriptCompiler";
import { parseBw2Script } from "./bw2ScriptCompiler/parser";
import type { ProjectState } from "./projectStore";
import type { Bw2ScriptSummaryCatalog, Bw2ScriptSummaryFile } from "./bw2ScriptSummaryTypes";
import { BW2_ROUTINE_FINGERPRINT_VERSION, bw2RoutineFingerprints } from "./bw2ScriptSummaryFingerprint";

export const WHITE2_SCRIPT_SUMMARIES = vanillaCatalog as unknown as Bw2ScriptSummaryCatalog;
/** A candidate establishes only game/file identity, never original bytes or
 * native overlay context. Each annotation must separately prove its match. */
export function bw2VanillaScriptSummaryCandidate(project: Pick<ProjectState, "session" | "romInfo">, fileId: number, catalog = WHITE2_SCRIPT_SUMMARIES): Bw2ScriptSummaryFile | undefined {
  if (![1, 2].includes(catalog.version) || catalog.archive !== "a/0/5/6" || project.session.baseRom !== "BW2" || project.session.generation === "gen4" || project.romInfo?.idCode !== catalog.gameCode || project.session.baseVersion !== "W2") return;
  return catalog.files[fileId];
}
/** Match the entire member, including its entry table, movements, raw data and padding.
 * Other ROM edits do not disqualify an unchanged member. File ID remains part of the key. */
export function matchBw2VanillaScriptSummary(project: Pick<ProjectState, "session" | "romInfo">, fileId: number, bytes: Uint8Array, catalog = WHITE2_SCRIPT_SUMMARIES): Bw2ScriptSummaryFile | undefined {
  const member = bw2VanillaScriptSummaryCandidate(project, fileId, catalog);
  return member && member.byteLength === bytes.length && member.sha256 === sha256Hex(bytes) ? member : undefined;
}
const commentLines = (text: string, indent: string): string[] => {
  const lines: string[] = []; let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > 92) { lines.push(`${indent}# ${line}`); line = ""; }
    line += (line ? " " : "") + word;
  }
  if (line) lines.push(`${indent}# ${line}`); return lines;
};

/** Insert summaries at physical block offsets, independent of generated symbol names.
 * Recompile the comments as an additional byte-identical check before returning them. */
export function annotateBw2VanillaScript(source: string, original: Uint8Array, member: Bw2ScriptSummaryFile, overlayId?: number): string {
  if (member.kind !== "field") return source;
  const wholeMember = member.byteLength === original.length && member.sha256 === sha256Hex(original);
  const variant = member.variants.find((v) => v.overlay === (overlayId ?? null));
  if (!variant) return source; // An explicit alternate overlay must not inherit another decoding's notes.
  if (!wholeMember && variant.fingerprintVersion !== BW2_ROUTINE_FINGERPRINT_VERSION) return source;
  const compiled = compileBw2Script(source);
  if (compiled.overlayId !== overlayId || !bw2ScriptBytesEqual(compiled.bytes, original)) throw new Error("Summary source does not match the verified script bytes.");
  const ast = parseBw2Script(source), insertions = new Map<number, string[]>();
  const fingerprints = wholeMember ? undefined : bw2RoutineFingerprints(compiled);
  for (const block of [...(compiled.codeBlocks ?? []), ...(compiled.movementBlocks ?? [])]) {
    const fingerprint = fingerprints?.get(block.offset);
    const candidates = wholeMember ? variant.routines.filter((r) => r.offset === block.offset && r.kind !== "undecoded")
      : fingerprint ? variant.routines.filter((r) => r.fingerprint === fingerprint && r.kind !== "undecoded") : [];
    // Identical code with different original explanations has no safe unique
    // identity after relocation. Never select by a coincidental old offset.
    const summary = candidates.length && candidates.every((r) => r.summary === candidates[0].summary) ? candidates[0] : undefined;
    if (!summary) continue;
    const definition = ast.definitions.find((d) => d.name === block.name) ?? ast.layout?.find((d) => d.kind === "movement" && d.name === block.name);
    if (definition) insertions.set(definition.line, commentLines(summary.summary, "  "));
  }
  for (const block of wholeMember ? compiled.dataBlocks ?? [] : []) {
    const summary = variant.routines.find((r) => r.offset === block.offset && r.kind === "undecoded");
    const definition = ast.layout?.find((d) => d.kind === "data" && d.name === block.name);
    if (summary && definition) insertions.set(definition.line - 1, commentLines(summary.summary, ""));
  }
  if (!insertions.size && !wholeMember) return source;
  const preamble = [wholeMember ? "# Vanilla White 2 notes: this file matched the original script bytes." : "# Vanilla White 2 notes: only matching routines and their local dependencies are annotated.",
    "# Notes infer purposes from original code/map data; revise them after edits.",
    "# Listed effects can depend on branches, and original map/text/helper context may change.",
    ...commentLines((wholeMember ? "" : "Original vanilla file: ") + member.description, ""), ""];
  const lines = source.split("\n"), annotated = [...preamble];
  for (let i = 0; i <= lines.length; i++) { annotated.push(...insertions.get(i) ?? []); if (i < lines.length) annotated.push(lines[i]); }
  const result = annotated.join("\n");
  if (!bw2ScriptBytesEqual(compileBw2Script(result).bytes, original)) throw new Error("Summary annotation changed the decompile/compile round trip.");
  return result;
}
