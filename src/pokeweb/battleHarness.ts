import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { decompressCode } from "../nds/codeCompression";
import { NintendoDSRom } from "../nds/rom";
import { BATTLE_TYPES } from "./constants";
import { findPokemonBaseSpeciesId, pokemonSpeciesLabel } from "./pokemonLabels";
import { decodeRecord, markDirty, type ProjectState } from "./projectStore";
import { parseRpm, writeRpm } from "./rpm";
import { createTestBattlePartyPokemon, decryptPk5Party, encryptPk5Party, getTestBattlePersonal, recalculateTestBattlePartyStats, refreshTestBattlePartyChecksums, type ShowdownPokemon } from "./testBattleTeam";

type Stats = Partial<ShowdownPokemon["ivs"]>;
export type HarnessPokemon = {
  speciesId: number; form?: number; level?: number; itemId?: number;
  abilitySlot?: 1 | 2 | 3; abilityId?: number; nature?: number; gender?: 0 | 1 | 2;
  moves?: number[]; ivs?: Stats; evs?: Stats; currentHp?: number;
  status?: "healthy" | "sleep" | "poison" | "burn" | "freeze" | "paralysis" | "toxic" | number;
  pp?: number[];
};
export type HarnessConfig = {
  trainerId: number;
  battleType?: "Singles" | "Doubles" | "Triples" | "Rotation";
  trainer?: { team?: HarnessPokemon[]; ai?: number; trainerClass?: number };
  player?: { team?: HarnessPokemon[]; edits?: (Partial<HarnessPokemon> & { slot: number })[] };
};
const STATS = ["hp", "atk", "def", "spe", "spa", "spd"] as const;
const STATUS = { healthy: 0, sleep: 2, poison: 8, burn: 16, freeze: 32, paralysis: 64, toxic: 128 };
const MON_KEYS = ["speciesId", "form", "level", "itemId", "abilitySlot", "abilityId", "nature", "gender", "moves", "ivs", "evs", "currentHp", "status", "pp"];
const PARTY = 0x18e00, SIZE = 220;

export function harnessInteger(value: unknown, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${name} must be an integer in ${min}..${max}`);
  return value as number;
}
function keys(value: unknown, allowed: string[], name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${name} field: ${key}`);
}
export function parseHarnessConfig(input: unknown): HarnessConfig {
  keys(input, ["trainerId", "battleType", "trainer", "player"], "config");
  harnessInteger(input.trainerId, 1, 65535, "trainerId");
  if (input.battleType !== undefined && !BATTLE_TYPES.includes(String(input.battleType))) throw new Error("Unknown battleType");
  for (const name of ["trainer", "player"] as const) {
    const side = input[name];
    if (side === undefined) continue;
    keys(side, name === "trainer" ? ["team", "ai", "trainerClass"] : ["team", "edits"], name);
    if (side.team !== undefined) {
      if (!Array.isArray(side.team) || side.team.length < 1 || side.team.length > 6) throw new Error(`${name}.team must contain 1..6 Pokemon`);
      for (const mon of side.team) { keys(mon, MON_KEYS, `${name} Pokemon`); harnessInteger(mon.speciesId, 1, 2047, "speciesId"); }
    }
    if (side.edits !== undefined) {
      if (side.team !== undefined) throw new Error("Use player.team or player.edits, not both");
      if (!Array.isArray(side.edits) || side.edits.length > 6) throw new Error("player.edits must be an array of at most six entries");
      const slots = new Set<number>();
      for (const edit of side.edits) {
        keys(edit, [...MON_KEYS, "slot"], "player edit");
        const slot = harnessInteger(edit.slot, 0, 5, "slot");
        if (slots.has(slot)) throw new Error(`Duplicate edit for slot ${slot}`);
        slots.add(slot);
      }
    }
  }
  return input as unknown as HarnessConfig;
}

