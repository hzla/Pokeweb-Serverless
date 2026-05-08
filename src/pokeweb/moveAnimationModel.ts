import commandMacros from "../assets/data/B2W2_MOVSCRCMD.s?raw";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import type { NarcName } from "./constants";
import { markDirty, type NarcStore, type ProjectState } from "./projectStore";

const ADDRESSES_PER_ENTRY = 0x0e;
const BATTLE_ANIMATION_OFFSET = 561;
const END_COMMANDS = new Set(["CallMoveAnimation", "TerminateMoveScript"]);

type CommandDefinition = {
  opcode: number;
  name: string;
  params: string[];
  ends: boolean;
};

type AnimationTarget = {
  storeName: "move_animations" | "battle_animations";
  store: NarcStore;
  index: number;
};

const COMMANDS = parseCommandMacros(commandMacros);
const COMMANDS_BY_NAME = new Map(COMMANDS.map((command) => [command.name.toLowerCase(), command]));
const COMMANDS_BY_OPCODE = new Map(COMMANDS.map((command) => [command.opcode, command]));

export function hasMoveAnimationScript(project: ProjectState, moveId: number): boolean {
  return resolveAnimationTarget(project, moveId, false) !== undefined;
}

export function decompileMoveAnimation(project: ProjectState, moveId: number): string {
  const target = resolveAnimationTarget(project, moveId, true);
  const bytes = target.store.rawFiles[target.index];
  if (!bytes) throw new Error(`Move animation ${moveId} is missing`);
  return decompileAnimationBytes(bytes);
}

export function compileMoveAnimation(_project: ProjectState, _moveId: number, scriptText: string): Uint8Array {
  return compileAnimationScript(scriptText);
}

export function updateMoveAnimationScript(project: ProjectState, moveId: number, scriptText: string): Uint8Array {
  const target = resolveAnimationTarget(project, moveId, true);
  const bytes = compileMoveAnimation(project, moveId, scriptText);
  target.store.rawFiles[target.index] = bytes;
  target.store.records.delete(target.index);
  markDirty(project, target.storeName, target.index);
  return bytes;
}

export function copyMoveAnimationScript(project: ProjectState, moveId: number, sourceAnimationId: number): void {
  if (!Number.isInteger(sourceAnimationId) || sourceAnimationId < 0) throw new Error("Animation ID must be a non-negative integer");
  const sourceStore = project.narcs.move_animations;
  if (!sourceStore) throw new Error("Move animation NARC is not loaded");
  const source = sourceStore.rawFiles[sourceAnimationId];
  if (!source) throw new Error(`Move animation ${sourceAnimationId} does not exist`);

  const target = resolveAnimationTarget(project, moveId, true);
  target.store.rawFiles[target.index] = source.slice();
  target.store.records.delete(target.index);
  markDirty(project, target.storeName, target.index);
}

function resolveAnimationTarget(project: ProjectState, moveId: number, throwOnMissing: true): AnimationTarget;
function resolveAnimationTarget(project: ProjectState, moveId: number, throwOnMissing?: false): AnimationTarget | undefined;
function resolveAnimationTarget(project: ProjectState, moveId: number, throwOnMissing = false): AnimationTarget | undefined {
  const storeName: "move_animations" | "battle_animations" = moveId > 559 ? "battle_animations" : "move_animations";
  const index = moveId > 559 ? moveId - BATTLE_ANIMATION_OFFSET : moveId;
  const store = project.narcs[storeName];
  if (!store || index < 0 || index >= store.rawFiles.length) {
    if (throwOnMissing) throw new Error(`${storeName} is not loaded for move ${moveId}`);
    return undefined;
  }
  return { storeName, store, index };
}

