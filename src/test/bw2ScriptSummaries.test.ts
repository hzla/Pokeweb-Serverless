import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../nds/sha256";
import { compileBw2Script, decompileBw2Script } from "../pokeweb/bw2ScriptCompiler";
import * as summaryModule from "../pokeweb/bw2ScriptSummaries";
import * as overlayModule from "../pokeweb/bw2ScriptOverlayContext";
import { decompileBw2ProjectScript, compileBw2ProjectScript, replaceBw2ProjectScript } from "../pokeweb/bw2ScriptModel";
import { annotateBw2VanillaScript, matchBw2VanillaScriptSummary, WHITE2_SCRIPT_SUMMARIES } from "../pokeweb/bw2ScriptSummaries";
import type { Bw2ScriptSummaryCatalog, Bw2ScriptSummaryFile } from "../pokeweb/bw2ScriptSummaryTypes";
import type { ProjectState } from "../pokeweb/projectStore";
import { splitBw2ScriptSource, joinBw2ScriptSource } from "../pokeweb/bw2ScriptSourceParts";
import { buildBw2ScriptSourceContext } from "../pokeweb/bw2ScriptContextModel";
import { routineSummary, reachableSummaryCommands, movementSummary, type SummaryRoutine, type SummaryContext } from "../../scripts/lib/bw2ScriptSummaryAnalysis";

