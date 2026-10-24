import { readU16, readU32 } from '../nds/binary';
import type { NintendoDSRom } from '../nds/rom';
import type { ProjectState } from './projectStore';
import { fieldPhaseFrames, type FieldDirection, type FieldEntry, type FieldScene, type FieldNpcTrack } from './fieldScene';
import type { SceneVector } from './cutsceneScene';

export type FieldSpriteClip = { keys: Array<{ textureIndex: number; durationFrames: number }>; loop: boolean };
export type FieldSpriteClips = { idle: Record<FieldDirection, FieldSpriteClip>; walk: Record<FieldDirection, FieldSpriteClip> };
const directions: FieldDirection[] = ['up', 'down', 'left', 'right'];

/** Standard W2 human controller animation programs: u16 texture/command, u16 duration.
 * These are field-clock durations (30 Hz), independently of the 60 Hz display. */
export function readFieldSpriteClip(bytes: Uint8Array, offset: number): FieldSpriteClip {
  const keys: FieldSpriteClip['keys'] = [];
  for (let i = 0; i < 64; i++) {
    const at = offset + i * 4;
    if (at < 0 || at + 4 > bytes.length) throw new Error('Truncated W2 sprite animation.');
    const index = readU16(bytes, at), durationFrames = readU16(bytes, at + 2);
    if (index === 0x3fff || index === 0x3ffc) {
      if (!keys.length || durationFrames !== 0) throw new Error('Unsupported W2 sprite animation terminator.');
      return { keys, loop: index === 0x3ffc };
    }
    if (index >= 16 || durationFrames < 1 || durationFrames > 120) throw new Error('Unsupported standard W2 sprite animation record.');
    keys.push({ textureIndex: index, durationFrames });
  }
  throw new Error('Unterminated W2 sprite animation.');
}

export function loadFieldSpriteClips(project: ProjectState, rom: NintendoDSRom,controllerType=1): FieldSpriteClips {
  if (project.session.baseVersion !== 'W2' || project.romInfo.idCode !== 'IRDO') throw new Error('Native field sprite timing currently requires US White 2.');
  const overlay = rom.loadArm9Overlays([36]).get(36);
  if (!overlay || overlay.ramAddress !== 0x0217f640) throw new Error('Unsupported W2 field sprite controller layout.');
  const bytes = project.overlays[36] ?? overlay.data;
  const at = 0x02197320 - overlay.ramAddress, signature = [0xf8,0xb5,0x86,0xb0,0x05,0x1c,0x00,0x20];
  if (!signature.every((n,i)=>bytes[at+i]===n)) throw new Error('The standard W2 field sprite controller has changed.');
  if(controllerType===13){const idle=Object.fromEntries(directions.map((d,i)=>[d,{keys:[{textureIndex:[0,2,4,4][i],durationFrames:1}],loop:false}])) as Record<FieldDirection,FieldSpriteClip>;return {idle,walk:idle};}
  if(![1,3,6].includes(controllerType))throw new Error('Unsupported W2 field sprite animation controller.');
  const table = (controllerType===6?0x021ce64c:controllerType===3?0x021ce78c:0x021cf13c) - overlay.ramAddress;
  const clips = (group: number) => Object.fromEntries(directions.map((d,i)=>[d,readFieldSpriteClip(bytes,readU32(bytes,table+(group*4+i)*4)-overlay.ramAddress)])) as Record<FieldDirection,FieldSpriteClip>;
  return { idle: clips(0), walk: clips(3) };
}

export function sampleFieldSpriteClip(clip: FieldSpriteClip, frame: number, firstKey = 0) {
  const duration = clip.keys.reduce((n,k)=>n+k.durationFrames,0);
  const offset = clip.keys.slice(0,firstKey).reduce((n,k)=>n+k.durationFrames,0);
  let t = Math.max(0,frame)+offset;
  if (clip.loop) t %= duration;
  else t = Math.min(t,duration-1);
  for (const key of clip.keys) { if (t < key.durationFrames) return key.textureIndex; t -= key.durationFrames; }
  return clip.keys.at(-1)!.textureIndex;
}

export type FieldPlayerPose = {
  position: SceneVector; facing: FieldDirection; textureIndex: number; poseIndex: number;
  walking: boolean; stepId: string; movementFrame: number; tileProgress: number;
};

