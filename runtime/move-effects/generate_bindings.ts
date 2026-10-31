/** Build checked BW2 move contracts from an explicit clean ROM and SDK symbol map. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { NintendoDSRom } from "../../src/nds/rom";
import { decompressCode } from "../../src/nds/codeCompression";
import { readU16, readU32 } from "../../src/nds/binary";
import { BATTLE_RUNTIME_SIGNATURES, battleBranchTarget, type BattleRuntimeSignature } from "../../src/pokeweb/battleRuntimeBindings";

const [input, symbolPath, output] = process.argv.slice(2);
assert(output, "Usage: CLEAN_WHITE2.nds SDK_IRDO.yml OUTPUT.json");
const rom = new NintendoDSRom(new Uint8Array(await readFile(input)), { fileData: "view" });
assert.equal(rom.idCode, "IRDO"); assert.equal(rom.data[30], 0);
const ov = rom.loadArm9Overlays([167]).get(167)!, arm = decompressCode(rom.arm9);
const sdk = await readFile(symbolPath, "utf8");
const symbols = new Map<string, number>();
for (const m of sdk.matchAll(/^- Address: (0x[\da-f]+)\n  Name: (\w+)\n/gmu)) {
  if (Number(m[1]) & 1 && !/^(loc_|locret_|off_|dword_|word_|byte_|unk_|def_|jpt_)/u.test(m[2])) symbols.set(m[2], Number(m[1]) & ~1);
}
const reverse = new Map([...symbols].map(([n, a]) => [a, n]));
const addresses = [...new Set(symbols.values())].sort((a, b) => a - b);
const functions: Record<string, BattleRuntimeSignature> = {};
const requested = ["MoveEvent_AddItem", "DoesMoveEventExist", "ServerEvent_CheckFloating", "CheckFieldEffect", "IsAffectedBySheerForce", "sub_21AB1BC"];
const codeAt = (address: number, size: number) => {
  const isOverlay = address >= ov.ramAddress && address < ov.ramAddress + ov.data.length;
  const bytes = isOverlay ? ov.data : arm, at = address - (isOverlay ? ov.ramAddress : rom.arm9RamAddress);
  assert(at >= 0 && at + size <= bytes.length, `Out-of-image native service ${address.toString(16)}`);
  return { bytes: bytes.slice(at, at + size), module: isOverlay ? "167" : "ARM9" };
};
// Native tables are read through the dispatcher's own literal, never a fixed overlay offset.
const dispatchAddress = symbols.get("MoveEvent_AddItem")!;
const dispatch = codeAt(dispatchAddress, 120).bytes;
assert.equal(readU16(dispatch, 0), 0xb5f0);
const nativeTable = readU32(dispatch, 108) - ov.ramAddress, count = readU32(dispatch, 112);
assert.equal(count, 258); assert(nativeTable >= 0 && nativeTable + count * 8 <= ov.data.length);
const rows = Array.from({ length: count }, (_, i) => readU32(ov.data, nativeTable + i * 8));
assert.equal(new Set(rows).size, count);
type Getter = { name: string; tableRef: number; events: Array<{ event: number; handler: string }> };
const getters: Record<number, Getter> = {};
const needed = new Set([115, 113, 215, 280, 252, 389, 114, 467, 206, 20, 162, 216, 500, 369, 379, 200, 389, 368, 136, 284]);
for (let i = 0; i < count; ++i) {
  if (!needed.has(rows[i])) continue;
  const address = readU32(ov.data, nativeTable + i * 8 + 4) & ~1;
  const name = reverse.get(address); assert(name, `Unnamed native move ${rows[i]}`);
  const code = codeAt(address, 32).bytes, regs = new Uint32Array(8); regs[0] = 0x10000;
  let events = 0, eventCount = 0, tableRef = -1;
  for (let at = 0; at < 24; at += 2) {
    const ins = readU16(code, at);
    if ((ins & 0xf800) === 0x2000) regs[ins >> 8 & 7] = ins & 255;
    else if ((ins & 0xf800) === 0x4800) {
      const literal = ((address + at + 4) & ~3) + (ins & 255) * 4;
      regs[ins >> 8 & 7] = readU32(ov.data, literal - ov.ramAddress);
      if ((ins >> 8 & 7) === 0) tableRef = literal - address;
    } else if ((ins & 0xf800) === 0x6000 && regs[ins >> 3 & 7] === 0x10000) eventCount = regs[ins & 7];
    else if (ins === 0x4770) { events = regs[0] - ov.ramAddress; break; }
    else throw Error(`Unreviewed native getter ${name}`);
  }
  assert(tableRef >= 0 && eventCount > 0 && eventCount < 16 && events >= 0);
  getters[rows[i]] = { name, tableRef, events: Array.from({ length: eventCount }, (_, j) => {
    const handler = reverse.get(readU32(ov.data, events + j * 8 + 4) & ~1);
    assert(handler, `Unnamed callback in ${name}`); requested.push(handler);
    return { event: readU32(ov.data, events + j * 8), handler };
  }) };
  requested.push(name);
}
for (const name of requested) {
  if (functions[name]) continue;
  if (BATTLE_RUNTIME_SIGNATURES[name]) {
    if (["IsAffectedBySheerForce"].includes(name)) for (const call of BATTLE_RUNTIME_SIGNATURES[name].calls) if (!requested.includes(call.target)) requested.push(call.target);
    continue;
  }
  const address = symbols.get(name); assert(address, `Missing SDK service ${name}`);
  const next = addresses.find(a => a > address)!;
  const size = name === "MoveEvent_AddItem" ? 120 : next - address;
  assert(size > 0 && size < 8192, `Unreviewed size ${name}: ${size}`);
  const { bytes, module } = codeAt(address, size), mask = new Uint8Array(size).fill(255);
  const calls: BattleRuntimeSignature["calls"] = [];
  for (let at = 0; at + 4 <= size; at += 2) {
    const hi = readU16(bytes, at), lo = readU16(bytes, at + 2);
    if ((hi & 0xf800) === 0xf000 && [0xf800, 0xe800].includes(lo & 0xf800)) {
      const target = battleBranchTarget(bytes, at, address), callee = reverse.get(target);
      assert(callee, `Unknown call ${name}+${at}: ${target.toString(16)}`);
      mask.fill(0, at, at + 4); calls.push({ offset: at, target: callee });
      // Only a copied gateway requires all its callees to be independently anchored.
      if (["MoveEvent_AddItem", "sub_21AB1BC"].includes(name) && !requested.includes(callee)) requested.push(callee);
      at += 2;
    }
  }
  for (let at = 0; at + 4 <= size; at += 2) if ((address + at) % 4 === 0 && readU32(bytes, at) >= 0x02000000 && readU32(bytes, at) < 0x02400000) mask.fill(0, at, at + 4);
  const variants = [];
  if (name === "MoveEvent_AddItem") {
    assert.equal(readU32(bytes, 112), 258);
    const fairy = bytes.slice(); new DataView(fairy.buffer).setUint32(112, 384, true);
    variants.push({ hex: Buffer.from(fairy).toString("hex"), mask: Buffer.from(mask).toString("hex") });
  }
  functions[name] = { hex: Buffer.from(bytes).toString("hex"), mask: Buffer.from(mask).toString("hex"), module, calls, ...(variants.length ? { variants } : {}) };
}
await writeFile(output, JSON.stringify({ version: 1, functions, rows, getters, tableRefs: [{ offset: 108, column: 0 }, { offset: 116, column: 4 }], countRef: 112 }) + "\n");
console.log(`${Object.keys(functions).length} native move contracts; ${Object.keys(getters).length} reviewed getters.`);
