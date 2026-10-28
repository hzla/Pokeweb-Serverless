import { describe,expect,it } from 'vitest';
import { readU16,readU32,writeU32 } from '../nds/binary';
import { compileBw2Script,decompileBw2Script } from '../pokeweb/bw2ScriptCompiler';
import { gen5ScriptEntries } from '../pokeweb/gen5ScriptCommands';
import { installMapCameraTestWarp,resolveMapCameraTestPosition } from '../pokeweb/mapCameraTest';
import { appendCutsceneTestTrigger,appendCutsceneTestScript } from '../pokeweb/nativeCutsceneTest';
import type { Map3dSceneData } from '../pokeweb/map3dModel';

const position={zoneId:427,tileX:35,tileZ:709,height:144,facing:'up' as const},origin={gridX:53,gridY:1,gridZ:730};
const scripts=()=>compileBw2Script('preserve_layout\nscript :original, entry: 1 do\n apply_movement 3, :walk\n wait_movement\n halt\nend\nmovement :walk do\n walk_down 1\nend\n').bytes;
const events=()=>{const bytes=new Uint8Array(17);writeU32(bytes,0,4);bytes.set([9,8,7,6,5,4,3,2,1],8);return bytes;};
describe('map camera game test',()=>{
  it('uses whole-matrix tiles, floors centered coordinates and rejects unassigned/stale map positions',()=>{
    const data={zoneId:427,chunks:[{matrixX:1,matrixY:22}]} as Map3dSceneData;
    expect(resolveMapCameraTestPosition(data,{x:568,y:144,z:11352},'up')).toEqual(position);
    for(const point of [{x:NaN,y:0,z:11352},{x:568,y:Infinity,z:11352},{x:-1,y:0,z:11352},{x:0,y:0,z:0}])expect(()=>resolveMapCameraTestPosition(data,point,'up')).toThrow();
    expect(()=>resolveMapCameraTestPosition({...data,matrixCell:{}} as Map3dSceneData,{x:568,y:144,z:11352},'up')).toThrow('assigned zone');
  });
  it('appends a native warp and two-tile launch trigger while preserving old bodies, IDs and event footer',()=>{
    const before=scripts(),oldEvents=events(),original=before.slice(),footer=oldEvents.slice(8),result=installMapCameraTestWarp(before,oldEvents,origin,position),entries=gen5ScriptEntries(result.scripts);
    expect(result.entryId).toBe(2);expect(entries[0]).toBe(gen5ScriptEntries(before)[0]+4);
    expect(result.scripts.subarray(8,before.length+4)).toEqual(before.subarray(4));
    const decoded=decompileBw2Script(result.scripts);expect(decoded.editable).toBe(true);expect(compileBw2Script(decoded.source).bytes).toEqual(result.scripts);
    const body=result.scripts.subarray(entries[1]);const at=body.findIndex((n,i)=>n===0xc2&&body[i+1]===0);
    expect([0,1,2,3].map(i=>readU16(body,at+2+i*2))).toEqual([427,35,709,0]);
    expect(Array.from({length:11},(_,i)=>readU16(result.events,8+i*2))).toEqual([2,0,0,0,0,53,730,1,2,16,0]);
    expect(result.events.subarray(30)).toEqual(footer);expect(result.events[7]).toBe(1);expect(readU32(result.events,0)).toBe(26);
    expect(before).toEqual(original);expect(oldEvents).toEqual(events());
  });
  it('retargets an already exported fixture without accumulating script entries or triggers',()=>{
    const first=installMapCameraTestWarp(scripts(),events(),origin,position),second=installMapCameraTestWarp(first.scripts,first.events,origin,{...position,zoneId:370,tileX:697,tileZ:239,facing:'right'});
    expect(second.entryId).toBe(first.entryId);expect(second.events).toEqual(first.events);expect(second.scripts.length).toBe(first.scripts.length);expect(gen5ScriptEntries(second.scripts)).toEqual(gen5ScriptEntries(first.scripts));
    expect(compileBw2Script(decompileBw2Script(second.scripts).source).instructions.find(i=>i.opcode===0xc2)?.operands).toEqual([370,697,239,3]);
    expect(installMapCameraTestWarp(second.scripts,second.events,origin,{...position,zoneId:370,tileX:697,tileZ:239,facing:'right'})).toEqual(second);
  });
  it('replaces known cutscene launch triggers but rejects unknown overlapping events and malformed tables',()=>{
    const added=appendCutsceneTestScript(scripts()),old=appendCutsceneTestTrigger(events(),added.entryId,origin),result=installMapCameraTestWarp(added.bytes,old,origin,position);
    expect(result.events[7]).toBe(1);expect(readU16(result.events,8+12)).toBe(730);
    const conflict=appendCutsceneTestTrigger(events(),1,origin);expect(()=>installMapCameraTestWarp(scripts(),conflict,origin,position)).toThrow('another step event');
    expect(()=>installMapCameraTestWarp(scripts(),new Uint8Array(4),origin,position)).toThrow('Truncated');
    expect(()=>installMapCameraTestWarp(scripts(),events(),{...origin,gridZ:-1},position)).toThrow('trigger range');
  });
});
