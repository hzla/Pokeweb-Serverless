import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { recordGenericChange } from "./actionChangelog";
import { isGen4Project } from "./constants";
import { GROUND_ITEM_SCRIPT_FIRST, GROUND_ITEM_SCRIPT_LAST, groundItemScriptFileId } from "./docGeneratorModel";
import { projectFlagReference } from "./flagReferenceModel";
import { addOverworldEntity, moveOverworldEntity } from "./overworldModel";
import { decodeRecord, markDirty, type ProjectState, type RawRecord } from "./projectStore";
import { objCodeForBattleClass } from "./pwtModel";
import { expandTrainerScriptArchive, getTrainerScriptArchiveStatus } from "./trainerScriptArchiveModel";

/*
 * Shortcuts for the two most common overworld edits: placing a trainer and placing an item ball.
 *
 * Trainers need no script of their own. The field script system maps the script ranges 3000-4999 and 5000-6999 to
 * the common trainer script (ov012 script_sys.c), which battles trainer `script - 3000` (or `script - 5000`, the
 * second member of a pair; ov012 trainer_script.c GetNormalSCRIDFromTrainerID / GetPairMember2SCRIDFromTrainerID).
 */

export const TRAINER_SCRIPT_BASE = 3000;
export const TRAINER_PAIR_SCRIPT_BASE = 5000;
/** Trainer ids that fit the 2000-script ranges above. */
export const MAX_SHORTCUT_TRAINER_ID = 1999;

/** NPC event type the game's trainers use: battle when the player walks into the trainer's line of sight. */
export const TRAINER_EVENT_TYPE = 1;
/** The sight range most of the game's trainers use. */
export const DEFAULT_TRAINER_SIGHT = 3;
/** Movement codes 14-17 stand still facing up, down, left, right: the code vanilla trainers use, 14 + facing. */
const STAND_FACING_MOVEMENT_BASE = 14;

export type TrainerPlacement = { overworldId: number; npcIndex: number };

export type TrainerOverworldIndex = {
  /** The sprite each trainer class uses most often on the maps, from the ROM's own trainers. */
  spriteByClass: Map<number, number>;
  /** Where each trainer already stands, by trainer id. */
  placements: Map<number, TrainerPlacement[]>;
};

export function supportsOverworldShortcuts(project: ProjectState): boolean {
  return !isGen4Project(project) && Boolean(project.narcs.overworlds);
}

export function trainerIdForScript(script: number): number | undefined {
  if (script >= TRAINER_PAIR_SCRIPT_BASE && script < TRAINER_PAIR_SCRIPT_BASE + 2000) return script - TRAINER_PAIR_SCRIPT_BASE;
  if (script >= TRAINER_SCRIPT_BASE && script < TRAINER_SCRIPT_BASE + 2000) return script - TRAINER_SCRIPT_BASE;
  return undefined;
}

/** Reads every overworld's trainer NPCs once: which sprite each class wears and where each trainer stands. */
export function buildTrainerOverworldIndex(project: ProjectState): TrainerOverworldIndex {
  const spriteCounts = new Map<number, Map<number, number>>();
  const placements = new Map<number, TrainerPlacement[]>();
  const overworldCount = project.narcs.overworlds?.fileCount ?? 0;
  for (let overworldId = 0; overworldId < overworldCount; overworldId += 1) {
    let raw: RawRecord | undefined;
    try {
      raw = decodeRecord(project, "overworlds", overworldId).raw;
    } catch {
      continue;
    }
    if (!raw) continue;
    for (const npcIndex of npcIndexes(raw)) {
      const trainerId = trainerIdForScript(Number(raw[`npc_${npcIndex}_script_id`] ?? 0));
      if (trainerId === undefined || trainerId === 0) continue;
      const list = placements.get(trainerId) ?? [];
      list.push({ overworldId, npcIndex });
      placements.set(trainerId, list);
      const trainerClass = trainerClassId(project, trainerId);
      if (trainerClass === undefined) continue;
      const sprite = Number(raw[`npc_${npcIndex}_overworld_sprite`] ?? 0);
      const counts = spriteCounts.get(trainerClass) ?? new Map<number, number>();
      counts.set(sprite, (counts.get(sprite) ?? 0) + 1);
      spriteCounts.set(trainerClass, counts);
    }
  }
  const spriteByClass = new Map<number, number>();
  for (const [trainerClass, counts] of spriteCounts) {
    const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    if (best) spriteByClass.set(trainerClass, best[0]);
  }
  return { spriteByClass, placements };
}

