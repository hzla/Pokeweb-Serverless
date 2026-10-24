import asset from '../assets/cutscenes/field-environment-runtime.json';
import {readU32,writeU16,writeU32} from '../nds/binary';
import {decompressCode} from '../nds/codeCompression';
import {align} from './nitroResourceWriter';
import {fieldEnvironmentClock} from './fieldEnvironmentClock';
import {fieldCameraStartFrame,fieldPhaseFrames,type FieldScene,type FieldNpcTrack} from './fieldScene';
import type {FieldPaletteProgram} from './fieldEnvironmentAssets';
import type {FieldNpcAgingSwap} from './fieldSceneNpcs';
import type {NintendoDSRom} from '../nds/rom';

export function serializeFieldEnvironment(scene:FieldScene,programs:FieldPaletteProgram[],streamId?:number,trees?:Uint8Array,mapActors:Array<FieldNpcTrack&{nativeId:number}>=[],aging:FieldNpcAgingSwap[]=[]){
  const e=scene.environment!,prelude=fieldCameraStartFrame(scene);const frames=scene.steps.reduce((n,s)=>n+fieldPhaseFrames(scene,s),0)-prelude,chunks:Uint8Array[]=[];
  let cursor=align(128+programs.length*40+(frames+1)*16);
  const header=new Uint8Array(cursor),append=(data:Uint8Array)=>{const at=cursor,padded=new Uint8Array(align(data.length));padded.set(data);chunks.push(padded);cursor+=padded.length;return at;};
  [0x45465750,2,0,programs.length,e.startFrame-prelude,e.endFrame-prelude,e.dayCycles,Math.round((e.ambientSpeed??1)*4096),(scene.entry.tileX*16+8)*4096,(scene.entry.tileZ*16+8)*4096,['spring','summer','autumn','winter'].indexOf(e.targetSeason),frames,128,128+programs.length*40].forEach((v,i)=>writeU32(header,i*4,v));
  writeU32(header,64,e.persistSeason?0x41ae:0);writeU32(header,68,0xa7c0);writeU32(header,72,streamId===undefined?0:streamId+1);
  writeU32(header,76,trees?1:0);if(trees)writeU32(header,80,append(trees));
  if(mapActors.length){const records=new Uint8Array(mapActors.length*20);mapActors.forEach((a,i)=>[a.nativeId,a.overworldId,a.entry.tileX,a.entry.tileZ,['up','down','left','right'].indexOf(a.entry.facing)].forEach((v,k)=>writeU32(records,i*20+k*4,v)));writeU32(header,84,mapActors.length);writeU32(header,88,append(records));}
  if(aging.length){const records=new Uint8Array(aging.length*12);aging.forEach((row,i)=>[row.actorId,row.originalSprite,row.agedSprite].forEach((v,k)=>writeU32(records,i*12+k*4,v)));writeU32(header,100,aging.length);writeU32(header,104,append(records));writeU32(header,108,e.endFrame-prelude);}
  const shots:Array<{from:number[];to:number[];fov:number;includeStart:boolean}>=[];let prior:number[]|undefined,priorFov:number|undefined;
  for(const step of scene.steps){const c=step.type==='camera.move'?step:step.type==='dialogue'?step.camera:undefined;if(!c)continue;const pose=[...c.target.map(n=>Math.round(n*4096)),Math.round(c.distance*4096),Math.round(c.pitch*65536/360)&65535,Math.round(c.yaw*65536/360)&65535];if(c.fov!==undefined)shots.push({from:prior??pose,to:pose,fov:c.fov,includeStart:!prior||priorFov===c.fov});prior=pose;priorFov=c.fov;}
  if(shots.length){const records=new Uint8Array(shots.length*64);shots.forEach((shot,i)=>{const delta=shot.to.map((n,k)=>k>=4?((n-shot.from[k]+32768)&65535)-32768:n-shot.from[k]);let axis=0;for(let k=1;k<4;k++)if(Math.abs(delta[k])>Math.abs(delta[axis]))axis=k;[...shot.from,...delta,axis,Math.round(shot.fov*65536/720),Number(shot.includeStart),0].forEach((v,k)=>writeU32(records,i*64+k*4,v>>>0));});writeU32(header,92,shots.length);writeU32(header,96,append(records));}
  for(let f=0;f<=frames;f++){const s=fieldEnvironmentClock(e,f+prelude),at=128+programs.length*40+f*16;writeU16(header,at,s.level);writeU16(header,at+2,Math.round(s.tint[0]*31)|Math.round(s.tint[1]*31)<<5|Math.round(s.tint[2]*31)<<10);writeU16(header,at+4,s.source);writeU16(header,at+6,s.target);writeU32(header,at+8,Math.round(s.speed*4096));}
  const blendLut=Uint8Array.from({length:32768},(_,i)=>{const level=i>>>10,x=i>>>5&31,y=i&31;return Math.round((x*(31-level)+y*level)/31);}),tintLut=Uint8Array.from({length:1024},(_,i)=>Math.round((i>>>5)*(i&31)/31));
  writeU32(header,56,append(blendLut));writeU32(header,60,append(tintLut));
  programs.forEach((p,i)=>{
    const sourceSeason=['spring','summer','autumn','winter'].indexOf(e.sourceSeason),fullBanks=p.seasons??Array.from({length:4},(_,i)=>i===sourceSeason?p.source:p.target),count=p.source.length/2;
    const indexMap=new Uint8Array(p.source.length),tuples:number[][]=[],ids=new Map<string,number>();
    for(let j=0;j<count;j++){const colors=fullBanks.map(b=>b[j*2]|b[j*2+1]<<8),key=colors.join(',');let id=ids.get(key);if(id===undefined){id=tuples.length;ids.set(key,id);tuples.push(colors);}writeU16(indexMap,j*2,id);}
    const banks=fullBanks.map((_,s)=>{const out=new Uint8Array(tuples.length*2);tuples.forEach((t,j)=>writeU16(out,j*2,t[s]));return append(out);}),paletteTable=new Uint8Array(16);banks.forEach((at,i)=>writeU32(paletteTable,i*4,at));const paletteOffset=append(paletteTable),mapOffset=append(indexMap),uniqueWork=append(new Uint8Array(tuples.length*2));
    const work=append(new Uint8Array(p.source.length)),textureTable=new Uint8Array(p.pixels.length*32),tableOffset=append(textureTable),stored=chunks.at(-1)!;
    p.pixels.forEach((t,j)=>{
      const format=t.format??4,masks=p.seasons?t.masks:t.masks.map(v=>(v&1?1<<sourceSeason:0)|(v&2?15^(1<<sourceSeason):0));
      const dirty:number[]=[];for(let k=0;k<t.indices.length;k++)if(t.alphas?t.alphas.subarray(k*4,k*4+4).some(v=>v!==t.alphas![k*4]):masks[k]!==0&&masks[k]!==15)dirty.push(k);
      const sparse=new Uint8Array(4+dirty.length*4);writeU32(sparse,0,dirty.length);dirty.forEach((k,i)=>writeU32(sparse,4+i*4,k));
      const initial=t.indices.map((v,k)=>t.alphas?v|t.alphas[k*4]<<(format===1?5:3):masks[k]&1?v:0);
      [t.offset,t.width,t.indices.length,append(t.indices),append(t.alphas??masks),append(initial),format,append(sparse)].forEach((v,k)=>writeU32(stored,j*32+k*4,v));
    });
    [p.hash,p.source.length,mapOffset,tuples.length,work,p.pixels.length,tableOffset,paletteOffset,uniqueWork,0].forEach((v,k)=>writeU32(header,128+i*40+k*4,v));
  });
  writeU32(header,8,cursor);const bytes=new Uint8Array(cursor);bytes.set(header);let at=header.length;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}if(bytes.length>512*1024)throw new Error('Live environment data exceeds its 512 KiB heap budget.');return bytes;
}
export function installFieldEnvironmentRuntime(rom:NintendoDSRom,configFileId:number){
  const overlays=rom.loadArm9Overlays([12,36,112]),field=overlays.get(36)!,gimmick=overlays.get(112)!;
  if(field.ramAddress!==0x0217f640||field.data.length!==0x561a0||gimmick.ramAddress!==0x021eecc0||gimmick.data.length!==0x420||gimmick.bssSize)throw new Error('The Aspertia field runtime layout has changed.');
  const arm9=decompressCode(rom.arm9);
  const script=overlays.get(12)!;if(!'004b1847194115020e2801db'.match(/../g)!.every((v,i)=>script.data[0x02154110-script.ramAddress+i]===parseInt(v,16)))throw new Error('The native scripted-camera ownership check has changed.');
  for(const [address,hex]of [[0x020173ac,'72218900405c7047'],[0x020173b4,'7222920081547047'],[0x020175e4,'0149405c7047c046d2010000'],[0x020175f0,'014a81547047c046d2010000'],[0x0204a960,'08b500230093fff755ff08bd'],[0x0204964c,'4068014b1847c04691860602'],[0x0204945c,'40687047'],[0x0205fa3c,'f8b5051c0e480e1c171c0093'],[0x02049a90,'436888001858002801d10020'],[0x0203a278,'10b5041c00f0caf8201c'],[0x0207b0d8,'00c0a0e3001081e01f00c0e3']] as const)if(!hex.match(/../g)!.every((v,i)=>arm9[address-rom.arm9RamAddress+i]===parseInt(v,16)))throw new Error('A native field environment provider has changed.');
  for(const guard of asset.guards)if(!guard.hex.match(/../g)!.every((v,i)=>arm9[guard.address-rom.arm9RamAddress+i]===parseInt(v,16)))throw new Error('A native field audio or saved-work provider has changed.');
  if(!'f0b589b00c1c051c'.match(/../g)!.every((v,i)=>field.data[0x021aa108-field.ramAddress+i]===parseInt(v,16))||!'f0b5'.match(/../g)!.every((v,i)=>script.data[0x021668c0-script.ramAddress+i]===parseInt(v,16)))throw new Error('The native map actor constructor has changed.');
  if(!'70b5051c0c1cfff785f9061cfff7defa'.match(/../g)!.every((v,i)=>script.data[0x02167e28-script.ramAddress+i]===parseInt(v,16)))throw new Error('The native NPC appearance changer has changed.');
  if(!'38b5051c80300180'.match(/../g)!.every((v,i)=>field.data[0x0218642c-field.ramAddress+i]===parseInt(v,16)))throw new Error('The native camera projection setter has changed.');
  const source=Uint8Array.from(asset.hex.match(/../g)!.map(s=>parseInt(s,16))),start=align(gimmick.data.length+32),base=gimmick.ramAddress+start;
  for(const at of asset.relocations)writeU32(source,at,readU32(source,at)+base);
  if(readU32(source,asset.configOffset)!==0xfeedface)throw new Error('Invalid field environment runtime configuration marker.');writeU32(source,asset.configOffset,configFileId);
  const output=new Uint8Array(align(start+source.length));output.set(gimmick.data);output.set(new TextEncoder().encode('PWFE'),gimmick.data.length);writeU32(output,gimmick.data.length+4,asset.version);writeU32(output,gimmick.data.length+8,base+asset.stateOffset);writeU32(output,gimmick.data.length+12,configFileId);output.set(source,start);
  if(gimmick.ramAddress+output.length>0x021f5a20)throw new Error('The environment adapter exceeds the reserved field gimmick window.');
  const fieldBytes=field.data.slice();
  const registrations:number[]=[];
  for(let at=0;at+16<=fieldBytes.length;at+=4)if(readU32(fieldBytes,at)===112&&readU32(fieldBytes,at+4)===0x021eecc1&&readU32(fieldBytes,at+8)===0x021eecf9&&readU32(fieldBytes,at+12)===0x021eed21)registrations.push(at);
  if(registrations.length!==1)throw new Error('The Aspertia callback registration is not uniquely recognized.');
  [asset.initOffset,asset.freeOffset,asset.updateOffset].forEach((offset,i)=>writeU32(fieldBytes,registrations[0]+4+i*4,base+offset+1));
  return {overlays:new Map([[36,fieldBytes],[112,output]]),manifest:{version:asset.version,configFileId,overlayId:112,base,stateAddress:base+asset.stateOffset,byteLength:output.length,gimmickLimit:0x021f5a20}};
}
