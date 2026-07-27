import type { FieldSpec } from "./formats";
import { parseHeaders } from "./headerModel";
import { isGen4Project } from "./constants";
import { GROTTO_ODDS_FIELDS } from "./martGrottoModel";
import { groupByteLength, OVERWORLD_GROUP_FORMATS, OVERWORLD_HEADER_FORMAT, NULL_MAP_ID } from "./overworldModel";
import { learnsetEntries } from "./pokemonModel";
import type { NarcRecord, NarcStore, ProjectState, RawRecord } from "./projectStore";
import { materializeGen4EventFile } from "./gen4EventModel";
import { materializeGen4MapFile } from "./gen4MapModel";
import { materializeGen4MatrixFile } from "./gen4MatrixModel";
import { packedPersonalFieldValue } from "./personalAbilityPacking";

export function materializeProjectEdits(project: ProjectState): void {
  materializeHeaders(project);
  materializeGrottoOdds(project);

  for (const store of Object.values(project.narcs)) {
    if (!store || store.dirty.size === 0) continue;
    if (store.name === "headers" || store.name === "grotto_odds") continue;
    if (store.name === "overworlds") {
      if (isGen4Project(project)) materializeGen4EventFiles(store);
      else materializeOverworlds(store);
      continue;
    }
    if (store.name === "maps") {
      if (isGen4Project(project)) materializeGen4Maps(project, store);
      else materializeMaps(store);
      continue;
    }
    if (store.name === "matrix" && isGen4Project(project)) {
      materializeGen4Matrices(store);
      continue;
    }
    if (store.name === "trpok") {
      materializeTrpok(project, store);
      continue;
    }
    if (store.name === "learnsets") {
      materializeLearnsets(project, store);
      continue;
    }
    if (store.name === "encounters" && isGen4Project(project)) {
      materializeGen4Encounters(project, store);
      continue;
    }
    materializeFormattedStore(project, store);
  }
}

function materializeHeaders(project: ProjectState): void {
  if (isGen4Project(project)) return;
  const store = project.narcs.headers;
  const format = project.formats.headers;
  if (!store || !format || store.dirty.size === 0) return;
  if (!project.headers) project.headers = parseHeaders(project);

  const rowLength = format.reduce((sum, [size]) => sum + size, 0);
  const original = store.rawFiles[0] ?? new Uint8Array();
  const out = new Uint8Array(Math.max(original.length, project.headers.count * rowLength));
  out.set(original.subarray(0, Math.min(original.length, out.length)));
  for (let rowId = 1; rowId <= project.headers.count; rowId += 1) {
    writeFormattedRecord(out, (rowId - 1) * rowLength, format, project.headers.rows[rowId] as RawRecord);
  }
  store.rawFiles[0] = out;
  updateRecordBytes(store, 0, out);
}

function materializeGrottoOdds(project: ProjectState): void {
  const store = project.narcs.grotto_odds;
  if (!store || store.dirty.size === 0 || !project.grottoOdds) return;
  const out = store.rawFiles[0] ? store.rawFiles[0].slice() : new Uint8Array(GROTTO_ODDS_FIELDS.length);
  GROTTO_ODDS_FIELDS.forEach((field, index) => {
    out[index] = Number(project.grottoOdds?.raw[field] ?? out[index] ?? 0) & 0xff;
  });
  store.rawFiles[0] = out;
  updateRecordBytes(store, 0, out);
}

function materializeFormattedStore(project: ProjectState, store: NarcStore): void {
  const format = project.formats[store.name];
  if (!format) return;
  for (const id of store.dirty) {
    const record = store.records.get(id);
    if (!record?.raw) continue;
    const original = store.rawFiles[id] ?? new Uint8Array(record.bytes.length);
    const out = copyWithLength(original, Math.max(original.length, formattedRecordLength(format, record.raw)));
    if (store.name === "personal" && isGen4Project(project)) syncGen4PersonalAliases(record.raw);
    writeFormattedRecord(
      out,
      0,
      format,
      record.raw,
      store.name === "personal" && !isGen4Project(project) ? (raw, field) => packedPersonalFieldValue(raw, field) : undefined,
    );
    store.rawFiles[id] = out;
    updateRecordBytes(store, id, out, record);
  }
}

