import {readU16,readU32,writeU16,writeU32,concatBytes} from '../nds/binary';
import {readNitroResources,decodeTexture,loadMap3dZone,extractGameFreakContainer,type DecodedTexture} from './map3dModel';
import {readDictionary,writeDictionary,nitroBlocks,writeNitroFile,align} from './nitroResourceWriter';
import {fieldEnvironmentClock,type FieldEnvironment} from './fieldEnvironmentClock';
import {blendSeasonalImage,encodeSeasonalTexture,pairEnvironmentPrimitives,scopeCutsceneMap} from './cutsceneEnvironment';
import {NARC} from '../nds/narc';
import type {NintendoDSRom} from '../nds/rom';
import type {ProjectState} from './projectStore';
import type {FieldScene} from './fieldScene';

export type FieldPaletteProgram={hash:number;source:Uint8Array;target:Uint8Array;seasons?:Uint8Array[];pixels:Array<{offset:number;width:number;indices:Uint8Array;masks:Uint8Array;format?:number;alphas?:Uint8Array}>};
/** One index image, with an exact palette for each season. No colour reduction. */
export function encodeFieldSeasons(images:DecodedTexture[]){
  if(images.length!==4||images.some(t=>t.width!==images[0].width||t.height!==images[0].height))throw new Error('Four matching seasonal textures are required.');
  const a=images[0],translucent=images.some(t=>t.rgba.some((v,i)=>i%4===3&&v>0&&v<255));
  const alpha3=Array.from({length:8},(_,i)=>{const x=i<<2|i>>>1;return x<<3|x>>>2;}),alpha5=Array.from({length:32},(_,i)=>i<<3|i>>>2);
  const format=translucent?(images.every(t=>t.rgba.every((v,i)=>i%4!==3||alpha3.includes(v)))?1:6):4,limit=format===1?32:format===6?8:255;
  const tuples:number[][][]=[],lookup=new Map<string,number>(),indices=new Uint8Array(a.width*a.height),masks=indices.slice(),pixels=indices.slice(),alphas=translucent?new Uint8Array(indices.length*4):undefined;
  for(let i=0;i<indices.length;i++){
    const k=i*4,alpha=images.map(t=>t.rgba[k+3]);if(alphas){const values=format===1?alpha3:alpha5;alpha.forEach((v,s)=>{const level=values.indexOf(v);if(level<0)throw new Error(`Unsupported seasonal alpha in ${a.name}.`);alphas[i*4+s]=level;});}
    const visible=images.find(t=>t.rgba[k+3]);if(!visible)continue;
    const colors=images.map(t=>Array.from((t.rgba[k+3]?t:visible).rgba.subarray(k,k+3),v=>Math.round(v*31/255))),key=colors.flat().join(',');
    let index=lookup.get(key);if(index===undefined){index=tuples.length;lookup.set(key,index);tuples.push(colors);}if(tuples.length>limit)throw new Error(`Four-season texture ${a.name} exceeds its exact palette capacity.`);
    indices[i]=index+Number(!translucent);masks[i]=alpha.reduce((n,v,s)=>n|Number(v>0)<<s,0);
    if(translucent){const values=format===1?alpha3:alpha5,level=values.indexOf(alpha[0]);if(level<0)throw new Error('Unsupported native alpha.');pixels[i]=index|level<<(format===1?5:3);}else pixels[i]=masks[i]&1?indices[i]:0;
  }
  const palettes=images.map((_,season)=>{const out=new Uint8Array(align(Math.max(1,tuples.length+Number(!translucent))*2,16));tuples.forEach((colors,i)=>writeU16(out,(i+Number(!translucent))*2,colors[season][0]|colors[season][1]<<5|colors[season][2]<<10));return out;});
  return {palettes,pixels,indices,masks,alphas,format,params:(format<<26)|(format===4?1<<29:0)|Math.log2(a.width/8)<<20|Math.log2(a.height/8)<<23};
}
export function fieldTextureSignature(tex:Uint8Array):number{
  let hash=2166136261;const feed=(v:number)=>{hash=Math.imul(hash^v,16777619)>>>0;};
  for(const dict of [readDictionary(tex,readU16(tex,14)),readDictionary(tex,readU32(tex,52))])for(const e of dict){for(let i=0;i<16;i++)feed(e.name.charCodeAt(i)||0);for(const b of e.data)feed(b);}
  return hash;
}
/** RGB fades retain both endpoint artworks. Binary outlines use ordered pixel
 * coverage, avoiding extra field geometry and retaining exact endpoint masks. */
