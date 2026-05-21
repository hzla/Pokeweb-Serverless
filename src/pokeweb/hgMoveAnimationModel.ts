import { readAscii, readU16, readU32, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { parseSpaArchive, serializeSpaArchive, type SpaArchive } from "./nitroSpa";

export type HgMoveAnimationScriptArchiveKind = "move" | "sub";
export type HgMoveAnimationArchiveKind = HgMoveAnimationScriptArchiveKind | "spa";

export type HgMoveAnimationCommandDefinition = {
  opcode: number;
  name: string;
  params: string[];
  branchParams?: number[];
  variable?: {
    countParam: number;
    fixedParams: number;
    maxVariableParams: number;
  };
};

export type HgMoveAnimationArchive = {
  kind: HgMoveAnimationArchiveKind;
  path: string;
  fileId: number;
  narc: NARC;
  dirty: Set<number>;
};

export type HgMoveAnimationRom = {
  rom: NintendoDSRom;
  romInfo: {
    title: string;
    idCode: string;
    size: number;
  };
  archives: Record<HgMoveAnimationArchiveKind, HgMoveAnimationArchive>;
  moveNames: string[];
};

export type ParsedHgMoveAnimationCommand = {
  offset: number;
  opcode: number;
  name: string;
  params: number[];
  length: number;
  branchTargets: Array<{ paramIndex: number; offset: number }>;
};

const ARCHIVE_CONFIG: Record<
  HgMoveAnimationArchiveKind,
  {
    path: string;
    buildDir: string;
    filePrefix: string;
    labelPrefix: string;
  }
> = {
  move: {
    path: "a/0/1/0",
    buildDir: "build/move/move_anim",
    filePrefix: "0",
    labelPrefix: "a010",
  },
  sub: {
    path: "a/0/6/1",
    buildDir: "build/move/move_sub_anim",
    filePrefix: "1",
    labelPrefix: "a061",
  },
  spa: {
    path: "a/0/2/9",
    buildDir: "build/move/move_spa",
    filePrefix: "2",
    labelPrefix: "a029",
  },
};

const CONSTANTS = new Map<string, number>([
  ["PAN_LEFT", -117],
  ["PAN_RIGHT", 117],
  ["PAN_CENTER", 0],
  ["ANIM_TARGET_USER", 3],
  ["ANIM_TARGET_DEFENDER", 4],
  ["ANIM_TARGET_MISC", 17],
  ["ANIM_TARGET_DEFENDER_SIDE", 20],
]);

const MSGDATA_PATH = "a/0/2/7";
const MOVE_NAMES_BANK = 750;

const COMMANDS: HgMoveAnimationCommandDefinition[] = [
  command(0x00, "wait", ["time"]),
  command(0x01, "waitstate", []),
  command(0x02, "loop", ["value"]),
  command(0x03, "doloop", []),
  command(0x04, "end", []),
  command(0x05, "playse", ["value"]),
  command(0x06, "changemonbg", ["value"]),
  command(0x07, "resetmonbg", ["value"]),
  command(0x08, "cmd08", []),
  command(0x09, "cmd09", []),
  command(0x0a, "call", ["address"], { branchParams: [0] }),
  command(0x0b, "return", []),
  command(0x0c, "cmd0C", ["num0", "num1"]),
  command(0x0d, "checkturn", ["address1", "address2"], { branchParams: [0, 1] }),
  command(0x0e, "cmd0E", []),
  command(0x0f, "cmd0F", []),
  command(0x10, "changebg", ["value1", "value2"]),
  command(0x11, "changebgparam", ["value1", "value2"]),
  command(0x12, "resetbg", ["value1", "value2"]),
  command(0x13, "waitforchangebg2", []),
  command(0x14, "waitforchangebg", []),
  command(0x15, "cmd15", []),
  command(0x16, "playsepan", ["id", "pan"]),
  command(0x17, "cmd17", []),
  command(0x18, "playsepanmod", ["id", "panstart", "panend", "panadd", "time"]),
  command(0x19, "repeatse", ["id", "pan", "frames", "repeat"]),
  command(0x1a, "waitse", ["id", "pan", "num"]),
  command(0x1b, "cmd1B", []),
  command(0x1c, "cmd1C", []),
  command(0x1d, "cmd1D", []),
  command(0x1e, "cmd1E", []),
  command(0x1f, "cmd1F", ["battler", "track"]),
  command(0x20, "cmd20", ["unused"]),
  command(0x21, "cmd21", []),
  command(0x22, "cmd22", []),
  command(0x23, "cmd23", []),
  command(0x24, "cmd24", []),
  command(0x25, "cmd25", []),
  command(0x26, "cmd26", []),
  command(0x27, "cmd27", []),
  command(0x28, "cmd28", []),
  command(0x29, "cmd29", []),
  command(0x2a, "cmd2A", []),
  command(0x2b, "cmd2B", []),
  command(0x2c, "stopse", ["id"]),
  command(0x2d, "callfunction", ["func", "count", "num0", "num1", "num2", "num3", "num4", "num5", "num6", "num7", "num8", "num9"], {
    variable: { countParam: 1, fixedParams: 2, maxVariableParams: 10 },
  }),
  command(0x2e, "addparticle", ["num0", "num1", "address"]),
  command(0x2f, "addparticle2", ["num0", "num1", "num2", "address"]),
  command(0x30, "addsequentialparticle", ["num0", "num1", "num2", "num3", "num4", "num5", "num6", "address"]),
  command(0x31, "addparticlebasedonbattler", ["num0", "num1", "num2", "num3", "num4", "address"]),
  command(0x32, "waitparticle", []),
  command(0x33, "loadparticle", ["num0", "num1"]),
  command(0x34, "cmd34", []),
  command(0x35, "unloadparticle", ["num"]),
  command(0x36, "cmd36", ["function", "num0", "num1", "count", "param0", "param1", "param2", "param3", "param4", "param5", "param6", "param7"], {
    variable: { countParam: 3, fixedParams: 4, maxVariableParams: 8 },
  }),
  command(0x37, "cmd37", ["count", "slot", "emitter", "mode", "arg0", "arg1", "arg2", "arg3", "arg4"], {
    variable: { countParam: 0, fixedParams: 1, maxVariableParams: 8 },
  }),
  command(0x38, "initspriteresource", []),
  command(0x39, "loadspriteresource", ["num"]),
  command(0x3a, "loadspritemaybe", ["num0", "num1", "num2", "num3"]),
  command(0x3b, "unloadspriteresource", []),
  command(0x3c, "resetsprite", ["num"]),
  command(0x3d, "cmd3D", []),
  command(0x3e, "cmd3E", ["slot", "value"]),
  command(0x3f, "cmd3F", []),
  command(0x40, "jumpifside", ["num", "address1", "address2"], { branchParams: [1, 2] }),
  command(0x41, "playcry", ["num", "pan", "volume"]),
  command(0x42, "waitcry", ["num"]),
  command(0x43, "cmd43", []),
  command(0x44, "transform", ["num"]),
  command(0x45, "copymonsprite", ["num"]),
  command(0x46, "jumpbasedonweather", ["address0", "address1", "address2", "address3", "address4"], { branchParams: [0, 1, 2, 3, 4] }),
  command(0x47, "jumpifcontest", ["address"], { branchParams: [0] }),
  command(0x48, "jumpifplayerattack", ["address"], { branchParams: [0] }),
  command(0x49, "initresources", ["num0", "num1", "num2", "num3", "num4", "num5", "num6", "num7"]),
  command(0x4a, "loadresources", ["num", "file"]),
  command(0x4b, "loadpalette", ["num", "file", "pal"]),
  command(0x4c, "loadcell", ["num", "file"]),
  command(0x4d, "loadcellanm", ["num", "file"]),
  command(
    0x4e,
    "addsomething",
    ["num0", "num1", "num2", "num3", "num4", "num5", "num6", "num7", "count", "param0", "param1", "param2", "param3", "param4", "param5", "param6", "param7"],
    { variable: { countParam: 8, fixedParams: 9, maxVariableParams: 8 } },
  ),
  command(0x4f, "addsomething2", ["num0", "num1", "num2", "num3", "num4", "num5", "num6", "num7"]),
  command(0x50, "freeresources", ["num"]),
  command(0x51, "enablemonsprite", ["num", "value"]),
  command(0x52, "cmd52", ["battler", "slot", "sourceSprite"]),
  command(0x53, "cmd53", ["slot"]),
  command(0x54, "cmd54", []),
  command(0x55, "cmd55", ["screen"]),
  command(0x56, "cmd56", ["effect", "packedTiming", "packedOffset"]),
  command(0x57, "cmd57", ["relativeOffset"]),
  command(0x58, "changepermanentbg", ["bg", "terrain"]),
];

const COMMANDS_BY_NAME = new Map(COMMANDS.map((entry) => [entry.name.toLowerCase(), entry]));
const COMMANDS_BY_OPCODE = new Map(COMMANDS.map((entry) => [entry.opcode, entry]));

type CompileCommand = {
  offset: number;
  definition: HgMoveAnimationCommandDefinition;
  params: Array<number | string>;
};

type PrimitiveCommand = {
  name: string;
  params: string[];
};

const READABLE_CALLFUNCTION_ALIASES = new Map<number, string>([
  [8, "rotate_attacker_helper"],
  [33, "screen_tint"],
  [34, "pokemon_tint"],
  [36, "actor_shake"],
  [40, "battler_sprite_vanish"],
  [42, "battler_sprite_scale_updown"],
  [52, "battler_sprite_slide_x"],
  [57, "actor_slide"],
  [65, "particle_emitter_straight"],
  [68, "screen_shake"],
  [72, "particle_emitter_rotation"],
  [74, "battle_palette_grayscale"],
  [75, "pokemon_oam_view"],
  [78, "particle_resource_setup"],
]);

const READABLE_CALLFUNCTION_IDS = new Map([...READABLE_CALLFUNCTION_ALIASES].map(([id, name]) => [name, id]));
const READABLE_PRIMITIVE_ALIASES = new Map<string, string>([
  ["cmd0c", "work_set"],
  ["cmd1f", "copy_battler_to_bg2"],
  ["cmd20", "clear_bg2_battler_copy"],
  ["cmd3e", "set_sprite_state_byte_a"],
  ["cmd43", "clear_scratch_params"],
  ["cmd52", "start_managed_sprite_draw_task"],
  ["cmd53", "stop_managed_sprite_draw_task"],
  ["cmd54", "wait_for_input_gate"],
  ["cmd55", "screen_brightness_pulse"],
  ["cmd56", "animated_bg_effect_offset_task"],
  ["cmd57", "branch_on_battle_flag"],
]);
const READABLE_PRIMITIVE_COMMANDS = new Map([...READABLE_PRIMITIVE_ALIASES].map(([commandName, alias]) => [alias, commandName]));
const CMD37_FIELD_ORDER = [0x0000, 0x0002, 0x0004, 0x0008, 0x0010, 0x0020, 0x0040, 0x0080, 0x0100, 0x0200, 0x0400, 0x0800, 0x1000, 0x2000];
const CMD37_FIELD_ALIAS_BY_BIT = new Map<number, string>([
  [0x0002, "particle_gravity_magnitude"],
  [0x0004, "particle_random_magnitude"],
  [0x0008, "particle_random_interval"],
  [0x0010, "particle_magnet_target"],
  [0x0020, "particle_magnet_force"],
  [0x0040, "particle_spin_radius"],
  [0x0080, "particle_spin_axis"],
  [0x0100, "particle_collision_y"],
  [0x0200, "particle_collision_callback"],
  [0x0400, "particle_collision_event"],
  [0x0800, "particle_collision_global"],
  [0x1000, "particle_convergence_target"],
  [0x2000, "particle_convergence_force"],
]);
const CMD37_FIELD_DATA_ALIASES = new Set(["particle_field_data", ...CMD37_FIELD_ALIAS_BY_BIT.values()]);

export function getHgMoveAnimationCommandDefinitions(): HgMoveAnimationCommandDefinition[] {
  return COMMANDS.map((definition) => ({
    ...definition,
    params: definition.params.slice(),
    branchParams: definition.branchParams?.slice(),
    variable: definition.variable ? { ...definition.variable } : undefined,
  }));
}

export function getHgMoveAnimationReadableCommandAliases(): Array<{ alias: string; command: string }> {
  return [...READABLE_PRIMITIVE_COMMANDS].map(([alias, command]) => ({ alias, command }));
}

export function loadHgMoveAnimationRom(romBytes: Uint8Array): HgMoveAnimationRom {
  const rom = new NintendoDSRom(romBytes);
  return {
    rom,
    romInfo: {
      title: rom.name,
      idCode: rom.idCode,
      size: romBytes.length,
    },
    archives: {
      move: loadArchive(rom, "move"),
      sub: loadArchive(rom, "sub"),
      spa: loadArchive(rom, "spa"),
    },
    moveNames: loadHgMoveNames(rom),
  };
}

export function decodeHgMessageBank(data: Uint8Array): string[] {
  if (data.length < 4) throw new Error("HG message bank is too small");
  const count = readU16(data, 0);
  const key = readU16(data, 2);
  const tableOffset = 4;
  const dataOffset = tableOffset + count * 8;
  if (dataOffset > data.length) throw new Error("HG message bank allocation table exceeds file size");
  const entries: string[] = [];
  let cursor = dataOffset;
  for (let index = 0; index < count; index += 1) {
    const tableEntryOffset = tableOffset + index * 8;
    const allocKey = ((765 * (index + 1) * key) & 0xffff) * 0x10001;
    const _offset = readU32(data, tableEntryOffset) ^ allocKey;
    const length = readU32(data, tableEntryOffset + 4) ^ allocKey;
    if (length < 0 || cursor + length * 2 > data.length) throw new Error(`HG message ${index} exceeds bank size`);
    const words: number[] = [];
    let stringKey = ((index + 1) * 596947) & 0xffff;
    for (let wordIndex = 0; wordIndex < length; wordIndex += 1) {
      words.push(readU16(data, cursor + wordIndex * 2) ^ stringKey);
      stringKey = (stringKey + 18749) & 0xffff;
    }
    entries.push(renderHgMessage(words));
    cursor += length * 2;
  }
  return entries;
}

export function decompileHgMoveAnimation(bytes: Uint8Array, options: { archiveKind: HgMoveAnimationScriptArchiveKind; fileId: number }): string {
  if (bytes.length % 4 !== 0) throw new Error("HG animation scripts must be 32-bit aligned");
  const config = ARCHIVE_CONFIG[options.archiveKind];
  const commands = readCommands(bytes);
  const commandOffsets = new Set(commands.map((entry) => entry.offset));
  const labelByOffset = new Map<number, string>([[0, `${config.labelPrefix}_${padId(options.fileId)}`]]);

  for (const entry of commands) {
    for (const branchIndex of entry.definition.branchParams ?? []) {
      const rawTarget = entry.params[branchIndex];
      if (typeof rawTarget !== "number") continue;
      const operandOffset = entry.offset + 4 + branchIndex * 4;
      const target = operandOffset + rawTarget * 4;
      if (target < 0 || target >= bytes.length || target % 4 !== 0) throw new Error(`Branch target out of range at 0x${hex(entry.offset)}`);
      if (!commandOffsets.has(target)) throw new Error(`Branch target does not point to a command boundary: 0x${hex(target)}`);
      if (!labelByOffset.has(target)) labelByOffset.set(target, `_${hex(target)}`);
    }
  }

  const lines = [
    ".nds",
    ".thumb",
    "",
    '.include "armips/include/animscriptcmd.s"',
    "",
    `.create "${config.buildDir}/${config.filePrefix}_${padId(options.fileId)}", 0`,
    "",
  ];

  for (const entry of commands) {
    const label = labelByOffset.get(entry.offset);
    if (label) lines.push(`${label}:`);
    lines.push(`    ${formatCommand(entry, labelByOffset)}`);
  }

  lines.push("", ".close", "");
  return lines.join("\n");
}

export function decompileHgMoveAnimationReadable(bytes: Uint8Array, options: { archiveKind: HgMoveAnimationScriptArchiveKind; fileId: number }): string {
  return rewriteHgEngineScriptToReadable(decompileHgMoveAnimation(bytes, options));
}

export function compileHgMoveAnimationScript(scriptText: string, options: { archiveKind: HgMoveAnimationScriptArchiveKind; fileId: number }): Uint8Array {
  const commands: CompileCommand[] = [];
  const labels = new Map<string, number>();
  let offset = 0;

  for (const parsed of parseScriptLines(scriptText)) {
    if (parsed.type === "label") {
      if (labels.has(parsed.name)) throw new Error(`Duplicate label: ${parsed.name}`);
      labels.set(parsed.name, offset);
      continue;
    }

    for (const primitive of expandToPrimitives(parsed.name, parsed.params)) {
      const definition = COMMANDS_BY_NAME.get(primitive.name.toLowerCase());
      if (!definition) throw new Error(`Unknown HG animation command: ${primitive.name}`);
      const params = normalizeCompileParams(definition, primitive.params);
      commands.push({ offset, definition, params });
      offset += 4 * (1 + params.length);
    }
  }

  if (commands.length === 0) throw new Error("Script does not contain any commands");
  const out = new Uint8Array(offset);
  for (const entry of commands) {
    writeU32(out, entry.offset, entry.definition.opcode);
    entry.params.forEach((param, index) => {
      const operandOffset = entry.offset + 4 + index * 4;
      if (isBranchParam(entry.definition, index)) {
        if (typeof param !== "string") throw new Error(`${entry.definition.name} branch parameter ${index + 1} must be a label`);
        const target = labels.get(param);
        if (target === undefined) throw new Error(`Unknown label: ${param}`);
        const relative = (target - operandOffset) / 4;
        if (!Number.isInteger(relative)) throw new Error(`Label ${param} is not word aligned`);
        writeU32(out, operandOffset, relative >>> 0);
      } else {
        if (typeof param !== "number") throw new Error(`${entry.definition.name} parameter ${index + 1} must be numeric`);
        writeU32(out, operandOffset, param >>> 0);
      }
    });
  }
  return out;
}

export function parseHgMoveAnimationBinary(bytes: Uint8Array): ParsedHgMoveAnimationCommand[] {
  if (bytes.length % 4 !== 0) throw new Error("HG animation scripts must be 32-bit aligned");
  return readCommands(bytes).map((entry) => ({
    offset: entry.offset,
    opcode: entry.definition.opcode,
    name: entry.definition.name,
    params: entry.params.map((param) => (typeof param === "number" ? param : 0)),
    length: 4 * (1 + entry.params.length),
    branchTargets: (entry.definition.branchParams ?? []).map((paramIndex) => ({
      paramIndex,
      offset: entry.offset + 4 + paramIndex * 4 + Number(entry.params[paramIndex] ?? 0) * 4,
    })),
  }));
}

export function parseHgMoveAnimationScript(scriptText: string, options: { archiveKind: HgMoveAnimationScriptArchiveKind; fileId: number }): ParsedHgMoveAnimationCommand[] {
  return parseHgMoveAnimationBinary(compileHgMoveAnimationScript(scriptText, options));
}

export function updateHgMoveAnimationFile(state: HgMoveAnimationRom, kind: HgMoveAnimationScriptArchiveKind, fileId: number, scriptText: string): Uint8Array {
  const archive = state.archives[kind];
  if (fileId < 0 || fileId >= archive.narc.files.length) throw new Error(`Animation file ${fileId} is out of range`);
  const bytes = compileHgMoveAnimationScript(scriptText, { archiveKind: kind, fileId });
  archive.narc.files[fileId] = bytes;
  archive.dirty.add(fileId);
  return bytes;
}

export function exportHgMoveAnimationArchive(state: HgMoveAnimationRom, kind: HgMoveAnimationArchiveKind): Uint8Array {
  return state.archives[kind].narc.save();
}

export function exportHgMoveAnimationRom(state: HgMoveAnimationRom): Uint8Array {
  const files = new Map<number, Uint8Array>();
  files.set(state.archives.move.fileId, state.archives.move.narc.save());
  files.set(state.archives.sub.fileId, state.archives.sub.narc.save());
  files.set(state.archives.spa.fileId, state.archives.spa.narc.save());
  return state.rom.save({ files });
}

export function loadHgMoveSpaArchive(state: HgMoveAnimationRom, spaId: number): SpaArchive {
  const archive = state.archives.spa;
  const bytes = archive.narc.files[spaId];
  if (!bytes) throw new Error(`SPA file ${spaId} does not exist in ${archive.path}`);
  return parseSpaArchive(bytes);
}

export function updateHgMoveSpaArchive(state: HgMoveAnimationRom, spaId: number, spaArchive: SpaArchive): Uint8Array {
  const archive = state.archives.spa;
  if (!Number.isInteger(spaId) || spaId < 0 || spaId >= archive.narc.files.length) throw new Error(`SPA file ${spaId} is out of range`);
  const bytes = serializeSpaArchive(spaArchive);
  const reparsed = parseSpaArchive(bytes);
  archive.narc.files[spaId] = bytes;
  archive.dirty.add(spaId);
  spaArchive.rawHeader = reparsed.rawHeader;
  spaArchive.resourceCount = reparsed.resourceCount;
  spaArchive.textureCount = reparsed.textureCount;
  spaArchive.resources = reparsed.resources;
  spaArchive.textures = reparsed.textures;
  spaArchive.warnings = reparsed.warnings;
  return bytes;
}

export function exportHgMoveSpaFile(state: HgMoveAnimationRom, spaId: number, archiveOverride?: SpaArchive): Uint8Array {
  if (archiveOverride) return serializeSpaArchive(archiveOverride);
  const bytes = state.archives.spa.narc.files[spaId];
  if (!bytes) throw new Error(`SPA file ${spaId} does not exist in ${state.archives.spa.path}`);
  return bytes.slice();
}

export function appendHgMoveSpaFiles(state: HgMoveAnimationRom, files: Uint8Array[]): number[] {
  const archive = state.archives.spa;
  const appended: number[] = [];
  for (const bytes of files) {
    parseSpaArchive(bytes);
    const fileId = archive.narc.files.length;
    archive.narc.files.push(bytes.slice());
    archive.dirty.add(fileId);
    appended.push(fileId);
  }
  return appended;
}

function command(
  opcode: number,
  name: string,
  params: string[],
  options: Pick<HgMoveAnimationCommandDefinition, "branchParams" | "variable"> = {},
): HgMoveAnimationCommandDefinition {
  return { opcode, name, params, ...options };
}

function loadArchive(rom: NintendoDSRom, kind: HgMoveAnimationArchiveKind): HgMoveAnimationArchive {
  const config = ARCHIVE_CONFIG[kind];
  const fileId = rom.fileId(config.path);
  return {
    kind,
    path: config.path,
    fileId,
    narc: new NARC(rom.files[fileId]),
    dirty: new Set(),
  };
}

function loadHgMoveNames(rom: NintendoDSRom): string[] {
  try {
    const msgData = new NARC(rom.getFileByName(MSGDATA_PATH));
    const bank = msgData.files[MOVE_NAMES_BANK];
    if (!bank) return [];
    return decodeHgMessageBank(bank).map(cleanHgDisplayText);
  } catch {
    return [];
  }
}

function readCommands(bytes: Uint8Array): CompileCommand[] {
  const commands: CompileCommand[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const opcode = readU32(bytes, offset);
    const definition = COMMANDS_BY_OPCODE.get(opcode);
    if (!definition) throw new Error(`Unknown HG animation opcode 0x${hex(opcode)} at 0x${hex(offset)}`);
    const paramCount = readParamCount(bytes, offset, definition);
    const params: number[] = [];
    for (let index = 0; index < paramCount; index += 1) {
      const paramOffset = offset + 4 + index * 4;
      if (paramOffset + 4 > bytes.length) throw new Error(`${definition.name} is truncated at 0x${hex(offset)}`);
      params.push(readI32(bytes, paramOffset));
    }
    commands.push({ offset, definition, params });
    offset += 4 * (1 + paramCount);
  }
  return commands;
}

function readParamCount(bytes: Uint8Array, offset: number, definition: HgMoveAnimationCommandDefinition): number {
  if (!definition.variable) return definition.params.length;
  const { countParam, fixedParams, maxVariableParams } = definition.variable;
  const countOffset = offset + 4 + countParam * 4;
  if (countOffset + 4 > bytes.length) throw new Error(`${definition.name} is truncated before its count parameter`);
  const count = readI32(bytes, countOffset);
  if (count < 0 || count > maxVariableParams) throw new Error(`${definition.name} count must be between 0 and ${maxVariableParams}`);
  return fixedParams + count;
}

function formatCommand(entry: CompileCommand, labelByOffset: Map<number, string>): string {
  const params = entry.definition.variable ? formatVariableParams(entry) : entry.params.slice();
  const formatted = params.map((param, index) => {
    if (isBranchParam(entry.definition, index) && typeof param === "number") {
      const target = entry.offset + 4 + index * 4 + param * 4;
      return labelByOffset.get(target) ?? `_${hex(target)}`;
    }
    return String(param);
  });
  return `${entry.definition.name}${formatted.length > 0 ? ` ${formatted.join(", ")}` : ""}`;
}

function formatVariableParams(entry: CompileCommand): Array<number | string> {
  const variable = entry.definition.variable;
  if (!variable) return entry.params.slice();
  const count = entry.params[variable.countParam];
  if (typeof count !== "number") throw new Error(`${entry.definition.name} count is not numeric`);
  const fixed = entry.params.slice(0, variable.fixedParams);
  const actual = entry.params.slice(variable.fixedParams, variable.fixedParams + count);
  return [...fixed, ...actual, ...Array.from({ length: variable.maxVariableParams - count }, () => '"NaN"')];
}

function parseScriptLines(scriptText: string): Array<{ type: "label"; name: string } | { type: "command"; name: string; params: string[] }> {
  const lines: Array<{ type: "label"; name: string } | { type: "command"; name: string; params: string[] }> = [];
  for (const rawLine of scriptText.split(/\r?\n/u)) {
    const line = stripComment(rawLine).trim();
    if (!line || line.startsWith(".")) continue;
    const label = /^([A-Za-z_][A-Za-z0-9_]*):$/u.exec(line);
    if (label) {
      lines.push({ type: "label", name: label[1] });
      continue;
    }
    const commandMatch = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.*))?$/u.exec(line);
    if (!commandMatch) throw new Error(`Invalid HG animation script line: ${rawLine}`);
    lines.push({ type: "command", name: commandMatch[1], params: splitParams(commandMatch[2] ?? "") });
  }
  return lines;
}

