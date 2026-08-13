import { readU16, writeU16, writeU32 } from "../nds/binary";
import { recordFieldChange } from "./actionChangelog";
import {
  scanGen5ScriptPokemonCommands,
  type ScriptPokemonCommand,
  type ScriptPokemonCommandType,
  type ScriptPokemonFieldName,
  type ScriptPokemonScanDiagnostic,
  type ScriptValueRef,
} from "./gen5ScriptPokemonScanner";
import {
  GEN5_INGAME_TRADE_FIELDS,
  scanAllGen5InGameTrades,
  type Gen5InGameTrade,
  type Gen5InGameTradeField,
} from "./ingameTradeModel";
import { markDirty, type ProjectState } from "./projectStore";
import { detectStartersFromScriptBytes, findStarterScriptFileIds } from "./starterModel";

const WORD_SET_POKE_SPECIES = 0x57;
const WORD_SET_POKE_SPECIES_WITH_ARTICLE = 0x58;

export type { ScriptValueRef } from "./gen5ScriptPokemonScanner";

export type ScriptPokemonLocationReference = {
  headerId: number;
  locationName: string;
  referenceType: "script" | "level_script";
};

export type ScriptPokemonDiagnostic = Omit<ScriptPokemonScanDiagnostic, "code"> & {
  code: ScriptPokemonScanDiagnostic["code"] | "missing_narc" | "unsupported_game" | "managed_starter" | "missing_trade_record";
  scriptFileId?: number;
};

export type ScriptPokemonValueSource = {
  narc: "scripts" | "ingame_trades";
  fileId: number;
  offset: number;
  width: 2 | 4;
};

export type ScriptPokemonFieldOption = {
  value: number;
  label: string;
};

export type ScriptPokemonBitFlag = ScriptPokemonFieldOption & {
  mask: number;
  category: "Encounter" | "Pokemon" | "Battle behavior";
  description: string;
  exclusiveWith?: number;
};

/**
 * SCR_WILD_BTL_FLAG_* from Gen 5's field/script_def.h. The remaining u16 bits
 * are intentionally left unnamed and are preserved by the raw-value control.
 */
export const GEN5_WILD_BATTLE_FLAGS: readonly ScriptPokemonBitFlag[] = [
  {
    value: 0x0001,
    mask: 0x0001,
    category: "Encounter",
    label: "Legendary encounter",
    description: "Use the legendary wild-battle encounter message.",
    exclusiveWith: 0x0080,
  },
  {
    value: 0x0080,
    mask: 0x0080,
    category: "Encounter",
    label: "Talking encounter",
    description: "Use the special talking-wild-Pokemon encounter message.",
    exclusiveWith: 0x0001,
  },
  {
    value: 0x0002,
    mask: 0x0002,
    category: "Pokemon",
    label: "Force shiny",
    description: "Generate a shiny Pokemon.",
    exclusiveWith: 0x0010,
  },
  {
    value: 0x0010,
    mask: 0x0010,
    category: "Pokemon",
    label: "Force non-shiny",
    description: "Prevent the Pokemon from being shiny.",
    exclusiveWith: 0x0002,
  },
  {
    value: 0x0004,
    mask: 0x0004,
    category: "Pokemon",
    label: "No held item",
    description: "Remove the generated wild held item.",
  },
  {
    value: 0x0008,
    mask: 0x0008,
    category: "Pokemon",
    label: "Hidden ability",
    description: "Force the species' third (hidden) ability.",
  },
  {
    value: 0x0020,
    mask: 0x0020,
    category: "Pokemon",
    label: "Force male",
    description: "Generate a male Pokemon where the species permits it.",
    exclusiveWith: 0x0040,
  },
  {
    value: 0x0040,
    mask: 0x0040,
    category: "Pokemon",
    label: "Force female",
    description: "Generate a female Pokemon where the species permits it.",
    exclusiveWith: 0x0020,
  },
  {
    value: 0x0100,
    mask: 0x0100,
    category: "Battle behavior",
    label: "Retry until caught",
    description: "Use the Victini-style immortal battle flow so the encounter can be retried until capture.",
  },
] as const;