export function encodeFieldSeasonTexture(a:DecodedTexture,b:DecodedTexture){
  if(a.width!==b.width||a.height!==b.height)throw new Error('Field seasonal textures must have equal dimensions.');
  if(a.rgba.some((v,i)=>i%4===3&&v>0&&v<255)||b.rgba.some((v,i)=>i%4===3&&v>0&&v<255)){
    const encoded=encodeSeasonalTexture(a,b,'field'),source=encoded.texture.palette,targetName=encoded.names[31],target=targetName==='field'?source:encoded.palettes.find(p=>p.name===targetName)!.bytes;
    if(encoded.frames.length!==1)throw new Error('Changing translucent field masks are not supported.');
    return {source,target,pixels:encoded.texture.pixels,indices:encoded.texture.pixels,masks:new Uint8Array(a.width*a.height).fill(3),params:encoded.texture.params};
  }
  const values:Array<[number[],number[]]> = [],lookup=new Map<string,number>(),indices=new Uint8Array(a.width*a.height),masks=indices.slice();
  for(let i=0;i<indices.length;i++){
    const k=i*4,aa=a.rgba[k+3],ba=b.rgba[k+3];if(![aa,ba].every(v=>v===0||v===255))throw new Error(`Changing translucent field texture ${a.name} is not supported.`);
    masks[i]=Number(aa>0)|Number(ba>0)<<1;if(!masks[i])continue;
    const x=Array.from((aa?a:b).rgba.subarray(k,k+3),v=>Math.round(v*31/255)),y=Array.from((ba?b:a).rgba.subarray(k,k+3),v=>Math.round(v*31/255)),key=[...x,...y].join(',');
    let index=lookup.get(key);if(index===undefined){index=values.length+1;lookup.set(key,index);values.push([x,y]);}if(index>255)throw new Error(`Field texture ${a.name} exceeds 255 joint colours.`);indices[i]=index;
  }
  const source=new Uint8Array(align((values.length+1)*2,16)),target=source.slice();
  values.forEach(([a,b],i)=>{writeU16(source,(i+1)*2,a[0]|a[1]<<5|a[2]<<10);writeU16(target,(i+1)*2,b[0]|b[1]<<5|b[2]<<10);});
  const pixels=indices.map((v,i)=>masks[i]&1?v:0),params=(Math.log2(a.width)-3)<<20|(Math.log2(a.height)-3)<<23|4<<26|1<<29;
  return {source,target,pixels,indices,masks,params};
}
export function prepareFieldTexturePack(file:Uint8Array,changes:Map<string,{palette:string;images:DecodedTexture[]}>){
  const blocks=nitroBlocks(file),blockIndex=blocks.findIndex(b=>String.fromCharCode(...b.slice(0,4))==='TEX0');if(blockIndex<0)throw new Error('Missing field TEX0.');
  const old=blocks[blockIndex],textures=readDictionary(old,readU16(old,14)),palettes=readDictionary(old,readU32(old,52));
  const bytes=(at:number,size:number)=>old.slice(readU32(old,at),readU32(old,at)+(readU16(old,size)<<3));
  const pixelParts:Uint8Array[]=[bytes(20,12)],seasonParts:Uint8Array[][]=Array.from({length:4},()=>[bytes(56,48)]),pixelPrograms:FieldPaletteProgram['pixels']=[];
  let pixelSize=pixelParts[0].length,paletteSize=seasonParts[0][0].length;const changedPalettes=new Set<string>();
  for(const [name,pair] of changes){
    const texture=textures.find(t=>t.name===name),palette=palettes.find(p=>p.name===pair.palette);if(!texture||!palette)throw new Error(`Missing field texture/palette ${name}/${pair.palette}.`);
    if(changedPalettes.has(pair.palette))throw new Error(`Shared field palette ${pair.palette} needs a joint multi-texture profile.`);changedPalettes.add(pair.palette);
    const encoded=encodeFieldSeasons(pair.images),padding=align(paletteSize,16)-paletteSize;
    if(padding){seasonParts.forEach(parts=>parts.push(new Uint8Array(padding)));paletteSize+=padding;}
    writeU32(texture.data,0,encoded.params|pixelSize/8);writeU16(palette.data,0,paletteSize/8);
    // Encoded seasonal images use A3I5/A5I3 or 256 colours. The original
    // four-colour flag changes native palette address units; retaining it
    // points the converted texture at the wrong colours.
    writeU16(palette.data,2,readU16(palette.data,2)&~1);
    if(encoded.alphas||encoded.masks.some(v=>v!==0&&v!==15))pixelPrograms.push({offset:pixelSize,width:pair.images[0].width,indices:encoded.indices,masks:encoded.masks,alphas:encoded.alphas,format:encoded.format});
    pixelParts.push(encoded.pixels);seasonParts.forEach((parts,i)=>parts.push(encoded.palettes[i]));pixelSize+=encoded.pixels.length;paletteSize+=encoded.palettes[0].length;
  }
  const compressed=bytes(36,28),compressedIndices=old.slice(readU32(old,40),readU32(old,40)+compressed.length/2),td=writeDictionary(textures,8),pd=writeDictionary(palettes,4),start=align(60+td.length+pd.length,8),cmp=start+pixelSize,idx=cmp+compressed.length,pal=align(idx+compressedIndices.length,8),out=new Uint8Array(pal+paletteSize);
  out.set(old.slice(0,60));writeU32(out,4,out.length);writeU16(out,12,pixelSize/8);writeU16(out,14,60);writeU32(out,20,start);writeU32(out,36,cmp);writeU32(out,40,idx);writeU16(out,48,paletteSize/8);writeU32(out,52,60+td.length);writeU32(out,56,pal);
  out.set(td,60);out.set(pd,60+td.length);out.set(concatBytes(pixelParts),start);out.set(compressed,cmp);out.set(compressedIndices,idx);out.set(concatBytes(seasonParts[0]),pal);blocks[blockIndex]=out;
  if(pixelSize+compressed.length*1.5>256*1024||paletteSize>32*1024)throw new Error('Field seasonal pack exceeds texture/palette budgets.');
  return {file:writeNitroFile(file,blocks),program:{hash:fieldTextureSignature(out),source:concatBytes(seasonParts[0]),target:concatBytes(seasonParts[2]),seasons:seasonParts.map(parts=>concatBytes(parts)),pixels:pixelPrograms},changedTextures:changes.size};
}
function staticPaletteProgram(file:Uint8Array):FieldPaletteProgram|undefined{
  const tex=nitroBlocks(file).find(b=>String.fromCharCode(...b.slice(0,4))==='TEX0');if(!tex||!readU16(tex,48))return;
  const source=tex.slice(readU32(tex,56),readU32(tex,56)+(readU16(tex,48)<<3));return {hash:fieldTextureSignature(tex),source,target:source.slice(),pixels:[]};
}
export async function buildFieldEnvironmentAssets(project:ProjectState,rom:NintendoDSRom,scene:FieldScene){
  const e=scene.environment;if(!e||scene.zoneId!==427||e.sourceSeason!=='summer'||e.targetSeason!=='autumn')throw new Error('The live environment prototype currently targets Aspertia summer → autumn.');
  const all=await Promise.all((['spring','summer','autumn','winter'] as const).map(season=>loadMap3dZone(project,427,{season,includeNeighbors:true,cache:false}))),a=all[1],b=all[2];
  if(b.sourceAreaId!==210||b.buildingsId!==52)throw new Error('The Aspertia area binding has changed.');
  for(const map of all)pairEnvironmentPrimitives(scopeCutsceneMap(a,undefined,true),scopeCutsceneMap(map,undefined,true));
  const textures=new NARC(rom.getFileByName('a/0/1/4')),areaFile=rom.fileId('a/0/1/3'),areas=rom.files[areaFile].slice(),maps=new NARC(rom.getFileByName('a/0/0/8')),changes=new Map<string,{palette:string;images:DecodedTexture[]}>(),paletteOwners=new Map<string,Set<string>>();
  const chunksAll=all.map(m=>[...m.chunks,...m.neighboringScenery?.chunks??[]]),chunksB=chunksAll[2];
  const {materialRecords}=await import('./nitroResourceWriter');
  for(const c of chunksB){const peers=chunksAll.map(chunks=>chunks.find(x=>x.matrixX===c.matrixX&&x.matrixY===c.matrixY)!);if(peers.some(other=>!other||other.primitives.length!==c.primitives.length))throw new Error('Seasonal field geometry changed.');
    const records=materialRecords(extractGameFreakContainer(maps.files[c.chunkId]).files[0]);
    for(let i=0;i<c.primitives.length;i++){const p=c.primitives[i],record=records.find(r=>r.name===p.material.name);if(!record?.textureName||!record.paletteName)continue;const owners=paletteOwners.get(record.paletteName)??new Set();owners.add(record.textureName);paletteOwners.set(record.paletteName,owners);
      if(p.textureAnimation?.sample(0).texture)continue;const images=peers.map(c=>c.primitives[i].material.texture);if(images.some(t=>!t)||images.every(t=>t!.rgba.every((v,k)=>v===images[0]!.rgba[k])))continue;
      const prior=changes.get(record.textureName);if(prior&&prior.palette!==record.paletteName)throw new Error('Multiple palette bindings need an explicit profile.');changes.set(record.textureName,{palette:record.paletteName,images:images as DecodedTexture[]});
    }
  }
  for(const pair of changes.values())if((paletteOwners.get(pair.palette)?.size??0)>1)throw new Error(`Shared seasonal palette ${pair.palette} needs a multi-texture profile.`);
  const prepared=prepareFieldTexturePack(textures.files[b.textureId],changes),privateTextureId=textures.files.length;textures.files.push(prepared.file);
  let endpointTexels=0;
  for(let season=0;season<4;season++){
    const parts=nitroBlocks(prepared.file),t=parts.find(b=>String.fromCharCode(...b.slice(0,4))==='TEX0')!;t.set(prepared.program.seasons[season],readU32(t,56));
    for(const pixels of prepared.program.pixels)t.set(pixels.indices.map((v,i)=>pixels.alphas?v|(pixels.alphas[i*4+season]<<(pixels.format===1?5:3)):pixels.masks[i]&(1<<season)?v:0),readU32(t,20)+pixels.offset);
    const decoded=readNitroResources(writeNitroFile(prepared.file,parts));
    for(const [name,pair]of changes){const actual=decodeTexture(decoded.textures.find(t=>t.name===name)!,decoded.palettes.find(p=>p.name===pair.palette))!,expected=pair.images[season];
      for(let k=0;k<actual.rgba.length;k+=4){if(actual.rgba[k+3]!==expected.rgba[k+3]||actual.rgba[k+3]&&[0,1,2].some(c=>Math.round(actual.rgba[k+c]*31/255)!==Math.round(expected.rgba[k+c]*31/255)))throw new Error(`Field season ${season} endpoint did not retain ${name}.`);if(actual.rgba[k+3])endpointTexels++;}
    }
  }
  // One field stays loaded while palettes and outline coverage visit each season.
  if(areas.length%10)throw new Error('Unsupported area table layout.');
  for(let season=0;season<4;season++){const at=(b.sourceAreaId+season)*10;areas.set(areas.slice(b.areaId*10,b.areaId*10+10),at);writeU16(areas,at+2,privateTextureId);}
  const programs:FieldPaletteProgram[]=[prepared.program],propTextures=new NARC(rom.getFileByName('a/1/7/4')),bundle=extractGameFreakContainer(new NARC(rom.getFileByName('a/2/2/5')).files[b.buildingsId]);
  for(const file of [propTextures.files[b.buildingsId],...bundle.files.filter(f=>String.fromCharCode(...f.slice(0,4))==='BMD0')]){if(!file)continue;const p=staticPaletteProgram(file);if(!p)continue;const old=programs.find(x=>x.hash===p.hash);if(old){if(!old.target.every((v,i)=>v===p.target[i]))throw new Error('Field texture signature collision.');}else programs.push(p);}
  return {files:new Map([[rom.fileId('a/0/1/4'),textures.save()],[areaFile,areas]]),programs,manifest:{zoneId:427,sourceSeason:e.sourceSeason,targetSeason:e.targetSeason,privateTextureId,changedTextures:prepared.changedTextures,verifiedEndpointTexels:endpointTexels,programs:programs.length,alphaCoverageTextures:prepared.program.pixels.length,seasons:['spring','summer','autumn','winter'],endpoint:'Four exact native seasonal artworks; ordered coverage during blends.',originalTerrainAndCollisionsUnchanged:true}};
}

