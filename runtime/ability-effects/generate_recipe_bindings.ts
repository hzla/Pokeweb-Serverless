/** Checked native interfaces for the second recipe vocabulary. */
import {readFile,writeFile} from "node:fs/promises";
import {NintendoDSRom} from "../../src/nds/rom";
import {decompressCode} from "../../src/nds/codeCompression";
import {readU16,readU32} from "../../src/nds/binary";
import native from "../../src/assets/data/itemNativeBindings.json";
import item from "../../src/assets/data/itemRuleBindings.json";
import ability from "../../src/assets/data/abilityBindings.json";
const BATTLE_RUNTIME_SIGNATURES:Record<string,unknown>={...native.functions,...item.functions,...ability.functions};
const [input,overlaySymbols,armSymbols,output]=process.argv.slice(2);
if(!output)throw new Error("Usage: ROM OVERLAY_SYMBOLS ARM9_SYMBOLS OUTPUT");
const rom=new NintendoDSRom(new Uint8Array(await readFile(input)),{fileData:"view"}),ov=rom.loadArm9Overlays([167]).get(167)!,arm=decompressCode(rom.arm9);
type S={name:string,address:number,size:number,module:string,thumb:boolean};const symbols=new Map<string,S>();
for(const[path,module]of [[overlaySymbols,"167"],[armSymbols,"ARM9"]])for(const m of (await readFile(path,"utf8")).matchAll(/^(\w+) kind:function\((thumb|arm),size=(0x[\da-f]+)\) addr:(0x[\da-f]+)/gmu))symbols.set(m[1],{name:m[1],address:Number(m[4]),size:Number(m[3]),module,thumb:m[2]==="thumb"});
const reverse=new Map([...symbols.values()].map(s=>[s.address,s.name]));
const names=["BtlServerFlow_IsTargetOutOfRange","GetAdditionalConditionFlag","BattleEvent_CallHandlersCore","BattleEvent_Init","ServerEvent_CheckCritical","ServerControl_CheckMoveEffectiveness","ServerControl_ChangeHeldItem","BattleHandler_ForceUseItem","BattleEvent_CallHandlers","BattleEventVar_Push","BattleEventVar_Pop","BattleEventVar_SetConstValue","SetConditionTurns","MakeConditionPermanentTurnsParam","ServerEvent_GetMoveParam","IsAllyMonID","BtlServerFlow_IsMonInBattle","BtlServerFlow_IsSideEffectSet","GetSideFromMonID","PML_ItemIsBerry","CommonAbilityCureStatusCore","BtlCalc_MakeDefaultCondition","MakeConditionParamPermanent","GetTurnCounter","GetFieldWeather","BtlServerFlow_GetSideEffectLayers","ServerEvent_DamageReaction"];
const copied=new Set(["BattleEvent_CallHandlersCore","BattleEvent_Init","ServerEvent_GetMoveParam","ServerEvent_CheckCritical","ServerControl_CheckMoveEffectiveness","ServerControl_ChangeHeldItem","BattleHandler_ForceUseItem"]);
const functions:Record<string,unknown>={};
for(let i=0;i<names.length;i++){
 const name=names[i];if(BATTLE_RUNTIME_SIGNATURES[name])continue;
 const s=symbols.get(name);if(!s)throw new Error(`Missing native interface ${name}`);
 const data=s.module==="167"?ov.data:arm,base=s.module==="167"?ov.ramAddress:rom.arm9RamAddress,bytes=data.slice(s.address-base,s.address-base+s.size),mask=new Uint8Array(bytes.length).fill(255),calls:Array<{offset:number,target:string}>=[];
 if(s.thumb)for(let at=0;at+4<=bytes.length;at+=2){const hi=readU16(bytes,at),lo=readU16(bytes,at+2);if((hi&0xf800)===0xf000&&[0xf800,0xe800].includes(lo&0xf800)){let d=((hi&2047)<<12)|((lo&2047)<<1);if(d&0x400000)d-=0x800000;let target=s.address+at+4+d;if((lo&0xf800)===0xe800)target&=~3;const callee=reverse.get(target);if(!callee&&copied.has(name))throw new Error(`Unknown call in ${name}`);mask.fill(0,at,at+4);if(callee){calls.push({offset:at,target:callee});if(copied.has(name)&&!names.includes(callee)&&!BATTLE_RUNTIME_SIGNATURES[callee])names.push(callee);}at+=2;}}
 for(let at=0;at+4<=bytes.length;at+=2)if((s.address+at)%4===0&&readU32(bytes,at)>=0x02000000&&readU32(bytes,at)<0x02400000)mask.fill(0,at,at+4);
 const variants=[];
 if(name==="ServerControl_CheckMoveEffectiveness"){
  if(readU16(bytes,0x12)!==0x2811||readU16(bytes,0x14)!==0xd102)throw new Error("Unrecognized type-range check");
  const fairy=bytes.slice();fairy[0x12]=18;fairy[0x15]=0xdb;variants.push({hex:Buffer.from(fairy).toString("hex"),mask:Buffer.from(mask).toString("hex")});
 }
 functions[name]={...(variants.length?{variants}:{}),hex:Buffer.from(bytes).toString("hex"),mask:Buffer.from(mask).toString("hex"),calls,module:s.module,...(!s.thumb?{thumb:false}:{})};
}
await writeFile(output,JSON.stringify({version:1,functions})+"\n");console.log(`${Object.keys(functions).length} additional native recipe interfaces.`);
