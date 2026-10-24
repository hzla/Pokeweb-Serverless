import catalog from "../assets/data/flagReference.json";
import { recoverCGearButtons, BUTTON_ARCHIVE } from "./cgearButtonsModel";
import { recover as recoverShops, ARCHIVE as SHOP_ARCHIVE } from "../systemShops/compiler";
import { getPartyQuickActionsStatus } from "./partyQuickActionsModel";
import { getDebugSaveFlagStatus } from "./debugSaveFlagModel";
import { readU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes } from "./fileSystemModel";
import { gen5ScriptCommandOffsets } from "./gen5ScriptCommands";
import type { ProjectState } from "./projectStore";

export const FLAG_CATEGORIES = [
  ["all","All flags"], ["important","Important"], ["story","Story & events"],
  ["system","System"], ["pokemon","Pokémon"], ["gifts","Gifts & trades"],
  ["actors","NPC visibility"], ["items","Item pickups"], ["trainers","Trainers"],
  ["daily","Daily & timed"], ["facilities","Facilities"], ["patches","Patch flags"], ["other","Other"],
] as const;
export type FlagCategory = typeof FLAG_CATEGORIES[number][0];
export type FlagEntry = {
  id:number; category:FlagCategory; label:string; source:"public-notes"|"rom"|"patch";
  group?:string; uses?:string[];
};
export type FlagUsage = { id:number; description:string; kind?:"npc" };
/** The shipped catalog contains only the pinned public notes. Native symbols
 * and inferred names are not accepted as catalog input. */
export function publicFlagReference(family:"BW"|"BW2"):FlagEntry[] {
  return structuredClone(catalog.games[family]) as FlagEntry[];
}
/** Follow decoded commands only. Unknown instructions stop a path; never scan
 * raw operands/movement bytes for coincidental flag opcodes. */
export function scriptFlagUsages(files:readonly Uint8Array[],family:"BW"|"BW2"):FlagUsage[] {
  const uses:FlagUsage[]=[];
  files.forEach((bytes,file)=>{
    for (const offset of gen5ScriptCommandOffsets(bytes,family)) {
      const op=readU16(bytes,offset);
      if (![0x10,0x23,0x24].includes(op)) continue;
      const id=readU16(bytes,offset+2);
      if (!id || id >= 0x4000) continue; // Dynamic work operands aren't literal flags.
      uses.push({id,description:`Script ${file} · 0x${offset.toString(16).toUpperCase()} · ${op===0x23?"set":op===0x24?"clear":"test"}`});
    }
  });
  return uses;
}
export function actorFlagUsages(files:readonly Uint8Array[]):FlagUsage[] {
  const uses:FlagUsage[]=[];
  files.forEach((bytes,file)=>{
    if (bytes.length<8) return;
    const first=8+bytes[4]*20, count=bytes[5];
    if (first+count*36>bytes.length) return;
    for (let n=0;n<count;n++) {
      const id=readU16(bytes,first+n*36+8);
      if (id && id<0x4000) uses.push({id,description:`Events ${file} · NPC ${n} · hidden when set`,kind:"npc"});
    }
  });
  return uses;
}
export function mergeFlagUsages(entries:FlagEntry[],uses:readonly FlagUsage[]):FlagEntry[] {
  const byId=new Map(entries.map(e=>[e.id,e]));
  for (const use of uses) {
    let entry=byId.get(use.id);
    if (!entry) {
      const patch=use.description.startsWith("Patch ·");
      entry={id:use.id,category:patch?"patches":"other",label:patch?"Configured patch flag (see references)":"Used in the loaded ROM; purpose unknown",source:patch?"patch":"rom"};
      byId.set(entry.id,entry);
    }
    if (use.kind==="npc" && entry.source==="rom") {
      entry.category="actors";
      entry.group="npc-visibility";
      entry.label="NPC visibility; event purpose unknown";
    }
    const descriptions=entry.uses??=[];
    if (!descriptions.includes(use.description)) descriptions.push(use.description);
  }
  return [...byId.values()].sort((a,b)=>a.id-b.id);
}
/** Authored flag references supplement retail data, including reserved IDs
 * used by patches. Applied and draft configurations remain distinguishable. */
