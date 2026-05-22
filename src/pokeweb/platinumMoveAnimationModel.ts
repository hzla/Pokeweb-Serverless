import { readU32, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { decodeHgMessageBank } from "./hgMoveAnimationModel";
import { parseSpaArchive, serializeSpaArchive, type SpaArchive } from "./nitroSpa";

export type PlatinumMoveAnimationScriptArchiveKind = "move";
export type PlatinumMoveAnimationArchiveKind = PlatinumMoveAnimationScriptArchiveKind | "spa";

export type PlatinumMoveAnimationCommandDefinition = {
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

export type PlatinumMoveAnimationArchive = {
  kind: PlatinumMoveAnimationArchiveKind;
  path: string;
  fileId: number;
  narc: NARC;
  dirty: Set<number>;
};

export type PlatinumMoveAnimationRom = {
  rom: NintendoDSRom;
  romInfo: {
    title: string;
    idCode: string;
    size: number;
  };
  archives: Record<PlatinumMoveAnimationArchiveKind, PlatinumMoveAnimationArchive>;
  moveNames: string[];
};

export type ParsedPlatinumMoveAnimationCommand = {
  offset: number;
  opcode: number;
  name: string;
  params: number[];
  length: number;
  branchTargets: Array<{ paramIndex: number; offset: number }>;
};

const ARCHIVE_CONFIG: Record<
  PlatinumMoveAnimationArchiveKind,
  {
    path: string;
    buildDir: string;
    filePrefix: string;
    labelPrefix: string;
  }
> = {
  move: {
    path: "wazaeffect/we.arc",
    buildDir: "build/platinum/move_anim",
    filePrefix: "pt",
    labelPrefix: "pt_we",
  },
  spa: {
    path: "wazaeffect/effectdata/waza_particle.narc",
    buildDir: "build/platinum/move_spa",
    filePrefix: "pt_spa",
    labelPrefix: "pt_spa",
  },
};

const MSGDATA_PATH = "msgdata/pl_msg.narc";
const MOVE_NAMES_BANK = 647;

const COMMANDS: PlatinumMoveAnimationCommandDefinition[] = [
  command(0, "Delay", ["frames"]),
  command(1, "WaitForAnimTasks", []),
  command(2, "BeginLoop", ["loops"]),
  command(3, "EndLoop", []),
  command(4, "End", []),
  command(5, "PlaySoundEffect", ["seqID"]),
  command(6, "Nop0", []),
  command(7, "Nop1", []),
  command(8, "SetBg0Bg1AlphaBlending", ["ev1", "ev2"]),
  command(9, "SetDefaultAlphaBlending", []),
  command(10, "Call", ["addr"], { branchParams: [0] }),
  command(11, "Return", []),
  command(12, "SetVar", ["varID", "value"]),
  command(13, "BtlAnimCmd_013", ["addr0", "addr1"], { branchParams: [0, 1] }),
  command(14, "BtlAnimCmd_014", ["arg0", "arg1"]),
  command(15, "Jump", ["addr"], { branchParams: [0] }),
  command(16, "SwitchBg", ["bgID", "param"]),
  command(17, "SetBgSwitchVar", ["var", "value"]),
  command(18, "RestoreBg", ["bgID", "param"]),
  command(19, "WaitForPartialBgSwitch", []),
  command(20, "WaitForBgSwitch", []),
  command(21, "SetBg", ["bgID"]),
  command(22, "PlayPannedSoundEffect", ["seqID", "pan"]),
  command(23, "PanSoundEffects", ["pan"]),
  command(24, "PlayMovingSoundEffectAtkDef", ["seqID", "startPan", "endPan", "panStep", "applyInterval"]),
  command(25, "PlayLoopedSoundEffect", ["seqID", "pan", "applyInterval", "repeatCount"]),
  command(26, "PlayDelayedSoundEffect", ["seqID", "pan", "delay"]),
  command(27, "Nop2", []),
  command(28, "Nop3", []),
  command(29, "WaitForSoundEffects", []),
  command(30, "JumpIfEqual", ["varID", "value", "addr"], { branchParams: [2] }),
  command(31, "LoadPokemonSpriteIntoBg", ["battlerRole", "trackBattler"]),
  command(32, "RemovePokemonSpriteFromBg", ["unused"]),
  command(33, "BtlAnimCmd_033", ["addr"]),
  command(34, "SwitchBgEx", ["bgPlayerAttack", "bgEnemyAttack", "bgContest"]),
  command(35, "PlayMovingSoundEffectNoCorrection", ["seqID", "startPan", "endPan", "panStep", "applyInterval"]),
  command(36, "PlayMovingSoundEffectAtkDef2", ["seqID", "startPan", "endPan", "panStep", "applyInterval"]),
  command(37, "Nop4", []),
  command(38, "Nop5", []),
  command(39, "Nop6", []),
  command(40, "Nop7", []),
  command(41, "Nop8", []),
  command(42, "Nop9", []),
  command(43, "Nop10", []),
  command(44, "StopSoundEffect", ["seqID"]),
  command(45, "CallFunc", ["funcID", "count", "arg0", "arg1", "arg2", "arg3", "arg4", "arg5", "arg6", "arg7", "arg8", "arg9"], {
    variable: { countParam: 1, fixedParams: 2, maxVariableParams: 10 },
  }),
  command(46, "CreateEmitter", ["particleSystem", "resourceID", "callbackID"]),
  command(47, "CreateEmitterEx", ["particleSystem", "emitterIndex", "resourceID", "callbackID"]),
  command(48, "CreateEmitterForMove", ["particleSystem", "resPlParallel", "resPlDiagonal2", "resPlDiagonal1", "resEmParallel", "resEmDiagonal2", "resEmDiagonal1", "callbackID"]),
  command(49, "CreateEmitterForFriendlyFire", ["particleSystem", "resPl", "resEm", "unused0", "unused1", "callbackID"]),
  command(50, "WaitForAllEmitters", []),
  command(51, "LoadParticleSystem", ["particleSystem", "narcMemberID"]),
  command(52, "LoadDebugParticleSystem", ["particleSystem", "narcID", "narcMemberID"]),
  command(53, "UnloadParticleSystem", ["particleSystem"]),
  command(54, "Nop11", []),
  command(55, "SetExtraParams", ["count", "arg0", "arg1", "arg2", "arg3", "arg4", "arg5", "arg6", "arg7"], {
    variable: { countParam: 0, fixedParams: 1, maxVariableParams: 8 },
  }),
  command(56, "InitPokemonSpriteManager", []),
  command(57, "LoadPokemonSpriteDummyResources", ["resID"]),
  command(58, "AddPokemonSprite", ["battlerRole", "trackBattler", "spriteID", "resID"]),
  command(59, "FreePokemonSpriteManager", []),
  command(60, "RemovePokemonSprite", ["spriteID"]),
  command(61, "CancelTrackingTask", ["task"]),
  command(62, "SetCameraProjection", ["particleSystem", "projection"]),
  command(63, "SetCameraFlip", ["particleSystem", "flipY"]),
  command(64, "JumpIfBattlerSide", ["battler", "addrEnemy", "addrPlayer"], { branchParams: [1, 2] }),
  command(65, "PlayPokemonCry", ["modulation", "pan", "volume"]),
  command(66, "WaitForPokemonCries", ["fadeOutFrames"]),
  command(67, "ResetVars", []),
  command(68, "BtlAnimCmd_068", ["arg0"]),
  command(69, "BtlAnimCmd_069", ["arg0"]),
  command(70, "JumpIfWeather", ["addrNoWeather", "addrRain", "addrSandstorm", "addrSunny", "addrHail"], { branchParams: [0, 1, 2, 3, 4] }),
  command(71, "JumpIfContest", ["addr"], { branchParams: [0] }),
  command(72, "JumpIfFriendlyFire", ["addr"], { branchParams: [0] }),
  command(73, "InitSpriteManager", ["managerID", "maxSprites", "maxCharRes", "maxPlttRes", "maxCellRes", "maxAnimRes", "maxMultiCellRes", "maxMultiAnimRes"]),
  command(74, "LoadCharResObj", ["managerID", "narcMemberIndex"]),
  command(75, "LoadPlttRes", ["managerID", "narcMemberIndex", "paletteIndex"]),
  command(76, "LoadCellResObj", ["managerID", "narcMemberIndex"]),
  command(77, "LoadAnimResObj", ["managerID", "narcMemberIndex"]),
  command(78, "AddSpriteWithFunc", ["managerID", "funcID", "charRes", "plttRes", "cellRes", "animRes", "multiCellRes", "multiAnimRes", "count", "arg0", "arg1", "arg2", "arg3", "arg4", "arg5", "arg6", "arg7", "arg8", "arg9"], {
    variable: { countParam: 8, fixedParams: 9, maxVariableParams: 10 },
  }),
  command(79, "AddSprite", ["managerID", "spriteID", "charRes", "plttRes", "cellRes", "animRes", "multiCellRes", "multiAnimRes"]),
  command(80, "FreeSpriteManager", ["managerID"]),
  command(81, "SetPokemonSpriteVisible", ["spriteID", "visible"]),
  command(82, "BtlAnimCmd_082", ["arg0", "arg1", "arg2"]),
  command(83, "BtlAnimCmd_083", ["arg0"]),
  command(84, "WaitForLRX", []),
];

const COMMANDS_BY_NAME = new Map(COMMANDS.map((entry) => [entry.name.toLowerCase(), entry]));
const COMMANDS_BY_OPCODE = new Map(COMMANDS.map((entry) => [entry.opcode, entry]));

type CompileCommand = {
  offset: number;
  definition: PlatinumMoveAnimationCommandDefinition;
  params: Array<number | string>;
};

export function getPlatinumMoveAnimationCommandDefinitions(): PlatinumMoveAnimationCommandDefinition[] {
  return COMMANDS.map((definition) => ({
    ...definition,
    params: definition.params.slice(),
    branchParams: definition.branchParams?.slice(),
    variable: definition.variable ? { ...definition.variable } : undefined,
  }));
}

export function loadPlatinumMoveAnimationRom(romBytes: Uint8Array): PlatinumMoveAnimationRom {
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
      spa: loadArchive(rom, "spa"),
    },
    moveNames: loadPlatinumMoveNames(rom),
  };
}

