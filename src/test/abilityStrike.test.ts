import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {readU16} from "../nds/binary";
import {ABILITY_IMPORT_LIBRARY,abilityImport} from "../pokeweb/abilityLibrary";
import {abilityRuleEvents} from "../pokeweb/abilityEvents";
import {NATIVE_ABILITY_PROFILES} from "../pokeweb/abilityNativeRuntime";
import {ABILITY_RULE_EFFECTS,EMPTY_ABILITY_RULE,encodeAbilityRules,validateAbilityRule} from "../pokeweb/abilityRules";
import {renderItemRuleForm} from "../ui/itemRuleEditor";
import {ABILITY_EFFECTS_DLL_PATH,buildAbilityRuleModule,CURRENT_ABILITY_RUNTIME_VERSION,inspectAbilityEffects} from "../pokeweb/abilityEffectsModel";
import {writeRpm} from "../pokeweb/rpm";
import {makeItemEffectsProject} from "./fixtures/itemEffectsProject";
import {makeBw1AbilityProject} from "./fixtures/blackAbilityProject";

const make=(value=.25)=>validateAbilityRule({...EMPTY_ABILITY_RULE,effects:[{kind:"abilityRecipe:additionalStrike",value}]});
describe("additional strike ability",()=>{
 it("imports the editable Parental Bond recipe with no broad event subscription",()=>{
  const rule=abilityImport(185).rule;expect(rule).toEqual(make());expect(abilityRuleEvents(rule,NATIVE_ABILITY_PROFILES)).toEqual([]);
  const b=encodeAbilityRules(new Map([[165,rule]])),at=readU16(b,330);expect(b[at+4+b[at+1]*4]).toBe(171);expect(readU16(b,at+4+b[at+1]*4+2)).toBe(1024);
  for(const value of [.125,.25,.5,1,3,8])expect(()=>make(value)).not.toThrow();
  for(const value of [0,.124,8.001,NaN])expect(()=>make(value)).toThrow();
  expect(()=>validateAbilityRule({...rule,effects:[...rule.effects,...rule.effects]})).toThrow(/at most one/u);
 });
 it("renders the template and editable second-hit multiplier",()=>{
  const {project}=makeItemEffectsProject();
  const html=renderItemRuleForm(project,{...make(),consumable:false},{ability:true,definitions:ABILITY_RULE_EFFECTS,presets:ABILITY_IMPORT_LIBRARY});
  expect(html).toContain("Parental Bond");expect(html).toContain("Additional strike");expect(html).toContain("second-hit damage");expect(html).toContain('value="0.25"');
 });
 it.each(["B","W","BW2"])("links exactly two checked strike calls in %s and verifies round-trip metadata",game=>{
  const {project}=game==="BW2"?makeItemEffectsProject(0,0,true,true):makeBw1AbilityProject(game as "B"|"W");
  const rules=new Map([[165,make(.5)]]),dll=buildAbilityRuleModule(project,rules);
  expect(dll.metadata.PokewebAbilityStrikes).toBe(1);
  for(const name of ["AbilityStrikeCountSite","AbilityStrikeEndSite"])expect(dll.relocations.filter(r=>dll.symbols[r.sourceSymbolIndex].name===name)).toHaveLength(1);
  project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(dll,{ident:"DLXF"})}};
  expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:CURRENT_ABILITY_RUNTIME_VERSION,rules});
 });
 it("does not add strike hooks when no strike recipe is installed",()=>{
  const {project}=makeItemEffectsProject(0,0,true,true),dll=buildAbilityRuleModule(project,new Map([[165,validateAbilityRule(EMPTY_ABILITY_RULE)]]));
  expect(dll.relocations.some(r=>dll.symbols[r.sourceSymbolIndex].name==="AbilityStrikeCountSite")).toBe(false);
 });
 it("recognizes the previous environment runtime and updates its recipe",()=>{
  const {project}=makeItemEffectsProject(0,0,true,true);project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:new Uint8Array(readFileSync(new URL("./fixtures/ability-runtime-v11/guard.dll",import.meta.url)))}};
  const before=inspectAbilityEffects(project);expect(before).toMatchObject({editable:true,runtimeVersion:11});
  project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(buildAbilityRuleModule(project,before.rules),{ident:"DLXF"});
  expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:CURRENT_ABILITY_RUNTIME_VERSION,rules:before.rules});
 });
 it("rejects a modified native strike boundary before installing",()=>{
  const {project,offsets}=makeItemEffectsProject(0,0,true,true);project.overlays[167]![offsets.get("AbilityStrikeBoundary")!+46]^=1;
  expect(()=>buildAbilityRuleModule(project,new Map([[165,make()]]))).toThrow();
 });
 it.each([54,94,184])("rejects a redirected native strike dependency at +%i",offset=>{
  const {project,offsets}=makeItemEffectsProject(0,0,true,true);project.overlays[167]![offsets.get("AbilityStrikeBoundary")!+offset]^=1;
  expect(()=>buildAbilityRuleModule(project,new Map([[165,make()]]))).toThrow();
 });
});