/** The lookout's retail day backdrop uses a joint pose to hide its alternate
 * sky planes. Applying that pose avoids coplanar day/night meshes in preview. */
export async function poseFieldLookoutBackdrop(data:import('./map3dModel').Map3dSceneData,rom:NintendoDSRom){
  if(data.zoneId!==427)return data;
  const bundle=extractGameFreakContainer(new NARC(rom.getFileByName('a/2/2/5')).files[data.buildingsId]),count=bundle.files.length/2;
  const index=bundle.files.slice(0,count).findIndex(m=>readU16(m,0)===443);if(index<0)return data;
  const meta=bundle.files[index],model=bundle.files[index+count],at=16+readU32(meta,24),joint=meta.slice(at,at+readU32(meta,at+8));
  if(String.fromCharCode(...joint.slice(0,4))!=='BCA0')return data;
  const blocks=nitroBlocks(model);if(!blocks.some(b=>String.fromCharCode(...b.slice(0,4))==='TEX0')){const shared=new NARC(rom.getFileByName('a/1/7/4')).files[data.buildingsId];blocks.push(...nitroBlocks(shared).filter(b=>String.fromCharCode(...b.slice(0,4))==='TEX0'));}
  const {compileNitroAnimatedModel}=await import('./nitroAnimatedModel'),posed=compileNitroAnimatedModel(writeNitroFile(model,blocks),joint,undefined,{neutralLight:true});posed.sample(0);
  const parts=posed.primitives.filter(p=>p.visible!==false).map(p=>({...p,positions:p.positions.slice(),uvs:p.uvs?.slice(),colors:p.colors?.slice()}));
  return {...data,buildings:data.buildings.map(b=>b.uid===443?{...b,primitives:parts}:b)};
}