/** The sprite to give a trainer of this class: what the ROM's own trainers of the class wear, else the game's table. */
export function suggestedTrainerSprite(project: ProjectState, index: TrainerOverworldIndex, trainerClass: number): number | undefined {
  return index.spriteByClass.get(trainerClass) ?? (project.session.baseRom === "BW2" ? objCodeForBattleClass(trainerClass) : undefined);
}

export type AddTrainerNpcOptions = {
  trainerId: number;
  sprite: number;
  /** 0 up, 1 down, 2 left, 3 right. */
  direction: number;
  sight: number;
  x: number;
  y: number;
  /** Doubles trainers can stand as a pair: a second NPC beside the first, running the pair partner's script. */
  pair?: { sprite: number };
};

export type TrainerScriptCheck =
  | { ok: true; expands: boolean }
  | { ok: false; reason: string };

/**
 * Whether the trainer's common script exists. Script 3000 + id runs entry `id` of the global trainer script file,
 * which has one entry per trainer the ROM shipped with (plus a few helper scripts in the middle). A trainer added
 * since needs the table expanded first, which placing it does; a trainer whose id lands on a helper can't use it.
 */
export function checkTrainerScript(project: ProjectState, trainerId: number): TrainerScriptCheck {
  if (trainerId < 1 || trainerId > MAX_SHORTCUT_TRAINER_ID) return { ok: false, reason: `Trainer scripts cover trainers 1-${MAX_SHORTCUT_TRAINER_ID}.` };
  const status = getTrainerScriptArchiveStatus(project);
  if (!status.ok) return { ok: false, reason: status.message };
  if (status.helperTrainerIds.includes(trainerId)) return { ok: false, reason: `Script ${TRAINER_SCRIPT_BASE + trainerId} is one of the game's helper scripts, so trainer ${trainerId} can't battle from it.` };
  return { ok: true, expands: trainerId >= status.tableEntryCount };
}

/** Adds the trainer (and its pair partner) as NPCs ready to battle. Returns the new NPC indexes. */
export function addTrainerNpcs(project: ProjectState, overworldId: number, options: AddTrainerNpcOptions): number[] {
  const { trainerId } = options;
  if (!Number.isInteger(trainerId) || trainerId < 1 || trainerId > MAX_SHORTCUT_TRAINER_ID) throw new Error(`Trainer ${trainerId} is outside the trainer script range (1-${MAX_SHORTCUT_TRAINER_ID}).`);
  const script = checkTrainerScript(project, trainerId);
  if (!script.ok) throw new Error(script.reason);
  if (script.expands) expandTrainerScriptArchive(project);
  const direction = Math.max(0, Math.min(3, Math.trunc(options.direction)));
  const sight = Math.max(0, Math.min(15, Math.trunc(options.sight)));
  const members = [
    { sprite: options.sprite, script: TRAINER_SCRIPT_BASE + trainerId, x: options.x, y: options.y },
    ...(options.pair ? [{ sprite: options.pair.sprite, script: TRAINER_PAIR_SCRIPT_BASE + trainerId, ...pairTile(options.x, options.y, direction) }] : []),
  ];
  const indexes: number[] = [];
  for (const member of members) {
    const index = addOverworldEntity(project, overworldId, "npc");
    moveOverworldEntity(project, overworldId, "npc", index, member.x, member.y);
    const raw = decodeRecord(project, "overworlds", overworldId).raw!;
    const set = (field: string, value: number) => {
      raw[`npc_${index}_${field}`] = value;
    };
    set("overworld_sprite", member.sprite);
    set("script_id", member.script);
    set("overworld_flag", 0);
    set("movement_permissions_2", TRAINER_EVENT_TYPE);
    set("movement_permissions", STAND_FACING_MOVEMENT_BASE + direction);
    set("direction", direction);
    set("sight", sight);
    set("horizontal_leash", 0);
    set("vertical_leash", 0);
    indexes.push(index);
  }
  markDirty(project, "overworlds", overworldId);
  recordGenericChange(
    project,
    "overworlds",
    `Trainer ${trainerId} placed as NPC ${indexes.join(" and ")}${options.pair ? " (pair)" : ""}.`,
    `Overworld ${overworldId}`,
    { key: `overworld-trainer-add:${overworldId}:${indexes.join(",")}` },
  );
  return indexes;
}

/** The partner stands beside the trainer, across its line of sight, so both see the player together. */
function pairTile(x: number, y: number, direction: number): { x: number; y: number } {
  return direction === 0 || direction === 1 ? { x: x + 1, y } : { x, y: y + 1 };
}

function trainerClassId(project: ProjectState, trainerId: number): number | undefined {
  try {
    const raw = decodeRecord(project, "trdata", trainerId).raw;
    return raw ? Number(raw.class ?? 0) : undefined;
  } catch {
    return undefined;
  }
}

