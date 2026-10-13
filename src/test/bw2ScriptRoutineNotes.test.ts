import { afterEach, describe, expect, it, vi } from "vitest";
import { compileBw2Script, decompileBw2Script } from "../pokeweb/bw2ScriptCompiler";
import { bw2RoutineFingerprints, BW2_ROUTINE_FINGERPRINT_VERSION } from "../pokeweb/bw2ScriptSummaryFingerprint";
import { sha256Hex } from "../nds/sha256";
import { annotateBw2VanillaScript, bw2VanillaScriptSummaryCandidate, matchBw2VanillaScriptSummary } from "../pokeweb/bw2ScriptSummaries";
import * as summaries from "../pokeweb/bw2ScriptSummaries";
import * as overlays from "../pokeweb/bw2ScriptOverlayContext";
import { decompileBw2ProjectScript, replaceBw2ProjectScript } from "../pokeweb/bw2ScriptModel";
import type { Bw2ScriptSummaryFile, Bw2ScriptSummaryCatalog } from "../pokeweb/bw2ScriptSummaryTypes";
import type { ProjectState } from "../pokeweb/projectStore";

const original = `preserve_layout
script :one, entry: 1 do
call :pause
apply_movement 1, :walk
halt
end
script :two, entry: 2 do
nop
halt
end
def pause
sleep 1
vm_return
end
movement :walk do
walk_up 2
end`;
function fixture(input = original) {
  const authored = compileBw2Script(input), source = decompileBw2Script(authored.bytes, { overlayId: authored.overlayId }).source;
  const compiled = compileBw2Script(source), fingerprints = bw2RoutineFingerprints(compiled);
  const routines = (compiled.codeBlocks ?? []).map((block) => {
    const entries = compiled.entries.filter((e) => e.offset === block.offset).map((e) => e.entry);
    const kind = entries.length ? "script" as const : compiled.helpers.some((h) => h.offset === block.offset) ? "helper" as const : "block" as const;
    const summary = entries.includes(1) ? "Original first interaction." : entries.includes(2) ? "Original second interaction." : `Original local routine ${block.name}.`;
    return { offset: block.offset, kind, entries, summary, confidence: "inferred" as const, fingerprint: fingerprints.get(block.offset)! };
  });
  const member: Bw2ScriptSummaryFile = { sha256: sha256Hex(compiled.bytes), byteLength: compiled.bytes.length, kind: "field", description: "Original fixture.", variants: [{ overlay: compiled.overlayId ?? null, editable: true, fingerprintVersion: BW2_ROUTINE_FINGERPRINT_VERSION, routines: [...routines,
    ...(compiled.movementBlocks ?? []).map((block) => ({ offset: block.offset, kind: "movement" as const, summary: "Original walking list.", confidence: "inferred" as const, fingerprint: fingerprints.get(block.offset)! }))] }] };
  const notes = (edited: string) => { const c = compileBw2Script(edited); return annotateBw2VanillaScript(edited, c.bytes, member, c.overlayId); };
  return { source, compiled, member, notes };
}

