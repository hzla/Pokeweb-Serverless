import assert from "node:assert/strict";
import { readU16, readU32, writeU16, writeU32 } from "../../src/nds/binary";
import { gen5ScriptEntries } from "../../src/pokeweb/gen5ScriptCommands";
import { decodeGen5TextBank, encodeGen5TextBank } from "../../src/pokeweb/text";

import { refreshTestBattleSaveBlockChecksum } from "../../src/pokeweb/testBattle";

export const LEADERS = [
  "cheren", "roxie", "burgh", "elesa", "clay", "skyla", "drayden", "marlon",
] as const;
export const LEADER_PORTRAIT = 5;
export const LEADER_PANEL_WIDTH = 160;
export const LEADER_PANEL_X = 256 - 8 - LEADER_PANEL_WIDTH;
export const LEADER_ROW = 741;

export function addLeaderEvents(events: Uint8Array, script: Uint8Array, textBank: Uint8Array, portraitOpcode: number) {
  const entries = gen5ScriptEntries(script);
  assert.equal(entries.length, 33);
  const texts = decodeGen5TextBank(textBank);
  assert.equal(readU16(textBank, 0), 1);
  const originalMessages = [...texts];
  const leaders = LEADERS.map((name, i) => ({
    name, npc: 14 + i, sprite: 223 + i, gridX: 39 + i * 2, gridZ: LEADER_ROW,
    message: texts.length + i, portrait: LEADER_PORTRAIT + i, script: entries.length + i + 1, text: `Test ${i + 1}`,
  }));

  const firstNpc = 8 + events[4] * 20;
  const npcEnd = firstNpc + events[5] * 36;
  const addedNpcBytes = leaders.length * 36;
  const newEvents = new Uint8Array(events.length + addedNpcBytes);
  newEvents.set(events.subarray(0, npcEnd));
  newEvents.set(events.subarray(npcEnd), npcEnd + addedNpcBytes);
  newEvents[5] += leaders.length;
  writeU32(newEvents, 0, readU32(events, 0) + addedNpcBytes);
  const usedNpcIds = new Set(Array.from({ length: events[5] }, (_, i) => readU16(events, firstNpc + i * 36)));

  const scripts = leaders.map(leader => [
    0x2e, 0xa6, 0x0547, 0x74,
    portraitOpcode, leader.portrait, 0x3d, 0x0400, leader.message, 2, 0,
    0x32, 0x3e, portraitOpcode, 0, 0x30, 0x2f, 2,
  ]);
  const tableEnd = entries.length * 4;
  const tableGrowth = leaders.length * 4;
  let code = (script.length + tableGrowth + 1) & ~1;
  const newScript = new Uint8Array(code + scripts.reduce((n, words) => n + words.length * 2, 0));
  newScript.set(script.subarray(tableEnd), tableEnd + tableGrowth);
  entries.forEach((target, i) => writeU32(newScript, i * 4, target + tableGrowth - (i * 4 + 4)));

  leaders.forEach((leader, i) => {
    assert(!usedNpcIds.has(leader.npc));
    const npc = npcEnd + i * 36;
    for (const [offset, value] of [
      [0, leader.npc], [2, leader.sprite], [10, leader.script], [12, 1],
      [28, leader.gridX], [30, leader.gridZ], [34, 1],
    ]) writeU16(newEvents, npc + offset, value);
    const pointer = tableEnd + i * 4;
    writeU32(newScript, pointer, code - (pointer + 4));
    for (const word of scripts[i]) {
      writeU16(newScript, code, word);
      code += 2;
    }
    texts.push([`0_${leader.message}`, leader.text, 0]);
  });
  const newEntries = gen5ScriptEntries(newScript);
  assert.equal(newEntries.length, entries.length + leaders.length);
  assert.deepEqual(newEntries.slice(0, entries.length), entries.map(target => target + tableGrowth));
  const newTextBank = encodeGen5TextBank(texts);
  const reloadedText = decodeGen5TextBank(newTextBank);
  assert.deepEqual(reloadedText.map(entry => entry.slice(0, 2)), [...originalMessages, ...texts.slice(originalMessages.length)].map(entry => entry.slice(0, 2)));
  return { newEvents, newScript, newTextBank, leaders };
}

// On continue, White 2 restores this zone's actor snapshot from the test save.
// Use free records so all actors in the copied retail fixture survive startup.
export function seedLeaderActors(
  save: Uint8Array, layout: Parameters<typeof refreshTestBattleSaveBlockChecksum>[1], half: number, zone: number,
  leaders: ReturnType<typeof addLeaderEvents>["leaders"],
) {
  const block = 0x1e200, length = 0x1400, recordSize = 80;
  const start = half + block;
  const free: number[] = [];
  for (let record = start; record < start + length; record += recordSize) {
    if (!(readU32(save, record) & 1)) free.push(record);
  }
  assert(free.length >= leaders.length, "Actor save block has no room for the lineup");
  leaders.forEach((leader, index) => {
    const record = free[index];
    save.fill(0, record, record + recordSize);
    writeU32(save, record, 3);
    save.set([1, 1], record + 4);
    save[record + 8] = leader.npc;
    save.set([1, 1, 1], record + 12); // Current, previous and initial facing down.
    for (const [offset, value] of [
      [16, zone], [18, leader.sprite], [24, leader.script],
      [32, leader.gridX], [36, leader.gridZ], [38, leader.gridX], [42, leader.gridZ],
    ]) writeU16(save, record + offset, value);
    writeU32(save, record + 44, 0xf);
  });
  refreshTestBattleSaveBlockChecksum(save, layout, half, block, length, 0x1f602, 41);
}
