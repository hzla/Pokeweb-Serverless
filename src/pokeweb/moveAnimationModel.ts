import commandMacros from "../assets/data/B2W2_MOVSCRCMD.s?raw";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { recordGenericChange } from "./actionChangelog";
import type { NarcName } from "./constants";
import {
  getMoveAnimationCommandAliases,
  getMoveAnimationDisplayCommandName,
  getMoveAnimationGenericCommandAliases,
  resolveMoveAnimationCommandName,
} from "./moveAnimationCommandNames";
import { formatMoveAnimationParam, parseMoveAnimationParamToken } from "./moveAnimationParamSemantics";
import { usesExpandedBw2Data } from "./black2UpgradeModel";
import { MOVE_EXPANSION_FIRST_USABLE_ID, usesFrostMoveExpansionLayout } from "./moveExpansionPatch";
import { markDirty, type NarcStore, type ProjectState } from "./projectStore";

const ADDRESSES_PER_ENTRY = 0x0e;
const BATTLE_ANIMATION_OFFSET = 561;
const WHITE2UPGRADE_FIRST_EXPANDED_MOVE_ANIMATION_ID = 560;
const END_COMMANDS = new Set(["CallMoveAnimation", "TerminateMoveScript"]);
const PARTICLE_ID_COMMANDS = new Set([
  "LoadSPA",
  "DoSPAAnimation",
  "DoSPAScreenAnimation",
  "DoSPAAnimation2",
  "DoSPAAllAnimations",
  "DeleteSPA",
  "DoSPAProjectileAnimation",
  "DoSPAProjectileAnimation2",
  "DoSPAProjectileAnimation3",
  "DoSPAProjectileAnimationOrthoCoordinate",
  "DoSPACircleAnimation",
  "DoSPAOrthoCircleAnimation",
]);
const SIMPLE_SCRIPT_COUNT = 1;
const SIMPLE_SCRIPT_LABEL = "SCRIPT_60";

export type MoveAnimationCommandDefinition = {
  opcode: number;
  name: string;
  params: string[];
  ends: boolean;
};

export type ParsedMoveAnimationCommand = {
  label: string;
  line: string;
  opcode: number;
  name: string;
  params: number[];
  ends: boolean;
};

export type ParsedMoveAnimationScript = {
  count: number;
  headerLabels: string[];
  labelOrder: string[];
  scripts: Map<string, ParsedMoveAnimationCommand[]>;
};

type AnimationTarget = {
  storeName: "move_animations" | "battle_animations";
  store: NarcStore;
  index: number;
  white2UpgradeLayout: boolean;
};

export type MoveAnimationTargetInfo = {
  storeName: "move_animations" | "battle_animations";
  sourcePath: string;
  index: number;
  white2UpgradeLayout: boolean;
};

export type MoveAnimationParamDisplayMode = "semantic" | "numeric";

const COMMANDS = parseCommandMacros(commandMacros);
const COMMANDS_BY_NAME = buildCommandNameMap(COMMANDS);
const COMMANDS_BY_OPCODE = new Map(COMMANDS.map((command) => [command.opcode, command]));
const RGB555_PACKED_COMMANDS = new Set(["ChangeColor", "ChangeBackgroundColor", "ObjectPaletteFade"]);
const LEGACY_STORED_PARAM_COUNTS = new Map<number, number>([
  [17, 7],
]);

type MoveAnimationStorageMode = "source" | "legacy-pokeweb";

type DecompileAnimationResult = {
  text: string;
  usedLegacyWidths: boolean;
  commandCount: number;
};

export type MoveAnimationRepairSummary = {
  moveAnimations: number;
  battleAnimations: number;
};

export function getMoveAnimationCommandDefinitions(): MoveAnimationCommandDefinition[] {
  return COMMANDS.map((command) => ({ ...command, params: command.params.slice() }));
}

export function formatMoveAnimationScriptParameters(scriptText: string, mode: MoveAnimationParamDisplayMode): string {
  return scriptText
    .split(/\r?\n/u)
    .map((line, index) => formatMoveAnimationScriptLineParameters(line, mode, index + 1))
    .join("\n");
}

