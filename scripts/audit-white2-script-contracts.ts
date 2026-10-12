import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../src/nds/rom';
import { readU16, readU32 } from '../src/nds/binary';
import { decompressCode } from '../src/nds/codeCompression';
import { NARC } from '../src/nds/narc';
import { gen5ScriptCommandOffsets } from '../src/pokeweb/gen5ScriptCommands';
import { BW2_OVERLAY_COMMAND_BYTES } from '../src/pokeweb/gen5ScriptOverlayCommands';
import { TRANSLATION_GAMES, translationSourceGame } from '../src/pokeweb/translationProfile';
const [romPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error('Usage: audit-white2-script-contracts.ts CLEAN_US_WHITE2.nds OUTPUT.json');
const bytes = new Uint8Array(await readFile(romPath));
const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
const rom = new NintendoDSRom(bytes, { fileData: 'view' });
const game = translationSourceGame(rom.idCode); assert(game);
assert.equal(sourceSha256, TRANSLATION_GAMES[game].sourceSha256);
const overlays = rom.loadArm9Overlays([12, 27, 33, 36]);
const field = overlays.get(12)!;
const arm9 = decompressCode(rom.arm9);
const handlers: Record<number, { address: number; segment: string }> = {};
for (let opcode = 0; opcode < 0x2f3; opcode++) {
  const address = readU32(field.data, 0x1b178 + opcode * 4);
  if (!address) continue;
  const pointer = address & ~1;
  const matches = [...overlays].filter(([, overlay]) => pointer >= overlay.ramAddress && pointer < overlay.ramAddress + overlay.data.length);
  const segment = pointer >= rom.arm9RamAddress && pointer < rom.arm9RamAddress + arm9.length ? 'arm9' : matches.length === 1 ? `overlay/arm9/${matches[0][0]}` : 'unresolved';
  handlers[opcode] = { address, segment };
}
const globalRanges: { start: number; end: number; member: number; bank: number }[] = [];
// The shared-script table and command dispatcher are pinned to the verified US revision.
for (let at = 109598 - 80; at < 109598 + 800; at += 10) {
  const [start, end, member, arc, bank] = Array.from({ length: 5 }, (_, i) => readU16(field.data, at + i * 2));
  if (start >= 2000 && start <= 12209 && end >= start && member >= 1230 && member < 1289 && arc === 3 && bank < 676) globalRanges.push({ start, end, member, bank });
}
assert(globalRanges.some(row => row.member === 1281 && row.bank === 436));
const zoneOverlays: Record<number, number> = {};
const overlayHandlers: Record<number, Record<number, number>> = {};
for (let at = 114176; at <= 114476; at += 20) {
  const zones = readU32(field.data, at + 4) - field.ramAddress;
  const count = readU32(field.data, at + 8), overlay = readU32(field.data, at + 12);
  assert(count <= 100 && overlay >= 50 && overlay <= 68 && zones >= 0 && zones + count * 2 <= field.data.length);
  for (let i = 0; i < count; i++) zoneOverlays[readU16(field.data, zones + i * 2)] = overlay;
  const native = rom.loadArm9Overlays([overlay]).get(overlay)!;
  const table = readU32(field.data, at) - native.ramAddress;
  overlayHandlers[overlay] = {};
  for (let index = 0; index < (BW2_OVERLAY_COMMAND_BYTES[overlay]?.length ?? 0); index++) {
    const pointer = readU32(native.data, table + index * 4);
    if (pointer) overlayHandlers[overlay][1000 + index] = pointer;
  }
}
const sharedOverlays = { 1231: 65, 1276: 65, 1277: 55, 1278: 55, 1279: 55, 1280: 58, 1281: 61, 1284: 62, 1288: 64 };
const scripts = new NARC(rom.getFileByName('a/0/5/6')), headers = new NARC(rom.getFileByName('a/0/1/2')).files[0];
const movementOpcodes = new Set<number>(), workVariables = new Set<number>();
for (let member = 0; member < scripts.files.length; member++) {
  const bytes = scripts.files[member];
  const overlayId = (sharedOverlays as Record<number, number>)[member] ?? Array.from({ length: headers.length / 48 }, (_, map) => map).filter(map => readU16(headers, map * 48 + 6) === member).map(map => zoneOverlays[map]).find(id => id !== undefined);
  for (const at of gen5ScriptCommandOffsets(bytes, 'BW2', { overlayId })) {
    const opcode = readU16(bytes, at);
    if (opcode >= 0x26 && opcode <= 0x2d) workVariables.add(readU16(bytes, at + 2));
    if (opcode !== 0x64) continue;
    let target = at + 8 + (readU32(bytes, at + 4) | 0);
    const moves: number[] = [];
    for (let count = 0; count < 4096 && target >= 0 && target + 4 <= bytes.length; count++, target += 4) {
      const move = readU16(bytes, target); moves.push(move);
      if (move === 0xfe) { for (const move of moves) movementOpcodes.add(move); break; }
    }
  }
}
await writeFile(outputPath, JSON.stringify({ schemaVersion: 1, sourceSha256, globalRanges, zoneOverlays, sharedOverlays, handlers, overlayHandlers,
  movementOpcodes: [...movementOpcodes].sort((a, b) => a - b), workVariables: [...workVariables].sort((a, b) => a - b) }, null, 2) + '\n');
console.log(JSON.stringify({ globalRanges: globalRanges.length, zones: Object.keys(zoneOverlays).length, handlers: Object.keys(handlers).length, unresolvedHandlers: Object.values(handlers).filter(row => row.segment === 'unresolved').length }));