/** Preserve the native alternating foot across stops and repeated same-direction walks.
 * A direction change resets the foot. Dense camera/position samples never reset it. */
export function compileFieldPlayerMotion(scene: FieldScene, clips: FieldSpriteClips, groundHeight: (x:number,z:number)=>number) {
  return compileMotion(scene.entry,scene.steps.map(step=>({id:step.id,duration:fieldPhaseFrames(scene,step),action:step.type==='player.walk'?{type:'walk' as const,direction:step.direction,tiles:step.tiles}:step.type==='player.face'?{type:'face' as const,direction:step.direction}:undefined})),clips,groundHeight,true);
}
export function compileFieldNpcMotion(scene: FieldScene,actor: FieldNpcTrack,clips: FieldSpriteClips,groundHeight:(x:number,z:number)=>number) {
  return compileMotion(actor.entry,scene.steps.map(step=>({id:step.id,duration:fieldPhaseFrames(scene,step),action:actor.actions.find(a=>a.stepId===step.id)})),clips,groundHeight,true);
}
type MotionAction = {type:'walk';direction:FieldDirection;tiles:number}|{type:'face';direction:FieldDirection};
function compileMotion(entry:FieldEntry,phases:Array<{id:string;duration:number;action?:MotionAction}>,clips:FieldSpriteClips,groundHeight:(x:number,z:number)=>number,initialTextureDelay:boolean) {
  let x=entry.tileX*16+8,z=entry.tileZ*16+8,facing=entry.facing,foot=0,start=0,firstWalk=initialTextureDelay;
  const segments=phases.map(phase=>{
    const {duration,action}=phase,before={x,z,facing,foot};
    if(action) { if(facing!==action.direction) foot=0; facing=action.direction; }
    const initialFoot=foot;
    if(action?.type==='walk') { x+=(facing==='right'?1:facing==='left'?-1:0)*action.tiles*16;z+=(facing==='down'?1:facing==='up'?-1:0)*action.tiles*16;foot=(foot+action.tiles)%2; }
    // A freshly loaded field retains the old texture on the first display of
    // its first walk. Later walks and facing changes update immediately.
    const pendingTexture=action?.type==='walk'&&firstWalk;
    if(action?.type==='walk')firstWalk=false;
    const result={...phase,start,before,facing,initialFoot,pendingTexture,x,z};start+=duration;return result;
  });
  const heightCache=new Map<string,number>();
  function height(x:number,z:number) {const key=`${x},${z}`;let y=heightCache.get(key);if(y===undefined){y=groundHeight(x,z);heightCache.set(key,y);}return y;}
  return { frameCount:start+1, sample(frame:number):FieldPlayerPose {
    const quantized=Math.max(0,Math.min(start,Math.floor(frame*2)/2));
    const segment=segments.find(s=>quantized<s.start+s.duration)??segments.at(-1)!;
    const elapsed=quantized-segment.start,{action}=segment,walking=action?.type==='walk'&&elapsed<action.tiles*8;
    let px=segment.x,pz=segment.z,textureIndex=sampleFieldSpriteClip(clips.idle[segment.facing],0),tileProgress=0;
    if(walking&&action?.type==='walk') {
      // The first native movement update advances two world units. Position is
      // held for the intervening display frame, rather than interpolated.
      const tick=Math.floor(elapsed)+1,progress=Math.min(action.tiles*16,tick*2);
      px=segment.before.x+(segment.facing==='right'?1:segment.facing==='left'?-1:0)*progress;
      pz=segment.before.z+(segment.facing==='down'?1:segment.facing==='up'?-1:0)*progress;
      textureIndex=segment.pendingTexture&&elapsed===0?sampleFieldSpriteClip(clips.idle[segment.before.facing],0):sampleFieldSpriteClip(clips.walk[segment.facing],elapsed,segment.initialFoot?2:0);
      tileProgress=progress/16;
    }
    return {position:[px,height(px,pz),pz],facing:segment.facing,textureIndex,poseIndex:textureIndex>=12?3:textureIndex%3,walking,stepId:segment.id,movementFrame:elapsed,tileProgress};
  } };
}