function decompileAnimationBytes(bytes: Uint8Array): string {
  if (bytes.length < 4) throw new Error("Animation script is too small");
  const count = readU32(bytes, 0);
  const headerEntries = count * ADDRESSES_PER_ENTRY;
  const headerLength = 4 + headerEntries * 4;
  if (count < 1 || count > 64 || headerLength > bytes.length) throw new Error(`Invalid animation script count: ${count}`);

  const offsets: number[] = [];
  const labelByOffset = new Map<number, string>();
  for (let index = 0; index < headerEntries; index += 1) {
    const offset = readU32(bytes, 4 + index * 4);
    offsets.push(offset);
    if (!labelByOffset.has(offset)) labelByOffset.set(offset, `SCRIPT_${offset}`);
  }

  const out: string[] = ['.include "B2W2_MOVSCRCMD.s"', ".align 4", "", `.word ${count} @ Count`];
  for (const offset of offsets) out.push(`.word ${labelByOffset.get(offset)}`);
  out.push("");

  for (const [offset, label] of labelByOffset.entries()) {
    if (offset < headerLength || offset >= bytes.length) throw new Error(`Animation script offset is out of range: ${offset}`);
    out.push(`${label}:`);
    let cursor = offset;
    let ended = false;
    while (cursor + 2 <= bytes.length) {
      const opcode = readU16(bytes, cursor);
      cursor += 2;
      const command = COMMANDS_BY_OPCODE.get(opcode);
      if (!command) throw new Error(`Unknown animation command opcode: ${opcode}`);
      const params: number[] = [];
      for (let n = 0; n < command.params.length; n += 1) {
        if (cursor + 4 > bytes.length) throw new Error(`Command ${command.name} is truncated`);
        params.push(readI32(bytes, cursor));
        cursor += 4;
      }
      out.push(`     ${command.name}${params.length > 0 ? ` ${params.join(", ")}` : " "}`);
      if (command.ends) {
        ended = true;
        break;
      }
    }
    if (!ended) throw new Error(`Script ${label} does not terminate`);
    out.push("");
  }

  return out.join("\n").trimEnd() + "\n";
}

function compileAnimationScript(scriptText: string): Uint8Array {
  const parsed = parseScriptText(scriptText);
  const compiledBodies = new Map<string, Uint8Array>();
  for (const label of parsed.labelOrder) {
    compiledBodies.set(label, compileCommandLines(label, parsed.bodies.get(label) ?? []));
  }

  const headerLength = 4 + parsed.count * ADDRESSES_PER_ENTRY * 4;
  let cursor = headerLength;
  const labelOffsets = new Map<string, number>();
  for (const label of parsed.labelOrder) {
    labelOffsets.set(label, cursor);
    cursor += compiledBodies.get(label)?.length ?? 0;
  }

  const out = new Uint8Array(cursor);
  writeU32(out, 0, parsed.count);
  parsed.headerLabels.forEach((label, index) => {
    const offset = labelOffsets.get(label);
    if (offset === undefined) throw new Error(`Header references missing label: ${label}`);
    writeU32(out, 4 + index * 4, offset);
  });
  for (const label of parsed.labelOrder) out.set(compiledBodies.get(label) ?? new Uint8Array(), labelOffsets.get(label)!);
  return out;
}

function parseScriptText(scriptText: string): { count: number; headerLabels: string[]; labelOrder: string[]; bodies: Map<string, string[]> } {
  const meaningful = scriptText
    .split(/\r?\n/u)
    .map((line) => stripComment(line).trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith(".include") && !line.startsWith(".align"));

  const countLineIndex = meaningful.findIndex((line) => /^\.word\s+[-+]?(?:0x[0-9a-f]+|\d+)/iu.test(line));
  if (countLineIndex < 0) throw new Error("Missing .word <count> header");
  const countMatch = /^\.word\s+(.+)$/iu.exec(meaningful[countLineIndex]);
  const count = parseIntegerToken(countMatch?.[1]?.trim() ?? "", "script count");
  if (count < 1 || count > 64) throw new Error("Script count must be between 1 and 64");

  const headerLabels: string[] = [];
  let cursor = countLineIndex + 1;
  for (let n = 0; n < count * ADDRESSES_PER_ENTRY; n += 1, cursor += 1) {
    const line = meaningful[cursor];
    const match = /^\.word\s+([A-Za-z_][A-Za-z0-9_]*)$/u.exec(line ?? "");
    if (!match) throw new Error(`Missing header script label at entry ${n}`);
    headerLabels.push(match[1]);
  }

  const bodies = new Map<string, string[]>();
  const labelOrder: string[] = [];
  let activeLabel: string | undefined;
  for (; cursor < meaningful.length; cursor += 1) {
    const line = meaningful[cursor];
    const labelMatch = /^([A-Za-z_][A-Za-z0-9_]*):$/u.exec(line);
    if (labelMatch) {
      activeLabel = labelMatch[1];
      if (bodies.has(activeLabel)) throw new Error(`Duplicate label: ${activeLabel}`);
      bodies.set(activeLabel, []);
      labelOrder.push(activeLabel);
      continue;
    }
    if (!activeLabel) throw new Error(`Command appears before a label: ${line}`);
    bodies.get(activeLabel)?.push(line);
  }

  for (const label of new Set(headerLabels)) {
    if (!bodies.has(label)) throw new Error(`Header references missing label: ${label}`);
    if (!bodyTerminates(bodies.get(label) ?? [])) throw new Error(`Script ${label} must include a terminating command`);
  }

  return { count, headerLabels, labelOrder, bodies };
}