/** Reject altered executable sites individually; ordinary ROM data edits are allowed. */
export function validateHarnessRom(rom: NintendoDSRom, edits?: Pick<ProjectState, "arm9" | "overlays">): void {
  if (rom.idCode !== "IRDO" || rom.data[0x1e] !== 0) throw new Error("Battle harness currently targets US White 2 revision 0 and compatible White2Upgrade ROMs");
  const arm9 = edits?.arm9.length ? edits.arm9 : decompressCode(rom.arm9), overlays = rom.loadArm9Overlays([12, 167]);
  for (const [id, overlay] of overlays) if (edits?.overlays[id]?.length) overlay.data = edits.overlays[id];
  const signatures = [
    [overlays.get(12)!.data, overlays.get(12)!.ramAddress, 0x0215a790, "38b5051c04480c1ce2f64efb281c211c22f0eef838bdc046"],
    [overlays.get(12)!.data, overlays.get(12)!.ramAddress, 0x02169128, "38b5051c0c1ca968201ca8310968aef6"],
    [overlays.get(12)!.data, overlays.get(12)!.ramAddress, 0x02169114, "8168034b081ca830006809681847c046e1901602"],
    [overlays.get(12)!.data, overlays.get(12)!.ramAddress, 0x0215a190, "f8b5051cbcf6a0fc041c0f4a281c00210c23bcf6"],
    [overlays.get(167)!.data, overlays.get(167)!.ramAddress, 0x021ce9dc, "011c07208001285802f06efbf1e7"],
    [overlays.get(167)!.data, overlays.get(167)!.ramAddress, 0x021d10c4, "f8b54d27041cbf00e0590091caf720ff061c381c"],
    [overlays.get(167)!.data, overlays.get(167)!.ramAddress, 0x021d12e0, "10b5041ce0300268002a0fd0211ce831201c0968ec309047002805d0201c0021e030ec3401602160002010bd201ce4300268002a0ed0211ce831201c0968ec309047002804d00020e4342060012010bd002010bd012010bd10b5041c0948a3f63ffb002806dc032010210022231c7cf69dfe10bd0c2010210022231c7cf696fe10bdc0466c000004f0b585b0071c0293081c006800910192002804d0012832d002283dd043e002980025002825d9381c0390483003904d208000001d04900198445d4d2080003858211ccbf7ebf9061c0498311c3858cbf707ffe9f773fe211c0ef04cfa0c20311c41430398401802f0fdfa02986d1c8542e1d300980068411c0098016013e015200001385c002802d005b00120f0bd0220c043fff79dffece70ef012fa002802d105b00120f0bd002005b0f0bd08b5024a0223fff7a5ff08bd70a91d0208b5024a0423fff79dff08bd72a91d0208b5024a0623fff795ff08bd76a91d02"],
    [overlays.get(167)!.data, overlays.get(167)!.ramAddress, 0x021da970, "010002030405020304050607"],
    [arm9, rom.arm9RamAddress, 0x02016cb4, "f8b582b0051c019337200e1c171c0090"],
    [arm9, rom.arm9RamAddress, 0x02016e38, "f8b5051c161c0c1c1f1c2869"],
    [arm9, rom.arm9RamAddress, 0x02046e0c, "08b52df077fd034a0120116800040843106008bd00100004"],
    [arm9, rom.arm9RamAddress, 0x02017df0, "00220a2102604260427202724281017342737047"],
    ...[0x0201828c, 0x020182c0, 0x020182f4, 0x02018328].map(address => [arm9, rom.arm9RamAddress, address, "f8b582b0161c08aa12881d1c"] as const),
    [arm9, rom.arm9RamAddress, 0x020185d0, "f8b582b00090151c081cfff7abf9f7f7"],
    [arm9, rom.arm9RamAddress, 0x02018d68, "08b5fff785fdc08b8005c00e0006000e08bd"],
    [arm9, rom.arm9RamAddress, 0x02030828, "30b4084b0025ac001a5b904203d10648"],
    [arm9, rom.arm9RamAddress, 0x0203050c, "78b585b00d1c00a9"],
    [arm9, rom.arm9RamAddress, 0x020307f0, "08b5fff7ebff1d2801d30f20"],
    [arm9, rom.arm9RamAddress, 0x0202fe7c, "f8b5041c0d1ce6f729fe071c"],
    [arm9, rom.arm9RamAddress, 0x0202feb0, "70b5041ce6f710fe051c0a4a"],
    [arm9, rom.arm9RamAddress, 0x02034ee8, "38b5051c00214c22"],
    [arm9, rom.arm9RamAddress, 0x02034f40, "0168816000210160"],
  ] as const;
  for (const [bytes, base, address, hex] of signatures) {
    const actual = Array.from(bytes.subarray(address - base, address - base + hex.length / 2), n => n.toString(16).padStart(2, "0")).join("");
    if (actual !== hex) throw new Error(`Battle harness native signature mismatch at 0x${address.toString(16)}; this executable is not compatible`);
  }
}

