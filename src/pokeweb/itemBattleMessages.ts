import type { ProjectState } from "./projectStore";
import type { ItemRuleSet } from "./itemRules";
import {getTextBank,parseTextEntryId,addTextEntries,commitTextBank} from "./textModel";
import {loadCodeInjectionNarcs} from "./codeInjectionInstall";
import {NintendoDSRom} from "../nds/rom";
// Presentation follows pokeemerald-expansion's prevention / mirroring notices.
// Native BW formatters supply the actual holder and held item names.
export const ITEM_BATTLE_MESSAGES = [
 "VAR(258, 0)'s VAR(265, 1)\\nprevents its stats from being lowered!",
 "VAR(258, 0) used its VAR(265, 1)\\nto mirror its opponent's stat changes!",
 "VAR(258, 0) used its VAR(265, 1)!",
].map(s=>[s,s.replace("VAR(258, 0)","The wild VAR(258, 0)"),s.replace("VAR(258, 0)","The foe's VAR(258, 0)")]);
export function itemMessageIds(project:ProjectState,rules:ReadonlyMap<number,ItemRuleSet>,install=false):number[]{
 const needed=[...rules.values()].some(r=>r.consumable||r.effects.some(e=>e.kind==="itemRecipe:statGuard"||e.kind==="itemRecipe:mirrorBoosts"));
 if(!needed)return [0,0,0];
 if(!project.narcs.message_texts){if(!install)return [0,0,0];if(!project.originalRomBytes)throw Error("Reload the ROM with Message Texts to install item messages.");loadCodeInjectionNarcs(project,new NintendoDSRom(project.originalRomBytes,{fileData:"view"}),["message_texts"]);}
 const bankId=project.session.baseRom==="BW"?14:18;
 const ids:number[]=[];
 for(const messages of ITEM_BATTLE_MESSAGES){
  const entries=new Map(getTextBank(project,"message_texts",bankId).filter(e=>parseTextEntryId(e[0]).block===0).map(e=>[parseTextEntryId(e[0]).entry,e[1]]));
  const found=[...entries.keys()].find(id=>messages.every((text,n)=>entries.get(id+n)===text));
  if(found!==undefined){ids.push(found);continue;}
  if(!install){ids.push(0);continue;}
  const base=Math.max(-1,...entries.keys())+1;if(!entries.size||base+2>=65535)throw Error("The battle message bank has no room for item notices.");
  addTextEntries(project,"message_texts",bankId,3);
  for(const entry of getTextBank(project,"message_texts",bankId)){const id=parseTextEntryId(entry[0]);if(id.block===0&&id.entry>=base&&id.entry<base+3)entry[1]=messages[id.entry-base];}
  commitTextBank(project,"message_texts",bankId);ids.push(base);
 }
 return ids;
}
