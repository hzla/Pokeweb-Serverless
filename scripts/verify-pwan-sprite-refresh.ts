import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../src/nds/rom';
import { NARC } from '../src/nds/narc';
import { parseW2Anim, W2ANIM_PATH, decodeW2AnimFrame } from '../src/pokeweb/w2animCodec';
import { w2animEditorToLinear } from '../src/pokeweb/w2animAnimationModel';
import { validatePwan, parsePwanHeader, pwanPalette, pwanTimeline, normalizePwanSourceFrames } from '../src/pokeweb/pwanCompiler';
import { decodeGifFrames } from '../src/pokeweb/gifAnimationFrames';
import { a3i5SourceColorCount, shouldMakeA3i5Preview, validateA3i5SpritePreview } from './lib/a3i5-sprite-preview';
import { parsePwanLibraryArchive, type PwanLibraryManifest } from '../src/pokeweb/pwanLibraryModel';
import { SPRITE_PRIORITIES, nativeSpriteBlock, parseSpriteConfig, extractRomPwan, readNclrPalette } from './lib/pwan-sprite-refresh';
import type { Folder } from '../nds/fnt';
import { readBundledPwanArchive } from './lib/pwan-library-payload';

const [outputArg,upgradeArg,newRomArg,...options] = process.argv.slice(2);
if (!outputArg || !upgradeArg || !newRomArg) throw new Error('Usage: verify-pwan-sprite-refresh.ts COMPARISON_DIR UPGRADE_DIR REBUILT_ROM');
const optionValue=(key:string)=>{const n=options.indexOf(key);if(n<0)return undefined;if(!options[n+1]||options[n+1]!.startsWith('--'))throw new Error(`Missing ${key} value`);return options[n+1];};
const preset=optionValue('--preset')??'none';
if(preset!=='none'&&preset!=='gen5')throw new Error('Expected none or gen5 preset');
const variant=preset==='gen5'?'gen5':'new';
const output=path.resolve(outputArg),upgrade=path.resolve(upgradeArg);
const libraryDir=optionValue('--library')?path.resolve(optionValue('--library')!):output;
const verificationOutput=optionValue('--result')?path.resolve(optionValue('--result')!):path.join(output,'verification.json');
const read=async(p:string)=>new Uint8Array(await readFile(p));
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const check=(v:unknown,message:string)=>{if(!v)throw new Error(message);};
const same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,n)=>v===b[n]);
const report=JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));
const backup=JSON.parse(await readFile(path.join(output,'backup/manifest.json'),'utf8'));
const oldBytes=await read(path.join(output,'backup/White2Upgrade-before-refresh.nds'));
check(hash(oldBytes)===backup.romSha256,'Previous ROM backup changed');
const oldRom=new NintendoDSRom(oldBytes,{fileData:'view'});
const oldStreams=parseW2Anim(oldRom.files[oldRom.fileId(W2ANIM_PATH)]!);
const oldPersonal=new NARC(oldRom.files[oldRom.fileId('a/0/1/6')]!);
const oldGraphics=new NARC(oldRom.files[oldRom.fileId('a/0/0/4')]!);
const config=await read(path.join(upgrade,'assets/pokeweb_pwan/config.bin'));
check(hash(config)===backup.configSha256,'Sprite mappings changed');
check(JSON.stringify(report.priorityOrder)===JSON.stringify(SPRITE_PRIORITIES),'Import priority differs from reviewed policy');
check(report.failures.length===0,'Conversion failures exist');
const bytes=await read(newRomArg),rom=new NintendoDSRom(bytes,{fileData:'view'});
const streams=parseW2Anim(rom.files[rom.fileId(W2ANIM_PATH)]!);
const newGraphics=new NARC(rom.files[rom.fileId('a/0/0/4')]!);
const oldKeys=oldStreams.entries.map(e=>`${e.arc}:${e.flags}:${e.sheetFile}:${e.shinyNclrFile}`);
check(JSON.stringify(oldKeys)===JSON.stringify(streams.entries.map(e=>`${e.arc}:${e.flags}:${e.sheetFile}:${e.shinyNclrFile}`)),'w2anim native mappings changed');
const manifest:PwanLibraryManifest=JSON.parse(await readFile(path.join(libraryDir,libraryDir===output?'library-manifest.json':'manifest.json'),'utf8'));
const libraryBytes=await readBundledPwanArchive(libraryDir),library=new NARC(libraryBytes);
const loaded=parsePwanLibraryArchive(manifest,libraryBytes);
check(loaded.entries.length===report.entries&&loaded.iconsByEntryId.size===report.entries,'Library entry/icon counts differ');
const previousManifest:PwanLibraryManifest=JSON.parse(await readFile(path.join(output,'backup/pokeweb-library/manifest.json'),'utf8'));
const previousLibrary=new NARC(await readBundledPwanArchive(path.join(output,'backup/pokeweb-library')));
let preservedIcons=0,checkedBaselineFrames=0,checkedOutputFrames=0,checkedRows=0;
for(const entry of manifest.entries) {
  const previous=previousManifest.entries.find(e=>e.key===entry.key);
  if(previous?.icon&&entry.icon) {
    for(const sex of ['male','female'] as const) {
      check(same(previousLibrary.files[previous.icon[`${sex}MemberId`]]!,library.files[entry.icon[`${sex}MemberId`]]!),`Bundled ${sex} icon changed for ${entry.name}`);
      check(previous.icon[`${sex}PaletteId`]===entry.icon[`${sex}PaletteId`],`Icon palette changed for ${entry.name}`);
    }
    preservedIcons++;
  }
}
for(const page of report.sprites) {
  const row={speciesId:page.species,formIndex:page.form,assetIndex:page.asset,flags:3},block=nativeSpriteBlock(row,oldPersonal.files[page.species]!);
  const oldEntry=oldStreams.entries.find(e=>e.arc===4&&e.sheetFile===block*20+(page.side==='front'?2:11))!;
  const recovered=extractRomPwan(oldStreams,oldEntry,readNclrPalette(oldGraphics.files[block*20+18]!));
  check(same(recovered,await read(path.join(output,'old',page.id+'.pwan'))),`Previous ROM output differs for ${page.id}`);
  checkedBaselineFrames+=parsePwanHeader(recovered).frameCount;
  for(const kind of ['old','new','gen5']) {
    const value=await read(path.join(output,kind,page.id+'.pwan'));validatePwan(value);
    check(hash(value)===page.hashes[kind],`Comparison hash differs for ${page.id}/${kind}`);
  }
  const pwan=await read(path.join(output,variant,page.id+'.pwan'));
  check(same(pwan,await read(path.join(upgrade,'assets/pokeweb_pwan',page.id+'.pwan'))),`Upgrade asset differs for ${page.id}`);
  const member=page.asset*2+(page.side==='front'?1:2);
  check(same(pwan,library.files[member]!),`Library asset differs for ${page.id}`);
  if(page.status==='preserved')check(same(recovered,pwan)&&same(pwan,await read(path.join(output,'gen5',page.id+'.pwan'))),`Preserved sprite changed for ${page.id}`);
}
for(const row of parseSpriteConfig(config)) {
  const block=nativeSpriteBlock(row,oldPersonal.files[row.speciesId]!);
  for(const [side,flag,offset] of [['front',1,2],['back',2,11]] as const) {
    if(!(row.flags&flag))continue;
    const pwan=await read(path.join(upgrade,'assets/pokeweb_pwan',`${row.assetIndex}_${side}.pwan`)), header=validatePwan(pwan);
    const entry=streams.entries.find(e=>e.arc===4&&e.sheetFile===block*20+offset);
    check(entry,`Missing rebuilt ROM stream for ${row.speciesId}:${row.formIndex}:${side}`);
    const mani=streams.manis.get(entry!.maniOffset)!;
    check(mani.width===96&&mani.height===96&&!!(mani.flags&2),'ROM output must remain 96x96 TEX4');
    const palette=mani.normalPalette??readNclrPalette(newGraphics.files[block*20+18]!);
    check(palette.subarray(1).every((v,n)=>v===pwanPalette(pwan)[n+1]),`ROM palette differs for ${row.assetIndex}:${side}`);
    const timeline=pwanTimeline(pwan);
    check(mani.frames.length===header.frameCount&&mani.sequence.length===timeline.length,'ROM frame/timeline count differs');
    check(timeline.every((step,n)=>step.frameIndex===mani.sequence[n]!.frame&&step.ticks===mani.sequence[n]!.duration),'ROM timeline differs');
    for(let n=0;n<header.frameCount;n++) {
      const expected=w2animEditorToLinear(pwan.subarray(header.frameOffset+n*4608,header.frameOffset+(n+1)*4608));
      check(same(expected,decodeW2AnimFrame(streams,mani,n)),`ROM pixels differ for ${row.assetIndex}:${side}:${n}`);
      checkedOutputFrames++;
    }
    checkedRows++;
  }
}
const scan=(folder:Folder):void=>{for(const name of folder.files)check(!/PokewebPwan.*\.dll$/i.test(name),'PWAN runtime DLL was staged');for(const[,child]of folder.folders)scan(child);};
scan(rom.filenames);check(rom.filenames.idOf('zz_pokeweb_pwan/pwan.narc')===undefined,'Legacy PWAN archive staged into w2anim ROM');
for(const entry of oldStreams.entries.filter(e=>e.arc!==4)) {
  const oldMani=oldStreams.manis.get(entry.maniOffset)!,newEntry=streams.entries.find(e=>e.arc===entry.arc&&e.sheetFile===entry.sheetFile)!,newMani=streams.manis.get(newEntry.maniOffset)!;
  check(same(oldStreams.bytes.subarray(oldMani.offset,oldMani.end),streams.bytes.subarray(newMani.offset,newMani.end)),'Non-Pokemon stream changed');
}
let checkedA3i5Sides=0,checkedA3i5SourceFrames=0;
if(report.a3i5&&!options.includes('--skip-a3i5')) for(const page of report.sprites) {
  if(page.status!=='imported')continue;
  const source=decodeGifFrames(await read(path.join(output,'sources',page.id+'.gif'))),sourceColors=a3i5SourceColorCount(source);
  check(page.a3i5.sourceColorCount===sourceColors&&page.a3i5.eligible===shouldMakeA3i5Preview(sourceColors),`A3I5 eligibility differs for ${page.id}`);
  if(!page.a3i5.eligible)continue;
  const normalized=normalizePwanSourceFrames(source);
  for(const kind of ['new','gen5'] as const) {
    const packed=JSON.parse(await readFile(path.join(output,'a3i5',page.id+'-'+kind+'.json'),'utf8'));
    const value={...packed,frames:new Uint8Array(Buffer.from(packed.frames,'base64'))};
    validateA3i5SpritePreview(value);
    check(hash(value.frames)===page.a3i5.sha256[kind],`A3I5 hash differs for ${page.id}/${kind}`);
    check(value.sourceColors===sourceColors&&value.colorPreset===(kind==='new'?'none':'gen5'),'A3I5 source/preset metadata differs');
    const nearest=new Map<number,number>();
    let time=0,step=0,stepStart=0;
    for(const frame of normalized) {
      while(time>=stepStart+value.timeline[step].ticks){stepStart+=value.timeline[step].ticks;step++;}
      const base=value.timeline[step].frame*12288;
      // Independently check every visible texel against the source and selected
      // palette. This also catches treating opaque palette index zero as clear.
      for(let y=0;y<96;y++)for(let x=0;x<96;x++) {
        const sourceY=y-page.groundShift,at=(sourceY*96+x)*4;
        const opaque=sourceY>=0&&sourceY<96&&frame.pixels[at+3]!>=128;
        const texel=value.frames[base+y*128+x]!;
        if(!opaque){check(texel===0,`A3I5 transparency differs for ${page.id}/${kind}`);continue;}
        let r=frame.pixels[at]!,g=frame.pixels[at+1]!,b=frame.pixels[at+2]!;
        if(kind==='gen5'){
          const luma=(r*299+g*587+b*114)/1000;
          const grade=(c:number)=>Math.max(0,Math.min(255,Math.round((luma+(c-luma)*1.15-128)*1.1+128)));
          r=grade(r);g=grade(g);b=grade(b);
        }
        r>>>=3;g>>>=3;b>>>=3;
        const key=r|g<<5|b<<10;
        let index=nearest.get(key);
        if(index===undefined){
          let distance=Infinity;index=0;
          for(let n=0;n<value.visibleColors;n++){
            const c=value.palette[n],dr=r-(c&31),dg=g-(c>>5&31),db=b-(c>>10&31),d=2*dr*dr+4*dg*dg+3*db*db;
            if(d<distance){distance=d;index=n;}
          }
          nearest.set(key,index);
        }
        check(texel===(0xe0|index),`A3I5 colors differ for ${page.id}/${kind}`);
      }
      time+=Math.max(1,Math.min(65535,Math.round(frame.delayMs*60/1000)))*page.timingScale;
      checkedA3i5SourceFrames++;
    }
    check(time===value.totalTicks,`A3I5 duration differs for ${page.id}/${kind}`);
  }
  checkedA3i5Sides++;
}
if(report.a3i5&&!options.includes('--skip-a3i5'))check(checkedA3i5Sides===report.a3i5.eligibleSides&&checkedA3i5Sides+report.a3i5.skippedSides===report.uniqueSides,'A3I5 comparison count differs');
const result={passed:true,backend:'w2anim',sourceRomSha256:hash(oldBytes),newRomSha256:hash(bytes),entries:report.entries,uniqueSides:report.uniqueSides,importedSides:report.importedSides,preservedSides:report.preservedSides,previousIconsPreserved:preservedIcons,checkedBaselineFrames,checkedOutputFrames,checkedRows,romSheets:streams.entries.length,preset,textureFormat:'TEX4',nativeMappingsUnchanged:true,noPwanRuntime:true,savesTouched:false,behavioralEmulatorTesting:false,checkedA3i5Sides,checkedA3i5SourceFrames,a3i5ComparisonOnly:!!report.a3i5};
await writeFile(verificationOutput,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
