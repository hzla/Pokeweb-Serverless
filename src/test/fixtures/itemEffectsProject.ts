import recipeBindings from "../../assets/data/abilityRecipeBindings.json";
import abilityBindings from "../../assets/data/abilityBindings.json";
import clientBindings from "../../assets/data/abilityClientBindings.json";
import { hydrateAbilityEffectsSource } from "../../pokeweb/abilityEffectsModel";
import profiles from "../../assets/data/itemEffectProfiles.json";
import native from "../../assets/data/itemNativeBindings.json";
import bindings from "../../assets/data/itemRuleBindings.json";
import { writeU16, writeU32 } from "../../nds/binary";
import { Folder, saveFnt } from "../../nds/fnt";
import { NARC } from "../../nds/narc";
import { NintendoDSRom } from "../../nds/rom";
import { hydrateItemEffectsSource } from "../../pokeweb/itemEffectsModel";
import { getNarcFormats } from "../../pokeweb/formats";
import { createNarcStore, type ProjectState } from "../../pokeweb/projectStore";

export function makeItemEffectsProject(shift = 0, relocateBy = 0, extended = false, ability = false) {
  const base = 0x02190000 - shift + relocateBy;
  const data = new Uint8Array((ability ? 0x80000 : 0x20000) + shift), offsets = new Map<string, number>();
  let cursor = 0x100 + shift;
  const catalog = extended ? { ...bindings.functions, ...native.functions, ...(ability ? {...abilityBindings.functions,...recipeBindings.functions,...clientBindings.functions} : {}) } : profiles.functions;
  const armOffsets = new Map<string, number>(), arm9 = new Uint8Array(0x10000);
  let armCursor = 0x100;
  for (const [name, signature] of Object.entries(catalog)) {
    const bytes = Uint8Array.from(signature.hex.match(/../gu)!, byte => Number.parseInt(byte, 16));
    if ("module" in signature && signature.module === "ARM9") { armOffsets.set(name, armCursor); arm9.set(bytes, armCursor); armCursor = (armCursor + bytes.length + 3) & ~3; continue; }
    const inline = Object.entries(catalog).find(([, entry]) => "veneer" in entry && (entry.veneer as { target: string; inline: boolean }).inline && (entry.veneer as { target: string }).target === name);
    if (inline && offsets.has(inline[0])) { const at = offsets.get(inline[0])! + 4; offsets.set(name, at); data.set(bytes, at); cursor = Math.max(cursor, (at + bytes.length + 3) & ~3); continue; }
    offsets.set(name, cursor); data.set(bytes, cursor); cursor = (cursor + bytes.length + 3) & ~3;
  }
  for (const [name, signature] of Object.entries(catalog)) {
    const isArm = armOffsets.has(name), at = (isArm ? armOffsets : offsets).get(name)!, module = isArm ? arm9 : data, moduleBase = isArm ? 0x02000000 : base;
    if ("veneer" in signature) {
      const veneer = signature.veneer as { offset: number; target: string; inline: boolean };
      const destination = offsets.has(veneer.target) ? base + offsets.get(veneer.target)! : 0x02000000 + armOffsets.get(veneer.target)!;
      if (!veneer.inline) writeU32(module, at + veneer.offset, (0xea000000 | ((destination - (moduleBase + at + veneer.offset + 8)) >> 2) & 0xffffff) >>> 0);
    }
    for (const call of signature.calls) {
      const target = offsets.get(call.target);
      // Uncatalogued services are outside this synthetic overlay.
      const displacement = (target === undefined ? 0x02000000 + (armOffsets.get(call.target) ?? 0x10000) : base + target) - (moduleBase + at + call.offset + 4);
      writeU16(module, at + call.offset, 0xf000 | (displacement >> 12) & 0x7ff);
      const targetEntry = catalog[call.target as keyof typeof catalog];
      writeU16(module, at + call.offset + 2, (targetEntry && "thumb" in targetEntry && !targetEntry.thumb ? 0xe800 : 0xf800) | (displacement >> 1) & 0x7ff);
    }
    if("tails"in signature)for(const tail of signature.tails as Array<{offset:number;target:string}>)writeU32(module,at+tail.offset,base+offsets.get(tail.target)!+1);
  }
  const table = cursor; cursor += (profiles.rows.length + 1) * 8;
  profiles.rows.forEach((row, index) => {
    const factory = cursor, events = cursor + 12;
    data.set([row.events.length, 0x21, 1, 0x60, 0, 0x48, 0x70, 0x47], factory);
    writeU32(data, factory + 8, base + events);
    row.events.forEach((event, n) => {
      writeU32(data, events + n * 8, event.event);
      writeU32(data, events + n * 8 + 4, base + offsets.get(event.handler)! + 1);
    });
    writeU32(data, table + index * 8, row.id); writeU32(data, table + index * 8 + 4, base + factory + 1);
    cursor += 12 + row.events.length * 8;
  });
  writeU32(data, offsets.get("ItemEvent_AddItemCore")! + 0x58, base + table);
  writeU32(data, offsets.get("ItemEvent_AddItemCore")! + 0x5c, base + table + 4);
  if (ability) {
    const abilityTable=cursor;cursor+=abilityBindings.rows.length*8;
    abilityBindings.rows.forEach((id,index)=>{writeU32(data,abilityTable+index*8,id);const profile=abilityBindings.profiles.find(p=>p.id===id);if(!profile)return;
      const factory=cursor,code=Uint8Array.from(profile.factoryHex.match(/../gu)!,v=>Number.parseInt(v,16)),events=(cursor+code.length+3)&~3;data.set(code,factory);writeU32(data,factory+profile.tableRefOffset,base+events);
      for(const call of (profile as {factoryCalls?:Array<{offset:number;target:string}>}).factoryCalls??[]){const delta=offsets.get(call.target)!-(factory+call.offset+4);writeU16(data,factory+call.offset,0xf000|(delta>>12)&0x7ff);writeU16(data,factory+call.offset+2,0xf800|(delta>>1)&0x7ff);}
      profile.events.forEach((event,n)=>{writeU32(data,events+n*8,event.event);writeU32(data,events+n*8+4,base+offsets.get(event.handler)!+1);});writeU32(data,abilityTable+index*8+4,base+factory+1);cursor=events+profile.events.length*8;
    });
    for(const ref of abilityBindings.tableRefs)writeU32(data,offsets.get("AbilityEvent_AddItem")!+ref.offset,base+abilityTable+ref.column);
  }
  const overlay = data.slice(0, cursor);
  const items = new NARC(); items.files = Array.from({ length: 639 }, () => new Uint8Array(36));
  items.files[238][3] = 20; items.files[234][3] = 10; items.files[281][3] = 16;
  const fnt = new Folder({ folders: [["a", new Folder({ folders: [["0", new Folder({ folders: [["2", new Folder({ files: ["4"], firstId: 1 })]] })]] })]] });
  const names = saveFnt(fnt), fileStart = 0x4000 + (extended ? arm9.length : 0), itemsStart = fileStart + overlay.length + (512 - overlay.length % 512);
  const itemBytes = items.save(), bytes = new Uint8Array(itemsStart + itemBytes.length + 512);
  bytes.set(new TextEncoder().encode("IRDO"), 12);
  writeU32(bytes, 0x20, 0x200); writeU32(bytes, 0x28, 0x02000000); writeU32(bytes, 0x2c, 4);
  if (extended) { writeU32(bytes, 0x20, 0x4000); writeU32(bytes, 0x2c, arm9.length); bytes.set(arm9, 0x4000); }
  writeU32(bytes, 0x40, 0x3000); writeU32(bytes, 0x44, names.length); bytes.set(names, 0x3000);
  writeU32(bytes, 0x48, 0x3100); writeU32(bytes, 0x4c, 16);
  writeU32(bytes, 0x3100, fileStart); writeU32(bytes, 0x3104, fileStart + overlay.length);
  writeU32(bytes, 0x3108, itemsStart); writeU32(bytes, 0x310c, itemsStart + itemBytes.length);
  writeU32(bytes, 0x50, 0x400); writeU32(bytes, 0x54, 168 * 32);
  writeU32(bytes, 0x400 + 167 * 32, 167); writeU32(bytes, 0x404 + 167 * 32, base);
  writeU32(bytes, 0x408 + 167 * 32, overlay.length);
  bytes.set(overlay, fileStart); bytes.set(itemBytes, itemsStart);
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  const project = {
    originalRomBytes: bytes, session: { baseRom: "BW2", baseVersion: "W2", romName: "Item fixture", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { idCode: "IRDO", fileName: "fixture.nds", title: "Fixture", size: bytes.length },
    arm9: rom.arm9, overlays: { 167: overlay }, formats: getNarcFormats("BW2"), trpokInfo: [],
    narcs: { items: createNarcStore("items", "a/0/2/4", 1, items) }, texts: { banks: { items: Array.from({ length: 639 }, (_, id) => `Item ${id}`) } },
  } as ProjectState;
  hydrateItemEffectsSource(project, rom);
  if (ability) hydrateAbilityEffectsSource(project, rom);
  return { project, base, table, offsets, rom };
}
