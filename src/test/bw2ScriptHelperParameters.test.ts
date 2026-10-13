import { describe, expect, it } from "vitest";
import { readU16, readU32 } from "../nds/binary";
import { compileBw2Script, decompileBw2Script } from "../pokeweb/bw2ScriptCompiler";
import { gen5ScriptCommandSize, gen5ScriptEntries } from "../pokeweb/gen5ScriptCommands";
import { BW2_SCRATCH_WORK_FIRST, BW2_SCRATCH_WORK_END } from "../pokeweb/bw2ScriptCompiler/helperFrames";

const program = (body: string, helpers = "", prefix = "") => `${prefix}work :output, 0x4000\nscript :main, entry: 1 do\n${body}\nend\n${helpers}`;
// Read only the emitted bytes. Native BW2 uses one stack for values and local
// return addresses, so an unbalanced frame really does corrupt its return PC.
function execute(bytes: Uint8Array, initial: Record<number, number> = {}, global?: (works: Map<number, number>, id: number) => void) {
  const works = new Map(Object.entries(initial).map(([key, value]) => [Number(key), value])), stack: number[] = [];
  let pc = gen5ScriptEntries(bytes)[0], cmp = 0, maxStack = 0;
  const pop = () => { const value = stack.pop(); if (value === undefined) throw new Error("Stack underflow"); return value; };
  const resolve = (id: number) => id >= 0x4000 ? works.get(id) ?? 0 : id;
  for (let n = 0; n < 10000; n++) {
    const op = readU16(bytes, pc), size = gen5ScriptCommandSize(op, "BW2"), first = readU16(bytes, pc + 2), second = readU16(bytes, pc + 4), next = pc + size;
    if (!size || pc + size > bytes.length) throw new Error(`Invalid opcode/PC ${pc}`);
    let destination = next;
    switch (op) {
      case 2: expect(stack).toEqual([]); return { works, maxStack };
      case 4: stack.push(next); destination = next + (readU32(bytes, pc + 2) | 0); break;
      case 5: destination = pop(); break;
      case 8: stack.push(first); break;
      case 9: stack.push(resolve(first)); break;
      case 0x0a: works.set(first, pop() & 0xffff); break;
      case 0x0b: pop(); break;
      case 0x11: { const right = pop(), left = pop(); stack.push(Number([left < right, left === right, left > right, left <= right, left >= right, left !== right, left === 1 || right === 1, left === 1 && right === 1][first])); break; }
      case 0x19: case 0x1a: { const left = resolve(first), right = op === 0x19 ? second : resolve(second); cmp = left < right ? -1 : left > right ? 1 : 0; break; }
      case 0x1e: destination = next + (readU32(bytes, pc + 2) | 0); break;
      case 0x1f: { const test = bytes[pc + 2] === 255 ? pop() !== 1 : [cmp < 0, cmp === 0, cmp > 0, cmp <= 0, cmp >= 0, cmp !== 0][bytes[pc + 2]]; if (test) destination = next + (readU32(bytes, pc + 3) | 0); break; }
      case 0x26: works.set(first, (resolve(first) + resolve(second)) & 0xffff); break;
      case 0x27: works.set(first, (resolve(first) - resolve(second)) & 0xffff); break;
      case 0x28: works.set(first, second); break;
      case 0x29: works.set(first, works.get(second) ?? 0); break;
      case 0x2a: works.set(first, resolve(second)); break;
      case 0x1c: global?.(works, first); break;
      default: if (![0, 1, 3, 0x2e, 0x2f, 0x30, 0x31, 0x32, 0x3c, 0x3d, 0x3e, 0x3f, 0x74, 0xa6].includes(op)) throw new Error(`Unsupported test opcode ${op}`);
    }
    maxStack = Math.max(maxStack, stack.length); pc = destination;
  }
  throw new Error("Instruction budget exceeded");
}
const sentinels = () => Object.fromEntries(Array.from({ length: BW2_SCRATCH_WORK_END - BW2_SCRATCH_WORK_FIRST }, (_, n) => [BW2_SCRATCH_WORK_FIRST + n, 20000 + n]));
const expectRestored = (works: Map<number, number>, initial: Record<number, number>) => { for (const [id, value] of Object.entries(initial)) expect(works.get(Number(id)), `work ${id}`).toBe(value); };

