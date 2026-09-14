import expansion from "../assets/codeinjection/battleTypeHudPanelExpansion.json";

export const battleTypeHudPanelExpansion = expansion;
type Edit = { offset: number; old: string; new: string };

/** Checked structural edits; the installer also verifies complete resource hashes. */
export function transformBattleTypeHudPanel(raw: Uint8Array, member: keyof typeof expansion, undo = false): Uint8Array {
  const change = expansion[member];
  const bytes = (hex: string) => Uint8Array.from(hex.match(/../gu) ?? [], value => Number.parseInt(value, 16));
  const apply = (source: Uint8Array, edits: Edit[], reverse: boolean): Uint8Array => {
    let data = source.slice();
    for (const edit of reverse ? [...edits].reverse() : edits) {
      const old = bytes(reverse ? edit.new : edit.old), next = bytes(reverse ? edit.old : edit.new);
      if (edit.offset > data.length || old.some((value, i) => data[edit.offset + i] !== value)) {
        throw new Error(`Type Icons panel layout mismatch in member ${member}.`);
      }
      const result = new Uint8Array(data.length - old.length + next.length);
      result.set(data.subarray(0, edit.offset)); result.set(next, edit.offset);
      result.set(data.subarray(edit.offset + old.length), edit.offset + next.length);
      data = result;
    }
    return data;
  };
  if (!undo) {
    try { return apply(raw, change.edits, false); } catch { /* Try a verified prior expansion. */ }
  }
  for (const variant of [change, ...change.previous]) {
    try {
      const native = apply(raw, variant.edits, true);
      return undo ? native : apply(native, change.edits, false);
    } catch { /* Each attempt operates on a copy, preserving the input. */ }
  }
  throw new Error(`Type Icons panel layout mismatch in member ${member}.`);
}
