import { NARC } from "../nds/narc";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { followerCrc32 } from "./followingPokemonModel";

/** A private, single-member archive. Its member is loaded into the existing 4 KiB
 * conversation-rule scratch page only while an A interaction is being chosen. */
export const FOLLOWER_ITEM_NARC_PATH = "following/contextual-items.narc";
export const FOLLOWER_ITEM_ABI = 1;
export const FOLLOWER_ITEM_MAX_WORDS = 192;
export const FOLLOWER_ITEM_MAX_BYTES = 4096;
export type FollowerItemRule = {
  slot: number; itemId: number; quantity: number; itemName: string; text: string;
  zone: number; species?: number; form?: number; type?: number;
  hp?: number; friendship?: number; status?: number; facing?: number;
};
const magic = 0x49545746; // FWTI
const headerBytes = 16, ruleBytes = 28;
const int = (n: number, min: number, max: number, what: string) => {
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid follower gift ${what}.`);
};
function encodeText(text: string, allowItem: boolean): number[] {
  if (!text.trim()) throw new Error("Follower gift text is required.");
  const words: number[] = [];
  for (let at = 0; at < text.length;) {
    const token = ["{nickname}", "{player}", "{location}", ...(allowItem ? ["{item}"] : [])].find(value => text.startsWith(value, at));
    if (token) { words.push(token === "{nickname}" ? 0xfff0 : token === "{player}" ? 0xfff1 : token === "{location}" ? 0xfff2 : 0xfff3); at += token.length; continue; }
    const code = text.codePointAt(at)!;
    if (code > 0xffff || code === 0xffff || code === 0) throw new Error("Follower gift text contains an unsupported character.");
    words.push(text[at] === "\n" ? 0xfffe : code); at += code > 0xffff ? 2 : 1;
  }
  if (words.length + 1 > FOLLOWER_ITEM_MAX_WORDS) throw new Error("Follower gift text exceeds 191 characters.");
  return [...words, 0xffff];
}
function decodeText(words: number[]): string {
  return words.filter(word => word !== 0xffff).map(word => word === 0xfffe ? "\n" : word === 0xfff0 ? "{nickname}" : word === 0xfff1 ? "{player}" : word === 0xfff2 ? "{location}" : word === 0xfff3 ? "{item}" : String.fromCharCode(word)).join("");
}
export function validateFollowerItemRules(rules: FollowerItemRule[]): void {
  if (!Array.isArray(rules) || rules.length > 0xffff) throw new Error("Too many follower gift rules.");
  for (const rule of rules) {
    int(rule.slot, 0, 9, "slot");
    int(rule.itemId, 1, 0xfffe, "item"); int(rule.quantity, 1, 99, "quantity"); int(rule.zone, 0, 0xffff, "zone");
    if (rule.species !== undefined) int(rule.species, 1, 1023, "species");
    if (rule.form !== undefined) int(rule.form, 0, 255, "form");
    if (rule.form !== undefined && rule.species === undefined) throw new Error("A follower gift form needs a species selector.");
    if (rule.type !== undefined) int(rule.type, 0, 31, "type");
    if (rule.hp !== undefined) int(rule.hp, 1, 5, "HP condition");
    if (rule.friendship !== undefined) int(rule.friendship, 0, 10, "friendship condition");
    if (rule.status !== undefined) int(rule.status, 0, 8, "status condition");
    if (rule.facing !== undefined) int(rule.facing, 0, 4, "facing condition");
    encodeText(rule.itemName, false); encodeText(rule.text, true);
  }
}
export function encodeFollowerItemNarc(rules: FollowerItemRule[]): Uint8Array {
  validateFollowerItemRules(rules);
  const encoded = rules.map(rule => ({ rule, name: encodeText(rule.itemName, false), text: encodeText(rule.text, true) }));
  const size = headerBytes + encoded.length * ruleBytes + encoded.reduce((n, e) => n + (e.name.length + e.text.length) * 2, 0);
  const data = new Uint8Array(size); writeU32(data, 0, magic); writeU16(data, 4, FOLLOWER_ITEM_ABI); writeU16(data, 6, encoded.length); writeU32(data, 8, size);
  let cursor = headerBytes + encoded.length * ruleBytes;
  encoded.forEach(({ rule, name, text }, i) => {
    const at = headerBytes + i * ruleBytes;
    writeU16(data, at, rule.zone); writeU16(data, at + 2, rule.species ?? 0); writeU16(data, at + 4, rule.itemId);
    data[at + 6] = rule.slot; data[at + 7] = rule.form ?? 255; data[at + 8] = rule.type ?? 255; data[at + 9] = rule.hp ?? 0;
    data[at + 10] = rule.friendship ?? 0; data[at + 11] = rule.status ?? 0; data[at + 12] = rule.facing ?? 0; data[at + 13] = rule.quantity;
    writeU32(data, at + 14, cursor); writeU16(data, at + 18, name.length); name.forEach((w, j) => writeU16(data, cursor + j * 2, w)); cursor += name.length * 2;
    writeU32(data, at + 20, cursor); writeU16(data, at + 24, text.length); writeU16(data, at + 26, 0); text.forEach((w, j) => writeU16(data, cursor + j * 2, w)); cursor += text.length * 2;
  });
  writeU32(data, 12, followerCrc32(data.subarray(headerBytes))); const narc = new NARC(); narc.files = [data]; const bytes = narc.save();
  if (bytes.length > FOLLOWER_ITEM_MAX_BYTES) throw new Error("Follower gift archive exceeds the 4 KiB runtime limit.");
  return bytes;
}
export function decodeFollowerItemNarc(bytes: Uint8Array): FollowerItemRule[] {
  if (bytes.length > FOLLOWER_ITEM_MAX_BYTES) throw new Error("Follower gift archive exceeds the 4 KiB runtime limit.");
  const narc = new NARC(bytes); if (narc.files.length !== 1) throw new Error("Follower gift archive must have one member.");
  const data = narc.files[0];
  if (data.length < headerBytes || readU32(data, 0) !== magic || readU16(data, 4) !== FOLLOWER_ITEM_ABI || readU32(data, 8) !== data.length || readU32(data, 12) !== followerCrc32(data.subarray(headerBytes))) throw new Error("Invalid follower gift archive.");
  const count = readU16(data, 6); if (headerBytes + count * ruleBytes > data.length) throw new Error("Invalid follower gift count.");
  const floor = headerBytes + count * ruleBytes, readText = (at: number, words: number) => {
    if (!words || words > FOLLOWER_ITEM_MAX_WORDS || at % 2 || at < floor || at + words * 2 > data.length || readU16(data, at + (words - 1) * 2) !== 0xffff) throw new Error("Invalid follower gift text reference.");
    return decodeText(Array.from({ length: words }, (_, i) => readU16(data, at + i * 2)));
  };
  const rules: FollowerItemRule[] = [];
  for (let i = 0; i < count; ++i) {
    const at = headerBytes + i * ruleBytes;
    if (readU16(data, at + 26)) throw new Error("Invalid follower gift rule padding.");
    rules.push({ slot: data[at + 6], itemId: readU16(data, at + 4), quantity: data[at + 13], itemName: readText(readU32(data, at + 14), readU16(data, at + 18)), text: readText(readU32(data, at + 20), readU16(data, at + 24)), zone: readU16(data, at), ...(readU16(data, at + 2) ? { species: readU16(data, at + 2) } : {}), ...(data[at + 7] !== 255 ? { form: data[at + 7] } : {}), ...(data[at + 8] !== 255 ? { type: data[at + 8] } : {}), ...(data[at + 9] ? { hp: data[at + 9] } : {}), ...(data[at + 10] ? { friendship: data[at + 10] } : {}), ...(data[at + 11] ? { status: data[at + 11] } : {}), ...(data[at + 12] ? { facing: data[at + 12] } : {}) });
  }
  validateFollowerItemRules(rules); return rules;
}
