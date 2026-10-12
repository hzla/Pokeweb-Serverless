import { bw2CommandByName } from "./bw2ScriptCompiler/commands";

export type Bw2ScriptCommandHelp = {
  name: string; opcode: number; description: string; note?: string;
  parameters: { name: string; description: string; width: number }[];
};
type Semantics = { description: string; parameters: [string, string][]; note?: string };
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
  const command = bw2CommandByName(name, true, overlayId);
  if (!command) return;
  const semantics = HELP[command.opcode];
  return { name, opcode: command.opcode, description: semantics?.description ?? "BW2 VM command. Its byte layout is known; its semantic parameter descriptions are not yet documented.", note: semantics?.note,
    parameters: command.widths.map((width, index) => ({ width, name: semantics?.parameters[index]?.[0] ?? `argument_${index + 1}`, description: semantics?.parameters[index]?.[1] ?? `Raw unsigned ${width * 8}-bit operand. Runtime interpretation depends on this command.` })) };
}
