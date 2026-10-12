/**
 * Initial BW2 field-command subset. Layouts/condition IDs follow the
 * FrostsGen5Editor BW2 BeaterScript definitions (ScriptNARC.cs).
 * The existing gen5ScriptCommands table independently checks emitted sizes.
 * Control-transfer opcodes are emitted only by structured lowering.
 */
import { BW2_BASE_LAYOUTS, BW2_OVERLAY_LAYOUTS } from "./commandLayouts";
import type { RelocationKind } from "./types";
export type CommandDefinition = { opcode: number; widths: readonly (1 | 2 | 4)[]; relative?: Readonly<Record<number, Exclude<RelocationKind, "entry">>> };
export const BW2_SCRIPT_COMMANDS: Readonly<Record<string, CommandDefinition>> = Object.freeze({
  nop: { opcode: 0x00, widths: [] },
  sleep: { opcode: 0x03, widths: [2] },
  set_flag: { opcode: 0x23, widths: [2] },
  clear_flag: { opcode: 0x24, widths: [2] },
  lock: { opcode: 0x2e, widths: [] },
  unlock: { opcode: 0x2f, widths: [] },
  wait_moment: { opcode: 0x30, widths: [] },
  wait_buttons: { opcode: 0x31, widths: [] },
  wait_last: { opcode: 0x32, widths: [] },
  message_actor: { opcode: 0x3d, widths: [2, 2, 2, 2] },
  close_message: { opcode: 0x3e, widths: [] },
  face_player: { opcode: 0x74, widths: [] },
  play_sound: { opcode: 0xa6, widths: [2] },
});

export const BW2_COMPARISON_IDS = { "<": 0, "==": 1, ">": 2, "<=": 3, ">=": 4, "!=": 5 } as const;

const layoutNames = new Map<string, CommandDefinition>();
const layoutOpcodes = new Map<number, { name: string; definition: CommandDefinition }>();
for (const [id, layout] of Object.entries(BW2_BASE_LAYOUTS)) {
  const opcode = Number(id);
  let relative: CommandDefinition["relative"];
  if (opcode === 4 || opcode === 0x1e || opcode === 0x1c1) relative = { 0: opcode === 4 ? "call" : opcode === 0x1e ? "jump" : "data" };
  else if (opcode === 0x1f || opcode === 0x20 || opcode === 0x64) relative = { 1: opcode === 0x20 ? "call" : opcode === 0x64 ? "movement" : "jump" };
  const definition: CommandDefinition = { opcode, widths: layout.widths, relative };
  let name = opcode === 2 ? "halt" : opcode === 5 ? "vm_return" : opcode === 0x1f ? "jump_if" : opcode === 0x20 ? "call_if" : opcode === 0x64 ? "apply_movement" : layout.name;
  if (layoutNames.has(name)) name = `cmd_${opcode.toString(16).padStart(4, "0")}`;
  // Numeric aliases avoid any collision between legacy command spellings.
  layoutNames.set(`cmd_${opcode.toString(16).padStart(4, "0")}`, definition);
  if (!layoutNames.has(name)) layoutNames.set(name, definition);
  layoutOpcodes.set(opcode, { name, definition });
}
for (const [name, definition] of Object.entries(BW2_SCRIPT_COMMANDS)) layoutOpcodes.set(definition.opcode, { name, definition });

export function bw2CommandByName(name: string, imported = false, overlayId?: number): CommandDefinition | undefined {
  if (imported && overlayId !== undefined && /^cmd_[0-9a-f]{4}$/.test(name)) {
    const opcode = parseInt(name.slice(4), 16);
    const layout = BW2_OVERLAY_LAYOUTS[overlayId]?.[opcode];
    if (layout) return { opcode, widths: layout.widths };
  }
  return Object.hasOwn(BW2_SCRIPT_COMMANDS, name) ? BW2_SCRIPT_COMMANDS[name] : imported ? layoutNames.get(name) : undefined;
}
export function bw2CommandByOpcode(opcode: number, overlayId?: number): { name: string; definition: CommandDefinition } | undefined {
  if (opcode >= 1000 && overlayId !== undefined) {
    const layout = BW2_OVERLAY_LAYOUTS[overlayId]?.[opcode];
    if (layout) return { name: layout.name, definition: { opcode, widths: layout.widths } };
  }
  return layoutOpcodes.get(opcode);
}
