// Copy an existing Route 19 fixture and upgrade its installed companions.
import { readFile, writeFile } from "node:fs/promises";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { getNuzlockeEncountersStatus,installNuzlockeEncounters } from "../../src/pokeweb/nuzlockeEncountersModel";
import { getPokenavStatus } from "../../src/pokeweb/pokenavModel";
const [input,output,save,saveOutput]=process.argv.slice(2);if(!saveOutput)throw new Error("Pass fixture.nds NEW.nds fixture.sav NEW.sav");
globalThis.fetch=(async(value:RequestInfo|URL)=>new Response(new Uint8Array(await readFile(value instanceof URL?value:new URL(value instanceof Request?value.url:String(value)))))) as typeof fetch;
const p=await loadProjectFromRomBytes(new Uint8Array(await readFile(input)),"nuzlocke-test.nds",{selectedNarcs:["message_texts","encounters","personal","evolutions"]});
console.log("Before",getPokenavStatus(p),getNuzlockeEncountersStatus(p));
await installNuzlockeEncounters(p,{allowExhausted:false});
console.log("After",getPokenavStatus(p),getNuzlockeEncountersStatus(p));
await writeFile(output,await exportModifiedRom(p),{flag:"wx"});await writeFile(saveOutput,await readFile(save),{flag:"wx"});
console.log("Created separate ROM and copied save",output,saveOutput);
