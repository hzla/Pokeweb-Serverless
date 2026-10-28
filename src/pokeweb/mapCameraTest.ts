import { readU16, readU32, writeU16, writeU32 } from '../nds/binary';
import { NARC } from '../nds/narc';
import { NintendoDSRom } from '../nds/rom';
import { compileBw2Script } from './bw2ScriptCompiler';
import { gen5ScriptEntries } from './gen5ScriptCommands';
import { appendFieldSceneScript } from './fieldSceneTest';
import { appendCutsceneTestTrigger, removeFieldSceneTestTriggers, removeNativeCutsceneTestTriggers } from './nativeCutsceneTest';
import { buildQuickLaunchDownloads, getTestBattleConfigForProject, loadTestBattleSave } from './testBattle';
import type { ProjectState } from './projectStore';
import type { Map3dSceneData } from './map3dModel';

export type MapCameraTestPosition = { zoneId:number; tileX:number; tileZ:number; height:number; facing:'up'|'down'|'left'|'right' };
const directions=['up','down','left','right'];

export function resolveMapCameraTestPosition(data:Pick<Map3dSceneData,'zoneId'|'matrixCell'|'chunks'>, point:{x:number;y:number;z:number}, facing:MapCameraTestPosition['facing']):MapCameraTestPosition {
  const position={zoneId:data.zoneId,tileX:Math.floor(point.x/16),tileZ:Math.floor(point.z/16),height:point.y,facing};
  validatePosition(position);
  if(data.matrixCell||!data.chunks.some(c=>c.matrixX===Math.floor(position.tileX/32)&&c.matrixY===Math.floor(position.tileZ/32)))throw new Error('Snap to a tile in a map with an assigned zone.');
  return position;
}

function validatePosition(p:MapCameraTestPosition){
  if(!Number.isInteger(p.zoneId)||p.zoneId<0||p.zoneId>0x7fff||![p.tileX,p.tileZ].every(n=>Number.isInteger(n)&&n>=0&&n<=2047)||!Number.isFinite(p.height)||!directions.includes(p.facing))throw new Error('The snapped position is outside the W2 map coordinate range.');
}

/** Native warp resolves terrain/BDHC height on arrival; the save stays intact. */
export function installMapCameraTestWarp(scripts:Uint8Array,events:Uint8Array,origin:{gridX:number;gridY:number;gridZ:number},position:MapCameraTestPosition){
  validatePosition(position);
  if(![origin.gridX,origin.gridY,origin.gridZ].every(Number.isInteger)||origin.gridX<0||origin.gridX>2047||origin.gridZ<0||origin.gridZ>2046||origin.gridY<0||origin.gridY>4095)throw new Error('The bundled save position is outside the W2 trigger range.');
  const compiled=compileBw2Script(`preserve_layout\nscript :map_camera_test, entry: 1 do\n  nop\n  cmd_0001\n  nop\n  cmd_0001\n  cmd_0001\n  nop\n  nop\n  cmd_0001\n  lock\n  map_change_warp ${position.zoneId}, ${position.tileX}, ${position.tileZ}, ${directions.indexOf(position.facing)}\n  unlock\n  halt\nend\n`);
  const body=compiled.bytes.subarray(compiled.entries[0].offset),entries=gen5ScriptEntries(scripts),argument=compiled.instructions.find(i=>i.opcode===0xc2)!.offset-compiled.entries[0].offset+2;
  let cleaned=removeNativeCutsceneTestTriggers(scripts,events,origin);
  cleaned=removeFieldSceneTestTriggers(scripts,cleaned,origin);
  const start=8+cleaned[4]*20+cleaned[5]*36+cleaned[6]*20;
  const owned:number[]=[];
  // Keep unknown existing launch events intact instead of shadowing them.
  for(let i=0;i<cleaned[7];i++){
    const at=start+i*22,x=readU16(cleaned,at+10),z=readU16(cleaned,at+12),w=readU16(cleaned,at+14),h=readU16(cleaned,at+16);
    const entry=entries[readU16(cleaned,at)-1],expected=[0,0,0,0,0,origin.gridX,origin.gridZ,1,2,origin.gridY*16,0];
    if(expected.every((n,j)=>j===0||readU16(cleaned,at+j*2)===n)&&entry!==undefined&&entry+body.length<=scripts.length&&body.every((n,j)=>j>=argument&&j<argument+8||scripts[entry+j]===n)){owned.push(i);continue;}
    if(origin.gridX>=x&&origin.gridX<x+w&&origin.gridZ<z+h&&origin.gridZ+1>=z)throw new Error('The bundled save launch tile already has another step event.');
  }
  if(owned.length){
    const entryId=readU16(cleaned,start+owned[0]*22),outScripts=new Uint8Array(scripts);outScripts.set(body,entries[entryId-1]);
    const remove=new Set(owned.slice(1)),end=start+cleaned[7]*22,outEvents=new Uint8Array(cleaned.length-remove.size*22);outEvents.set(cleaned.subarray(0,start));let at=start;
    for(let i=0;i<cleaned[7];i++)if(!remove.has(i)){outEvents.set(cleaned.subarray(start+i*22,start+(i+1)*22),at);at+=22;}
    outEvents.set(cleaned.subarray(end),at);outEvents[7]-=remove.size;writeU32(outEvents,0,readU32(cleaned,0)-remove.size*22);
    return {scripts:outScripts,events:outEvents,entryId};
  }
  const appended=appendFieldSceneScript(scripts,compiled);
  // Cover the saved tile and its southern neighbor. Continue, then press Down.
  const patched=appendCutsceneTestTrigger(cleaned,appended.entryId,{...origin,gridZ:origin.gridZ-1});
  const at=8+cleaned[4]*20+cleaned[5]*36+cleaned[6]*20+cleaned[7]*22;writeU16(patched,at+16,2);
  return {scripts:appended.bytes,events:patched,entryId:appended.entryId};
}

