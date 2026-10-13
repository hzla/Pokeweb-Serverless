import { describe, expect, it } from "vitest";
import { readU32, writeU32 } from "../nds/binary";
import { BW2_COMMAND_FACTS, BW2_MOVEMENT_COMMANDS, compileBw2Script, decompileBw2Script } from "../pokeweb/bw2ScriptCompiler";
import { bw2CommandByName, bw2CommandByOpcode } from "../pokeweb/bw2ScriptCompiler/commands";
import { bw2ScriptCommandHelp } from "../pokeweb/bw2ScriptCommandHelp";
import { highlightBw2ScriptLine } from "../ui/bw2ScriptCodeEditor";

const member = (payload: number[]) => Uint8Array.from([2, 0, 0, 0, 0x13, 0xfd, ...payload]);
const shop = "join_avenue_shop_menu 1, 2, 3, 0x8000, 0x8001, 0x8002, 0x8003, 0x8004";
const hints = (compiled: ReturnType<typeof compileBw2Script>) => ({ overlayId: compiled.overlayId,
  codeOffsets: compiled.codeBlocks?.map((block) => block.offset), codeRanges: compiled.codeBlocks,
  dispatchHints: compiled.instructions.flatMap((instruction) => instruction.dispatchId === undefined ? [] : [{ offset: instruction.offset, dispatchId: instruction.dispatchId }]) });

describe("native BW2 callback layouts", () => {
  it.each([
    [50, [0xeb, 3, 1, 0, 2, 0, 3, 0, 4, 0, 2, 0], "battle_subway_tool 0x0001, 0x0002, 0x0003, 0x0004", 10],
    [55, [0xfe, 3, 2, 0, 0, 0x80, 2, 0], "pwt_get_lobby_trainer_id", 6],
    [55, [0x0a, 4, 7, 2, 0, 2, 0], "pwt_mix_get_selected_name 0x07, 0x0002", 5],
    [55, [0x15, 4, 7, 2, 0], "pwt_set_enemy_name 0x07", 3],
    // 0x040c has no operand. 0x001e immediately following it is a jump.
    [58, [0x0c, 4, 0x1e, 0, 0, 0, 0, 0, 2, 0], "call_medal_info", 2],
  ] as const)("keeps overlay %i operands separate from the next command", (overlayId, payload, name, size) => {
    const bytes = member([...payload]), imported = decompileBw2Script(bytes, { overlayId });
    expect(imported.editable).toBe(true); expect(imported.source).toContain(name);
    const compiled = compileBw2Script(imported.source);
    expect(compiled.bytes).toEqual(bytes); expect(compiled.instructions[1].offset).toBe(6 + size);
    const grown = compileBw2Script(imported.source.replace("entry: 1 do\n", "entry: 1 do\n  nop\n"));
    expect(decompileBw2Script(grown.bytes, hints(grown)).editable).toBe(true);
    for (const relocation of grown.relocations) expect(relocation.operandOffset + 4 + (readU32(grown.bytes, relocation.operandOffset) | 0)).toBe(relocation.targetOffset);
  });
  it("decodes the eight-word shop callback only in its temporary command table", () => {
    const bytes = member([0xc6, 2, 0xf3, 3, 1, 0, 2, 0, 3, 0, 0, 0x80, 1, 0x80, 2, 0x80, 3, 0x80, 4, 0x80, 0xc7, 2, 2, 0]);
    const imported = decompileBw2Script(bytes, { overlayId: 58 });
    expect(imported.editable).toBe(true); expect(imported.source).toContain("join_avenue_shop_menu");
    const compiled = compileBw2Script(imported.source);
    expect(compiled.bytes).toEqual(bytes); expect(compiled.instructions[1]).toMatchObject({ offset: 8, dispatchId: 60, operands: [1, 2, 3, 0x8000, 0x8001, 0x8002, 0x8003, 0x8004] });
    expect(decompileBw2Script(bytes).editable).toBe(false);
    expect(() => compileBw2Script(`script :main, entry: 1 do\n${shop}\nend`)).toThrow();
  });
});

