import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { NintendoDSRom } from "../../src/nds/rom";
import { writeU16, writeU32 } from "../../src/nds/binary";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { getNaturePalette, getNaturePaletteRecords, setNaturePalette, naturePaletteBase } from "../../src/pokeweb/naturePaletteModel";
import { rgb555, rgbFrom555, NATURE_PALETTE_PATH } from "../../src/pokeweb/naturePaletteData";
import { getNaturePaletteRuntimeStatus, installNaturePaletteRuntime, uninstallNaturePaletteRuntime } from "../../src/pokeweb/naturePaletteRuntime";
import { buildPwanOverrideSideFromPwanBytes, installPwanRuntime, uninstallPwanRuntime, upsertPwanOverride } from "../../src/pokeweb/pwanAnimationModel";
import { getPokemonSpriteIndexedImage } from "../../src/pokeweb/pokemonSpriteModel";
import { listCodeInjectionDlls, stageCodeInjectionDll, removeStagedCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { getPmcMemoryEstimate } from "../../src/pokeweb/pmcMemoryModel";
import { createProjectDocument } from "../../src/pokeweb/projectDocument";
import { openProjectSession } from "../../src/pokeweb/projectSession";
import { writeRpm } from "../../src/pokeweb/rpm";

const [input, outArg] = process.argv.slice(2);
if (!input || !outArg) throw new Error("Usage: vite-node runtime/nature-palettes/verify_rom.ts INPUT.nds EXTERNAL_DIRECTORY");
const out=resolve(outArg), repo=fileURLToPath(new URL("../../",import.meta.url));
if (!relative(repo,out).startsWith("..")) throw new Error("Use a diagnostic directory outside the repository.");
await mkdir(out,{recursive:true});
const digest=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
globalThis.fetch=(async value=>{
  const url=new URL(value instanceof Request?value.url:String(value));
  if(url.protocol!=="file:")throw new Error("Only local bundled assets are allowed in this validator.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const source=new Uint8Array(await readFile(input)), sourceHash=digest(source);
const project=await loadProjectFromRomBytes(source,basename(input),{selectedNarcs:["personal","pokemon_sprites"]});
const game=project.session.baseVersion;
assert(game==="W2"||game==="B2");
assert(getNaturePaletteRuntimeStatus(project).compatible,getNaturePaletteRuntimeStatus(project).message);
const target={spriteId:607,source:"native" as const,nature:15,shiny:false};
const original=getNaturePalette(project,target).palette;
const green=original.map((c,i)=>i&&c.b>c.g*1.15&&c.r>c.g*1.05?rgbFrom555((rgb555(c)&31)<<5):c);
assert(green.some((c,i)=>rgb555(c)!==rgb555(original[i])),"Litwick flame colors were not selected");
setNaturePalette(project,target,green);
assert.deepEqual(getNaturePalette(project,target).palette,green);
assert.deepEqual(getNaturePalette(project,{...target,nature:0}).palette,original);
const document=createProjectDocument(project,false), reopenedDocument=openProjectSession(structuredClone(document));
assert.deepEqual(getNaturePaletteRecords(reopenedDocument),getNaturePaletteRecords(project));
await installNaturePaletteRuntime(project);
assert(getNaturePaletteRuntimeStatus(project).installed);
const nativeMemory=getPmcMemoryEstimate(project);
const nativeRom=await exportModifiedRom(project,{preserveOriginalLength:true});
await writeFile(resolve(out,`nature-native-${game}.nds`),nativeRom,{flag:"wx"});

function pwanSide(side:"front"|"back") {
  const indexed=getPokemonSpriteIndexedImage(project,607,{kind:"sprite",side,gender:"male"});
  const bytes=new Uint8Array(76+0x1200);
  bytes.set([80,87,65,78]);writeU16(bytes,4,1);writeU16(bytes,6,96);writeU16(bytes,8,96);writeU16(bytes,10,4);writeU16(bytes,12,1);writeU16(bytes,14,1);
  for(const [at,value]of [[16,8],[20,0x1200],[24,16],[28,40],[32,72],[36,76]])writeU32(bytes,at,value);
  original.forEach((c,i)=>writeU16(bytes,40+i*2,rgb555(c)));writeU16(bytes,74,8);
  let dest=76;
  for(const [x0,y0,w,h]of [[0,0,64,64],[64,0,32,64],[0,64,64,32],[64,64,32,32]])
    for(let ty=0;ty<h;ty+=8)for(let tx=0;tx<w;tx+=8)for(let y=0;y<8;++y)for(let x=0;x<8;x+=2){
      const at=(y0+ty+y)*96+x0+tx+x;bytes[dest++]=indexed.indices[at]|(indexed.indices[at+1]<<4);
    }
  assert.equal(dest,bytes.length);
  return buildPwanOverrideSideFromPwanBytes(bytes,`litwick-${side}-fixture.pwan`);
}
upsertPwanOverride(project,{speciesId:607,front:pwanSide("front"),back:pwanSide("back"),nativePaletteSource:"front",carrierTemplate:"w2u-gen6-placeholder"});
for(const source of ["pwan-front","pwan-back"] as const)setNaturePalette(project,{...target,source},green);
await installPwanRuntime(project);
assert(getNaturePaletteRuntimeStatus(project).installed);
assert(!listCodeInjectionDlls(project).some(m=>m.fileName.startsWith("NaturePalettes")));
const combinedMemory=getPmcMemoryEstimate(project);
await uninstallNaturePaletteRuntime(project);
assert(!getNaturePaletteRuntimeStatus(project).installed);
assert.equal(getNaturePaletteRecords(project).length,3);
const ordinaryPwanMemory=getPmcMemoryEstimate(project);
removeStagedCodeInjectionDll(project,`patches/PokewebPwanMisc${game}.dll`);
const incomplete=structuredClone(project.fileSystem);
await assert.rejects(installNaturePaletteRuntime(project),/Incomplete PWAN runtime/);
assert.deepEqual(project.fileSystem,incomplete);
await installPwanRuntime(project);
await installNaturePaletteRuntime(project);
assert(getNaturePaletteRuntimeStatus(project).installed);
// Failed native hook ownership checks must not publish any staged changes.
const hook=game==="W2"?0x021e6cea:0x021e6caa;
stageCodeInjectionDll(project,"ConflictingPaletteFixture.dll",writeRpm({code:new Uint8Array(16),bssSize:0,baseAddress:0,symbols:[{name:"Hook",type:"FUNCTION_THM",address:1,size:2,attributes:1}],relocations:[{target:{module:"168",address:hook,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex:0}],metadata:{PMCGameID:game}},{ident:"DLXF"}));
const before=structuredClone(project.fileSystem);
await assert.rejects(installNaturePaletteRuntime(project),/Conflicting palette hook/);
assert.deepEqual(project.fileSystem,before);
delete project.fileSystem!.additions!["patches/ConflictingPaletteFixture.dll"];
project.codeInjection!.modules=project.codeInjection!.modules!.filter(m=>m.fileName!=="ConflictingPaletteFixture.dll");
await uninstallPwanRuntime(project);
assert(getNaturePaletteRuntimeStatus(project).installed);
assert(!listCodeInjectionDlls(project).some(m=>/^PokewebPwan/u.test(m.fileName)));
await installPwanRuntime(project);
const exported=await exportModifiedRom(project,{preserveOriginalLength:true});
await writeFile(resolve(out,`nature-pwan-${game}.nds`),exported,{flag:"wx"});
const reloaded=await loadProjectFromRomBytes(exported,`nature-pwan-${game}.nds`,{selectedNarcs:["personal","pokemon_sprites"]});
assert(getNaturePaletteRuntimeStatus(reloaded).installed,getNaturePaletteRuntimeStatus(reloaded).message);
assert.equal(getNaturePaletteRecords(reloaded).length,3);
for(const source of ["native","pwan-front","pwan-back"] as const) assert.deepEqual(getNaturePalette(reloaded,{...target,source}).palette,green);
await uninstallPwanRuntime(reloaded); // Tests deletion of exported modules, not just additions.
assert(getNaturePaletteRuntimeStatus(reloaded).installed);
const stripped=new NintendoDSRom(await exportModifiedRom(reloaded,{preserveOriginalLength:true}),{fileData:"view"});
assert.equal(stripped.filenames.idOf(`patches/PokewebPwanBattle${game}.dll`),undefined);
assert(stripped.filenames.idOf(`patches/NaturePalettesBattle${game}.dll`)!==undefined);
assert(stripped.filenames.idOf(NATURE_PALETTE_PATH)!==undefined);
const originalRom=new NintendoDSRom(source,{fileData:"view"});
for(const [id,o]of originalRom.loadArm9Overlays([167,168,207]))assert.deepEqual(stripped.loadArm9Overlays([id]).get(id)!.data,o.data);
assert.equal(digest(new Uint8Array(await readFile(input))),sourceHash);
const result={game,passed:true,records:3,nativeMemory,ordinaryPwanMemory,combinedMemory,battleIncrementBytes:combinedMemory.battle.residentBytes-ordinaryPwanMemory.battle.residentBytes,
  summaryOverlapConservative:true,sourceUnchanged:true,flameIndexes:green.flatMap((c,i)=>rgb555(c)!==rgb555(original[i])?[i]:[]),checks:["both installation orders","remove nature while retaining PWAN","remove PWAN while retaining nature","conflict rollback","incomplete renderer rollback","project document","ROM export/reload","exported DLL removal","unchanged native overlay bytes"]};
await writeFile(resolve(out,`rom-${game}.json`),JSON.stringify(result,null,2)+"\n");
console.log(game,"ROM round trips and module lifecycle passed; battle increment",result.battleIncrementBytes,"bytes");
