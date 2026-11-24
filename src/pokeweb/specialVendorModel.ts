import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { recordFieldChange } from "./actionChangelog";
import { validateVendorItem, vendorItemName } from "./battlePointShopModel";
import { replaceNarcFile } from "./fileSystemModel";
import { applyOverlayBytes, getOverlayWorkingBytes } from "./overlayEditModel";
import { findPokemonBaseSpeciesId, pokemonSpeciesLabel } from "./pokemonLabels";
import type { ProjectState } from "./projectStore";
import { decodeGen5TextBank, encodeGen5TextBank, type Gen5TextEntry } from "./text";
import { scriptedVendors, type VendorScriptField, type VendorScriptRow } from "./vendorScripts";

export type SpecialVendorGroup = "scripts" | "daycare" | "collectors" | "funfest-sales" | "funfest-exchange" | "raffle" | "appraisal";
export type SpecialVendorValue = { label: string; value: number; min: number; max: number; kind?: "item" | "species" | "price" };
export type SpecialVendorEntry = { label: string; values: SpecialVendorValue[]; save: (values: number[]) => void; unavailable?: string };
type Option = readonly [id: number, label: string];
type VendorContext = { project: ProjectState; rom: NintendoDSRom };

const NATIVE_LAYOUTS = {
  IRBO: { daycareOverlay: 21, daycare: 0x3b5b4 },
  IRAO: { daycareOverlay: 21, daycare: 0x3b5ac },
  IREO: { daycareOverlay: 36, daycare: 0x3df8c },
  IRDO: { daycareOverlay: 36, daycare: 0x3df84 },
};
const COLLECTOR_LABELS = ["Gourmet", "Rare Bones", "Mulch", "Treasures", "Minerals"];
const BW_COLLECTOR_LABELS = ["Gourmet", "Rare Bones", "Treasures", "Minerals"];
const AVENUE_GAMES = ["Black", "White", "Black 2", "White 2"];
const AVENUE = "a/2/4/4";
const REWARD_MEMBER = 8;
const REWARD_BYTES = 44;
const vendorArchives = new WeakMap<Uint8Array, NARC>();

export function specialVendorGroups(bw2: boolean): Array<readonly [SpecialVendorGroup, string]> {
  return [["scripts", "Scripted vendors"], ["daycare", "Day Care"], ["collectors", "Item collectors"], ...(bw2 ? [
    ["funfest-sales", "Funfest sales"], ["funfest-exchange", "Funfest exchanges"], ["raffle", "Join Avenue raffle"], ["appraisal", "Antique appraisals"],
  ] as const : [])];
}

export function specialVendorOptions(context: VendorContext, group: SpecialVendorGroup): Option[] {
  if (group === "collectors") return collectorLabels(context.project).map((name, index) => [index, name]);
  if (group === "funfest-sales" || group === "funfest-exchange") {
    const count = group === "funfest-sales" ? 5 : 3;
    return Array.from({ length: count }, (_, index) => [index, `Variant ${index + 1}`]);
  }
  if (group !== "raffle" && group !== "appraisal") return [];
  const goods = archiveMember(context, AVENUE, 2);
  const rewards = archiveMember(context, AVENUE, REWARD_MEMBER);
  if (goods.length % 20 || rewards.length % REWARD_BYTES) throw new Error("Unsupported Join Avenue prize tables.");
  const labels = new Map<number, string>();
  const add = (id: number, label: string) => {
    if (id < rewards.length / REWARD_BYTES && (!labels.has(id) || labels.get(id) === "")) labels.set(id, label);
  };
  const names = group === "appraisal" ? decodeGen5TextBank(archiveMember(context, "a/0/0/3", 609)) : [];
  for (let offset = 0; offset < goods.length; offset += 20) {
    if (readU16(goods, offset + 10) !== (group === "raffle" ? 10 : 11)) continue;
    add(readU16(goods, offset + 12), names[readU16(goods, offset + 4)]?.[1] ?? "");
  }
  if (group === "raffle") {
    const shops = archiveMember(context, AVENUE, 1);
    if (shops.length % 50) throw new Error("Unsupported Join Avenue shop table.");
    for (let at = 50; at < shops.length; at += 50) {
      const stock = readU16(shops, at + 18) * 20;
      if (readU16(shops, at) !== 0 || stock >= goods.length || readU16(goods, stock + 10) !== 10) continue;
      const variant = readU16(shops, at + 2);
      add(readU16(goods, stock + 12), `${AVENUE_GAMES[variant] ?? `Variant ${variant + 1}`} · Shop rank ${readU16(shops, at + 4) + 1}`);
    }
    const ranks = archiveMember(context, AVENUE, 7);
    if (ranks.length % 26) throw new Error("Unsupported Join Avenue rank table.");
    for (let at = 0; at < ranks.length; at += 26) {
      if (readU16(ranks, at + 16)) add(readU16(ranks, at + 14), `Avenue rank ${readU16(ranks, at)}–${readU16(ranks, at + 2)}`);
    }
  }
  return [...labels].sort(([a], [b]) => a - b).map(([id, label]) => [id, label ? `${label} (#${id})` : `Prize table ${id}`]);
}

