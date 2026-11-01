/** Compose a BW1 move-service candidate from independently inspected ROM data. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const [inspectionPath, abilityPath, outputPath] = process.argv.slice(2);
assert(outputPath, "Usage: INSPECTION.json ABILITY_BINDINGS.json OUTPUT.json");
const inspection=JSON.parse(await readFile(inspectionPath,"utf8"));
const ability=JSON.parse(await readFile(abilityPath,"utf8"));
assert(["B","W"].includes(ability.game),"Unrecognized BW1 ability catalog");
assert.equal(inspection.game,ability.game==="B"?"IRBO":"IRAO");
assert.equal(inspection.overlay,93);assert.equal(inspection.count,258);
assert.equal(Object.keys(inspection.getters).length,24);
assert.equal(inspection.moveParamSites.length,8);
const functions:Record<string,any>={...ability.functions,...inspection.functions};
// The selected functions have matching native roles and call sequences. Their
// register-level hook contracts and battle behavior must still be validated.
const aliases:Record<string,string>={
  MoveEvent_AddItem:"BW1_HAND_WAZA_AddMoveHandler",
  DoesMoveEventExist:"BW1_HAND_WAZA_CanAddMoveHandler",
  sub_21AB1BC:"BW1_BTL_SERVER_FLOW_CalcFlinchChance",
  sub_21ABB90:"BtlServerFlow_MonIDToPos",
  ResetSpActPriority:"BW1_BTL_POKEPARAM_ClearSubstitute",
  sub_21A7CB0:"BW1_BTL_SERVER_FLOW_RemoveSubstitute",
  sub_21AAB90:"ServerEvent_CheckTypeEffectiveness",
  sub_21A57C4:"BW1_BTL_SERVER_FLOW_ThawTargetsHitByFireMove",
  CritAtkDefLevel:"BW1_BTL_POKEPARAM_GetStatForCrit",
  sub_21AA994:"ServerControl_CheckMoveEffectiveness",
  sub_21A4530:"BW1_BTL_SERVER_FLOW_BuildDamageList",
  ServerEvent_CalcDamage:"BW1_BTL_SERVER_FLOW_CalcMoveDamage",
  sub_21A5534:"BW1_BTL_SERVER_FLOW_ProcMoveAfterDamageEvents",
  sub_21AEDEC:"BW1_BTL_SERVER_FLOW_QueryTargetChangeEvent",
  ServerEvent_GetAttackPower:"BW1_BTL_SERVER_FLOW_CalcAttackStat",
};
for(const[name,original]of Object.entries(aliases)){
  assert(functions[original],`Missing candidate service ${original}`);
  functions[name]=structuredClone(functions[original]);
}
for(const call of functions.sub_21A7CB0.calls){
  if(call.target==="BW1_BTL_POKEPARAM_ClearSubstitute")call.target="ResetSpActPriority";
  if(call.target.startsWith("BW1_Veneer_")&&call.offset===0x14){functions.sub_21B1474=structuredClone(functions[call.target]);call.target="sub_21B1474";}
}
for(const[index,site]of inspection.moveParamSites.entries()){
  assert.equal(site.hex.length,96);assert.equal(site.mask.length,96);
  functions[`MoveParamSite${index}`]={hex:site.hex,mask:site.mask,module:"93",calls:[{offset:16,target:"ServerEvent_GetMoveParam"}]};
}
// These callers are patched at their native service calls. Reject a catalog
// whose call layout differs rather than relying on a fixed address.
for(const[caller,offset,target]of [
  ["sub_21AA994",0x32,"ServerEvent_CheckTypeEffectiveness"],["sub_21AA994",0x56,"ServerEvent_CheckTypeEffectiveness"],
  ["sub_21A4530",0xfa,"IsSubstituteActive"],["ServerEvent_CalcDamage",0xde,"ServerEvent_GetWeather"],
  ["sub_21A5534",0x0e,"BW1_BTL_SERVER_FLOW_ThawTargetsHitByFireMove"],["sub_21AEDEC",0x3c,"BattleEvent_CallHandlers"],
  ["ServerEvent_GetAttackPower",0x4e,"BattleEvent_CallHandlers"],["ServerEvent_GetAttackPower",0x86,"BW1_BTL_POKEPARAM_GetStatForCrit"],
] as const)assert(functions[caller].calls.some((call:{offset:number;target:string})=>call.offset===offset&&call.target===target),`Unreviewed call ${caller}+${offset.toString(16)}`);
const mold=ability.profiles.find((profile:{id:number})=>profile.id===104);assert(mold,"Missing Mold Breaker profile");
const abilityCatalog={rows:ability.rows,tableRefs:ability.tableRefs,profiles:[mold]};
await writeFile(outputPath,JSON.stringify({game:inspection.game,overlay:93,functions,getters:inspection.getters,rows:inspection.rows,tableRefs:[{offset:108,column:0},{offset:116,column:4}],countRef:112,abilityCatalog})+"\n");
console.log(`${inspection.game}: candidate signatures for ${Object.keys(functions).length} services and ${Object.keys(inspection.getters).length} move operations`);
