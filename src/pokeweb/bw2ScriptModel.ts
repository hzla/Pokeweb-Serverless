import { recordGenericChange } from "./actionChangelog";
import { compileBw2Script, decompileBw2Script, bw2ScriptBytesEqual, type CompiledBw2Script, type DecompiledBw2Script } from "./bw2ScriptCompiler";
import { gen5ScriptEntries } from "./gen5ScriptCommands";
import { markDirty, type ProjectState } from "./projectStore";
import { resolveBw2ScriptOverlay } from "./bw2ScriptOverlayContext";
import { readU16 } from "../nds/binary";
import { annotateBw2VanillaScript, matchBw2VanillaScriptSummary, bw2VanillaScriptSummaryCandidate } from "./bw2ScriptSummaries";
import { planBw2ScriptEntryReferences, verifyBw2EmbeddedEntryReferences } from "./bw2ScriptEntryReferences";

/** Source and its verification baseline are user work, including unapplied drafts. */
export type Bw2ScriptDraft = { source: string; appliedSource?: string; entryMapping?: number[]; entryMappingSignature?: string; imported?: {
    baselineSource: string;
    baselineBytes: Uint8Array;
    expectedCurrentBytes: Uint8Array;
    overlayId?: number;
    overlayContext?: "map" | "shared";
  } };

export type Bw2ScriptEditorState = {
  selectedFileId?: number;
  drafts: Record<number, Bw2ScriptDraft>;
};

export type Bw2ScriptApplyOptions = { entryMapping?: number[] };
export const bw2EntryTableSignature = (compiled: CompiledBw2Script): string => JSON.stringify(compiled.entries.map(({ name, entry }) => [name, entry]));
const decodeHints = (compiled: CompiledBw2Script) => ({ codeOffsets: compiled.codeBlocks?.map((block) => block.offset), codeRanges: compiled.codeBlocks, dispatchHints: compiled.instructions.filter((instruction) => instruction.dispatchId !== undefined).map((instruction) => ({ offset: instruction.offset, dispatchId: instruction.dispatchId! })), movementOffsets: compiled.movementBlocks?.map((block) => block.offset) });
/** Byte identity alone cannot make a raw jump relocatable. Older imports must
 * represent newly recovered pointers symbolically before any bytes can move. */
function verifyDecodedRelocations(compiled: CompiledBw2Script, decoded: DecompiledBw2Script): void {
  const key = (r: CompiledBw2Script["relocations"][number]) => `${r.operandOffset}:${r.kind}:${r.targetOffset}`;
  const represented = new Set(compiled.relocations.map(key));
  if (compileBw2Script(decoded.source).relocations.some((r) => !represented.has(key(r)))) throw new Error("Decoded code contains offsets stored as raw bytes. Decompile from ROM again to recover symbolic pointers before editing.");
}
const recognized = (bytes: Uint8Array) => gen5ScriptEntries(bytes).length > 0 || bytes.length >= 2 && readU16(bytes, 0) === 0xfd13;

function scriptMember(project: ProjectState, fileId: number): Uint8Array {
  if (project.session.baseRom !== "BW2" || project.session.generation === "gen4") throw new Error("Ruby-like field scripts currently support BW2 projects only.");
  const scripts = project.narcs.scripts;
  if (!scripts || !Number.isInteger(fileId) || fileId < 0 || fileId >= scripts.rawFiles.length) throw new Error("Select an existing script NARC member.");
  return scripts.rawFiles[fileId];
}

/** Persist source without changing the script bytecode or ROM dirty state. */
export function saveBw2ScriptDraft(project: ProjectState, fileId: number, source: string): void {
  scriptMember(project, fileId);
  if (source.length > 1_000_000) throw new Error("Source exceeds the one-million-character limit.");
  const state = project.bw2ScriptEditor ??= { drafts: {} };
  const previous = state.drafts[fileId];
  state.selectedFileId = fileId;
  state.drafts[fileId] = { ...previous, source, appliedSource: previous?.appliedSource };
}

