/** Host-side addresses for read-only emulator probes; never stored in the DLL. */
import base from "../../src/assets/data/moveRuleRuntimeCompact.json";
import history from "../../src/assets/data/moveRuleRuntimeHistoryCompact.json";
import persistent from "../../src/assets/data/moveRuleRuntimePersistentCompact.json";
import knock from "../../src/assets/data/moveRuleRuntimeModernKnockCompact.json";
import type {RpmModule} from "../../src/pokeweb/rpm";
export function moveDebugSymbols(module:RpmModule):Record<string,number> {
  const names=Object.fromEntries(module.symbols.flatMap(s=>s.name?[[s.name,s.address]]:[]));
  if(module.metadata.PokewebMovePackaging!==2)return names;
  const version=module.metadata.PokewebMoveRecipes;
  const template=version===11?knock:version===10?persistent:version===8?history:version===7?base:undefined;
  if(!template)throw Error("Unknown compact move debug layout.");
  const bss=(template.code.length+3)&~3,shift=((module.code.length+3)&~3)-bss;
  for(const s of template.symbols)if(s.name&&s.name!=="MoveEventTemplate"&&!(s.name in names))names[s.name]=s.address+(!(s.attributes&4)&&s.address>=bss?shift:0);
  return names;
}