function compileCommandLines(label: string, lines: string[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let terminates = false;
  for (const line of lines) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.*))?$/u.exec(line);
    if (!match) throw new Error(`Invalid command line in ${label}: ${line}`);
    const command = COMMANDS_BY_NAME.get(match[1].toLowerCase());
    if (!command) throw new Error(`Unknown animation command: ${match[1]}`);
    const params = parseParams(match[2] ?? "", command.name);
    if (params.length !== command.params.length) throw new Error(`${command.name} expects ${command.params.length} parameter(s), got ${params.length}`);

    const bytes = new Uint8Array(2 + params.length * 4);
    writeU16(bytes, 0, command.opcode);
    params.forEach((value, index) => writeU32(bytes, 2 + index * 4, value >>> 0));
    parts.push(bytes);
    if (command.ends) terminates = true;
  }
  if (!terminates) throw new Error(`Script ${label} must include a terminating command`);
  return concatBytes(parts);
}

function bodyTerminates(lines: string[]): boolean {
  return lines.some((line) => {
    const commandName = /^([A-Za-z_][A-Za-z0-9_]*)/u.exec(line)?.[1];
    const command = commandName ? COMMANDS_BY_NAME.get(commandName.toLowerCase()) : undefined;
    return command?.ends ?? false;
  });
}

function parseParams(input: string, commandName: string): number[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/\s*,\s*|\s+/u)
    .filter(Boolean)
    .map((value, index) => parseIntegerToken(value, `${commandName} parameter ${index + 1}`));
}

function parseIntegerToken(token: string, label: string): number {
  if (!/^[-+]?(?:0x[0-9a-f]+|\d+)$/iu.test(token)) throw new Error(`${label} must be an integer`);
  const sign = token.startsWith("-") ? -1 : 1;
  const normalized = token.replace(/^[-+]/u, "");
  const value = sign * (normalized.toLowerCase().startsWith("0x") ? Number.parseInt(normalized.slice(2), 16) : Number.parseInt(normalized, 10));
  if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647) throw new Error(`${label} must fit in signed 32-bit range`);
  return value;
}

function parseCommandMacros(source: string): CommandDefinition[] {
  const lines = source.split(/\r?\n/u);
  const commands: CommandDefinition[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const macro = /^\.macro\s+([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/u.exec(lines[index].trim());
    if (!macro) continue;
    const name = macro[1];
    const params = macro[2].trim() ? macro[2].trim().split(/\s+/u) : [];
    let opcode: number | undefined;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      const text = lines[scan].trim();
      const opcodeMatch = /^\.hword\s+(\d+)$/u.exec(text);
      if (opcodeMatch) {
        opcode = Number(opcodeMatch[1]);
        break;
      }
      if (text === ".endm") break;
    }
    if (opcode === undefined) continue;
    commands.push({ opcode, name, params, ends: END_COMMANDS.has(name) });
  }
  return commands;
}

function stripComment(line: string): string {
  return line.replace(/\s*@.*$/u, "");
}

function readI32(data: Uint8Array, offset: number): number {
  return readU32(data, offset) | 0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