/** Import current project bytecode only after a byte-identical round trip succeeds. */
export function decompileBw2ProjectScript(project: ProjectState, fileId: number, options: { overlayId?: number } = {}): DecompiledBw2Script {
  const original = scriptMember(project, fileId);
  const vanilla = matchBw2VanillaScriptSummary(project, fileId, original);
  let overlayId = options.overlayId;
  let overlayContext: "map" | "shared" | undefined;
  if (!Object.hasOwn(options, "overlayId")) {
    const context = resolveBw2ScriptOverlay(project, fileId);
    if (context.kind === "ambiguous") throw new Error(context.description);
    overlayId = context.overlayId;
    if (context.kind === "detected" || context.kind === "base") overlayContext = "map";
    // A verified original shared member can supply its native command context.
    // Keep the imported context through our own edits, while current bytes still match.
    if (context.unassigned) {
      if (vanilla?.variants.length === 1) { overlayId = vanilla.variants[0].overlay ?? undefined; overlayContext = "shared"; }
      else {
        const imported = project.bw2ScriptEditor?.drafts[fileId]?.imported;
        if (imported && imported.overlayContext === "shared" && bw2ScriptBytesEqual(original, imported.expectedCurrentBytes)) { overlayId = imported.overlayId; overlayContext = "shared"; }
      }
    }
  }
  let hints: Partial<ReturnType<typeof decodeHints>> = {};
  const previous = project.bw2ScriptEditor?.drafts[fileId]?.appliedSource;
  if (previous) {
    try { const compiled = compileBw2Script(previous); if (compiled.overlayId === overlayId && bw2ScriptBytesEqual(compiled.bytes, original)) hints = decodeHints(compiled); } catch { /* A stale source does not supply decoding hints. */ }
  }
  const result = decompileBw2Script(original, { overlayId, ...hints });
  const notes = vanilla ?? bw2VanillaScriptSummaryCandidate(project, fileId);
  if (notes) result.source = annotateBw2VanillaScript(result.source, original, notes, overlayId);
  if (result.source.length > 1_000_000) throw new Error("Decompiled source exceeds the one-million-character limit.");
  const state = project.bw2ScriptEditor ??= { drafts: {} };
  state.selectedFileId = fileId;
  state.drafts[fileId] = { source: result.source, appliedSource: result.source, imported: {
    baselineSource: result.source, baselineBytes: Uint8Array.from(original), expectedCurrentBytes: Uint8Array.from(original), overlayId, overlayContext,
  } };
  return result;
}