function expandToPrimitives(name: string, params: string[]): PrimitiveCommand[] {
  const lower = name.toLowerCase();
  const requireCount = (count: number): void => {
    if (params.length !== count) throw new Error(`${name} expects ${count} parameter(s), got ${params.length}`);
  };
  const n = (index: number): number => parseExpression(params[index] ?? "", `${name} parameter ${index + 1}`);
  const color = (r: number, g: number, b: number): number => (r | (g << 5) | (b << 10)) | 0;
  const nan10 = Array.from({ length: 10 }, () => '"NaN"');
  const nan8 = Array.from({ length: 8 }, () => '"NaN"');
  const prim = (commandName: string, values: Array<string | number>): PrimitiveCommand => ({ name: commandName, params: values.map(String) });
  const readableCallfunctionId = READABLE_CALLFUNCTION_IDS.get(lower);
  const readablePrimitiveCommand = READABLE_PRIMITIVE_COMMANDS.get(lower);
  if (readablePrimitiveCommand) return [prim(readablePrimitiveCommand, params)];
  if (readableCallfunctionId !== undefined) return [prim("callfunction", [readableCallfunctionId, ...params])];
  if (lower === "particle_metadata") return [prim("cmd37", params)];
  if (lower === "particle_operator") {
    requireCount(6);
    return [prim("cmd37", [6, ...params])];
  }
  if (lower === "particle_operator_offset") {
    requireCount(4);
    return [prim("cmd37", [4, ...params])];
  }
  if (CMD37_FIELD_DATA_ALIASES.has(lower)) {
    requireCount(5);
    return [prim("cmd37", [5, ...params])];
  }

  if (lower === "loadparticlefromspa") {
    requireCount(2);
    const [slot, file] = [n(0), n(1)];
    return [
      prim("initspriteresource", []),
      prim("loadspriteresource", [0]),
      prim("loadspriteresource", [1]),
      prim("loadspriteresource", [2]),
      prim("loadspriteresource", [3]),
      prim("loadspritemaybe", [4, 0, 0, 0]),
      prim("loadspritemaybe", [5, 0, 1, 1]),
      prim("loadspritemaybe", [6, 0, 2, 2]),
      prim("loadspritemaybe", [7, 0, 3, 3]),
      prim("callfunction", [78, 1, 0, ...nan10.slice(1)]),
      prim("loadparticle", [slot, file]),
      prim("waitstate", []),
      prim("unloadspriteresource", []),
      prim("resetsprite", [0]),
      prim("resetsprite", [1]),
      prim("resetsprite", [2]),
      prim("resetsprite", [3]),
    ];
  }

  if (lower === "shadeattackingmon") {
    requireCount(3);
    return [prim("callfunction", [34, 6, 2, 0, 1, color(n(0), n(1), n(2)), 10, 10, ...nan10.slice(6)])];
  }
  if (lower === "shadetargetmon") {
    requireCount(3);
    return [prim("callfunction", [34, 5, 8, 1, 1, color(n(0), n(1), n(2)), 12, ...nan10.slice(5)])];
  }
  if (lower === "flashscreencolor") {
    requireCount(3);
    return [prim("callfunction", [33, 5, 0, 1, 12, 0, color(n(0), n(1), n(2)), ...nan10.slice(5)])];
  }
  if (lower === "shaketargetmon") {
    requireCount(2);
    return [prim("callfunction", [36, 5, n(0), 0, 1, n(1), 264, ...nan10.slice(5)])];
  }
  if (lower === "shaketargetside") {
    requireCount(2);
    return [
      prim("callfunction", [36, 5, n(0), 0, 1, n(1), 264, ...nan10.slice(5)]),
      prim("callfunction", [36, 5, n(0), 0, 1, n(1), 272, ...nan10.slice(5)]),
    ];
  }
  if (lower === "shakeallbutuser") {
    requireCount(2);
    return [prim("callfunction", [36, 5, n(0), 0, 1, n(1), 288, ...nan10.slice(5)])];
  }
  if (lower === "slideattackingmon") {
    requireCount(2);
    return [prim("callfunction", [57, 4, 4, n(0), n(1), 258, ...nan10.slice(4)])];
  }
  if (lower === "shakescreen") {
    requireCount(0);
    return [prim("callfunction", [68, 5, 8, 8, 0, 10, 0, ...nan10.slice(5)])];
  }
  if (lower === "moveaxistotarget") {
    requireCount(2);
    return [prim("cmd37", [6, n(0), n(1), 6, 1, 0, 0, ...nan8.slice(6)])];
  }
  if (lower === "shadescreencolor") {
    requireCount(5);
    return [prim("callfunction", [33, 5, 0, 1, n(3), n(4), color(n(0), n(1), n(2)), ...nan10.slice(5)])];
  }
  if (lower === "rotateattackerincircle") {
    requireCount(0);
    return [
      prim("initspriteresource", []),
      prim("loadspriteresource", [0]),
      prim("loadspriteresource", [1]),
      prim("loadspritemaybe", [0, 0, 0, 0]),
      prim("loadspritemaybe", [0, 0, 1, 1]),
      prim("loadspriteresource", [4]),
      prim("loadspritemaybe", [2, 0, 4, 4]),
      prim("cmd52", [2, 0, 4]),
      prim("wait", [1]),
      prim("callfunction", [8, 0, ...nan10]),
      prim("waitstate", []),
      prim("resetsprite", [0]),
      prim("resetsprite", [1]),
      prim("unloadspriteresource", []),
      prim("cmd53", [0]),
      prim("resetsprite", [4]),
    ];
  }

  return [{ name, params }];
}

