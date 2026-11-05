import {describe,it,expect} from "vitest";
import {makeBw1AbilityProject} from "./fixtures/blackAbilityProject";
import {NARC} from "../nds/narc";
import {createNarcStore} from "../pokeweb/projectStore";
import {buildItemRuleModule,inspectItemEffect,clearItemRules,ITEM_EFFECTS_DLL_PATH} from "../pokeweb/itemEffectsModel";
import {itemRulePreset,ITEM_RECIPE_TEMPLATE_IDS} from "../pokeweb/itemRulePresets";
import {writeRpm,parseRpm} from "../pokeweb/rpm";
import {encodeItemRulesV4} from "../pokeweb/itemRules";
import {readU16,readU32} from "../nds/binary";
import {renderItemEffects} from "../ui/itemEffectsEditor";
import {renderItemRuleForm} from "../ui/itemRuleEditor";
import {ITEM_BATTLE_MESSAGES} from "../pokeweb/itemBattleMessages";
function fixture(game:"B"|"W",shift:number,relocate:number){
 const {project,locations}=makeBw1AbilityProject(game,shift,relocate);
 const items=new NARC();items.files=Array.from({length:639},()=>new Uint8Array(36));project.narcs.items=createNarcStore("items","a/0/2/4",1,items);project.texts.banks.items=Array.from({length:639},(_,i)=>`Item ${i}`);
 return {project,locations};
}
describe("portable modern item recipes",()=>{
 for(const game of ["B","W"] as const)it(`${game}: verifies all eleven templates at moved code offsets and preserves them on reopen`,()=>{
  const {project,locations}=fixture(game,0x1400,0x3000);
  const rules=new Map(Object.values(ITEM_RECIPE_TEMPLATE_IDS).map((id,i)=>[85+i,itemRulePreset(id,false,false)]));
  const rpm=buildItemRuleModule(project,rules),api=rpm.symbols.find(s=>s.name==="ItemRuleApi")!.address;
  expect(rpm.metadata.PMCVersion).toBe("6.0.0");expect(rpm.relocations.filter(r=>r.target.module==="93")).toHaveLength(1);
  expect(readU32(rpm.code,api+44*4)).toBe(locations.get("BattleEventItem_AttachSkipCheckHandler")!|1);
  expect(rpm.code.length+rpm.bssSize).toBeLessThan(65536);
  project.fileSystem={replacements:{},additions:{[ITEM_EFFECTS_DLL_PATH]:writeRpm(rpm,{ident:"DLXF"})}};
  for(const[id,rule]of rules){const state=inspectItemEffect(project,id);expect(state.editable,state.message).toBe(true);expect(state.rules).toEqual(rule);}
  expect(renderItemEffects(project,85)).toContain("Native behavior");
  const html=renderItemRuleForm(project,itemRulePreset(10011));expect(html).toContain("Punching");expect(html).not.toContain("Choice Band behavior");
  const changed=parseRpm(project.fileSystem.additions![ITEM_EFFECTS_DLL_PATH],{allowedMagics:["DLXF"]});changed.code[0]^=1;project.fileSystem.additions![ITEM_EFFECTS_DLL_PATH]=writeRpm(changed,{ident:"DLXF"});
  expect(inspectItemEffect(project,85).editable).toBe(false);
 });
 it("keeps native BW1 behavior after clearing the last rule",()=>{
  const {project}=fixture("B",0,0),rules=new Map([[85,itemRulePreset(10006)]]);
  project.fileSystem={replacements:{},additions:{[ITEM_EFFECTS_DLL_PATH]:writeRpm(buildItemRuleModule(project,rules),{ident:"DLXF"})}};
  clearItemRules(project,85);expect(inspectItemEffect(project,85).rules).toBeUndefined();expect(project.fileSystem.additions![ITEM_EFFECTS_DLL_PATH]).toBeUndefined();
  expect(()=>buildItemRuleModule(project,new Map([[85,itemRulePreset(220)]]))).toThrow("BW2");
 });
 it("encodes six distinct portable effects and editable move-class selectors",()=>{
  const expected=[134,135,136,137,138,139];
  for(let i=0;i<6;++i){const bytes=encodeItemRulesV4(new Map([[85,itemRulePreset(10006+i)]])).bytes;expect(bytes[readU16(bytes,170)+8]).toBe(expected[i]);}
  const r=itemRulePreset(10011);r.effects[0].parameters={moveClass:5};r.effects[0].value=2;
  const bytes=encodeItemRulesV4(new Map([[85,r]])).bytes,at=readU16(bytes,170)+8;expect(bytes[at+5]).toBe(5);expect(readU16(bytes,at+2)).toBe(8192);
  expect(itemRulePreset(10003,false,false).effects[0].parameters!.type).toBe(0);
  expect(itemRulePreset(10003,false,true).effects[0].parameters!.type).toBe(17);
  expect(ITEM_BATTLE_MESSAGES.flat().every(text=>text.includes("VAR(265, 1)"))).toBe(true);
 });
});