export function configuredFlagUsages(project:ProjectState):FlagUsage[] {
  const uses:FlagUsage[]=[];
  const max=project.session?.baseRom==="BW"?2911:3059;
  const buttons=project.cgearButtons;
  for (const [state,document] of [["applied",buttons?.applied],["draft",buttons?.document]] as const) {
    if(!document || state==="draft"&&JSON.stringify(document)===JSON.stringify(buttons?.applied))continue;
    for(const button of document.buttons)if(button.flag&&Number.isInteger(button.flag.id)&&button.flag.id>0&&button.flag.id<=max)
      uses.push({id:button.flag.id,description:`Patch · C-Gear ${button.label} · ${state} · visible when ${button.flag.when}`});
  }
  const shops=project.systemShops;
  for (const [state,document] of [["applied",shops?.applied],["draft",shops?.document]] as const) {
    if(!document || state==="draft"&&JSON.stringify(document)===JSON.stringify(shops?.applied))continue;
    for(const shop of document.shops)for(const row of shop.inventory)if(row.condition?.flag&&Number.isInteger(row.condition.flag.id)&&row.condition.flag.id>0&&row.condition.flag.id<=max)
      uses.push({id:row.condition.flag.id,description:`Patch · ${shop.name} · item #${row.item} · ${state} · available when ${row.condition.flag.state}`});
  }
  return uses;
}
export function flagMatches(entry:FlagEntry,query:string):boolean {
  const value=query.trim().toLowerCase();
  if (!value) return true;
  if (/^(?:0x[\da-f]+|\d+)$/iu.test(value)) return entry.id===Number(value);
  return `${entry.label} ${(entry.uses??[]).join(" ")}`.toLowerCase().includes(value);
}
export function isImportantFlag(entry:FlagEntry):boolean {
  return entry.category==="system" || /Hall of Fame|First game clear/iu.test(entry.label);
}
/** Read current staged archives without changing project data or dirty state. */
export function projectFlagReference(project:ProjectState):FlagEntry[] {
  const family=project.session.baseRom;
  if (family!=="BW"&&family!=="BW2") return [];
  const rom=project.originalRomBytes?new NintendoDSRom(project.originalRomBytes,{fileData:"view"}):undefined;
  const files=(name:"scripts"|"overworlds",path:string)=>{
    if (project.narcs[name]) return project.narcs[name]!.rawFiles;
    const id=rom?.filenames.idOf(path);
    return rom&&id!==undefined?new NARC(getRomFileBytes(project,rom,id)).files:[];
  };
  const owned=(path:string)=>{
    const addition=Object.keys(project.fileSystem?.additions??{}).find(key=>key.toLowerCase()===path.toLowerCase());
    const id=rom?.filenames.idOf(path);
    return addition?project.fileSystem!.additions![addition]:rom&&id!==undefined?getRomFileBytes(project,rom,id):undefined;
  };
  // Recover editable references locally; visiting an information page must not
  // hydrate or otherwise change the user's working configuration.
  const configured={...project};
  if(!configured.cgearButtons)try{const bytes=owned(BUTTON_ARCHIVE);if(bytes)configured.cgearButtons=recoverCGearButtons(bytes);}catch{/* Unknown owned formats provide no trusted labels. */}
  if(!configured.systemShops)try{const bytes=owned(SHOP_ARCHIVE);if(bytes)configured.systemShops=recoverShops(bytes);}catch{/* Keep the retail reference available. */}
  const usages=[...scriptFlagUsages(files("scripts","a/0/5/6"),family),
    ...actorFlagUsages(files("overworlds",family==="BW"?"a/1/2/5":"a/1/2/6")),...configuredFlagUsages(configured)];
  if(owned("party-tools/ui.narc")) {
    const toolbar=getPartyQuickActionsStatus(project);
    if(toolbar.hideFlag)usages.push({id:toolbar.hideFlag,description:"Patch · Party Toolbar · whole toolbar hidden when set"});
    for(const [section,id]of Object.entries(toolbar.sectionHideFlags))if(id)
      usages.push({id,description:`Patch · Party Toolbar · ${section} hidden when set`});
  }
  const debug=getDebugSaveFlagStatus(project);
  if(debug.installed&&debug.flag)usages.push({id:debug.flag,description:"Patch · Debug Save Flag · toggled by L + R + Y"});
  const headers=Object.values(project.headers?.rows ?? {});
  for (const use of usages) {
    const script=/^Script (\d+)/u.exec(use.description),events=/^Events (\d+)/u.exec(use.description);
    const places=[...new Set(headers.filter(row=>script?Number(row.script_id)===Number(script[1]):events?Number(row.overworlds_id??row.map_id)===Number(events[1]):false).map(row=>row.location_name).filter(Boolean))];
    if(places.length)use.description=`${places.join(" / ")} · ${use.description}`;
  }
  return mergeFlagUsages(publicFlagReference(family),usages);
}
export function badgeReference(family:"BW"|"BW2") {
  const leaders=family==="BW2"?["Cheren — Basic","Roxie — Toxic","Burgh — Insect","Elesa — Bolt","Clay — Quake","Skyla — Jet","Drayden — Legend","Marlon — Wave"]:
    ["Cilan / Chili / Cress — Trio","Lenora — Basic","Burgh — Insect","Elesa — Bolt","Clay — Quake","Skyla — Jet","Brycen — Freeze","Drayden / Iris — Legend"];
  return leaders.map((name,index)=>({index,name,mask:1<<index}));
}
