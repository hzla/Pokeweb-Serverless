// Build a separate autosave test ROM. Input files are read only.
import { readFile,writeFile } from 'node:fs/promises';
import { basename,resolve } from 'node:path';
import { loadProjectFromRomBytes } from '../../src/pokeweb/loader';
import { exportModifiedRom } from '../../src/pokeweb/exportRom';
import { installAutosave } from './install';
const [input,output]=process.argv.slice(2);
if(!input||!output||resolve(input)===resolve(output))throw new Error('Pass input.nds and a different, new output.nds.');
globalThis.fetch=(async(input:RequestInfo|URL)=>{
 const url=input instanceof URL?input:new URL(input instanceof Request?input.url:String(input));
 if(url.protocol!=='file:')throw new Error('Only local bundled assets are supported.');
 return new Response(new Uint8Array(await readFile(url)));
})as typeof fetch;
const project=await loadProjectFromRomBytes(new Uint8Array(await readFile(input)),basename(input),{selectedNarcs:[]});
await installAutosave(project);
await writeFile(output,await exportModifiedRom(project),{flag:'wx'});
console.log(`Created ${resolve(output)}`);