export const GEN5_WILD_BATTLE_KNOWN_FLAG_MASK = GEN5_WILD_BATTLE_FLAGS
  .reduce((mask, flag) => mask | flag.mask, 0);

export type ScriptPokemonEditableField = {
  key: string;
  name: string;
  label: string;
  value?: number;
  rawValue?: number;
  editable: boolean;
  reason?: string;
  min: number;
  max: number;
  control: "species" | "item" | "nature" | "select" | "bit_flags" | "number";
  options?: readonly ScriptPokemonFieldOption[];
  bitFlags?: readonly ScriptPokemonBitFlag[];
  advanced?: boolean;
  source?: ScriptPokemonValueSource;
};

export type ScriptPokemonAcquisition = {
  id: string;
  kind: Exclude<ScriptPokemonCommandType, "trade_start" | "trade_check"> | "trade";
  label: string;
  scriptFileId?: number;
  entryIndex?: number;
  commandOffset?: number;
  commandOffsets: number[];
  scriptStart?: number;
  scriptEnd?: number;
  fields: ScriptPokemonEditableField[];
  tradeFileId?: number;
  tradeRecordMissing?: boolean;
  warnings: string[];
};

export type ScriptPokemonEntryGroup = {
  entryIndex?: number;
  acquisitions: ScriptPokemonAcquisition[];
};

export type ScriptPokemonGroup = {
  key: string;
  scriptFileId?: number;
  locations: ScriptPokemonLocationReference[];
  entries: ScriptPokemonEntryGroup[];
  acquisitionCount: number;
  editableFieldCount: number;
};

export type ScriptPokemonScanResult = {
  groups: ScriptPokemonGroup[];
  diagnostics: ScriptPokemonDiagnostic[];
};

export type ScriptPokemonEdit = {
  key: string;
  value: number;
};

export type ScriptPokemonApplyResult = {
  scriptsChanged: number[];
  tradesChanged: number[];
  fieldsChanged: number;
  warnings: string[];
};

type TradeCommandReference = {
  fileId: number;
  entryIndex: number;
  tradeId?: number;
  command: ScriptPokemonCommand;
};

