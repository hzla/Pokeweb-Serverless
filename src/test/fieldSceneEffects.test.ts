import {describe,it,expect} from 'vitest';
import fixture from '../../examples/cutscenes/aspertia.dialga-time-travel.field-scene.json';
import {readFieldScene,compileFieldScene,fieldCameraStartFrame,fieldPhaseFrames,type FieldScene} from '../pokeweb/fieldScene';
import {FieldScenePlayback} from '../pokeweb/fieldScenePlayback';
import {fieldTreeScale,buildFieldTreeProgram,fieldTreeGround,validateFieldTreeGround} from '../pokeweb/fieldTreeGrowth';
import {appendFieldMapActors,alignFieldDialgaRegistry,aspertiaNpcAgingPlan} from '../pokeweb/fieldSceneNpcs';
import {writeU16,writeU32} from '../nds/binary';
import type {Map3dChunk} from '../pokeweb/map3dModel';
import {serializeFieldEnvironment} from '../pokeweb/fieldEnvironmentRuntime';
import {readU16,readU32} from '../nds/binary';

describe('Dialga field-tour effects',()=>{
 it('plays the native cry and shake, closes timed narration, then initializes the tour camera',()=>{
  const scene=readFieldScene(fixture),bindings=Object.fromEntries(scene.steps.filter(s=>s.type==='dialogue').map((s,i)=>[s.id,{bankId:900,messageIds:[i]}]));
  const ops=compileFieldScene(scene,false,undefined,bindings).compiled.instructions;
  expect(ops.find(i=>i.opcode===0xab)?.operands).toEqual([483,0]);
  expect(ops.find(i=>i.opcode===0x148)?.operands).toEqual([2,1,6,10,0,0,0,1]);
  expect(ops.findIndex(i=>i.opcode===0xab)).toBeLessThan(ops.findIndex(i=>i.opcode===0x148));
  expect(ops.findIndex(i=>i.opcode===0x36)).toBeLessThan(ops.findIndex(i=>i.opcode===0x13f));
  expect(ops.filter(i=>i.opcode===0x34)).toHaveLength(2);expect(ops.filter(i=>i.opcode===0x36)).toHaveLength(2);expect(ops.some(i=>i.opcode===0x31)).toBe(false);
  expect(ops.slice(-4).map(i=>i.opcode)).toEqual([0x142,0x140,0x2f,2]);
 });
 it('keeps both captions automatic and places the second halfway through the music',()=>{
  const scene=readFieldScene(fixture),playback=new FieldScenePlayback(scene),prelude=fieldCameraStartFrame(scene),middle=playback.phases.find(p=>p.step.id==='years-flash')!;
  expect(prelude).toBe(151);expect(playback.frameCount-1-prelude).toBe(870);expect(middle.start-prelude).toBe(435);
  playback.seek(61);expect(playback.visible()?.pages.flat().join(' ')).toBe('Dialga uses Roar of Time!');expect(playback.pending).toBeUndefined();
  playback.seek(middle.start);expect(playback.visible()?.pages.flat().join(' ')).toBe('Years flash by...');playback.step(90);expect(playback.visible()).toBeUndefined();
 });
 it('starts the serialized live clock after the prelude and shares no animation wait with player input',()=>{
  const scene=readFieldScene(fixture),bytes=serializeFieldEnvironment(scene,[]),samples=readU32(bytes,52);
  expect(readU32(bytes,16)).toBe(0);expect(readU32(bytes,20)).toBe(750);expect(readU32(bytes,44)).toBe(870);expect(readU16(bytes,samples+750*16)).toBe(31);
  const bad=structuredClone(scene);const text=bad.steps.find(s=>s.type==='dialogue')!;Object.assign(text,{waitForInput:true});delete (text as unknown as Record<string,unknown>).durationFrames;expect(()=>readFieldScene(bad)).toThrow('timed dialogue');
 });
 it('keeps a straight pan under timed narration and serializes its native projection bindings',()=>{
  const scene=readFieldScene(fixture),cut=scene.steps.find(s=>s.id==='tree-cutaway')!,speech=scene.steps.find(s=>s.id==='years-flash')!;
  if(cut.type!=='camera.move'||speech.type!=='dialogue'||!speech.camera)throw new Error();
  expect(cut.target).toEqual([415.29464,78.9063,11192.54926]);expect(speech.camera.target).toEqual([530.2115,78.9063,11196.0628]);expect(speech.camera.fov).toBe(40);
  expect(cut.yaw).toBe(0);expect(speech.camera.yaw).toBe(0);
  const bytes=serializeFieldEnvironment(scene,[]),at=readU32(bytes,96);expect(readU32(bytes,92)).toBe(2);expect(readU32(bytes,at+52)).toBe(Math.round(40*65536/720));expect(readU32(bytes,at+64+56)).toBe(1);
  const bindings=Object.fromEntries(scene.steps.filter(s=>s.type==='dialogue').map((s,i)=>[s.id,{bankId:900,messageIds:[i]}])),ops=compileFieldScene(scene,false,undefined,bindings).compiled.instructions,caption=ops.findIndex(i=>i.opcode===0x34&&i.operands[0]===1);
  expect(ops[caption-1].opcode).toBe(0x143);expect(ops[caption+1].opcode).toBe(3);expect(ops[caption+2].opcode).toBe(0x36);expect(ops[caption+3].opcode).toBe(0x145);
 });
 it('grows staggered trees smoothly without changing their final size or accepting invalid tracks',()=>{
  const scene=readFieldScene(fixture),tree=scene.trees![0],next=scene.trees![1];
  expect(fieldTreeScale(tree,0)).toBe(.02);expect(fieldTreeScale(tree,tree.startFrame)).toBe(.02);expect(fieldTreeScale(tree,(tree.startFrame+tree.endFrame)/2)).toBeCloseTo(.51);expect(fieldTreeScale(tree,tree.endFrame+100)).toBe(1);
  expect(fieldTreeScale(tree,next.startFrame)).toBeGreaterThan(fieldTreeScale(next,next.startFrame));
  expect(()=>readFieldScene({...scene,trees:[tree,tree]})).toThrow('unique');expect(()=>readFieldScene({...scene,trees:[{...tree,endFrame:tree.startFrame}]})).toThrow('growth frames');
  expect(scene.steps.reduce((n,s)=>n+fieldPhaseFrames(scene,s),0)).toBe(1021);
 });
 it('shares quantized growth curves while preserving every tree start, end and sample',()=>{
  const scene=readFieldScene(fixture),trees=scene.trees!,prelude=fieldCameraStartFrame(scene),frames=870,links=trees.map((_,tree)=>({offset:tree*8,tree,full:[1,2,3],anchor:[0,0,0]})),bytes=buildFieldTreeProgram(trees,links,1000,prelude,frames);
  expect(bytes.length).toBeLessThan(2000);expect(readU32(bytes,4)).toBe(0x32574f52);
  const curves=new Set<number>();
  for(let i=0;i<trees.length;i++){const record=readU32(bytes,32+i*20+4),start=readU32(bytes,record),duration=readU32(bytes,record+4),curve=readU32(bytes,record+8);curves.add(curve);
   for(let f=0;f<=frames;f++){const sample=Math.max(0,Math.min(duration,f-start));expect(readU16(bytes,curve+sample*2)).toBe(Math.round(fieldTreeScale(trees[i],f+prelude)*4096));}
  }
  expect(curves.size).toBe(1);
 });
 it('requires grass across the whole footprint and rejects a higher cliff face or unsupported edge',()=>{
  const quad=(name:string,x:number,y:number,z:number,size:number)=>({material:{name,diffuse:[1,1,1] as [number,number,number],alpha:1},positions:Float32Array.from([x,y,z,x+size,y,z,x+size,y,z+size,x,y,z+size]),indices:Uint16Array.of(0,1,2,0,2,3)});
  const c={worldX:0,worldZ:0,primitives:[quad('grass01ax',-40,64,-40,80)]} as Map3dChunk;
  expect(fieldTreeGround(c,0,0)).toBe(64);expect(fieldTreeGround(c,30,0)).toBeUndefined();
  c.primitives.push(quad('gake1_1',-5,76,-5,10));expect(fieldTreeGround(c,0,0)).toBeUndefined();
  expect(()=>validateFieldTreeGround(c,{trees:[{id:'bad',position:[0,81,0]}]} as FieldScene)).toThrow('grass footprint');
 });
 it('ages only mapped city humans, preserves reserved actors, and serializes a temporary effect',()=>{
  const scene=readFieldScene(fixture),cast=[[1,251],[2,249],[3,9],[4,20],[5,28],[7,223],[8,110],[254,4632],[255,240]],events=new Uint8Array(8+cast.length*36);events[5]=cast.length;
  cast.forEach(([id,sprite],i)=>{writeU16(events,8+i*36,id);writeU16(events,10+i*36,sprite);});const before=events.slice(),plan=aspertiaNpcAgingPlan(events);
  expect(plan).toEqual([{actorId:1,originalSprite:251,agedSprite:29},{actorId:2,originalSprite:249,agedSprite:29},{actorId:3,originalSprite:9,agedSprite:29},{actorId:4,originalSprite:20,agedSprite:28},{actorId:7,originalSprite:223,agedSprite:28}]);expect(events).toEqual(before);
  const bytes=serializeFieldEnvironment(scene,[],undefined,undefined,[],plan),at=readU32(bytes,104);expect(readU32(bytes,100)).toBe(plan.length);expect(readU32(bytes,108)).toBe(750);
  expect([0,1,2].map(k=>readU32(bytes,at+k*4))).toEqual([1,251,29]);expect(readU32(bytes,64)).toBe(0x41ae);
  expect(()=>readFieldScene({...scene,zoneId:370})).toThrow('NPC aging');expect(()=>readFieldScene({...scene,ageHumanNpcs:'yes'})).toThrow('NPC aging');
 });
 it('loads Dialga as an ordinary map NPC without spawning or deleting it in the tour script',()=>{
  const scene=readFieldScene(fixture),ops=compileFieldScene(scene,false,undefined,Object.fromEntries(scene.steps.filter(s=>s.type==='dialogue').map((s,i)=>[s.id,{bankId:900,messageIds:[i]}]))).compiled.instructions;
  expect(ops.some(i=>i.opcode===0x69||i.opcode===0x6c)).toBe(false);
  const bytes=new Uint8Array(8+20+36+20+22+4);writeU32(bytes,0,bytes.length-8);bytes.set([1,1,1,1],4);bytes.fill(77,8);writeU16(bytes,28,10);
  const out=appendFieldMapActors(bytes,scene,{dialga:254},()=>144),at=64;
  expect(out[5]).toBe(2);expect(readU16(out,at)).toBe(254);expect(readU16(out,at+2)).toBe(0x1218);expect(readU16(out,at+12)).toBe(0);expect(readU16(out,at+28)).toBe(37);expect(readU16(out,at+30)).toBe(709);expect(readU32(out,at+32)).toBe(144*4096);
  expect(out.slice(8,at)).toEqual(bytes.slice(8,at));expect(out.slice(at+36)).toEqual(bytes.slice(at));
  const registry=new Uint8Array(32);writeU32(registry,0,1);writeU16(registry,4,0x1218);registry[11]=2;registry[13]=13;writeU16(registry,20,891);
  const aligned=alignFieldDialgaRegistry(registry);expect(Array.from(aligned).flatMap((v,i)=>v!==registry[i]?[i]:[])).toEqual([18]);expect(aligned[18]).toBe(252);
 });
});