/** All fixture changes are confined to the exported ROM, never the project/save. */
export async function buildMapCameraTestDownloads(project:ProjectState,position:MapCameraTestPosition){
  if(project.session.baseRom!=='BW2'||project.session.baseVersion!=='W2'||project.romInfo.idCode!=='IRDO')throw new Error('Map camera testing currently requires US White 2.');
  validatePosition(position);
  const [download,save]=await Promise.all([buildQuickLaunchDownloads(project),loadTestBattleSave(getTestBattleConfigForProject(project))]);
  if(save.zoneId!==427)throw new Error('The bundled map test save must start in Aspertia City.');
  const rom=new NintendoDSRom(download.romBytes,{fileData:'view'}),headers=new NARC(rom.getFileByName('a/0/1/2')).files[0];
  if(!headers||Math.max(position.zoneId,save.zoneId)*48+48>headers.length)throw new Error('The target zone is missing from this ROM.');
  const overlays=rom.loadArm9Overlays([12,36]),table=overlays.get(12),field=overlays.get(36),pointer=0x021a7ef9,at=field?(pointer&~1)-field.ramAddress:-1;
  const signature='f0b587b0041c081c';
  if(!table||!field||at<0||readU32(table.data,0x1b178+0xc2*4)!==pointer||!signature.match(/../g)!.every((n,i)=>field.data[at+i]===parseInt(n,16)))throw new Error('This ROM has an unsupported native map-warp handler.');
  const scriptId=readU16(headers,save.zoneId*48+6),eventId=readU16(headers,save.zoneId*48+22),scriptFile=rom.fileId('a/0/5/6'),eventFile=rom.fileId('a/1/2/6');
  const scripts=new NARC(rom.files[scriptFile]),events=new NARC(rom.files[eventFile]);
  if(!scripts.files[scriptId]||!events.files[eventId])throw new Error('The bundled save map has missing scripts or events.');
  const fixture=installMapCameraTestWarp(scripts.files[scriptId],events.files[eventId],save,position);scripts.files[scriptId]=fixture.scripts;events.files[eventId]=fixture.events;
  return {romBytes:rom.save({files:new Map([[scriptFile,scripts.save()],[eventFile,events.save()]]),preserveOriginalLength:true}),saveBytes:new Uint8Array(save.rawSaveBytes),dsvBytes:download.saveBytes,destination:{...position},trigger:{zoneId:save.zoneId,tileX:save.gridX,tileZ:save.gridZ,width:1,height:2,scriptId,eventId,entryId:fixture.entryId}};
}