describe("routine-scoped vanilla summaries", () => {
  afterEach(() => vi.restoreAllMocks());
  it("retains unchanged relocated functions, helpers and movement lists after another routine grows", () => {
    const f = fixture(), edited = f.source.replace("script :script_2, entry: 2 do\n", "script :script_2, entry: 2 do\n  sleep 3\n"), annotated = f.notes(edited);
    expect(annotated).toContain("only matching routines and their local dependencies");
    expect(annotated).toContain("# Original first interaction."); expect(annotated).not.toContain("# Original second interaction.");
    expect(annotated).toContain("# Original local routine"); expect(annotated).toContain("# Original walking list.");
    expect(compileBw2Script(annotated).bytes).toEqual(compileBw2Script(edited).bytes);
    const before = bw2RoutineFingerprints(f.compiled), after = bw2RoutineFingerprints(compileBw2Script(edited));
    const helper = compileBw2Script(edited).helpers[0];
    expect(helper.offset).not.toBe(f.compiled.helpers[0].offset); expect(after.get(helper.offset)).toBe(before.get(f.compiled.helpers[0].offset));
  });
  it("drops callers' comments when an unchanged body calls a changed helper", () => {
    const f = fixture(), annotated = f.notes(f.source.replace("sleep 0x0001", "sleep 0x0002"));
    expect(annotated).not.toContain("# Original first interaction."); expect(annotated).not.toContain("# Original local routine");
    expect(annotated).toContain("# Original second interaction."); expect(annotated).toContain("# Original walking list.");
  });
  it("drops callers' comments when movement data changes and preserves independent helpers", () => {
    const f = fixture(), annotated = f.notes(f.source.replace("walk_up 2", "walk_up 3"));
    expect(annotated).not.toContain("# Original first interaction."); expect(annotated).not.toContain("# Original walking list.");
    expect(annotated).toContain("# Original second interaction."); expect(annotated).toContain("# Original local routine");
  });
  it("ignores symbol renaming and absolute entry offsets", () => {
    const f = fixture(), edited = f.source.replaceAll("script_2", "other_name").replace("script :other_name, entry: 2 do\n", "script :other_name, entry: 2 do\n  nop\n");
    const annotated = f.notes(edited.replaceAll(f.compiled.helpers[0].name, "new_helper_name"));
    expect(annotated).toContain("# Original first interaction."); expect(annotated).toContain("# Original local routine");
  });
  it("does not reuse a role-specific summary after entry IDs are swapped", () => {
    const f = fixture(), edited = f.source.replace("entry: 1", "entry: SWAP").replace("entry: 2", "entry: 1").replace("entry: SWAP", "entry: 2");
    const annotated = f.notes(edited);
    expect(annotated).not.toContain("# Original first interaction."); expect(annotated).not.toContain("# Original second interaction.");
    expect(annotated).toContain("# Original walking list.");
  });
  it("rejects a changed internal jump target even when pointer-stripped bytes are identical", () => {
    const source = `preserve_layout\nscript :main, entry: 1 do\njump :a\nlabel :a\nnop\nlabel :b\nhalt\nend`;
    const a = compileBw2Script(source), b = compileBw2Script(source.replace("jump :a", "jump :b"));
    expect(bw2RoutineFingerprints(a).get(6)).not.toBe(bw2RoutineFingerprints(b).get(6));
  });
  it("rejects redirection to a changed dependency with an equally sized body", () => {
    const source = `preserve_layout\nscript :main, entry: 1 do\njump :left\nend\nblock :left do\nwork_set_const 0x8020, 1\nhalt\nend\nblock :right do\nwork_set_const 0x8020, 2\nhalt\nend`;
    const a = compileBw2Script(source), b = compileBw2Script(source.replace("jump :left", "jump :right"));
    expect(a.bytes.length).toBe(b.bytes.length); expect(bw2RoutineFingerprints(a).get(6)).not.toBe(bw2RoutineFingerprints(b).get(6));
  });
  it("normalizes cyclic jumps without ignoring their edges", () => {
    const source = `preserve_layout\nscript :main, entry: 1 do\njump :loop\nend\nscript :other, entry: 2 do\nhalt\nend\nblock :loop do\nwork_set_const 0x8020, 7\njump :main\nend`;
    const a = compileBw2Script(source), b = compileBw2Script(source.replace("script :other, entry: 2 do\n", "script :other, entry: 2 do\nnop\n"));
    expect(bw2RoutineFingerprints(a).get(10)).toBe(bw2RoutineFingerprints(b).get(10));
  });
  it("does not guess between identical helpers with different original explanations", () => {
    const f = fixture(original.replace("call :pause", "call :pause\ncall :pause_again").replace("movement :walk", "def pause_again\nsleep 1\nvm_return\nend\nmovement :walk"));
    const helpers = f.member.variants[0].routines.filter((r) => r.kind === "helper");
    expect(helpers).toHaveLength(2); expect(helpers[0].fingerprint).toBe(helpers[1].fingerprint);
    const annotated = f.notes(f.source.replace("script :script_2, entry: 2 do\n", "script :script_2, entry: 2 do\n  nop\n"));
    expect(annotated).not.toContain("# Original local routine"); expect(annotated).toContain("# Original first interaction.");
  });
  it("preserves the exact-file gate separately from routine candidates and does not cross games/files", () => {
    const f = fixture(), catalog: Bw2ScriptSummaryCatalog = { version: 2, gameCode: "IRDO", sourceRomSha256: "fixture", archive: "a/0/5/6", files: { 12: f.member } };
    const identity = { session: { baseRom: "BW2", baseVersion: "W2" }, romInfo: { idCode: "IRDO" } } as ProjectState;
    const bytes = compileBw2Script(f.source.replace("nop", "sleep 2")).bytes;
    expect(matchBw2VanillaScriptSummary(identity, 12, bytes, catalog)).toBeUndefined(); expect(bw2VanillaScriptSummaryCandidate(identity, 12, catalog)).toBe(f.member);
    expect(bw2VanillaScriptSummaryCandidate(identity, 13, catalog)).toBeUndefined();
    expect(bw2VanillaScriptSummaryCandidate({ ...identity, romInfo: { ...identity.romInfo, idCode: "IRBO" } }, 12, catalog)).toBeUndefined();
  });
  it("does not attach partial notes from old or unsupported fingerprint formats", () => {
    const f = fixture(), edited = f.source.replace("nop", "sleep 2"), c = compileBw2Script(edited);
    for (const version of [undefined, 999]) {
      const member = structuredClone(f.member); member.variants[0].fingerprintVersion = version;
      expect(annotateBw2VanillaScript(edited, c.bytes, member)).toBe(edited);
    }
  });
  it("does not fingerprint an overlay helper reached with the wrong live table state", () => {
    const source = `preserve_layout\noverlay 58\nscript :one, entry: 1 do\njoin_avenue_store_start\ncall :shop\njoin_avenue_store_end\nhalt\nend\nscript :two, entry: 2 do\nhalt\nend\ndef shop\njoin_avenue_shop_menu 1, 2, 3, 0x8000, 0x8001, 0x8002, 0x8003, 0x8004\nvm_return\nend`;
    const valid = compileBw2Script(source), invalid = compileBw2Script(source.replace("join_avenue_store_start", "nop"));
    expect(bw2RoutineFingerprints(valid).has(valid.helpers[0].offset)).toBe(true);
    expect(bw2RoutineFingerprints(invalid).has(invalid.helpers[0].offset)).toBe(false);
  });
  it("keeps an unchanged routine's notes after apply and a fresh project decompile", () => {
    const f = fixture(), identity = { session: { baseRom: "BW2", baseVersion: "W2" }, romInfo: { idCode: "IRDO" } } as ProjectState;
    const catalog: Bw2ScriptSummaryCatalog = { version: 2, gameCode: "IRDO", sourceRomSha256: "fixture", archive: "a/0/5/6", files: { 12: f.member } };
    const match = summaries.matchBw2VanillaScriptSummary, candidate = summaries.bw2VanillaScriptSummaryCandidate;
    vi.spyOn(summaries, "matchBw2VanillaScriptSummary").mockImplementation((project, file, bytes) => match(project, file, bytes, catalog));
    vi.spyOn(summaries, "bw2VanillaScriptSummaryCandidate").mockImplementation((project, file) => candidate(project, file, catalog));
    vi.spyOn(overlays, "resolveBw2ScriptOverlay").mockReturnValue({ kind: "base", zones: [], description: "Verified base context" });
    const project = { ...identity, arm9: new Uint8Array(), overlays: {}, texts: { banks: {} }, formats: {}, trpokInfo: [], narcs: { scripts: { name: "scripts", fileId: 1, sourcePath: "fixture", fileCount: 13, rawFiles: Array.from({ length: 13 }, () => new Uint8Array()), records: new Map(), dirty: new Set() } } } as ProjectState;
    project.narcs.scripts!.rawFiles[12] = f.compiled.bytes;
    const imported = decompileBw2ProjectScript(project, 12), edited = imported.source.replace("script :script_2, entry: 2 do\n", "script :script_2, entry: 2 do\n  nop\n");
    const applied = replaceBw2ProjectScript(project, 12, edited), refreshed = decompileBw2ProjectScript(project, 12);
    expect(refreshed.source).toContain("# Original first interaction."); expect(refreshed.source).not.toContain("# Original second interaction.");
    expect(compileBw2Script(refreshed.source).bytes).toEqual(applied.bytes); expect([...project.narcs.scripts!.dirty]).toEqual([12]);
  });
});
