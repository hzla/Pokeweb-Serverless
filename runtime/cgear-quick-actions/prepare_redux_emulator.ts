// Generate a separate quick-launch fixture from a patched ROM and the bundled save.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { NintendoDSRom } from "../../src/nds/rom";
import { NARC } from "../../src/nds/narc";
import { buildQuickLaunchDownloads, getTestBattleConfigForProject, patchTestBattleSaveBadges } from "../../src/pokeweb/testBattle";
import { getCGearQuickActionsStatus } from "../../src/pokeweb/cgearQuickActionsModel";
import { getPokenavStatus } from "../../src/pokeweb/pokenavModel";

const [input, directory] = process.argv.slice(2);
if (!input || !directory) throw new Error("Usage: vite-node runtime/cgear-quick-actions/prepare_redux_emulator.ts PATCHED.nds NEW_DIRECTORY");
globalThis.fetch = async input => {
  const url = input instanceof URL ? input : new URL(String(input));
  if (url.protocol !== "file:") throw new Error("Local fixture assets only.");
  return new Response(new Uint8Array(await readFile(url)));
};
const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(input)), "redux.nds", { selectedNarcs: ["message_texts"] });
if (getCGearQuickActionsStatus(project).romProfile !== "redux" || !getPokenavStatus(project).installed) throw new Error("Install the Redux adapter and Pokenav first.");
const downloads = await buildQuickLaunchDownloads(project);
const fixture = Buffer.from(patchTestBattleSaveBadges(downloads.saveBytes, getTestBattleConfigForProject(project)));
const rom = new NintendoDSRom(downloads.romBytes, { fileData: "view" });
const headers = Buffer.from(new NARC(rom.getFileByName("a/0/1/2")).files[0]!);
const crc = (data: Uint8Array) => {
  let value = 0xffff;
  for (const byte of data) { value ^= byte << 8; for (let bit = 0; bit < 8; ++bit) value = ((value & 0x8000) ? (value << 1) ^ 0x1021 : value << 1) & 0xffff; }
  return value;
};
for (const half of [0, 0x26000]) {
  // Use the header's authored spawn; native field code determines the active
  // zone at this matrix position. No encounter tables are authored.
  const zone = 427, row = zone * 48, x = headers.readInt32LE(row + 36), y = headers.readInt32LE(row + 40), z = headers.readInt32LE(row + 44);
  fixture.writeUInt32LE(zone, half + 0x19580); fixture.fill(0, half + 0x19584, half + 0x19590);
  const start = half + 0x19500; fixture.fill(0, start, start + 28); fixture.writeUInt32LE(1, start);
  fixture.writeUInt16LE(zone, start + 4); fixture.writeInt16LE(-1, start + 6); fixture.writeInt16LE(2, start + 8);
  for (const [at, value] of [[start+16,(x+.5)*65536],[start+20,y*65536],[start+24,(z+.5)*65536],
    [half+0x19584,(x+.5)*65536],[half+0x19588,y*65536],[half+0x1958c,(z+.5)*65536]]) fixture.writeUInt32LE(value, at);
  const positionCrc = crc(fixture.subarray(half + 0x19500, half + 0x195a8));
  fixture.writeUInt16LE(positionCrc, half + 0x195aa); fixture.writeUInt16LE(positionCrc, half + 0x25f38);
  // C-Gear obtained, wireless off, PC visible; story prerequisites affect only this fixture.
  fixture[half + 0x1c02f] = 1; fixture[half + 0x1c02e] = 0;
  const cgearCrc = crc(fixture.subarray(half + 0x1c000, half + 0x1c094));
  fixture.writeUInt16LE(cgearCrc, half + 0x1c096); fixture.writeUInt16LE(cgearCrc, half + 0x25f40);
  const flagBase = half + 0x1ff00 + 0x35e;
  fixture[flagBase + (1517 >> 3)]! &= ~(1 << (1517 & 7));
  for (const flag of [0x960,0x961,0x962]) fixture[flagBase + (flag >> 3)]! |= 1 << (flag & 7);
  const eventCrc = crc(fixture.subarray(half + 0x1ff00, half + 0x203e0));
  fixture.writeUInt16LE(eventCrc, half + 0x203e2); fixture.writeUInt16LE(eventCrc, half + 0x25f5a);
  fixture.writeUInt16LE(crc(fixture.subarray(half + 0x25f00, half + 0x25f94)), half + 0x25fa2);
}
const out = resolve(directory); await mkdir(out);
await writeFile(join(out, "test.nds"), downloads.romBytes, { flag: "wx" });
await writeFile(join(out, "test.sav"), fixture, { flag: "wx" });
console.log("Created isolated overworld fixture with the Redux adapter, PC and Pokenav; wireless off.");