function materializeLearnsets(project: ProjectState, store: NarcStore): void {
  for (const id of store.dirty) {
    const record = store.records.get(id);
    if (!record?.raw) continue;
    const entries = learnsetEntries(record.raw);
    if (isGen4Project(project)) {
      const out = new Uint8Array(entries.length * 2 + 4);
      entries.forEach((entry, index) => {
        writeInt(out, index * 2, 2, ((entry.level & 0x7f) << 9) | (entry.moveId & 0x01ff));
      });
      writeInt(out, entries.length * 2, 2, 65535);
      writeInt(out, entries.length * 2 + 2, 2, 0);
      store.rawFiles[id] = out;
      updateRecordBytes(store, id, out, record);
      continue;
    }
    const out = new Uint8Array(entries.length * 4 + 4);
    entries.forEach((entry, index) => {
      const offset = index * 4;
      writeInt(out, offset, 2, entry.moveId);
      writeInt(out, offset + 2, 2, entry.level);
    });
    writeInt(out, entries.length * 4, 2, 65535);
    writeInt(out, entries.length * 4 + 2, 2, 65535);
    store.rawFiles[id] = out;
    updateRecordBytes(store, id, out, record);
  }
}

function materializeGen4Encounters(project: ProjectState, store: NarcStore): void {
  for (const id of store.dirty) {
    const record = store.records.get(id);
    if (!record?.raw) continue;
    const original = store.rawFiles[id] ?? record.bytes ?? new Uint8Array();
    const out = project.session.baseRom === "HGSS" ? writeHgssEncounter(record.raw, original) : writeDpptEncounter(record.raw, original);
    store.rawFiles[id] = out;
    updateRecordBytes(store, id, out, record);
  }
}

function materializeGen4EventFiles(store: NarcStore): void {
  for (const id of store.dirty) {
    const record = store.records.get(id);
    if (!record?.raw) continue;
    const original = store.rawFiles[id] ?? record.bytes ?? new Uint8Array();
    const out = materializeGen4EventFile(record.raw, original);
    store.rawFiles[id] = out;
    updateRecordBytes(store, id, out, record);
  }
}

function materializeGen4Maps(project: ProjectState, store: NarcStore): void {
  for (const id of store.dirty) {
    const record = store.records.get(id);
    if (!record?.raw) continue;
    const original = store.rawFiles[id] ?? record.bytes ?? new Uint8Array();
    const out = materializeGen4MapFile(record.raw, original, project.session.baseRom);
    store.rawFiles[id] = out;
    updateRecordBytes(store, id, out, record);
  }
}

function writeDpptEncounter(raw: RawRecord, original: Uint8Array): Uint8Array {
  const out = copyWithLength(original, 0x1a8);
  writeInt(out, 0, 4, raw.spring_grass_rate ?? 0);
  for (let slot = 0; slot < 12; slot += 1) {
    const offset = 4 + slot * 8;
    writeInt(out, offset, 4, gen4SlotLevel(raw, "grass", slot));
    writeInt(out, offset + 4, 4, raw[`spring_grass_slot_${slot}`] ?? 0);
  }
  writeGen4SpeciesOnlyGroup(out, raw, "swarm", 0x64, 2, 4);
  writeGen4SpeciesOnlyGroup(out, raw, "day", 0x6c, 2, 4);
  writeGen4SpeciesOnlyGroup(out, raw, "night", 0x74, 2, 4);
  writeGen4SpeciesOnlyGroup(out, raw, "poke_radar", 0x7c, 4, 4);
  writeGen4SpeciesOnlyGroup(out, raw, "ruby", 0xa4, 2, 4);
  writeGen4SpeciesOnlyGroup(out, raw, "sapphire", 0xac, 2, 4);
  writeGen4SpeciesOnlyGroup(out, raw, "emerald", 0xb4, 2, 4);
  writeGen4SpeciesOnlyGroup(out, raw, "fire_red", 0xbc, 2, 4);
  writeGen4SpeciesOnlyGroup(out, raw, "leaf_green", 0xc4, 2, 4);
  writeDpptFishingGroup(out, raw, "surf", 0xcc, 0xd0);
  writeDpptFishingGroup(out, raw, "old_rod", 0x124, 0x128);
  writeDpptFishingGroup(out, raw, "good_rod", 0x150, 0x154);
  writeDpptFishingGroup(out, raw, "super_rod", 0x17c, 0x180);
  return out;
}

