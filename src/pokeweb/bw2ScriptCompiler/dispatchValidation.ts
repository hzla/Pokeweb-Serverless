import { bw2CommandByOpcode } from "./commands";

type Decoded = { offset: number; next: number; opcode: number; args: number[]; targets: ReadonlyMap<number, number>; dispatchId?: number };
/** Follow both branch alternatives and local call/return frames. Source hints
 * cannot excuse a live path reaching data or decoding under the wrong table. */
export function verifyBw2ScriptDispatch(entries: readonly number[], instructions: ReadonlyMap<number, Decoded>, overlayId?: number): string[] {
  const warnings = new Set<string>();
  const pending = [...new Set(entries)].map((offset) => ({ offset, dispatch: overlayId, returns: [] as number[] }));
  const visited = new Set<string>();
  while (pending.length) {
    const state = pending.pop()!, key = `${state.offset}:${state.dispatch}:${state.returns.join(",")}`;
    if (visited.has(key)) continue; visited.add(key);
    if (visited.size > 100_000) { warnings.add("Control-flow verification exceeded its state limit; edits are disabled."); break; }
    const instruction = instructions.get(state.offset);
    if (!instruction) { warnings.add(`Live control flow reaches undecoded bytes at 0x${state.offset.toString(16)}; edits are disabled.`); continue; }
    const layout = bw2CommandByOpcode(instruction.opcode, state.dispatch)?.definition;
    const decoded = bw2CommandByOpcode(instruction.opcode, instruction.dispatchId)?.definition;
    if (!layout || !decoded || (instruction.opcode >= 1000 && instruction.dispatchId !== state.dispatch) || layout.widths.length !== decoded.widths.length || layout.widths.some((width, i) => width !== decoded.widths[i])) {
      warnings.add(`Conflicting command-table state at 0x${state.offset.toString(16)}; edits are disabled.`); continue;
    }
    let dispatch = state.dispatch;
    if (overlayId === 58 && instruction.opcode === 0x2c6) dispatch = 60;
    if (overlayId === 58 && instruction.opcode === 0x2c7) dispatch = 58;
    const enqueue = (offset: number, returns = state.returns) => pending.push({ offset, dispatch, returns });
    if ([2, 0x1d].includes(instruction.opcode)) continue;
    if (instruction.opcode === 5) { if (state.returns.length) enqueue(state.returns.at(-1)!, state.returns.slice(0, -1)); continue; }
    if (instruction.opcode === 4 || instruction.opcode === 0x20) {
      if (state.returns.length >= 64) warnings.add("Local-call verification exceeded its depth limit; edits are disabled.");
      else enqueue(instruction.targets.get(instruction.opcode === 4 ? 0 : 1)!, [...state.returns, instruction.next]);
      if (instruction.opcode === 0x20) enqueue(instruction.next);
    } else if (instruction.opcode === 0x1e) enqueue(instruction.targets.get(0)!);
    else { if (instruction.opcode === 0x1f) enqueue(instruction.targets.get(1)!); enqueue(instruction.next); }
  }
  return [...warnings];
}
