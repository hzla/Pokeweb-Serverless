/** Reviewed ABI operands. Generation rejects missing calls or changed instruction shapes. */
import { readU16 } from "../../src/nds/binary";
import type { NativeAbilityParameter, AbilityParameterSite } from "../../src/pokeweb/abilityNativeParameters";
type Profile = {id:number; events:Array<{handler:string;event:number}>; parameters?:NativeAbilityParameter[]; multipliers?:unknown[]; eventGates?:Array<{handler:string;anyOf:Array<{key:string;original:number;equals:number}>}>};
type FunctionBinding = {hex:string;calls:Array<{offset:number;target:string}>;tails?:Array<{offset:number;target:string}>};
export function addAbilityParameterCatalog(profiles: Profile[], raw: Record<string, unknown>): void {
 const functions=raw as Record<string,FunctionBinding>;
 const bytes=(name:string)=>Uint8Array.from(Buffer.from(functions[name].hex,"hex"));
 const refs=(name:string,target:string)=>[...functions[name].calls,...functions[name].tails??[]].filter(c=>c.target===target);
 for(const p of profiles){
  const controls:NativeAbilityParameter[]=[];
  const roots=[...new Set(p.events.map(e=>e.handler))];
  const add=(key:string,label:string,kind:NativeAbilityParameter["kind"],original:number,sites:AbilityParameterSite[],min=kind==="type"?0:1,max=kind==="type"?17:kind==="stat"?7:kind==="weather"?4:kind==="status"?7:kind==="majorStatus"?5:255,step=1,choices?:number[])=>{
   if(!sites.length)throw new Error(`Missing ability operand ${p.id}/${key}`);
   const existing=controls.find(c=>c.key===key);if(existing){existing.sites.push(...sites);return;}
   controls.push({key,label,kind,original,min,max,step,...(choices?{choices}:{}),sites});
  };
  const args=(name:string,target:string,argument:number,scale=1):AbilityParameterSite[]=>refs(name,target).map(c=>({handler:name,offset:c.offset,mode:"argument",argument,...(scale!==1?{scale}:{})}));
  const arg=(key:string,label:string,kind:NativeAbilityParameter["kind"],original:number,name:string,target:string,argument:number,min?:number,max?:number,step?:number,scale=1)=>add(key,label,kind,original,args(name,target,argument,scale),min,max,step);
  const cmp=(name:string,value:number,after=0):AbilityParameterSite[]=>{
   const code=bytes(name),result:AbilityParameterSite[]=[];
   for(let at=after;at+2<=code.length;at+=2)if((readU16(code,at)&0xff00)===0x2800&&code[at]===value)result.push({handler:name,offset:at,mode:"immediate"});
   return result;
  };
  const compare=(key:string,label:string,kind:NativeAbilityParameter["kind"],original:number,name:string,after=0,min?:number,max?:number)=>add(key,label,kind,original,cmp(name,original,after),min,max);
  const percent=(key:string,label:string,original:number,name:string,target:string)=>add(key,label,"number",original,refs(name,target).map(c=>({handler:name,offset:c.offset,mode:"hpPercent",minimum:target==="DivideMaxHPZeroCheck"?1:0})),.01,100,.01);
  const fields=(name:string,which:number,field:number,width:1|4):AbilityParameterSite[]=>{
   const c=refs(name,"BattleHandler_PopWork")[which];if(!c)throw new Error(`Missing stat work ${name}/${which}`);
   return [{handler:name,offset:c.offset,mode:"store",argument:1,field,width}];
  };
  const stage=(name:string,stat:number,amount:number,which=0,suffix="",statLabel="Stat",amountLabel="Stages")=>{
   if(stat)add(`stat${suffix}`,statLabel,"stat",stat,fields(name,which,4,4));
   add(`stages${suffix}`,amountLabel,"number",amount,fields(name,which,12,1),amount<0?-6:1,amount<0?-1:6);
  };
  // Fixed native wrappers: edit arguments rather than a constant shared with flags.
  for(const name of roots){
   if(refs(name,"CommonLowHPBoostAbility").length){
    const original=({65:11,66:9,67:10,68:6} as Record<number,number>)[p.id];
    arg("type","Move type","type",original,name,"CommonLowHPBoostAbility",2);
    percent("hpThreshold","HP at most (%)",100/3,"CommonLowHPBoostAbility","DivideMaxHp");
    arg("power","Damage multiplier","number",1.5,"CommonLowHPBoostAbility","BattleEventVar_MulValue",1,.125,8,.001,4096);
   }
   if(refs(name,"CommonDamageRecoverCheck").length){
    const type=({10:12,11:10,18:9,31:12,78:12,87:10,114:10,157:11} as Record<number,number>)[p.id];
    if(type!==undefined)arg("type","Absorbed type","type",type,name,"CommonDamageRecoverCheck",2);
   }
   if(refs(name,"CommonMoveTargetChangeToMe").length)arg("type","Redirected / absorbed type","type",p.id===31?12:10,name,"CommonMoveTargetChangeToMe",3);
   if(refs(name,"CommonTypeNoEffectRankUp").length){
    arg("stat","Stat raised","stat",p.id===78?5:p.id===157?1:3,name,"CommonTypeNoEffectRankUp",2);
    arg("stages","Stages","number",1,name,"CommonTypeNoEffectRankUp",3,1,6);
   }
   if(refs(name,"CommonTypeRecoverHP").length)percent("healPercent","Healing (% max HP)",25,"CommonTypeRecoverHP","DivideMaxHPZeroCheck");
   if(refs(name,"CommonWeatherChangeAbility").length)arg("weatherSet","Weather created","weather",({2:2,45:4,70:1,117:3} as Record<number,number>)[p.id],name,"CommonWeatherChangeAbility",2,0,4);
   if(refs(name,"CommonWeatherRecoveryAbility").length){arg("weatherHeal","Healing weather","weather",p.id===44?2:3,name,"CommonWeatherRecoveryAbility",2,0,4);percent("healPercent","Healing (% max HP)",6.25,"CommonWeatherRecoveryAbility","DivideMaxHPZeroCheck");}
   if(refs(name,"CommonStatDropGuardCheck").length)arg("guardStat","Protected stat","stat",({29:8,73:8,51:6,52:1,145:2} as Record<number,number>)[p.id],name,"CommonStatDropGuardCheck",3,1,8);
  }
  const primaryStatus=({7:1,12:7,15:2,17:5,20:6,40:3,41:4,72:2} as Record<number,number>)[p.id];
  if(primaryStatus!==undefined)for(const name of roots)for(const target of ["HandlerCommonGuardStatus","CommonAbilityCureStatus","CommonAbilityCureStatusCore"]){
   const calls=refs(name,target);if(!calls.length)continue;
   add("immunityStatus","Status immunity / cure","status",primaryStatus,[{handler:name,offset:calls[0].offset,mode:"argument",argument:2}]);
   if(calls.length>1)add("extraImmunity","Additional immunity","status",14,[{handler:name,offset:calls[1].offset,mode:"argument",argument:2}],1,14,1,[1,2,3,4,5,6,7,14]);
  }
  if([15,72].includes(p.id))p.eventGates=[{handler:"HandlerInsomniaYawnCheck",anyOf:[{key:"immunityStatus",original:2,equals:2},{key:"extraImmunity",original:14,equals:14}]}];
  if([9,38,49].includes(p.id))for(const name of roots){const status=({9:1,38:5,49:4} as Record<number,number>)[p.id];
   arg("contactStatus","Contact status","majorStatus",status,name,"BtlCalc_MakeStatusCondition",0);
   arg("contactStatus","Contact status","majorStatus",status,name,"CommonContactStatusAbility",2);
  }
  if(p.id===143){
   const name="HandlerPoisonTouch";
   add("contactStatus","Inflicted status","majorStatus",5,[
    ...args(name,"BtlCalc_MakeStatusCondition",0),
    ...refs(name,"BattleHandler_PopWork").map(c=>({handler:name,offset:c.offset,mode:"store" as const,argument:1,field:4,width:4 as const})),
    // Use the engine's normal status message instead of the donor's fixed poison text.
    ...args(name,"BattleHandler_StrSetup",1,0),
   ]);
   arg("activationChance","Activation chance (%)","number",30,name,"AbilityEvent_RollEffectChance",1,0,100);
  }
  if(p.id===27){const name="HandlerEffectSpore",code=bytes(name);for(const [i,original]of[5,1,2].entries()){
   const sites:AbilityParameterSite[]=[];for(let at=0;at<code.length-2;at+=2)if(readU16(code,at)===(0x2400|original))sites.push({handler:name,offset:at,mode:"immediate"});
   add(`randomStatus${i+1}`,`Random status ${i+1}`,"majorStatus",original,sites);
  }}
  for(const [id,name,a,b]of [[47,"HandlerThickFat",14,9]] as const)if(p.id===id){compare("type1","Reduced type 1","type",a,name);compare("type2","Reduced type 2","type",b,name);}
  if(p.id===18)compare("type","Absorbed / boosted type","type",9,"HandlerFlashFirePower");
  if(p.id===85){compare("type","Reduced type","type",9,"HandlerHeatproofPower");compare("residualStatus","Residual status","status",4,"HandlerHeatproofStatus");}
  if(p.id===87)compare("weakType","Vulnerable type","type",9,"HandlerDrySkinDamageRecover");
  if(p.id===113)compare("immuneType","Immunity bypassed","type",7,"HandlerScrappy");
  if(p.id===42)arg("trapType","Trapped type","type",8,"HandlerMagnetPull","DoesMonHaveType",1);
  if(p.id===96)arg("type","Move type","type",0,"HandlerNormalize","BattleEventVar_RewriteValue",1);
  if(p.id===154)compare("triggerType","Triggering type","type",16,"HandlerJustified");
  if(p.id===155)for(const[i,t]of[16,6,7].entries())add(`triggerType${i+1}`,`Triggering type ${i+1}`,"type",t,[{handler:"HandlerRattled",offset:refs("HandlerRattled","BattleEventVar_GetValue")[2].offset,mode:"resultMap",original:t}]);
  if(p.id===159){const after=refs("HandlerSandForce","GetWeather")[0].offset+8;for(const[i,t]of[4,5,8].entries())compare(`type${i+1}`,`Boosted type ${i+1}`,"type",t,"HandlerSandForce",after);}
  for(const[id,name,status]of[[77,"HandlerTangledFeet",6],[123,"HandlerBadDreams",2],[137,"HandlerToxicBoost",5],[138,"HandlerFlareBoost",4]] as const)if(p.id===id)arg("triggerStatus","Required status","status",status,name,"CheckCondition",1);
  if(p.id===90)compare("triggerStatus","Healing status","status",5,"HandlerPoisonHeal");
  if(p.id===28){const name="HandlerSynchronize",code=bytes(name);for(const[i,status]of[5,1,4].entries()){
   let offset=-1;for(let at=0;at<code.length-2;at+=2)if(readU16(code,at)===(0x2d00|status)){offset=at;break;}
   if(offset<0)throw new Error("Changed Synchronize status checks");add(`reflectedStatus${i+1}`,`Reflected status ${i+1}`,"majorStatus",status,[{handler:name,offset,mode:"immediate"}]);
  }}
  for(const name of roots){
   if([5,136].includes(p.id)&&refs(name,"IsMonFullHP").length)add("hpMinimum","HP at least (%)","number",100,refs(name,"IsMonFullHP").map(c=>({handler:name,offset:c.offset,mode:"hpAtLeast"})),.01,100,.01);
   const category=({37:1,74:1,62:1,63:1,55:1,94:2,133:1,137:1,138:2,158:0,147:0} as Record<number,number>)[p.id];
   if(category!==undefined&&(refs(name,"PML_MoveGetCategory").length||["HandlerMarvelScale","HandlerWeakArmor","HandlerToxicBoost","HandlerFlareBoost","HandlerWonderSkin"].includes(name)))compare("category","Move category","category",category,name,0,0,2);
  }
  if(p.id===147){compare("accuracyCap","Status accuracy cap (%)","number",50,"HandlerWonderSkin",0,1,100);arg("accuracyCap","Status accuracy cap (%)","number",50,"HandlerWonderSkin","BattleEventVar_RewriteValue",1,1,100);}
  if(p.id===87){compare("damageWeather","Damage weather","weather",1,"HandlerDrySkinWeather",0,0,4);compare("healWeather","Healing weather","weather",2,"HandlerDrySkinWeather",0,0,4);}
  if(p.id===94)compare("damageWeather","Damage weather","weather",1,"HandlerSolarPowerWeather",0,0,4);
  for(const[id,name,stat,amount]of[[3,"HandlerSpeedBoost",5,1],[80,"HandlerSteadfast",5,1],[128,"HandlerDefiant",1,2],[153,"HandlerMoxie",1,1],[154,"HandlerJustified",1,1],[155,"HandlerRattled",5,1]] as const)if(p.id===id)stage(name,stat,amount);
  if(p.id===22)stage("HandlerIntimidateMemberIn",0,-1);
  if(p.id===88)stage("HandlerDownload",0,1);
  if(p.id===83){stage("HandlerAngerPoint",1,6);arg("stat","Stat raised","stat",1,"HandlerAngerPoint","BattleMon_GetStatRaiseRoom",1);}
  if(p.id===133){
   stage("HandlerWeakArmor",2,-1,0,"Down","Stat lowered","Stages lowered");stage("HandlerWeakArmor",5,1,1,"Up","Stat raised","Stages raised");
   const calls=refs("HandlerWeakArmor","IsStatChangeValid");if(calls.length!==2)throw new Error("Changed Weak Armor stat checks");
   for(const[i,suffix]of["Down","Up"].entries())for(const[key,argument]of[[`stat${suffix}`,1],[`stages${suffix}`,2]] as const)controls.find(c=>c.key===key)!.sites.push({handler:"HandlerWeakArmor",offset:calls[i].offset,mode:"argument",argument});
  }
  if(p.id===141){stage("HandlerMoody",0,2,0,"Up","","Stages raised");stage("HandlerMoody",0,-1,1,"Down","","Stages lowered");}
  const hpDivisors:Record<string,number[]>={HandlerRoughSkin:[8],HandlerAftermath:[4],HandlerPoisonHeal:[8],HandlerBadDreams:[8],HandlerSolarPowerWeather:[8],HandlerDrySkinWeather:[8,8],HandlerRegenerator:[3],HandlerDefeatist:[2]};
  for(const name of roots)if(hpDivisors[name])for(const[i,divisor]of hpDivisors[name].entries()){
   const target=name==="HandlerDefeatist"?"DivideMaxHp":"DivideMaxHPZeroCheck",call=refs(name,target)[i];if(!call)throw new Error(`Missing HP amount ${name}`);
   add(`hpPercent${i}`,name==="HandlerDefeatist"?"HP at most (%)":name==="HandlerRegenerator"||name==="HandlerPoisonHeal"?"Healing (% max HP)":name==="HandlerDrySkinWeather"?i?"Rain healing (% max HP)":"Sun damage (% max HP)":"Damage (% max HP)","number",100/divisor,[{handler:name,offset:call.offset,mode:"hpPercent",minimum:target==="DivideMaxHPZeroCheck"?1:0}],.01,100,.01);
  }
  const rolls:Record<string,number>={HandlerShedSkin:33,HandlerCursedBody:30,HandlerHealer:30,HandlerHarvest:50};
  for(const name of roots)if(rolls[name])arg("chance","Activation chance (%)","number",rolls[name],name,"AbilityEvent_RollEffectChance",1,1,100);
  if(p.id===1)arg("flinchChance","Flinch chance (%)","number",10,"HandlerStench","BattleEventVar_RewriteValue",1,1,100);
  if(p.id===91)arg("stab","STAB multiplier","number",2,"HandlerAdaptability","BattleEventVar_RewriteValue",1,.125,8,.001,4096);
  if(p.id===101)compare("powerThreshold","Maximum move power","number",60,"HandlerTechnician",0,1,255);
  if(p.id===112){const name="HandlerSlowStartTurnCheck",code=bytes(name),sites:AbilityParameterSite[]=[];for(let at=0;at<code.length-2;at+=2)if((readU16(code,at)&0xf800)===0x2800&&code[at]===5)sites.push({handler:name,offset:at,mode:"immediate"});add("turns","Duration (turns)","number",5,sites,1,255);}
  // Literal/non-shift fixed-point multipliers omitted by the original narrow control.
  const ratios:Record<string,number[]>={HandlerCompoundEyes:[1.3],HandlerSandVeil:[.8],HandlerSnowCloak:[.8],HandlerHustleAccuracy:[.8],HandlerIronFist:[1.2],HandlerReckless:[1.2],HandlerSheerForcePower:[1.3],HandlerAnalytic:[1.3],HandlerSandForce:[1.3],HandlerVictoryStar:[1.1],HandlerRivalry:[1.25,.75]};
  for(const name of roots)if(ratios[name])for(const[i,original]of ratios[name].entries()){
   const c=refs(name,"BattleEventVar_MulValue")[i];if(!c)throw new Error(`Missing ratio ${name}/${i}`);
   add(`ratio${i}`,name.includes("Accuracy")||[8,14,81,162].includes(p.id)?"Accuracy multiplier":p.id===79?i?"Opposite gender multiplier":"Same gender multiplier":"Damage multiplier","number",original,[{handler:name,offset:c.offset,mode:"argument",argument:1,scale:4096}],.125,8,.001);
  }
  if(p.id===55)arg("attackRatio","Attack multiplier","number",1.5,"HandlerHustlePower","fixed_round",1,.125,8,.001,4096);
  for(const name of roots)if(["HandlerSuperLuck","HandlerPrankster","HandlerPressure"].includes(name)){
   const code=bytes(name),sites:AbilityParameterSite[]=[];for(let at=0;at<code.length-2;at+=2)if((readU16(code,at)&0xffc0)===0x1c40)sites.push({handler:name,offset:at,mode:"smallImmediate"});
   add("bonus",p.id===105?"Critical stage bonus":p.id===158?"Priority bonus":"Extra PP cost","number",1,sites,1,p.id===105?4:7);
  }
  if([32,86].includes(p.id)){
   const name=p.id===32?"HandlerSereneGrace":"HandlerSimple",code=bytes(name),sites:AbilityParameterSite[]=[];
   const shiftBase=p.id===32?16:0;
   for(let at=0;at<code.length-2;at+=2)if((readU16(code,at)&0xf800)===0&&(readU16(code,at)>>6&31)===shiftBase+1)sites.push({handler:name,offset:at,mode:"shiftMultiplier",shiftBase});
   add("amountMultiplier",p.id===32?"Secondary chance multiplier":"Stat change multiplier","number",2,sites,1,8,1,[1,2,4,8]);
  }
  for(const control of controls)for(const site of control.sites)if(["immediate","smallImmediate","shiftMultiplier"].includes(site.mode))site.expected=readU16(bytes(site.handler),site.offset);
  if(controls.length)p.parameters=controls;
 }
}