export function scanGen5ScriptPokemon(project: ProjectState): ScriptPokemonScanResult {
  const diagnostics: ScriptPokemonDiagnostic[] = [];
  const groups: ScriptPokemonGroup[] = [];
  const scripts = project.narcs.scripts;
  if (!scripts) {
    return {
      groups,
      diagnostics: [{ severity: "error", code: "missing_narc", message: "Scripts are not loaded." }],
    };
  }
  if (project.session.baseRom !== "BW" && project.session.baseRom !== "BW2") {
    return {
      groups,
      diagnostics: [{ severity: "error", code: "unsupported_game", message: "Scripted Pokemon editing is supported for BW/BW2 only." }],
    };
  }

  const starterSpeciesByFile = new Map(findStarterScriptFileIds(project).flatMap((fileId) => {
    const bytes = scripts.rawFiles[fileId];
    const species = bytes && detectStartersFromScriptBytes(bytes, project.session.baseRom);
    return species ? [[fileId, new Set(species)] as const] : [];
  }));
  const tradesById = new Map(scanAllGen5InGameTrades(project).map((trade) => [trade.fileId, trade]));
  const tradeReferences: TradeCommandReference[] = [];
  let managedStarterCount = 0;
  const managedStarterFiles = new Set<number>();
  for (const [fileId, bytes] of scripts.rawFiles.entries()) {
    const scan = scanGen5ScriptPokemonCommands(bytes, project.session.baseRom);
    diagnostics.push(...scan.diagnostics
      .filter((diagnostic) => diagnostic.code !== "dynamic_value" && diagnostic.code !== "ambiguous_value")
      .map((diagnostic) => ({ ...diagnostic, scriptFileId: fileId })));
    const acquisitions: ScriptPokemonAcquisition[] = [];

    for (const command of scan.commands) {
      if (command.type === "trade_start" || command.type === "trade_check") {
        tradeReferences.push({ fileId, entryIndex: command.entryIndex, tradeId: command.fields.tradeId?.value, command });
        continue;
      }
      const starterSpecies = starterSpeciesByFile.get(fileId);
      if (starterSpecies && isStarterGiftCommand(command, starterSpecies)) {
        managedStarterCount += 1;
        managedStarterFiles.add(fileId);
        continue;
      }
      acquisitions.push(commandAcquisition(fileId, command));
    }

    const tradeAcquisitions = tradeAcquisitionsForFile(fileId, tradeReferences.filter((reference) => reference.fileId === fileId), tradesById);
    acquisitions.push(...tradeAcquisitions);
    if (acquisitions.length === 0) continue;
    groups.push(makeScriptGroup(project, fileId, acquisitions));
  }

  const referencedTradeIds = new Set(tradeReferences.flatMap((reference) => reference.tradeId === undefined ? [] : [reference.tradeId]));
  const unmappedTrades = [...tradesById.values()]
    .filter((trade) => !referencedTradeIds.has(trade.fileId))
    .map((trade) => tradeAcquisition(undefined, undefined, trade, [], []));
  if (unmappedTrades.length > 0) {
    groups.push({
      key: "unmapped-trades",
      locations: [],
      entries: [{ acquisitions: unmappedTrades }],
      acquisitionCount: unmappedTrades.length,
      editableFieldCount: unmappedTrades.reduce((sum, acquisition) => sum + acquisition.fields.filter((field) => field.editable).length, 0),
    });
  }

  if (!project.narcs.ingame_trades && tradeReferences.length > 0) {
    diagnostics.push({
      severity: "warning",
      code: "missing_narc",
      message: "In-game Trades is not loaded. Trade commands are shown, but their records cannot be edited.",
    });
  }
  if (managedStarterCount > 0) {
    diagnostics.push({
      severity: "warning",
      code: "managed_starter",
      message: `${managedStarterCount} starter selection command${managedStarterCount === 1 ? " is" : "s are"} managed by the starter editor and omitted here (script file${managedStarterFiles.size === 1 ? "" : "s"} ${[...managedStarterFiles].join(", ")}).`,
    });
  }
  return { groups, diagnostics: dedupeProjectDiagnostics(diagnostics) };
}

