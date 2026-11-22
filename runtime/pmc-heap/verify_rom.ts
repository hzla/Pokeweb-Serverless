/** Explicit local-ROM checks for optional PMC expansion and retained patch ABI. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";
import {NintendoDSRom} from "../../src/nds/rom";
import {decompressCode} from "../../src/nds/codeCompression";
import {getPmcInstallStatus,getPmcHeapExpansionStatus,installBundledPmc,installPmcBytes,loadBundledPmcBytes,expandPmcHeapAllocation,repairLegacyPmcRomStructure,PMC_SYMBOL_PATH} from "../../src/pokeweb/pmcModel";
import {exportFrostCompatibleRom} from "../../src/pokeweb/frostCompatibility";
import {parseRpm} from "../../src/pokeweb/rpm";
const[input,out,mode]=process.argv.slice(2);
assert(input&&out&&(mode===undefined||mode==="--legacy-200"),"INPUT.nds EXTERNAL_DIRECTORY [--legacy-200]");
await mkdir(out);
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));assert.equal(url.protocol,"file:");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const source=new Uint8Array(await readFile(input));
const load=(data:Uint8Array)=>loadProjectFromRomBytes(data,"pmc-expansion.nds",{selectedNarcs:["moves","personal","items","message_texts"]});
let project=await load(source);
if(mode==="--legacy-200"&&!getPmcInstallStatus(project).installed){
  const game=new NintendoDSRom(source,{fileData:"view"}).idCode;
  installPmcBytes(project,await loadBundledPmcBytes(project.session.baseVersion,game,true),source);
}
if(!getPmcInstallStatus(project).installed||!getPmcHeapExpansionStatus(project).available&&!getPmcHeapExpansionStatus(project).expanded)await installBundledPmc(project);
assert(getPmcHeapExpansionStatus(project).available,"Use an unexpanded PMC baseline or a legacy US revision-0 heap200 baseline");
if(mode==="--legacy-200")assert.equal(getPmcHeapExpansionStatus(project).capKiB,200);
const baselineExpanded=getPmcHeapExpansionStatus(project).expanded;
const baselineBytes=await exportModifiedRom(project,{forDsi:false}),baseline=new NintendoDSRom(baselineBytes,{fileData:"view"});
project=await load(baselineBytes);assert(getPmcHeapExpansionStatus(project).available);
await expandPmcHeapAllocation(project);assert(getPmcHeapExpansionStatus(project).expanded);
const output=await exportModifiedRom(project,{forDsi:false}),rom=new NintendoDSRom(output,{fileData:"view"});
const status=getPmcInstallStatus(project);assert(status.installed);
const compact=["IRBO","IRAO","IREO","IRDO"].includes(rom.idCode);
const row=status.overlayId*32, table=new DataView(rom.arm9OverlayTable.buffer,rom.arm9OverlayTable.byteOffset,rom.arm9OverlayTable.byteLength);
const overlayBase=table.getUint32(row+4,true);
assert.equal(table.getUint32(row+8,true),0x3000);
assert.equal(table.getUint32(row+12,true),compact?0:0x5000);
const old=parseRpm(baseline.getFileByName(PMC_SYMBOL_PATH)),next=parseRpm(rom.getFileByName(PMC_SYMBOL_PATH));
assert.equal(old.baseAddress,next.baseAddress);
assert.equal(next.baseAddress,overlayBase);
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
// The retained low-level installer can reinstall the baseline package, including
// restoring BW1's native startup-table pointer instead of leaving a stale copy.
const restored=await load(output);installPmcBytes(restored,await loadBundledPmcBytes(restored.session.baseVersion,rom.idCode,baselineExpanded),output);
const normal=new NintendoDSRom(await exportModifiedRom(restored,{forDsi:false}),{fileData:"view"});
assert.deepEqual(decompressCode(normal.arm9),before);
for(let id=0;id<baseline.files.length;id++)assert.deepEqual(normal.files[id],baseline.files[id],`Original package restore changed file ${id}`);

if (compact) {
  const frost = new NintendoDSRom(exportFrostCompatibleRom(output, { forDsi: false }), { fileData: "view" });
  const frostTable = new DataView(frost.arm9OverlayTable.buffer, frost.arm9OverlayTable.byteOffset, frost.arm9OverlayTable.byteLength);
  assert.equal(frostTable.getUint32(row + 4, true), overlayBase);
  assert.equal(frostTable.getUint32(row + 12, true), 0);
  assert.equal(frostTable.getUint32(row + 24, true), status.overlayId);
  assert.deepEqual(frost.files[status.overlayId], rom.files[table.getUint32(row + 24, true)]);

  // Exercise repair of stale overlay metadata on a real compact export.
  const expectedTable = frost.arm9OverlayTable.slice();
  frostTable.setUint32(row + 12, 0x5000, true);
  const repaired = repairLegacyPmcRomStructure(frost);
  assert(repaired.repairedOverlayLayout);
  assert.deepEqual(repaired.arm9OverlayTable, expectedTable);
}
await writeFile(`${out}/expanded.nds`,output,{flag:"wx"});
if(mode==="--legacy-200")await writeFile(`${out}/baseline.nds`,baselineBytes,{flag:"wx"});
const report={passed:true,game:rom.idCode,heapCapKiB:getPmcHeapExpansionStatus(project).capKiB,overlayReservationBytes:table.getUint32(row+8,true)+table.getUint32(row+12,true),exportsPreserved:old.symbols.filter(s=>s.attributes&1).length,unrelatedFilesPreserved:rom.files.length-ignore.size,changedArm9Bytes:changed.length,exportReload:true,frostExport:compact,staleCompactReservationRepair:compact,repeatedUpdate:true,originalPackageRestore:true,sourceUnchanged:createHash("sha256").update(await readFile(input)).digest("hex")===createHash("sha256").update(source).digest("hex")};
assert(report.sourceUnchanged);await writeFile(`${out}/result.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
