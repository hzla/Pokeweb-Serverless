import { describe, expect, it } from "vitest";
import { readU32 } from "../nds/binary";
import { compileBw2Script, decompileBw2Script, Bw2ScriptCompileError } from "../pokeweb/bw2ScriptCompiler";
import { bw2ScriptCommandHelp } from "../pokeweb/bw2ScriptCommandHelp";
import { buildBw2ScriptSourceContext } from "../pokeweb/bw2ScriptContextModel";

const macro = "stop_companion_following script: 1, movement: :none";
const source = (body: string, prefix = "", suffix = "") => `${prefix}\nscript :main, entry: 1 do\n${body}\nend\n${suffix}`;
const raw = ["stack_push 0x8000", "stack_push 0x8001", "work_set 0x8000, 1", "work_set 0x8001, 0", "rt_call_global 0x2928", "stack_pop 0x8001", "stack_pop 0x8000"];
const roundTrip = (bytes: Uint8Array) => {
  const imported = decompileBw2Script(bytes);
  expect(imported.roundTripVerified).toBe(true);
  expect(imported.editable).toBe(true);
  expect(compileBw2Script(imported.source).bytes).toEqual(bytes);
  return imported;
};

describe("BW2 stop_companion_following macro", () => {
  it("matches independent encoded bytes and the original seven-command spelling without requiring work declarations", () => {
    const compiled = compileBw2Script(source(macro));
    expect([...compiled.bytes]).toEqual([
      2, 0, 0, 0, 0x13, 0xfd,
      9, 0, 0, 0x80, 9, 0, 1, 0x80,
      0x2a, 0, 0, 0x80, 1, 0, 0x2a, 0, 1, 0x80, 0, 0,
      0x1c, 0, 0x28, 0x29, 0x0a, 0, 1, 0x80, 0x0a, 0, 0, 0x80, 2, 0,
    ]);
    expect(compiled.bytes).toEqual(compileBw2Script(source(`${raw.join("\n")}\nhalt`, "preserve_layout")).bytes);
    expect(compiled.instructions.slice(0, 7).every((instruction) => instruction.line === 3)).toBe(true);
    expect(compiled.helpers).toEqual([]);
  });
  it("preserves prior parameter and stack values even when the called helper changes the shared slots", () => {
    const instructions = compileBw2Script(source(macro)).instructions;
    const work = new Map([[0x8000, 21], [0x8001, 31]]), stack = [123];
    const seen: number[][] = [];
    for (const instruction of instructions) {
      const [left, right] = instruction.operands;
      if (instruction.opcode === 9) stack.push(work.get(left)!);
      else if (instruction.opcode === 0x2a) work.set(left, right < 0x4000 ? right : work.get(right)!);
      else if (instruction.opcode === 0x1c) { seen.push([left, work.get(0x8000)!, work.get(0x8001)!]); work.set(0x8000, 99); work.set(0x8001, 100); }
      else if (instruction.opcode === 0x0a) work.set(left, stack.pop()!);
    }
    expect(seen).toEqual([[10536, 1, 0]]);
    expect(work).toEqual(new Map([[0x8000, 21], [0x8001, 31]]));
    expect(stack).toEqual([123]);
  });
  it.each([
    "stop_companion_following(script: 1, movement: :none)",
    "stop_companion_following(movement: 0,\n script: 1,\n)",
    "stop_companion_following script: 1,\n movement: :none",
    "stop_companion_following movement: :none, script: CALLBACK",
  ])("supports keyword order, parentheses, multiline syntax and constants: %s", (call) => {
    expect(compileBw2Script(source(call, "CALLBACK = 1")).bytes).toEqual(compileBw2Script(source(macro)).bytes);
  });
  it("preserves runtime work operands and numeric movement behavior codes during recovery", () => {
    const compiled = compileBw2Script(source("stop_companion_following script: event_script, movement: behavior", "work :event_script, 0x8020\nwork :behavior, 0x8021"));
    const imported = roundTrip(compiled.bytes);
    expect(imported.source).toContain("stop_companion_following script: event_temp_0, movement: event_temp_1");
    expect(compiled.instructions[2].operands).toEqual([0x8000, 0x8020]);
    expect(compiled.instructions[3].operands).toEqual([0x8001, 0x8021]);
    expect(roundTrip(compileBw2Script(source("stop_companion_following script: 0, movement: 3")).bytes).source).toContain("stop_companion_following script: 0, movement: 3");
  });
  it("recovers the entire sequence and can explicitly retain expanded source", () => {
    const bytes = compileBw2Script(source(`${raw.join("\n")}\nhalt`, "preserve_layout")).bytes;
    const imported = roundTrip(bytes);
    expect(imported.source).toContain(macro);
    expect(imported.source).not.toContain("rt_call_global");
    const expanded = decompileBw2Script(bytes, { recoverMacros: false });
    expect(expanded.source).not.toContain(macro);
    expect(expanded.source).toContain("rt_call_global 0x2928");
    expect(compileBw2Script(expanded.source).bytes).toEqual(bytes);
  });
  it.each([
    [0, "stack_push 0x8001"], [1, "stack_push 0x8002"], [2, "work_set_const 0x8000, 1"],
    [3, "work_set 0x8002, 0"], [4, "rt_call_global 0x2927"], [4, "rt_call_global_async 0x2928"],
    [5, "stack_pop 0x8000"], [6, "stack_pop 0x8002"],
  ])("keeps a nonmatching command sequence expanded: step %i", (index, command) => {
    const steps = [...raw]; steps[index as number] = command as string;
    expect(roundTrip(compileBw2Script(source(`${steps.join("\n")}\nhalt`, "preserve_layout")).bytes).source).not.toContain("stop_companion_following");
  });
  it.each([1, 2, 3, 4, 5, 6])("does not hide an interior branch target at step %i", (index) => {
    const steps = [...raw]; steps.splice(index, 0, "label :inside");
    const imported = roundTrip(compileBw2Script(source(`jump_if 0x01, :inside\n${steps.join("\n")}\nhalt`, "preserve_layout")).bytes);
    expect(imported.source).not.toContain("stop_companion_following");
  });
  it.each([1, 2, 3, 4, 5, 6])("does not consume a public entry inside the sequence at step %i", (index) => {
    const body = `preserve_layout\nentry 1, :begin\nentry 2, :inside\nblock :begin do\n${raw.slice(0, index).join("\n")}\nend\nblock :inside do\n${raw.slice(index).join("\n")}\nhalt\nend`;
    expect(roundTrip(compileBw2Script(body).bytes).source).not.toContain("stop_companion_following");
  });
  it("works in structured flow and helpers, and relocates local calls and branches when code grows", () => {
    const compiled = compileBw2Script(source("if true\nstop\nend", "", `def stop\n${macro}\nend`));
    expect(roundTrip(compiled.bytes).source).toContain(macro);
    const edited = compileBw2Script(source("if true\nsleep 1\nstop\nend", "", `def stop\n${macro}\nend`));
    for (const reference of edited.relocations) expect(reference.operandOffset + 4 + (readU32(edited.bytes, reference.operandOffset) | 0)).toBe(reference.targetOffset);
    const context = buildBw2ScriptSourceContext(source("stop", "", `def stop\n${macro}\nend`));
    expect(context.focusAt(7)?.entries).toEqual([1]);
    const macroEdit = compileBw2Script(roundTrip(compiled.bytes).source.replace("script: 1", "script: 2"));
    expect(roundTrip(macroEdit.bytes).source).toContain("stop_companion_following script: 2");
  });
  it.each([
    ["stop_companion_following script: 1", "requires 'movement:'"],
    ["stop_companion_following movement: :none", "requires 'script:'"],
    ["stop_companion_following script: 1, movement: :none, script: 2", "Duplicate"],
    ["stop_companion_following script: 1, move: :none", "Unknown"],
    ["stop_companion_following 1, 0", "keyword arguments"],
    ["stop_companion_following script: :one, movement: :none", "alias"],
    ["stop_companion_following script: 1, movement: :walk", "alias"],
    ["stop_companion_following script: -1, movement: :none", "unsigned"],
    ["stop_companion_following script: 0x8000, movement: :none", "work binding"],
    ["stop_companion_following script: 1, movement: 0x4000", "work binding"],
  ])("rejects invalid or ambiguous macro arguments: %s", (call, message) => {
    expect(() => compileBw2Script(source(call))).toThrow(Bw2ScriptCompileError);
    expect(() => compileBw2Script(source(call))).toThrow(message);
  });
  it("reports parameter errors at their actual source line and describes its semantic arguments", () => {
    try { compileBw2Script(source("stop_companion_following(\nscript: 1,\nmovement: :walk\n)")); throw new Error("Expected macro error"); }
    catch (error) { expect(error).toBeInstanceOf(Bw2ScriptCompileError); expect((error as Bw2ScriptCompileError).position).toEqual({ line: 5, column: 11 }); }
    expect(bw2ScriptCommandHelp("stop_companion_following")).toMatchObject({ macro: true, parameters: [{ name: "script" }, { name: "movement" }] });
  });
});