/** Configure the shipped template without a compiler or changes to its hooks. */
export function configureHarnessRuntime(bytes: Uint8Array, trainerId: number, rule: number): Uint8Array {
  harnessInteger(trainerId, 0, 65535, "trainerId"); // Zero disables an imported test trigger for overworld launch.
  harnessInteger(rule, 0, 3, "battle type");
  const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
  const config = rpm.symbols.find(symbol => symbol.nameHash === 0xc3592c1b);
  if (rpm.metadata.PMCGameID !== "W2" || rpm.metadata.PMCVersion !== "battle-harness-5"
    || !config || config.size !== 16 || config.address + config.size > rpm.code.length) throw new Error("Incompatible battle harness template");
  const at = config.address;
  if (readU32(rpm.code, at) !== 0x32484250 || readU16(rpm.code, at + 4) !== 5 || readU32(rpm.code, at + 12) !== 0x57483242) throw new Error("Battle harness configuration integrity check failed");
  writeU16(rpm.code, at + 6, trainerId);
  writeU32(rpm.code, at + 8, rule);
  return writeRpm(rpm, { ident: "DLXF" });
}

/** Test-ROM adaptation for expanded species; retain the native Keldeo form reset. */
export function patchHarnessExpandedPartyGuard(project: ProjectState, overlay: { data: Uint8Array; ramAddress: number }): void {
  const source = project.overlays[36] ?? overlay.data;
  const at = 0x021c9ed0 - overlay.ramAddress;
  const signature = [0x81, 0x42, 0x02, 0xd9, 0xff, 0x20, 0xa0, 0x77, 0xe0, 0x77];
  if (at < 0 || !signature.every((value, i) => source[at + i] === value || i === 3 && source[at + i] === 0xe0)) throw new Error("Expanded-party startup guard signature mismatch at 0x021c9ed0");
  if (source[at + 3] === 0xe0) return;
  // Retail rejects species >649 by writing 0xffff into the encrypted PK5 body.
  // Expanded parties were validated against the ROM's Personal data by the builder.
  const data = source.slice();
  writeU16(data, at + 2, 0xe002); // Always skip the destructive two byte stores.
  project.overlays[36] = data;
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  if (!project.patches.dirtyOverlayIds.includes(36)) project.patches.dirtyOverlayIds.push(36);
}