function buildCommandNameMap(commands: MoveAnimationCommandDefinition[]): Map<string, MoveAnimationCommandDefinition> {
  const out = new Map<string, MoveAnimationCommandDefinition>();
  for (const command of commands) {
    const aliases = [
      command.name,
      getMoveAnimationDisplayCommandName(command.name),
      ...getMoveAnimationCommandAliases(command.name),
      ...getMoveAnimationGenericCommandAliases(command.opcode),
    ];
    for (const alias of aliases) out.set(alias.toLowerCase(), command);
  }
  return out;
}

function formatMoveAnimationScriptLineParameters(line: string, mode: MoveAnimationParamDisplayMode, lineNumber: number): string {
  const commentIndex = line.indexOf("@");
  const code = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const comment = commentIndex >= 0 ? line.slice(commentIndex).trimStart() : "";
  if (!code.trim()) return line;
  if (/^\s*\./u.test(code) || /^\s*[A-Za-z_][A-Za-z0-9_]*:\s*$/u.test(code)) return line;

  const match = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.*?))?\s*$/u.exec(code);
  if (!match) return line;
  const [, indent, commandName, paramText = ""] = match;
  const command = COMMANDS_BY_NAME.get(commandName.toLowerCase());
  if (!command) return line;

  const params = normalizeScriptParams(command, parseParams(paramText, command.name));
  if (params.length !== command.params.length) {
    throw new Error(`Line ${lineNumber}: ${commandName} expects ${command.params.length} parameter(s), got ${params.length}`);
  }

  const formattedParams = params.map((value, index) => (mode === "numeric" ? String(value) : formatMoveAnimationParam(command.name, index, value)));
  const formattedCode = `${indent}${commandName}${formattedParams.length ? ` ${formattedParams.join(", ")}` : ""}`;
  return comment ? `${formattedCode} ${comment}` : formattedCode;
}

export function hasMoveAnimationScript(project: ProjectState, moveId: number): boolean {
  return resolveAnimationTarget(project, moveId, false) !== undefined;
}

export function getMoveAnimationTargetInfo(project: ProjectState, moveId: number): MoveAnimationTargetInfo | undefined {
  const target = resolveAnimationTarget(project, moveId, false);
  if (!target) return undefined;
  return {
    storeName: target.storeName,
    sourcePath: target.store.sourcePath,
    index: target.index,
    white2UpgradeLayout: target.white2UpgradeLayout,
  };
}

export function usesWhite2UpgradeMoveAnimationLayout(project: ProjectState): boolean {
  return usesExpandedBw2Data(project);
}

export function decompileMoveAnimation(project: ProjectState, moveId: number): string {
  const target = resolveAnimationTarget(project, moveId, true);
  const bytes = target.store.rawFiles[target.index];
  if (!bytes) throw new Error(`Move animation ${moveId} is missing`);
  return decompileAnimationBytes(bytes);
}

export function decompileMoveAnimationBytes(bytes: Uint8Array): string {
  return decompileAnimationBytes(bytes);
}

export function compileMoveAnimation(_project: ProjectState, _moveId: number, scriptText: string): Uint8Array {
  return compileAnimationScript(scriptText);
}

export function remapMoveAnimationParticleIds(
  bytes: Uint8Array,
  particleIdMap: ReadonlyMap<number, number>,
): { bytes: Uint8Array; referencesChanged: number } {
  if (particleIdMap.size === 0) return { bytes, referencesChanged: 0 };
  let referencesChanged = 0;
  const script = decompileAnimationBytes(bytes);
  const rewritten = script
    .split("\n")
    .map((line) => {
      const match = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s+)([-+]?\d+)(.*)$/u.exec(line);
      if (!match || !PARTICLE_ID_COMMANDS.has(resolveMoveAnimationCommandName(match[2]))) return line;
      const sourceId = Number.parseInt(match[4], 10);
      const targetId = particleIdMap.get(sourceId);
      if (targetId === undefined || targetId === sourceId) return line;
      referencesChanged += 1;
      return `${match[1]}${match[2]}${match[3]}${targetId}${match[5]}`;
    })
    .join("\n");
  return { bytes: compileAnimationScript(rewritten), referencesChanged };
}