function npcIndexes(raw: RawRecord): number[] {
  const indexes: number[] = [];
  for (const key of Object.keys(raw)) {
    const match = /^npc_(\d+)_script_id$/u.exec(key);
    if (match) indexes.push(Number(match[1]));
  }
  return indexes;
}

// ---------- Item balls ----------

/*
 * Item balls share the global item script file: script 7000 + n runs entry n, which loads the item and quantity
 * into 0x800C / 0x800D and calls the common pickup routine. That routine hides the ball by setting the NPC's own
 * event flag (ActorGetSpawnFlag, FlagSet), so each ball needs a flag no other event uses; the script can be shared.
 * A new item appends an entry to the file: the entry table grows by one pointer, and every script after it keeps its
 * relative jumps, since everything moves together.
 */

const EVENT_DATA_END_CODE = 0xfd13;
/** ActorsPauseAll; WorkSetConst 0x800C item; WorkSetConst 0x800D quantity; VMCall routine; FinishAllEvents; ActorsUnpauseAll; VMHalt. */
const ITEM_ENTRY_LENGTH = 26;
const ITEM_ENTRY_CALL_OFFSET = 14;

/** The overworld sprite of a plain item ball. */
export const ITEM_BALL_SPRITE = 110;

export type GroundItemEntry = { scriptId: number; itemId: number; quantity: number };

export type GroundItemScriptFile = {
  fileId: number;
  entries: GroundItemEntry[];
  /** How many more entries fit the 7000-7799 script range. */
  freeSlots: number;
};

export type ParsedItemFile = { starts: number[]; tableEnd: number; items: Map<number, GroundItemEntry>; routine: number };