/** Read-only compile preview with the same validation used by apply. */
export function compileBw2ProjectScript(project: ProjectState, fileId: number, source: string, options: Bw2ScriptApplyOptions = {}): CompiledBw2Script {
  const original = scriptMember(project, fileId);
  const originalEntries = gen5ScriptEntries(original);
  if (!recognized(original)) throw new Error("The original script member has an unrecognized entry table.");
  const result = compileBw2Script(source);
  if (result.entries.length > 9999) throw new Error("Local entry IDs must stay below 10000, where global-script IDs begin.");
  const imported = project.bw2ScriptEditor?.drafts[fileId]?.imported;
  if (result.entries.length !== originalEntries.length && !imported) throw new Error(`Decompile from ROM before changing entries; replacement must preserve all ${originalEntries.length} entry slots until the original is verified.`);
  if (result.preserveLayout && !imported) throw new Error("Decompile from ROM first to verify imported layout before applying edits.");
  if (imported) {
    if (imported.overlayContext === "map") {
      const context = resolveBw2ScriptOverlay(project, fileId);
      if ((context.kind !== "detected" && context.kind !== "base") || context.overlayId !== imported.overlayId) throw new Error("Map command overlay changed or cannot be verified. Decompile from ROM again before applying edits.");
    }
    if (imported.overlayContext === "shared" && !resolveBw2ScriptOverlay(project, fileId).unassigned) throw new Error("Shared script map context changed or cannot be verified. Decompile from ROM again before applying edits.");
    if (!bw2ScriptBytesEqual(original, imported.expectedCurrentBytes)) throw new Error("Script bytes changed since import. Decompile from ROM again before applying edits.");
    const originalSource = compileBw2Script(imported.baselineSource);
    if (!bw2ScriptBytesEqual(originalSource.bytes, imported.baselineBytes)) throw new Error("Original decompile/compile round trip failed. Decompile from ROM again.");
    const baseline = decompileBw2Script(imported.baselineBytes, { overlayId: imported.overlayId, ...decodeHints(originalSource) });
    const changed = !bw2ScriptBytesEqual(result.bytes, original);
    if (result.overlayId !== imported.overlayId) throw new Error("Command overlay changed. Select the matching overlay and Decompile from ROM again.");
    if (changed && !baseline.editable) throw new Error(`Imported script is read-only: ${baseline.warnings.join(" ")}`);
    if (changed) {
      verifyDecodedRelocations(originalSource, baseline);
      const proposed = decompileBw2Script(result.bytes, { overlayId: imported.overlayId, ...decodeHints(result) });
      if (!proposed.editable) throw new Error(`Edited bytecode cannot be safely verified: ${proposed.warnings.join(" ")}`);
      verifyDecodedRelocations(result, proposed);
    }
    result.roundTrip = { verified: true, editable: baseline.editable, warnings: baseline.warnings };
    const draft = project.bw2ScriptEditor!.drafts[fileId], current = compileBw2Script(draft.appliedSource ?? imported.baselineSource);
    if (!bw2ScriptBytesEqual(current.bytes, original)) throw new Error("Applied source no longer matches the current script bytes. Decompile from ROM again.");
    const explicit = options.entryMapping ?? (draft.entryMappingSignature === bw2EntryTableSignature(result) ? draft.entryMapping : undefined);
    const mapping = explicit ?? current.entries.map((old) => {
      if (result.entries.length === current.entries.length) return old.entry;
      const matches = result.entries.filter((entry) => entry.name === old.name);
      if (matches.length > 1 && result.entries.length !== current.entries.length) throw new Error("Shared entry aliases need an explicit mapping. Use the entry controls to remove a slot.");
      return matches.find((entry) => entry.entry === old.entry)?.entry ?? matches[0]?.entry ?? (result.entries.length >= current.entries.length ? old.entry : 0);
    });
    if (mapping.length !== current.entries.length || mapping.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > result.entries.length)) throw new Error("Entry mapping does not match the old and new entry tables.");
    if (current.entries.length !== result.entries.length || mapping.some((entry, index) => entry !== index + 1)) {
      verifyBw2EmbeddedEntryReferences(result, mapping);
      const plan = planBw2ScriptEntryReferences(project, fileId, mapping);
      result.entryChanges = { oldCount: current.entries.length, newCount: result.entries.length, mapping: [...mapping], references: plan.references };
    }
  }
  return result;
}

/**
 * Replace a complete existing BW2 script NARC member with authored source.
 * Compilation and entry-count validation finish before any project mutation.
 * Imported originals are reverified before any bytes, cache, or dirty state change.
 */
export function replaceBw2ProjectScript(project: ProjectState, fileId: number, source: string, options: Bw2ScriptApplyOptions = {}): CompiledBw2Script {
  const result = compileBw2ProjectScript(project, fileId, source, options);
  const references = result.entryChanges ? planBw2ScriptEntryReferences(project, fileId, result.entryChanges.mapping) : undefined;
  const scripts = project.narcs.scripts!;
  scripts.rawFiles[fileId] = result.bytes.slice();
  scripts.records.delete(fileId);
  markDirty(project, "scripts", fileId);
  for (const patch of references?.patches ?? []) {
    const store = project.narcs[patch.archive]!; store.rawFiles[patch.id] = patch.bytes; store.records.delete(patch.id); markDirty(project, patch.archive, patch.id);
    if (patch.archive === "scripts" && project.bw2ScriptEditor?.drafts[patch.id]) delete project.bw2ScriptEditor.drafts[patch.id];
  }
  recordGenericChange(project, "scripts", `Compiled Ruby-like BW2 script file ${fileId} (${result.entries.length} entries).`, "Field Scripts", { key: `bw2-script-source:${fileId}` });
  saveBw2ScriptDraft(project, fileId, source);
  project.bw2ScriptEditor!.drafts[fileId].appliedSource = source;
  delete project.bw2ScriptEditor!.drafts[fileId].entryMapping;
  delete project.bw2ScriptEditor!.drafts[fileId].entryMappingSignature;
  const imported = project.bw2ScriptEditor!.drafts[fileId].imported;
  if (imported) imported.expectedCurrentBytes = result.bytes.slice();
  return result;
}
