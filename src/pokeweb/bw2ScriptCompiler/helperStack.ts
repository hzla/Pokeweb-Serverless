import { gen5ScriptCommandSize } from "../gen5ScriptCommands";
import { Bw2ScriptCompileError, type CompiledBw2Script, type SourcePosition } from "./types";

// US BW2 field VMs allocate 256 words; push accepts depth + 1 < 256.
// Local return addresses and expression values use this same stack.
export const BW2_HELPER_STACK_LIMIT = 255;
export type ScratchStackAction = { kind: "save" | "restore"; id: number };
type StackWord = { kind: "value" } | { kind: "save"; id: number } | { kind: "return"; offset: number };

/** Check the actual lowered instruction graph, including both conditional
 * paths, shared return/value stack, frame boundaries, and early exits. */
export function verifyBw2HelperStack(compiled: CompiledBw2Script, actions: ReadonlyMap<number, ScratchStackAction>): void {
  const instructions = new Map(compiled.instructions.map((instruction) => [instruction.offset, instruction]));
  const pending: { offset: number; stack: StackWord[] }[] = compiled.entries.map((entry) => ({ offset: entry.offset, stack: [] }));
  for (const frame of compiled.scratchWorks ?? []) {
    const helper = compiled.helpers.find((helper) => helper.name === frame.routine);
    if (helper) pending.push({ offset: helper.offset, stack: [...[...frame.parameters, ...frame.locals].map(({ id }): StackWord => ({ kind: "save", id })), { kind: "return", offset: -1 }] });
  }
  function fail(message: string, position: SourcePosition): never { throw new Bw2ScriptCompileError(message, position); }
  const visited = new Set<string>();
  while (pending.length) {
    const { offset, stack: input } = pending.pop()!;
    if (offset === -1) continue;
    const instruction = instructions.get(offset);
    if (!instruction) fail("Automatic helper control flow reaches data or falls outside decoded code", { line: 1, column: 1 });
    const key = `${offset}:${input.map((word) => word.kind === "value" ? "v" : word.kind === "save" ? `s${word.id}` : `r${word.offset}`).join(",")}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (visited.size > 100_000) fail("Automatic helper stack verification exceeded its state limit", instruction);
    const stack = [...input], action = actions.get(offset), opcode = instruction.opcode;
    const next = offset + gen5ScriptCommandSize(opcode, "BW2", instruction.dispatchId ?? compiled.overlayId);
    const push = (word: StackWord): void => {
      if (stack.length >= BW2_HELPER_STACK_LIMIT) fail("Automatic helper calls exceed the BW2 VM's 255-word shared stack limit", instruction);
      stack.push(word);
    };
    const value = (): void => {
      const word = stack.pop();
      if (!word || word.kind !== "value") fail("A stack command consumes a saved Work or return address; balance raw stack commands around automatic helpers", instruction);
    };
    if (action?.kind === "save") push({ kind: "save", id: action.id });
    else if (action?.kind === "restore") {
      const word = stack.pop();
      if (!word || word.kind !== "save" || word.id !== action.id) fail("Automatic scratch Work restoration has an unbalanced stack", instruction);
    } else if ([8, 9, 0x10].includes(opcode)) push({ kind: "value" });
    else if ([0x0a, 0x0b].includes(opcode)) value();
    else if (opcode >= 0x0c && opcode <= 0x11 && opcode !== 0x10) { value(); value(); push({ kind: "value" }); }
    else if ([0x1f, 0x20].includes(opcode) && instruction.operands[0] === 0xff) value();
    const enqueue = (at: number): void => { pending.push({ offset: at, stack: [...stack] }); };
    const target = (operand: number): number => {
      const relocation = compiled.relocations.find((relocation) => relocation.operandOffset === offset + (operand === 0 ? 2 : 3) && relocation.kind === (opcode === 0x1e || opcode === 0x1f ? "jump" : "call"));
      if (!relocation) fail("Automatic helper transfer is missing its symbolic relocation", instruction);
      return relocation.targetOffset;
    };
    if ([2, 0x1d].includes(opcode)) {
      if (stack.some((word) => word.kind === "save")) fail("A helper halts while scratch Works are saved; return to the caller so they can be restored", instruction);
    } else if (opcode === 5) {
      // Shared/global public entries can return to engine-provided context.
      // Generated local calls always carry an explicit return word here.
      if (!stack.length) continue;
      const word = stack.pop();
      if (!word || word.kind !== "return") fail("A helper returns with an unbalanced stack or without a local call", instruction);
      enqueue(word.offset);
    } else if ([4, 0x20].includes(opcode)) {
      const destination = target(opcode === 4 ? 0 : 1);
      if (opcode === 0x20) enqueue(next);
      push({ kind: "return", offset: next }); enqueue(destination);
    } else if (opcode === 0x1e) enqueue(target(0));
    else { if (opcode === 0x1f) enqueue(target(1)); enqueue(next); }
  }
}
