import { readFile,writeFile } from "node:fs/promises";
import { parseRpm,setRpmBaseAddress,updateRpmCodeImageForBase } from "../../src/pokeweb/rpm";
import { buildExpandedPmcTemplate,adaptExpandedBw1PmcBoot } from "../../src/pokeweb/pmcHeapRuntime";
const rpm=buildExpandedPmcTemplate(parseRpm(new Uint8Array(await readFile(new URL("../../src/assets/codeinjection/PMC_W2.rpm",import.meta.url)))));
const index=(name:string)=>rpm.symbols.findIndex(s=>s.name===name),originals=rpm.symbols.map(s=>({...s}));
const specs=new Uint8Array(16);new DataView(specs.buffer).setUint32(0,0x6000,true);new DataView(specs.buffer).setUint32(8,0x199500,true);
adaptExpandedBw1PmcBoot(rpm,index("GFLAppInit"),specs,0x020055dc);
for(const symbol of originals)if(symbol.name){const next=rpm.symbols.find(s=>s.name===symbol.name)!;if(next.address!==symbol.address)throw Error("Moved original PMC symbol");}
setRpmBaseAddress(rpm,0x02217d20);updateRpmCodeImageForBase(rpm);
const base=rpm.baseAddress+32,address=(name:string)=>{const s=rpm.symbols[index(name)];return(s.attributes&4?s.address:base+s.address)&~1;};
await writeFile(process.argv[2],JSON.stringify({base,code:Array.from(rpm.code),entry:address("__PokewebBw1ExpandedHeapBoot"),specs:address("__PokewebBw1HeapSpecs"),services:{create:address("_ZN3pmc6System21CreateSystemAllocatorEv"),initialize:address("_ZN3pmc3fwk10InitializeEPN3exl4heap9AllocatorE"),game:address("GFLAppInit"),start:address("_PMCSystemInit")}}));