/** All seasonal previews share the same clock and exact source surfaces. */
export function fieldEnvironmentPreview(maps:import('./map3dModel').Map3dSceneData[],e:FieldEnvironment,frames:number){
 const base=maps[1],pairs=maps.map(m=>pairEnvironmentPrimitives(base,m)),cache=new WeakMap<DecodedTexture,WeakMap<DecodedTexture,Map<number,DecodedTexture>>>();
 const parts=(ps:import('./map3dModel').Map3dPrimitive[])=>ps.map(p=>({...p,textureAnimation:{frameCount:frames,rawUvs:p.textureAnimation?.rawUvs,sample(frame:number){
  const clock=fieldEnvironmentClock(e,frame),a=pairs[clock.source].get(p)!,b=pairs[clock.target].get(p)!,x=a.textureAnimation?.sample(clock.ambientFrame)??{},y=b.textureAnimation?.sample(clock.ambientFrame)??{},from=x.texture??a.material.texture,to=y.texture??b.material.texture;
  if(!from||!to)return x;let targets=cache.get(from);if(!targets){targets=new WeakMap();cache.set(from,targets);}let levels=targets.get(to);if(!levels){levels=new Map();targets.set(to,levels);}let texture=levels.get(clock.level);if(!texture){texture=blendSeasonalImage(from,to,clock.level);levels.set(clock.level,texture);}return {...x,texture};
 }}}));
 return {...base,chunks:base.chunks.map(c=>({...c,primitives:parts(c.primitives)})),buildings:base.buildings.map(b=>({...b,primitives:parts(b.primitives)}))};
}
