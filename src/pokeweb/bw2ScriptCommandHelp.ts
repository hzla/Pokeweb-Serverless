import { bw2CommandFactByName, bw2CommandFactByOpcode } from "./bw2ScriptCompiler/commandFacts";
import { bw2CommandByName } from "./bw2ScriptCompiler/commands";
import { bw2MovementByName } from "./bw2ScriptCompiler/movementCommands";
import { bw2ScriptMacroByName } from "./bw2ScriptCompiler/macros";

export type Bw2ScriptCommandHelp = {
  name: string; opcode: number; description: string; note?: string;
  macro?: boolean;
  commandCount?: number;
  parameters: { name: string; description: string; width: number }[];
};
type Semantics = { description: string; parameters: [string, string][]; note?: string };
export function bw2MovementCommandHelp(name: string): Bw2ScriptCommandHelp | undefined {
  const command = bw2MovementByName(name);
  if (command) return { ...command, parameters: [{ name: "count", width: 2, description: "Literal 16-bit movement parameter, usually a repeat count. Its effect depends on the action; it does not read a work variable." }], note: "Movement records use their own opcode namespace. end emits the movement terminator automatically." };
  if (name === "finish") return { name, opcode: 0xfe, description: "End the movement list with an explicit terminator parameter.", parameters: [{ name: "parameter", width: 2, description: "Original 16-bit terminator parameter. Usually zero; omit finish for the default zero terminator." }] };
  if (name === "raw_step") return { name, opcode: 0, description: "Preserve a movement record as two literal 16-bit words.", parameters: [{ name: "opcode", width: 2, description: "Unverified movement ID." }, { name: "parameter", width: 2, description: "Original encoded parameter." }], note: "This numeric representation preserves bytes; it does not establish the action's meaning or make an unsupported ROM import editable." };
}
const workId = "Existing work-variable ID. This command reads the variable, rather than its numeric ID.";
const actor = "Local actor/object ID from this map's event data. It is separate from its script entry number.";
const direction = "Facing direction: 0 = up, 1 = down, 2 = left, 3 = right. Work/literal operands can also read a work variable.";
const stackComparison = "0 <, 1 ==, 2 >, 3 <=, 4 >=, 5 !=, 6 OR, 7 AND. Binary operations pop right then left and push a boolean result.";
const HELP: Readonly<Record<number, Semantics>> = {
  0: { description: "Do nothing and continue to the next command.", parameters: [] },
  1: { description: "Alternate VM no-op; continue to the next command.", parameters: [] },
  2: { description: "Halt this script's VM. This is the explicit public-entry terminator in imported source.", parameters: [] },
  3: { description: "Pause script execution for a frame countdown.", parameters: [["frames", "16-bit countdown operand."]] },
  4: { description: "Call a local routine and remember where to return.", parameters: [["routine", "Symbolic local code label. The compiler recalculates its signed relative offset."]] },
  5: { description: "Return to the caller of a local routine.", parameters: [] },
  8: { description: "Push an unsigned literal onto the VM expression stack.", parameters: [["value", "Literal 16-bit integer; this operand does not read a work variable."]] },
  9: { description: "Push the value of a work/literal operand onto the VM expression stack.", parameters: [["work_or_value", "Values below 0x4000 are literals; values at or above 0x4000 identify work variables."]] },
  10: { description: "Pop the VM expression stack into a work variable.", parameters: [["destination", "Work-variable ID to write."]] },
  11: { description: "Pop and discard one VM expression-stack value.", parameters: [] },
  16: { description: "Push whether an event flag is set onto the VM expression stack.", parameters: [["flag", "Event flag ID, resolved using the work/literal operand convention."]] },
  17: { description: "Compare or combine the top two VM expression-stack values.", parameters: [["operator", stackComparison]], note: "This produces a stack boolean. jump_if 0xff consumes it and jumps when it is false." },
  0x19: { description: "Compare a work variable against a literal and set the VM comparison flag.", parameters: [["work", workId], ["value", "Literal unsigned 16-bit integer."]] },
  0x1a: { description: "Compare two work variables and set the VM comparison flag.", parameters: [["left_work", workId], ["right_work", workId]] },
  0x1b: { description: "Start a global script on another VM while this script continues.", parameters: [["script", "Game global-script ID; this is not a local helper label."]] },
  0x1c: { description: "Run a global script and wait for its VM to finish.", parameters: [["script", "Game global-script ID; this is not a local helper label."]] },
  0x1d: { description: "Finish the global script and release its waiting caller.", parameters: [] },
  0x1e: { description: "Jump unconditionally to a local code label.", parameters: [["target", "Symbolic code label; offsets are recalculated automatically."]] },
  0x1f: { description: "Jump conditionally using the VM comparison flag or expression stack.", parameters: [["condition", "0 <, 1 ==, 2 >, 3 <=, 4 >=, 5 != against the VM comparison flag. 0xff instead pops a stack boolean and jumps when it is false."], ["target", "Symbolic code label; the signed relative offset is recalculated."]] },
  0x20: { description: "Call a local routine when the VM comparison flag matches a condition.", parameters: [["condition", "0 <, 1 ==, 2 >, 3 <=, 4 >=, 5 !=. This command uses the comparison flag."], ["routine", "Symbolic local code label with an automatic relative offset."]] },
  0x23: { description: "Set an event flag.", parameters: [["flag", "Event flag operand, using the work/literal convention."]] },
  0x24: { description: "Clear an event flag.", parameters: [["flag", "Event flag operand, using the work/literal convention."]] },
  0x26: { description: "Add a value to a work variable.", parameters: [["destination", "Work-variable ID to update."], ["value", "Literal below 0x4000, or a work-variable ID to read."]] },
  0x27: { description: "Subtract a value from a work variable.", parameters: [["destination", "Work-variable ID to update."], ["value", "Literal below 0x4000, or a work-variable ID to read."]] },
  0x28: { description: "Set a work variable to a literal.", parameters: [["destination", "Work-variable ID to write."], ["value", "Literal unsigned 16-bit integer, including values at or above 0x4000."]] },
  0x29: { description: "Copy one work variable into another.", parameters: [["destination", "Work-variable ID to write."], ["source", workId]] },
  0x2a: { description: "Set a work variable from a work/literal operand.", parameters: [["destination", "Work-variable ID to write."], ["value", "Literal below 0x4000, or a work-variable ID to read."]] },
  0x2e: { description: "Lock field actors while an event is running.", parameters: [] },
  0x2f: { description: "Release the event's actor locks.", parameters: [] },
  0x3c: { description: "Display a dialogue balloon for a specified actor and wait for printing to finish.", parameters: [["text_bank", "Story text bank ID. 0x0400 uses the current script's default bank, normally assigned by its map header. Values at 0x4000 or above read a work variable."], ["message_id", "Zero-based entry ID within that bank; can also read a work variable."], ["actor", "Actor ID. 0x00fe is the following companion; 0x00ff is the player. Other local IDs come from map event data."], ["position", "0 = automatic, 1 = up, 2 = down, 3 = upper left, 4 = lower left, 5 = upper right, 6 = lower right."], ["balloon_type", "0 = normal dialogue balloon. Other values select alternate balloon styles."]], note: "Text variables such as VAR(256, 1) are expanded from the script's word buffers at runtime. The sidebar shows the stored text and preserves those controls." },
  0x3d: { description: "Display a dialogue balloon for the actor being talked to and wait for printing to finish.", parameters: [["text_bank", "Story text bank ID; 0x0400 selects the current script's default bank. Work IDs read runtime storage."], ["message_id", "Zero-based entry ID in that bank, using work/literal resolution."], ["position", "0 = automatic, 1 = up, 2 = down, 3 = upper left, 4 = lower left, 5 = upper right, 6 = lower right."], ["balloon_type", "0 = normal dialogue balloon."]], note: "The speaker is the script's talk target; there is no actor operand." },
  0x64: { description: "Start a movement-command list on a local actor.", parameters: [["actor", actor], ["movement", "Symbolic movement-data label. The compiler relocates its relative pointer."]] },
  0x65: { description: "Wait for the currently monitored actor movement to complete.", parameters: [] },
  0x6b: { description: "Add a map actor from its event definition.", parameters: [["actor", actor]] },
  0x6c: { description: "Remove a currently instantiated map actor.", parameters: [["actor", actor]] },
  0x6d: { description: "Immediately set a map actor's grid position and facing direction.", parameters: [["actor", actor], ["x", "Horizontal grid X coordinate (signed 16-bit, using work/literal resolution)."], ["elevation", "Vertical grid Y coordinate (height), not the map's north/south axis."], ["z", "Grid Z coordinate: the map's north/south axis."], ["direction", direction]], note: "Operand order is actor, X, Y/height, Z, direction. This repositions the actor immediately; it does not play a walking animation." },
  0x74: { description: "Turn the interacting actor toward the player.", parameters: [] },
  0xa6: { description: "Play a sound effect.", parameters: [["sound", "Game sound-effect ID, resolved using the work/literal convention."]] },
  0x1c1: { description: "Select this script's elevator-floor table.", parameters: [["table", "Symbolic data label pointing to floor records; the compiler recalculates the relative pointer."]] },
};