const identity = { session: { baseRom: "BW2", baseVersion: "W2" }, romInfo: { idCode: "IRDO" } } as ProjectState;
function fixture() {
  const bytes = compileBw2Script("preserve_layout\nscript :one, entry: 1 do\ncall :helper\napply_movement 1, :walk\nhalt\nend\ndef helper\nsleep 1\nvm_return\nend\nmovement :walk do\nwalk_up 2\nend\n").bytes;
  const source = decompileBw2Script(bytes).source, compiled = compileBw2Script(source);
  const member: Bw2ScriptSummaryFile = { sha256: sha256Hex(bytes), byteLength: bytes.length, kind: "field", description: "Original test map.", variants: [{ overlay: null, editable: true, routines: [
    { offset: compiled.entries[0].offset, kind: "script", entries: [1], summary: "Move the actor after calling a helper.", confidence: "inferred" },
    { offset: compiled.helpers[0].offset, kind: "helper", summary: "Pause for a frame and return to the caller.", confidence: "inferred" },
    { offset: compiled.movementBlocks![0].offset, kind: "movement", summary: "Walk upward using this action's repeat parameter.", confidence: "inferred" },
  ] }] };
  const catalog: Bw2ScriptSummaryCatalog = { version: 1, gameCode: "IRDO", archive: "a/0/5/6", sourceRomSha256: "unused-at-runtime", files: { 12: member } };
  return { bytes, source, member, catalog };
}
describe("SHA-256 member fingerprints", () => {
  it.each([0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 257, 8193])("matches Node crypto for %i bytes, including offset views", (length) => {
    const backing = Uint8Array.from({ length: length + 12 }, (_, i) => (i * 93 + 17) & 255), before = backing.slice(), bytes = backing.subarray(7, 7 + length);
    expect(sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex")); expect(backing).toEqual(before);
  });
  it("matches the published empty and abc vectors", () => {
    expect(sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
describe("vanilla routine comments", () => {
  it("matches member ID and exact bytes without requiring the whole ROM to be vanilla", () => {
    const f = fixture(); expect(matchBw2VanillaScriptSummary(identity, 12, f.bytes, f.catalog)).toBe(f.member);
    expect(matchBw2VanillaScriptSummary(identity, 13, f.bytes, f.catalog)).toBeUndefined();
    for (const at of [0, 6, f.bytes.length - 1]) {
      const modified = f.bytes.slice(); modified[at] ^= 1;
      expect(matchBw2VanillaScriptSummary(identity, 12, modified, f.catalog)).toBeUndefined();
    }
    expect(matchBw2VanillaScriptSummary(identity, 12, Uint8Array.from([...f.bytes, 0]), f.catalog)).toBeUndefined();
  });
  it.each(["IRBO", "IRDJ", "IRDI", "TEST"])("does not apply US White 2 notes to %s", (idCode) => {
    const f = fixture(); expect(matchBw2VanillaScriptSummary({ ...identity, romInfo: { ...identity.romInfo, idCode } }, 12, f.bytes, f.catalog)).toBeUndefined();
  });
  it("requires the White 2 BW2 project identity", () => {
    const f = fixture();
    for (const session of [{ ...identity.session, baseRom: "BW" as const }, { ...identity.session, baseVersion: "B2" as const }, { ...identity.session, generation: "gen4" as const }]) expect(matchBw2VanillaScriptSummary({ ...identity, session }, 12, f.bytes, f.catalog)).toBeUndefined();
  });
  it("attaches notes by offsets, preserves context positions and keeps movements in Definitions", () => {
    const f = fixture(), source = annotateBw2VanillaScript(f.source, f.bytes, f.member);
    expect(source).toContain("  # Move the actor after calling a helper.");
    expect(source).toContain("  # Pause for a frame and return to the caller.");
    expect(compileBw2Script(source).bytes).toEqual(f.bytes);
    const parts = splitBw2ScriptSource(source); expect(parts.script).toContain("# Move the actor"); expect(parts.definitions).toContain("# Walk upward");
    expect(joinBw2ScriptSource(parts)).toBe(source);
    const context = buildBw2ScriptSourceContext(source);
    const line = source.split("\n").findIndex((s) => s.includes("# Move the actor")) + 1;
    expect(context.focusAt(line)).toMatchObject({ name: "script_1", entries: [1] });
    const renamed = f.source.replaceAll("script_1", "new_name"); expect(annotateBw2VanillaScript(renamed, f.bytes, f.member)).toContain("# Move the actor");
  });
  it("preserves unsupported entries as raw data and leaves their edits read-only", () => {
    const bytes = Uint8Array.from([2, 0, 0, 0, 0x13, 0xfd, 0xff, 0xff, 1, 2, 3]);
    const original = decompileBw2Script(bytes), member: Bw2ScriptSummaryFile = { sha256: sha256Hex(bytes), byteLength: bytes.length, kind: "field", description: "Partial file.", variants: [{ overlay: null, editable: false, routines: [{ offset: 6, kind: "undecoded", entries: [1], confidence: "partial", summary: "Unknown entry: bytes are preserved." }] }] };
    const source = annotateBw2VanillaScript(original.source, bytes, member);
    expect(source).toContain("# Unknown entry: bytes are preserved."); expect(compileBw2Script(source).bytes).toEqual(bytes);
    expect(decompileBw2Script(compileBw2Script(source).bytes).editable).toBe(false);
  });
  it("skips stale hashes and alternate-overlay summaries and rejects nonmatching source", () => {
    const f = fixture(); expect(annotateBw2VanillaScript(f.source, f.bytes, { ...f.member, sha256: "bad" })).toBe(f.source);
    expect(annotateBw2VanillaScript(f.source, f.bytes, f.member, 66)).toBe(f.source);
    expect(() => annotateBw2VanillaScript(f.source.replace("sleep 0x0001", "sleep 0x0002"), f.bytes, f.member)).toThrow(/does not match/);
  });
  it("covers every native archive member and records decoding limitations", () => {
    const files = Object.values(WHITE2_SCRIPT_SUMMARIES.files);
    expect(files).toHaveLength(1289); expect(files.filter((f) => f.kind === "field")).toHaveLength(673); expect(files.filter((f) => f.kind === "activation-table")).toHaveLength(615);
    expect(WHITE2_SCRIPT_SUMMARIES.files[1241].kind).toBe("unrecognized");
    const routines = files.flatMap((f) => f.variants.flatMap((v) => v.routines));
    expect(routines.filter((r) => r.kind !== "movement" && r.kind !== "undecoded")).toHaveLength(4955);
    expect(routines.filter((r) => r.kind === "movement")).toHaveLength(3237); expect(routines.filter((r) => r.kind === "undecoded")).toHaveLength(0);
    expect(files.filter((file) => file.kind === "field").every((file) => file.variants.every((variant) => variant.editable))).toBe(true);
    expect(files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    expect(WHITE2_SCRIPT_SUMMARIES.version).toBe(2);
    expect(routines.every((r) => /^[0-9a-f]{64}$/.test(r.fingerprint ?? ""))).toBe(true);
    expect(WHITE2_SCRIPT_SUMMARIES.files[854].variants[0].routines.find((r) => r.entries?.includes(23))?.summary).toContain("TM27 (Return)");
  });
});
describe("native summary analysis", () => {
  const command = (offset: number, opcode: number, name: string, operands: number[] = [], targets: { kind: string; to: number }[] = []) => ({ offset, next: offset + 2, opcode, name, operands, targets });
  const context = (routines: SummaryRoutine[]): SummaryContext => ({ file: 1, routines, roles: [{ entry: 1, zone: 3, when: "During map setup" }], maps: [{ zone: 3, name: "Test Town", script: 1, auxiliary: 2, bank: 4, events: 0, matrix: 0, overlay: null }], banks: [4], texts: new Map(), items: new Map(), shared: [] });
  it("follows local helpers, avoids cycles and excludes code behind an unconditional jump", () => {
    const routines: SummaryRoutine[] = [{ name: "main", kind: "script", offset: 6, end: 16, entries: [1], commands: [command(6, 4, "vm_call", [], [{ kind: "call", to: 20 }]), command(8, 0x1e, "vm_jump", [], [{ kind: "jump", to: 14 }]), command(10, 0x1c, "rt_call_global", [10536]), command(14, 2, "halt")] }, { name: "helper", kind: "helper", offset: 20, end: 24, entries: [], commands: [command(20, 0x6d, "actor_set_g_pos", [1, 2, 0, 3, 0]), command(22, 5, "vm_return")] }];
    const summary = routineSummary(routines[0], context(routines));
    expect(summary.summary).toContain("During map setup in Test Town"); expect(summary.summary).toContain("positions and facing"); expect(summary.summary).not.toContain("stop a following");
    routines[1].commands[1] = command(22, 0x1e, "vm_jump", [], [{ kind: "jump", to: 20 }]);
    expect(reachableSummaryCommands(routines[0], routines).commands.map((c) => c.offset)).toEqual([6, 20, 22]);
  });
  it("explicitly limits summaries that reach unknown bytes", () => {
    const routines: SummaryRoutine[] = [{ name: "main", kind: "script", offset: 6, end: 8, entries: [1], commands: [command(6, 0x6d, "actor_set_g_pos", [1, 2, 0, 3, 0])] }];
    const summary = routineSummary(routines[0], context(routines)); expect(summary.confidence).toBe("partial"); expect(summary.summary).toContain("undecoded bytes");
  });
  it("describes detached zero-store fragments without inventing a live undecoded path", () => {
    const routines: SummaryRoutine[] = [{ name: "fragment", kind: "block", offset: 6, end: 12, entries: [], commands: [{ ...command(6, 0x28, "work_set_const", [0x8020, 0]), next: 12 }] }];
    const summary = routineSummary(routines[0], context(routines));
    expect(summary.summary).toContain("Detached work-initialization fragment"); expect(summary.summary).toContain("runtime use is not established");
    expect(summary.summary).not.toContain("undecoded bytes"); expect(summary.confidence).toBe("partial");
  });
  it("uses named command effects instead of claiming no gameplay action", () => {
    const routines: SummaryRoutine[] = [{ name: "main", kind: "script", offset: 6, end: 14, entries: [1], commands: [{ ...command(6, 0x209, "survey_set_answer", [8, 3]), next: 12 }, command(12, 2, "halt")] }];
    const summary = routineSummary(routines[0], context(routines));
    expect(summary.summary.toLowerCase()).toContain("record a player-profile survey answer"); expect(summary.summary).not.toContain("without another decoded gameplay action");
  });
  it("describes legacy numeric survey and current dialogue aliases by their opcode meanings", () => {
    const routines: SummaryRoutine[] = [{ name: "main", kind: "script", offset: 6, end: 24, entries: [1], commands: [
      { ...command(6, 0x209, "cmd_209", [8, 3]), next: 12 },
      { ...command(12, 0x3d, "msg_actor", [0x400, 1, 254, 0]), next: 22 }, command(22, 2, "halt"),
    ] }];
    const ctx = context(routines); ctx.texts.set(4, new Map([[1, "Bianca welcomes you."]]));
    const summary = routineSummary(routines[0], ctx);
    expect(summary.confidence).toBe("inferred"); expect(summary.summary).toContain("player-profile survey answer");
    expect(summary.summary).toContain("show dialogue"); expect(summary.summary).toContain("Bianca"); expect(summary.summary).not.toContain("undocumented");
  });
  it("does not include caller effects after a helper halts the VM, and includes them after return", () => {
    const routines: SummaryRoutine[] = [
      { name: "main", kind: "script", offset: 6, end: 18, entries: [1], commands: [command(6, 4, "call", [], [{ kind: "call", to: 20 }]), { ...command(8, 0x209, "survey_set_answer", [8, 3]), next: 16 }, command(16, 2, "halt")] },
      { name: "helper", kind: "helper", offset: 20, end: 22, entries: [], commands: [command(20, 2, "halt")] },
    ];
    expect(routineSummary(routines[0], context(routines)).summary).not.toContain("survey answer");
    routines[1].commands[0] = command(20, 5, "vm_return");
    expect(routineSummary(routines[0], context(routines)).summary).toContain("survey answer");
  });
  it("separates PWT result queries from Join Avenue services using the command table", () => {
    const routines: SummaryRoutine[] = [{ name: "main", kind: "script", offset: 6, end: 14, entries: [1], commands: [{ ...command(6, 0x3fe, "cmd_03fe", [1, 0x8000]), next: 12, dispatchId: 55 }, command(12, 2, "halt")] }];
    const summary = routineSummary(routines[0], context(routines));
    expect(summary.summary.toLowerCase()).toContain("read the trainer id for a pwt lobby position"); expect(summary.summary).not.toContain("award");
    routines[0].commands[0] = { ...command(6, 0x3f3, "join_avenue_shop_menu"), next: 12, dispatchId: 60 };
    expect(routineSummary(routines[0], context(routines)).summary).toContain("chosen service and price");
  });
  it("does not invent a public caller for recovered detached code or movement data", () => {
    const routines: SummaryRoutine[] = [
      { name: "main", kind: "script", offset: 6, end: 8, entries: [1], commands: [command(6, 2, "halt")] },
      { name: "unused", kind: "block", offset: 8, end: 16, entries: [], commands: [{ ...command(8, 0x209, "survey_set_answer", [8, 3]), next: 14 }, command(14, 5, "vm_return")] },
    ];
    const summary = routineSummary(routines[1], context(routines));
    expect(summary.confidence).toBe("partial"); expect(summary.summary).toContain("no decoded path from a public entry"); expect(summary.summary).toContain("survey answer");
    const movement = movementSummary(16, [{ kind: "action", name: "walk_left" }], false);
    expect(movement.confidence).toBe("partial"); expect(movement.summary).toContain("No decoded script command references");
  });
  it("distinguishes Join Avenue table setup from displaying the service menu", () => {
    const routines: SummaryRoutine[] = [{ name: "main", kind: "script", offset: 6, end: 10, entries: [1], commands: [command(6, 0x2c6, "join_avenue_store_start"), command(8, 2, "halt")] }];
    const summary = routineSummary(routines[0], context(routines));
    expect(summary.summary).toContain("Join Avenue shop command table"); expect(summary.summary).not.toContain("open");
  });
});


describe("project summary context", () => {
  afterEach(() => vi.restoreAllMocks());
  function sharedFixture() {
    const bytes = compileBw2Script("preserve_layout\noverlay 51\nscript :main, entry: 1 do\ncmd_03e8 1\nhalt\nend").bytes;
    const member: Bw2ScriptSummaryFile = { sha256: sha256Hex(bytes), byteLength: bytes.length, kind: "field", description: "Shared original.", variants: [{ overlay: 51, editable: true, routines: [] }] };
    const catalog: Bw2ScriptSummaryCatalog = { version: 1, gameCode: "IRDO", sourceRomSha256: "unused", archive: "a/0/5/6", files: { 12: member } };
    const match = summaryModule.matchBw2VanillaScriptSummary;
    vi.spyOn(summaryModule, "matchBw2VanillaScriptSummary").mockImplementation((project, file, bytes) => match(project, file, bytes, catalog));
    const project = { ...identity, arm9: new Uint8Array(), overlays: {}, texts: { banks: {} }, formats: {}, trpokInfo: [], narcs: { scripts: { name: "scripts", fileId: 1, sourcePath: "test", fileCount: 13, rawFiles: Array.from({ length: 13 }, () => new Uint8Array()), records: new Map(), dirty: new Set() } } } as ProjectState;
    project.narcs.scripts!.rawFiles[12] = bytes;
    return { project, bytes };
  }
  it("uses the catalog overlay only after the dispatcher and headers confirm no map assignment", () => {
    const f = sharedFixture(), overlay = vi.spyOn(overlayModule, "resolveBw2ScriptOverlay");
    overlay.mockReturnValue({ kind: "unavailable", zones: [], description: "Dispatcher unavailable" });
    const unknown = decompileBw2ProjectScript(f.project, 12);
    expect(unknown.editable).toBe(false); expect(unknown.source).not.toContain("# Vanilla White 2 notes:");
    overlay.mockReturnValue({ kind: "unavailable", zones: [], unassigned: true, description: "Verified unassigned" });
    const known = decompileBw2ProjectScript(f.project, 12);
    expect(known.editable).toBe(true); expect(known.source).toContain("overlay 51"); expect(known.source).toContain("# Vanilla White 2 notes:");
    expect(compileBw2Script(known.source).bytes).toEqual(f.bytes);
  });
  it("retains shared context through its own verified edits and suppresses new vanilla notes", () => {
    const f = sharedFixture(); vi.spyOn(overlayModule, "resolveBw2ScriptOverlay").mockReturnValue({ kind: "unavailable", zones: [], unassigned: true, description: "Verified unassigned" });
    const original = decompileBw2ProjectScript(f.project, 12), edited = original.source.replace("  pl_boat_start", "  nop\n  pl_boat_start");
    expect(edited).not.toBe(original.source);
    const result = replaceBw2ProjectScript(f.project, 12, edited); expect(result.roundTrip?.verified).toBe(true);
    const current = decompileBw2ProjectScript(f.project, 12);
    expect(compileBw2Script(current.source).overlayId).toBe(51); expect(current.source).not.toContain("# Vanilla White 2 notes:");
    expect(compileBw2Script(current.source).bytes).toEqual(result.bytes);
  });
  it("blocks apply when a formerly shared member gains a map assignment", () => {
    const f = sharedFixture(), overlay = vi.spyOn(overlayModule, "resolveBw2ScriptOverlay").mockReturnValue({ kind: "unavailable", zones: [], unassigned: true, description: "Verified unassigned" });
    const original = decompileBw2ProjectScript(f.project, 12);
    overlay.mockReturnValue({ kind: "detected", overlayId: 51, zones: [3], description: "Assigned" });
    expect(() => compileBw2ProjectScript(f.project, 12, original.source)).toThrow(/Shared script map context changed/);
    expect(f.project.narcs.scripts!.rawFiles[12]).toEqual(f.bytes); expect(f.project.narcs.scripts!.dirty.size).toBe(0);
  });
});
