import { readU32, writeU16, writeU32 } from '../nds/binary';
import { CUTSCENE_ORIGINAL_SIZE, CUTSCENE_MAX_OVERLAY_SIZE, CUTSCENE_OVERLAY_BASE as BASE, readNativeCutsceneLayout } from './nativeCutsceneRegistry';
import asset from '../assets/cutscenes/dialogue-runtime.json';
import legacy from '../assets/cutscenes/dialogue-runtime-v1.json';
const CUE=0x021ab458-BASE,TASK=0x021a35a4-BASE,STEP=0x021a2636-BASE,HEADER=24;
const align=(n:number)=>(n+3)&~3;
type Asset=typeof legacy & {stepOffset?:number};
const decode=(a:Asset)=>Uint8Array.from(a.hex.match(/../g)!.map(n=>parseInt(n,16)));
function relocated(a:Asset,start:number){const b=decode(a);for(const at of a.relocations)writeU32(b,at,readU32(b,at)+BASE+start+HEADER);return b;}
function stepBranch(target:number){const delta=target-(BASE+STEP+4),bytes=new Uint8Array(4);writeU16(bytes,0,0xf000|((delta>>12)&0x7ff));writeU16(bytes,2,0xf800|((delta>>1)&0x7ff));return bytes;}
function installed(bytes:Uint8Array):{start:number;asset:Asset}|undefined {
  const cue=readU32(bytes,CUE),task=readU32(bytes,TASK);
  if(cue===0x021a3519&&task===0x021a35a9){if(readU32(bytes,STEP)!==0x1c646970)throw new Error('The native cutscene step hook changed.');return undefined;}
  for(const a of [asset,legacy] as Asset[]){
    const start=(cue&~1)-BASE-HEADER-a.cueOffset;
    if(start<CUTSCENE_ORIGINAL_SIZE||start+HEADER+decode(a).length>bytes.length)continue;
    const payload=relocated(a,start),step=a.stepOffset===undefined?Uint8Array.of(0x70,0x69,0x64,0x1c):stepBranch(BASE+start+HEADER+a.stepOffset);
    if(readU32(bytes,start)===0x4c445750&&readU32(bytes,start+4)===a.version&&readU32(bytes,start+8)===payload.length&&readU32(bytes,start+12)===a.stateOffset&&readU32(bytes,start+16)===0&&readU32(bytes,start+20)===0&&task===BASE+start+HEADER+a.taskOffset+1&&payload.every((n,i)=>bytes[start+HEADER+i]===n)&&step.every((n,i)=>bytes[STEP+i]===n))return {start,asset:a};
  }
  throw new Error('The native cutscene dialogue adapter was modified or is unsupported.');
}
export function cutsceneDialogueRuntimeOffset(bytes:Uint8Array){return installed(bytes)?.start;}
/** Stock cues delegate unchanged. Recognized version-1 exports upgrade in place. */
export function installCutsceneDialogueRuntime(bytes:Uint8Array){
  const layout=readNativeCutsceneLayout(bytes);if(layout.kind!=='expanded')throw new Error('Register a custom scene before installing dialogue.');
  const current=installed(bytes);
  for(const [at,hex] of [[0x021a3518,'f8b584b0151c9031aa680978161c071c'],[0x021a35a8,'f8b586b00d1c2c68061ce068002807d0'],[0x021a368c,'f0b583b00c1c051c161c201c00212822'],[0x021a36f8,'10b5041c206a002801d07ef679fe606a'],[0x021a263a,'2d18bc42efd3'],[0x021a3b28,'6868fff769f86a69282151434418']] as const)if(!hex.match(/../g)!.every((n,i)=>bytes[at-BASE+i]===parseInt(n,16)))throw new Error('The native dialogue or scene clock implementation has changed.');
  if(current?.asset.version===asset.version)return bytes;
  const code=decode(asset),start=align(bytes.length),length=align(start+HEADER+code.length);if(length>CUTSCENE_MAX_OVERLAY_SIZE)throw new Error('Dialogue exceeds the native cutscene overlay budget.');
  const output=new Uint8Array(length);output.set(bytes);writeU32(output,start,0x4c445750);writeU32(output,start+4,asset.version);writeU32(output,start+8,code.length);writeU32(output,start+12,asset.stateOffset);output.set(relocated(asset,start),start+HEADER);
  writeU32(output,CUE,BASE+start+HEADER+asset.cueOffset+1);writeU32(output,TASK,BASE+start+HEADER+asset.taskOffset+1);output.set(stepBranch(BASE+start+HEADER+asset.stepOffset),STEP);writeU32(output,CUTSCENE_ORIGINAL_SIZE+8,length);
  cutsceneDialogueRuntimeOffset(output);readNativeCutsceneLayout(output);return output;
}