function writeDpptFishingGroup(out: Uint8Array, raw: RawRecord, kind: string, rateOffset: number, slotsOffset: number): void {
  writeInt(out, rateOffset, 4, raw[`spring_${kind}_rate`] ?? 0);
  for (let slot = 0; slot < 5; slot += 1) {
    const offset = slotsOffset + slot * 8;
    writeInt(out, offset, 1, raw[`spring_${kind}_slot_${slot}_max_level`] ?? 0);
    writeInt(out, offset + 1, 1, raw[`spring_${kind}_slot_${slot}_min_level`] ?? 0);
    writeInt(out, offset + 4, 4, raw[`spring_${kind}_slot_${slot}`] ?? 0);
  }
}

function writeHgssEncounter(raw: RawRecord, original: Uint8Array): Uint8Array {
  const out = copyWithLength(original, 196);
  writeInt(out, 0, 1, raw.spring_grass_rate ?? 0);
  writeInt(out, 1, 1, raw.spring_surf_rate ?? 0);
  writeInt(out, 2, 1, raw.spring_rock_smash_rate ?? 0);
  writeInt(out, 3, 1, raw.spring_old_rod_rate ?? 0);
  writeInt(out, 4, 1, raw.spring_good_rod_rate ?? 0);
  writeInt(out, 5, 1, raw.spring_super_rod_rate ?? 0);

  for (let slot = 0; slot < 12; slot += 1) {
    writeInt(out, 8 + slot, 1, gen4SlotLevel(raw, "grass", slot));
    writeInt(out, 20 + slot * 2, 2, raw[`spring_grass_slot_${slot}`] ?? 0);
    writeInt(out, 44 + slot * 2, 2, raw[`spring_grass_doubles_slot_${slot}`] ?? 0);
    writeInt(out, 68 + slot * 2, 2, raw[`spring_grass_special_slot_${slot}`] ?? 0);
  }

  writeHgssWaterGroup(out, raw, "surf", 100, 5);
  writeHgssWaterGroup(out, raw, "rock_smash", 120, 2);
  writeHgssWaterGroup(out, raw, "old_rod", 128, 5);
  writeHgssWaterGroup(out, raw, "good_rod", 148, 5);
  writeHgssWaterGroup(out, raw, "super_rod", 168, 5);
  writeGen4SpeciesOnlyGroup(out, raw, "hoenn_radio", 92, 2, 2);
  writeGen4SpeciesOnlyGroup(out, raw, "sinnoh_radio", 96, 2, 2);
  writeGen4SpeciesOnlyGroup(out, raw, "swarm", 188, 4, 2);
  return out;
}

function writeHgssWaterGroup(out: Uint8Array, raw: RawRecord, kind: string, slotsOffset: number, slotCount: number): void {
  for (let slot = 0; slot < slotCount; slot += 1) {
    const offset = slotsOffset + slot * 4;
    writeInt(out, offset, 1, raw[`spring_${kind}_slot_${slot}_min_level`] ?? 0);
    writeInt(out, offset + 1, 1, raw[`spring_${kind}_slot_${slot}_max_level`] ?? 0);
    writeInt(out, offset + 2, 2, raw[`spring_${kind}_slot_${slot}`] ?? 0);
  }
}

function gen4SlotLevel(raw: RawRecord, kind: string, slot: number): number {
  return raw[`spring_${kind}_slot_${slot}_min_level`] ?? raw[`spring_${kind}_slot_${slot}_max_level`] ?? 0;
}

function writeGen4SpeciesOnlyGroup(out: Uint8Array, raw: RawRecord, kind: string, offset: number, slotCount: number, size: 2 | 4): void {
  for (let slot = 0; slot < slotCount; slot += 1) writeInt(out, offset + slot * size, size, raw[`spring_${kind}_slot_${slot}`] ?? 0);
}

function copyWithLength(original: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(Math.max(original.length, length));
  out.set(original.subarray(0, Math.min(original.length, out.length)));
  return out;
}

