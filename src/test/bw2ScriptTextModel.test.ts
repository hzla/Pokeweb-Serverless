import { describe, expect, it } from "vitest";
import { bw2ScriptTextBanks, bw2ScriptMessageReference, bw2ScriptTextEntries, updateBw2ScriptText, bw2ScriptDisplayText, bw2ScriptWordLimits } from "../pokeweb/bw2ScriptTextModel";
import { buildBw2ScriptSourceContext } from "../pokeweb/bw2ScriptContextModel";
import { decodeGen5TextBank, encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";
import type { ProjectState } from "../pokeweb/projectStore";
import type { HeaderRow } from "../pokeweb/headerModel";

function fixture(): ProjectState {
  const bank: Gen5TextEntry[] = [["0_0A", "Hello\\nVAR(256, 1)!\\r", 0], ["0_1c", "Short text", 0], ["1_0", "Alternate", 0], ["1_1", "Second block", 0]];
  return {
    session: { baseRom: "BW2", baseVersion: "W2", romName: "test", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { idCode: "IRDO", title: "test", fileName: "test.nds", size: 1 },
    arm9: new Uint8Array(), overlays: {}, formats: {}, trpokInfo: [], texts: { banks: {} },
    headers: { count: 3, rows: { 1: { index: 0, location_name: "Aspertia", script_id: 854, level_script_id: 855, text_bank_id: 0 } as HeaderRow, 2: { index: 1, location_name: "Other map", script_id: 854, text_bank_id: 1 } as HeaderRow, 3: { index: 2, location_name: "Shared bank", script_id: 100, level_script_id: 854, text_bank_id: 0 } as HeaderRow } },
    narcs: {
      story_texts: { name: "story_texts", sourcePath: "a/0/0/3", fileId: 0, fileCount: 2, rawFiles: [encodeGen5TextBank(bank), encodeGen5TextBank([["0_0", "Other bank", 0]])], records: new Map(), dirty: new Set() },
      scripts: { name: "scripts", sourcePath: "a/0/5/6", fileId: 1, fileCount: 1, rawFiles: [new Uint8Array([1, 2, 3])], records: new Map(), dirty: new Set() },
    },
  };
}

describe("BW2 script-linked dialogue", () => {
  it("groups all current map-header banks, including auxiliary assignments, and reflects header edits", () => {
    const project = fixture();
    expect(bw2ScriptTextBanks(project, 854)).toEqual([{ bankId: 0, maps: [{ zoneId: 0, name: "Aspertia" }, { zoneId: 2, name: "Shared bank" }] }, { bankId: 1, maps: [{ zoneId: 1, name: "Other map" }] }]);
    expect(bw2ScriptTextBanks(project, 855)).toHaveLength(1);
    project.headers!.rows[2].text_bank_id = 0;
    expect(bw2ScriptTextBanks(project, 854)).toHaveLength(1);
    expect(bw2ScriptTextBanks(project, 999)).toEqual([]);
  });
  it("resolves the exact message operands, constant aliases, numeric opcode aliases, and multiline arguments", () => {
    const source = "BANK = 0x0400\nMESSAGE = 17\nscript :main, entry: 1 do\nmsg_actor_ex(BANK,\nMESSAGE, 0xfe, 0, 0)\ncmd_003d 169, 3, 0, 0\nend";
    const context = buildBw2ScriptSourceContext(source);
    expect(bw2ScriptMessageReference(context.callAt(4), context.constantBindings)).toEqual({ entryId: 17, bankId: undefined, defaultBank: true });
    expect(bw2ScriptMessageReference(context.callAt(5), context.constantBindings)).toEqual({ entryId: 17, bankId: undefined, defaultBank: true });
    expect(bw2ScriptMessageReference(context.callAt(6), context.constantBindings)).toEqual({ entryId: 3, bankId: 169, defaultBank: false });
    expect(bw2ScriptMessageReference(context.callAt(7), context.constantBindings)).toBeUndefined();
  });
  it("does not confuse runtime work IDs or helpers with static text references", () => {
    const context = buildBw2ScriptSourceContext("work :message, 0x8000\nscript :main, entry: 1 do\nmsg_actor_ex 0x400, message, 0xfe, 0, 0\nmsg_actor_ex 0x4000, 1, 0xfe, 0, 0\nend");
    for (const line of [3, 4]) expect(bw2ScriptMessageReference(context.callAt(line), context.constantBindings)?.reason).toContain("runtime");
    expect(bw2ScriptMessageReference({ kind: "call", name: "msg_actor_ex", args: [], helperOnly: true, line: 1, column: 1 }, new Map())).toBeUndefined();
  });
  it("resolves talk and sign macro text by parameter identity across reordered keywords and multiline calls", () => {
    const context = buildBw2ScriptSourceContext("MESSAGE = 17\nscript :main, entry: 1 do\nword_set_rival_name 1\ntalk(message: MESSAGE)\nread_sign(\nstyle: :road,\nmessage: MESSAGE,\n)\nfinish_interaction\ngive_item item: 465, quantity: 1\nmsg_place_sign 17, 1\nend");
    for (const line of [4, 5, 6, 7, 11]) {
      expect(bw2ScriptMessageReference(context.callAt(line), context.constantBindings)).toEqual({ entryId: 17, bankId: undefined, defaultBank: true });
      expect(bw2ScriptWordLimits(fixture(), context.callsBefore(line), context.constantBindings)[1]).toEqual({ length: 7, label: "rival name" });
    }
    for (const line of [9, 10]) expect(bw2ScriptMessageReference(context.callAt(line), context.constantBindings)).toBeUndefined();
    expect(context.callAt(6)?.args.map((arg) => arg.kind === "number" ? arg.value : arg.name)).toEqual(["MESSAGE", "road"]);
  });
  it("does not guess dynamic macro messages and retains complete macro navigation during unrelated invalid edits", () => {
    const context = buildBw2ScriptSourceContext("work :message, 0x8000\nscript :main, entry: 1 do\ntalk message: message\nread_sign style: :town, message: message\nend");
    for (const line of [3, 4]) expect(bw2ScriptMessageReference(context.callAt(line), context.constantBindings)?.reason).toContain("runtime");
    const draft = buildBw2ScriptSourceContext("MESSAGE = 17\nscript :main, entry: 1 do\ntalk message: MESSAGE\nread_sign style: :road, message: 17\nread_sign message: 17\nunknown(\n");
    for (const line of [3, 4]) expect(bw2ScriptMessageReference(draft.callAt(line), draft.constantBindings)?.entryId).toBe(17);
    expect(draft.callAt(5)).toBeUndefined();
    expect(draft.callAt(6)).toBeUndefined();
  });
  it("keeps valid message navigation during unrelated incomplete edits and clears incomplete operands", () => {
    const context = buildBw2ScriptSourceContext("script :main, entry: 1 do\nmsg_actor_ex 0x400, 17, 0xfe, 0, 0\nunknown(\n");
    expect(bw2ScriptMessageReference(context.callAt(2), context.constantBindings)?.entryId).toBe(17);
    expect(context.callAt(3)).toBeUndefined();
  });
  it("edits one entry atomically through the shared text store, preserving other entries, metadata, banks and script bytes", () => {
    const project = fixture(), other = project.narcs.story_texts!.rawFiles[1], script = project.narcs.scripts!.rawFiles[0];
    const entries = bw2ScriptTextEntries(project, 0);
    const before = entries[0].value[1], originalOthers = entries.slice(1).map(({ value }) => value.slice(0, 2));
    updateBw2ScriptText(project, 0, "0_0A", before, "Hi\\nVAR(256, 1)!\\r");
    expect(bw2ScriptTextEntries(project, 0)[0].value[1]).toBe("Hi\\nVAR(256, 1)!\\r");
    const decoded = decodeGen5TextBank(project.narcs.story_texts!.rawFiles[0]);
    expect(decoded[0].slice(0, 2)).toEqual(["0_0A", "Hi\\nVAR(256, 1)!\\r"]);
    expect(decoded.slice(1).map((entry) => entry.slice(0, 2))).toEqual(originalOthers);
    expect(project.narcs.story_texts!.rawFiles[1]).toBe(other);
    expect(project.narcs.scripts!.rawFiles[0]).toBe(script);
    expect([...project.narcs.story_texts!.dirty]).toEqual([0]);
    expect(project.narcs.scripts!.dirty.size).toBe(0);
    expect(() => updateBw2ScriptText(project, 0, "0_0A", before, "Stale overwrite")).toThrow(/Text changed/);
  });
  it("does not mutate a bank on encoding failures, lossy compressed text, or unchanged saves", () => {
    const project = fixture(), bytes = project.narcs.story_texts!.rawFiles[0];
    const before = bw2ScriptTextEntries(project, 0)[0].value[1];
    expect(() => updateBw2ScriptText(project, 0, "0_0A", before, "VAR(")).toThrow(/Unclosed/);
    const compressed = bw2ScriptTextEntries(project, 0)[1].value;
    expect(() => updateBw2ScriptText(project, 0, compressed[0], compressed[1], "漢字")).toThrow(/Cannot compress/);
    expect(() => updateBw2ScriptText(project, 0, "0_0A", before, "VAR(256, 65536)")).toThrow(/without changing/);
    updateBw2ScriptText(project, 0, "0_0A", before, before);
    expect(project.narcs.story_texts!.rawFiles[0]).toBe(bytes);
    expect(bw2ScriptTextEntries(project, 0)[0].value[1]).toBe(before);
    expect(project.narcs.story_texts!.dirty.size).toBe(0);
    expect(() => bw2ScriptTextEntries(project, 99)).toThrow(/not loaded/);
  });
  it("renders line and page breaks while retaining runtime substitutions", () => {
    expect(bw2ScriptDisplayText("VAR(256, 1): Hi\\nthere\\r\\nBye\\f")).toBe("VAR(256, 1): Hi\nthere\n\nBye\n\n");
  });
  it("infers conservative variable limits from preceding writers in the focused routine and excludes later writes", () => {
    const source = "script :main, entry: 1 do\nword_set_rival_name 1\nword_set_party_poke_name 2, 0\nmsg_actor_ex 0x400, 17, 0xfe, 0, 0\nword_set_item_name 1, 0\nend";
    const context = buildBw2ScriptSourceContext(source);
    expect(bw2ScriptWordLimits(fixture(), context.callsBefore(4), context.constantBindings)).toEqual({ 1: { length: 7, label: "rival name" }, 2: { length: 10, label: "Pokémon nickname" } });
    expect(bw2ScriptWordLimits(fixture(), context.callsBefore(6), context.constantBindings)[1].length).toBe(20);
  });
});
