import { describe, expect, it } from "vitest";
import { readU32, writeU32 } from "../nds/binary";
import { compileBw2Script, decompileBw2Script, Bw2ScriptDecompileError } from "../pokeweb/bw2ScriptCompiler";

const source = (body: string, suffix = "") => `preserve_layout\nwork :count, 0x8000\nscript :main, entry: 1 do\n${body}\nhalt\nend\n${suffix}`;
const roundTrip = (bytes: Uint8Array) => {
  const result = decompileBw2Script(bytes);
  expect(result.roundTripVerified).toBe(true);
  expect(compileBw2Script(result.source).bytes).toEqual(bytes);
  return result;
};

describe("BW2 lossless script decompiler", () => {
  it("round trips an independently hand-encoded forward call and odd file length", () => {
    const bytes = Uint8Array.from([2, 0, 0, 0, 0x13, 0xfd, 4, 0, 2, 0, 0, 0, 2, 0, 0, 0, 5, 0, 0]);
    const result = roundTrip(bytes);
    expect(result.source).toContain("call :helper_e");
    expect(result.source).toContain("def helper_e");
    expect(result.editable).toBe(true);
    expect(result.stats.helpers).toBe(1);
  });
  it.each([
    ["if count < 3\ncount += 1\nend", "if work_8000 <"],
    ["if count == 1\ncount = 2\nelse\ncount = 3\nend", "else"],
    ["while count < 3\ncount += 1\nend", "while work_8000 <"],
    ["case count\nwhen 0, 1\ncount = 2\nwhen 3\ncount = 4\nelse\ncount = 5\nend", "case work_8000"],
  ])("recovers byte-identical structured flow: %s", (body, expected) => {
    const result = roundTrip(compileBw2Script(source(body)).bytes);
    expect(result.source).toContain(expected);
    expect(result.stats.structuredBlocks).toBeGreaterThan(0);
    expect(result.editable).toBe(true);
  });
  it("preserves duplicate and out-of-order entry targets and fallthrough", () => {
    const original = compileBw2Script("preserve_layout\nentry 1, :second\nentry 2, :first\nentry 3, :second\nblock :first do\nnop\nend\nblock :second do\nhalt\nend").bytes;
    const result = roundTrip(original);
    expect(result.source).toContain("entry 3, :script_1");
    expect(result.editable).toBe(true);
  });
  it("retains signed backward branches and calls while code grows", () => {
    const original = compileBw2Script(source("call :tick\nlabel :loop\ncount += 1\njump :loop if count < 3", "def tick\nnop\nvm_return\nend")).bytes;
    const imported = roundTrip(original);
    const edited = compileBw2Script(imported.source.replace("work_8000 +=", "sleep 1\n  work_8000 +="));
    for (const relocation of edited.relocations) expect(relocation.operandOffset + 4 + (readU32(edited.bytes, relocation.operandOffset) | 0)).toBe(relocation.targetOffset);
    expect(roundTrip(edited.bytes).editable).toBe(true);
    expect(edited.bytes.length).toBe(original.length + 4);
  });
  it("relocates movement and elevator table pointers on editing", () => {
    const original = compileBw2Script(source("apply_movement 1, :walk\ncmd_01c1 :floors", "data :walk, 0, 0, 2, 0, 0xfe, 0, 0, 0\ndata :floors, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 0xff, 0xff")).bytes;
    const imported = roundTrip(original);
    expect(imported.editable).toBe(true);
    const edited = compileBw2Script(imported.source.replace("apply_movement", "sleep 1\n  apply_movement"));
    expect(edited.relocations.filter((r) => r.kind === "movement" || r.kind === "data").map((r) => r.kind)).toEqual(["movement", "data"]);
    expect(roundTrip(edited.bytes).editable).toBe(true);
  });
  it("retains one-byte operands and raw 32-bit unsigned literals", () => {
    const bytes = compileBw2Script(source("cmd_0015 1, 0xffffffff\njump_if 0x06, :done\nnop\nlabel :done")).bytes;
    const result = roundTrip(bytes);
    expect(result.source).toContain("0xffffffff");
    expect(result.source).toContain("jump_if 0x06");
  });
  it.each([0xffff, 1000])("preserves unsupported command %i read-only without guessing its size", (opcode) => {
    const bytes = Uint8Array.from([2, 0, 0, 0, 0x13, 0xfd, opcode & 255, opcode >> 8, 1, 2, 3]);
    const result = roundTrip(bytes);
    expect(result.editable).toBe(false);
    expect(result.stats.instructions).toBe(0);
    expect(result.source).toContain("data :script_1");
    expect(result.warnings.join(" ")).toContain("Unknown");
  });
  it("decodes overlay commands only with explicit context, preserving distinct layouts", () => {
    const bytes = Uint8Array.from([2, 0, 0, 0, 0x13, 0xfd, 0xe8, 3, 1, 0, 2, 0]);
    expect(roundTrip(bytes).editable).toBe(false);
    const withContext = decompileBw2Script(bytes, { overlayId: 51 });
    expect(withContext.editable).toBe(true);
    expect(withContext.source).toContain("cmd_03e8 0x0001");
    expect(compileBw2Script(withContext.source).bytes).toEqual(bytes);
    const otherContext = decompileBw2Script(bytes, { overlayId: 50 });
    expect(otherContext.source).toContain("vm_nop2");
    expect(compileBw2Script(otherContext.source).bytes).toEqual(bytes);
  });
  it("preserves unreachable nonzero bytes read-only and zero padding exactly", () => {
    const bytes = Uint8Array.from([2, 0, 0, 0, 0x13, 0xfd, 2, 0, 0x87, 0, 0, 0, 0]);
    expect(roundTrip(bytes).editable).toBe(false);
    bytes[8] = 0;
    expect(roundTrip(bytes).editable).toBe(true);
  });
  it("keeps externally targeted comparison instructions explicit", () => {
    const bytes = compileBw2Script("preserve_layout\nwork :count, 0x8000\nentry 2, :mid\nscript :main, entry: 1 do\ncmd_0019 0x8000, 2\nlabel :mid\njump_if 5, :done\nnop\nlabel :done\nhalt\nend").bytes;
    const result = roundTrip(bytes);
    expect(result.source).toContain("jump_if");
    expect(result.editable).toBe(true);
  });
  it("rejects pointers outside the payload or into an instruction operand", () => {
    const bytes = compileBw2Script(source("jump :done\nlabel :done")).bytes;
    for (const target of [0, 9, bytes.length + 2]) {
      const broken = bytes.slice();
      writeU32(broken, 8, target - 12);
      expect(() => decompileBw2Script(broken)).toThrow(Bw2ScriptDecompileError);
    }
  });
  it("rejects code/data overlap and malformed entry tables", () => {
    const bytes = compileBw2Script(source("apply_movement 1, :main")).bytes;
    expect(() => decompileBw2Script(bytes)).toThrow(/overlap/);
    expect(() => decompileBw2Script(new Uint8Array([0x13, 0xfd]))).toThrow(/entry table/);
  });
});
