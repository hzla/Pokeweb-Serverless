import { describe, expect, it } from "vitest";
import { readU16, readU32 } from "../nds/binary";
import { Bw2ScriptCompileError, compileBw2Script, type CompiledBw2Script } from "../pokeweb/bw2ScriptCompiler";
import { gen5ScriptCommandOffsets, gen5ScriptEntries } from "../pokeweb/gen5ScriptCommands";

const script = (body: string): string => `script :main, entry: 1 do\n${body}\nend\n`;
const withWork = (body: string): string => `work :count, 0x8000\nwork :result, 0x8001\n${script(body)}`;

describe("Ruby-like BW2 script compiler", () => {
  it("matches a hand-encoded file with a forward helper call", () => {
    const result = compileBw2Script(`${script("tick()")}\ndef tick\n  nop\nend\n`);
    expect([...result.bytes]).toEqual([
      0x02, 0, 0, 0, 0x13, 0xfd, // entry -> byte 6, terminator
      0x04, 0, 0x02, 0, 0, 0, // VMCall -> byte 14 (relative to byte 12)
      0x02, 0, // VMHalt
      0, 0, 0x05, 0, // helper: VMNop, VMReturn
      0, 0, // file padding
    ]);
    expect(result.entries).toEqual([{ name: "main", entry: 1, offset: 6 }]);
    expect(result.helpers).toEqual([{ name: "tick", offset: 14 }]);
    expect(gen5ScriptCommandOffsets(result.bytes, "BW2").sort((a, b) => a - b)).toEqual([6, 12, 14, 16]);
    checkRelocations(result);
  });

  it("encodes signed backward calls and excludes helpers from the entry table", () => {
    const result = compileBw2Script(`def tick\n  nop\nend\n${script("call :tick")}`);
    expect(gen5ScriptEntries(result.bytes)).toEqual([10]);
    expect(readU32(result.bytes, 12) | 0).toBe(-10);
    expect(run(result.bytes).calls).toBe(1);
    checkRelocations(result);
  });

  it("keeps table slots independent of definition order", () => {
    const result = compileBw2Script(`work :result, 0x8001\nscript :second, entry: 2 do\nresult = 2\nend\nscript :first, entry: 1 do\nresult = 1\nend\n`);
    expect(result.entries.map((entry) => entry.name)).toEqual(["first", "second"]);
    expect(run(result.bytes, {}, 0).work.get(0x8001)).toBe(1);
    expect(run(result.bytes, {}, 1).work.get(0x8001)).toBe(2);
    checkRelocations(result);
  });

  it.each([
    ["==", 1, 1, true], ["==", 1, 2, false], ["!=", 1, 2, true], ["!=", 1, 1, false],
    ["<", 1, 2, true], ["<", 2, 1, false], ["<=", 2, 2, true], ["<=", 3, 2, false],
    [">", 3, 2, true], [">", 2, 3, false], [">=", 2, 2, true], [">=", 1, 2, false],
  ])("implements %s with %i and %i", (operator, left, right, matches) => {
    const result = compileBw2Script(withWork(`if count${operator}${right}\n  result = 10\nelse\n  result = 20\nend`));
    expect(run(result.bytes, { 0x8000: left }).work.get(0x8001)).toBe(matches ? 10 : 20);
    checkRelocations(result);
  });

  it("handles constant-left comparisons, work copies, and work-to-work comparisons", () => {
    const result = compileBw2Script(withWork(`result = count\nif 3 < count && count == result\n  result += count\nend`));
    expect(run(result.bytes, { 0x8000: 4 }).work.get(0x8001)).toBe(8);
    expect(result.instructions.some((instruction) => instruction.opcode === 0x1a)).toBe(true);
  });

  it("selects exclusive elsif branches and supports unless and postfix modifiers", () => {
    const result = compileBw2Script(withWork(`result = 0\nif count == 1\n  result = 10\nelsif count == 2\n  unless result != 0\n    result = 20\n  end\nelse\n  result = 30\nend\nresult += 1 unless count == 1\nreturn if count == 2\nresult += 2`));
    expect(run(result.bytes, { 0x8000: 1 }).work.get(0x8001)).toBe(12);
    expect(run(result.bytes, { 0x8000: 2 }).work.get(0x8001)).toBe(21);
    expect(run(result.bytes, { 0x8000: 3 }).work.get(0x8001)).toBe(33);
    checkRelocations(result);
  });

  it.each([0, 1, 2, 3, 4])("preserves boolean precedence and negation for count=%i", (count) => {
    const result = compileBw2Script(withWork(`if !(count == 0 || count == 1) && (count < 4 || count == 9)\n  result = 1\nelse\n  result = 0\nend`));
    expect(run(result.bytes, { 0x8000: count }).work.get(0x8001)).toBe(count === 2 || count === 3 ? 1 : 0);
  });

  it("short-circuits the right condition", () => {
    const and = compileBw2Script(withWork("if false && count == 1\nresult = 1\nend"));
    const or = compileBw2Script(withWork("if true || count == 1\nresult = 1\nend"));
    expect(run(and.bytes).comparisons).toBe(0);
    expect(run(or.bytes).comparisons).toBe(0);
    expect(run(or.bytes).work.get(0x8001)).toBe(1);
  });

  it("handles nested loops, next, break, and helper early returns", () => {
    const source = `work :count, 0x8000\nwork :result, 0x8001\nwork :inner, 0x8002\n${script(`count = 0\nresult = 0\nwhile count < 5 do\n  count += 1\n  next if count == 2\n  inner = 0\n  until inner >= 4\n    inner += 1\n    next if inner == 1\n    break if inner == 3\n    add_result\n  end\n  break if count == 4\nend`)}\ndef add_result()\n  result += 1\n  return\n  result += 100\nend\n`;
    const compiled = compileBw2Script(source);
    const result = run(compiled.bytes);
    expect(result.work.get(0x8000)).toBe(4);
    expect(result.work.get(0x8001)).toBe(3);
    expect(result.work.get(0x8002)).toBe(3);
    expect(result.calls).toBe(3);
    expect(compiled.relocations.some((relocation) => (readU32(compiled.bytes, relocation.operandOffset) | 0) < 0)).toBe(true);
    checkRelocations(compiled);
  });

  it.each([[0, 10], [1, 10], [2, 20], [3, 30]])("dispatches case count=%i without fall-through", (count, expected) => {
    const result = compileBw2Script(`CHOICE = 2\n${withWork("case count\nwhen 0, 1\nresult = 10\nwhen :CHOICE\nresult = 20\nelse\nresult = 30\nend")}`);
    expect(run(result.bytes, { 0x8000: count }).work.get(0x8001)).toBe(expected);
    checkRelocations(result);
  });

  it("recalculates all targets when code grows before and inside branches", () => {
    const makeSource = (insert: string) => `${withWork(`count = 0\n${insert}\nwhile count < 3\n${insert}\ntick\n${insert}\ncount += 1\nend`)}\ndef tick\n${insert}\nresult += 2\nend\n`;
    const small = compileBw2Script(makeSource(""));
    const large = compileBw2Script(makeSource("nop\nsleep 1\nnop"));
    expect(large.helpers[0].offset).toBeGreaterThan(small.helpers[0].offset);
    expect(run(small.bytes).work.get(0x8001)).toBe(6);
    expect(run(large.bytes).work.get(0x8001)).toBe(6);
    checkRelocations(small);
    checkRelocations(large);
  });

  it("accepts Ruby comments, CRLF, semicolons, and multiline argument lists", () => {
    const result = compileBw2Script("# header\r\nscript :main, entry: 1 do\r\n  play_sound(\r\n 0x547\r\n ); nop # comment\r\nend\r\n");
    expect(result.instructions[0]).toMatchObject({ line: 3, column: 3, opcode: 0xa6, operands: [0x547] });
    expect(result.instructions[1].opcode).toBe(0);
    checkRelocations(result);
  });

  it("compiles deterministically without carrying labels across invocations", () => {
    const source = withWork("while count < 2\ncount += 1\nend");
    expect(compileBw2Script(source)).toEqual(compileBw2Script(source));
  });

  it.each([
    ["", /At least one public script/],
    ["script :a, entry: 2 do\nend", /contiguous/],
    ["script :a, entry: 1 do\nend\nscript :b, entry: 1 do\nend", /contiguous/],
    [script("unknown"), /Unknown command or helper/],
    [script("call :nop"), /Unknown helper/],
    [script("constructor"), /Unknown command or helper/],
    [script("sleep 65536"), /unsigned 16-bit/],
    [script("sleep -1"), /unsigned 16-bit/],
    [script("nop 1"), /expects 0 arguments/],
    [script("count = 1"), /bound work variable/],
    [`LIMIT = 3\n${script("LIMIT = 4")}`, /bound work variable/],
    [`work :count, 12\n${script("nop")}`, /Work IDs/],
    [`work :a, 0x8000\nwork :b, 0x8000\n${script("nop")}`, /already bound/],
    [`work :count, 0x8000\nwork :count, 0x8001\n${script("nop")}`, /Duplicate/],
    [withWork("count += 0x4000"), /Arithmetic literals/],
    [withWork("if count\nnop\nend"), /Conditions require/],
    [withWork("if count < 2 < 3\nnop\nend"), /Comparison operands/],
    [withWork("case count\nwhen 1, 1\nnop\nend"), /Duplicate when/],
    [withWork("case count\nwhen result\nnop\nend"), /integer constants/],
    [script("break"), /only valid inside a loop/],
    [script("next"), /only valid inside a loop/],
    [script("main"), /only helpers can be called/],
    [script('say "Hello"'), /Text literals are not supported/],
    ["script :main, entry: 1 do\nif true\nnop\nend", /Expected 'end'/],
    [`${script("tick")}\ndef tick(value)\nend`, /Expected '\)'/],
    [`${script("tick 1")}\ndef tick\nend`, /Helpers do not accept arguments/],
    [`${script("tick")}\ndef tick\ntick\nend`, /Recursive helper/],
    [`${script("a")}\ndef a\nb\nend\ndef b\na\nend`, /Recursive helper/],
    [`${script("nop")}\ndef nop\nend`, /reserved name/],
    [`${script("tick")}\ndef tick\nbreak\nend`, /only valid inside a loop/],
  ])("rejects invalid source without returning bytes: %s", (source, message) => {
    expect(() => compileBw2Script(source)).toThrow(message);
    expect(() => compileBw2Script(source)).toThrow(Bw2ScriptCompileError);
  });

  it("reports precise source positions", () => {
    try { compileBw2Script(script("  unknown")); throw new Error("expected compile failure"); }
    catch (error) {
      expect(error).toBeInstanceOf(Bw2ScriptCompileError);
      expect((error as Bw2ScriptCompileError).position).toEqual({ line: 2, column: 3 });
    }
  });

  it("bounds deep conditions instead of overflowing the host stack", () => {
    expect(() => compileBw2Script(script(`if ${Array(150).fill("true").join(" && ")}\nnop\nend`))).toThrow(/nesting/);
    expect(() => compileBw2Script(script(`if ${"!".repeat(150)}true\nnop\nend`))).toThrow(/nesting/);
  });

  it("encodes the user's nonzero work jump exactly as the original false-stack branch", () => {
    const compiled = compileBw2Script("preserve_layout\ncondition_encoding :stack\nwork :bianca_intro_progress, 0x40a1\nscript :main, entry: 1 do\nif bianca_intro_progress != 0\njump :done\nend\nnop\nlabel :done\nhalt\nend");
    expect([...compiled.bytes]).toEqual([
      2, 0, 0, 0, 0x13, 0xfd,
      9, 0, 0xa1, 0x40, 8, 0, 0, 0, 0x11, 0, 1, 0,
      0x1f, 0, 0xff, 2, 0, 0, 0, 0, 0, 2, 0,
    ]);
    checkRelocations(compiled);
  });
  it.each([
    ["==", 2, 2, true], ["!=", 2, 2, false], ["<", 1, 2, true],
    ["<=", 2, 2, true], [">", 0xffff, 2, true], [">=", 1, 2, false],
  ])("executes unsigned stack comparison %s", (operator, left, right, matches) => {
    const compiled = compileBw2Script(`condition_encoding :stack\n${withWork(`if count ${operator} ${right}\nresult = 1\nelse\nresult = 0\nend`)}`);
    expect(run(compiled.bytes, { 0x8000: left }).work.get(0x8001)).toBe(Number(matches));
    checkRelocations(compiled);
  });
  it.each([[0, 0], [1, 1], [2, 0], [2, 1], [6, 3]])("executes eager stack AND/OR with normalized booleans, for stages %i/%i", (intro, gym) => {
    const compiled = compileBw2Script(`condition_encoding :stack\nwork :intro, 0x40a1\nwork :gym, 0x40a8\nwork :result, 0x8020\n${script("if (intro < 2 || gym >= 1) && !(intro == 6)\nresult = 1\nelse\nresult = 0\nend")}`);
    expect(run(compiled.bytes, { 0x40a1: intro, 0x40a8: gym }).work.get(0x8020)).toBe(Number((intro < 2 || gym >= 1) && intro !== 6));
    checkRelocations(compiled);
  });
  it("distinguishes literal and work stack pushes even when the literal resembles a work ID", () => {
    const compiled = compileBw2Script(`condition_encoding :stack\n${withWork("if count == 0x40a1\nresult = 1\nend")}`);
    expect(compiled.instructions.slice(0, 2).map((i) => [i.opcode, i.operands])).toEqual([[9, [0x8000]], [8, [0x40a1]]]);
    expect(run(compiled.bytes, { 0x8000: 0x40a1, 0x40a1: 0 }).work.get(0x8001)).toBe(1);
  });
  it("reads real event flags separately and rejects work aliases passed to flag_set?", () => {
    const compiled = compileBw2Script(`work :result, 0x8020\n${script("if flag_set?(0x123)\nresult = 1\nelse\nresult = 0\nend")}`);
    expect(run(compiled.bytes, {}, 0, new Set([0x123])).work.get(0x8020)).toBe(1);
    expect(run(compiled.bytes).work.get(0x8020)).toBe(0);
    expect(() => compileBw2Script(`work :bianca_intro_progress, 0x40a1\n${script("if flag_set?(bianca_intro_progress)\nnop\nend")}`)).toThrow(/integer comparison/);
  });
  it("lets a complete condition override its encoding without changing the legacy default", () => {
    const body = "if count < 2\nresult = 1\nend";
    const legacy = compileBw2Script(withWork(body));
    const explicit = compileBw2Script(`condition_encoding :stack\n${withWork(body.replace("count < 2", "vm_compare(count < 2)"))}`);
    expect(explicit.bytes).toEqual(legacy.bytes);
    const stack = compileBw2Script(withWork(body.replace("count < 2", "stack_condition(count < 2)")));
    expect(stack.instructions[0].opcode).toBe(9);
    expect(run(stack.bytes, { 0x8000: 1 }).work.get(0x8001)).toBe(1);
  });
  it("accepts bound names only in documented work operands, preserving constant operands", () => {
    const prefix = "preserve_layout\nwork :bianca_intro_progress, 0x40a1\n";
    expect(compileBw2Script(prefix + script("stack_push bianca_intro_progress\nwork_set_const bianca_intro_progress, 0\nplayer_get_g_pos bianca_intro_progress, bianca_intro_progress\nhalt")).instructions.slice(0, 3).map((i) => i.operands)).toEqual([[0x40a1], [0x40a1, 0], [0x40a1, 0x40a1]]);
    expect(() => compileBw2Script(prefix + script("stack_push_const bianca_intro_progress"))).toThrow(/literal\/constant/);
    expect(() => compileBw2Script(prefix + script("work_cmp_const bianca_intro_progress, bianca_intro_progress"))).toThrow(/literal\/constant/);
    expect(() => compileBw2Script(`condition_encoding :stack\n${withWork("if count && true\nnop\nend")}`)).toThrow(/Boolean comparisons/);
    expect(() => compileBw2Script(`condition_encoding :stack\n${withWork("if count\nnop\nend")}`)).toThrow(/explicit comparison/);
  });
});