export function specialVendorEntries(context: VendorContext, group: SpecialVendorGroup, option: number): SpecialVendorEntry[] {
  if (group === "scripts") {
    const stock = scriptedVendors(context.project.session.baseRom === "BW2");
    return stock.map((row) => {
      try { return scriptEntry(context, row); }
      catch (error) { return { label: row.label, unavailable: error instanceof Error ? error.message : String(error), values: [], save: () => {} }; }
    });
  }
  if (group === "daycare") return [daycareEntry(context)];
  if (!specialVendorOptions(context, group).some(([id]) => id === option)) throw new Error("Choose a valid vendor table.");
  if (group === "collectors") return collectorEntries(context, option);
  if (group === "funfest-sales" || group === "funfest-exchange") return funfestEntries(context, group, option);
  return rewardEntries(context, option);
}

function scriptEntry(context: VendorContext, row: VendorScriptRow): SpecialVendorEntry {
  const { project } = context;
  const path = project.session.baseRom === "BW2" ? "a/0/5/6" : "a/0/5/7";
  const bytes = archiveMember(context, path, row.member);
  const getOffsets = (field: VendorScriptField, buffer: Uint8Array) => field.sites.map(([start, opcode, work, skip = 0]) => {
    const offset = start + (work === undefined ? 2 : 4) + skip;
    if (offset + 2 > buffer.length || readU16(buffer, start) !== opcode || (work !== undefined && readU16(buffer, start + 2) !== work)) {
      throw new Error("The vendor script uses a different instruction layout.");
    }
    return offset;
  });
  const values = row.fields.map((field): SpecialVendorValue => {
    const ids = getOffsets(field, bytes).map((offset) => readU16(bytes, offset));
    if (!ids.every((id) => id === ids[0])) throw new Error("The vendor's matching script operands disagree.");
    const limits = field.kind === "price" ? [0, field.sites.some(([, op]) => op === 0xfa) ? 0x3fff : 0xffff]
      : field.kind === "level" ? [1, 100] : field.kind === "quantity" ? [1, 999] : [1, 0x3fff];
    const kind = field.kind === "quantity" || field.kind === "level" ? undefined : field.kind;
    return { label: field.label, value: ids[0], kind, min: limits[0], max: limits[1] };
  });
  return {
    label: row.label, values,
    save(next) {
      validateValues(project, values, next);
      const current = archiveMember(context, path, row.member);
      const out = new Uint8Array(current);
      const textChanges = new Map<number, Gen5TextEntry[]>();
      row.fields.forEach((field, i) => {
        const offsets = getOffsets(field, current);
        if (offsets.some((offset) => readU16(current, offset) !== values[i].value)) throw new Error("This vendor changed. Reopen the row and try again.");
        if (next[i] !== values[i].value) {
          for (const offset of offsets) writeU16(out, offset, next[i]);
          updateVendorDialogue(context, field, values[i].value, next[i], textChanges);
        }
      });
      if (next.every((value, i) => value === values[i].value)) return;
      const encoded = [...textChanges].map(([bank, lines]) => ({ bank, lines, bytes: encodeGen5TextBank(lines) }));
      stageMember(context, path, row.member, out);
      for (const { bank, lines, bytes: textBytes } of encoded) {
        stageMember(context, "a/0/0/3", bank, textBytes);
        if (project.texts.storyTexts) project.texts.storyTexts[bank] = lines;
      }
      note(project, row.label, values, next);
    },
  };
}

function updateVendorDialogue(context: VendorContext, field: VendorScriptField, before: number, after: number, changes: Map<number, Gen5TextEntry[]>): void {
  if (!field.text) return;
  const { bank, entries } = field.text;
  const lines = changes.get(bank) ?? decodeGen5TextBank(archiveMember(context, "a/0/0/3", bank));
  const oldName = field.kind === "species" ? pokemonSpeciesLabel(context.project, before) : vendorItemName(context.project, before);
  const newName = field.kind === "species" ? pokemonSpeciesLabel(context.project, after) : vendorItemName(context.project, after);
  const escapedName = oldName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const names = new RegExp(`(?<![\\p{L}\\p{N}])${escapedName}(?=$|[^\\p{L}\\p{N}]|VAR\\()`, "giu");
  let changed = false;
  for (const index of entries ?? lines.map((_, i) => i)) {
    const entry = lines[index];
    if (!entry) continue;
    let updated = entry[1];
    if (field.kind === "price") {
      updated = updated.replace(/([$₽])(\d[\d,]*)/gu, (match, currency: string, amount: string) =>
        Number(amount.replaceAll(",", "")) === before ? currency + after.toLocaleString("en-US") : match);
    } else if (field.kind === "quantity") {
      updated = updated.replace(/(handed over )(?:one|\d+)(?=\\n|\s)/giu, (_match, prefix: string) => prefix + (after === 1 ? "one" : after))
        .replace(/(bring me )(?:an?|\d+)(?=\s)/giu, (_match, prefix: string) => prefix + (after === 1 ? "a" : after));
    } else updated = updated.replace(names, () => newName);
    if (entry[1] !== updated) { entry[1] = updated; changed = true; }
  }
  if (changed) changes.set(bank, lines);
}

