import { NARC } from "../nds/narc";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { followerCrc32 } from "./followingPokemonModel";

export const FOLLOWER_DIALOGUE_NARC_PATH = "following/contextual-dialogues.narc";
export const FOLLOWER_DIALOGUE_ABI = 1;
export const FOLLOWER_DIALOGUE_MAX_WORDS = 192;
export const FOLLOWER_DIALOGUE_MAX_BYTES = 4096;
export type FollowerDialogueRule = {
  zone: number; species?: number; form?: number; type?: number;
  hp?: number; friendship?: number; status?: number; facing?: number; chance?: number;
  text: string;
};

const magic = 0x44435746; // FWCD
const headerBytes = 16, ruleBytes = 20;
const checkInt = (value: number, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid dialogue ${label}.`);
};
function encodeText(text: string): number[] {
  if (!text.trim()) throw new Error("Conditional dialogue needs text.");
  const words: number[] = [];
  for (let at = 0; at < text.length;) {
    const token = ["{nickname}", "{player}", "{location}"].find(value => text.startsWith(value, at));
    if (token) { words.push(token === "{nickname}" ? 0xfff0 : token === "{player}" ? 0xfff1 : 0xfff2); at += token.length; continue; }
    const code = text.codePointAt(at)!;
    if (code > 0xffff || code === 0xffff || code === 0) throw new Error("Dialogue contains an unsupported character.");
    words.push(text[at] === "\n" ? 0xfffe : code); at += code > 0xffff ? 2 : 1;
  }
  if (words.length + 1 > FOLLOWER_DIALOGUE_MAX_WORDS) throw new Error("Conditional dialogue exceeds 191 characters.");
  return [...words, 0xffff];
}
function decodeText(words: number[]): string {
  return words.filter(word => word !== 0xffff).map(word => word === 0xfffe ? "\n" : word === 0xfff0 ? "{nickname}" : word === 0xfff1 ? "{player}" : word === 0xfff2 ? "{location}" : String.fromCharCode(word)).join("");
}
export function validateFollowerDialogueRules(rules: FollowerDialogueRule[]): void {
  if (!Array.isArray(rules) || rules.length > 0xffff) throw new Error("Too many conditional dialogue rules.");
  for (const rule of rules) {
    checkInt(rule.zone, 0, 0xffff, "zone");
    if (rule.species !== undefined) checkInt(rule.species, 1, 1023, "species");
    if (rule.form !== undefined) checkInt(rule.form, 0, 255, "form");
    if (rule.form !== undefined && rule.species === undefined) throw new Error("A form selector needs a species selector.");
    if (rule.type !== undefined) checkInt(rule.type, 0, 31, "type");
    if (rule.hp !== undefined) checkInt(rule.hp, 1, 5, "HP condition");
    if (rule.friendship !== undefined) checkInt(rule.friendship, 0, 10, "friendship condition");
    if (rule.status !== undefined) checkInt(rule.status, 0, 8, "status condition");
    if (rule.facing !== undefined) checkInt(rule.facing, 0, 4, "facing condition");
    if (rule.chance !== undefined) checkInt(rule.chance, 1, 100, "chance");
    encodeText(rule.text);
  }
}
/** A single-member NARC keeps editable follower dialogue isolated from stock message archives. */
export function encodeFollowerDialogueNarc(rules: FollowerDialogueRule[]): Uint8Array {
  validateFollowerDialogueRules(rules);
  const encoded = rules.map(rule => ({ rule, words: encodeText(rule.text) }));
  const size = headerBytes + encoded.length * ruleBytes + encoded.reduce((sum, item) => sum + item.words.length * 2, 0);
  const data = new Uint8Array(size), view = new DataView(data.buffer);
  writeU32(data, 0, magic); writeU16(data, 4, FOLLOWER_DIALOGUE_ABI); writeU16(data, 6, encoded.length); writeU32(data, 8, size);
  let textAt = headerBytes + encoded.length * ruleBytes;
  encoded.forEach(({ rule, words }, index) => {
    const at = headerBytes + index * ruleBytes;
    writeU16(data, at, rule.zone); writeU16(data, at + 2, rule.species ?? 0);
    data[at + 4] = rule.form ?? 255; data[at + 5] = rule.type ?? 255;
    data[at + 6] = rule.hp ?? 0; data[at + 7] = rule.friendship ?? 0; data[at + 8] = rule.status ?? 0; data[at + 9] = rule.facing ?? 0;
    data[at + 10] = rule.chance ?? 100; data[at + 11] = 0; writeU32(data, at + 12, textAt); writeU16(data, at + 16, words.length); writeU16(data, at + 18, 0);
    words.forEach((word, wordIndex) => writeU16(data, textAt + wordIndex * 2, word)); textAt += words.length * 2;
  });
  writeU32(data, 12, followerCrc32(data.subarray(16)));
  const narc = new NARC(); narc.files = [data]; const bytes = narc.save();
  if (bytes.length > FOLLOWER_DIALOGUE_MAX_BYTES) throw new Error("Conditional dialogue archive exceeds the 4 KiB runtime limit.");
  return bytes;
}
export function decodeFollowerDialogueNarc(bytes: Uint8Array): FollowerDialogueRule[] {
  if (bytes.length > FOLLOWER_DIALOGUE_MAX_BYTES) throw new Error("Follower dialogue archive exceeds the 4 KiB runtime limit.");
  const narc = new NARC(bytes); if (narc.files.length !== 1) throw new Error("Follower dialogue archive must have one member.");
  const data = narc.files[0], view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < headerBytes || readU32(data, 0) !== magic || readU16(data, 4) !== FOLLOWER_DIALOGUE_ABI || readU32(data, 8) !== data.length || readU32(data, 12) !== followerCrc32(data.subarray(16))) throw new Error("Invalid follower dialogue archive.");
  const count = readU16(data, 6); if (headerBytes + count * ruleBytes > data.length) throw new Error("Invalid follower dialogue rule count.");
  const rules: FollowerDialogueRule[] = [];
  for (let i = 0; i < count; ++i) {
    const at = headerBytes + i * ruleBytes, textAt = readU32(data, at + 12), words = readU16(data, at + 16);
    if (!words || words > FOLLOWER_DIALOGUE_MAX_WORDS || textAt % 2 || textAt < headerBytes + count * ruleBytes || textAt + words * 2 > data.length || readU16(data, textAt + (words - 1) * 2) !== 0xffff || data[at + 11] || readU16(data, at + 18)) throw new Error("Invalid follower dialogue text reference.");
    const textWords = Array.from({ length: words }, (_, j) => view.getUint16(textAt + j * 2, true));
    rules.push({ zone: readU16(data, at), ...(readU16(data, at + 2) ? { species: readU16(data, at + 2) } : {}), ...(data[at + 4] !== 255 ? { form: data[at + 4] } : {}), ...(data[at + 5] !== 255 ? { type: data[at + 5] } : {}), ...(data[at + 6] ? { hp: data[at + 6] } : {}), ...(data[at + 7] ? { friendship: data[at + 7] } : {}), ...(data[at + 8] ? { status: data[at + 8] } : {}), ...(data[at + 9] ? { facing: data[at + 9] } : {}), ...(data[at + 10] !== 100 ? { chance: data[at + 10] } : {}), text: decodeText(textWords) });
  }
  validateFollowerDialogueRules(rules); return rules;
}