function rewriteHgEngineScriptToReadable(scriptText: string): string {
  const cmd37FieldState = { mode: 0, cursor: 0 };
  return scriptText
    .split(/\r?\n/u)
    .map((line) => rewriteHgEngineCommandLineToReadable(line, cmd37FieldState))
    .join("\n");
}

function rewriteHgEngineCommandLineToReadable(line: string, cmd37FieldState: { mode: number; cursor: number }): string {
  const match = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.*?))?\s*$/u.exec(line);
  if (!match) return line;
  const [, indent, name, rawParamText = ""] = match;
  const lower = name.toLowerCase();
  const params = splitParams(rawParamText);
  if (lower === "callfunction") {
    const functionId = parseLiteralInteger(params[0]);
    const alias = functionId === undefined ? undefined : READABLE_CALLFUNCTION_ALIASES.get(functionId);
    if (alias) return `${indent}${alias}${params.length > 1 ? ` ${params.slice(1).join(", ")}` : ""}`;
  }
  if (lower === "cmd37") {
    const count = parseLiteralInteger(params[0]);
    const actualParams = count === undefined ? params.slice(1) : params.slice(1, 1 + Math.max(0, count));
    if (count === 6) {
      cmd37FieldState.mode = parseLiteralInteger(params[5]) ?? 0;
      cmd37FieldState.cursor = 0;
      if (isMoveAxisToTargetParams(params)) return `${indent}moveaxistotarget ${params[1]}, ${params[2]}`;
      return `${indent}particle_operator ${actualParams.join(", ")}`;
    }
    if (count === 4) return `${indent}particle_operator_offset ${actualParams.join(", ")}`;
    if (count === 5) return `${indent}${nextCmd37FieldDataAlias(cmd37FieldState)} ${actualParams.join(", ")}`;
    return `${indent}particle_metadata${params.length ? ` ${params.join(", ")}` : ""}`;
  }
  const primitiveAlias = READABLE_PRIMITIVE_ALIASES.get(lower);
  if (primitiveAlias) return `${indent}${primitiveAlias}${params.length ? ` ${params.join(", ")}` : ""}`;
  return line;
}