function readItemFile(bytes: Uint8Array): ParsedItemFile | undefined {
  const starts: number[] = [];
  let offset = 0;
  while (offset + 4 <= bytes.length && readU16(bytes, offset) !== EVENT_DATA_END_CODE) {
    starts.push(offset + 4 + (readU32(bytes, offset) | 0));
    offset += 4;
  }
  if (offset + 2 > bytes.length) return undefined;
  const items = new Map<number, GroundItemEntry>();
  const routines = new Map<number, number>();
  starts.forEach((start, index) => {
    if (start < 0 || start + ITEM_ENTRY_LENGTH > bytes.length) return;
    const word = (at: number) => readU16(bytes, start + at);
    const isItemEntry =
      word(0) === 0x2e && word(2) === 0x28 && word(4) === 0x800c && word(8) === 0x28 && word(10) === 0x800d &&
      word(ITEM_ENTRY_CALL_OFFSET) === 0x04 && word(20) === 0x30 && word(22) === 0x2f && word(24) === 0x02;
    if (!isItemEntry) return;
    const routine = start + ITEM_ENTRY_CALL_OFFSET + 6 + (readU32(bytes, start + ITEM_ENTRY_CALL_OFFSET + 2) | 0);
    routines.set(routine, (routines.get(routine) ?? 0) + 1);
    items.set(index, { scriptId: GROUND_ITEM_SCRIPT_FIRST + index, itemId: word(6), quantity: word(12) });
  });
  const [routine] = [...routines.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (routine === undefined) return undefined;
  return { starts, tableEnd: offset, items, routine };
}

/** The item file with one more entry giving itemId ×quantity, at the end of the table and of the file. */
export function appendGroundItemEntry(bytes: Uint8Array, parsed: ParsedItemFile | undefined, itemId: number, quantity: number): Uint8Array {
  const file = parsed ?? readItemFile(bytes);
  if (!file) throw new Error("The item ball script file isn't in the usual format.");
  // Grow the table by one pointer: everything after it moves 4 bytes, so the old pointers grow by 4.
  const out = new Uint8Array(bytes.length + 4 + ITEM_ENTRY_LENGTH);
  for (let entry = 0; entry < file.starts.length; entry += 1) writeU32(out, entry * 4, (readU32(bytes, entry * 4) + 4) >>> 0);
  out.set(bytes.subarray(file.tableEnd), file.tableEnd + 4);
  const start = bytes.length + 4;
  writeU32(out, file.tableEnd, (start - file.tableEnd - 4) >>> 0);
  writeU16(out, file.tableEnd + 4, EVENT_DATA_END_CODE);
  const routine = file.routine + 4;
  [0x2e, 0x28, 0x800c, itemId, 0x28, 0x800d, quantity, 0x04].forEach((word, n) => writeU16(out, start + n * 2, word));
  writeU32(out, start + ITEM_ENTRY_CALL_OFFSET + 2, (routine - (start + ITEM_ENTRY_CALL_OFFSET + 6)) >>> 0);
  [0x30, 0x2f, 0x02].forEach((word, n) => writeU16(out, start + 20 + n * 2, word));
  return out;
}

/** Item ball entries of a global item script file, by script id. */
export function parseGroundItemFile(bytes: Uint8Array): GroundItemEntry[] | undefined {
  const parsed = readItemFile(bytes);
  return parsed ? [...parsed.items.values()] : undefined;
}

export function readGroundItemScripts(project: ProjectState): GroundItemScriptFile | undefined {
  const fileId = groundItemScriptFileId(project);
  const bytes = project.narcs.scripts?.rawFiles[fileId];
  const parsed = bytes ? readItemFile(bytes) : undefined;
  if (!parsed) return undefined;
  return {
    fileId,
    entries: [...parsed.items.values()],
    freeSlots: Math.max(0, GROUND_ITEM_SCRIPT_LAST - GROUND_ITEM_SCRIPT_FIRST + 1 - parsed.starts.length),
  };
}

/** The script that gives this item: an existing entry when one gives the same item and quantity, else a new one. */
export function ensureGroundItemScript(project: ProjectState, itemId: number, quantity: number): { scriptId: number; added: boolean } {
  const fileId = groundItemScriptFileId(project);
  const scripts = project.narcs.scripts;
  const bytes = scripts?.rawFiles[fileId];
  const parsed = bytes ? readItemFile(bytes) : undefined;
  if (!scripts || !bytes || !parsed) throw new Error(`The item ball script file (${fileId}) isn't in the usual format.`);
  const existing = [...parsed.items.values()].find((entry) => entry.itemId === itemId && entry.quantity === quantity);
  if (existing) return { scriptId: existing.scriptId, added: false };
  const index = parsed.starts.length;
  if (GROUND_ITEM_SCRIPT_FIRST + index > GROUND_ITEM_SCRIPT_LAST) throw new Error("The item ball scripts are full (7000-7799).");
  const out = appendGroundItemEntry(bytes, parsed, itemId, quantity);
  scripts.rawFiles[fileId] = out;
  scripts.records.delete(fileId);
  markDirty(project, "scripts", fileId);
  const scriptId = GROUND_ITEM_SCRIPT_FIRST + index;
  recordGenericChange(project, "scripts", `Added item ball script ${scriptId} (item ${itemId} ×${quantity}).`, "Item ball scripts", {
    key: `ground-item-script:${fileId}:${index}`,
  });
  return { scriptId, added: true };
}

// ---------- Event flags ----------

/*
 * A new item ball needs an event flag nothing else uses. Ruled out:
 * - flags any script or NPC in the ROM (including this session's unsaved NPCs) or a configured patch uses;
 * - 0-99, which every map change clears (FieldScript_ResetMapLocalEvents), so the ball would come back;
 * - each trainer's defeated flag, 0x5F0 + trainer id in BW2 and 1420 + trainer id in BW (TrainerFlagGet);
 * - hidden items (0xB04 + index in BW2, 900 + index in BW) and the daily flags (from 0xAA0), which the game resets;
 * - the flags the game's own code reads (0x960-0x9FF and a few low ones), since no script shows them.
 * The pick prefers the block the game's own item balls use, right after them, then the other unused flags.
 */

type FlagLayout = { trainerBase: number; itemBlock: number; reserved: Array<[number, number]>; max: number };

function flagLayout(project: ProjectState): FlagLayout {
  const bw2 = project.session.baseRom === "BW2";
  const trainerBase = bw2 ? 0x5f0 : 1420;
  const trainerCount = Math.max(project.narcs.trdata?.fileCount ?? 0, 1);
  return {
    trainerBase,
    itemBlock: 1100,
    max: 0xaa0 - 1,
    reserved: [
      [0, 99],
      [trainerBase, trainerBase + trainerCount - 1],
      [0x88, 0x8d],
      [0xbf, 0xc7],
      [0x109, 0x10f],
      [0x960, 0x9ff],
      ...(bw2 ? ([[0xaa0, 0xbf7]] as Array<[number, number]>) : ([[900, 1099], [0xaa0, 0xb5f]] as Array<[number, number]>)),
    ],
  };
}

export type FlagCheck = { ok: boolean; reason?: string };

/** Whether a flag sits in the block the game's own item balls use, up to the trainer flags. */
export function inItemFlagBlock(project: ProjectState, flag: number): boolean {
  const layout = flagLayout(project);
  return flag >= layout.itemBlock && flag < layout.trainerBase;
}

/** Every flag something in the project already uses, with what uses it. */
export function usedEventFlags(project: ProjectState): Map<number, string> {
  const used = new Map<number, string>();
  try {
    for (const entry of projectFlagReference(project)) used.set(entry.id, entry.uses?.[0] ?? entry.label);
  } catch {
    // A ROM the reference can't read still has its NPC flags below.
  }
  const overworldCount = project.narcs.overworlds?.fileCount ?? 0;
  for (let overworldId = 0; overworldId < overworldCount; overworldId += 1) {
    let raw: RawRecord | undefined;
    try {
      raw = decodeRecord(project, "overworlds", overworldId).raw;
    } catch {
      continue;
    }
    if (!raw) continue;
    for (const index of npcIndexes(raw)) {
      const flag = Number(raw[`npc_${index}_overworld_flag`] ?? 0);
      if (flag > 0 && flag < 0x4000 && !used.has(flag)) used.set(flag, `Overworld ${overworldId} · NPC ${index} hides when it's set`);
    }
  }
  return used;
}

export function checkItemFlag(project: ProjectState, flag: number, used: ReadonlyMap<number, string>): FlagCheck {
  const layout = flagLayout(project);
  if (!Number.isInteger(flag) || flag < 1 || flag > 0x3fff) return { ok: false, reason: "Flags run from 1 to 16383." };
  if (used.has(flag)) return { ok: false, reason: `Flag ${flag} is already used: ${used.get(flag)}.` };
  if (flag <= 99) return { ok: false, reason: "Flags 0-99 clear on every map change, so the item would come back." };
  if (flag >= layout.trainerBase && flag <= layout.reserved[1]![1]) return { ok: false, reason: `Flag ${flag} records whether trainer ${flag - layout.trainerBase} was beaten.` };
  if (flag > layout.max) return { ok: false, reason: `Flag ${flag} is reset by the game (daily or hidden item flags) or isn't saved.` };
  if (layout.reserved.some(([low, high]) => flag >= low && flag <= high)) return { ok: false, reason: `The game's code uses flag ${flag}.` };
  return { ok: true };
}

/** The lowest safe unused flag, preferring the item ball block. */
export function suggestItemFlag(project: ProjectState, used: ReadonlyMap<number, string> = usedEventFlags(project)): number | undefined {
  const layout = flagLayout(project);
  const ranges: Array<[number, number]> = [
    [layout.itemBlock, layout.trainerBase - 1],
    [100, layout.itemBlock - 1],
    [layout.reserved[1]![1] + 1, layout.max],
  ];
  for (const [low, high] of ranges) {
    for (let flag = low; flag <= high; flag += 1) if (checkItemFlag(project, flag, used).ok) return flag;
  }
  return undefined;
}

export type AddItemBallOptions = { itemId: number; quantity: number; flag: number; sprite?: number; x: number; y: number };

/** Adds an item ball NPC that gives the item once, then stays hidden by its flag. */
export function addItemBallNpc(project: ProjectState, overworldId: number, options: AddItemBallOptions): { npcIndex: number; scriptId: number; addedScript: boolean } {
  const quantity = Math.max(1, Math.min(999, Math.trunc(options.quantity)));
  if (!Number.isInteger(options.itemId) || options.itemId < 1 || options.itemId > 0xffff) throw new Error("Choose an item.");
  const check = checkItemFlag(project, options.flag, usedEventFlags(project));
  if (!check.ok) throw new Error(check.reason);
  const { scriptId, added } = ensureGroundItemScript(project, options.itemId, quantity);
  const index = addOverworldEntity(project, overworldId, "npc");
  moveOverworldEntity(project, overworldId, "npc", index, options.x, options.y);
  const raw = decodeRecord(project, "overworlds", overworldId).raw!;
  const set = (field: string, value: number) => {
    raw[`npc_${index}_${field}`] = value;
  };
  // The game's own item balls: no movement, event type 0, facing down.
  set("overworld_sprite", options.sprite ?? ITEM_BALL_SPRITE);
  set("script_id", scriptId);
  set("overworld_flag", options.flag);
  set("movement_permissions", 0);
  set("movement_permissions_2", 0);
  set("direction", 1);
  set("sight", 0);
  set("horizontal_leash", 0);
  set("vertical_leash", 0);
  markDirty(project, "overworlds", overworldId);
  recordGenericChange(project, "overworlds", `Item ball NPC ${index} added: item ${options.itemId} ×${quantity}, script ${scriptId}, flag ${options.flag}.`, `Overworld ${overworldId}`, {
    key: `overworld-item-add:${overworldId}:${index}`,
  });
  return { npcIndex: index, scriptId, addedScript: added };
}
