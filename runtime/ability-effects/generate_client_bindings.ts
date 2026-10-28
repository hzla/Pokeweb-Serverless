/** Describe whole native client imports; these helpers are never copied. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { NintendoDSRom } from "../../src/nds/rom";
import { decompressCode } from "../../src/nds/codeCompression";
import { readU16 } from "../../src/nds/binary";
import { battleRuntimeResolver, battleBranchTarget } from "../../src/pokeweb/battleRuntimeBindings";
const [input, output] = process.argv.slice(2);
if (!output) throw new Error("Usage: REFERENCE_ROM.nds OUTPUT.json");
const rom = new NintendoDSRom(new Uint8Array(await readFile(input)), { fileData: "view" });
assert(["IRDO", "IREO"].includes(rom.idCode) && rom.data[30] === 0);
const overlay = rom.loadArm9Overlays([167]).get(167)!;
const parent = battleRuntimeResolver(overlay.data, overlay.ramAddress, decompressCode(rom.arm9), rom.arm9RamAddress).resolve("IsMonTrapped");
const functions: Record<string, unknown> = {};
for (const [name, call, size] of [["MonIDToBattlePos", 24, 0x32], ["ExpandPosFlagsToMonIDs", 46, 0x54]] as const) {
  const address = battleBranchTarget(parent.code, call, parent.address), offset = address - overlay.ramAddress;
  const bytes = overlay.data.slice(offset, offset + size), mask = new Uint8Array(size).fill(255);
  assert.equal(readU16(bytes, 0), 0xb5f8); assert.equal(readU16(bytes, size - 2), 0xbdf8);
  for (let at = 0; at + 4 <= size; at += 2) if ((readU16(bytes, at) & 0xf800) === 0xf000 && [0xf800, 0xe800].includes(readU16(bytes, at + 2) & 0xf800)) { mask.fill(0, at, at + 4); at += 2; }
  functions[name] = { hex: Buffer.from(bytes).toString("hex"), mask: Buffer.from(mask).toString("hex"), calls: [], module: "167" };
}
await writeFile(output, JSON.stringify({ version: 1, functions }) + "\n");
