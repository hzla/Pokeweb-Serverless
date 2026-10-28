/** Test-only Black 2 port of the direct-battle launcher, checked against both ROMs. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NintendoDSRom } from "../../src/nds/rom";
import { decompressCode } from "../../src/nds/codeCompression";
import { readU16, readU32, writeU32 } from "../../src/nds/binary";
import { configureHarnessRuntime } from "../../src/pokeweb/battleHarness";
import { parseRpm, writeRpm } from "../../src/pokeweb/rpm";

export async function black2CompatibilityHarness(black2: NintendoDSRom, white2Path: string, trainer: number, rule: number) {
  const white2 = new NintendoDSRom(new Uint8Array(await readFile(white2Path)), { fileData: "view" });
  assert.equal(white2.idCode, "IRDO"); assert.equal(black2.idCode, "IREO");
  assert.equal(white2.data[30], 0); assert.equal(black2.data[30], 0);
  const ids = [11, 12, 166, 167], wo = white2.loadArm9Overlays(ids), bo = black2.loadArm9Overlays(ids);
  const pairs = [{ id: "ARM9", wb: white2.arm9RamAddress, bb: black2.arm9RamAddress, w: decompressCode(white2.arm9), b: decompressCode(black2.arm9) }, ...ids.map(id => ({ id: String(id), wb: wo.get(id)!.ramAddress, bb: bo.get(id)!.ramAddress, w: wo.get(id)!.data, b: bo.get(id)!.data }))];
  const source = await readFile(new URL("../battle-harness/boot.c", import.meta.url), "utf8");
  const addresses = new Set([...source.matchAll(/0x02[0-3][\da-f]{5}/giu)].map(m => Number(m[0])));
  addresses.add(0x0215a790); addresses.add(0x021ce9e4);
  const mapping = new Map<number, number>();
  for (const raw of addresses) {
    const address = raw & ~1;
    if ([0x0219d6e0, 0x021d6d20].includes(address)) {
      const pair = pairs.find(p => p.id === (address === 0x0219d6e0 ? "166" : "167"))!;
      for (let at = 0; at < 32; at += 4) {
        const old = readU32(pair.w, address - pair.wb + at), next = readU32(pair.b, address - 0x40 - pair.bb + at);
        assert(old === next || old >= 0x02100000 && old < 0x02400000 && old - next === 0x40, "Changed native procedure table");
      }
      mapping.set(raw, raw - 0x40); continue;
    }
    const candidates: number[] = [];
    for (const pair of pairs) {
      const at = address - pair.wb;
      if (at < 0 || at + 16 > pair.w.length) continue;
      const code = pair.w.slice(at, at + 16), mask = new Uint8Array(16).fill(255);
      for (let i = 0; i + 4 <= code.length; i += 2) {
        if ((readU16(code, i) & 0xf800) === 0xf000 && [0xf800, 0xe800].includes(readU16(code, i + 2) & 0xf800)) mask.fill(0, i, i + 4);
        if ((address + i) % 4 === 0 && readU32(code, i) >= 0x02000000 && readU32(code, i) < 0x02400000) mask.fill(0, i, i + 4);
      }
      if (!mask.some(v => v)) continue;
      for (let dest = address - 128; dest <= address + 128; dest += 2) {
        const offset = dest - pair.bb;
        if (offset >= 0 && offset + 16 <= pair.b.length && code.every((v, i) => (v & mask[i]) === (pair.b[offset + i] & mask[i]))) candidates.push(dest | (raw & 1));
      }
    }
    const choices = [...new Set(candidates)];
    // The four battle-setup routines share a prologue; their native stride is unchanged.
    if (raw === 0x0201828d) { assert(choices.includes(raw)); mapping.set(raw, raw); }
    else { assert.equal(choices.length, 1, `Ambiguous native harness address ${raw.toString(16)}`); mapping.set(raw, choices[0]); }
  }
  const bytes = configureHarnessRuntime(new Uint8Array(await readFile(new URL("../../src/assets/testbattle/BattleHarnessW2.dll", import.meta.url))), trainer, rule);
  const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
  for (let at = 0; at + 4 <= rpm.code.length; at += 4) {
    const target = mapping.get(readU32(rpm.code, at)); if (target !== undefined) writeU32(rpm.code, at, target);
  }
  for (const symbol of rpm.symbols) if (symbol.attributes & 4 && mapping.has(symbol.address)) symbol.address = mapping.get(symbol.address)!;
  for (const relocation of rpm.relocations) if (relocation.target.module !== "base") {
    const next = mapping.get(relocation.target.address); assert(next !== undefined, "Unreviewed native harness hook"); relocation.target.address = next;
  }
  rpm.metadata.PMCGameID = "B2";
  return { bytes: writeRpm(rpm, { ident: "DLXF" }), addresses: [...mapping].map(([white, black]) => ({ white, black })) };
}
