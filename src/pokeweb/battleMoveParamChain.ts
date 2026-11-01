import type { RpmModule } from "./rpm";

/** A checked two-module chain: ability owns the native entry, item supplies its
 * ordinary-call path. The caller must verify and stage both files atomically. */
export function chainMoveParamOwners(abilityInput:RpmModule,itemInput:RpmModule,overlayModule="167"):{ability:RpmModule;item:RpmModule} {
  const owner=chainAbilityMoveParam(abilityInput,overlayModule),follower=chainItemMoveParam(itemInput,overlayModule);
  if(owner.address!==follower.address)throw Error("Unrecognized move-parameter hook ownership.");
  return {ability:owner.module,item:follower.module};
}
export function chainAbilityMoveParam(input:RpmModule,overlayModule="167"):{module:RpmModule;address:number} {
  const ability=structuredClone(input),api=ability.symbols.find(s=>s.name==="AbilityRecipeApi"),wrapper=ability.symbols.findIndex(s=>s.name==="AbilityRecipeMoveParam");
  if(!api||wrapper<0)throw Error("The shared move-parameter adapters are unavailable.");
  if(ability.symbols.some(s=>(s.attributes&2)&&(s.name==="RuleGetMoveParam"||s.address===0x387d450d)))throw Error("The ability runtime already has a move-parameter import.");
  const hooks=ability.relocations.filter(r=>r.target.module===overlayModule&&r.target.type==="THUMB_BRANCH"&&r.sourceSymbolIndex===wrapper);
  const links=ability.relocations.filter(r=>r.target.module==="base"&&r.target.type==="OFFSET"&&r.target.address===api.address+4);
  if(hooks.length!==1||links.length!==1)throw Error("Unrecognized move-parameter hook ownership.");
  ability.relocations=ability.relocations.filter(r=>r!==links[0]);
  // libRPM resolves imported symbols by their FNV-1a hash stored in address.
  const name="RuleGetMoveParam";let hash=0x811c9dc5;for(let i=0;i<name.length;++i)hash=Math.imul(hash^name.charCodeAt(i),16777619);
  const imported=ability.symbols.push({name,address:hash>>>0,size:0,type:"FUNCTION_THM",attributes:2})-1;
  ability.relocations.push({target:{module:"base",address:api.address+4,type:"OFFSET"},sourceSymbolIndex:imported});
  ability.metadata.PokewebMoveParamChain="owner";ability.metadata.PokewebMoveParamAddress=hooks[0].target.address;
  return {module:ability,address:hooks[0].target.address};
}
export function chainItemMoveParam(input:RpmModule,overlayModule="167"):{module:RpmModule;address:number} {
  const item=structuredClone(input),wrapper=item.symbols.findIndex(s=>s.name==="RuleGetMoveParam");
  if(wrapper<0||!(item.symbols[wrapper].attributes&1)||item.symbols.filter(s=>(s.attributes&1)&&s.name==="RuleGetMoveParam").length!==1)throw Error("The shared move-parameter adapters are unavailable.");
  const hooks=item.relocations.filter(r=>r.target.module===overlayModule&&r.target.type==="THUMB_BRANCH"&&r.sourceSymbolIndex===wrapper);
  if(hooks.length!==1)throw Error("Unrecognized move-parameter hook ownership.");
  item.relocations=item.relocations.filter(r=>r!==hooks[0]);item.metadata.PokewebMoveParamChain="follower";item.metadata.PokewebMoveParamAddress=hooks[0].target.address;
  return {module:item,address:hooks[0].target.address};
}
