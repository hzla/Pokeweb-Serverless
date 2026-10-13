/** High-level spellings for verified, fixed BW2 command sequences.
 * Numbers in the template are encoded operands; strings name macro keywords.
 * Keep the original work/literal setter opcode, even for constant arguments. */
export type Bw2ScriptMacro = {
  description: string;
  note?: string;
  parameters: readonly { name: string; description: string; literalOnly?: boolean; aliases?: Readonly<Record<string, number>> }[];
  sequence: readonly { opcode: number; args: readonly (number | string)[] }[];
};
export const BW2_SCRIPT_MACROS: Readonly<Record<string, Bw2ScriptMacro>> = {
  talk: {
    description: "Play the interaction sound, turn the actor being talked to toward the player, display its dialogue, wait for final confirmation, and close the balloon.",
    note: "Uses the current map's story bank, automatic balloon placement, and the normal balloon style. Does not lock actors or terminate the event.",
    parameters: [{ name: "message", description: "Zero-based entry in the current script's story text bank. Literal below 0x4000, constant, or bound runtime work variable." }],
    sequence: [
      { opcode: 0xa6, args: [0x0547] },
      { opcode: 0x74, args: [] },
      { opcode: 0x3d, args: [0x0400, "message", 0, 0] },
      { opcode: 0x32, args: [] },
      { opcode: 0x3e, args: [] },
    ],
  },
  read_sign: {
    description: "Record the sign-reading action, play the interaction sound, display a sign from the current story bank, and close its window.",
    note: "Retains the original sign action-log operands (17, 0). Does not lock actors or terminate the event. The sidebar uses the standard dialogue preview; alternate sign frames are not simulated.",
    parameters: [
      { name: "message", description: "Zero-based sign entry in the current script's story text bank. Literal below 0x4000, constant, or bound runtime work variable." },
      { name: "style", description: "Literal sign-window style: :info (0), :town (1), :post (2), or :road (3). Numeric values and constants are also accepted; this operand does not read a work variable.", literalOnly: true, aliases: { info: 0, town: 1, post: 2, road: 3 } },
    ],
    sequence: [
      { opcode: 0x276, args: [17, 0] },
      { opcode: 0xa6, args: [0x0547] },
      { opcode: 0x43, args: ["message", "style"] },
      { opcode: 0x44, args: [] },
    ],
  },
  give_item: {
    description: "Give an item through global script 2805, including its bag-capacity handling and confirmation. Save and restore shared parameter slots 0 and 1 around the call.",
    note: "Retains work_set opcode 0x002a and the original setter order. Work arguments are read in that order; shared parameter values are restored in reverse order. This is distinct from the item-success presentation helper.",
    parameters: [
      { name: "item", description: "Item ID to award. Literal below 0x4000, named constant, or bound runtime work variable." },
      { name: "quantity", description: "Number of items to award. Literal below 0x4000, constant, or bound runtime work variable." },
    ],
    sequence: [
      { opcode: 0x09, args: [0x8000] },
      { opcode: 0x09, args: [0x8001] },
      { opcode: 0x2a, args: [0x8000, "item"] },
      { opcode: 0x2a, args: [0x8001, "quantity"] },
      { opcode: 0x1c, args: [2805] },
      { opcode: 0x0a, args: [0x8001] },
      { opcode: 0x0a, args: [0x8000] },
    ],
  },
  finish_interaction: {
    description: "Perform the script completion check, unlock actors, and halt this script VM.",
    note: "Ends the event, including when invoked from a helper; it does not return to the caller. Keep it after message and movement cleanup. The completion check is not a one-frame delay.",
    parameters: [],
    sequence: [
      { opcode: 0x30, args: [] },
      { opcode: 0x2f, args: [] },
      { opcode: 0x02, args: [] },
    ],
  },
  stop_companion_following: {
    description: "End the trainer companion's following state through global script 10536. Save and restore shared parameter slots 0 and 1 around the call.",
    note: "Retains work_set opcode 0x002a and the original setter order, with reverse-order parameter restoration. The movement keyword is an actor behavior code, separate from a movement-list label.",
    parameters: [
      { name: "script", description: "Interaction script ID assigned to the released companion. Literal below 0x4000, constant, or bound work variable." },
      { name: "movement", description: "Actor movement behavior assigned to the released companion; :none means no autonomous movement (0). Other codes may be numeric, constant, or bound work values.", aliases: { none: 0 } },
    ],
    sequence: [
      { opcode: 0x09, args: [0x8000] },
      { opcode: 0x09, args: [0x8001] },
      { opcode: 0x2a, args: [0x8000, "script"] },
      { opcode: 0x2a, args: [0x8001, "movement"] },
      { opcode: 0x1c, args: [10536] },
      { opcode: 0x0a, args: [0x8001] },
      { opcode: 0x0a, args: [0x8000] },
    ],
  },
};
export function bw2ScriptMacroByName(name: string): Bw2ScriptMacro | undefined {
  return Object.hasOwn(BW2_SCRIPT_MACROS, name) ? BW2_SCRIPT_MACROS[name] : undefined;
}