export function applyGen5ScriptPokemonGroup(
  project: ProjectState,
  groupKey: string,
  edits: ScriptPokemonEdit[],
): ScriptPokemonApplyResult {
  const current = scanGen5ScriptPokemon(project);
  const group = current.groups.find((candidate) => candidate.key === groupKey);
  if (!group) throw new Error(`Scripted Pokemon group no longer exists: ${groupKey}`);

  const fields = group.entries.flatMap((entry) => entry.acquisitions.flatMap((acquisition) => acquisition.fields));
  const fieldsByKey = groupBy(fields, (field) => field.key);
  const requestedValues = new Map<string, number>();
  for (const edit of edits) {
    if (!Number.isInteger(edit.value)) throw new Error(`Value for ${edit.key} must be an integer.`);
    const prior = requestedValues.get(edit.key);
    if (prior !== undefined && prior !== edit.value) throw new Error(`Conflicting edits target shared operand ${edit.key}.`);
    requestedValues.set(edit.key, edit.value);
  }

  const changed = new Map<string, { fields: ScriptPokemonEditableField[]; value: number; before: number; source: ScriptPokemonValueSource }>();
  for (const [key, value] of requestedValues) {
    const matching = fieldsByKey.get(key);
    if (!matching || matching.length === 0) throw new Error(`Unknown or stale scripted Pokemon field: ${key}`);
    const exemplar = matching[0]!;
    if (matching.every((field) => field.value === value)) continue;
    for (const field of matching) {
      if (!field.editable || !field.source || field.value === undefined) throw new Error(field.reason ?? `${field.label} is read-only.`);
      if (value < field.min || value > field.max) throw new Error(`${field.label} must be between ${field.min} and ${field.max}.`);
    }
    changed.set(key, { fields: matching, value, before: exemplar.value!, source: exemplar.source! });
  }
  if (changed.size === 0) return { scriptsChanged: [], tradesChanged: [], fieldsChanged: 0, warnings: [] };

  const scriptCopies = new Map<number, Uint8Array>();
  const tradeCopies = new Map<number, Uint8Array>();
  for (const change of changed.values()) {
    const store = project.narcs[change.source.narc];
    const source = store?.rawFiles[change.source.fileId];
    if (!source || change.source.offset + change.source.width > source.length) throw new Error(`Source data for ${change.fields[0]?.label ?? "field"} changed while editing.`);
    const copies = change.source.narc === "scripts" ? scriptCopies : tradeCopies;
    const out = copies.get(change.source.fileId) ?? new Uint8Array(source);
    if (change.source.width === 2) writeU16(out, change.source.offset, change.value);
    else writeU32(out, change.source.offset, change.value);
    copies.set(change.source.fileId, out);
  }

  const warnings = synchronizeCompanionSpecies(project, group, changed, scriptCopies);

  const scripts = project.narcs.scripts;
  const trades = project.narcs.ingame_trades;
  if (scriptCopies.size > 0 && !scripts) throw new Error("Scripts are not loaded.");
  if (tradeCopies.size > 0 && !trades) throw new Error("In-game Trades is not loaded.");
  for (const [fileId, bytes] of scriptCopies) {
    scripts!.rawFiles[fileId] = bytes;
    scripts!.records.delete(fileId);
    markDirty(project, "scripts", fileId);
  }
  for (const [fileId, bytes] of tradeCopies) {
    trades!.rawFiles[fileId] = bytes;
    trades!.records.delete(fileId);
    markDirty(project, "ingame_trades", fileId);
  }
  for (const [key, change] of changed) {
    const field = change.fields[0]!;
    const subject = change.source.narc === "scripts" ? `Script ${change.source.fileId}` : `Trade ${change.source.fileId}`;
    recordFieldChange(project, change.source.narc, subject, field.label, change.before, change.value, { key: `script-pokemon:${key}` });
  }

  return {
    scriptsChanged: [...scriptCopies.keys()],
    tradesChanged: [...tradeCopies.keys()],
    fieldsChanged: changed.size,
    warnings,
  };
}

function commandAcquisition(fileId: number, command: ScriptPokemonCommand): ScriptPokemonAcquisition {
  return {
    id: `script:${fileId}:${command.entryIndex}:${command.commandOffset}`,
    kind: command.type as ScriptPokemonAcquisition["kind"],
    label: command.label,
    scriptFileId: fileId,
    entryIndex: command.entryIndex,
    commandOffset: command.commandOffset,
    commandOffsets: [command.commandOffset],
    scriptStart: command.scriptStart,
    scriptEnd: command.scriptEnd,
    fields: Object.entries(command.fields).map(([name, ref]) => scriptField(fileId, name as ScriptPokemonFieldName, ref, command.type)),
    warnings: Object.values(command.fields).flatMap((ref) => ref?.reason ? [ref.reason] : []),
  };
}

function tradeAcquisitionsForFile(fileId: number, references: TradeCommandReference[], trades: Map<number, Gen5InGameTrade>): ScriptPokemonAcquisition[] {
  const grouped = groupBy(references, (reference) => `${reference.entryIndex}:${reference.tradeId ?? `dynamic-${reference.command.commandOffset}`}`);
  return [...grouped.values()].map((matches) => {
    const first = matches[0]!;
    const trade = first.tradeId === undefined ? undefined : trades.get(first.tradeId);
    return tradeAcquisition(fileId, first.entryIndex, trade, matches.map((match) => match.command), first.tradeId === undefined
      ? [first.command.fields.tradeId?.reason ?? "The trade record ID is runtime-derived."]
      : []);
  });
}