function nextCmd37FieldDataAlias(state: { mode: number; cursor: number }): string {
  while (state.cursor < CMD37_FIELD_ORDER.length) {
    const bit = CMD37_FIELD_ORDER[state.cursor++];
    if (bit !== 0 && (state.mode & bit) !== 0) return CMD37_FIELD_ALIAS_BY_BIT.get(bit) ?? "particle_field_data";
  }
  return "particle_field_data";
}

function isMoveAxisToTargetParams(params: string[]): boolean {
  return (
    parseLiteralInteger(params[0]) === 6 &&
    parseLiteralInteger(params[3]) === 6 &&
    parseLiteralInteger(params[4]) === 1 &&
    parseLiteralInteger(params[5]) === 0 &&
    parseLiteralInteger(params[6]) === 0
  );
}

function parseLiteralInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^[-+]?(?:0x[0-9a-f]+|\d+)$/iu.test(trimmed)) return undefined;
  const sign = trimmed.startsWith("-") ? -1 : 1;
  const normalized = trimmed.replace(/^[-+]/u, "");
  return sign * (normalized.toLowerCase().startsWith("0x") ? Number.parseInt(normalized.slice(2), 16) : Number.parseInt(normalized, 10));
}

function normalizeCompileParams(definition: HgMoveAnimationCommandDefinition, rawParams: string[]): Array<number | string> {
  if (definition.variable) return normalizeVariableParams(definition, rawParams);
  if (rawParams.length !== definition.params.length) throw new Error(`${definition.name} expects ${definition.params.length} parameter(s), got ${rawParams.length}`);
  return rawParams.map((param, index) => (isBranchParam(definition, index) ? normalizeLabel(param, definition.name, index) : parseExpression(param, `${definition.name} parameter ${index + 1}`)));
}

