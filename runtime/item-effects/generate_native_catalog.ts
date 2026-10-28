/** Generate checked native item-code dependencies from explicit local inputs. */
import { readFile, writeFile } from "node:fs/promises";
import profiles from "../../src/assets/data/itemEffectProfiles.json";
import { NintendoDSRom } from "../../src/nds/rom";
import { decompressCode } from "../../src/nds/codeCompression";
import { readU16, readU32 } from "../../src/nds/binary";

const [input, overlaySymbols, armSymbols, output] = process.argv.slice(2);
if (!output) throw new Error("Usage: INPUT.nds OVERLAY_SYMBOLS ARM9_SYMBOLS OUTPUT.json");
const rom = new NintendoDSRom(new Uint8Array(await readFile(input)), { fileData: "view" });
const overlay = rom.loadArm9Overlays([167]).get(167)!;
type Symbol = { address: number; size: number; module: string; thumb: boolean };
const symbols = new Map<string, Symbol>();
for (const [path, module] of [[overlaySymbols, "167"], [armSymbols, "ARM9"]]) {
  const text = await readFile(path, "utf8");
  for (const m of text.matchAll(/^(\w+) kind:function\((thumb|arm),size=(0x[\da-f]+)\) addr:(0x[\da-f]+)/gmu))
    symbols.set(m[1], { address: Number(m[4]), size: Number(m[3]), module, thumb: m[2] === "thumb" });
}
const addresses = new Map([...symbols].map(([name, symbol]) => [symbol.address, name]));
const start = symbols.get("ItemEvent_AddItemCore")!.address;
const endSymbol = symbols.get("HandlerGemEnd")!, end = endSymbol.address + endSymbol.size;
const arm = decompressCode(rom.arm9);
const functions: Record<string, { hex: string; mask: string; module: string; thumb: boolean; clone: boolean; calls: Array<{ offset: number; target: string }>; tails: Array<{ offset: number; target: string }>; veneer?: { offset: number; target: string; inline: boolean } }> = {};
const overrides = new Set(["CommonGetItemParam", "ItemEvent_PushRun", "BattleHandler_PushWork", "BattleHandler_PopWork", "BattleHandler_PushRun", "BattleEventItem_SetRecallEnable", "BattleEventItem_ConvertToIsolated", "BattleEventItem_IsIsolated"]);
function describe(name: string): void {
  if (functions[name]) return;
  const symbol = symbols.get(name);
  if (!symbol) throw new Error(`Missing native symbol ${name}`);
  const data = symbol.module === "167" ? overlay.data : arm;
  const base = symbol.module === "167" ? overlay.ramAddress : rom.arm9RamAddress;
  const isVeneer = symbol.thumb && symbol.size === 2 && readU16(data, symbol.address - base) === 0x4778;
  const body = data.slice(symbol.address - base, symbol.address - base + (isVeneer ? 8 : symbol.size));
  const mask = new Uint8Array(body.length).fill(255);
  const owned = symbol.module === "167" && symbol.address >= start && symbol.address < end;
  const calls: Array<{ offset: number; target: string }> = [], tails: Array<{ offset: number; target: string }> = [];
  let veneer: { offset: number; target: string; inline: boolean } | undefined;
  if (isVeneer) {
    const instruction = readU32(body, 4);
    const inline = (instruction >>> 24) !== 0xea;
    const target = addresses.get(inline ? symbol.address + 4 : symbol.address + 12 + (instruction << 8 >> 6));
    if (!target) throw new Error(`Unknown native veneer destination: ${name}`);
    veneer = { offset: 4, target, inline }; if (!inline) mask.fill(0, 4, 7);
  }
  if (symbol.thumb) for (let at = 0; at + 4 <= body.length; at += 2) {
    const high = readU16(body, at), low = readU16(body, at + 2);
    if ((high & 0xf800) === 0xf000 && [0xf800, 0xe800].includes(low & 0xf800)) {
      let delta = (high & 0x7ff) << 12 | (low & 0x7ff) << 1;
      if (delta & 0x400000) delta -= 0x800000;
      let target = symbol.address + at + 4 + delta;
      if ((low & 0xf800) === 0xe800) target &= ~3;
      const targetName = addresses.get(target);
      if (!targetName && owned) throw new Error(`Unknown native branch in ${name}+${at.toString(16)} to ${target.toString(16)}`);
      if (targetName) calls.push({ offset: at, target: targetName });
      mask.fill(0, at, at + 4); at += 2;
    }
  }
  // Branch operands and absolute literals may move; opcode/register bits stay checked.
  for (let at = 0; at + 4 <= body.length; at += 2) if ((symbol.address + at) % 4 === 0 && readU32(body, at) >= 0x02000000 && readU32(body, at) < 0x02400000) mask.fill(0, at, at + 4);
  if (owned && symbol.thumb) for (let at = 0; at + 2 <= symbol.size; at += 2) {
    const instruction = readU16(body, at);
    if ((instruction & 0xf800) !== 0xe000) continue;
    let delta = (instruction & 0x7ff) << 1;
    if (delta & 0x800) delta -= 0x1000;
    const target = symbol.address + at + 4 + delta;
    if (target >= symbol.address && target < symbol.address + symbol.size) continue;
    const targetName = addresses.get(target);
    if (targetName) { tails.push({ offset: at, target: targetName }); mask[at] = 0; mask[at + 1] = 0xf8; }
  }
  const prior = profiles.functions[name as keyof typeof profiles.functions];
  if (prior && prior.hex.length === body.length * 2) for (let i = 0; i < mask.length; i++) mask[i] &= Number.parseInt(prior.mask.slice(i * 2, i * 2 + 2), 16);
  functions[name] = { hex: Buffer.from(body).toString("hex"), mask: Buffer.from(mask).toString("hex"), module: symbol.module, thumb: symbol.thumb,
    clone: owned && !overrides.has(name), calls, tails, ...(veneer ? { veneer } : {}) };
  if (veneer) describe(veneer.target);
  if (owned || ["CanMonSwitch", "CheckEscapeBlocked", "ServerEvent_EquipItem", "HandlerJudgement", "HandlerTechnoBlast", "ServerEvent_GetMoveParam"].includes(name)) for (const call of [...calls, ...tails]) describe(call.target);
}
for (const row of profiles.rows) for (const event of row.events) describe(event.handler);
for (const name of ["HandlerJudgement", "HandlerTechnoBlast", "ServerEvent_GetMoveParam"]) describe(name);
for (const name of ["ItemEvent_AddItemCore", "ServerEvent_EquipItem", "BattleEventVar_Push", "BattleEventVar_Pop", "BattleEventVar_SetConstValue", "IsStatChangeValid", "BtlCalc_MakeStatusCondition", "MakeConditionBadlyPoisoned", "RollEffectChance", "BattleEventVar_GetValueIfExist", "GetBattleMonHeldItem", "GetBattleMonSpecies", "CheckCondition", "getMoveFlag", "BattleEvent_CheckSkip", "CanMonSwitch", "CanMonUseHeldItem", "IsMonTrapped", "CheckEscapeBlocked", "SetMoveEffectIndex"]) describe(name);
await writeFile(output, JSON.stringify({ version: 1, functions }) + "\n");
console.log(`${Object.keys(functions).length} checked functions, ${Object.values(functions).filter(value => value.clone).length} native clone candidates.`);