export function bw2ScriptCommandHelp(name: string, overlayId?: number): Bw2ScriptCommandHelp | undefined {
  const macro = bw2ScriptMacroByName(name);
  if (macro) return { name, opcode: macro.sequence[0].opcode, macro: true, commandCount: macro.sequence.length, description: macro.description,
    parameters: macro.parameters.map((parameter) => ({ ...parameter, width: 2 })),
    note: `Expands to ${macro.sequence.length} commands (${macro.sequence.reduce((bytes, command) => bytes + 2 + command.args.length * 2, 0)} bytes). ${macro.note ?? ""}`.trim() };
  if (name === "flag_set?") return { name, opcode: 0x10, description: "Test a Boolean event flag in the game's separate flag storage.", note: "A work alias such as bianca_intro_progress is integer progress, not an event-flag ID. Write bianca_intro_progress != 0 instead.", parameters: [{ name: "flag_id", width: 2, description: "Literal event-flag ID below 0x4000. This predicate does not test a work variable." }] };
  const command = bw2CommandByName(name, true, overlayId);
  if (!command) return;
  const fact = bw2CommandFactByName(name) ?? bw2CommandFactByOpcode(command.opcode, overlayId);
  const semantics: Semantics | undefined = overlayId === 66 && command.opcode === 0x03e8
    ? { description: "Start Aspertia's introduction petal animation.", parameters: [], note: "Overlay 66 command. The animation is part of the opening scene with Mom; it takes no script operands." }
    : overlayId === 66 && command.opcode === 0x03f3
      ? { description: "Initialize Aspertia's map gimmick for the ending scene.", parameters: [], note: "Overlay 66 command, used by the ending entry before restoring actors and positioning the player." }
      : HELP[command.opcode];
  return { name, opcode: command.opcode, description: semantics?.description ?? fact?.description ?? "BW2 VM command. Its byte layout is known; its semantic parameter descriptions are not yet documented.", note: semantics?.note ?? fact?.note,
    parameters: command.widths.map((width, index) => ({ width, name: semantics?.parameters[index]?.[0] ?? fact?.parameters[index]?.name ?? `argument_${index + 1}`, description: semantics?.parameters[index]?.[1] ?? fact?.parameters[index]?.description ?? `Raw unsigned ${width * 8}-bit operand. Runtime interpretation depends on this command.` })) };
}
