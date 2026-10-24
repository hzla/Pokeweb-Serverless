import { NARC } from '../nds/narc';
import type { NintendoDSRom } from '../nds/rom';
import { getRomFileBytes } from './fileSystemModel';
import { parseNpcRegistry } from './map3dModel';
import { cutsceneOverworldLibrary } from './cutsceneActors';
import type { ProjectState } from './projectStore';
import {readU16,readU32,writeU16,writeU32} from '../nds/binary';
import type {FieldScene} from './fieldScene';

export const DIALGA_RENDER_Y=-4;

/** The standing follower uses a larger billboard. Adjust only its render
 * origin, leaving the actor, shadow and terrain height on the walking layer. */
export function alignFieldDialgaRegistry(bytes:Uint8Array){
  const entries=parseNpcRegistry(bytes),index=entries.findIndex(e=>e.uid===0x1218),entry=entries[index];
  if(!entry||entry.billboardSize!==2||entry.spriteControllerType!==13||entry.resourceIndices[0]!==891||![0,DIALGA_RENDER_Y].includes(entry.wPosOffY))throw new Error('The guarded W2 Dialga follower registry entry has changed.');
  const out=bytes.slice();out[4+index*28+14]=DIALGA_RENDER_Y&255;return out;
}

export type FieldNpcAgingSwap={actorId:number;originalSprite:number;agedSprite:number};
const ASPERTIA_ELDERS=new Map<number,number>([
  ...[20,21,24,223,291].map(id=>[id,28] as [number,number]),
  ...[9,11,14,15,249,251].map(id=>[id,29] as [number,number]),
]);
/** Explicit native cast: item balls, existing elders, player and Dialga are
 * excluded. Keep actor IDs so restored cached appearances can be normalized. */
export function aspertiaNpcAgingPlan(bytes:Uint8Array):FieldNpcAgingSwap[]{
 if(bytes.length<8||8+bytes[4]*20+bytes[5]*36>bytes.length)throw new Error('Truncated Aspertia NPC records.');
 const swaps:FieldNpcAgingSwap[]=[];
 for(let i=0;i<bytes[5];i++){const at=8+bytes[4]*20+i*36,actorId=readU16(bytes,at),originalSprite=readU16(bytes,at+2),agedSprite=ASPERTIA_ELDERS.get(originalSprite);
  if(agedSprite!==undefined&&actorId<254)swaps.push({actorId,originalSprite,agedSprite});
 }
 return swaps;
}

/** Ordinary zone NPC records load with the map, before its step trigger runs. */
export function appendFieldMapActors(bytes:Uint8Array,scene:FieldScene,ids:Record<string,number>,height:(x:number,z:number)=>number){
  const actors=(scene.actors??[]).filter(a=>a.placement==='map');if(!actors.length)return bytes;
  const at=8+bytes[4]*20+bytes[5]*36,end=at+bytes[6]*20+bytes[7]*22;
  if(bytes.length<8||end>bytes.length||readU32(bytes,0)+4<end||readU32(bytes,0)+4>bytes.length||bytes[5]+actors.length>255||bytes.length+actors.length*36>=0x984)throw new Error('The map event table cannot hold these NPCs.');
  const occupied=new Set(Array.from({length:bytes[5]},(_,i)=>readU16(bytes,8+bytes[4]*20+i*36)));
  const out=new Uint8Array(bytes.length+actors.length*36);out.set(bytes.subarray(0,at));out.set(bytes.subarray(at),at+actors.length*36);
  actors.forEach((actor,i)=>{const id=ids[actor.id],p=at+i*36,y=height(actor.entry.tileX,actor.entry.tileZ);if(!Number.isInteger(id)||id<128||id>254||occupied.has(id)||!Number.isFinite(y))throw new Error('Map NPC placement requires an unused native actor ID and a ground height.');occupied.add(id);
    writeU16(out,p,id);writeU16(out,p+2,actor.overworldId);writeU16(out,p+12,['up','down','left','right'].indexOf(actor.entry.facing));
    writeU16(out,p+28,actor.entry.tileX);writeU16(out,p+30,actor.entry.tileZ);writeU32(out,p+32,Math.round(y*4096));
  });out[5]+=actors.length;writeU32(out,0,readU32(bytes,0)+actors.length*36);return out;
}

/** The standard human controller has four directions and three poses per direction.
 * Other controllers require their own animation programs, rather than guessed cycles. */
export function fieldNpcLibrary(project: ProjectState,rom: NintendoDSRom) {
  const registry=parseNpcRegistry(new NARC(getRomFileBytes(project,rom,rom.fileId('a/0/4/7'))).files[0]);
  const library=cutsceneOverworldLibrary(project,rom,true);
  const catalog=library.catalog.filter(item=>[1,3,6].includes(registry[item.id]?.spriteControllerType));
  const dialga=registry.findIndex(e=>e.uid===0x1218);if(dialga>=0)catalog.push({id:0x1218,label:'Dialga · follower (standing north)'});
  const index=(id:number)=>id===0x1218?dialga:id;
  const allowed=new Set(catalog.map(item=>item.id));
  return {catalog,renderOffset(id:number){const e=registry[index(id)];return [e?.wPosOffX??0,id===0x1218?DIALGA_RENDER_Y:e?.wPosOffY??0,e?.wPosOffZ??0];},controller(id:number){return id===0x1218?13:registry[id]?.spriteControllerType;},load(id:number){
    if(!allowed.has(id))throw new Error(`Overworld ${id} is not a supported standard W2 walking sprite. Choose a sprite from the field NPC catalog.`);
    const sprite=library.load(index(id));if(id===0x1218)return sprite;
    if(Object.values(sprite.framesByDirection).some(frames=>frames.length!==3))throw new Error(`Overworld ${id} does not contain all twelve standard walking poses.`);
    const required=registry[id].spriteControllerType===6?16:12;
    if(Array.from({length:required},(_,i)=>sprite.nativeTextures?.[i]).some(t=>!t))throw new Error(`Overworld ${id} is missing a native standing/walking texture.`);
    return sprite;
  }};
}
