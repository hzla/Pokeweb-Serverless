/** Build BW1 binary contracts from an explicit ROM and reference symbol metadata.
 * Only symbol names/addresses are read from the reference; bytes come from the ROM.
 * No reference handler source is copied into the runtime. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { NintendoDSRom } from "../../src/nds/rom";
import { decompressCode } from "../../src/nds/codeCompression";
import { readU16, readU32 } from "../../src/nds/binary";
import { BATTLE_RUNTIME_SIGNATURES, battleBranchTarget } from "../../src/pokeweb/battleRuntimeBindings";
import native from "../../src/assets/data/abilityBindings.json";
import type { NativeAbilityProfile } from "../../src/pokeweb/abilityNativeRuntime";
import { addAbilityParameterCatalog } from "./parameter_catalog";

const [input, reference, output] = process.argv.slice(2);
assert(input && reference && output, "Usage: ROM.nds REFERENCE_DIRECTORY OUTPUT.json");
const rom = new NintendoDSRom(new Uint8Array(await readFile(input)), { fileData: "view" });
assert(["IRBO", "IRAO"].includes(rom.idCode) && rom.data[30] === 0);
const game = rom.idCode === "IRBO" ? "B" : "W", ov = rom.loadArm9Overlays([93]).get(93)!, arm = decompressCode(rom.arm9);
type Symbol = { name: string; address: number; size: number; module: string; thumb: boolean };
const symbols = new Map<string, Symbol>();
for (const line of (await readFile(`${reference}/layout/function_addrs.tsv`, "utf8")).trim().split("\n").slice(1)) {
  const [region, address, name, isa, size] = line.split("\t");
  if (region === "ov093" || region === "arm9") symbols.set(name, { name, address: Number(address), size: Number(size), module: region === "arm9" ? "ARM9" : "93", thumb: isa === "thumb" });
}
if (game === "W") for (const region of ["arm9", "ov093"]) {
  const mapped = JSON.parse(await readFile(`${reference}/layout/matched_white/${region}.json`, "utf8"));
  for (const row of mapped.functions) { const symbol = symbols.get(row.name); if (symbol && row.white_address) symbol.address = Number(row.white_address); }
}
const byAddress = new Map([...symbols.values()].map(symbol => [symbol.address, symbol]));
const bytesOf = (symbol: Symbol) => (symbol.module === "ARM9" ? arm : ov.data).slice(symbol.address - (symbol.module === "ARM9" ? rom.arm9RamAddress : ov.ramAddress), symbol.address - (symbol.module === "ARM9" ? rom.arm9RamAddress : ov.ramAddress) + symbol.size);
const callsOf = (symbol: Symbol) => {
  const bytes = bytesOf(symbol), calls: Array<{ offset: number; target: Symbol }> = [];
  if (!symbol.thumb) return calls;
  for (let at = 0; at + 4 <= bytes.length; at += 2) {
    const high = readU16(bytes, at), low = readU16(bytes, at + 2);
    if ((high & 0xf800) === 0xf000 && [0xf800, 0xe800].includes(low & 0xf800)) {
      const address = battleBranchTarget(bytes, at, symbol.address);
      let target = byAddress.get(address);
      if (!target && address >= ov.ramAddress && address + 16 <= ov.ramAddress + ov.data.length) {
        const veneer = ov.data.slice(address - ov.ramAddress, address - ov.ramAddress + 16);
        // Native Thumb-to-ARM far-call veneers are absent from the function list.
        // Keep their absolute secondary-overlay destination intact and checked.
        if (Buffer.from(veneer.subarray(0, 12)).toString("hex") === "7847c04600c09fe51cff2fe1") {
          target = { name: `Veneer_${address.toString(16)}`, address, size: 16, module: "93", thumb: true };
          symbols.set(target.name, target); byAddress.set(address, target);
        }
      }
      if (target) calls.push({ offset: at, target });
      at += 2;
    }
  }
  return calls;
};
const aliases: Record<string, string> = {
  AbilityEvent_AddItem: "HAND_TOKUSEI_AddAbilityHandlers", AbilityEvent_RemoveItem: "HAND_TOKUSEI_RemoveAbilityHandlers", AbilityEvent_Swap: "HAND_TOKUSEI_SwapAbilityHandlers",
  numHandlersWithHandlerPri: "HAND_TOKUSEI_PackAbilityHandlerInfo", devideNumHandersAndPri: "HAND_TOKUSEI_UnpackAbilityPriority", calcAbilHandlerSubPriority: "HAND_TOKUSEI_GetPokeSpeed",
  BattleEventVar_GetValue: "BTL_EVENT_GetVar", BattleEventVar_GetValueIfExist: "BTL_EVENT_TryGetVar", BattleEventVar_MulValue: "BTL_EVENT_MultiplyVar", BattleEventVar_RewriteValue: "BTL_EVENT_OverwriteVar",
  BattleEventVar_Push: "BTL_EVENT_PushVarFrame", BattleEventVar_Pop: "BTL_EVENT_PopVarFrame", BattleEventVar_SetConstValue: "BTL_EVENT_SetVarReadOnly",
  BattleEvent_AddItem: "BTL_EVENT_AddFactor", BattleEvent_SeekItem: "BTL_EVENT_FindFactor", BattleEvent_CheckSkip: "BTL_EVENT_IsEventBlocked",
  BattleEvent_CallHandlers: "BTL_EVENT_DispatchEventChecked", BattleEvent_CallHandlersCore: "BTL_EVENT_DispatchEventNested", BattleEvent_Init: "BTL_EVENT_InitFactorList",
  GetMonID: "BTL_POKEPARAM_GetPokeId", GetBattleMonStat: "BTL_POKEPARAM_GetValue", RawBattleMonStat: "BTL_POKEPARAM_GetStatRaw",
  ServerEvent_GetWeather: "BTL_SERVER_FLOW_GetEffectiveWeather", GetFieldWeather: "BTL_FIELD_GetCountdownValue",
  BtlServerFlow_IsMonInBattle: "BTL_SERVER_FLOW_IsPokeInPosTable",
  ServerEvent_GetMoveParam: "BTL_SERVER_FLOW_GetMoveParam", ServerEvent_CheckCritical: "BTL_SERVER_FLOW_CheckCriticalHit",
  ServerControl_ChangeHeldItem: "BTL_SERVER_FLOW_SetHeldItem", BattleHandler_ForceUseItem: "BTL_SERVER_FLOW_ProcHandExForceItemFactor",
  BtlServerFlow_IsTargetOutOfRange: "BTL_SERVER_FLOW_CheckAllyMoveAutoHitById",
  loadAbilityNameToStrbuf: "WORDSET_SetSlotFromMsgB6",
  IsMonLastInTurnOrder: "HAND_COMMON_IsLastToAct",
  GetBattleMon: "BTL_SERVER_FLOW_GetPokeParam", GetPokeType: "BTL_POKEPARAM_GetTypes", GetBattleMonSpecies: "BTL_POKEPARAM_GetSpecies",
};
// An optional reviewed alias file lets generation stop on unfamiliar names rather
// than guessing an ABI from a nearby address.
let reviewed: Record<string, string> = {};
try { reviewed = JSON.parse(await readFile(new URL("./bw1_aliases.json", import.meta.url), "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
Object.assign(aliases, reviewed);
const dispatcher = symbols.get(aliases.AbilityEvent_AddItem)!; assert(dispatcher);
const dispatcherBytes = bytesOf(dispatcher), tables: number[] = [];
for (let at = 0; at + native.rows.length * 8 <= ov.data.length; at += 4)
  if (native.rows.every((id, index) => readU32(ov.data, at + index * 8) === id)) tables.push(at);
assert.equal(tables.length, 1, "Native ability registry mismatch"); const table = tables[0];
const profiles: NativeAbilityProfile[] = [];
for (const old of native.profiles) {
  const index = native.rows.indexOf(old.id), address = readU32(ov.data, table + index * 8 + 4) & ~1, factory = byAddress.get(address); assert(factory, `Ability factory ${old.id}`);
  const code = bytesOf(factory), mask = new Uint8Array(code.length).fill(255); let eventTable = 0, ref = -1;
  for (let at = 0; at + 4 <= code.length; at += 2) if ((address + at) % 4 === 0) {
    const pointer = readU32(code, at) - ov.ramAddress;
    if (pointer >= 0 && pointer + old.events.length * 8 <= ov.data.length && old.events.every((event, n) => readU32(ov.data, pointer + n * 8) === event.event)) { eventTable = pointer; ref = at; break; }
  }
  assert(ref >= 0, `Ability event table ${old.id}`); mask.fill(0, ref, ref + 4);
  const events = old.events.map((event, n) => {
    const handler = byAddress.get(readU32(ov.data, eventTable + n * 8 + 4) & ~1); assert(handler, `Ability handler ${old.id}/${event.event}`);
    if (aliases[event.handler]) assert.equal(aliases[event.handler], handler.name, event.handler); else aliases[event.handler] = handler.name;
    return { event: event.event, handler: event.handler };
  });
  const factoryCalls = callsOf(factory).map(call => { mask.fill(0, call.offset, call.offset + 4); const name = Object.keys(aliases).find(name => aliases[name] === call.target.name); assert(name, `Unmapped ability factory dependency ${call.target.name}`); return { offset: call.offset, target: name }; });
  profiles.push({ id: old.id, ...(old.priority ? { priority: old.priority } : {}), ...(factoryCalls.length ? { factoryCalls } : {}), factorySize: code.length, tableRefOffset: ref, factoryHex: Buffer.from(code).toString("hex"), factoryMask: Buffer.from(mask).toString("hex"), events });
}
// Exact masked body matches independently anchor shared helpers.
for (const [name, signature] of Object.entries(BATTLE_RUNTIME_SIGNATURES)) {
  if (aliases[name]) continue;
  const expected = Buffer.from(signature.hex, "hex"), mask = Buffer.from(signature.mask, "hex");
  const candidates = [...symbols.values()].filter(symbol => symbol.module === (signature.module === "ARM9" ? "ARM9" : "93") && symbol.size === expected.length && expected.every((byte, i) => (byte & mask[i]) === (bytesOf(symbol)[i] & mask[i])));
  if (candidates.length === 1) aliases[name] = candidates[0].name;
}
// Propagate only aligned call lists; retain the inferred aliases as diagnostics
// for review before the generated contract can be bundled.
const inferred: Record<string, string> = {};
for (let pass = 0; pass < 10; ++pass) {
  let added = 0;
  for (const [name, target] of Object.entries(aliases)) {
    const original = BATTLE_RUNTIME_SIGNATURES[name], symbol = symbols.get(target); if (!original || !symbol) continue;
    const actual = callsOf(symbol); if (actual.length !== original.calls.length) continue;
    if (actual.some((call, index) => aliases[original.calls[index].target] && aliases[original.calls[index].target] !== call.target.name)) continue;
    actual.forEach((call, index) => { const name = original.calls[index].target; if (!aliases[name]) { aliases[name] = inferred[name] = call.target.name; ++added; } });
  }
  if (!added) break;
}
await mkdir(new URL("./build/", import.meta.url), { recursive: true });
await writeFile(new URL(`./build/bw1-${game}-aliases.json`, import.meta.url), JSON.stringify({ aliases, inferred, missing: Object.keys(BATTLE_RUNTIME_SIGNATURES).filter(name => !aliases[name]) }, null, 2) + "\n");
const reverse = new Map<string, string>(); for (const [name, target] of Object.entries(aliases)) if (!reverse.has(target)) reverse.set(target, name);
type Binding = { hex: string; mask: string; module: string; calls: Array<{ offset: number; target: string }>; thumb?: boolean; tails?: Array<{ offset: number; target: string }> };
const functions: Record<string, Binding> = {};
const required = new Set([...Object.keys(native.functions), "AbilityEvent_AddItem", "BattleEventVar_GetValue", ...Object.keys(aliases).filter(name => name in BATTLE_RUNTIME_SIGNATURES)]);
const missing: string[] = [];
for (const name of required) {
  const symbol = symbols.get(aliases[name]); if (!symbol) { missing.push(name); continue; }
  const bytes = bytesOf(symbol), mask = new Uint8Array(bytes.length).fill(255), actualCalls = callsOf(symbol), originalCalls = BATTLE_RUNTIME_SIGNATURES[name]?.calls;
  const aligned = originalCalls?.length === actualCalls.length;
  const calls = actualCalls.map((call, index) => {
    const oldTarget = aligned ? originalCalls![index].target : undefined;
    let target = oldTarget && aliases[oldTarget] === call.target.name ? oldTarget : reverse.get(call.target.name);
    if (!target) { target = `BW1_${call.target.name}`; aliases[target] = call.target.name; reverse.set(call.target.name, target); required.add(target); }
    required.add(target); mask.fill(0, call.offset, call.offset + 4); return { offset: call.offset, target };
  });
  for (let at = 0; at + 4 <= bytes.length; at += 2) if ((symbol.address + at) % 4 === 0 && readU32(bytes, at) >= 0x02000000 && readU32(bytes, at) < 0x02400000) mask.fill(0, at, at + 4);
  const tails: Array<{ offset: number; target: string }> = [];
  if (bytes.length <= 20 && (readU16(bytes, 0) & 0xff00) === 0x4b00) {
    const at = ((symbol.address + 4) & ~3) + bytes[0] * 4 - symbol.address;
    if (at >= 0 && at + 4 <= bytes.length && Array.from({ length: at / 2 }, (_, n) => readU16(bytes, n * 2)).includes(0x4718)) {
      const target = byAddress.get(readU32(bytes, at) & ~1); if (target) { let alias = reverse.get(target.name); if (!alias) { alias = `BW1_${target.name}`; aliases[alias] = target.name; reverse.set(target.name, alias); required.add(alias); } tails.push({ offset: at, target: alias }); }
    }
  }
  functions[name] = { hex: Buffer.from(bytes).toString("hex"), mask: Buffer.from(mask).toString("hex"), module: symbol.module, calls, ...(symbol.thumb ? {} : { thumb: false }), ...(tails.length ? { tails } : {}) };
}
const tableRefs: Array<{ offset: number; column: number }> = [];
for (let at = 0; at + 4 <= dispatcherBytes.length; at += 4) { const column = readU32(dispatcherBytes, at) - ov.ramAddress - table; if (column === 0 || column === 4) tableRefs.push({ offset: at, column }); }
assert.equal(tableRefs.length, 2);
for(const profile of profiles){
 const weather:NonNullable<NativeAbilityProfile["weather"]>=[],multipliers:NonNullable<NativeAbilityProfile["multipliers"]>=[],chances:NonNullable<NativeAbilityProfile["chances"]>=[];
 for(const event of profile.events){
  const f=functions[event.handler],bytes=Uint8Array.from(Buffer.from(f.hex,"hex"));
  for(const call of f.calls){
   if(call.target==="GetWeather"&&readU16(bytes,call.offset+4)>>8===0x28)weather.push({handler:event.handler,offset:call.offset+4,original:bytes[call.offset+4]});
   if(call.target==="CommonWeatherGuard"&&readU16(bytes,4)>>8===0x24)weather.push({handler:event.handler,offset:4,original:bytes[4]});
   if(call.target==="BattleEventVar_MulValue"&&call.offset>=2){const ins=readU16(bytes,call.offset-2),rs=ins>>3&7;
    if((ins&0xf800)===0&&(ins&7)===1)for(let at=call.offset-4;at>=0;at-=2)if((readU16(bytes,at)&0xff00)===(0x2000|rs<<8)){multipliers.push({handler:event.handler,mov:at,shift:call.offset-2,original:bytes[at]*2**(ins>>6&31)/4096});break;}
   }
   if(call.target==="CommonContactStatusAbility")for(let at=0;at<call.offset-2;at+=2)if((readU16(bytes,at)&0xf800)===0x2000&&(readU16(bytes,at+2)&0xff00)===(0x9000|(readU16(bytes,at)>>8&7)<<8))chances.push({handler:event.handler,offset:at,original:bytes[at]});
  }
 }
 if(weather.length&&new Set(weather.map(c=>c.original)).size===1)profile.weather=weather;
 if(multipliers.length&&new Set(multipliers.map(c=>c.original)).size===1)profile.multipliers=multipliers;
 if(chances.length&&new Set(chances.map(c=>c.original)).size===1)profile.chances=chances;
 if(profile.id===22){
  const handler="HandlerIntimidateMemberIn",bytes=Buffer.from(functions[handler].hex,"hex"),sites=[];
  for(let at=2;at+4<=bytes.length;at+=2)if(readU16(bytes,at-2)===0x2201&&readU16(bytes,at)===0x604a&&readU16(bytes,at+2)===0x1e90)sites.push(at);
  assert.equal(sites.length,1,"Intimidate stat assignment");profile.stats=[{handler,offset:sites[0],original:1}];
 }
}
addAbilityParameterCatalog(profiles,functions);
// Unused transitive SDK helpers may live in ITCM rather than the ROM's ARM9
// address range. They are not imported or copied by the ability runtime.
const unavailable = new Set(Object.entries(functions).filter(([,s])=>!s.hex.length).map(([name])=>name));
for(const name of unavailable) delete functions[name];
for(const f of Object.values(functions))f.calls=f.calls.filter(c=>!unavailable.has(c.target));
await writeFile(output, JSON.stringify({ version: 1, game, functions, profiles, rows: native.rows, tableRefs }) + "\n");
console.log(`${game}: ${profiles.length} native abilities, ${Object.keys(functions).length} functions; ${missing.length} unresolved names.`);