function daycareEntry(context: VendorContext): SpecialVendorEntry {
  const layout = NATIVE_LAYOUTS[context.rom.idCode as keyof typeof NATIVE_LAYOUTS];
  if (!layout) throw new Error("The Day Care editor supports US BW and BW2 layouts.");
  const { daycare, daycareOverlay } = layout;
  const read = () => {
    const bytes = getOverlayWorkingBytes(context.project, context.rom, daycareOverlay);
    const stock = readU16(bytes, daycare + 6) === 0x1c41 && bytes[daycare + 9] === 0x20 && readU16(bytes, daycare + 10) === 0x4348;
    const patched = bytes[daycare + 7] === 0x21 && readU16(bytes, daycare + 8) === 0x4348 && bytes[daycare + 11] === 0x30;
    if (readU16(bytes, daycare) !== 0xb508 || readU32(bytes, daycare + 2) !== 0xffebf7ff || readU16(bytes, daycare + 12) !== 0xbd08 || (!stock && !patched)) {
      throw new Error("Unsupported Day Care fee routine.");
    }
    return { bytes, values: stock ? [bytes[daycare + 8], bytes[daycare + 8]] : [bytes[daycare + 10], bytes[daycare + 6]] };
  };
  const [base, perLevel] = read().values;
  const values = [priceValue(base, 255, "Base fee (₽)"), priceValue(perLevel, 255, "Per level gained (₽)")];
  return { label: "Day Care withdrawal", values, save(next) {
    validateValues(context.project, values, next);
    const current = read();
    if (current.values.every((value, i) => value === next[i])) return;
    const out = new Uint8Array(current.bytes);
    if (next[0] === next[1]) {
      writeU16(out, daycare + 6, 0x1c41); // adds r1, r0, #1
      writeU16(out, daycare + 8, 0x2000 | next[0]); // movs r0, #fee
      writeU16(out, daycare + 10, 0x4348); // muls r0, r1
    } else {
      writeU16(out, daycare + 6, 0x2100 | next[1]); // movs r1, #rate
      writeU16(out, daycare + 8, 0x4348); // muls r0, r1
      writeU16(out, daycare + 10, 0x3000 | next[0]); // adds r0, #base
    }
    applyOverlayBytes(context.project, context.rom, daycareOverlay, out);
    note(context.project, "Day Care withdrawal fee", values, next);
  } };
}

function collectorEntries(context: VendorContext, member: number): SpecialVendorEntry[] {
  const path = context.project.session.baseRom === "BW2" ? "a/2/0/5" : "a/2/0/8";
  const bytes = archiveMember(context, path, member);
  if (bytes.length % 8) throw new Error("Unsupported item collector price table.");
  return Array.from({ length: bytes.length / 8 }, (_, index) => {
    const offset = index * 8;
    const values = [itemValue(readU32(bytes, offset)), priceValue(readU32(bytes, offset + 4), 65535, "Payout (₽)")];
    const label = `${collectorLabels(context.project)[member]} · Offer ${index + 1}`;
    return { label, values, save(next) {
      validateValues(context.project, values, next);
      const out = new Uint8Array(archiveMember(context, path, member));
      for (let pos = 0; pos < out.length; pos += 8) {
        if (pos !== offset && readU32(out, pos) === next[0]) throw new Error("This collector already buys that item.");
      }
      writeU32(out, offset, next[0]); writeU32(out, offset + 4, next[1]);
      stageMember(context, path, member, out);
      note(context.project, label, values, next);
    } };
  });
}

function collectorLabels(project: ProjectState): string[] {
  return project.session.baseRom === "BW2" ? COLLECTOR_LABELS : BW_COLLECTOR_LABELS;
}

