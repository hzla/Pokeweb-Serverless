import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir, cp, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NintendoDSRom } from '../src/nds/rom';
import { NARC } from '../src/nds/narc';
import { readU16 } from '../src/nds/binary';
import { parseCsv } from '../src/pokeweb/gen6SpritePipeline';
import { compileGifToPwan, parsePwanHeader, pwanPalette, pwanFramePixels, pwanTimeline, scalePwanTimelineSpeed, shiftPwanFrames, validatePwan } from '../src/pokeweb/pwanCompiler';
import { parseW2Anim, W2ANIM_PATH } from '../src/pokeweb/w2animCodec';
import { parsePwanLibraryArchive, type PwanLibraryEntry, type PwanLibraryManifest } from '../src/pokeweb/pwanLibraryModel';
import { SPRITE_PRIORITIES, spriteKey, parseSpriteConfig, selectSpriteSource, nativeSpriteBlock, readNclrPalette, extractRomPwan, type SpriteSource, type SpriteRow } from './lib/pwan-sprite-refresh';
import { gen6SpriteCredits, joinSpriteCredits, resolveSpriteCredit } from './lib/pwan-sprite-credits';
import { readBundledPwanArchive, writeBundledPwanArchive } from './lib/pwan-library-payload';

type Tracker = { id: number; name: string; key: string; kind: string; baseSpeciesId?: number; form?: number; credits?: string; runtimeNotes?: string };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map<string, string>();
for (let n = 2; n < process.argv.length; n++) {
  const key = process.argv[n]!;
  if (key === '--plan' || key === '--resume') args.set(key, 'true');
  else if (key.startsWith('--') && process.argv[n + 1]) args.set(key, process.argv[++n]!);
  else throw new Error(`Unknown argument ${key}`);
}
const required = (name: string): string => {const value = args.get(name); if (!value) throw new Error(`Missing ${name}`); return path.resolve(value);};
const sprites = required('--sprites'), upgrade = required('--upgrade'), inputRom = required('--rom'), trackerFile = required('--tracker'), output = required('--output');
const preset = args.get('--preset') ?? 'none';
if (preset !== 'none' && preset !== 'gen5') throw new Error('Expected --preset none or gen5');
const selectedVariant = preset === 'gen5' ? 'gen5' : 'new';
const json = async (p: string, value: unknown) => writeFile(p, JSON.stringify(value, null, 2) + '\n');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const config = new Uint8Array(await readFile(path.join(upgrade, 'assets/pokeweb_pwan/config.bin')));
const rows = parseSpriteConfig(config);
const tracker: Tracker[] = JSON.parse(await readFile(trackerFile, 'utf8'));
const iconReport = JSON.parse(await readFile(path.join(upgrade,'assets/pokeweb_pwan/form_icon_staging_report.json'),'utf8'));
const essentialFormStems = new Map<string,string>((iconReport.megaSpeciesIcons ?? []).map((r: any) => [r.key, r.sourceStem]));
const directMegaSpecies = new Set([3,9,15,18,65,80,94,115,127,130,142,181,208,212,214,229,248,254,257,260,282,302,303,306,308,310,319,323,334,354,359,362,373,376,380,381,428,445,448,460,475,531]);
const sources: SpriteSource[] = [];
const gen6Csv = await readFile(path.join(sprites, '..', 'gen6sprites.csv'), 'utf8');
const csvCredits = gen6SpriteCredits(gen6Csv);
const sourceAttribution = (source: SpriteSource) => resolveSpriteCredit(source,
  tracker.find(t => t.runtimeNotes?.includes(`Imported from ${source.relative.replace(/-(front|back)\.gif$/i, '')};`)), csvCredits);