const interactionMacros = [
  { name: "talk", call: "talk message: 1", raw: ["play_sound 0x0547", "face_player", "message_actor 0x0400, 1, 0, 0", "wait_last", "close_message"] },
  { name: "read_sign", call: "read_sign message: 26, style: :town", raw: ["funfest_mission_broadcast 17, 0", "play_sound 0x0547", "msg_place_sign 26, 1", "msg_place_sign_close"] },
  { name: "give_item", call: "give_item item: 465, quantity: 1", raw: ["stack_push 0x8000", "stack_push 0x8001", "work_set 0x8000, 465", "work_set 0x8001, 1", "rt_call_global 2805", "stack_pop 0x8001", "stack_pop 0x8000"] },
  { name: "finish_interaction", call: "finish_interaction", raw: ["wait_moment", "unlock", "halt"] },
];
const terminated = (steps: readonly string[]) => steps.at(-1) === "halt" ? steps.join("\n") : `${steps.join("\n")}\nhalt`;

describe("BW2 interaction macros", () => {
  it("matches independently encoded stock Striaton NPC and sign sequences", () => {
    const npc = Uint8Array.from([
      2, 0, 0, 0, 0x13, 0xfd,
      0x2e, 0, 0xa6, 0, 0x47, 5, 0x74, 0, 0x3d, 0, 0, 4, 1, 0, 0, 0, 0, 0,
      0x32, 0, 0x3e, 0, 0x30, 0, 0x2f, 0, 2, 0,
    ]);
    expect(compileBw2Script(source("lock\ntalk message: 1\nfinish_interaction", "preserve_layout")).bytes).toEqual(npc);
    const imported = roundTrip(npc);
    expect(imported.source).toContain("talk message: 1");
    expect(imported.source).toContain("finish_interaction\n");
    expect(imported.source).not.toContain("message_actor");
    const sign = Uint8Array.from([
      2, 0, 0, 0, 0x13, 0xfd,
      0x2e, 0, 0x76, 2, 17, 0, 0, 0, 0xa6, 0, 0x47, 5, 0x43, 0, 26, 0, 1, 0,
      0x44, 0, 0x30, 0, 0x2f, 0, 2, 0,
    ]);
    expect(compileBw2Script(source("lock\nread_sign message: 26, style: :town\nfinish_interaction", "preserve_layout")).bytes).toEqual(sign);
    expect(roundTrip(sign).source).toContain("read_sign message: 26, style: :town");
  });
  it("matches an independently encoded Nimbasa item-gift wrapper", () => {
    const bytes = Uint8Array.from([
      2, 0, 0, 0, 0x13, 0xfd,
      9, 0, 0, 0x80, 9, 0, 1, 0x80,
      0x2a, 0, 0, 0x80, 0xd1, 1, 0x2a, 0, 1, 0x80, 1, 0,
      0x1c, 0, 0xf5, 0x0a, 0x0a, 0, 1, 0x80, 0x0a, 0, 0, 0x80, 2, 0,
    ]);
    expect(compileBw2Script(source("give_item item: VS_RECORDER, quantity: 1\nhalt", "preserve_layout\nVS_RECORDER = 465")).bytes).toEqual(bytes);
    expect(roundTrip(bytes).source).toContain("give_item item: 465, quantity: 1");
  });
  it.each(interactionMacros)("recovers $name automatically and can retain its raw spelling", (fixture) => {
    const bytes = compileBw2Script(source(terminated(fixture.raw), "preserve_layout")).bytes;
    expect(roundTrip(bytes).source).toContain(fixture.call);
    const expanded = decompileBw2Script(bytes, { recoverMacros: false });
    expect(expanded.source).not.toContain(fixture.name);
    expect(compileBw2Script(expanded.source).bytes).toEqual(bytes);
  });
  it("ends new scripts once, keeps fall-through branch termination, and preserves helper returns", () => {
    const compiled = compileBw2Script(source("lock\ntalk message: 1\nfinish_interaction"));
    expect(compiled.instructions.filter((i) => i.opcode === 2)).toHaveLength(1);
    expect(roundTrip(compiled.bytes).source).toContain("finish_interaction");
    const conditional = compileBw2Script(source("finish_interaction if choice == 1", "work :choice, 0x8000"));
    expect(conditional.instructions.filter((i) => i.opcode === 2)).toHaveLength(2);
    const branch = conditional.relocations.find((r) => r.kind === "jump")!;
    expect(conditional.instructions.find((i) => i.offset === branch.targetOffset)?.opcode).toBe(2);
    roundTrip(conditional.bytes);
    const helper = compileBw2Script(source("speak", "", "def speak\ntalk message: 1\nend"));
    expect(helper.instructions.at(-1)?.opcode).toBe(5);
    expect(roundTrip(helper.bytes).source).toContain("talk message: 1");
  });
  it.each([
    ["info", 0], ["town", 1], ["post", 2], ["road", 3],
  ])("encodes and recovers the :%s sign style", (alias, id) => {
    const compiled = compileBw2Script(source(`read_sign(style: :${alias},\nmessage: TEXT,\n)`, "TEXT = 26"));
    expect(compiled.instructions[2].operands).toEqual([26, id]);
    expect(roundTrip(compiled.bytes).source).toContain(`read_sign message: 26, style: :${alias}`);
  });
  it.each([
    "if choice == 1\ntalk message: 1\nfinish_interaction\nelse\ntalk message: 2\nfinish_interaction\nend",
    "case choice\nwhen 1\ntalk message: 1\nfinish_interaction\nelse\ntalk message: 2\nfinish_interaction\nend",
    "while choice == 1\ntalk message: 1\nfinish_interaction\nend",
    "if choice == 1\nif choice == 2\nfinish_interaction\nelse\nfinish_interaction\nend\nelse\nfinish_interaction\nend",
  ])("keeps fully terminating alternatives editable without unreachable cleanup: %s", (body) => {
    const compiled = compileBw2Script(source(body, "work :choice, 0x8000"));
    expect(roundTrip(compiled.bytes).source).toContain("finish_interaction");
  });
  it("keeps runtime message works separate from literal sign styles", () => {
    for (const call of ["talk message: message", "read_sign message: message, style: :town"]) {
      const imported = roundTrip(compileBw2Script(source(call, "work :message, 0x8020")).bytes);
      expect(imported.source).toContain("message: event_temp_0");
      expect(imported.source).toContain("work :event_temp_0, 0x8020");
    }
    const literal = roundTrip(compileBw2Script(source("read_sign message: 26, style: RAW_STYLE", "RAW_STYLE = 0x8000")).bytes);
    expect(literal.source).toContain("style: 32768");
    expect(literal.source).not.toContain("work :common_script_param_0");
    expect(() => compileBw2Script(source("read_sign message: 26, style: style", "work :style, 0x8000"))).toThrow(/literal or constant/);
  });
  it("retains original item-argument evaluation order and restores parameters and the existing stack", () => {
    const compiled = compileBw2Script(source("give_item quantity: first, item: second", "work :first, 0x8000\nwork :second, 0x8001"));
    const work = new Map([[0x8000, 21], [0x8001, 31]]), stack = [123], seen: number[][] = [];
    for (const { opcode, operands: [left, right] } of compiled.instructions) {
      if (opcode === 9) stack.push(work.get(left)!);
      else if (opcode === 0x2a) work.set(left, right < 0x4000 ? right : work.get(right)!);
      else if (opcode === 0x1c) { seen.push([left, work.get(0x8000)!, work.get(0x8001)!]); work.set(0x8000, 99); work.set(0x8001, 100); }
      else if (opcode === 0x0a) work.set(left, stack.pop()!);
    }
    expect(seen).toEqual([[2805, 31, 31]]);
    expect(work).toEqual(new Map([[0x8000, 21], [0x8001, 31]]));
    expect(stack).toEqual([123]);
    expect(roundTrip(compiled.bytes).source).toContain("give_item item: common_script_param_1, quantity: common_script_param_0");
  });
  it.each([
    ["talk", 0, "play_sound 0x0548"], ["talk", 2, "message_actor 169, 1, 0, 0"],
    ["talk", 2, "message_actor 0x0400, 1, 1, 0"], ["talk", 4, "msg_win_close_all"],
    ["read_sign", 0, "funfest_mission_broadcast 16, 0"], ["read_sign", 0, "funfest_mission_broadcast 17, 1"],
    ["give_item", 2, "work_set_const 0x8000, 465"], ["give_item", 4, "rt_call_global 2801"],
    ["give_item", 5, "stack_pop 0x8000"], ["finish_interaction", 0, "sleep 1"],
  ])("does not normalize a similar %s sequence at step %i", (name, index, replacement) => {
    const fixture = interactionMacros.find((f) => f.name === name)!;
    const steps = [...fixture.raw]; steps[index as number] = replacement as string;
    expect(roundTrip(compileBw2Script(source(terminated(steps), "preserve_layout")).bytes).source).not.toContain(name);
  });
  for (const fixture of interactionMacros) {
    for (let index = 1; index < fixture.raw.length; index++) {
      it(`keeps ${fixture.name} expanded across incoming branches, calls, and entries at step ${index}`, () => {
        const steps = [...fixture.raw]; steps.splice(index, 0, "label :inside");
        for (const incoming of ["jump_if 0x01, :inside", "call :inside"]) {
          const bytes = compileBw2Script(source(`${incoming}\n${terminated(steps)}`, "preserve_layout")).bytes;
          expect(roundTrip(bytes).source).not.toContain(fixture.name);
        }
        const split = `preserve_layout\nentry 1, :begin\nentry 2, :inside\nblock :begin do\n${fixture.raw.slice(0, index).join("\n")}\nend\nblock :inside do\n${terminated(fixture.raw.slice(index))}\nend`;
        expect(roundTrip(compileBw2Script(split).bytes).source).not.toContain(fixture.name);
      });
    }
  }
  it("relocates branch, helper, and movement pointers after inserting macros and editing arguments", () => {
    const base = `work :choice, 0x8000\nscript :main, entry: 1 do\nif choice == 1\nspeak\nend\napply_movement 0, :walk\nwait_movement\nfinish_interaction\nend\ndef speak\ntalk message: 1\nend\nmovement :walk do\nwalk_left 2\nend`;
    const imported = roundTrip(compileBw2Script(base).bytes);
    const edited = compileBw2Script(imported.source.replace("talk message: 1", "give_item item: 465, quantity: 1\ntalk message: 2"));
    for (const reference of edited.relocations) expect(reference.operandOffset + 4 + (readU32(edited.bytes, reference.operandOffset) | 0)).toBe(reference.targetOffset);
    const recovered = roundTrip(edited.bytes);
    expect(recovered.source).toContain("give_item item: 465, quantity: 1");
    expect(recovered.source).toContain("talk message: 2");
  });
  it.each([
    "talk", "talk message: 1, message: 2", "talk message: 0x8000",
    "read_sign message: 26", "read_sign message: 26, style: :unknown",
    "give_item item: 465", "give_item item: 465, quantity: -1", "finish_interaction message: 1",
  ])("rejects incomplete or ambiguous macro source: %s", (call) => {
    expect(() => compileBw2Script(source(call))).toThrow(Bw2ScriptCompileError);
  });
  it("reports each macro's actual command count, byte size, and semantic arguments", () => {
    for (const [name, count, bytes] of [["talk", 5, 20], ["read_sign", 4, 18], ["give_item", 7, 32], ["finish_interaction", 3, 6]] as const) {
      const help = bw2ScriptCommandHelp(name)!;
      expect(help).toMatchObject({ macro: true, commandCount: count });
      expect(help.note).toContain(`${bytes} bytes`);
    }
  });
});