function funfestEntries(context: VendorContext, group: "funfest-sales" | "funfest-exchange", variant: number): SpecialVendorEntry[] {
  const overlay = 25;
  const read = () => {
    if (context.rom.idCode !== "IREO" && context.rom.idCode !== "IRDO") throw new Error("Funfest editing supports US BW2 layouts.");
    const bytes = getOverlayWorkingBytes(context.project, context.rom, overlay);
    if (bytes.length < 0xa30 || readU32(bytes, 0x72c) !== 0x0a0a0a0a || readU32(bytes, 0x730) !== 0x0a0a0a0a) throw new Error("Unsupported Funfest overlay layout.");
    return bytes;
  };
  const bytes = read();
  const sales = group === "funfest-sales";
  const count = sales ? 16 : 24;
  const stride = sales ? 4 : 2;
  const base = sales ? 0x8f0 : 0x860;
  return Array.from({ length: count }, (_, index) => {
    const offset = base + (variant * count + index) * stride;
    const values = [itemValue(readU16(bytes, offset)), ...(sales ? [priceValue(readU16(bytes, offset + 2), 59800)] : [])];
    const label = sales ? `Offer ${index + 1}` : `Pool ${1 + Math.floor(index / 6)} · Slot ${1 + index % 6}`;
    return { label, values, save(next) {
      validateValues(context.project, values, next);
      const out = new Uint8Array(read());
      next.forEach((value, i) => writeU16(out, offset + i * 2, value));
      applyOverlayBytes(context.project, context.rom, overlay, out);
      note(context.project, `Funfest ${sales ? "sales" : "exchange"} · Variant ${variant + 1} · ${label}`, values, next);
    } };
  });
}

function rewardEntries(context: VendorContext, id: number): SpecialVendorEntry[] {
  const bytes = archiveMember(context, AVENUE, REWARD_MEMBER);
  const start = id * REWARD_BYTES;
  return Array.from({ length: 10 }, (_, index) => {
    const offset = start + 4 + index * 4;
    const weight = readU16(bytes, offset);
    const total = readU16(bytes, start);
    const values = [itemValue(readU16(bytes, offset + 2), 0), { label: "Weight", value: weight, min: 0, max: 65535 }];
    const label = `Prize ${index + 1}`;
    return { label: `${label} · ${total ? Number((weight * 100 / total).toFixed(2)) : 0}%`, values, save(next) {
      validateValues(context.project, values, next);
      if (next[1] > 0 && !next[0]) throw new Error("Choose an item for a prize with positive weight.");
      const out = new Uint8Array(archiveMember(context, AVENUE, REWARD_MEMBER));
      const currentWeight = readU16(out, offset);
      const newTotal = readU16(out, start) + next[1] - currentWeight;
      if (newTotal < 1 || newTotal > 65535) throw new Error("Total weight must be from 1 to 65,535. Decrease another weight to make room.");
      writeU16(out, offset, next[1]); writeU16(out, offset + 2, next[0]); writeU16(out, start, newTotal);
      stageMember(context, AVENUE, REWARD_MEMBER, out);
      note(context.project, `Join Avenue · Table ${id} · ${label}`, values, next);
    } };
  });
}

function itemValue(value: number, min = 1): SpecialVendorValue { return { label: "Item", kind: "item", value, min, max: 65535 }; }
function priceValue(value: number, max: number, label = "Price (₽)"): SpecialVendorValue { return { label, kind: "price", value, min: 0, max }; }

function validateValues(project: ProjectState, fields: SpecialVendorValue[], values: number[]): void {
  if (values.length !== fields.length) throw new Error("Incomplete vendor offer.");
  fields.forEach(({ label, kind, min, max }, i) => {
    const value = values[i];
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
    if (kind === "item" && value > 0) validateVendorItem(project, value);
    if (kind === "species") findPokemonBaseSpeciesId(project, String(value));
  });
}

function note(project: ProjectState, label: string, fields: SpecialVendorValue[], next: number[]): void {
  fields.forEach((field, i) => recordFieldChange(project, "marts", label, field.label, field.value, next[i], { key: `special-vendor:${label}:${field.label}` }));
}

function archiveMember({ rom, project }: VendorContext, path: string, member: number): Uint8Array {
  const fileId = rom.fileId(path);
  const fastPath = Object.values(project.narcs).find((store) => store?.fileId === fileId)?.rawFiles[member];
  const contents = project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId];
  let archive = vendorArchives.get(contents);
  if (!fastPath?.length && !archive) {
    archive = new NARC(contents);
    vendorArchives.set(contents, archive);
  }
  const bytes = fastPath?.length ? fastPath : archive?.files[member];
  if (!bytes?.length) throw new Error(`Shop archive ${path} member ${member} is unavailable.`);
  return bytes;
}

function stageMember({ project, rom }: VendorContext, path: string, member: number, bytes: Uint8Array): void {
  replaceNarcFile(project, rom, rom.fileId(path), member, bytes);
}