function normalizeVariableParams(definition: HgMoveAnimationCommandDefinition, rawParams: string[]): number[] {
  const variable = definition.variable;
  if (!variable) throw new Error(`${definition.name} is not variable length`);
  if (rawParams.length < variable.fixedParams) throw new Error(`${definition.name} expects at least ${variable.fixedParams} parameter(s), got ${rawParams.length}`);
  const fixed = rawParams.slice(0, variable.fixedParams).map((param, index) => parseExpression(param, `${definition.name} parameter ${index + 1}`));
  const count = fixed[variable.countParam];
  if (count < 0 || count > variable.maxVariableParams) throw new Error(`${definition.name} count must be between 0 and ${variable.maxVariableParams}`);
  const provided = rawParams.slice(variable.fixedParams);
  if (provided.length < count) throw new Error(`${definition.name} count is ${count}, but only ${provided.length} variable parameter(s) were provided`);
  if (provided.length > variable.maxVariableParams) throw new Error(`${definition.name} accepts at most ${variable.maxVariableParams} variable parameter(s)`);
  for (let index = count; index < provided.length; index += 1) {
    if (!isNanPlaceholder(provided[index])) throw new Error(`${definition.name} placeholder parameter ${index + 1} must be "NaN"`);
  }
  return [...fixed, ...provided.slice(0, count).map((param, index) => parseExpression(param, `${definition.name} variable parameter ${index + 1}`))];
}

