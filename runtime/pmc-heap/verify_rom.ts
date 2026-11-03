/** Explicit local-ROM checks for optional PMC expansion and retained patch ABI. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";
import {NintendoDSRom} from "../../src/nds/rom";
import {decompressCode} from "../../src/nds/codeCompression";
import {getPmcInstallStatus,getPmcHeapExpansionStatus,installBundledPmc,installPmcBytes,loadBundledPmcBytes,expandPmcHeapAllocation,PMC_SYMBOL_PATH} from "../../src/pokeweb/pmcModel";
import {parseRpm} from "../../src/pokeweb/rpm";
const[input,out]=process.argv.slice(2);assert(input&&out,"INPUT.nds EXTERNAL_DIRECTORY");await mkdir(out);
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));assert.equal(url.protocol,"file:");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const source=new Uint8Array(await readFile(input));
const load=(data:Uint8Array)=>loadProjectFromRomBytes(data,"pmc-expansion.nds",{selectedNarcs:["moves","personal","items","message_texts"]});
let project=await load(source);
if(!getPmcInstallStatus(project).installed||!getPmcHeapExpansionStatus(project).available&&!getPmcHeapExpansionStatus(project).expanded)await installBundledPmc(project);
assert(!getPmcHeapExpansionStatus(project).expanded,"Use a normal PMC baseline for this check");
const baselineBytes=await exportModifiedRom(project,{forDsi:false}),baseline=new NintendoDSRom(baselineBytes,{fileData:"view"});
project=await load(baselineBytes);assert(getPmcHeapExpansionStatus(project).available);
await expandPmcHeapAllocation(project);assert(getPmcHeapExpansionStatus(project).expanded);
const output=await exportModifiedRom(project,{forDsi:false}),rom=new NintendoDSRom(output,{fileData:"view"});
const status=getPmcInstallStatus(project);assert(status.installed);
const old=parseRpm(baseline.getFileByName(PMC_SYMBOL_PATH)),next=parseRpm(rom.getFileByName(PMC_SYMBOL_PATH));
for(const symbol of old.symbols.filter(s=>s.attributes&1))assert(next.symbols.some(s=>s.name===symbol.name&&s.address===symbol.address&&s.type===symbol.type),`Moved PMC service ${symbol.name}`);
const ignore=new Set([baseline.fileId(PMC_SYMBOL_PATH),baseline.fileId(`overlay/overlay_${String(status.overlayId).padStart(4,"0")}.bin`)]);
assert.equal(rom.files.length,baseline.files.length);
for(let id=0;id<baseline.files.length;id++)if(!ignore.has(id))assert.deepEqual(rom.files[id],baseline.files[id],`Unrelated ROM file ${id} changed`);
const before=decompressCode(baseline.arm9),after=decompressCode(rom.arm9),changed:number[]=[];
const sites=next.relocations.filter(r=>r.target.module==="ARM9");
for(let at=0;at<before.length;at++)if(before[at]!==after[at]){const address=rom.arm9RamAddress+at;changed.push(address);assert(sites.some(r=>address>=(r.target.address&~1)&&address<(r.target.address&~1)+(r.target.type==="FULL_COPY"?next.symbols[r.sourceSymbolIndex].size:16)),`Unrelated ARM9 edit ${address.toString(16)}`);}
project=await load(output);assert(getPmcHeapExpansionStatus(project).expanded);
await expandPmcHeapAllocation(project);await installBundledPmc(project);assert(getPmcHeapExpansionStatus(project).expanded);
const repeated=new NintendoDSRom(await exportModifiedRom(project,{forDsi:false}),{fileData:"view"});
assert.deepEqual(repeated.getFileByName(PMC_SYMBOL_PATH),rom.getFileByName(PMC_SYMBOL_PATH));
assert.deepEqual(decompressCode(repeated.arm9),after);
for(let id=0;id<rom.files.length;id++)assert.deepEqual(repeated.files[id],rom.files[id],`Update changed file ${id}`);
// The retained low-level installer can reinstall the original package, including
// restoring BW1's native startup-table pointer instead of leaving a stale copy.
const restored=await load(output);installPmcBytes(restored,await loadBundledPmcBytes(restored.session.baseVersion,rom.idCode,false),output);
const normal=new NintendoDSRom(await exportModifiedRom(restored,{forDsi:false}),{fileData:"view"});
assert.deepEqual(decompressCode(normal.arm9),before);
for(let id=0;id<baseline.files.length;id++)assert.deepEqual(normal.files[id],baseline.files[id],`Original package restore changed file ${id}`);
await writeFile(`${out}/expanded.nds`,output,{flag:"wx"});
const report={passed:true,game:rom.idCode,heapCapKiB:200,exportsPreserved:old.symbols.filter(s=>s.attributes&1).length,unrelatedFilesPreserved:rom.files.length-ignore.size,changedArm9Bytes:changed.length,exportReload:true,repeatedUpdate:true,originalPackageRestore:true,sourceUnchanged:createHash("sha256").update(await readFile(input)).digest("hex")===createHash("sha256").update(source).digest("hex")};
assert(report.sourceUnchanged);await writeFile(`${out}/result.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