export function repairMoveAnimationScriptBytes(bytes: Uint8Array): Uint8Array {
  const source = tryDecompileAnimationBytesForMode(bytes, "source");
  const legacy = tryDecompileAnimationBytesForMode(bytes, "legacy-pokeweb");
  if (!shouldUseLegacyDecompile(source, legacy)) return bytes;
  const repaired = compileAnimationScript(legacy!.text);
  decompileAnimationBytesForMode(repaired, "source");
  return bytesEqual(bytes, repaired) ? bytes : repaired;
}

function tryDecompileAnimationBytesForMode(bytes: Uint8Array, storageMode: MoveAnimationStorageMode): DecompileAnimationResult | undefined {
  try {
    return decompileAnimationBytesForMode(bytes, storageMode);
  } catch {
    return undefined;
  }
}

export function repairLegacyMoveAnimationArchives(project: ProjectState): MoveAnimationRepairSummary {
  const summary: MoveAnimationRepairSummary = { moveAnimations: 0, battleAnimations: 0 };
  repairMoveAnimationStore(project, "move_animations", "moveAnimations", summary);
  repairMoveAnimationStore(project, "battle_animations", "battleAnimations", summary);
  return summary;
}

export function parseMoveAnimationScript(scriptText: string): ParsedMoveAnimationScript {
  const parsed = parseScriptText(scriptText);
  const scripts = new Map<string, ParsedMoveAnimationCommand[]>();
  for (const label of parsed.labelOrder) {
    scripts.set(
      label,
      (parsed.bodies.get(label) ?? []).map((line) => {
        const command = parseCommandLine(label, line);
        return {
          label,
          line,
          opcode: command.definition.opcode,
          name: command.definition.name,
          params: command.params,
          ends: command.definition.ends,
        };
      }),
    );
  }
  return {
    count: parsed.count,
    headerLabels: parsed.headerLabels.slice(),
    labelOrder: parsed.labelOrder.slice(),
    scripts,
  };
}

export function decompileMoveAnimationFile(project: ProjectState, animationId: number): string {
  const store = project.narcs.move_animations;
  if (!store) throw new Error("Move animation NARC is not loaded");
  const bytes = store.rawFiles[animationId];
  if (!bytes) throw new Error(`Move animation ${animationId} does not exist`);
  return decompileAnimationBytes(bytes);
}

export function updateMoveAnimationScript(project: ProjectState, moveId: number, scriptText: string): Uint8Array {
  const target = resolveAnimationTarget(project, moveId, true);
  const bytes = compileMoveAnimation(project, moveId, scriptText);
  target.store.rawFiles[target.index] = bytes;
  target.store.records.delete(target.index);
  markDirty(project, target.storeName, target.index);
  recordGenericChange(project, "move_animations", `Move animation script ${moveId} changed.`, moveAnimationSubject(project, moveId), {
    key: `move-animation:${moveId}`,
  });
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
  recordGenericChange(project, "move_animations", `Move animation script ${moveId} copied from animation ${sourceAnimationId}.`, moveAnimationSubject(project, moveId), {
    key: `move-animation-copy:${moveId}`,
  });
}

function moveAnimationSubject(project: ProjectState, moveId: number): string {
  return project.texts.banks.moves?.[moveId] ?? `Move ${moveId}`;
}

function resolveAnimationTarget(project: ProjectState, moveId: number, throwOnMissing: true): AnimationTarget;
function resolveAnimationTarget(project: ProjectState, moveId: number, throwOnMissing?: false): AnimationTarget | undefined;
function resolveAnimationTarget(project: ProjectState, moveId: number, throwOnMissing = false): AnimationTarget | undefined {
  const white2UpgradeLayout = usesWhite2UpgradeMoveAnimationLayout(project);
  const frostMoveExpansionLayout = usesFrostMoveExpansionLayout(project);
  if (
    (white2UpgradeLayout && moveId >= WHITE2UPGRADE_FIRST_EXPANDED_MOVE_ANIMATION_ID) ||
    (frostMoveExpansionLayout && moveId >= MOVE_EXPANSION_FIRST_USABLE_ID)
  ) {
    const directTarget = resolveAnimationStoreSlot(project, "move_animations", moveId, white2UpgradeLayout);
    if (directTarget) return directTarget;
  }

  if (moveId > 559) {
    const battleTarget = resolveAnimationStoreSlot(project, "battle_animations", moveId - BATTLE_ANIMATION_OFFSET, false);
    if (battleTarget) return battleTarget;
  }

  const directTarget = resolveAnimationStoreSlot(project, "move_animations", moveId, white2UpgradeLayout);
  if (directTarget) return directTarget;

  if (throwOnMissing) throw new Error(`Move animation NARCs are not loaded for move ${moveId}`);
  return undefined;
}