function resolvePokemon(project: ProjectState, spec: HarnessPokemon): ShowdownPokemon {
  const speciesId = harnessInteger(spec.speciesId, 1, 2047, "speciesId");
  findPokemonBaseSpeciesId(project, String(speciesId));
  const formIndex = harnessInteger(spec.form ?? 0, 0, 31, "form");
  const { personalId, raw } = getTestBattlePersonal(project, speciesId, formIndex);
  const abilitySlot = harnessInteger(spec.abilitySlot ?? 1, 1, 3, "abilitySlot") as 1 | 2 | 3;
  const stats = (given: Stats | undefined, fallback: number, max: number) => {
    if (given !== undefined) keys(given, [...STATS], "stats");
    return Object.fromEntries(STATS.map(key => [key, harnessInteger(given?.[key] ?? fallback, 0, max, key)])) as ShowdownPokemon["ivs"];
  };
  const moves = spec.moves ?? [];
  if (!Array.isArray(moves) || moves.length > 4) throw new Error("moves must contain at most four IDs");
  for (const move of moves) harnessInteger(move, 0, (project.narcs.moves?.fileCount ?? 1) - 1, "move ID");
  const evs = stats(spec.evs, 0, 255);
  if (Object.values(evs).reduce((a, b) => a + b, 0) > 510) throw new Error("Total EVs exceed 510");
  return {
    speciesId, personalId, formIndex, speciesName: pokemonSpeciesLabel(project, speciesId),
    abilitySlot, abilityId: harnessInteger(spec.abilityId ?? Number(raw[`ability_${abilitySlot}`]), 1, 255, "abilityId"),
    level: harnessInteger(spec.level ?? 50, 1, 100, "level"),
    itemId: harnessInteger(spec.itemId ?? 0, 0, (project.texts.banks.items?.length || 65536) - 1, "itemId"),
    nature: harnessInteger(spec.nature ?? 0, 0, 24, "nature"),
    gender: harnessInteger(spec.gender ?? (Number(raw.gender) === 255 ? 2 : Number(raw.gender) === 254 ? 1 : 0), 0, 2, "gender") as 0 | 1 | 2,
    moves, evs, ivs: stats(spec.ivs, 31, 31),
  };
}

export function patchHarnessTrainer(project: ProjectState, config: HarnessConfig): number {
  const id = harnessInteger(config.trainerId, 1, (project.narcs.trdata?.fileCount ?? 1) - 1, "trainerId");
  const data = decodeRecord(project, "trdata", id), party = decodeRecord(project, "trpok", id);
  if (!data.raw || !party.raw) throw new Error("Trainer archives are not loaded");
  const rule = config.battleType === undefined ? Number(data.raw.battle_type_1) : BATTLE_TYPES.indexOf(config.battleType);
  harnessInteger(rule, 0, 3, "battle type");
  if (config.battleType !== undefined) data.raw.battle_type_1 = rule;
  const trainer = config.trainer;
  if (trainer?.ai !== undefined) data.raw.ai = harnessInteger(trainer.ai, 0, 0xffffffff, "trainer AI flags");
  if (trainer?.trainerClass !== undefined) data.raw.class = harnessInteger(trainer.trainerClass, 0, 255, "trainerClass");
  if (trainer?.team) {
    data.raw.template = 3;
    data.raw.num_pokemon = trainer.team.length;
    project.trpokInfo[id] = { template: 3, numPokemon: trainer.team.length };
    party.raw = {};
    for (const [slot, spec] of trainer.team.entries()) {
      if (["currentHp", "status", "pp", "evs"].some(key => key in spec)) throw new Error("Trainer NARC teams do not support currentHp, status, pp, or EVs; use those fields on the player");
      const mon = resolvePokemon(project, spec);
      const personal = getTestBattlePersonal(project, mon.speciesId, mon.formIndex).raw;
      if (mon.abilityId !== Number(personal[`ability_${mon.abilitySlot}`])) throw new Error("Trainer abilityId must match a Personal ability slot; use abilitySlot");
      // Retail trainer data stores one byte of IV quality, not six separate IVs.
      if (new Set(Object.values(mon.ivs)).size !== 1) throw new Error("Trainer IVs must all be equal");
      Object.assign(party.raw, {
        [`species_id_${slot}`]: mon.speciesId, [`form_${slot}`]: mon.formIndex,
        [`level_${slot}`]: mon.level, [`ivs_${slot}`]: Math.ceil(mon.ivs.hp * 255 / 31),
        [`ability_${slot}`]: mon.abilitySlot * 16 + (spec.gender === 0 ? 1 : spec.gender === 1 ? 2 : 0),
        [`padding_${slot}`]: 0, [`item_id_${slot}`]: mon.itemId,
        ...Object.fromEntries([0, 1, 2, 3].map(move => [`move_${move + 1}_${slot}`, mon.moves[move] ?? 0])),
      });
      if (spec.nature !== undefined) throw new Error("Explicit trainer natures require the optional Trainer Nature patch; omitted natures use the native trainer calculation");
    }
    markDirty(project, "trpok", id);
  }
  if (config.battleType !== undefined || trainer) markDirty(project, "trdata", id);
  const count = Number(data.raw.num_pokemon);
  if (count < (rule >= 2 ? 3 : rule === 1 ? 2 : 1)) throw new Error("Trainer party is too small for this battle type");
  return rule;
}