// Independent bytecode decoder/VM for the documented control-flow subset.
// It executes the emitted bytes, not the compiler's instruction metadata.
const SIZES: Record<number, number> = { 0: 2, 2: 2, 3: 4, 4: 6, 5: 2, 8: 4, 9: 4, 0x10: 4, 0x11: 4, 0x19: 6, 0x1a: 6, 0x1e: 6, 0x1f: 7, 0x26: 6, 0x27: 6, 0x28: 6, 0x29: 6, 0x2e: 2, 0x2f: 2, 0x74: 2, 0xa6: 4 };

function checkRelocations(result: CompiledBw2Script): void {
  const boundaries = new Set<number>();
  let cursor = result.entries.length * 4 + 2;
  for (const instruction of result.instructions) {
    boundaries.add(cursor);
    expect(instruction.offset).toBe(cursor);
    const opcode = readU16(result.bytes, cursor);
    expect(instruction.opcode).toBe(opcode);
    const size = SIZES[opcode];
    expect(size, `unsupported test opcode 0x${opcode.toString(16)}`).toBeDefined();
    expect(cursor + size).toBeLessThanOrEqual(result.bytes.length);
    cursor += size;
  }
  expect(result.bytes.length - cursor).toBeLessThan(4);
  expect([...result.bytes.subarray(cursor)].every((byte) => byte === 0)).toBe(true);
  for (const relocation of result.relocations) {
    const decodedTarget = relocation.operandOffset + 4 + (readU32(result.bytes, relocation.operandOffset) | 0);
    expect(decodedTarget).toBe(relocation.targetOffset);
    expect(boundaries.has(decodedTarget), `target ${decodedTarget} is not an instruction boundary`).toBe(true);
  }
  expect(gen5ScriptEntries(result.bytes)).toEqual(result.entries.map((entry) => entry.offset));
}