function resolveAnimationStoreSlot(
  project: ProjectState,
  storeName: "move_animations" | "battle_animations",
  index: number,
  white2UpgradeLayout: boolean,
): AnimationTarget | undefined {
  const store = project.narcs[storeName];
  if (!store || index < 0 || index >= store.rawFiles.length) return undefined;
  return { storeName, store, index, white2UpgradeLayout };
}

function decompileAnimationBytes(bytes: Uint8Array): string {
  const source = tryDecompileAnimationBytesForMode(bytes, "source");
  const legacy = tryDecompileAnimationBytesForMode(bytes, "legacy-pokeweb");
  if (shouldUseLegacyDecompile(source, legacy)) return legacy!.text;
  if (source) return source.text;
  if (legacy) return legacy.text;
  return decompileAnimationBytesForMode(bytes, "source").text;
}

function shouldUseLegacyDecompile(source: DecompileAnimationResult | undefined, legacy: DecompileAnimationResult | undefined): boolean {
  if (!legacy?.usedLegacyWidths) return false;
  if (!source) return true;
  return legacy.commandCount > source.commandCount;
}

function decompileAnimationBytesForMode(bytes: Uint8Array, storageMode: MoveAnimationStorageMode): DecompileAnimationResult {
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

  const bodies = new Map<string, string[]>();
  let usedLegacyWidths = false;
  let commandCount = 0;
  const sortedOffsets = [...labelByOffset.keys()].sort((a, b) => a - b);

  for (const [offset, label] of labelByOffset.entries()) {
    if (offset < headerLength || offset >= bytes.length) throw new Error(`Animation script offset is out of range: ${offset}`);
    const nextOffset = sortedOffsets.find((candidate) => candidate > offset) ?? bytes.length;
    const lines: string[] = [];
    let cursor = offset;
    let ended = false;
    while (cursor + 2 <= nextOffset) {
      const opcode = readU16(bytes, cursor);
      cursor += 2;
      const command = COMMANDS_BY_OPCODE.get(opcode);
      if (!command) throw new Error(`Unknown animation command opcode: ${opcode}`);
      const params: number[] = [];
      const paramWidths = storedParamWidthsForCommand(command, storageMode);
      usedLegacyWidths ||= storageMode === "legacy-pokeweb" && LEGACY_STORED_PARAM_COUNTS.has(command.opcode);
      for (const width of paramWidths) {
        if (cursor + width > nextOffset) throw new Error(`Command ${command.name} is truncated`);
        params.push(readStoredParam(bytes, cursor, width));
        cursor += width;
      }
      const scriptParams = decodeStoredParams(command, params, storageMode);
      const displayName = getMoveAnimationDisplayCommandName(command.name);
      const formattedParams = scriptParams.map((value, index) => formatMoveAnimationParam(command.name, index, value));
      lines.push(`${displayName}${formattedParams.length > 0 ? ` ${formattedParams.join(", ")}` : ""}`);
      commandCount += 1;
      if (command.ends) {
        ended = true;
        break;
      }
    }
    if (!ended) throw new Error(`Script ${label} does not terminate`);
    bodies.set(label, lines);
  }

  if (isSimpleScriptHeader(count, offsets, headerLength, labelByOffset)) {
    const label = labelByOffset.get(headerLength);
    const lines = label ? bodies.get(label) : undefined;
    if (lines) return { text: `${lines.join("\n")}\n`, usedLegacyWidths, commandCount };
  }

  const out: string[] = ['.include "B2W2_MOVSCRCMD.s"', ".align 4", "", `.word ${count} @ Count`];
  for (const offset of offsets) out.push(`.word ${labelByOffset.get(offset)}`);
  out.push("");

  for (const [offset, label] of labelByOffset.entries()) {
    out.push(`${label}:`);
    for (const line of bodies.get(label) ?? []) out.push(`     ${line}`);
    out.push("");
  }

  return { text: out.join("\n").trimEnd() + "\n", usedLegacyWidths, commandCount };
}

