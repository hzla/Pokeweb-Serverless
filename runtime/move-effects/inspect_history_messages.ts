/** Inspect the selected native battle messages in an explicit ROM. */
import {readFile} from "node:fs/promises";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {getTextBank,parseTextEntryId} from "../../src/pokeweb/textModel";
const [path]=process.argv.slice(2);if(!path)throw Error("ROM required");
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw Error("Only local assets are permitted.");return new Response(new Uint8Array(await readFile(url)));}) as typeof fetch;
const project=await loadProjectFromRomBytes(new Uint8Array(await readFile(path)),"inspect.nds",{selectedNarcs:["message_texts"]});
const bank=getTextBank(project,"message_texts",project.session.baseRom==="BW"?14:18);
for(const id of [225,523,580,581,582,797,800,905,906,907])console.log(id,bank.find(e=>{const parsed=parseTextEntryId(e[0]);return parsed.block===0&&parsed.entry===id;})?.[1]);

for(const row of bank)if(/but it failed/i.test(row[1]))console.log(row[0],row[1]);
