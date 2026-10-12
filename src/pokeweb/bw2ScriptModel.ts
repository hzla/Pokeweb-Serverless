import { recordGenericChange } from "./actionChangelog";
import { compileBw2Script, decompileBw2Script, bw2ScriptBytesEqual, type CompiledBw2Script, type DecompiledBw2Script } from "./bw2ScriptCompiler";
import { gen5ScriptEntries } from "./gen5ScriptCommands";
import { markDirty, type ProjectState } from "./projectStore";

export type Bw2ScriptEditorState = {
  selectedFileId?: number;
  drafts: Record<number, { source: string; appliedSource?: string; imported?: {
    baselineSource: string;
    baselineBytes: Uint8Array;
    expectedCurrentBytes: Uint8Array;
    overlayId?: number;
  } }>;
};

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
  const result = decompileBw2Script(original, options);
  if (result.source.length > 1_000_000) throw new Error("Decompiled source exceeds the one-million-character limit.");
  const state = project.bw2ScriptEditor ??= { drafts: {} };
  state.selectedFileId = fileId;
  state.drafts[fileId] = { source: result.source, appliedSource: result.source, imported: {
    baselineSource: result.source, baselineBytes: original.slice(), expectedCurrentBytes: original.slice(), overlayId: options.overlayId,
  } };
  return result;
}

/** Read-only compile preview with the same validation used by apply. */
export function compileBw2ProjectScript(project: ProjectState, fileId: number, source: string): CompiledBw2Script {
  const original = scriptMember(project, fileId);
  const originalEntries = gen5ScriptEntries(original);
  if (!originalEntries.length) throw new Error("The original script member has an unrecognized entry table.");
  const result = compileBw2Script(source);
  if (result.entries.length !== originalEntries.length) throw new Error(`Replacement must preserve all ${originalEntries.length} entry slots; source defines ${result.entries.length}.`);
  const imported = project.bw2ScriptEditor?.drafts[fileId]?.imported;
  if (result.preserveLayout && !imported) throw new Error("Decompile from ROM first to verify imported layout before applying edits.");
  if (imported) {
    if (!bw2ScriptBytesEqual(original, imported.expectedCurrentBytes)) throw new Error("Script bytes changed since import. Decompile from ROM again before applying edits.");
    if (!bw2ScriptBytesEqual(compileBw2Script(imported.baselineSource).bytes, imported.baselineBytes)) throw new Error("Original decompile/compile round trip failed. Decompile from ROM again.");
    const baseline = decompileBw2Script(imported.baselineBytes, { overlayId: imported.overlayId });
    const changed = !bw2ScriptBytesEqual(result.bytes, original);
    if (result.overlayId !== imported.overlayId) throw new Error("Command overlay changed. Select the matching overlay and Decompile from ROM again.");
    if (changed && !baseline.editable) throw new Error(`Imported script is read-only: ${baseline.warnings.join(" ")}`);
    if (changed) {
      const proposed = decompileBw2Script(result.bytes, { overlayId: imported.overlayId });
      if (!proposed.editable) throw new Error(`Edited bytecode cannot be safely verified: ${proposed.warnings.join(" ")}`);
    }
    result.roundTrip = { verified: true, editable: baseline.editable, warnings: baseline.warnings };
  }
  return result;
}

/**
 * Replace a complete existing BW2 script NARC member with authored source.
 * Compilation and entry-count validation finish before any project mutation.
 * Imported originals are reverified before any bytes, cache, or dirty state change.
 */
export function replaceBw2ProjectScript(project: ProjectState, fileId: number, source: string): CompiledBw2Script {
  const result = compileBw2ProjectScript(project, fileId, source);
  const scripts = project.narcs.scripts!;
  scripts.rawFiles[fileId] = result.bytes.slice();
  scripts.records.delete(fileId);
  markDirty(project, "scripts", fileId);
  recordGenericChange(project, "scripts", `Compiled Ruby-like BW2 script file ${fileId} (${result.entries.length} entries).`, "Field Scripts", { key: `bw2-script-source:${fileId}` });
  saveBw2ScriptDraft(project, fileId, source);
  project.bw2ScriptEditor!.drafts[fileId].appliedSource = source;
  const imported = project.bw2ScriptEditor!.drafts[fileId].imported;
  if (imported) imported.expectedCurrentBytes = result.bytes.slice();
  return result;
}
