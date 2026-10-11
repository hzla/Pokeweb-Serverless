import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {NARC} from '../src/nds/narc';
import {parseSpriteConfig} from './lib/pwan-sprite-refresh';
import {readBundledPwanArchive,writeBundledPwanArchive} from './lib/pwan-library-payload';
import {parsePwanLibraryArchive,type PwanLibraryManifest,type PwanLibraryEntry} from '../src/pokeweb/pwanLibraryModel';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=new Map<string,string>();
for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i]!;
  args.set(key,['--repair-metadata','--refresh-new-sprites'].includes(key)?'true':process.argv[++i]!);
}
const required=(key:string)=>{const v=args.get(key);if(!v)throw new Error(`Missing ${key}`);return path.resolve(v);};
const upgrade=required('--upgrade'),library=path.join(root,'src/assets/pwan/library');
const report=JSON.parse(await readFile(path.join(upgrade,'assets/pokeweb_pwan/gmax_mega_import_report.json'),'utf8'));
const original:PwanLibraryManifest=JSON.parse(await readFile(path.join(library,'manifest.json'),'utf8'));
if(args.has('--refresh-new-sprites')){
  const archive=new NARC(await readBundledPwanArchive(library));
  for(const form of report.forms)for(const side of ['front','back'] as const){
    archive.files[form.asset*2+(side==='front'?1:2)]=new Uint8Array(await readFile(path.join(upgrade,'assets/pokeweb_pwan',`${form.asset}_${side}.pwan`)));
  }
  const bytes=archive.save();original.archiveBytes=bytes.length;
  parsePwanLibraryArchive(original,bytes);
  const distribution=await writeBundledPwanArchive(library,bytes);
  await writeFile(path.join(library,'manifest.json'),JSON.stringify(original,null,2)+'\n');
  const buildReport=JSON.parse(await readFile(path.join(library,'build-report.json'),'utf8'));
  Object.assign(buildReport,{archiveBytes:bytes.length,distribution});
  await writeFile(path.join(library,'build-report.json'),JSON.stringify(buildReport,null,2)+'\n');
  process.exit(0);
}
if(args.has('--repair-metadata')){
  for(const entry of original.entries){
    const relocated=report.relocated.find((r:any)=>r.species===entry.speciesId&&r.form===entry.formIndex);
    if(relocated&&entry.icon){entry.icon.sourcePaletteKey=relocated.asset;entry.icon.sourceArchiveIndex=relocated.asset*2+8;}
    if(entry.key.startsWith('GMAX_MEGA_'))entry.notes=entry.notes?.replace('Gen 5 preset;','Gen 5 preset enabled;');
  }
  parsePwanLibraryArchive(original,await readBundledPwanArchive(library));
  await writeFile(path.join(library,'manifest.json'),JSON.stringify(original,null,2)+'\n');
  process.exit(0);
}
const backup=required('--backup');
if(report.format!=='w2u-gmax-mega-import-v1'||original.entries.some(e=>e.key.startsWith('GMAX_MEGA_')))throw new Error('Unexpected or already imported library');
const oldBytes=await readBundledPwanArchive(library),old=new NARC(oldBytes);
parsePwanLibraryArchive(original,oldBytes);
const config=new Uint8Array(await readFile(path.join(upgrade,'assets/pokeweb_pwan/config.bin'))),rows=parseSpriteConfig(config);
const members:Uint8Array[]=Array.from({length:Math.max(...rows.map(r=>r.assetIndex))*2+3},()=>new Uint8Array());members[0]=config;
const entries:PwanLibraryEntry[]=[];
const hash=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
for(const entry of original.entries){
  for(const [side,present] of [['front',entry.hasFront],['back',entry.hasBack]] as const)if(present){
    const member=entry.assetIndex*2+(side==='front'?1:2),bytes=old.files[member]!;
    const upgradeBytes=new Uint8Array(await readFile(path.join(upgrade,'assets/pokeweb_pwan',`${entry.assetIndex}_${side}.pwan`)));
    if(hash(bytes)!==hash(upgradeBytes))throw new Error(`Existing sprite changed: ${entry.name}/${side}`);
    members[member]=bytes;
  }
  if(!entry.icon)throw new Error('Old library icon missing');
  const maleMemberId=members.length;members.push(old.files[entry.icon.maleMemberId]!);
  const femaleMemberId=members.length;members.push(old.files[entry.icon.femaleMemberId]!);
  const relocated=report.relocated.find((r:any)=>r.species===entry.speciesId&&r.form===entry.formIndex);
  const key=relocated?relocated.asset:entry.icon.sourcePaletteKey;
  entries.push({...entry,icon:{...entry.icon,maleMemberId,femaleMemberId,sourcePaletteKey:key,sourceArchiveIndex:relocated?key*2+8:entry.icon.sourceArchiveIndex}});
}
for(const form of report.forms){
  const row=rows.find(r=>r.speciesId===form.species&&r.formIndex===form.form);
  if(!row||row.assetIndex!==form.asset||row.flags!==3)throw new Error('New Mega config mismatch');
  for(const side of ['front','back'] as const)members[form.asset*2+(side==='front'?1:2)]=new Uint8Array(await readFile(path.join(upgrade,'assets/pokeweb_pwan',`${form.asset}_${side}.pwan`)));
  const iconIndex=form.asset*2+8;
  const male=new Uint8Array(await readFile(path.join(upgrade,'data/graphics/pokegra/icons',`07_${String(iconIndex).padStart(8,'0')}.bin`)));
  const maleMemberId=members.length;members.push(male);const femaleMemberId=members.length;members.push(male);
  entries.push({id:`${form.species}-${form.form}-${form.asset}`,name:form.name,key:`GMAX_MEGA_${form.sourceStem}`,kind:'mega form',speciesId:form.species,formIndex:form.form,assetIndex:form.asset,hasFront:true,hasBack:true,credits:'Smogon/Sprites Animados Contributors',creditSource:'import-report',spriteSources:form.sides.map((s:any)=>({side:s.side,source:s.source,credits:'Smogon/Sprites Animados Contributors',creditBasis:'Essentials collection attribution; individual author not supplied'})),notes:'G-Max artwork used as a Megite-only Mega. Source-form stats, types and abilities unchanged. Gen 5 preset enabled; nearest-neighbor sizing; TEX4, 15 visible colors.',icon:{maleMemberId,femaleMemberId,malePaletteId:form.icon.palette,femalePaletteId:form.icon.palette,sourceArchiveIndex:iconIndex,sourcePaletteKey:form.asset}});
}
const archive=new NARC();archive.files=members;const bytes=archive.save();
const manifest:PwanLibraryManifest={...original,generatedAt:new Date().toISOString(),archiveBytes:bytes.length,entryCount:entries.length,iconCount:entries.length,sideCount:{front:entries.filter(e=>e.hasFront).length,back:entries.filter(e=>e.hasBack).length,total:entries.reduce((n,e)=>n+Number(e.hasFront)+Number(e.hasBack),0)},entries:entries.sort((a,b)=>a.name.localeCompare(b.name))};
parsePwanLibraryArchive(manifest,bytes);
await mkdir(backup);await cp(library,path.join(backup,'library'),{recursive:true});
const distribution=await writeBundledPwanArchive(library,bytes);
await writeFile(path.join(library,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const buildReport=JSON.parse(await readFile(path.join(library,'build-report.json'),'utf8'));
Object.assign(buildReport,{archiveBytes:bytes.length,entryCount:entries.length,iconCount:entries.length,sideCount:manifest.sideCount,distribution,gmaxMegas:{addedEntries:report.forms.length,existingEntriesPreserved:original.entryCount,existingSpritesAndIconsPreservedByteExactly:true,preset:'gen5',stone:'Megite',statPolicy:'clone-source-form'}});
await writeFile(path.join(library,'build-report.json'),JSON.stringify(buildReport,null,2)+'\n');
const labels=report.forms.map((f:any)=>({species:f.species,name:f.name,form:f.form,sourceForm:f.sourceForm,personalId:f.personalId}));
await writeFile(path.join(root,'src/assets/pwan/gmax-mega-forms.json'),JSON.stringify(labels,null,2)+'\n');
console.log(JSON.stringify({entries:entries.length,sides:manifest.sideCount,added:report.forms.length,existingPreserved:original.entryCount,distribution},null,2));
