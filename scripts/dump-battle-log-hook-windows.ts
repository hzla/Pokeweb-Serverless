import { readFile } from "node:fs/promises";
import { decompressCode } from "../src/nds/codeCompression";
import { NintendoDSRom } from "../src/nds/rom";

const [romPath, version] = process.argv.slice(2);
if (!romPath || (version !== "B2" && version !== "W2")) {
  throw new Error("Usage: vite-node scripts/dump-battle-log-hook-windows.ts ROM.nds B2|W2");
}

const addresses = version === "W2"
  ? [[0, 0x02009f0c], [167, 0x0219ca88], [167, 0x021a8a64], [167, 0x021ae36c], [207, 0x021b6f32], [207, 0x021b6f48]] as const
  : [[0, 0x02009ee0], [167, 0x0219ca48], [167, 0x021a8a24], [167, 0x021ae32c], [207, 0x021b6ef2], [207, 0x021b6f08]] as const;
const rom = new NintendoDSRom(new Uint8Array(await readFile(romPath)));
const overlays = rom.loadArm9Overlays([167, 207]);
for (const [overlayId, address] of addresses) {
  const original = overlayId === 0 ? undefined : overlays.get(overlayId);
  const data = overlayId === 0 ? decompressCode(rom.arm9) : original?.data;
  const base = overlayId === 0 ? rom.arm9RamAddress : original?.ramAddress;
  if (!data || base === undefined) throw new Error(`Missing module ${overlayId}`);
  const offset = address - base;
  console.log(`${overlayId === 0 ? "ARM9" : overlayId} 0x${address.toString(16)} ${Buffer.from(data.subarray(offset, offset + 24)).toString("hex")}`);
}
