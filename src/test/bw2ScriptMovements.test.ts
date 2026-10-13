import { describe, expect, it } from "vitest";
import { readU32 } from "../nds/binary";
import { BW2_MOVEMENT_COMMANDS, compileBw2Script, decompileBw2Script } from "../pokeweb/bw2ScriptCompiler";
import { buildBw2ScriptSourceContext } from "../pokeweb/bw2ScriptContextModel";
import { bw2MovementCommandHelp } from "../pokeweb/bw2ScriptCommandHelp";
import { highlightBw2ScriptLine } from "../ui/bw2ScriptCodeEditor";

describe("BW2 readable movement blocks", () => {
  it("encodes movement records and their pointer against independent bytes", () => {
    const source = `script :main, entry: 1 do
  apply_movement 3, :walk
end
movement :walk do
  wait_8 2
  walk_left 2
  turn_right 1
end`;
    const expected = Uint8Array.from([2, 0, 0, 0, 0x13, 0xfd, 0x64, 0, 3, 0, 2, 0, 0, 0, 2, 0, 0x3f, 0, 2, 0, 0x0e, 0, 2, 0, 0x23, 0, 1, 0, 0xfe, 0, 0, 0]);
    const compiled = compileBw2Script(source);
    expect(compiled.bytes).toEqual(expected);
    const imported = decompileBw2Script(expected);
    expect(imported.editable).toBe(true);
    expect(imported.source).toContain("movement :movement_10 do\n  wait_8 2\n  walk_left 2\n  turn_right 1\nend");
    expect(compileBw2Script(imported.source).bytes).toEqual(expected);
    expect(imported.stats.movements).toBe(1);
    expect(compiled.instructions.map((instruction) => instruction.opcode)).toEqual([0x64, 2]);
  });
  it("keeps shared tails and nonzero terminator parameters without duplicating records", () => {
    const source = `preserve_layout
script :main, entry: 1 do
apply_movement 1, :whole
apply_movement 2, :tail
halt
end
movement :whole do
walk_left 2
label :tail
turn_up 1
finish 7
end
data :padding, 0`;
    const original = compileBw2Script(source).bytes, imported = decompileBw2Script(original);
    expect(imported.editable).toBe(true);
    expect(imported.stats.movements).toBe(1);
    expect(imported.source).toContain("label :movement_1c\n  turn_up 1\n  finish 7");
    expect(compileBw2Script(imported.source).bytes).toEqual(original);
    const edited = compileBw2Script(imported.source.replace("  walk_left 2", "  walk_left 2\n  wait_8 3").replace("  apply_movement", "  sleep 1\n  apply_movement"));
    for (const relocation of edited.relocations) expect(relocation.operandOffset + 4 + (readU32(edited.bytes, relocation.operandOffset) | 0)).toBe(relocation.targetOffset);
    const refs = edited.relocations.filter((relocation) => relocation.kind === "movement");
    expect(refs[1].targetOffset - refs[0].targetOffset).toBe(8);
    expect(decompileBw2Script(edited.bytes).editable).toBe(true);
  });
  it("recovers terminal unreferenced lists and numeric unknown records without removing read-only gates", () => {
    const original = compileBw2Script(`preserve_layout
script :main, entry: 1 do
apply_movement 0, :walk
halt
end
movement :walk do
walk_down 2
end
movement :unused do
turn_left 1
end
movement :unknown do
raw_step 0xffff, 1
end`).bytes;
    const imported = decompileBw2Script(original);
    expect(imported.editable).toBe(false);
    expect(imported.warnings.join(" ")).toContain("Unrecognized nonzero payload");
    expect(imported.stats.movements).toBe(3);
    expect(imported.source).toContain("turn_left 1");
    expect(imported.source).toContain("raw_step 0xffff, 1");
    expect(compileBw2Script(imported.source).bytes).toEqual(original);
  });
  it("preserves unknown referenced movement warnings and bytes", () => {
    const original = compileBw2Script(`preserve_layout
script :main, entry: 1 do
apply_movement 0, :unknown
halt
end
movement :unknown do
raw_step 0xffff, 65535
end`).bytes;
    const imported = decompileBw2Script(original);
    expect(imported.editable).toBe(false);
    expect(imported.warnings.join(" ")).toContain("Unknown movement 0xffff");
    expect(imported.source).toContain("raw_step 0xffff, 65535");
    expect(compileBw2Script(imported.source).bytes).toEqual(original);
  });
  it("leaves incomplete or unrelated trailing bytes raw", () => {
    const original = compileBw2Script(`preserve_layout
script :main, entry: 1 do
apply_movement 0, :walk
halt
end
movement :walk do
walk_up 1
end
data :opaque, 0x12, 0x34, 0x56, 0x78, 0x9a`).bytes;
    const imported = decompileBw2Script(original);
    expect(imported.stats.movements).toBe(1);
    expect(imported.source).toContain("data :bytes_");
    expect(compileBw2Script(imported.source).bytes).toEqual(original);
  });
  it("supports constants and empty lists and distinguishes movement from VM commands", () => {
    const compiled = compileBw2Script(`STEPS = 65535
script :main, entry: 1 do
apply_movement 0, :walk
wait_movement
end
movement :walk do
walk_up STEPS
end
movement :empty do
end`);
    expect(compiled.dataBlocks![0].bytes).toEqual(Uint8Array.from([0x0c, 0, 255, 255, 0xfe, 0, 0, 0]));
    expect(compiled.dataBlocks![1].bytes).toEqual(Uint8Array.from([0xfe, 0, 0, 0]));
    expect(new Set(BW2_MOVEMENT_COMMANDS.map((command) => command.opcode)).size).toBe(BW2_MOVEMENT_COMMANDS.length);
    expect(highlightBw2ScriptLine("movement :walk do")[0].kind).toBe("keyword");
    expect(highlightBw2ScriptLine("walk_left 2")[0].kind).toBe("command");
    expect(bw2MovementCommandHelp("walk_left")?.opcode).toBe(0x0e);
    expect(bw2MovementCommandHelp("raw_step")?.note).toContain("unsupported ROM import editable");
  });
  it.each([
    ["walk_left", "expects 1"], ["walk_left 1, 2", "expects 1"], ["walk_left 65536", "unsigned 16-bit"],
    ["walk_left progress", "not work variables"], ["nop", "Unknown movement"],
    ["finish 0\nwalk_left 1", "last statement"], ["raw_step 0xfe, 0", "Use finish"],
    ["label :walk", "Duplicate"], ["if true\nwalk_left 1\nend", "non-keyword"],
  ])("rejects invalid movement statements: %s", (body, error) => {
    expect(() => compileBw2Script(`work :progress, 0x40a1\nscript :main, entry: 1 do\nend\nmovement :walk do\n${body}\nend`)).toThrow(error);
  });
  it("tracks movement owners through helpers, shared tail labels and incomplete source", () => {
    const source = `script :one, entry: 1 do
helper
end
script :two, entry: 2 do
apply_movement 2, :tail
end
def helper
apply_movement 1, :walk
end
movement :walk do
walk_left 1
label :tail
turn_up 1
end`;
    for (const text of [source, source.replace("turn_up 1", "turn_up ("), source.replace("movement :walk do", "movement :walk, before: :helper do").replace("turn_up 1", "turn_up (")]) {
      const context = buildBw2ScriptSourceContext(text);
      expect(context.focusAt(12)).toMatchObject({ name: "walk", kind: "movement", entries: [1, 2] });
    }
  });
  it("recovers interleaved lists as placed definitions and preserves layout when either code or movement grows", () => {
    const source = `preserve_layout
script :main, entry: 1 do
call :helper
apply_movement 0, :early
halt
end
movement :early do
walk_left 1
end
movement :second do
turn_up 1
end
def helper
apply_movement 1, :second
vm_return
end`;
    const original = compileBw2Script(source).bytes;
    const imported = decompileBw2Script(original);
    expect(imported.editable).toBe(true);
    expect(imported.stats.movements).toBe(2);
    expect(imported.source).toMatch(/movement :movement_\w+, before: :helper_\w+ do/);
    expect(imported.source.indexOf("def helper_")).toBeLessThan(imported.source.indexOf("movement :"));
    expect(compileBw2Script(imported.source).bytes).toEqual(original);
    const edited = compileBw2Script(imported.source.replace("  walk_left 1", "  walk_left 1\n  wait_8 2").replace("  call :", "  nop\n  call :"));
    expect(edited.bytes.length).toBe(original.length + 6);
    expect(decompileBw2Script(edited.bytes).editable).toBe(true);
    const movement = edited.relocations.find((relocation) => relocation.kind === "movement")!;
    expect(movement.targetOffset).toBeLessThan(edited.helpers[0].offset);
    for (const relocation of edited.relocations) expect(relocation.operandOffset + 4 + (readU32(edited.bytes, relocation.operandOffset) | 0)).toBe(relocation.targetOffset);
  });
  it.each([
    ["movement :walk, before: :missing do\nend", "Unknown movement placement"],
    ["movement :walk, before: :walk do\nend", "Cyclic movement placement"],
    ["movement :walk, before: :other do\nend\nmovement :other, before: :walk do\nend", "Cyclic movement placement"],
  ])("rejects undefined or cyclic placement anchors", (movement, message) => {
    expect(() => compileBw2Script(`preserve_layout\nscript :main, entry: 1 do\nhalt\nend\n${movement}`)).toThrow(message);
  });
  it("rejects explicit placement in authored mode", () => {
    expect(() => compileBw2Script("script :main, entry: 1 do\nend\nmovement :walk, before: :main do\nend")).toThrow("requires preserve_layout");
  });
  it.each([[0x64, "animation_0_once"], [0x9a, "player_receive_item"], [0xa4, "run_6f_down"], [0xa7, "walk_12f_up"], [0xa8, "walk_12f_down"], [0xb7, "animation_1_loop"], [0xba, "animation_2_once"]])("decodes documented additional BW2 movement 0x%s", (opcode, name) => {
    const bytes = Uint8Array.from([2, 0, 0, 0, 0x13, 0xfd, 0x64, 0, 0, 0, 2, 0, 0, 0, 2, 0, Number(opcode), 0, 1, 0, 0xfe, 0, 0, 0]);
    const imported = decompileBw2Script(bytes);
    expect(imported.editable).toBe(true);
    expect(imported.source).toContain(`${name} 1`);
    expect(compileBw2Script(imported.source).bytes).toEqual(bytes);
  });
  it("recovers and relocates unreferenced documented lists between a referenced list and later code", () => {
    const bytes = compileBw2Script("preserve_layout\nscript :main, entry: 1 do\ncall :helper\napply_movement 0, :gesture\nhalt\nend\nmovement :gesture do\nanimation_0_once 1\nend\nmovement :unused do\nwalk_up 2\nend\ndef helper\nvm_return\nend").bytes;
    const imported = decompileBw2Script(bytes);
    expect(imported.editable).toBe(true);
    expect(imported.stats.movements).toBe(2);
    expect(compileBw2Script(imported.source).bytes).toEqual(bytes);
    const changed = compileBw2Script(imported.source.replace("  walk_up 2", "  walk_up 2\n  wait_8 1"));
    expect(decompileBw2Script(changed.bytes).editable).toBe(true);
    expect(changed.bytes.length).toBe(bytes.length + 4);
  });
  it("automatically aligns movement data after odd-sized control-flow edits, preserving older source encodings", () => {
    const source = "preserve_layout\nmovement_alignment 2\nwork :counter, 0x8020\nscript :main, entry: 1 do\ncounter = 0\napply_movement 0, :walk\nhalt\nend\nmovement :walk do\nwalk_up 1\nend";
    const original = compileBw2Script(source).bytes, imported = decompileBw2Script(original);
    expect(imported.source).toContain("movement_alignment 2");
    const edited = compileBw2Script(imported.source.replace(/^(script :[^\n]+)\n/m, "$1\n  if event_temp_0 == 0\n    nop\n  end\n"));
    expect(edited.relocations.filter((ref) => ref.kind === "movement").every((ref) => ref.targetOffset % 2 === 0)).toBe(true);
    expect(decompileBw2Script(edited.bytes).editable).toBe(true);
    const unaligned = compileBw2Script(source.replace("movement_alignment 2\n", "").replace("apply_movement", "cmd_0053 0, 0\napply_movement")).bytes;
    const oldImport = decompileBw2Script(unaligned);
    expect(oldImport.editable).toBe(false);
    expect(oldImport.warnings.join(" ")).toContain("Unaligned movement");
    expect(compileBw2Script(oldImport.source).bytes).toEqual(unaligned);
  });
});