function tradeAcquisition(
  fileId: number | undefined,
  entryIndex: number | undefined,
  trade: Gen5InGameTrade | undefined,
  commands: ScriptPokemonCommand[],
  warnings: string[],
): ScriptPokemonAcquisition {
  const commandOffsets = commands.map((command) => command.commandOffset);
  const tradeId = commands[0]?.fields.tradeId?.value;
  const tradeFileId = trade?.fileId ?? tradeId;
  const missing = !trade;
  return {
    id: fileId === undefined ? `trade-unmapped:${trade?.fileId}` : `trade:${fileId}:${entryIndex}:${tradeId ?? commandOffsets[0]}`,
    kind: "trade",
    label: commands.length > 0 ? [...new Set(commands.map((command) => command.label))].join(" / ") : "Unreferenced in-game trade",
    scriptFileId: fileId,
    entryIndex,
    commandOffset: commandOffsets[0],
    commandOffsets,
    scriptStart: commands[0]?.scriptStart,
    scriptEnd: commands[0]?.scriptEnd,
    tradeFileId,
    tradeRecordMissing: missing,
    fields: trade ? tradeFields(trade) : [],
    warnings: missing
      ? [...warnings, tradeFileId === undefined ? "The trade record ID is dynamic." : `In-game trade record ${tradeFileId} is missing or invalid.`]
      : warnings,
  };
}

function tradeFields(trade: Gen5InGameTrade): ScriptPokemonEditableField[] {
  return GEN5_INGAME_TRADE_FIELDS.map((spec) => {
    const value = spec.field.startsWith("iv")
      ? trade.ivs[Number(spec.field.slice(2))]!
      : trade[spec.field as Exclude<Gen5InGameTradeField, `iv${number}`>];
    const presentation = tradeFieldPresentation(spec.field);
    return {
      key: `trade:${trade.fileId}:${spec.offset}`,
      name: String(spec.field),
      label: spec.label,
      value,
      rawValue: value,
      editable: true,
      min: spec.min,
      max: spec.max,
      control: presentation.control,
      options: presentation.options,
      advanced: !spec.known,
      source: { narc: "ingame_trades", fileId: trade.fileId, offset: spec.offset, width: 4 },
    };
  });
}

function scriptField(
  fileId: number,
  name: ScriptPokemonFieldName,
  ref: ScriptValueRef,
  commandType: ScriptPokemonCommandType,
): ScriptPokemonEditableField {
  const limits = scriptFieldLimits(name);
  const presentation = scriptFieldPresentation(name, commandType);
  return {
    key: ref.sourceOffset === undefined ? `readonly:${fileId}:${ref.operandOffset}:${name}` : `script:${fileId}:${ref.sourceOffset}`,
    name,
    label: scriptFieldLabel(name),
    value: ref.value,
    rawValue: ref.rawValue,
    editable: ref.writable && ref.sourceOffset !== undefined,
    reason: ref.reason,
    min: limits.min,
    max: limits.max,
    control: presentation.control,
    options: presentation.options,
    bitFlags: presentation.bitFlags,
    advanced: false,
    source: ref.sourceOffset === undefined ? undefined : { narc: "scripts", fileId, offset: ref.sourceOffset, width: 2 },
  };
}

function makeScriptGroup(project: ProjectState, fileId: number, acquisitions: ScriptPokemonAcquisition[]): ScriptPokemonGroup {
  const entries = [...groupBy(acquisitions, (acquisition) => acquisition.entryIndex ?? -1).entries()]
    .sort(([left], [right]) => left - right)
    .map(([entryIndex, entryAcquisitions]) => ({ entryIndex: entryIndex < 0 ? undefined : entryIndex, acquisitions: entryAcquisitions }));
  return {
    key: `script:${fileId}`,
    scriptFileId: fileId,
    locations: locationsForScript(project, fileId),
    entries,
    acquisitionCount: acquisitions.length,
    editableFieldCount: acquisitions.reduce((sum, acquisition) => sum + acquisition.fields.filter((field) => field.editable).length, 0),
  };
}

function locationsForScript(project: ProjectState, scriptFileId: number): ScriptPokemonLocationReference[] {
  const references: ScriptPokemonLocationReference[] = [];
  for (const [headerKey, row] of Object.entries(project.headers?.rows ?? {})) {
    const headerId = Number(row.index ?? headerKey);
    const locationName = String(row.location_name || `Header ${headerId}`);
    if (Number(row.script_id) === scriptFileId) references.push({ headerId, locationName, referenceType: "script" });
    if (Number(row.level_script_id) === scriptFileId) references.push({ headerId, locationName, referenceType: "level_script" });
  }
  return references;
}