function normalizeLabel(value: string, commandName: string, index: number): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(trimmed)) throw new Error(`${commandName} branch parameter ${index + 1} must be a label`);
  return trimmed;
}

function isBranchParam(definition: HgMoveAnimationCommandDefinition, index: number): boolean {
  return definition.branchParams?.includes(index) ?? false;
}

function splitParams(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const tokens: string[] = [];
  let current = "";
  let quote: string | undefined;
  let hasComma = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      current += char;
      continue;
    }
    if (char === "," && !quote) {
      hasComma = true;
      tokens.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) tokens.push(current.trim());
  if (hasComma) return tokens.filter(Boolean);
  return trimmed.split(/\s+/u).filter(Boolean);
}

function stripComment(line: string): string {
  let quote: string | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && (!quote || quote === char)) quote = quote ? undefined : char;
    if (!quote && char === "/" && line[index + 1] === "/") return line.slice(0, index);
    if (!quote && char === "@") return line.slice(0, index);
  }
  return line;
}

function parseExpression(input: string, label: string): number {
  const trimmed = input.trim();
  if (isNanPlaceholder(trimmed)) throw new Error(`${label} cannot be "NaN"`);
  const parser = new ExpressionParser(trimmed, label);
  const value = parser.parse();
  if (!Number.isSafeInteger(value) || value < -2147483648 || value > 0xffffffff) throw new Error(`${label} must fit in 32 bits`);
  return value | 0;
}