describe("independent live-path verification", () => {
  it("propagates a helper's changed table through return, using verified source hints", () => {
    const compiled = compileBw2Script(`preserve_layout\noverlay 58\nscript :main, entry: 1 do\ncall :open_shop\n${shop}\njoin_avenue_store_end\nhalt\nend\ndef open_shop\njoin_avenue_store_start\nvm_return\nend`);
    const imported = decompileBw2Script(compiled.bytes, hints(compiled));
    expect(imported.editable).toBe(true); expect(compileBw2Script(imported.source).bytes).toEqual(compiled.bytes);
  });
  it("rejects a shop call reachable with different table states even with source hints", () => {
    const compiled = compileBw2Script(`preserve_layout\noverlay 58\nscript :main, entry: 1 do\njump_if 1, :menu\njoin_avenue_store_start\nlabel :menu\n${shop}\nhalt\nend`);
    const imported = decompileBw2Script(compiled.bytes, hints(compiled));
    expect(imported.editable).toBe(false); expect(imported.warnings.join(" ")).toContain("Conflicting command-table state");
    expect(compileBw2Script(imported.source).bytes).toEqual(compiled.bytes);
  });
  it("does not let a caller's hints conceal a missing table switch in its helper", () => {
    const compiled = compileBw2Script(`preserve_layout\noverlay 58\nscript :main, entry: 1 do\ncall :helper\n${shop}\nhalt\nend\ndef helper\nvm_return\nend`);
    const imported = decompileBw2Script(compiled.bytes, hints(compiled));
    expect(imported.editable).toBe(false); expect(imported.warnings.join(" ")).toContain("Conflicting command-table state");
  });
  it("does not allow a bounded-code hint to hide a live fall-through or unknown command", () => {
    for (const payload of [[0, 0, 0, 0], [0, 0, 0xff, 0xff]]) {
      const imported = decompileBw2Script(member(payload), { codeOffsets: [6], codeRanges: [{ offset: 6, endOffset: 8 }] });
      expect(imported.editable).toBe(false);
      expect(imported.warnings.join(" ")).toMatch(/falls off|Unknown/);
    }
  });
});

describe("detached code and movement recovery", () => {
  it("preserves a misaligned unknown entry instead of recovering code across it", () => {
    const compiled = compileBw2Script("preserve_layout\nscript :main, entry: 1 do\nhalt\nend\nscript :setup, entry: 2 do\nstack_push 0x40df\nstack_push_const 1\nstack_cmp 1\njump_if 0xff, :done\nactor_set_g_pos 0, 787, 65532, 176, 2\nlabel :done\nhalt\nend");
    const bytes = compiled.bytes.slice(); writeU32(bytes, 4, compiled.entries[1].offset + 1 - 8);
    const imported = decompileBw2Script(bytes);
    expect(imported.editable).toBe(false); expect(imported.roundTripVerified).toBe(true);
    expect(imported.warnings.join(" ")).toContain("Unknown or truncated command 0xdf00");
    expect(imported.source).toContain("entry 2, :script_2");
    expect(compileBw2Script(imported.source).bytes).toEqual(bytes);
  });
  it("does not let speculative zero stores or orphan jumps consume unresolved targets", () => {
    for (const source of [
      "preserve_layout\nscript :main, entry: 1 do\nhalt\nend\nblock :unused do\nwork_set_const 0x8020, 0\nend\nscript :other, entry: 2 do\nhalt\nend",
      "preserve_layout\nscript :main, entry: 1 do\nhalt\nend\nblock :unused do\njump :main\nend\nscript :other, entry: 2 do\nhalt\nend",
    ]) {
      const compiled = compileBw2Script(source), bytes = compiled.bytes.slice();
      writeU32(bytes, 4, compiled.codeBlocks![1].offset + 1 - 8);
      const imported = decompileBw2Script(bytes);
      expect(imported.editable).toBe(false); expect(compileBw2Script(imported.source).bytes).toEqual(bytes);
    }
  });
  it("recovers an unused helper with relative operands that relocate after code growth", () => {
    const compiled = compileBw2Script("preserve_layout\nscript :main, entry: 1 do\nhalt\nend\ndef unused\nsurvey_set_answer 8, 3\njump :main\nend");
    const imported = decompileBw2Script(compiled.bytes);
    expect(imported.editable).toBe(true); expect(imported.source).toContain("survey_set_answer");
    expect(compileBw2Script(imported.source).bytes).toEqual(compiled.bytes);
    const edited = compileBw2Script(imported.source.replace("entry: 1 do\n", "entry: 1 do\n  sleep 1\n"));
    const jump = edited.relocations.find((relocation) => relocation.kind === "jump")!;
    expect(jump.targetOffset).toBe(6); expect(jump.operandOffset + 4 + (readU32(edited.bytes, jump.operandOffset) | 0)).toBe(6);
    expect(decompileBw2Script(edited.bytes).editable).toBe(true);
  });
  it("recovers a complete unused helper followed by an unused movement pool", () => {
    const bytes = compileBw2Script("preserve_layout\nscript :main, entry: 1 do\nhalt\nend\ndef unused\nsurvey_set_answer 8, 3\nmsg_actor_ex 0x400, 1, 254, 0, 0\nvm_return\nend\nmovement :unused_walk do\nwalk_left 2\nend").bytes;
    const imported = decompileBw2Script(bytes);
    expect(imported.editable).toBe(true); expect(imported.stats.movements).toBe(1);
    expect(compileBw2Script(imported.source).bytes).toEqual(bytes);
  });
  it("recognizes duplicate compiler terminators without treating partial data as code", () => {
    const imported = decompileBw2Script(member([2, 0, 5, 0, 5, 0, 2, 0]));
    expect(imported.editable).toBe(true); expect(imported.stats.instructions).toBe(4);
    for (const tail of [[0xff, 0xff], [0x28, 0, 0x20, 0x80], [0x1e, 0, 1, 0, 0, 0]]) {
      const raw = member([2, 0, ...tail]), unsupported = decompileBw2Script(raw);
      expect(unsupported.editable).toBe(false); expect(compileBw2Script(unsupported.source).bytes).toEqual(raw);
    }
  });
  it("covers every documented movement ID and keeps unknown or unterminated pools read-only", () => {
    expect(BW2_MOVEMENT_COMMANDS.map((command) => command.opcode).sort((a, b) => a - b)).toEqual(Array.from({ length: 0xc1 }, (_, i) => i));
    const pool = member([2, 0, 0x64, 0, 2, 0, 0xc0, 0, 1, 0, 0xfe, 0, 0, 0]);
    const imported = decompileBw2Script(pool); expect(imported.editable).toBe(true); expect(imported.stats.movements).toBe(1);
    expect(compileBw2Script(imported.source).bytes).toEqual(pool);
    for (const raw of [member([2, 0, 0xc1, 0, 1, 0, 0xfe, 0, 0, 0]), member([2, 0, 0xc0, 0, 1, 0])]) {
      const unverified = decompileBw2Script(raw); expect(unverified.editable).toBe(false); expect(compileBw2Script(unverified.source).bytes).toEqual(raw);
    }
  });
  it("keeps an unused movement pool whose parameters resemble a VM zero-store prefix", () => {
    const bytes = member([2, 0, 0x28, 0, 0x20, 0x80, 0, 0, 0, 0, 0xfe, 0, 0, 0]);
    const imported = decompileBw2Script(bytes);
    expect(imported.editable).toBe(true); expect(imported.stats.instructions).toBe(1); expect(imported.stats.movements).toBe(1);
    expect(imported.source).toContain("32800"); expect(compileBw2Script(imported.source).bytes).toEqual(bytes);
  });
});