function crc(data: Uint8Array): number {
  let value = 0xffff;
  for (const byte of data) { value ^= byte << 8; for (let i = 0; i < 8; i++) value = ((value << 1) ^ (value & 0x8000 ? 0x1021 : 0)) & 0xffff; }
  return value;
}
function validHalves(save: Uint8Array): number[] {
  if (save.length !== 0x80000) throw new Error("Expected a 512 KiB raw BW2 save (or a .dsv converted to raw)");
  const halves = [0, 0x26000].filter(half => {
    const capacity = readU32(save, half + PARTY), count = readU32(save, half + PARTY + 4);
    return count >= 1 && count <= capacity && capacity <= 6 && crc(save.subarray(half + PARTY, half + PARTY + 0x534)) === readU16(save, half + 0x19336);
  });
  if (!halves.length) throw new Error("No valid BW2 party save block; check the save format and game");
  return halves;
}
function readPokemon(data: Uint8Array): HarnessPokemon {
  let checksum = 0;
  for (let at = 8; at < 136; at += 2) checksum = (checksum + readU16(data, at)) & 0xffff;
  if (checksum !== readU16(data, 6)) throw new Error("PK5 checksum mismatch");
  const ivs = readU32(data, 0x38);
  return {
    speciesId: readU16(data, 8), form: data[0x40] >>> 3, level: data[0x8c], itemId: readU16(data, 0xa),
    abilityId: data[0x15], abilitySlot: data[0x42] & 1 ? 3 : (readU32(data, 0) & 1) + 1 as 1 | 2,
    nature: data[0x41], gender: ((data[0x40] >>> 1) & 3) as 0 | 1 | 2,
    moves: [0, 1, 2, 3].map(i => readU16(data, 0x28 + i * 2)),
    ivs: Object.fromEntries(STATS.map((key, i) => [key, (ivs >>> (i * 5)) & 31])),
    evs: Object.fromEntries(STATS.map((key, i) => [key, data[0x18 + i]])),
  };
}
function condition(data: Uint8Array, spec: Partial<HarnessPokemon>): void {
  if (spec.currentHp !== undefined) writeU16(data, 0x8e, harnessInteger(spec.currentHp, 0, readU16(data, 0x90), "currentHp"));
  if (spec.status !== undefined) {
    const status = typeof spec.status === "string" ? STATUS[spec.status] : spec.status;
    writeU32(data, 0x88, harnessInteger(status, 0, 0xfff, "status"));
  }
  if (spec.pp !== undefined) {
    if (!Array.isArray(spec.pp) || spec.pp.length !== 4) throw new Error("pp must have four entries");
    spec.pp.forEach((pp, i) => { data[0x30 + i] = harnessInteger(pp, 0, 255, "PP"); });
  }
}
/** Unspecified party bytes are preserved, including identity, HP, status and PP. */
export function patchHarnessSave(save: Uint8Array, project: ProjectState, config: HarnessConfig): Uint8Array {
  const halves = validHalves(save), output = save.slice(), player = config.player;
  for (const half of halves) {
    const count = save[half + PARTY + 4];
    for (let slot = 0; slot < count; slot++) {
      const mon = readPokemon(decryptPk5Party(save.subarray(half + PARTY + 8 + slot * SIZE, half + PARTY + 8 + (slot + 1) * SIZE)));
      findPokemonBaseSpeciesId(project, String(mon.speciesId));
      getTestBattlePersonal(project, mon.speciesId, mon.form);
    }
    if (player?.team) {
      output.fill(0, half + PARTY + 8, half + PARTY + 8 + 6 * SIZE);
      writeU32(output, half + PARTY, 6);
      writeU32(output, half + PARTY + 4, player.team.length);
      for (const [slot, spec] of player.team.entries()) {
        const mon = resolvePokemon(project, spec), data = createTestBattlePartyPokemon(project, mon, output, half, slot);
        condition(data, spec);
        output.set(encryptPk5Party(data), half + PARTY + 8 + slot * SIZE);
      }
    } else if (player?.edits) for (const edit of player.edits) {
      if (edit.slot >= count) throw new Error(`Player slot ${edit.slot} is absent from save half 0x${half.toString(16)}`);
      const offset = half + PARTY + 8 + edit.slot * SIZE;
      const data = decryptPk5Party(output.subarray(offset, offset + SIZE)), old = readPokemon(data);
      const mon = resolvePokemon(project, { ...old, ...edit,
        form: edit.form ?? (edit.speciesId !== undefined ? 0 : old.form),
        ivs: { ...old.ivs, ...edit.ivs }, evs: { ...old.evs, ...edit.evs },
        abilityId: (edit.abilitySlot !== undefined || edit.speciesId !== undefined || edit.form !== undefined) && edit.abilityId === undefined ? undefined : edit.abilityId ?? old.abilityId });
      const replacement = createTestBattlePartyPokemon(project, mon, output, half, edit.slot);
      if (edit.speciesId !== undefined || edit.form !== undefined) {
        data.set(replacement.subarray(8, 10), 8);
        if (!(readU32(data, 0x38) & 0x80000000)) data.set(replacement.subarray(0x48, 0x5e), 0x48);
      }
      if (edit.itemId !== undefined) writeU16(data, 0xa, mon.itemId);
      if (edit.abilityId !== undefined || edit.abilitySlot !== undefined || edit.speciesId !== undefined || edit.form !== undefined) { data[0x15] = mon.abilityId; data[0x42] = (data[0x42] & ~1) | Number(mon.abilitySlot === 3); writeU32(data, 0, (readU32(data, 0) & ~1) | Number(mon.abilitySlot === 2)); }
      if (edit.moves !== undefined) { data.set(replacement.subarray(0x28, 0x34), 0x28); data.fill(0, 0x34, 0x38); }
      if (edit.evs !== undefined) data.set(replacement.subarray(0x18, 0x1e), 0x18);
      if (edit.ivs !== undefined) writeU32(data, 0x38, (readU32(data, 0x38) & 0xc0000000) | (readU32(replacement, 0x38) & 0x3fffffff));
      if (edit.form !== undefined || edit.gender !== undefined || edit.speciesId !== undefined) data[0x40] = (data[0x40] & 1) | replacement[0x40];
      if (edit.nature !== undefined) data[0x41] = mon.nature;
      if ([edit.speciesId, edit.form, edit.level, edit.nature, edit.ivs, edit.evs].some(v => v !== undefined)) recalculateTestBattlePartyStats(data, mon, getTestBattlePersonal(project, mon.speciesId, mon.formIndex).raw);
      condition(data, edit);
      output.set(encryptPk5Party(data), offset);
    }
    if (player?.team || player?.edits?.length) refreshTestBattlePartyChecksums(output, half);
    const finalCount = output[half + PARTY + 4];
    let usable = false;
    for (let slot = 0; slot < finalCount; slot++) {
      const offset = half + PARTY + 8 + slot * SIZE;
      const data = decryptPk5Party(output.subarray(offset, offset + SIZE));
      if (!(readU32(data, 0x38) & 0x40000000) && readU16(data, 0x8e)) usable = true;
    }
    if (!usable) throw new Error("The prepared player party has no non-Egg Pokemon with HP; native trainer battles require an eligible battler");
  }
  return output;
}