describe("helper parameters and automatic local Works", () => {
  it.each(["set_output(7)", "set_output 7", "call :set_output, 7", "call(:set_output, 7)"])("passes positional values using %s", (call) => {
    const compiled = compileBw2Script(program(call, "def set_output(value)\noutput = value\nend")), initial = sentinels();
    const result = execute(compiled.bytes, initial);
    expect(result.works.get(0x4000)).toBe(7); expectRestored(result.works, initial);
    expect(compiled.scratchWorks?.find((frame) => frame.routine === "set_output")?.parameters).toEqual([{ name: "value", id: 0x8020 }]);
  });
  it("snapshots swapped and repeated arguments before parameter slots overwrite caller locals", () => {
    const source = program("left = 3\nright = 8\npair(right, left)\noutput += left\noutput += right", "def pair(left, right)\noutput = left\noutput += right\nleft = 100\nright = 200\nend");
    const initial = sentinels(), result = execute(compileBw2Script(source).bytes, initial);
    expect(result.works.get(0x4000)).toBe(22); expectRestored(result.works, initial);
    expect(execute(compileBw2Script(source.replace("pair(right, left)", "pair(right, right)")).bytes).works.get(0x4000)).toBe(27);
  });
  it("preserves nested caller locals, early returns, and full unsigned literal values", () => {
    const source = program("counter = 4\nouter(0xffff)\noutput += counter", "def outer(value)\ncounter = 6\ninner(value, counter)\noutput += counter\nreturn\nend\ndef inner(value, counter)\noutput = value\nreturn if counter == 6\noutput = 0\nend");
    const initial = sentinels(), result = execute(compileBw2Script(source).bytes, initial);
    expect(result.works.get(0x4000)).toBe(9); expectRestored(result.works, initial);
  });
  it("keeps locals scoped per routine and initializes them for every call", () => {
    const compiled = compileBw2Script(program("counter = 7\nstep(2)\nstep(2)\noutput += counter", "def step(times)\ncounter += 1\noutput += counter\nreturn\nend"));
    const initial = sentinels(), result = execute(compiled.bytes, initial);
    expect(result.works.get(0x4000)).toBe(9); expectRestored(result.works, initial);
    expect(() => compileBw2Script(program("output = hidden", "def unused\nhidden = 1\nend"))).toThrow(/Unknown binding 'hidden'/);
  });
  it("allows parameter shadowing without writing an explicitly bound global Work", () => {
    const initial = { ...sentinels(), 0x4001: 99 };
    const result = execute(compileBw2Script(program("step(3)", "def step(value)\nvalue += 1\noutput = value\nend", "work :value, 0x4001\n")).bytes, initial);
    expect(result.works.get(0x4000)).toBe(4); expectRestored(result.works, initial);
  });
  it("excludes explicit Works, constants, raw operands, and raw encoded words from allocation", () => {
    const source = "preserve_layout\nwork :reserved, 0x8020\nRESERVED = 0x8021\nscript :main, entry: 1 do\nlocal_value = 1\nstack_push 0x8022\nstack_discard\nreturn\nend\ndata :raw, 0x23, 0x80\n";
    expect(compileBw2Script(source).scratchWorks![0].locals).toEqual([{ name: "local_value", id: 0x8024 }]);
  });
  it("preserves locals while legacy helpers and synchronous global calls run", () => {
    const source = program("value = 6\nlegacy\nreward(value, 2)\noutput += value", "def legacy\nrt_call_global 12345\nend\ndef reward(item, quantity)\ngive_item item: item, quantity: quantity\noutput += item\nend", "preserve_layout\n").replace("def legacy\nrt_call_global 12345\nend", "def legacy\nrt_call_global 12345\nvm_return\nend");
    const original = sentinels(), received: number[][] = [];
    const compiled = compileBw2Script(source), result = execute(compiled.bytes, original, (works, id) => {
      if (id === 2805) received.push([works.get(0x8000)!, works.get(0x8001)!]);
      for (let slot = BW2_SCRATCH_WORK_FIRST; slot < BW2_SCRATCH_WORK_END; slot++) works.set(slot, 123);
    });
    expect(received).toEqual([[6, 2]]); expect(result.works.get(0x4000)).toBe(12);
    // The public local retains its entry value. The second slot was written by
    // legacy before reward borrowed it, so reward restores that call-time value.
    expect(result.works.get(0x8020)).toBe(original[0x8020]);
    expect(result.works.get(0x8021)).toBe(123);
  });
  it("balances frames inside loops and stack-encoded conditions", () => {
    const source = program("counter = 0\nwhile counter < 4\nstep(counter)\ncounter += 1\nend", "def step(value)\nreturn if value == 2\noutput += value\nend", "condition_encoding :stack\n");
    const initial = sentinels(), result = execute(compileBw2Script(source).bytes, initial);
    expect(result.works.get(0x4000)).toBe(4); expectRestored(result.works, initial);
  });
  it("round trips new helper bytecode without relying on stored parameter names", () => {
    const compiled = compileBw2Script(program("value = 4\nstep(value)", "def step(value)\noutput = value\nend", "preserve_layout\n"));
    const decoded = decompileBw2Script(compiled.bytes);
    expect(decoded.editable).toBe(true); expect(compileBw2Script(decoded.source).bytes).toEqual(compiled.bytes);
    const grown = compileBw2Script(decoded.source.replace(/^(script :\w+, entry: \d+ do)\n/m, "$1\n  nop\n"));
    expect(decompileBw2Script(grown.bytes).editable).toBe(true);
    expect(execute(grown.bytes).works.get(0x4000)).toBe(4);
  });
  it("does not change the hand-encoded legacy zero-argument helper layout", () => {
    const compiled = compileBw2Script("preserve_layout\nscript :main, entry: 1 do\ncall :helper\nhalt\nend\ndef helper\nnop\nvm_return\nend");
    expect(compiled.scratchWorks).toBeUndefined();
    expect([...compiled.bytes]).toEqual([2, 0, 0, 0, 0x13, 0xfd, 4, 0, 2, 0, 0, 0, 2, 0, 0, 0, 5, 0]);
  });
  it.each([
    [program("step(1)", "def step(value, value)\nend"), /Duplicate helper parameter/],
    [program("step(1)", "def step(VALUE)\nend"), /lowercase/],
    [program("step(1)", "def step(sleep)\nend"), /Reserved local/],
    [program("step(1)", "def step(a, b)\nend"), /expects 2 arguments/],
    [program("step(:none)", "def step(value)\nend"), /integer values/],
    [program("step(1)", "def step(value)\nstep(value)\nend", "preserve_layout\n"), /Recursive helper/],
    [program("step(1)", "def step(value)\nfinish_interaction\nend"), /must return/],
    [program("value = 1\nlegacy", "def legacy\nhalt\nend", "preserve_layout\n"), /scratch Works are saved/],
    [program("value = 1\nstack_discard", "", "preserve_layout\n"), /saved Work or return address/],
    [program("value = 1\nrt_call_global_async 12345", "", "preserve_layout\n"), /Asynchronous/],
    [program("value = 1\njump :other", "def other\nvm_return\nend", "preserve_layout\n"), /Jumps cannot cross/],
    [program("call_if 1, :step", "def step(value)\nreturn\nend", "preserve_layout\n"), /named helper invocation/],
    [program("step(1)", "def step(value)\nlabel :inside\nreturn\nend", "preserve_layout\nentry 2, :inside\n"), /Entry aliases/],
  ] as const)("rejects unsafe parameter/local control flow", (source, message) => { expect(() => compileBw2Script(source)).toThrow(message); });
  it("reports exhausted scratch pools and growing raw stacks", () => {
    const reserved = Array.from({ length: 52 }, (_, n) => `work :slot_${n}, ${0x8020 + n}`).join("\n") + "\n";
    expect(() => compileBw2Script(program("value = 1", "", reserved))).toThrow(/No free scratch Works/);
    expect(() => compileBw2Script(program("value = 1\nlabel :loop\nstack_push_const 1\njump :loop", "", "preserve_layout\n"))).toThrow(/255-word/);
  });
});
