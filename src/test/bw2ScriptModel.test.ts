import { describe, expect, it } from "vitest";
import { compileBw2Script } from "../pokeweb/bw2ScriptCompiler";
import { compileBw2ProjectScript, decompileBw2ProjectScript, replaceBw2ProjectScript, saveBw2ScriptDraft } from "../pokeweb/bw2ScriptModel";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import type { ProjectState } from "../pokeweb/projectStore";
import { NARC } from "../nds/narc";

const SOURCE = "script :main, entry: 1 do\n  nop\nend\n";
const REPLACEMENT = "script :main, entry: 1 do\n  face_player\nend\n";

describe("BW2 authored project scripts", () => {
  it("imports verified source without changing ROM bytes, records, dirty state, or changelog", () => {
    const project = makeProject();
    const original = structuredClone(project.narcs);
    const result = decompileBw2ProjectScript(project, 0);
    expect(result.roundTripVerified).toBe(true);
    expect(project.narcs).toEqual(original);
    expect(project.actionChangelog).toBeUndefined();
    expect(project.bw2ScriptEditor!.drafts[0].imported!.baselineBytes).not.toBe(project.narcs.scripts!.rawFiles[0]);
    const persisted = structuredClone(project);
    expect(compileBw2ProjectScript(persisted, 0, result.source).roundTrip?.verified).toBe(true);
  });
  it("retains the original verification baseline across edits and successive applies", () => {
    const project = makeProject();
    const imported = decompileBw2ProjectScript(project, 0);
    const baseline = project.bw2ScriptEditor!.drafts[0].imported!.baselineBytes.slice();
    const edited = imported.source.replace("  nop", "  face_player\n  nop");
    saveBw2ScriptDraft(project, 0, edited);
    expect(replaceBw2ProjectScript(project, 0, edited).roundTrip?.verified).toBe(true);
    const editedAgain = edited.replace("  face_player", "  sleep 1");
    expect(replaceBw2ProjectScript(project, 0, editedAgain).roundTrip?.verified).toBe(true);
    expect(project.bw2ScriptEditor!.drafts[0].imported!.baselineBytes).toEqual(baseline);
    expect(project.bw2ScriptEditor!.drafts[0].imported!.expectedCurrentBytes).toEqual(project.narcs.scripts!.rawFiles[0]);
  });
  it.each(["stale", "bad baseline", "unknown edit"])("rejects %s before any project mutation", (kind) => {
    const project = makeProject();
    const imported = decompileBw2ProjectScript(project, 0);
    if (kind === "stale") project.narcs.scripts!.rawFiles[0] = compileBw2Script(REPLACEMENT).bytes;
    if (kind === "bad baseline") project.bw2ScriptEditor!.drafts[0].imported!.baselineSource = imported.source.replace("nop", "face_player");
    const edited = kind === "unknown edit" ? `${imported.source}\ndata :unknown, 1, 2\n` : imported.source.replace("  nop", "  face_player");
    const before = structuredClone(project);
    expect(() => replaceBw2ProjectScript(project, 0, edited)).toThrow(kind === "stale" ? /changed since import/ : kind === "bad baseline" ? /round trip failed/ : /cannot be safely verified/);
    expect(project).toEqual(before);
  });
  it("blocks edits to unsupported bytecode even if the new source uses only known commands", () => {
    const project = makeProject();
    project.narcs.scripts!.rawFiles[0] = Uint8Array.from([2, 0, 0, 0, 0x13, 0xfd, 0xff, 0xff]);
    const imported = decompileBw2ProjectScript(project, 0);
    expect(imported.editable).toBe(false);
    expect(compileBw2ProjectScript(project, 0, imported.source).roundTrip?.editable).toBe(false);
    const before = structuredClone(project);
    expect(() => replaceBw2ProjectScript(project, 0, REPLACEMENT)).toThrow(/read-only/);
    expect(project).toEqual(before);
  });
  it("requires reimport when an older draft preserves newly recovered jumps as raw bytes", () => {
    const project = makeProject();
    const legacy = "preserve_layout\nscript :main, entry: 1 do\nhalt\nend\ndata :old_raw_code, 9, 2, 8, 0, 3, 0, 30, 0, 242, 255, 255, 255\n";
    const bytes = compileBw2Script(legacy).bytes;
    project.narcs.scripts!.rawFiles[0] = bytes;
    project.bw2ScriptEditor = { drafts: { 0: { source: legacy, appliedSource: legacy, imported: { baselineSource: legacy, baselineBytes: bytes.slice(), expectedCurrentBytes: bytes.slice() } } } };
    // The unrelocated raw jump still lands on an instruction after this edit;
    // byte identity and valid boundaries cannot prove the intended destination.
    const edited = legacy.replace("halt", "sleep 1\nhalt"), before = structuredClone(project);
    expect(() => replaceBw2ProjectScript(project, 0, edited)).toThrow(/raw bytes.*Decompile from ROM again/);
    expect(project).toEqual(before);
    const refreshed = decompileBw2ProjectScript(project, 0), fixed = refreshed.source.replace("  halt", "  sleep 1\n  halt");
    expect(refreshed.editable).toBe(true);
    expect(replaceBw2ProjectScript(project, 0, fixed).roundTrip?.verified).toBe(true);
  });
  it("requires a verified ROM import for layout source and rejects changed overlay context", () => {
    const project = makeProject();
    const raw = "preserve_layout\nscript :main, entry: 1 do\nhalt\nend";
    expect(() => replaceBw2ProjectScript(project, 0, raw)).toThrow(/Decompile from ROM first/);
    const imported = decompileBw2ProjectScript(project, 0, { overlayId: 51 });
    expect(() => replaceBw2ProjectScript(project, 0, imported.source.replace("overlay 51", "overlay 50"))).toThrow(/overlay changed/);
    expect(() => decompileBw2ProjectScript(project, 0, { overlayId: 999 })).toThrow(/Unsupported/);
  });
  it("previews compilation without changing source, bytecode, dirty state, or changelog", () => {
    const project = makeProject();
    const before = structuredClone(project);
    expect(compileBw2ProjectScript(project, 0, REPLACEMENT).bytes).toEqual(compileBw2Script(REPLACEMENT).bytes);
    expect(project).toEqual(before);
  });

  it("retains separate drafts through structured cloning without dirtying ROM bytes", () => {
    const project = makeProject();
    project.narcs.scripts!.rawFiles.push(compileBw2Script(SOURCE).bytes);
    saveBw2ScriptDraft(project, 0, "invalid draft");
    saveBw2ScriptDraft(project, 1, REPLACEMENT);
    const persisted = structuredClone(project);
    expect(persisted.bw2ScriptEditor).toEqual({ selectedFileId: 1, drafts: { 0: { source: "invalid draft", appliedSource: undefined }, 1: { source: REPLACEMENT, appliedSource: undefined } } });
    expect(project.narcs.scripts!.dirty.size).toBe(0);
    expect(project.actionChangelog).toBeUndefined();
    expect(project.narcs.scripts!.rawFiles[0]).toEqual(compileBw2Script(SOURCE).bytes);
  });

  it("keeps the last applied source when a new draft is edited", () => {
    const project = makeProject();
    replaceBw2ProjectScript(project, 0, REPLACEMENT);
    expect(project.bw2ScriptEditor!.drafts[0].appliedSource).toBe(REPLACEMENT);
    saveBw2ScriptDraft(project, 0, "unfinished new draft");
    expect(project.bw2ScriptEditor!.drafts[0]).toEqual({ source: "unfinished new draft", appliedSource: REPLACEMENT });
    expect(project.narcs.scripts!.rawFiles[0]).toEqual(compileBw2Script(REPLACEMENT).bytes);
  });

  it("replaces a complete member, invalidates cached records, and survives materialization and NARC serialization", () => {
    const project = makeProject();
    const scripts = project.narcs.scripts!;
    const original = scripts.rawFiles[0];
    const result = replaceBw2ProjectScript(project, 0, REPLACEMENT);
    expect(scripts.rawFiles[0]).toEqual(result.bytes);
    expect(scripts.rawFiles[0]).not.toBe(result.bytes);
    expect(original).toEqual(compileBw2Script(SOURCE).bytes);
    expect(scripts.records.has(0)).toBe(false);
    expect([...scripts.dirty]).toEqual([0]);
    expect(project.actionChangelog?.entries.at(-1)?.domain).toBe("scripts");
    materializeProjectEdits(project);
    const narc = new NARC();
    narc.files = scripts.rawFiles;
    expect(new NARC(narc.save()).files[0]).toEqual(result.bytes);
  });

  it.each([
    ["invalid syntax", /Expected/],
    ["script :one, entry: 1 do\nend\nscript :two, entry: 2 do\nend", /preserve all 1 entry/],
    ["script :one, entry: 2 do\nend", /contiguous/],
  ])("leaves the project untouched on failure: %s", (source, message) => {
    const project = makeProject();
    const before = structuredClone(project);
    expect(() => replaceBw2ProjectScript(project, 0, source)).toThrow(message);
    expect(project).toEqual(before);
  });

  it("rejects BW1 and Gen 4 projects before mutation", () => {
    for (const kind of ["BW", "gen4"] as const) {
      const project = makeProject();
      if (kind === "BW") project.session.baseRom = "BW";
      else project.session.generation = "gen4";
      const original = structuredClone(project);
      expect(() => replaceBw2ProjectScript(project, 0, REPLACEMENT)).toThrow(/BW2 projects only/);
      expect(project).toEqual(original);
    }
  });

  it.each([-1, 1, 0.5, NaN])("rejects invalid member ID %s", (id) => {
    expect(() => replaceBw2ProjectScript(makeProject(), id, REPLACEMENT)).toThrow(/existing script NARC/);
  });

  it("rejects missing or unrecognized script archives", () => {
    const missing = makeProject();
    delete missing.narcs.scripts;
    expect(() => replaceBw2ProjectScript(missing, 0, REPLACEMENT)).toThrow(/existing script NARC/);
    const invalid = makeProject();
    invalid.narcs.scripts!.rawFiles[0] = new Uint8Array([0, 0]);
    expect(() => replaceBw2ProjectScript(invalid, 0, REPLACEMENT)).toThrow(/unrecognized entry table/);
  });
});

function makeProject(): ProjectState {
  const bytes = compileBw2Script(SOURCE).bytes;
  return {
    session: { romName: "test", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 1 },
    arm9: new Uint8Array(), overlays: {},
    narcs: {
      scripts: { name: "scripts", fileId: 1, sourcePath: "test", container: "narc", fileCount: 1, rawFiles: [bytes], records: new Map([[0, { id: 0, bytes }]]), dirty: new Set() },
    },
    texts: { banks: {} }, formats: {}, trpokInfo: [],
  };
}
