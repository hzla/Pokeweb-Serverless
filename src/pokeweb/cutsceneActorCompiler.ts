import { concatBytes, writeU16, writeU32 } from '../nds/binary';
import { align, writeDictionary, writeNitroFile } from './nitroResourceWriter';
import { createCutsceneBillboardModel } from './cutsceneStaticModel';
import { encodeNitroTexture } from './nitroTextureWriter';
import { writeNitroTexturePattern } from './nitroMaterialAnimationWriter';
import { sampleSceneNpc, sceneNpcTexture } from './cutsceneActors';
import { stagePoint, type MapStageManifest } from './cutsceneMapAssets';
import type { SceneNpcTrack, SceneVector } from './cutsceneScene';
import type { Map3dNpcSpriteFrames } from './map3dModel';

/** Dense root translations use the native joint clock, not field movement scripts. */
export function writeCutsceneNpcMovement(positions: SceneVector[]) {
  if (!positions.length || positions.length > 65535) throw new Error('Invalid NPC movement duration.');
  const clip = new Uint8Array(52+positions.length*12); clip.set(new TextEncoder().encode('J\0AC'));
  writeU16(clip,4,positions.length); writeU16(clip,6,1); writeU32(clip,12,clip.length); writeU32(clip,16,clip.length); writeU16(clip,20,24);
  writeU32(clip,24,0x240); // Node 0: sampled translation, identity rotation and scale.
  for (let axis=0;axis<3;axis++) {
    writeU32(clip,32+axis*8,52+axis*positions.length*4);
    positions.forEach((p,f)=>{ const n=Math.round(p[axis]*4096); if(!Number.isFinite(n)||n < -2147483648||n > 2147483647)throw new Error('NPC movement exceeds the native fixed-point range.'); writeU32(clip,52+(axis*positions.length+f)*4,n>>>0); });
  }
  const entry = new Uint8Array(4), dict = writeDictionary([{name:'npc_movement',data:entry}],4); writeU32(entry,0,8+dict.length);
  const block = concatBytes([new TextEncoder().encode('JNT0'),new Uint8Array(4),writeDictionary([{name:'npc_movement',data:entry}],4),clip]); writeU32(block,4,block.length);
  const header = new Uint8Array(16); header.set(new TextEncoder().encode('BCA0'));writeU16(header,4,0xfeff);writeU16(header,6,1);writeU16(header,12,16);
  return writeNitroFile(header,[block]);
}

export function compileCutsceneNpc(actor: SceneNpcTrack, sprites: Map3dNpcSpriteFrames, frameCount: number, manifest: Pick<MapStageManifest,'origin'|'unitsPerWorldUnit'>) {
  const textures: ReturnType<typeof encodeNitroTexture>[] = [], images = new Map<string,string>();
  const keys: Array<{frame:number;textureName:string;paletteName:string}> = [];
  for(let f=0;f<frameCount;f++) {
    const image = sceneNpcTexture(actor,f,sprites), key = `${image.width},${image.height}:`+Array.from(image.rgba).join(',');
    let name=images.get(key);
    if(!name) { name=`sprite${textures.length}`;const encoded=encodeNitroTexture({...image,name});if(encoded.quantized)throw new Error(`NPC ${actor.name} requires texture color reduction.`); textures.push(encoded);images.set(key,name); }
    if(!keys.length||keys[keys.length-1].textureName!==name)keys.push({frame:f,textureName:name,paletteName:name});
  }
  const bytes = new Uint8Array(44);writeU16(bytes,2,44);writeU32(bytes,4,0x7fffffff);writeU32(bytes,12,(31<<16)|0xc0);writeU32(bytes,16,0x3f1ff8ff);writeU32(bytes,24,0xffffffff);writeU16(bytes,30,0x1fce);writeU16(bytes,32,textures[0].width);writeU16(bytes,34,textures[0].height);writeU32(bytes,36,4096);writeU32(bytes,40,4096);
  const w=sprites.width*manifest.unitsPerWorldUnit/2,h=sprites.height*manifest.unitsPerWorldUnit;
  const model=createCutsceneBillboardModel({materialName:'npc',positions:new Float32Array([-w,0,0,w,0,0,w,h,0,-w,h,0]),uvs:new Float32Array([0,1,1,1,1,0,0,0]),colors:new Float32Array(12).fill(1),indices:new Uint16Array([0,1,2,0,2,3])},{name:'npc',bytes,textureName:textures[0].name,paletteName:textures[0].name},textures);
  const movement=writeCutsceneNpcMovement(Array.from({length:frameCount},(_,f)=>stagePoint(sampleSceneNpc(actor,f).position,manifest)));
  const pattern=writeNitroTexturePattern(frameCount,[{name:'npc',keys}]);
  return { model, group:[model,movement,pattern], textures:textures.length, textureBytes:textures.reduce((n,t)=>n+t.pixels.length,0), paletteBytes:textures.reduce((n,t)=>n+align(t.palette.length,16),0), animationBytes:movement.length+pattern.length };
}