function isSimpleScriptHeader(count: number, offsets: number[], headerLength: number, labelByOffset: Map<number, string>): boolean {
  return (
    count === SIMPLE_SCRIPT_COUNT &&
    offsets.length === ADDRESSES_PER_ENTRY &&
    labelByOffset.size === 1 &&
    offsets.every((offset) => offset === headerLength)
  );
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
  if (countLineIndex < 0) return parseSimpleScriptText(meaningful);
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

function parseSimpleScriptText(lines: string[]): { count: number; headerLabels: string[]; labelOrder: string[]; bodies: Map<string, string[]> } {
  if (lines.length === 0) throw new Error("Move animation script is empty");
  if (lines.some((line) => /^([A-Za-z_][A-Za-z0-9_]*):$/u.test(line))) {
    throw new Error("Labelled move animation scripts must include the full .word header table");
  }
  if (!bodyTerminates(lines)) throw new Error(`Script ${SIMPLE_SCRIPT_LABEL} must include a terminating command`);
  return {
    count: SIMPLE_SCRIPT_COUNT,
    headerLabels: Array.from({ length: ADDRESSES_PER_ENTRY }, () => SIMPLE_SCRIPT_LABEL),
    labelOrder: [SIMPLE_SCRIPT_LABEL],
    bodies: new Map([[SIMPLE_SCRIPT_LABEL, lines]]),
  };
}

function compileCommandLines(label: string, lines: string[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let terminates = false;
  for (const line of lines) {
    const { definition: command, params } = parseCommandLine(label, line);

    const storedParams = encodeStoredParams(command, params);
    const paramWidths = storedParamWidthsForCommand(command);
    const bytes = new Uint8Array(2 + paramWidths.reduce((sum, width) => sum + width, 0));
    writeU16(bytes, 0, command.opcode);
    let cursor = 2;
    storedParams.forEach((value, index) => {
      writeStoredParam(bytes, cursor, value, paramWidths[index] ?? 4);
      cursor += paramWidths[index] ?? 4;
    });
    parts.push(bytes);
    if (command.ends) terminates = true;
  }
  if (!terminates) throw new Error(`Script ${label} must include a terminating command`);
  return concatBytes(parts);
}

function parseCommandLine(label: string, line: string): { definition: MoveAnimationCommandDefinition; params: number[] } {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.*))?$/u.exec(line);
  if (!match) throw new Error(`Invalid command line in ${label}: ${line}`);
  const command = COMMANDS_BY_NAME.get(match[1].toLowerCase());
  if (!command) throw new Error(`Unknown animation command: ${match[1]}`);
  const params = normalizeScriptParams(command, parseParams(match[2] ?? "", command.name));
  if (params.length !== command.params.length) throw new Error(`${command.name} expects ${command.params.length} parameter(s), got ${params.length}`);
  return { definition: command, params };
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
    .map((value, index) => {
      try {
        return parseMoveAnimationParamToken(commandName, index, value);
      } catch (error) {
        if (error instanceof Error && error.message.includes("must fit in signed 32-bit range")) {
          throw new Error(`${commandName} parameter ${index + 1} must fit in signed 32-bit range`);
        }
        throw error;
      }
    });
}

function normalizeScriptParams(command: MoveAnimationCommandDefinition, params: number[]): number[] {
  if (RGB555_PACKED_COMMANDS.has(command.name) && params.length === 5) return decodeStoredParams(command, params);
  if (command.name === "DoSPAOrthoCircleAnimation" && params.length === 7) return [...params, 0, 0, 0];
  if (command.name === "DistortBackground" && params.length === 4) return [...params, 0, 0];
  if (command.name === "BackgroundPaletteAnimation" && params.length === 5) return params.slice(0, 2);
  return params;
}

