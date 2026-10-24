import { describe, expect, it } from 'vitest';
import example from '../../examples/cutscenes/route13.field-scene.json';
import { readFieldScene, storeFieldScene } from '../pokeweb/fieldScene';
import { readFieldSpriteClip, sampleFieldSpriteClip, compileFieldPlayerMotion, loadFieldSpriteClips, type FieldSpriteClips } from '../pokeweb/fieldSpriteMotion';
import { readU32, writeU16, writeU32 } from '../nds/binary';
import type { NintendoDSRom } from '../nds/rom';
import { makeEditProject } from './fixtures/editProject';
import { createProjectDocument } from '../pokeweb/projectDocument';
import { openProjectSession } from '../pokeweb/projectSession';
const directions=['up','down','left','right'] as const;
function clips():FieldSpriteClips {
  return {idle:Object.fromEntries(directions.map((d,i)=>[d,{keys:[{textureIndex:i*3,durationFrames:1}],loop:false}])) as FieldSpriteClips['idle'],
    walk:Object.fromEntries(directions.map((d,i)=>[d,{keys:[1,0,2,0].map(n=>({textureIndex:i*3+n,durationFrames:4})),loop:true}])) as FieldSpriteClips['walk']};
}
const scene=()=>readFieldScene(example);
describe('native W2 field sprite playback',()=>{
  it('reads native texture/duration programs and preserves their loop/end semantics',()=>{
    const data=new Uint8Array(20);[[4,4],[3,4],[5,4],[3,4],[0x3ffc,0]].forEach(([texture,duration],i)=>{writeU16(data,i*4,texture);writeU16(data,i*4+2,duration);});
    const clip=readFieldSpriteClip(data,0);expect(clip).toEqual(clips().walk.down);
    expect([0,3.5,4,7.5,8,12,16,24].map(f=>sampleFieldSpriteClip(clip,f))).toEqual([4,4,3,3,5,3,4,5]);
    expect(sampleFieldSpriteClip(clip,0,2)).toBe(5);
    writeU16(data,16,0x3fff);const once=readFieldSpriteClip(data,0);expect(sampleFieldSpriteClip(once,999)).toBe(3);
    expect(()=>readFieldSpriteClip(data.slice(0,17),0)).toThrow('Truncated');
    writeU16(data,0,0x4004);expect(()=>readFieldSpriteClip(data,0)).toThrow('Unsupported');
  });
  it('samples all walking poses across dense timeline samples instead of resetting to standing',()=>{
    const s=scene(),m=compileFieldPlayerMotion(s,clips(),()=>-80),start=270;
    expect(Array.from({length:32},(_,i)=>m.sample(start+i*.5).textureIndex)).toEqual([3,4,4,4,4,4,4,4,3,3,3,3,3,3,3,3,5,5,5,5,5,5,5,5,3,3,3,3,3,3,3,3]);
    expect(m.sample(start).position).toEqual([11160,-80,3834]);
    expect(m.sample(start+.5).position).toEqual(m.sample(start).position);
    expect(m.sample(start+1).position[2]).toBe(3836);
    m.sample(400);expect(m.sample(start+.5).textureIndex).toBe(4);
    expect(m.sample(350)).toMatchObject({walking:false,textureIndex:3,position:[11160,-80,3992]});
  });
  it('keeps alternate feet through stops, resets on direction changes and retains final facing',()=>{
    const s=scene(),camera=s.steps[0];if(camera.type!=='camera.move')throw new Error('Expected opening camera move.');
    s.steps=[{...camera,durationFrames:1},{id:'first',type:'player.walk',direction:'down',tiles:1},{id:'hold',type:'wait',durationFrames:5},{id:'second',type:'player.walk',direction:'down',tiles:1},{id:'hold2',type:'wait',durationFrames:5},{id:'left',type:'player.walk',direction:'left',tiles:2},{id:'face',type:'player.face',direction:'up'},{id:'return',type:'control.return',durationFrames:1}];
    const m=compileFieldPlayerMotion(s,clips(),()=>0);
    expect(m.sample(1)).toMatchObject({textureIndex:3,walking:true});
    expect(m.sample(1.5).textureIndex).toBe(4);expect(m.sample(14)).toMatchObject({textureIndex:5,walking:true});
    expect(m.sample(27)).toMatchObject({textureIndex:7,facing:'left'});
    expect(m.sample(27.5).textureIndex).toBe(7);expect(m.sample(35).textureIndex).toBe(8);
    expect(m.sample(43)).toMatchObject({textureIndex:0,facing:'up'});expect(m.sample(43.5).textureIndex).toBe(0);
    expect(m.sample(999)).toMatchObject({textureIndex:0,facing:'up',position:[11128,0,3864]});
  });
  it('loads active ROM timing tables with explicit controller/layout guards',()=>{
    const base=0x0217f640,data=new Uint8Array(0x50000),table=0x021cf13c-base;
    data.set([0xf8,0xb5,0x86,0xb0,0x05,0x1c,0x00,0x20],0x02197320-base);
    for(const [group,entries]of [[0,clips().idle],[3,clips().walk]] as const)directions.forEach((d,i)=>{const at=0x1000+(group*4+i)*32;writeU32(data,table+(group*4+i)*4,base+at);const clip=entries[d];clip.keys.forEach((k,j)=>{writeU16(data,at+j*4,k.textureIndex);writeU16(data,at+j*4+2,k.durationFrames);});writeU16(data,at+clip.keys.length*4,clip.loop?0x3ffc:0x3fff);});
    const rom={loadArm9Overlays:()=>new Map([[36,{ramAddress:base,data}]])} as unknown as NintendoDSRom;
    const project=makeEditProject();project.romInfo.idCode='IRDO';expect(loadFieldSpriteClips(project,rom)).toEqual(clips());
    const maleTable=0x021ce64c-base;
    for(let i=0;i<16;i++)writeU32(data,maleTable+i*4,readU32(data,table+i*4));
    directions.forEach((_,i)=>{const at=0x3000+i*8;writeU32(data,maleTable+i*4,base+at);writeU16(data,at,12+i);writeU16(data,at+2,1);writeU16(data,at+4,0x3fff);});
    const male=loadFieldSpriteClips(project,rom,6);expect(male.idle.left.keys[0].textureIndex).toBe(14);
    expect(compileFieldPlayerMotion(scene(),male,()=>0).sample(0)).toMatchObject({textureIndex:13,poseIndex:3});
    const changed=data.slice();writeU16(changed,0x1000+(3*4+1)*32+2,5);project.overlays[36]=changed;expect(loadFieldSpriteClips(project,rom).walk.down.keys[0].durationFrames).toBe(5);
    changed[0x02197320-base]^=1;expect(()=>loadFieldSpriteClips(project,rom)).toThrow('changed');
    project.romInfo.idCode='TEST';expect(()=>loadFieldSpriteClips(project,rom)).toThrow('US White 2');
  });
  it('persists preview avatar independently of the runtime player binding',()=>{
    const project=makeEditProject();storeFieldScene(project,scene());project.fieldScenes!.previewPlayer='female';
    const restored=openProjectSession(structuredClone(createProjectDocument(project,false)));
    expect(restored.fieldScenes?.previewPlayer).toBe('female');expect(restored.fieldScenes!.scenes[scene().id]).toEqual(scene());
  });
});
