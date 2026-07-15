import type { ActionChangelogEntry } from "./actionChangelog";
import { PROPERTIES } from "./constants";
import { updateEncounterField } from "./encounterModel";
import { updateHeaderField, updateHeaderPackedField } from "./headerModel";
import { updateGrottoField, updateGrottoOddsField, updateMartField } from "./martGrottoModel";
import { updateMoveEffectHandlerAddress, updateMoveEffectHandlerMove } from "./moveEffectHandlerModel";
import { updateItemField, updateMoveField } from "./moveItemModel";
import { updateOverworldEntityField, updateOverworldField, updateMapTile, type OverworldEntityKind } from "./overworldModel";
import {
  updatePokemonEggMove,
  updatePokemonField,
  updatePokemonTmCompatibility,
  updatePokemonTutorCompatibility,
} from "./pokemonModel";
import type { ProjectState } from "./projectStore";
import { updateTextEntry } from "./textModel";
import { updateTmMove } from "./tmModel";
import { updateTutorMoveField } from "./tutorMoveModel";
import { updateTrainerField, updateTrainerPokemonField } from "./trainerModel";
import { updateTrainerText } from "./trainerTextModel";
import { TYPE_EFFECTIVENESS_VALUES, updateTypeChartValue, type TypeEffectivenessValue } from "./typeChartModel";

export function canUndoActionChange(entry: ActionChangelogEntry): boolean {
  if (entry.kind !== "field" || entry.before === undefined) return false;
  return undoKind(entry) !== undefined;
}

export function undoActionChange(project: ProjectState, entry: ActionChangelogEntry): void {
  if (!canUndoActionChange(entry)) throw new Error("This changelog entry cannot be undone automatically.");
  const before = entry.before ?? "";
  const kind = undoKind(entry);

  if (kind === "move") {
    const [, moveId, field] = match(entry.key, /^move:(\d+):([^:]+)$/u);
    updateMoveField(project, Number(moveId), field, undoMoveValue(field, before));
    return;
  }

  if (kind === "item") {
    const [, itemId, field] = match(entry.key, /^item:(\d+):([^:]+)$/u);
    updateItemField(project, Number(itemId), field, before);
    return;
  }

  if (kind === "tm") {
    const [, field] = match(entry.key, /^tm:([^:]+)$/u);
    updateTmMove(project, field, before);
    return;
  }

  if (kind === "type-chart") {
    const [, attackIndex, defendIndex] = match(entry.key, /^type-chart:(\d+):(\d+)$/u);
    updateTypeChartValue(project, Number(attackIndex), Number(defendIndex), parseEffectiveness(before));
    return;
  }

  if (kind === "tutor-move") {
    const [, rowIndex, field] = match(entry.key, /^tutor-move:(\d+):(move|shardCost|displayIndex|compatibilityIndex)$/u);
    updateTutorMoveField(project, Number(rowIndex), field === "compatibilityIndex" ? "displayIndex" : (field as "move" | "shardCost" | "displayIndex"), before);
    return;
  }

  if (kind === "move-effect-handler") {
    const [, rowIndex, field] = match(entry.key, /^move-effect-handler:(\d+):(move|address)$/u);
    if (field === "move") updateMoveEffectHandlerMove(project, Number(rowIndex), before);
    else updateMoveEffectHandlerAddress(project, Number(rowIndex), before);
    return;
  }

  if (kind === "mart") {
    const [, martId, field] = match(entry.key, /^mart:(\d+):([^:]+)$/u);
    updateMartField(project, Number(martId), field, before);
    return;
  }

  if (kind === "grotto") {
    const [, grottoId, field] = match(entry.key, /^grotto:(\d+):([^:]+)$/u);
    updateGrottoField(project, Number(grottoId), field, before);
    return;
  }

  if (kind === "grotto-odds") {
    const [, field] = match(entry.key, /^grotto-odds:([^:]+)$/u);
    updateGrottoOddsField(project, field, before);
    return;
  }

  if (kind === "encounter") {
    const [, encounterId, field] = match(entry.key, /^encounter:(\d+):([^:]+)$/u);
    updateEncounterField(project, Number(encounterId), field, before);
    return;
  }

  if (kind === "pokemon-field") {
    const [, speciesId, storeName, field] = match(entry.key, /^pokemon:(\d+):(personal|learnsets|evolutions):([^:]+)$/u);
    const narc = storeName === "learnsets" ? "learnset" : storeName === "evolutions" ? "evolutions" : "personal";
    updatePokemonField(project, Number(speciesId), narc, field, before);
    return;
  }

  if (kind === "pokemon-compat") {
    const [, speciesId, tmKind, index] = match(entry.key, /^pokemon:(\d+):compat:(tm|hm):(\d+)$/u);
    updatePokemonTmCompatibility(project, Number(speciesId), tmKind as "tm" | "hm", Number(index), parseYesNo(before));
    return;
  }

  if (kind === "pokemon-tutor") {
    const [, speciesId, field, index] = match(entry.key, /^pokemon:(\d+):tutor:([^:]+):(\d+)$/u);
    updatePokemonTutorCompatibility(project, Number(speciesId), field, Number(index), parseYesNo(before));
    return;
  }

  if (kind === "pokemon-egg") {
    const [, speciesId, index] = match(entry.key, /^pokemon:(\d+):egg:(\d+)$/u);
    updatePokemonEggMove(project, Number(speciesId), Number(index), before);
    return;
  }

  if (kind === "trainer-data") {
    const [, trainerId, field] = match(entry.key, /^trainer:(\d+):data:([^:]+)$/u);
    updateTrainerField(project, Number(trainerId), field, before);
    return;
  }

  if (kind === "trainer-pokemon") {
    const [, trainerId, slot, field] = match(entry.key, /^trainer:(\d+):pokemon:(\d+):([^:]+)$/u);
    updateTrainerPokemonField(project, Number(trainerId), Number(slot), field, before);
    return;
  }

  if (kind === "trainer-text") {
    const [, trainerId, typeId] = match(entry.key, /^trainer-text:(\d+):(\d+)$/u);
    updateTrainerText(project, Number(trainerId), Number(typeId), before === "None" ? "" : before);
    return;
  }

  if (kind === "text") {
    const [, narcName, bankId, entryIndex] = match(entry.key, /^text:(message_texts|story_texts):(\d+):(\d+)$/u);
    updateTextEntry(project, narcName as "message_texts" | "story_texts", Number(bankId), Number(entryIndex), before === "None" ? "" : before);
    return;
  }

  if (kind === "header") {
    const [, rowId, field] = match(entry.key, /^header:(\d+):([^:]+)$/u);
    updateHeaderField(project, Number(rowId), field, before);
    return;
  }

  if (kind === "header-packed") {
    const [, rowId, field, partKey] = match(entry.key, /^header:(\d+):([^:]+):([^:]+)$/u);
    updateHeaderPackedField(project, Number(rowId), field, partKey, before);
    return;
  }

  if (kind === "overworld") {
    const [, overworldId, field] = match(entry.key, /^overworld:(\d+):([^:]+)$/u);
    updateOverworldField(project, Number(overworldId), field, before);
    return;
  }

  if (kind === "overworld-entity") {
    const [, overworldId, entityKind, entityIndex, field] = match(entry.key, /^overworld:(\d+):(furniture|npc|warp|trigger):(\d+):([^:]+)$/u);
    updateOverworldEntityField(project, Number(overworldId), { kind: entityKind as OverworldEntityKind, index: Number(entityIndex) }, field, before);
    return;
  }

  if (kind === "map-tile") {
    const [, mapId, layer, tileIndex] = match(entry.key, /^map-tile:(\d+):(2|3):(\d+)$/u);
    updateMapTile(project, Number(mapId), Number(tileIndex), Number(layer) as 2 | 3, before);
    return;
  }

  throw new Error("This changelog entry cannot be undone automatically.");
}

