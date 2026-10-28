/** Local reference inputs are explicit and never written into the output. */
import { readFile, writeFile } from "node:fs/promises";
import { NintendoDSRom } from "../../src/nds/rom";
import { decompressCode } from "../../src/nds/codeCompression";
import { readU16, readU32 } from "../../src/nds/binary";
const [romPath, overlaySymbols, arm9Symbols, output] = process.argv.slice(2);
if (!output) throw new Error("Usage: ROM.nds OVERLAY_SYMBOLS ARM9_SYMBOLS OUTPUT.json");
const rom = new NintendoDSRom(new Uint8Array(await readFile(romPath)), { fileData: "view" }), overlay = rom.loadArm9Overlays([167]).get(167)!;
const symbols = new Map<string, { address: number; size: number; module: string }>();
for (const [path, module] of [[overlaySymbols, "167"], [arm9Symbols, "ARM9"]]) {
  const text = await readFile(path, "utf8");
  for (const match of text.matchAll(/^(\w+) kind:function\(thumb,size=(0x[\da-f]+)\) addr:(0x[\da-f]+)/gmu))
    symbols.set(match[1], { size: Number(match[2]), address: Number(match[3]), module });
}
const reverse = new Map([...symbols].map(([name, value]) => [value.address, name]));
const names = ["GetMonID", "RawBattleMonStat", "BattleEvent_AddItem", "GetBattleMonStat", "ServerEvent_GetWeather", "BtlServerFlow_IsSimulating", "PML_MoveGetCategory", "CommonGemDecide"];
const functions: Record<string, unknown> = {};
for (const name of names) {
  const symbol = symbols.get(name)!;
  const data = symbol.module === "167" ? overlay.data : decompressCode(rom.arm9), base = symbol.module === "167" ? overlay.ramAddress : rom.arm9RamAddress;
  const bytes = data.slice(symbol.address - base, symbol.address - base + symbol.size), mask = new Uint8Array(bytes.length).fill(255);
  const calls: Array<{ offset: number; target: string }> = [];
  for (let at = 0; at + 4 <= bytes.length; at += 2) {
    const high = readU16(bytes, at), low = readU16(bytes, at + 2);
    if ((high & 0xf800) === 0xf000 && [0xf800, 0xe800].includes(low & 0xf800)) {
      let delta = (high & 0x7ff) << 12 | (low & 0x7ff) << 1;
      if (delta & 0x400000) delta -= 0x800000;
      calls.push({ offset: at, target: reverse.get(symbol.address + at + 4 + delta) ?? "" });
      mask.fill(0, at, at + 4);
    }
  }
  for (let at = 0; at + 4 <= bytes.length; at += 2) if ((symbol.address + at) % 4 === 0 && readU32(bytes, at) >= 0x02000000 && readU32(bytes, at) < 0x02400000) mask.fill(0, at, at + 4);
  functions[name] = { hex: Buffer.from(bytes).toString("hex"), mask: Buffer.from(mask).toString("hex"), calls, module: symbol.module };
}
await writeFile(output, JSON.stringify({ version: 1, functions }) + "\n");
console.log(`${names.length} verified service signatures generated.`);