describe("researched semantic command aliases", () => {
  it("names survey answers without changing legacy encodings or work argument identity", () => {
    const bytes = member([9, 2, 8, 0, 3, 0, 2, 0]);
    const imported = decompileBw2Script(bytes); expect(imported.source).toContain("survey_set_answer 0x0008, 0x0003");
    expect(imported.editable).toBe(true);
    for (const name of ["survey_set_answer", "cmd_209", "cmd_0209"]) {
      expect(compileBw2Script(`preserve_layout\nscript :main, entry: 1 do\n${name} 8, 3\nhalt\nend`).bytes).toEqual(bytes);
      const help = bw2ScriptCommandHelp(name)!; expect(help.parameters.map((parameter) => parameter.name)).toEqual(["question", "answer"]);
      expect(help.note).toContain("separate from bianca_intro_progress");
      expect(highlightBw2ScriptLine(`${name} 8, 3`)[0].kind).toBe("command");
    }
    const compiled = compileBw2Script("work :answer, 0x8000\nscript :main, entry: 1 do\nsurvey_set_answer 8, answer\nend");
    expect(decompileBw2Script(compiled.bytes).source).toContain("survey_set_answer 0x0008, common_script_param_0");
  });
  it("accepts a Battle Subway destination work alias while retaining its encoded ID", () => {
    const compiled = compileBw2Script("preserve_layout\noverlay 50\nwork :result, 0x8001\nscript :main, entry: 1 do\nbattle_subway_tool 1, 2, 3, result\nhalt\nend");
    expect(compiled.bytes).toEqual(member([0xeb, 3, 1, 0, 2, 0, 3, 0, 1, 0x80, 2, 0]));
    const imported = decompileBw2Script(compiled.bytes, { overlayId: 50 });
    expect(imported.editable).toBe(true); expect(imported.source).toContain("battle_subway_tool 0x0001, 0x0002, 0x0003, common_script_param_1");
    expect(bw2ScriptCommandHelp("battle_subway_tool", 50)!.parameters[3].name).toBe("result_work");
  });
  it("has unique names and metadata consistent with the separately maintained encodings", () => {
    expect(new Set(BW2_COMMAND_FACTS.map((fact) => fact.name)).size).toBe(BW2_COMMAND_FACTS.length);
    expect(BW2_COMMAND_FACTS.filter((fact) => fact.overlayId === undefined)).toHaveLength(129);
    expect(BW2_COMMAND_FACTS.filter((fact) => fact.overlayId !== undefined)).toHaveLength(239);
    for (const fact of BW2_COMMAND_FACTS) {
      const command = bw2CommandByName(fact.name, true, fact.overlayId)!;
      expect(command).toBeDefined(); expect(command.opcode).toBe(fact.opcode);
      expect(command.widths).toEqual(bw2CommandByOpcode(fact.opcode, fact.overlayId)!.definition.widths);
      if (fact.parameters.length) expect(fact.parameters.map((parameter) => parameter.width)).toEqual(command.widths);
      for (const index of fact.workOperands) expect(command.widths[index]).toBe(2);
      if (fact.overlayId !== undefined) expect(bw2CommandByName(fact.name, true)).toBeUndefined();
    }
  });
});