function storedParamCountForCommand(command: MoveAnimationCommandDefinition, storageMode: MoveAnimationStorageMode = "source"): number {
  if (storageMode === "legacy-pokeweb") return LEGACY_STORED_PARAM_COUNTS.get(command.opcode) ?? storedParamCountForCommand(command, "source");
  return RGB555_PACKED_COMMANDS.has(command.name) ? 5 : command.params.length;
}

function storedParamWidthsForCommand(command: MoveAnimationCommandDefinition, storageMode: MoveAnimationStorageMode = "source"): number[] {
  return Array.from({ length: storedParamCountForCommand(command, storageMode) }, () => 4);
}

function decodeStoredParams(command: MoveAnimationCommandDefinition, params: number[], storageMode: MoveAnimationStorageMode = "source"): number[] {
  const normalized = decodeLegacyStoredParams(command, params, storageMode);
  if (!RGB555_PACKED_COMMANDS.has(command.name)) return normalized;
  const rgb = normalized[4] ?? 0;
  return [...normalized.slice(0, 4), rgb & 0x1f, (rgb >>> 5) & 0x1f, (rgb >>> 10) & 0x1f];
}

function decodeLegacyStoredParams(command: MoveAnimationCommandDefinition, params: number[], storageMode: MoveAnimationStorageMode): number[] {
  if (storageMode !== "legacy-pokeweb") return params;
  if (command.name === "DoSPAOrthoCircleAnimation" && params.length === 7) return [...params, 0, 0, 0];
  return params;
}

function encodeStoredParams(command: MoveAnimationCommandDefinition, params: number[]): number[] {
  if (!RGB555_PACKED_COMMANDS.has(command.name)) return params;
  const r = clampRgb5(params[4] ?? 0);
  const g = clampRgb5(params[5] ?? 0);
  const b = clampRgb5(params[6] ?? 0);
  return [...params.slice(0, 4), r | (g << 5) | (b << 10)];
}

function clampRgb5(value: number): number {
  return Math.max(0, Math.min(31, Math.round(value)));
}

function parseIntegerToken(token: string, label: string): number {
  if (!/^[-+]?(?:0x[0-9a-f]+|\d+)$/iu.test(token)) throw new Error(`${label} must be an integer`);
  const sign = token.startsWith("-") ? -1 : 1;
  const normalized = token.replace(/^[-+]/u, "");
  const value = sign * (normalized.toLowerCase().startsWith("0x") ? Number.parseInt(normalized.slice(2), 16) : Number.parseInt(normalized, 10));
  if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647) throw new Error(`${label} must fit in signed 32-bit range`);
  return value;
}

function parseCommandMacros(source: string): MoveAnimationCommandDefinition[] {
  const lines = source.split(/\r?\n/u);
  const commands: MoveAnimationCommandDefinition[] = [];
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

function readI16(data: Uint8Array, offset: number): number {
  const value = readU16(data, offset);
  return (value & 0x8000) !== 0 ? value - 0x10000 : value;
}

function readStoredParam(data: Uint8Array, offset: number, width: number): number {
  if (width === 2) return readI16(data, offset);
  return readI32(data, offset);
}

function writeStoredParam(out: Uint8Array, offset: number, value: number, width: number): void {
  if (width === 2) {
    writeU16(out, offset, value & 0xffff);
    return;
  }
  writeU32(out, offset, value >>> 0);
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

function repairMoveAnimationStore(
  project: ProjectState,
  storeName: "move_animations" | "battle_animations",
  summaryKey: keyof MoveAnimationRepairSummary,
  summary: MoveAnimationRepairSummary,
): void {
  const store = project.narcs[storeName];
  if (!store) return;
  store.rawFiles.forEach((bytes, index) => {
    if (!bytes) return;
    let repaired: Uint8Array;
    try {
      repaired = repairMoveAnimationScriptBytes(bytes);
    } catch {
      return;
    }
    if (bytesEqual(bytes, repaired)) return;
    store.rawFiles[index] = repaired;
    store.records.delete(index);
    markDirty(project, storeName, index);
    summary[summaryKey] += 1;
  });
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