function materializeGen4Matrices(store: NarcStore): void {
  for (const id of store.dirty) {
    const record = store.records.get(id);
    if (!record?.raw) continue;
    const original = store.rawFiles[id] ?? record.bytes ?? new Uint8Array();
    const out = materializeGen4MatrixFile(record.raw, original);
    store.rawFiles[id] = out;
    updateRecordBytes(store, id, out, record);
  }
}

function materializeTrpok(project: ProjectState, store: NarcStore): void {
  for (const id of store.dirty) {
    const record = store.records.get(id);
    if (!record?.raw) continue;
    if (isGen4Project(project)) {
      materializeGen4Trpok(project, store, id, record.raw, record);
      continue;
    }
    const template = project.trpokInfo[id]?.template ?? 0;
    const count = project.trpokInfo[id]?.numPokemon ?? 0;
    const format = trpokFormat(template);
    const expectedLength = format.reduce((sum, [size]) => sum + size, 0) * count;
    const original = store.rawFiles[id] ?? record.bytes ?? new Uint8Array();
    const out = copyWithLength(original, Math.max(original.length, expectedLength));
    let offset = 0;
    for (let slot = 0; slot < count; slot += 1) {
      for (const [size, field] of format) {
        writeInt(out, offset, size, record.raw[`${field}_${slot}`] ?? 0);
        offset += size;
      }
    }
    store.rawFiles[id] = out;
    updateRecordBytes(store, id, out, record);
  }
}

function materializeGen4Trpok(project: ProjectState, store: NarcStore, id: number, raw: RawRecord, record: NarcRecord): void {
  const template = project.trpokInfo[id]?.template ?? 0;
  const count = project.trpokInfo[id]?.numPokemon ?? 0;
  const hasMoves = (template & 1) !== 0;
  const hasItems = (template & 2) !== 0;
  const hasBallSeals = project.session.baseRom !== "DP";
  const rowLength = 6 + (hasItems ? 2 : 0) + (hasMoves ? 8 : 0) + (hasBallSeals ? 2 : 0);
  const out = new Uint8Array(rowLength * count);
  let offset = 0;
  for (let slot = 0; slot < count; slot += 1) {
    writeInt(out, offset, 1, raw[`ivs_${slot}`] ?? 0);
    writeInt(out, offset + 1, 1, raw[`ability_${slot}`] ?? 0);
    writeInt(out, offset + 2, 2, raw[`level_${slot}`] ?? 0);
    writeInt(out, offset + 4, 2, ((raw[`form_${slot}`] ?? 0) << 10) | ((raw[`species_id_${slot}`] ?? 0) & 0x03ff));
    offset += 6;
    if (hasItems) {
      writeInt(out, offset, 2, raw[`item_id_${slot}`] ?? 0);
      offset += 2;
    }
    if (hasMoves) {
      for (let move = 1; move <= 4; move += 1) {
        writeInt(out, offset, 2, raw[`move_${move}_${slot}`] ?? 0);
        offset += 2;
      }
    }
    if (hasBallSeals) {
      writeInt(out, offset, 2, raw[`ball_seals_${slot}`] ?? 0);
      offset += 2;
    }
  }
  store.rawFiles[id] = out;
  updateRecordBytes(store, id, out, record);
}

function materializeOverworlds(store: NarcStore): void {
  for (const id of store.dirty) {
    const record = store.records.get(id);
    if (!record?.raw) continue;
    const original = store.rawFiles[id] ?? record.bytes ?? new Uint8Array();
    const footerLength = Number(record.raw.footer_length ?? 0);
    const originalPayloadLength = overworldPayloadLength(record.raw);
    const footerStart = Math.min(original.length, Math.max(0, originalPayloadLength));
    const footer =
      footerLength > 0
        ? original.subarray(Math.max(0, original.length - footerLength))
        : original.subarray(footerStart, original.length);
    const out = new Uint8Array(originalPayloadLength + footer.length);
    let offset = 0;

    for (const [size, field] of OVERWORLD_HEADER_FORMAT) {
      writeInt(out, offset, size, record.raw[field] ?? 0);
      offset += size;
    }

    for (const group of ["furniture", "npc", "warp", "trigger"] as const) {
      const indexes = groupIndexes(record.raw, group);
      for (const index of indexes) {
        for (const [size, field] of OVERWORLD_GROUP_FORMATS[group]) {
          writeInt(out, offset, size, record.raw[`${group}_${index}_${field}`] ?? 0);
          offset += size;
        }
      }
    }

    out.set(footer, offset);
    record.raw.footer_length = footer.length;
    store.rawFiles[id] = out;
    updateRecordBytes(store, id, out, record);
  }
}