function synchronizeCompanionSpecies(
  project: ProjectState,
  group: ScriptPokemonGroup,
  changed: Map<string, { fields: ScriptPokemonEditableField[]; value: number; before: number; source: ScriptPokemonValueSource }>,
  copies: Map<number, Uint8Array>,
): string[] {
  const warnings: string[] = [];
  const scripts = project.narcs.scripts;
  if (!scripts) return warnings;
  for (const entry of group.entries) {
    const acquisitions = entry.acquisitions.filter((acquisition) => acquisition.scriptFileId !== undefined && acquisition.scriptStart !== undefined && acquisition.scriptEnd !== undefined);
    for (const acquisition of acquisitions) {
      for (const field of acquisition.fields.filter((candidate) => candidate.control === "species")) {
        const change = changed.get(field.key);
        if (!change || field.value === undefined || acquisition.scriptFileId === undefined || acquisition.scriptStart === undefined || acquisition.scriptEnd === undefined) continue;
        const source = scripts.rawFiles[acquisition.scriptFileId];
        if (!source) continue;
        const candidates: number[] = [];
        for (let offset = acquisition.scriptStart; offset + 5 <= acquisition.scriptEnd; offset += 1) {
          const opcode = readU16(source, offset);
          if (opcode !== WORD_SET_POKE_SPECIES && opcode !== WORD_SET_POKE_SPECIES_WITH_ARTICLE) continue;
          if (readU16(source, offset + 3) === field.value) candidates.push(offset + 3);
        }
        const sameSpeciesReferences = acquisitions.flatMap((candidate) => candidate.fields)
          .filter((candidate) => candidate.control === "species" && candidate.value === field.value);
        if (candidates.length === 1 && sameSpeciesReferences.length === 1) {
          const out = copies.get(acquisition.scriptFileId) ?? new Uint8Array(source);
          writeU16(out, candidates[0]!, change.value);
          copies.set(acquisition.scriptFileId, out);
        } else if (candidates.length > 0) {
          warnings.push(`Script ${acquisition.scriptFileId} entry ${acquisition.entryIndex}: kept ${candidates.length} ambiguous WordSetPokeSpecies operand(s) unchanged.`);
        }
      }
    }
  }
  return [...new Set(warnings)];
}

function scriptFieldLimits(name: ScriptPokemonFieldName): { min: number; max: number } {
  if (name === "species") return { min: 1, max: 0x3fff };
  if (name === "level") return { min: 1, max: 100 };
  if (name === "ability" || name === "gender" || name === "shiny") return { min: 0, max: 2 };
  if (name === "nature") return { min: 0, max: 24 };
  if (name === "battleFlags") return { min: 0, max: 0xffff };
  if (name === "partyIndex") return { min: 0, max: 5 };
  return { min: 0, max: 0x3fff };
}

function scriptFieldLabel(name: ScriptPokemonFieldName): string {
  return ({
    species: "Pokemon", form: "Form", level: "Level", ability: "Ability Choice", gender: "Gender Policy",
    shiny: "Shiny Policy", item: "Held Item", ball: "Ball", nature: "Nature", battleFlags: "Battle Flags",
    tradeId: "Trade Record ID", partyIndex: "Party Slot",
  } satisfies Record<ScriptPokemonFieldName, string>)[name];
}

type FieldPresentation = Pick<ScriptPokemonEditableField, "control" | "options" | "bitFlags">;

const GIFT_ABILITY_OPTIONS: readonly ScriptPokemonFieldOption[] = [
  { value: 0, label: "Ability 1" },
  { value: 1, label: "Ability 2" },
  { value: 2, label: "Either / random" },
];

const GIFT_GENDER_OPTIONS: readonly ScriptPokemonFieldOption[] = [
  { value: 0, label: "Male" },
  { value: 1, label: "Female" },
  { value: 2, label: "Either / random" },
];

