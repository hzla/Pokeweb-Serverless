import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {readU16,readU32} from "../nds/binary";
import {ABILITY_IMPORT_LIBRARY,abilityImport} from "../pokeweb/abilityLibrary";
import {abilityRuleEvents} from "../pokeweb/abilityEvents";
import {NATIVE_ABILITY_PROFILES} from "../pokeweb/abilityNativeRuntime";
import {ABILITY_RULE_EFFECTS,EMPTY_ABILITY_RULE,encodeAbilityRules,validateAbilityRule} from "../pokeweb/abilityRules";
import {renderItemRuleForm} from "../ui/itemRuleEditor";
import {ABILITY_EFFECTS_DLL_PATH,buildAbilityRuleModule,CURRENT_ABILITY_RUNTIME_VERSION,inspectAbilityEffects} from "../pokeweb/abilityEffectsModel";
import {parseRpm,writeRpm} from "../pokeweb/rpm";
import {makeItemEffectsProject} from "./fixtures/itemEffectsProject";
import {makeBw1AbilityProject} from "./fixtures/blackAbilityProject";

const make=(value=1,moveClass=1)=>validateAbilityRule({...EMPTY_ABILITY_RULE,effects:[{kind:"abilityRecipe:protectBypass",value,parameters:{moveClass}}]});
const recordEffect=(bytes:Uint8Array,id:number)=>{const at=readU16(bytes,id*2);return at+4+bytes[at+1]*4;};
describe("hit through protection ability",()=>{
 it("imports Unseen Fist and Piercing Drill as editable contact recipes",()=>{
  const unseen=abilityImport(260),drill=abilityImport(1000);
  expect(unseen).toMatchObject({label:"Unseen Fist",generation:8});expect(drill).toMatchObject({label:"Piercing Drill",group:"Pokémon Champions"});
  expect(unseen.rule).toEqual(make(1));expect(drill.rule).toEqual(make(.25));
  for(const rule of [unseen.rule,drill.rule])expect(abilityRuleEvents(rule,NATIVE_ABILITY_PROFILES)).toEqual([]);
  const b=encodeAbilityRules(new Map([[165,unseen.rule],[166,drill.rule]]));
  for(const [id,ratio] of [[165,4096],[166,1024]] as const){const e=recordEffect(b,id);expect(b[e]).toBe(172);expect(b[e+1]).toBe(1);expect(readU16(b,e+2)).toBe(ratio);expect(b[e+7]).toBe(0);}
  for(const value of [.001,.25,.5,1])expect(()=>make(value)).not.toThrow();
  for(const value of [0,1.001,2,NaN])expect(()=>make(value)).toThrow();
 });
 it("keeps vanilla move-flag filters on the recipe",()=>{
  const b=encodeAbilityRules(new Map([[165,make(.5,256)]])),e=recordEffect(b,165);
  expect(b[e+1]).toBe(0);expect(b[e+7]&2).toBe(2);
 });
 it("renders the templates and the editable damage multiplier",()=>{
  const {project}=makeItemEffectsProject();
  const html=renderItemRuleForm(project,{...make(.25),consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS,presets:ABILITY_IMPORT_LIBRARY});
  expect(html).toContain("Unseen Fist");expect(html).toContain("Piercing Drill");expect(html).toContain("Hit through protection");expect(html).toContain("damage through protection");expect(html).toContain('value="0.25"');
 });
 it.each(["B","W","BW2"])("links the checked protection services in %s and round-trips",game=>{
  const {project}=game==="BW2"?makeItemEffectsProject(0,0,true,true):makeBw1AbilityProject(game as "B"|"W");
  const rules=new Map([[165,make(1)],[166,make(.25)]]),dll=buildAbilityRuleModule(project,rules);
  expect(dll.metadata).toMatchObject({PokewebAbilityProtect:1,PokewebAbilityStrikes:1});
  const api=dll.symbols.find(s=>s.name==="AbilityProtectApi");expect(api).toBeDefined();
  for(const n of [0,1])expect(readU32(dll.code,api!.address+n*4)&1).toBe(1);
  // No native code is patched for this primitive: only the shared dispatcher wrapper.
  expect(dll.relocations.some(r=>r.target.type!=="OFFSET"&&r.target.module!=="base"&&/Protect/u.test(dll.symbols[r.sourceSymbolIndex]?.name??""))).toBe(false);
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(dll,{ident:"DLXF"})}};
  expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:CURRENT_ABILITY_RUNTIME_VERSION,rules});
 });
 it("leaves the protection services unlinked without the recipe",()=>{
  const {project}=makeItemEffectsProject(0,0,true,true);
  const dll=buildAbilityRuleModule(project,new Map([[165,validateAbilityRule({...EMPTY_ABILITY_RULE,effects:[{kind:"abilityRecipe:additionalStrike",value:.5}]})]]));
  const api=dll.symbols.find(s=>s.name==="AbilityProtectApi")!;expect(api).toBeDefined();
  expect(readU32(dll.code,api.address)).toBe(0);expect(readU32(dll.code,api.address+4)).toBe(0);
 });
 it("recognizes the previous strike runtime and updates it with its recipes intact",()=>{
  expect(CURRENT_ABILITY_RUNTIME_VERSION).toBe(13);
  const {project}=makeItemEffectsProject(0,0,true,true);
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:new Uint8Array(readFileSync(new URL("./fixtures/ability-runtime-v12/strike.dll",import.meta.url)))}};
  const before=inspectAbilityEffects(project);expect(before).toMatchObject({editable:true,runtimeVersion:12});
  expect(parseRpm(project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH],{allowedMagics:["DLXF"]}).metadata.PokewebAbilityProtect).toBeUndefined();
  const upgraded=new Map([...before.rules,[166,make(.25)]]);
  project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(buildAbilityRuleModule(project,upgraded),{ident:"DLXF"});
  expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:13,rules:upgraded});
 });
 it.each(["GetTurnFlag","BattleEvent_SeekItem"])("rejects a modified %s before installing",name=>{
  const {project,offsets}=makeItemEffectsProject(0,0,true,true);
  expect(()=>buildAbilityRuleModule(project,new Map([[165,make()]]))).not.toThrow();
  const at=offsets.get(name);expect(at).toBeDefined();project.overlays[167]![at!+2]^=0xff;
  expect(()=>buildAbilityRuleModule(project,new Map([[165,make()]]))).toThrow();
 });
});