export function decompilePlatinumMoveAnimation(bytes: Uint8Array, options: { archiveKind: PlatinumMoveAnimationScriptArchiveKind; fileId: number }): string {
  if (bytes.length % 4 !== 0) throw new Error("Platinum animation scripts must be 32-bit aligned");
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
    '.include "asm/macros/btlanimcmd.inc"',
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

export function decompilePlatinumMoveAnimationReadable(bytes: Uint8Array, options: { archiveKind: PlatinumMoveAnimationScriptArchiveKind; fileId: number }): string {
  return decompilePlatinumMoveAnimation(bytes, options);
}

export function compilePlatinumMoveAnimationScript(scriptText: string, _options: { archiveKind: PlatinumMoveAnimationScriptArchiveKind; fileId: number }): Uint8Array {
  const commands: CompileCommand[] = [];
  const labels = new Map<string, number>();
  let offset = 0;

  for (const parsed of parseScriptLines(scriptText)) {
    if (parsed.type === "label") {
      if (labels.has(parsed.name)) throw new Error(`Duplicate label: ${parsed.name}`);
      labels.set(parsed.name, offset);
      continue;
    }

    const definition = COMMANDS_BY_NAME.get(parsed.name.toLowerCase());
    if (!definition) throw new Error(`Unknown Platinum animation command: ${parsed.name}`);
    const params = normalizeCompileParams(definition, parsed.params);
    commands.push({ offset, definition, params });
    offset += 4 * (1 + params.length);
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

export function parsePlatinumMoveAnimationBinary(bytes: Uint8Array): ParsedPlatinumMoveAnimationCommand[] {
  if (bytes.length % 4 !== 0) throw new Error("Platinum animation scripts must be 32-bit aligned");
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

export function parsePlatinumMoveAnimationScript(scriptText: string, options: { archiveKind: PlatinumMoveAnimationScriptArchiveKind; fileId: number }): ParsedPlatinumMoveAnimationCommand[] {
  return parsePlatinumMoveAnimationBinary(compilePlatinumMoveAnimationScript(scriptText, options));
}

export function updatePlatinumMoveAnimationFile(state: PlatinumMoveAnimationRom, kind: PlatinumMoveAnimationScriptArchiveKind, fileId: number, scriptText: string): Uint8Array {
  const archive = state.archives[kind];
  if (fileId < 0 || fileId >= archive.narc.files.length) throw new Error(`Animation file ${fileId} is out of range`);
  const bytes = compilePlatinumMoveAnimationScript(scriptText, { archiveKind: kind, fileId });
  archive.narc.files[fileId] = bytes;
  archive.dirty.add(fileId);
  return bytes;
}

export function exportPlatinumMoveAnimationArchive(state: PlatinumMoveAnimationRom, kind: PlatinumMoveAnimationArchiveKind): Uint8Array {
  return state.archives[kind].narc.save();
}

export function exportPlatinumMoveAnimationRom(state: PlatinumMoveAnimationRom): Uint8Array {
  const files = new Map<number, Uint8Array>();
  files.set(state.archives.move.fileId, state.archives.move.narc.save());
  files.set(state.archives.spa.fileId, state.archives.spa.narc.save());
  return state.rom.save({ files });
}

export function loadPlatinumMoveSpaArchive(state: PlatinumMoveAnimationRom, spaId: number): SpaArchive {
  const archive = state.archives.spa;
  const bytes = archive.narc.files[spaId];
  if (!bytes) throw new Error(`SPA file ${spaId} does not exist in ${archive.path}`);
  return parseSpaArchive(bytes);
}

export function updatePlatinumMoveSpaArchive(state: PlatinumMoveAnimationRom, spaId: number, spaArchive: SpaArchive): Uint8Array {
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

export function exportPlatinumMoveSpaFile(state: PlatinumMoveAnimationRom, spaId: number, archiveOverride?: SpaArchive): Uint8Array {
  if (archiveOverride) return serializeSpaArchive(archiveOverride);
  const bytes = state.archives.spa.narc.files[spaId];
  if (!bytes) throw new Error(`SPA file ${spaId} does not exist in ${state.archives.spa.path}`);
  return bytes.slice();
}

export function appendPlatinumMoveSpaFiles(state: PlatinumMoveAnimationRom, files: Uint8Array[]): number[] {
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
  options: Pick<PlatinumMoveAnimationCommandDefinition, "branchParams" | "variable"> = {},
): PlatinumMoveAnimationCommandDefinition {
  return { opcode, name, params, ...options };
}

function loadArchive(rom: NintendoDSRom, kind: PlatinumMoveAnimationArchiveKind): PlatinumMoveAnimationArchive {
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

function loadPlatinumMoveNames(rom: NintendoDSRom): string[] {
  try {
    const msgData = new NARC(rom.getFileByName(MSGDATA_PATH));
    const bank = msgData.files[MOVE_NAMES_BANK];
    if (!bank) return [];
    return decodeHgMessageBank(bank).map(cleanPlatinumDisplayText);
  } catch {
    return [];
  }
}

function cleanPlatinumDisplayText(value: string): string {
  return value.replace(/\\x0000/gu, "").replace(/\s+/gu, " ").trim();
}

function readCommands(bytes: Uint8Array): CompileCommand[] {
  const commands: CompileCommand[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const opcode = readU32(bytes, offset);
    const definition = COMMANDS_BY_OPCODE.get(opcode);
    if (!definition) throw new Error(`Unknown Platinum animation opcode 0x${hex(opcode)} at 0x${hex(offset)}`);
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

function readParamCount(bytes: Uint8Array, offset: number, definition: PlatinumMoveAnimationCommandDefinition): number {
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
    if (!commandMatch) throw new Error(`Invalid Platinum animation script line: ${rawLine}`);
    lines.push({ type: "command", name: commandMatch[1], params: splitParams(commandMatch[2] ?? "") });
  }
  return lines;
}

function normalizeCompileParams(definition: PlatinumMoveAnimationCommandDefinition, rawParams: string[]): Array<number | string> {
  if (definition.variable) return normalizeVariableParams(definition, rawParams);
  if (definition.name === "RemovePokemonSpriteFromBg" && rawParams.length === 0) return [0];
  if (rawParams.length !== definition.params.length) throw new Error(`${definition.name} expects ${definition.params.length} parameter(s), got ${rawParams.length}`);
  return rawParams.map((param, index) => (isBranchParam(definition, index) ? normalizeLabel(param, definition.name, index) : parseExpression(param, `${definition.name} parameter ${index + 1}`)));
}

function normalizeVariableParams(definition: PlatinumMoveAnimationCommandDefinition, rawParams: string[]): number[] {
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

function isBranchParam(definition: PlatinumMoveAnimationCommandDefinition, index: number): boolean {
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
    if (!quote && char === "@" || !quote && char === ";") return line.slice(0, index);
  }
  return line;
}

function parseExpression(input: string, label: string): number {
  const trimmed = input.trim();
  if (isNanPlaceholder(trimmed)) throw new Error(`${label} cannot be "NaN"`);
  if (!/^[-+]?(?:0x[0-9a-f]+|\d+)$/iu.test(trimmed)) throw new Error(`${label} must be a numeric literal in Platinum V1`);
  const sign = trimmed.startsWith("-") ? -1 : 1;
  const normalized = trimmed.replace(/^[-+]/u, "");
  const value = sign * (normalized.toLowerCase().startsWith("0x") ? Number.parseInt(normalized.slice(2), 16) : Number.parseInt(normalized, 10));
  if (!Number.isSafeInteger(value) || value < -2147483648 || value > 0xffffffff) throw new Error(`${label} must fit in 32 bits`);
  return value | 0;
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