function run(bytes: Uint8Array, initial: Record<number, number> = {}, entry = 0, flags: ReadonlySet<number> = new Set()): { work: Map<number, number>; calls: number; comparisons: number } {
  const work = new Map(Object.entries(initial).map(([id, value]) => [Number(id), value]));
  const stack: number[] = [];
  const values: number[] = [];
  const pop = (): number => { const value = values.pop(); if (value === undefined) throw new Error("Empty expression stack"); return value; };
  let pc = gen5ScriptEntries(bytes)[entry], comparison = 0, calls = 0, comparisons = 0;
  const resolve = (value: number): number => value >= 0x4000 ? work.get(value) ?? 0 : value;
  for (let steps = 0; steps < 10_000; steps++) {
    if (pc === undefined || pc < 0 || pc + 2 > bytes.length) throw new Error(`Invalid PC ${pc}`);
    const opcode = readU16(bytes, pc), size = SIZES[opcode];
    if (!size || pc + size > bytes.length) throw new Error(`Invalid instruction at ${pc}`);
    const first = readU16(bytes, pc + 2), second = readU16(bytes, pc + 4);
    const next = pc + size;
    switch (opcode) {
      case 2: return { work, calls, comparisons };
      case 4: stack.push(next); calls++; pc = next + (readU32(bytes, pc + 2) | 0); continue;
      case 5: { const destination = stack.pop(); if (destination === undefined) throw new Error("VMReturn with an empty call stack"); pc = destination; continue; }
      case 8: values.push(first); break;
      case 9: values.push(resolve(first)); break;
      case 0x10: values.push(Number(flags.has(resolve(first)))); break;
      case 0x11: {
        const right = pop(), left = pop();
        const answer = [left < right, left === right, left > right, left <= right, left >= right, left !== right, left === 1 || right === 1, left === 1 && right === 1][first];
        if (answer === undefined) throw new Error(`Unknown stack operator ${first}`);
        values.push(Number(answer)); comparisons++; break;
      }
      case 0x19:
      case 0x1a: {
        const left = work.get(first) ?? 0, right = opcode === 0x19 ? second : work.get(second) ?? 0;
        comparison = left < right ? -1 : left > right ? 1 : 0;
        comparisons++;
        break;
      }
      case 0x1e: pc = next + (readU32(bytes, pc + 2) | 0); continue;
      case 0x1f: {
        const condition = bytes[pc + 2];
        const jump = condition === 0xff ? pop() !== 1 : [comparison < 0, comparison === 0, comparison > 0, comparison <= 0, comparison >= 0, comparison !== 0][condition];
        if (jump === undefined) throw new Error(`Unknown condition ${condition}`);
        pc = jump ? next + (readU32(bytes, pc + 3) | 0) : next;
        continue;
      }
      case 0x26: work.set(first, ((work.get(first) ?? 0) + resolve(second)) & 0xffff); break;
      case 0x27: work.set(first, ((work.get(first) ?? 0) - resolve(second)) & 0xffff); break;
      case 0x28: work.set(first, second); break;
      case 0x29: work.set(first, work.get(second) ?? 0); break;
    }
    pc = next;
  }
  throw new Error("Test VM exceeded its instruction budget");
}
