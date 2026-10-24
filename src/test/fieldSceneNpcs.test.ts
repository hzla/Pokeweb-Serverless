import {describe,it,expect} from 'vitest';
import example from '../../examples/cutscenes/route13.npc-field-tour.json';
import {readFieldScene,compileFieldScene,fieldPhaseFrames,fieldSceneActorIds,fieldSceneNpcPath,storeFieldScene} from '../pokeweb/fieldScene';
import {compileFieldNpcMotion,compileFieldPlayerMotion,type FieldSpriteClips} from '../pokeweb/fieldSpriteMotion';
import {validateFieldSceneGround} from '../pokeweb/fieldSceneTest';
import {makeEditProject} from './fixtures/editProject';
import {createProjectDocument} from '../pokeweb/projectDocument';
import {openProjectSession} from '../pokeweb/projectSession';

const scene=()=>readFieldScene(example);
const directions=['up','down','left','right'] as const;
const clips:FieldSpriteClips={
  idle:Object.fromEntries(directions.map((d,i)=>[d,{keys:[{textureIndex:i*3,durationFrames:1}],loop:false}])) as FieldSpriteClips['idle'],
  walk:Object.fromEntries(directions.map((d,i)=>[d,{keys:[1,0,2,0].map(n=>({textureIndex:i*3+n,durationFrames:4})),loop:true}])) as FieldSpriteClips['walk']
};
describe('live field NPC tracks',()=>{
  it('preserves independent NPC tracks through JSON and project persistence',()=>{
    const s=scene(),project=makeEditProject();storeFieldScene(project,s);
    expect(openProjectSession(structuredClone(createProjectDocument(project,false))).fieldScenes?.scenes[s.id]).toEqual(s);
    expect(fieldSceneNpcPath(s,s.actors![0]).at(-1)).toEqual({tileX:698,tileZ:249,facing:'left'});
    expect(fieldSceneNpcPath(s,s.actors![1]).at(-1)).toEqual({tileX:700,tileZ:241,facing:'right'});
  });
  it('rejects ambiguous tracks and dangling action anchors before changing a project',()=>{
    const changes=[(s:ReturnType<typeof scene>)=>s.actors![0].id='player',s=>s.actors![0].actions[0].stepId='missing',s=>s.actors![0].actions.push({...s.actors![0].actions[0],id:'duplicate'}),s=>s.actors![0].entry.tileZ=2047,s=>Object.assign(s.actors![0],{teleport:true})] as Array<(s:ReturnType<typeof scene>)=>void>;
    for(const change of changes){const s=scene();change(s);expect(()=>readFieldScene(s)).toThrow();}
    const s=scene(),project=makeEditProject();storeFieldScene(project,s);const bad=scene();bad.actors![0].actions[0].stepId='missing';expect(()=>storeFieldScene(project,bad)).toThrow();expect(project.fieldScenes!.scenes[s.id]).toEqual(s);
  });
  it('allocates unused transient IDs and compiles simultaneous native movement with a barrier',()=>{
    const s=scene(),ids=fieldSceneActorIds(s,[254,253,251]);expect(ids).toEqual({guide:252,visitor:250});
    const {compiled,source}=compileFieldScene(s,false,ids),ops=compiled.instructions;
    expect(ops.filter(i=>i.opcode===0x69).map(i=>i.operands)).toEqual([[698,244,2,252,232,0],[700,242,0,250,94,0]]);
    expect(source).toMatch(/apply_movement 252, :npc_0_3\n  apply_movement 255, :player_3\n  wait_movement/);
    expect(ops.slice(-5).map(i=>[i.opcode,...i.operands])).toEqual([[0x6c,250],[0x142],[0x140],[0x2f],[2]]);
    expect(()=>compileFieldScene(s,false,{guide:255,visitor:254})).toThrow('unused');
    expect(()=>fieldSceneActorIds(s,Array.from({length:127},(_,i)=>i+128))).toThrow('No unused');
  });
  it('extends a block for the longest concurrent walk without stretching the shorter actor',()=>{
    const s=scene();s.actors![0].actions=[{id:'long',stepId:'pause',type:'walk',direction:'down',tiles:8}];
    expect(fieldPhaseFrames(s,s.steps[1])).toBe(64);
    const npc=compileFieldNpcMotion(s,s.actors![0],clips,()=>10),player=compileFieldPlayerMotion(s,clips,()=>10);
    expect(npc.sample(150)).toMatchObject({walking:true,position:[11176,10,3974]});
    expect(npc.sample(184)).toMatchObject({walking:false,position:[11176,10,4040]});
    expect(player.sample(184)).toMatchObject({walking:false,position:[11160,10,3832]});
  });
  it('uses native pose order, discrete positions and alternating feet independently for every NPC',()=>{
    const s=scene(),npc=compileFieldNpcMotion(s,s.actors![0],clips,()=>0);
    expect([120,120.5,124,128,270,270.5,274,278,302].map(f=>npc.sample(f).textureIndex)).toEqual([6,4,3,3,5,5,3,4,3]);
    expect(npc.sample(270.5).position).toEqual(npc.sample(270).position);
    expect(npc.sample(270)).toMatchObject({position:[11176,0,3930],walking:true});
    expect(npc.sample(350)).toMatchObject({textureIndex:9,facing:'right',walking:false});
  });
  it('checks every NPC path against ground permissions, including actors idle in place',()=>{
    const s=scene(),tiles=Array.from({length:1024},()=>({tileClass:25,flags:0x88,height:0,heightType:0,slope:0}));
    const chunk={chunkId:87,sourceChunkId:87,matrixX:21,matrixY:7,worldX:11008,worldZ:3840,primitives:[],permissions:{chunkId:87,width:32,height:32,tiles}};
    expect(()=>validateFieldSceneGround(s,{chunks:[chunk]})).not.toThrow();
    tiles[(247%32)*32+698%32].flags|=1;
    expect(()=>validateFieldSceneGround(s,{chunks:[chunk]})).toThrow('Coast guide tile 698, 247');
  });
});