function undoKind(entry: ActionChangelogEntry): string | undefined {
  const key = entry.key;
  if (/^move:\d+:[^:]+$/u.test(key)) return "move";
  if (/^item:\d+:[^:]+$/u.test(key)) return "item";
  if (/^tm:[^:]+$/u.test(key)) return "tm";
  if (/^type-chart:\d+:\d+$/u.test(key)) return "type-chart";
  if (/^tutor-move:\d+:(move|shardCost|displayIndex|compatibilityIndex)$/u.test(key)) return "tutor-move";
  if (/^move-effect-handler:\d+:(move|address)$/u.test(key)) return "move-effect-handler";
  if (/^mart:\d+:[^:]+$/u.test(key)) return "mart";
  if (/^grotto:\d+:[^:]+$/u.test(key)) return "grotto";
  if (/^grotto-odds:[^:]+$/u.test(key)) return "grotto-odds";
  if (/^encounter:\d+:[^:]+$/u.test(key)) return "encounter";
  if (/^pokemon:\d+:(personal|learnsets|evolutions):[^:]+$/u.test(key)) return "pokemon-field";
  if (/^pokemon:\d+:compat:(tm|hm):\d+$/u.test(key)) return "pokemon-compat";
  if (/^pokemon:\d+:tutor:[^:]+:\d+$/u.test(key)) return "pokemon-tutor";
  if (/^pokemon:\d+:egg:\d+$/u.test(key)) return "pokemon-egg";
  if (/^trainer:\d+:data:[^:]+$/u.test(key)) return "trainer-data";
  if (/^trainer:\d+:pokemon:\d+:(?!autofill-moves$)[^:]+$/u.test(key)) return "trainer-pokemon";
  if (/^trainer-text:\d+:\d+$/u.test(key)) return "trainer-text";
  if (/^text:(message_texts|story_texts):\d+:\d+$/u.test(key)) return "text";
  if (/^header:\d+:[^:]+$/u.test(key)) return "header";
  if (/^header:\d+:[^:]+:[^:]+$/u.test(key)) return "header-packed";
  if (/^overworld:\d+:[^:]+$/u.test(key)) return "overworld";
  if (/^overworld:\d+:(furniture|npc|warp|trigger):\d+:[^:]+$/u.test(key)) return "overworld-entity";
  if (/^map-tile:\d+:[23]:\d+$/u.test(key)) return "map-tile";
  return undefined;
}

function match(key: string, pattern: RegExp): RegExpMatchArray {
  const result = key.match(pattern);
  if (!result) throw new Error(`Unsupported undo key: ${key}`);
  return result;
}

function undoMoveValue(field: string, before: string): string | boolean {
  return (PROPERTIES as readonly string[]).includes(field) ? before === "1" : before;
}

function parseEffectiveness(label: string): TypeEffectivenessValue {
  const value = label === "0x" ? 0 : label === "0.5x" ? 2 : label === "2x" ? 8 : 4;
  if (!TYPE_EFFECTIVENESS_VALUES.includes(value)) throw new Error(`Unsupported type chart value: ${label}`);
  return value;
}

function parseYesNo(value: string): boolean {
  return value.trim().toLowerCase() === "yes";
}