function materializeMaps(store: NarcStore): void {
  for (const id of store.dirty) {
    const record = store.records.get(id);
    if (!record?.raw || id === NULL_MAP_ID) continue;
    const original = store.rawFiles[id] ?? record.bytes ?? new Uint8Array();
    const out = original.slice();
    const perOffset = Number(record.raw.per_offset ?? 0);
    const width = Number(record.raw.width ?? 0);
    const height = Number(record.raw.height ?? 0);
    const tileCount = width * height;
    for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
      const layer2 = record.raw[`layer_2_${tileIndex}`];
      const layer3 = record.raw[`layer_3_${tileIndex}`];
      if (layer2 !== undefined) writeInt(out, perOffset + 4 + tileIndex * 8 + 4, 2, layer2);
      if (layer3 !== undefined) writeInt(out, perOffset + 4 + tileIndex * 8 + 6, 2, layer3);
    }
    store.rawFiles[id] = out;
    updateRecordBytes(store, id, out, record);
  }
}

function writeFormattedRecord(out: Uint8Array, startOffset: number, format: FieldSpec[], raw: RawRecord, valueForField: ((raw: RawRecord, field: string) => number | undefined) | undefined = undefined): void {
  let offset = startOffset;
  for (const [size, field] of format) {
    if (offset + size > out.length) break;
    const value = valueForField?.(raw, field) ?? raw[field];
    if (value !== undefined) writeInt(out, offset, size, value);
    offset += size;
  }
}

function formattedRecordLength(format: FieldSpec[], raw: RawRecord): number {
  let offset = 0;
  let length = 0;
  for (const [size, field] of format) {
    offset += size;
    if (raw[field] !== undefined) length = offset;
  }
  return length;
}

function syncGen4PersonalAliases(raw: RawRecord): void {
  if (raw.color !== undefined || raw.flip !== undefined) {
    raw.color_flip = (Number(raw.color ?? raw.color_flip ?? 0) & 0x7f) | ((Number(raw.flip ?? ((raw.color_flip ?? 0) >>> 7)) & 1) << 7);
  }
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  let next = Number(value) >>> 0;
  for (let i = 0; i < size; i += 1) {
    out[offset + i] = next & 0xff;
    next >>>= 8;
  }
}

function trpokFormat(template: number): FieldSpec[] {
  const base: FieldSpec[] = [
    [1, "ivs"],
    [1, "ability"],
    [1, "level"],
    [1, "padding"],
    [2, "species_id"],
    [2, "form"],
  ];
  if ((template & 2) !== 0) base.push([2, "item_id"]);
  if ((template & 1) !== 0) base.push([2, "move_1"], [2, "move_2"], [2, "move_3"], [2, "move_4"]);
  return base;
}

function updateRecordBytes(store: NarcStore, id: number, bytes: Uint8Array, record = store.records.get(id) as NarcRecord | undefined): void {
  if (record) record.bytes = bytes;
}

function overworldPayloadLength(raw: RawRecord): number {
  return (
    OVERWORLD_HEADER_FORMAT.reduce((sum, [size]) => sum + size, 0) +
    Number(raw.furniture_count ?? 0) * groupByteLength("furniture") +
    Number(raw.npc_count ?? 0) * groupByteLength("npc") +
    Number(raw.warp_count ?? 0) * groupByteLength("warp") +
    Number(raw.trigger_count ?? 0) * groupByteLength("trigger")
  );
}

function groupIndexes(raw: RawRecord, group: keyof typeof OVERWORLD_GROUP_FORMATS): number[] {
  const firstField = OVERWORLD_GROUP_FORMATS[group][0][1];
  const indexes = Object.keys(raw)
    .map((key) => new RegExp(`^${group}_(\\d+)_${firstField}$`, "u").exec(key)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  return indexes.slice(0, Number(raw[`${group}_count`] ?? indexes.length));
}