const GIFT_SHINY_OPTIONS: readonly ScriptPokemonFieldOption[] = [
  { value: 0, label: "Force non-shiny" },
  { value: 1, label: "Force shiny" },
  { value: 2, label: "Either / random" },
];

const ABILITY_SLOT_OPTIONS: readonly ScriptPokemonFieldOption[] = [
  { value: 0, label: "Ability 1" },
  { value: 1, label: "Ability 2" },
  { value: 2, label: "Hidden ability" },
];

const POKEMON_GENDER_OPTIONS: readonly ScriptPokemonFieldOption[] = [
  { value: 0, label: "Male" },
  { value: 1, label: "Female" },
  { value: 2, label: "Genderless / unknown" },
];

const REQUESTED_GENDER_OPTIONS: readonly ScriptPokemonFieldOption[] = [
  { value: 0, label: "Male" },
  { value: 1, label: "Female" },
  { value: 2, label: "Any gender" },
];

const TRAINER_GENDER_OPTIONS: readonly ScriptPokemonFieldOption[] = [
  { value: 0, label: "Male" },
  { value: 1, label: "Female" },
  { value: 2, label: "Neutral / unknown" },
];

const GEN5_LANGUAGE_OPTIONS: readonly ScriptPokemonFieldOption[] = [
  { value: 1, label: "Japanese" },
  { value: 2, label: "English" },
  { value: 3, label: "French" },
  { value: 4, label: "Italian" },
  { value: 5, label: "German" },
  { value: 7, label: "Spanish" },
  { value: 8, label: "Korean" },
];

function scriptFieldPresentation(name: ScriptPokemonFieldName, commandType: ScriptPokemonCommandType): FieldPresentation {
  if (name === "species") return { control: "species" };
  if (name === "item" || name === "ball") return { control: "item" };
  if (name === "nature") return { control: "nature" };
  if (name === "battleFlags") return { control: "bit_flags", bitFlags: GEN5_WILD_BATTLE_FLAGS };
  if (name === "ability") return {
    control: "select",
    options: commandType === "n_gift" ? ABILITY_SLOT_OPTIONS : GIFT_ABILITY_OPTIONS,
  };
  if (name === "gender") return {
    control: "select",
    options: commandType === "n_gift" ? POKEMON_GENDER_OPTIONS : GIFT_GENDER_OPTIONS,
  };
  if (name === "shiny") return { control: "select", options: GIFT_SHINY_OPTIONS };
  return { control: "number" };
}

function tradeFieldPresentation(field: Gen5InGameTradeField): FieldPresentation {
  if (field === "givenSpeciesId" || field === "requestedSpeciesId") return { control: "species" };
  if (field === "heldItemId") return { control: "item" };
  if (field === "nature") return { control: "nature" };
  if (field === "abilityChoice") return { control: "select", options: ABILITY_SLOT_OPTIONS };
  if (field === "gender") return { control: "select", options: POKEMON_GENDER_OPTIONS };
  if (field === "requestedGender") return { control: "select", options: REQUESTED_GENDER_OPTIONS };
  if (field === "otGender") return { control: "select", options: TRAINER_GENDER_OPTIONS };
  if (field === "worldCode") return { control: "select", options: GEN5_LANGUAGE_OPTIONS };
  return { control: "number" };
}

function isStarterGiftCommand(command: ScriptPokemonCommand, species: Set<number>): boolean {
  if (command.type !== "party_gift" && command.type !== "party_gift_ex") return false;
  if (command.fields.level?.value !== 5) return false;
  const commandSpecies = command.fields.species?.value;
  return commandSpecies === undefined || species.has(commandSpecies);
}

function groupBy<T, K>(values: T[], key: (value: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const value of values) result.set(key(value), [...(result.get(key(value)) ?? []), value]);
  return result;
}

function dedupeProjectDiagnostics(diagnostics: ScriptPokemonDiagnostic[]): ScriptPokemonDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.code}:${diagnostic.scriptFileId ?? ""}:${diagnostic.entryIndex ?? ""}:${diagnostic.offset ?? ""}:${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
