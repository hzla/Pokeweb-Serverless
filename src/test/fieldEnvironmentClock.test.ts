import {describe,it,expect} from 'vitest';
import fixture from '../../examples/cutscenes/aspertia.dialga-time-travel.field-scene.json';
import {readFieldScene,fieldCameraStartFrame} from '../pokeweb/fieldScene';
import {fieldEnvironmentClock} from '../pokeweb/fieldEnvironmentClock';
import {encodeFieldSeasons} from '../pokeweb/fieldEnvironmentAssets';
import {serializeFieldEnvironment} from '../pokeweb/fieldEnvironmentRuntime';
import {readU16,readU32} from '../nds/binary';

describe('Dialga seasonal tour clock',()=>{
 it('authors a 29-second excerpt and visits all four seasons before settling in autumn',()=>{
  const scene=readFieldScene(fixture),e=scene.environment!,samples=Array.from({length:871},(_,f)=>fieldEnvironmentClock(e,f+fieldCameraStartFrame(scene)));
  expect(scene.music!.endSeconds-scene.music!.startSeconds).toBe(29);expect(scene.music!.durationFrames).toBe(870);
  expect(new Set(samples.map(s=>s.source))).toEqual(new Set([0,1,2,3]));expect(samples[0].source).toBe(1);expect(samples.at(-1)).toMatchObject({target:2,level:31,speed:1});
  expect(scene.actors![0]).toMatchObject({overworldId:0x1218,entry:{facing:'up'}});
 });
 it('accelerates and brakes smoothly while its integrated animation phase stays continuous',()=>{
  const e=readFieldScene(fixture).environment!,start=fieldEnvironmentClock(e,e.startFrame),middle=fieldEnvironmentClock(e,(e.startFrame+e.endFrame)/2),end=fieldEnvironmentClock(e,e.endFrame);
  expect(start.speed).toBe(1);expect(middle.speed).toBe(16);expect(end.speed).toBe(1);expect(middle.progress).toBeLessThan(.5);
  for(let f=e.startFrame+1;f<=e.endFrame;f++){const a=fieldEnvironmentClock(e,f-1),b=fieldEnvironmentClock(e,f);expect(b.progress).toBeGreaterThanOrEqual(a.progress);expect(b.ambientFrame-a.ambientFrame).toBeGreaterThanOrEqual(.99);expect(b.ambientFrame-a.ambientFrame).toBeLessThanOrEqual(32.01);}
  expect(fieldEnvironmentClock(e,e.endFrame+1).ambientFrame-end.ambientFrame).toBe(1);
  const boost=e.tempo!.boost!;expect(fieldEnvironmentClock(e,boost.startFrame).speed).toBe(16);expect(fieldEnvironmentClock(e,boost.startFrame+boost.durationFrames).speed).toBe(32);
  expect(fieldEnvironmentClock(e,boost.startFrame+boost.durationFrames).progress-fieldEnvironmentClock(e,boost.startFrame+boost.durationFrames-1).progress).toBeCloseTo(2*(fieldEnvironmentClock(e,boost.startFrame).progress-fieldEnvironmentClock(e,boost.startFrame-1).progress),5);
 });
 it('rejects malformed envelopes and preserves persistence and music in JSON',()=>{
  expect(()=>readFieldScene({...fixture,environment:{...fixture.environment,tempo:{accelerateFraction:0,decelerateFraction:.3}}})).toThrow('fractions');
  expect(()=>readFieldScene({...fixture,environment:{...fixture.environment,tempo:{...fixture.environment.tempo,boost:{startFrame:800,durationFrames:60,multiplier:3}}}})).toThrow('boost');
  expect(()=>readFieldScene({...fixture,environment:{...fixture.environment,seasonCycles:9}})).toThrow('cycles');
  expect(()=>readFieldScene({...fixture,music:{...fixture.music,path:'https://example.com/song.strm'}})).toThrow('local STRM');
  expect(readFieldScene(JSON.parse(JSON.stringify(fixture))).environment!.persistSeason).toBe(true);
 });
 it('retains four distinct RGB555 and translucent endpoints without colour reduction',()=>{
  const alphas=[0,148,255,74],images=alphas.map((alpha,i)=>({name:'shadow',width:8,height:8,rgba:Uint8Array.from(Array.from({length:64},()=>[i*72,255-i*72,i*48,alpha]).flat())}));
  const encoded=encodeFieldSeasons(images);expect(encoded.format).toBe(1);
  for(let s=0;s<4;s++){expect(encoded.alphas![s]).toBe([0,4,7,2][s]);const color=readU16(encoded.palettes[s],encoded.indices[0]*2);if(alphas[s])for(let c=0;c<3;c++)expect(color>>c*5&31).toBe(Math.round(images[s].rgba[c]*31/255));}
 });
 it('serializes sparse alpha edits, deduplicated palettes and the sampled speed envelope',()=>{
  const scene=readFieldScene(fixture),a=new Uint8Array([0,0,31,0,31,0,0,0]),banks=[a,a,a,a];
  const indices=Uint8Array.of(1,2,3,1),masks=Uint8Array.of(15,15,15,1),bytes=serializeFieldEnvironment(scene,[{hash:123,source:a,target:a,seasons:banks,pixels:[{width:2,offset:8,indices,masks}]}],1),row=readU32(bytes,48),samples=readU32(bytes,52);
  expect(readU32(bytes,4)).toBe(2);expect(readU32(bytes,row+12)).toBe(2);expect(readU32(bytes,64)).toBe(0x41ae);expect(readU32(bytes,72)).toBe(2);
  expect(readU32(bytes,samples+375*16+8)).toBe(16*4096);const texture=readU32(bytes,row+24),sparse=readU32(bytes,texture+28);expect(readU32(bytes,sparse)).toBe(1);expect(readU32(bytes,sparse+4)).toBe(3);
 });
});