const sourceCredit = (source: SpriteSource | undefined, previous: string): string => {
  if (!source) return previous;
  return sourceAttribution(source).credits;
};
const gen6Slugs = new Map<string, string>();
let category = '';
for (const row of parseCsv(gen6Csv)) {
  if (!/^\d+$/.test(row[0]?.trim() ?? '')) {if (row[0]?.trim()) category = row[0]!.trim(); continue;}
  const name = row[1]!, key = spriteKey(name);
  if (category === 'Mega Evolution') gen6Slugs.set(key, spriteKey(name.replace(/-(X|Y)$/i, '-mega$1') + (/-[XY]$/i.test(name) ? '' : '-mega')));
  else if (category === 'Primal Reversion') gen6Slugs.set(key, spriteKey(name + '-primal'));
}
async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, {withFileTypes: true});
  return (await Promise.all(entries.map(e => e.isDirectory() ? walk(path.join(dir, e.name)) : Promise.resolve(e.name.toLowerCase().endsWith('.gif') ? [path.join(dir, e.name)] : [])))).flat();
}
for (const [priority, group] of SPRITE_PRIORITIES.entries()) {
  for (const file of await walk(path.join(sprites, group))) {
    const relative = path.relative(sprites, file).split(path.sep).join('/');
    if (/shiny|female/i.test(relative)) continue;
    const stem = path.basename(file, path.extname(file));
    const side = /(?:^|[/_-])back(?:[/_.-]|$)/i.test(relative) ? 'back' : 'front';
    let key = spriteKey(stem.replace(/-(front|back)(?:-\d+x\d+)?$/i, ''));
    if (group.startsWith('gen6-')) key = gen6Slugs.get(key) ?? key;
    key = ({aerodactylemega:'aerodactylmega', aagronmega:'aggronmega', datrix:'dartrix',victreebellmega:'victreebelmega',skolipedemega:'scolipedemega',skovillainmega:'scovillainmega',tastugirimega:'tatsugirimega'} as Record<string,string>)[key] ?? key;
    sources.push({path:file, relative, group, priority, side, key});
  }
}