function renderHgMessage(words: number[]): string {
  let text = "";
  for (let index = 0; index < words.length; index += 1) {
    const code = words[index];
    if (code === 0xffff) break;
    if (code === 0xfffe) {
      const kind = words[++index] ?? 0;
      const count = words[++index] ?? 0;
      const args = Array.from({ length: count }, () => words[++index] ?? 0);
      text += `{${kind.toString(16).toUpperCase().padStart(4, "0")}${args.length ? ` ${args.join(",")}` : ""}}`;
      continue;
    }
    if (code === 0xf100) {
      text += "{TRNAME}";
      continue;
    }
    text += hgChar(code);
  }
  return text;
}

function hgChar(code: number): string {
  if (code >= 0x0121 && code <= 0x012a) return String.fromCharCode(48 + code - 0x0121);
  if (code >= 0x012b && code <= 0x0144) return String.fromCharCode(65 + code - 0x012b);
  if (code >= 0x0145 && code <= 0x015e) return String.fromCharCode(97 + code - 0x0145);
  const mapped = HG_CHAR_MAP.get(code);
  return mapped ?? `\\x${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

const HG_CHAR_MAP = new Map<number, string>([
  [0x0000, ""],
  [0x01ab, "!"],
  [0x01ac, "?"],
  [0x01ad, ","],
  [0x01ae, "."],
  [0x01af, "..."],
  [0x01b0, "."],
  [0x01b1, "/"],
  [0x01b2, "'"],
  [0x01b3, "'"],
  [0x01b4, '"'],
  [0x01b5, '"'],
  [0x01b9, "("],
  [0x01ba, ")"],
  [0x01bb, "M"],
  [0x01bc, "F"],
  [0x01bd, "+"],
  [0x01be, "-"],
  [0x01bf, "*"],
  [0x01c0, "#"],
  [0x01c1, "="],
  [0x01c2, "&"],
  [0x01c3, "~"],
  [0x01c4, ":"],
  [0x01c5, ";"],
  [0x01d0, "@"],
  [0x01d2, "%"],
  [0x01de, " "],
  [0x01e8, "deg"],
  [0x01e9, "_"],
  [0x015f, "A"],
  [0x0160, "A"],
  [0x0161, "A"],
  [0x0163, "A"],
  [0x0166, "C"],
  [0x0167, "E"],
  [0x0168, "E"],
  [0x0169, "E"],
  [0x016a, "E"],
  [0x016b, "I"],
  [0x016c, "I"],
  [0x016d, "I"],
  [0x016e, "I"],
  [0x0170, "N"],
  [0x0171, "O"],
  [0x0172, "O"],
  [0x0173, "O"],
  [0x0175, "O"],
  [0x0178, "U"],
  [0x0179, "U"],
  [0x017a, "U"],
  [0x017b, "U"],
  [0x017f, "a"],
  [0x0180, "a"],
  [0x0181, "a"],
  [0x0183, "a"],
  [0x0186, "c"],
  [0x0187, "e"],
  [0x0188, "e"],
  [0x0189, "e"],
  [0x018a, "e"],
  [0x018b, "i"],
  [0x018c, "i"],
  [0x018d, "i"],
  [0x018e, "i"],
  [0x0190, "n"],
  [0x0191, "o"],
  [0x0192, "o"],
  [0x0193, "o"],
  [0x0195, "o"],
  [0x0198, "u"],
  [0x0199, "u"],
  [0x019a, "u"],
  [0x019b, "u"],
]);

function cleanHgDisplayText(value: string): string {
  return value.replace(/\\x0000/gu, "").replace(/\s+/gu, " ").trim();
}

class ExpressionParser {
  private readonly tokens: string[];
  private cursor = 0;

  constructor(input: string, private readonly label: string) {
    this.tokens = input.match(/0x[0-9a-f]+|\d+|[A-Za-z_][A-Za-z0-9_]*|<<|[|()+-]/giu) ?? [];
    if (this.tokens.join("").toLowerCase() !== input.replace(/\s+/gu, "").toLowerCase()) throw new Error(`${label} must be an integer expression`);
  }

  parse(): number {
    const value = this.parseOr();
    if (this.cursor !== this.tokens.length) throw new Error(`${this.label} has unexpected token: ${this.tokens[this.cursor]}`);
    return value;
  }

  private parseOr(): number {
    let value = this.parseShift();
    while (this.peek() === "|") {
      this.cursor += 1;
      value = (value | this.parseShift()) | 0;
    }
    return value;
  }

  private parseShift(): number {
    let value = this.parseUnary();
    while (this.peek() === "<<") {
      this.cursor += 1;
      value = (value << this.parseUnary()) | 0;
    }
    return value;
  }

  private parseUnary(): number {
    const token = this.peek();
    if (token === "+" || token === "-") {
      this.cursor += 1;
      const value = this.parseUnary();
      return token === "-" ? -value : value;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const token = this.tokens[this.cursor++];
    if (!token) throw new Error(`${this.label} is missing a value`);
    if (token === "(") {
      const value = this.parseOr();
      if (this.tokens[this.cursor++] !== ")") throw new Error(`${this.label} is missing ")"`);
      return value;
    }
    if (/^0x[0-9a-f]+$/iu.test(token)) return Number.parseInt(token.slice(2), 16);
    if (/^\d+$/u.test(token)) return Number.parseInt(token, 10);
    const constant = CONSTANTS.get(token);
    if (constant === undefined) throw new Error(`Unknown constant in ${this.label}: ${token}`);
    return constant;
  }

  private peek(): string | undefined {
    return this.tokens[this.cursor];
  }
}

function isNanPlaceholder(value: string): boolean {
  return /^["']?NaN["']?$/iu.test(value.trim());
}

function readI32(data: Uint8Array, offset: number): number {
  return readU32(data, offset) | 0;
}

function padId(value: number): string {
  return String(value).padStart(3, "0");
}

function hex(value: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(4, "0");
}

export function isNintendoDsRom(bytes: Uint8Array): boolean {
  return bytes.length >= 0x200 && readAscii(bytes, 0x10, 2) !== "";
}