function describe(row: SpriteRow): {name: string; key: string; kind: string; credits: string; aliases: string[]} {
  let match = tracker.find(t => row.formIndex ? t.baseSpeciesId === row.speciesId && t.form === row.formIndex : t.id === row.speciesId && t.kind === 'base species');
  const special: Record<string, [string, string[]]> = {
    '658:2':['Ash-Greninja', ['greninjaash','greninja2']],
    '681:1':['Aegislash Blade', ['aegislashblade','aegislash1']],
    '718:1':['Zygarde 10%', ['zygarde10','zygarde1']],
    '718:2':['Zygarde Complete', ['zygardecomplete','zygarde100','zygarde2']],
    '718:3':['Mega Zygarde', ['zygardemega']],
    '720:1':['Hoopa Unbound', ['hoopaunbound','hoopa1']],
    '746:1':['Wishiwashi School', ['wishiwashischool','wishiwashi1']],
    '778:1':['Mimikyu Busted', ['mimikyubusted','mimikyu1']],
  };
  if (row.speciesId === 718 && row.formIndex === 3) match = tracker.find(t => t.key === 'MEGA_ZA_ZYGARDE');
  if (row.speciesId === 718 && row.formIndex === 1) match = undefined;
  if (row.speciesId === 774) {
    const color = ['Red','Orange','Yellow','Green','Blue','Indigo','Violet'][row.formIndex % 7]!;
    const core = row.formIndex >= 7;
    return {name: core ? `Minior ${color} Core` : `Minior ${color} Meteor`, key:`MINIOR_${core?'CORE':'METEOR'}_${color.toUpperCase()}`, kind:'alternate form', credits:'Smogon Sprite Project; MallowOut', aliases:core ? [`minior${color}`,`minior_${row.formIndex}`] : ['miniormeteor','minior']};
  }
  const override = special[`${row.speciesId}:${row.formIndex}`];
  const name = override?.[0] ?? match?.name ?? `Pokemon ${row.speciesId} Form ${row.formIndex}`;
  const aliases = override?.[1].slice() ?? [name];
  if (!override && match) {
    const notes = match.runtimeNotes ?? '';
    const stem = /sourceStem ([A-Z0-9_]+)/.exec(notes)?.[1];
    if (stem) aliases.push(stem);
    const imported = /gen[67]-sprite-work\/downloads\/([a-z0-9-]+)/i.exec(notes)?.[1];
    if (imported) aliases.push(imported);
    if (/^Mega /i.test(name)) aliases.push(name.replace(/^Mega (.+?)(?: ([XYZ]))?$/i, '$1-mega$2'));
    if (/^Primal /i.test(name)) aliases.push(name.replace(/^Primal (.+)$/i, '$1-primal'));
    if (/^Alolan /i.test(name)) aliases.push(name.replace(/^Alolan /i, ''));
    const essentialStem = essentialFormStems.get(match.key);
    if (essentialStem) aliases.push(essentialStem);
    // Existing import notes explicitly use the same art for these color variants.
    if (/^Mega (Magearna|Tatsugiri) \(/.test(name)) aliases.push(name.replace(/^Mega (\w+) .*$/, '$1-mega'));
    if (match.key === 'MEGA_RAYQUAZA') aliases.push('RAYQUAZA_1');
    if (match.key === 'MEGA_ZA_CHANDELURE') aliases.push('CHANDELURE_1');
  }
  if (!row.formIndex && row.speciesId === 718) aliases.push('zygarde50','zygarde50percent');
  if (!row.formIndex && row.speciesId === 720) aliases.push('hoopaconfined');
  return {name, key:match?.key ?? `PWAN_${row.speciesId}_${row.formIndex}`, kind:match?.kind ?? 'alternate form', credits:match?.credits ?? 'Existing W2U sprite contributors', aliases};
}

const plans = rows.map(row => ({...row, ...describe(row), sides: (['front','back'] as const).filter((_, n) => row.flags & (1 << n)).map(side => ({side, source: selectSpriteSource(sources, describe(row).aliases, side)}))}));
const summary = {entries:rows.length, sides:plans.reduce((n,p)=>n+p.sides.length,0), sources:sources.length, missing:plans.flatMap(p=>p.sides.filter(s=>!s.source).map(s=>({species:p.speciesId,form:p.formIndex,asset:p.assetIndex,name:p.name,side:s.side,aliases:p.aliases}))), groups:Object.fromEntries(SPRITE_PRIORITIES.map(g=>[g,plans.reduce((n,p)=>n+p.sides.filter(s=>s.source?.group===g).length,0)]))};
if (args.has('--plan')) {console.log(JSON.stringify(summary,null,2)); process.exit(0);}

// All recoverable state is copied before touching either repository's shipped files.
const romBytes = new Uint8Array(await readFile(inputRom));
if (args.has('--resume')) {
  const backup=JSON.parse(await readFile(path.join(output,'backup/manifest.json'),'utf8'));
  if (backup.romSha256!==hash(romBytes)||backup.configSha256!==hash(config)) throw new Error('Resume input differs from backed-up ROM/config');
} else {
  await mkdir(output); // Refuse accidental reuse/overwrite of an earlier comparison.
  await mkdir(path.join(output,'backup'));
  await cp(path.join(upgrade,'assets/pokeweb_pwan'), path.join(output,'backup/w2u-pwan'), {recursive:true});
  await cp(path.join(ROOT,'src/assets/pwan/library'), path.join(output,'backup/pokeweb-library'), {recursive:true});
  await copyFile(inputRom, path.join(output,'backup/White2Upgrade-before-refresh.nds'));
}
const rom = new NintendoDSRom(romBytes,{fileData:'view'});
const streams = parseW2Anim(rom.files[rom.fileId(W2ANIM_PATH)]!);
if (!args.has('--resume')) await writeFile(path.join(output,'backup/streams.bin'), streams.bytes);
const personal = new NARC(rom.files[rom.fileId('a/0/1/6')]!);
const graphics = new NARC(rom.files[rom.fileId('a/0/0/4')]!);
const icons = new NARC(rom.files[rom.fileId('a/0/0/7')]!);
const paletteMap = rom.files[rom.fileId('pokeicon_palette_map.bin')]!;
if (!args.has('--resume')) await json(path.join(output,'backup/manifest.json'), {format:'sprite-refresh-backup-v1', sourceRom:path.basename(inputRom), romSha256:hash(romBytes), streamsSha256:hash(streams.bytes), configSha256:hash(config), savedAt:new Date().toISOString(), savesTouched:false});
const previousManifest: PwanLibraryManifest = JSON.parse(await readFile(path.join(output,'backup/pokeweb-library/manifest.json'),'utf8'));
const previousLibrary = new NARC(await readBundledPwanArchive(path.join(output,'backup/pokeweb-library')));
console.log(`Backed up previous ROM, w2anim streams, W2U PWAN files and Pokeweb library`);
for (const dir of ['old','new','gen5','assets','sources']) await mkdir(path.join(output,dir),{recursive:true});
const fileBytes = new Map<string,Uint8Array>(), pages: any[] = [], failures: any[] = [], libraryEntries: PwanLibraryEntry[] = [];
const members: Uint8Array[] = [config];
const variants = new Map<string,{old:Uint8Array;new:Uint8Array;gen5:Uint8Array;source?:SpriteSource;conversion?:unknown;warnings:string[];timingScale:number;groundShift:number}>();
const maxAsset = Math.max(...rows.map(r=>r.assetIndex));
for(let n=1;n<=maxAsset*2+2;n++) members[n]=new Uint8Array();
function maxY(bytes:Uint8Array):number {
  const h=parsePwanHeader(bytes);let y=-1;
  for(let n=0;n<h.frameCount;n++){const px=pwanFramePixels(bytes,n);for(let r=95;r>=0;r--)if(px[r]!.some(v=>v)){y=Math.max(y,r);break;}}
  return y;
}
for (const [index,p] of plans.entries()) {
  const record = personal.files[p.speciesId]!;
  const block = nativeSpriteBlock(p,record);
  for(const sidePlan of p.sides) {
    const side=sidePlan.side, id=`${p.assetIndex}_${side}`;
    let value=variants.get(id);
    if(value && value.source?.relative !== sidePlan.source?.relative) throw new Error(`Conflicting sources for shared asset ${id}`);
    if(!value) {
      const sheet=block*20+(side==='front'?2:11);
      const entry=streams.entries.find(e=>e.arc===4&&e.sheetFile===sheet);
      if(!entry) throw new Error(`No baseline stream for ${p.speciesId}:${p.formIndex}:${side}, sheet ${sheet}`);
      const old=extractRomPwan(streams,entry,readNclrPalette(graphics.files[block*20+18]!));
      const source=sidePlan.source;
      value={old,new:old,gen5:old,source,warnings:[],timingScale:1,groundShift:0};
      if(source) {
        try {
          const gif=new Uint8Array(await readFile(source.path));
          const normal=compileGifToPwan(gif), enhanced=compileGifToPwan(gif,{colorPreset:'gen5'});
          // Preserve the documented Diego half-speed policy, not compiler artifacts.
          const timingScale=source.group==='diego-gifs'?2:1;
          let normalBytes=normal.pwanBytes, enhancedBytes=enhanced.pwanBytes;
          if(timingScale!==1) {normalBytes=scalePwanTimelineSpeed(normalBytes,timingScale).pwanBytes; enhancedBytes=scalePwanTimelineSpeed(enhancedBytes,timingScale).pwanBytes;}
          // Keep the prior sprite's ground/floating placement; no scale or filtering is added.
          const shift=maxY(old)-maxY(normalBytes);
          if(shift) {normalBytes=shiftPwanFrames(normalBytes,0,shift).pwanBytes;enhancedBytes=shiftPwanFrames(enhancedBytes,0,shift).pwanBytes;}
          value={old,new:normalBytes,gen5:enhancedBytes,source,conversion:{none:normal.conversion,gen5:enhanced.conversion},warnings:normal.warnings,timingScale,groundShift:shift};
          await writeFile(path.join(output,'sources',`${id}.gif`),gif);
        } catch(error) {failures.push({id,name:p.name,source:source.relative,error:String(error)});value.warnings.push(`Conversion failed; baseline retained: ${String(error)}`);}
      } else value.warnings.push('No approved source GIF found; baseline retained in both variants');
      for(const name of ['old','new','gen5'] as const){validatePwan(value[name]);await writeFile(path.join(output,name,`${id}.pwan`),value[name]);}
      const payload=Object.fromEntries(['old','new','gen5'].map(name=>[name,Buffer.from(value![name as 'old'|'new'|'gen5']).toString('base64')]));
      await writeFile(path.join(output,'assets',`${id}.js`),`window.spriteVariants[${JSON.stringify(id)}]=${JSON.stringify(payload)};\n`);
      variants.set(id,value);
      fileBytes.set(id,value[selectedVariant]);
      pages.push({id,name:p.name,species:p.speciesId,form:p.formIndex,asset:p.assetIndex,side,source:source?.relative,group:source?.group,status:source&&!value.warnings.some(w=>w.startsWith('Conversion failed'))?'imported':'preserved',credits:sourceCredit(source,p.credits),previousCredits:p.credits,warnings:value.warnings,conversion:value.conversion,timingScale:value.timingScale,groundShift:value.groundShift,hashes:{old:hash(value.old),new:hash(value.new),gen5:hash(value.gen5)},bytes:{old:value.old.length,new:value.new.length,gen5:value.gen5.length},aliases:[{species:p.speciesId,form:p.formIndex,name:p.name}]});
    } else pages.find(page=>page.id===id)!.aliases.push({species:p.speciesId,form:p.formIndex,name:p.name});
    members[p.assetIndex*2+(side==='front'?1:2)]=value[selectedVariant];
  }
  // Mirrors the resident icon hook, including direct Mega form personal IDs.
  let iconIndex=p.speciesId>=722&&p.speciesId<=809?1904+(p.speciesId-722)*2:p.speciesId>=810&&p.speciesId<=1023?2408+(p.speciesId-810)*2:p.speciesId*2+8;
  let paletteKey=p.speciesId;
  if(p.formIndex&&p.formIndex<record[0x20]!&&!(record[0x21]!&128)) {
    const direct=readU16(record,0x1c)?readU16(record,0x1c)+p.formIndex-1:0;
    const directMega=(p.speciesId===6||p.speciesId===150)?p.formIndex<=2:directMegaSpecies.has(p.speciesId)&&p.formIndex===1;
    if(directMega&&direct&&icons.files[direct*2+8]?.length){iconIndex=direct*2+8;paletteKey=direct;}
    else{iconIndex=block*2+8;paletteKey=block;}
  }
  const previous = previousManifest.entries.find(e=>e.key===p.key)?.icon;
  // Keep the existing bundled icons untouched; only new library entries need ROM extraction.
  if (!icons.files[iconIndex]?.length && p.formIndex) {
    const direct=readU16(record,0x1c)+p.formIndex-1;
    if (readU16(record,0x1c)&&icons.files[direct*2+8]?.length) {iconIndex=direct*2+8;paletteKey=direct;}
  }
  const male=previous?previousLibrary.files[previous.maleMemberId]:icons.files[iconIndex], female=previous?previousLibrary.files[previous.femaleMemberId]:icons.files[iconIndex+1];
  if(!male?.length||paletteKey>=paletteMap.length) throw new Error(`Missing icon for ${p.name}: ${iconIndex}/${paletteKey}`);
  const palettes=paletteMap[paletteKey]!, malePaletteId=previous?.malePaletteId??(palettes&15), femalePaletteId=previous?.femalePaletteId??(female?.length?palettes>>>4:malePaletteId);
  if(malePaletteId>2||femalePaletteId>2) throw new Error(`Invalid icon palette for ${p.name}`);
  const maleMemberId=members.length;members.push(male);const femaleMemberId=members.length;members.push(previous ? female! : female?.length?female:male);
  const credits=joinSpriteCredits(p.sides.map(s=>sourceCredit(s.source,p.credits)));
  const spriteSources=p.sides.flatMap(s=>s.source?[{side:s.side,source:s.source.relative,...sourceAttribution(s.source)}]:[]);
  libraryEntries.push({id:`${p.speciesId}-${p.formIndex}-${p.assetIndex}`,name:p.name,key:p.key,kind:p.kind,speciesId:p.speciesId,formIndex:p.formIndex,assetIndex:p.assetIndex,hasFront:!!(p.flags&1),hasBack:!!(p.flags&2),credits,creditSource:'import-report',spriteSources,notes:`Regenerated from approved priority GIF sources with nearest-neighbor resizing and 15 visible RGB555 colors; Gen 5 preset ${preset==='gen5'?'enabled (+15% saturation, +10% contrast)':'disabled'}. Unavailable sources preserve the previous ROM stream.`,icon:{maleMemberId,femaleMemberId,malePaletteId,femalePaletteId,sourceArchiveIndex:previous?.sourceArchiveIndex??iconIndex,sourcePaletteKey:previous?.sourcePaletteKey??paletteKey}});
  if(index%20===0) console.log(`Prepared ${index+1}/${plans.length} species/forms (${variants.size} unique sides)`);
}
if(failures.length) {await json(path.join(output,'conversion-failures.json'),failures);throw new Error(`${failures.length} GIF conversions failed; repositories not modified`);}
const archive=new NARC();archive.files=members;const archiveBytes=archive.save();
const manifest: PwanLibraryManifest={format:'pokeweb-pwan-library-v2',generatedAt:new Date().toISOString(),sourceRom:path.basename(inputRom),iconSourceRom:path.basename(inputRom),archivePath:'zz_pokeweb_pwan/pwan.narc',archiveBytes:archiveBytes.length,entryCount:libraryEntries.length,iconCount:libraryEntries.length,sideCount:{front:libraryEntries.filter(e=>e.hasFront).length,back:libraryEntries.filter(e=>e.hasBack).length,total:plans.reduce((n,p)=>n+p.sides.length,0)},entries:libraryEntries.sort((a,b)=>a.name.localeCompare(b.name))};
const loaded=parsePwanLibraryArchive(manifest,archiveBytes);
if(loaded.entries.length!==rows.length||loaded.iconsByEntryId.size!==rows.length) throw new Error('Generated library validation failed');
const report={format:'pokeweb-sprite-refresh-v1',sourceRom:path.basename(inputRom),sourceRomSha256:hash(romBytes),preset,priorityOrder:SPRITE_PRIORITIES,entries:rows.length,uniqueSides:pages.length,importedSides:pages.filter(p=>p.status==='imported').length,preservedSides:pages.filter(p=>p.status==='preserved').length,missingSources:summary.missing,failures,sprites:pages};
await json(path.join(output,'report.json'),report);
await json(path.join(output,'library-manifest.json'),manifest);
await writeFile(path.join(output,'pwan.narc'),archiveBytes);
await writeFile(path.join(output,'manifest.js'),`window.spriteManifest=${JSON.stringify(report)};window.spriteVariants={};\n`);
const comparisonHtml=await readFile(path.join(ROOT,'scripts/assets/sprite-comparison.html'),'utf8');
await writeFile(path.join(output,'index.html'),preset==='gen5'?comparisonHtml.replace(
  'Both the preset and A3I5 are comparison-only: the refreshed ROM/library still use ungraded 15-color output.',
  'The refreshed ROM/library use the Gen 5 preset with 15 visible colors. A3I5 remains comparison-only.') : comparisonHtml);
// Publication happens only after every conversion and the full library validate.
for(const [id,bytes] of fileBytes) await writeFile(path.join(upgrade,'assets/pokeweb_pwan',`${id}.pwan`),bytes);
const libraryDir=path.join(ROOT,'src/assets/pwan/library');
const distribution=await writeBundledPwanArchive(libraryDir,archiveBytes);await json(path.join(libraryDir,'manifest.json'),manifest);
await json(path.join(libraryDir,'build-report.json'),{format:'pokeweb-pwan-library-build-report-v2',sourceRom:path.basename(inputRom),iconSourceRom:path.basename(inputRom),archivePath:manifest.archivePath,archiveBytes:manifest.archiveBytes,entryCount:manifest.entryCount,sideCount:manifest.sideCount,iconCount:manifest.iconCount,missingIcons:[],oneSidedEntries:libraryEntries.filter(e=>e.hasFront!==e.hasBack).map(e=>e.id),missingCredits:[],trackerReportMismatches:[],distribution,refresh:{sourceRomSha256:hash(romBytes),priorityOrder:SPRITE_PRIORITIES,preset,importedSides:report.importedSides,preservedSides:report.preservedSides}});
await json(path.join(upgrade,'assets/pokeweb_pwan/sprite_refresh_report.json'),report);
console.log(JSON.stringify({entries:manifest.entryCount,uniqueSides:pages.length,importedSides:report.importedSides,preservedSides:report.preservedSides,archiveBytes:archiveBytes.length,comparison:path.join(output,'index.html')},null,2));
