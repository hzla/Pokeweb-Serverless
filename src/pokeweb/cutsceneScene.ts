import type { ProjectState } from './projectStore';
import { formatSceneDialogue, formatSceneChoice } from './cutsceneDialogue';
import type { SceneEnvironment, SceneMapBounds } from './cutsceneEnvironment';

export type SceneVector = [number, number, number];
export type SceneKeyframe = { id: string; frame: number; position: SceneVector; rotationDegrees: SceneVector; easing: 'linear' | 'smoothstep' | 'hold'; fov: number };
export type SceneNpcKey = { id: string; frame: number; position: SceneVector; facing: 'up' | 'down' | 'left' | 'right'; action: 'idle' | 'walk'; easing: SceneKeyframe['easing'] };
export type SceneNpcTrack = { id: string; name: string; overworldId: number; frameStep: number; keys: SceneNpcKey[] };
export type SceneJointKey = { id: string; frame: number; translation: SceneVector; rotationDegrees: SceneVector; scale: SceneVector; easing: SceneKeyframe['easing'] };
export type SceneJointTrack = { id: string; name: string; modelId: number; animationId: number; jointIndex: number; channels: Array<'translation' | 'rotation' | 'scale'>; keys: SceneJointKey[] };
export type SceneSkeletalBaseline = Record<string, { baseline: number[]; applied: number[] }>;
type EventBase = { id: string; frame: number };
export type SceneEvent = EventBase & (
  | { type: 'music.play'; assetId: number }
  | { type: 'music.stop'; fadeFrames: number }
  | { type: 'sound.play'; assetId: number; volume: number }
  | { type: 'screen.fade'; screens: 'top' | 'bottom' | 'both'; durationFrames: number; from: 'clear' | 'black' | 'white'; to: 'clear' | 'black' | 'white' }
  | { type: 'dialogue'; speakerId: string | null; text: string; waitForInput: boolean; durationFrames: number }
  | { type: 'dialogue.choice'; speakerId: string | null; text: string; choices: Array<{id:string;text:string;targetFrame:number}> }
  | { type: 'timeline.jump'; targetFrame:number }
  | { type: 'native.cue'; opcode: number; args: number[] }
);
export type CutsceneScene = {
  format: 'pokeweb.cutscene'; version: 2; id: string; name: string; target: 'W2-US'; fps: 30; frameCount: number;
  stage: { kind: 'map'; zoneId: number; season: 'spring' | 'summer' | 'autumn' | 'winter';bounds?:SceneMapBounds;includeNeighbors?:boolean } | { kind: 'native-template'; sequenceId: number };
  environment?:SceneEnvironment;
  camera: SceneKeyframe[]; events: SceneEvent[]; actors?: SceneNpcTrack[]; skeletal?: SceneJointTrack[];
  exit: { restoreCamera: true; restoreMusic: true; restorePlayerControl: true };
};
export type AuthoredCutscene = { source: CutsceneScene; revision: number; nativeFingerprint?: string; skeletalBaseline?: SceneSkeletalBaseline; mapBinding?: import("./cutsceneMapCompiler").MapCutsceneBinding };
export type CutsceneAuthoringState = { scenes: Record<string, AuthoredCutscene>; selectedId?: string };
export type SceneDiagnostic = { code: string; path: string; message: string };
const keyPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const int = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));

/** Strict, shared validation for GUI mutations and assistant-authored JSON. Never coerce or drop fields. */
export function validateCutsceneScene(value: unknown): SceneDiagnostic[] {
  const errors: SceneDiagnostic[] = [];
  const error = (path: string, message: string, code = 'INVALID_SOURCE') => errors.push({ code, path, message });
  const fields = (v: unknown, allowed: string[], required: string[], path: string): v is Record<string, unknown> => {
    if (!object(v)) { error(path, 'Expected an object.'); return false; }
    for (const key of Object.keys(v)) if (!allowed.includes(key)) error(`${path}.${key}`, 'Unknown property.');
    for (const key of required) if (!(key in v)) error(`${path}.${key}`, 'Required property is missing.');
    return true;
  };
  if (!fields(value, ['format','version','id','name','target','fps','frameCount','stage','camera','events','actors','skeletal','exit','environment'], ['format','version','id','name','target','fps','frameCount','stage','camera','events','exit'], '$')) return errors;
  if (value.format !== 'pokeweb.cutscene' || value.version !== 2) error('$.version', 'Use pokeweb.cutscene version 2. Version 1 was a design draft with a different shot contract.');
  if (typeof value.id !== 'string' || !keyPattern.test(value.id)) error('$.id', 'Use a stable ID containing letters, numbers, dots, underscores or hyphens.');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 128) error('$.name', 'Enter a name of 1–128 characters.');
  if (value.target !== 'W2-US' || value.fps !== 30) error('$.target', 'This authoring version targets US W2 at 30 animation frames per second.');
  if (!int(value.frameCount, 1, 65535)) error('$.frameCount', 'Duration must be 1–65535 frames.');
  const length = int(value.frameCount, 1, 65535) ? value.frameCount : 1;
  const stage = value.stage;
  if (object(stage) && stage.kind === 'map') {
    fields(stage, ['kind','zoneId','season','bounds','includeNeighbors'], ['kind','zoneId','season'], '$.stage');
    if(stage.includeNeighbors!==undefined&&typeof stage.includeNeighbors!=='boolean')error('$.stage.includeNeighbors','Choose whether to include neighboring scenery.');
    if (!int(stage.zoneId, 0, 65535)) error('$.stage.zoneId', 'Choose one map zone.');
    if (!['spring','summer','autumn','winter'].includes(String(stage.season))) error('$.stage.season', 'Choose a season.');
    if(stage.bounds!==undefined&&fields(stage.bounds,['west','north','width','height'],['west','north','width','height'],'$.stage.bounds')){
      for(const key of ['west','north','width','height'])if(!int(stage.bounds[key],key==='width'||key==='height'?32:0,2048)||Number(stage.bounds[key])%32)error('$.stage.bounds','Stage bounds must follow complete 32-tile matrix cells.');
      if(Number(stage.bounds.west)+Number(stage.bounds.width)>2048||Number(stage.bounds.north)+Number(stage.bounds.height)>2048)error('$.stage.bounds','Stage bounds leave the supported matrix grid.');
    }
  } else if (object(stage) && stage.kind === 'native-template') {
    fields(stage, ['kind','sequenceId'], ['kind','sequenceId'], '$.stage');
    if (!int(stage.sequenceId, 1, 63)) error('$.stage.sequenceId', 'Choose an installed native sequence from 1–63.');
  } else error('$.stage', 'Choose a single map or native template.');
  if(value.environment!==undefined&&fields(value.environment,['targetSeason','startFrame','endFrame','dayCycles','ambientSpeed'],['targetSeason','startFrame','endFrame','dayCycles'],'$.environment')){
    const e=value.environment;
    if(!object(stage)||stage.kind!=='map')error('$.environment','Environment animation requires a map stage.');
    if(!['spring','summer','autumn','winter'].includes(String(e.targetSeason)))error('$.environment.targetSeason','Choose a target season.');
    if(!int(e.startFrame,0,length-2)||!int(e.endFrame,1,length-1)||Number(e.endFrame)<=Number(e.startFrame))error('$.environment','Place the environment transition inside the timeline.');
    if(!int(e.dayCycles,1,32))error('$.environment.dayCycles','Choose 1–32 complete visual day/night cycles.');
    if(e.ambientSpeed!==undefined&&(!Number.isFinite(e.ambientSpeed)||Number(e.ambientSpeed)<1||Number(e.ambientSpeed)>16))error('$.environment.ambientSpeed','Ambient texture speed must be between 1 and 16.');
    if(Array.isArray(value.actors)&&value.actors.length)error('$.environment','The first environment exporter supports terrain and props only; NPC environment tint needs a separate implementation.','BACKEND_UNSUPPORTED');
  }
  const ids = new Set<string>(), frames = new Set<number>();
  function id(v: unknown, path: string) {
    if (typeof v !== 'string' || !keyPattern.test(v)) error(path, 'Invalid stable item ID.');
    else if (ids.has(v)) error(path, 'Item IDs must be unique across tracks, keyframes and events.', 'DUPLICATE_ID');
    else ids.add(v);
  }
  function vector(v: unknown, path: string) {
    if (!Array.isArray(v) || v.length !== 3 || v.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) >= 524288)) error(path, 'Expected three finite coordinates or angles within the native range.');
  }
  if (!Array.isArray(value.camera) || !value.camera.length || value.camera.length > 65535) error('$.camera', 'Provide 1–65535 camera keyframes.');
  else value.camera.forEach((k: unknown, i: number) => {
    const path = `$.camera[${i}]`;
    if (!fields(k, ['id','frame','position','rotationDegrees','easing','fov'], ['id','frame','position','rotationDegrees','easing','fov'], path)) return;
    id(k.id, `${path}.id`);
    if (!int(k.frame, 0, length - 1)) error(`${path}.frame`, 'Keyframe is outside the timeline.', 'FRAME_BOUNDS');
    else if (frames.has(k.frame)) error(`${path}.frame`, 'Only one camera keyframe can occupy a frame.', 'CAMERA_CONFLICT'); else frames.add(k.frame);
    vector(k.position, `${path}.position`); vector(k.rotationDegrees, `${path}.rotationDegrees`);
    if (!['linear','smoothstep','hold'].includes(String(k.easing))) error(`${path}.easing`, 'Choose linear, smoothstep or hold.');
    if (typeof k.fov !== 'number' || !Number.isFinite(k.fov) || k.fov < 1 || k.fov > 178) error(`${path}.fov`, 'Vertical field of view must be 1–178 degrees.');
  });
  if (!Array.isArray(value.events) || value.events.length > 1023) error('$.events', 'At most 1023 playback events are supported.');
  else value.events.forEach((e: unknown, i: number) => {
    const path = `$.events[${i}]`; if (!object(e)) { error(path, 'Expected an event.'); return; }
    const extras: Record<string, string[]> = { 'music.play': ['assetId'], 'music.stop': ['fadeFrames'], 'sound.play': ['assetId','volume'], 'screen.fade': ['screens','durationFrames','from','to'], 'dialogue':['speakerId','text','waitForInput','durationFrames'], 'dialogue.choice':['speakerId','text','choices'], 'timeline.jump':['targetFrame'], 'native.cue': ['opcode','args'] };
    const extra = typeof e.type === 'string' ? extras[e.type] : undefined;
    if (!extra) { error(`${path}.type`, 'This event type is not implemented; it cannot be silently discarded.', 'EVENT_UNSUPPORTED'); return; }
    fields(e, ['id','type','frame',...extra], ['id','type','frame',...extra], path); id(e.id, `${path}.id`);
    // Some original scenes contain commands beyond the imported camera range. Preserve their timing.
    if (!int(e.frame, e.type === 'native.cue' ? -1 : 0, e.type === 'native.cue' ? 65535 : length - 1)) error(`${path}.frame`, 'Event is outside the timeline.', 'FRAME_BOUNDS');
    if (e.type === 'music.play' || e.type === 'sound.play') if (!int(e.assetId, 0, 65535)) error(`${path}.assetId`, 'Use a numeric game audio ID.');
    if (e.type === 'sound.play' && !int(e.volume, 0, 127)) error(`${path}.volume`, 'Volume must be 0–127.');
    const duration = e.type === 'screen.fade' ? e.durationFrames : e.type === 'music.stop' ? e.fadeFrames : undefined;
    if (duration !== undefined && (!int(duration, 0, 65535) || typeof e.frame !== 'number' || e.frame + duration > length)) error(path, 'Event duration must fit inside the timeline.', 'FRAME_BOUNDS');
    if (e.type === 'screen.fade' && (!['top','bottom','both'].includes(String(e.screens)) || !['clear','black','white'].includes(String(e.from)) || !['clear','black','white'].includes(String(e.to)))) error(path, 'Choose valid screens and fade colors.');
    if(e.type==='dialogue'||e.type==='dialogue.choice') {
      if(!object(stage)||stage.kind!=='map')error(path,'Authored dialogue requires a map stage.','BACKEND_UNSUPPORTED');
      if(e.type==='dialogue'){
      if(typeof e.waitForInput!=='boolean'||!int(e.durationFrames,1,65535))error(path,'Choose whether to wait for input and a display duration of 1–65535 frames.');
      if(e.waitForInput&&e.frame===length-1)error(path,'Waiting dialogue needs at least one camera frame after its start.','FRAME_BOUNDS');
      if(!e.waitForInput&&typeof e.frame==='number'&&typeof e.durationFrames==='number'&&e.frame+e.durationFrames>length)error(path,'Dialogue display duration must fit inside the timeline.','FRAME_BOUNDS');
      }
      if(e.speakerId!==null&&(typeof e.speakerId!=='string'||!keyPattern.test(e.speakerId)))error(`${path}.speakerId`,'Choose an NPC track or narration.');
      if(typeof e.text!=='string'||!e.text.trim()||e.text.length>512)error(`${path}.text`,'Enter dialogue text (1–512 characters).');
      else try { if(e.type==='dialogue')formatSceneDialogue(value as unknown as CutsceneScene,e as unknown as Extract<SceneEvent,{type:'dialogue'}>);else if(Array.isArray(e.choices)&&e.choices.every((c:unknown)=>object(c)&&typeof c.text==='string'))formatSceneChoice(value as unknown as CutsceneScene,e as unknown as Extract<SceneEvent,{type:'dialogue.choice'}>); } catch(cause) { error(`${path}.text`,cause instanceof Error?cause.message:String(cause)); }
    }
    if(e.type==='dialogue.choice'||e.type==='timeline.jump'){
      if(!object(stage)||stage.kind!=='map')error(path,'Timeline branching requires a map stage.','BACKEND_UNSUPPORTED');
      const target=(v:unknown,at:string)=>{if(!int(v,typeof e.frame==='number'?e.frame+1:length,length-2))error(at,'Branch targets must be later frames before the final camera sample. Backward jumps and loops are not supported.','BRANCH_TARGET');};
      if(e.type==='timeline.jump')target(e.targetFrame,`${path}.targetFrame`);
      else if(!Array.isArray(e.choices)||e.choices.length<2||e.choices.length>3)error(`${path}.choices`,'Provide two or three responses.');
      else e.choices.forEach((choice:unknown,index:number)=>{const at=`${path}.choices[${index}]`;if(!fields(choice,['id','text','targetFrame'],['id','text','targetFrame'],at))return;id(choice.id,`${at}.id`);if(typeof choice.text!=='string'||!choice.text.trim()||choice.text.length>22)error(`${at}.text`,'A response must contain 1–22 characters.');target(choice.targetFrame,`${at}.targetFrame`);});
    }
    if (e.type === 'native.cue') {
      if (object(stage) && stage.kind !== 'native-template') error(path, 'Raw native commands require a native template.', 'BACKEND_UNSUPPORTED');
      if (!int(e.opcode, 0, 18) || !Array.isArray(e.args) || e.args.length !== 8 || e.args.some(n => !int(n, -2147483648, 2147483647))) error(path, 'A native cue requires opcode 0–18 and eight signed integer arguments.');
      if (e.opcode === 18 && Array.isArray(e.args) && [e.args[0], e.args[1]].some(n => !int(n, 1, 180 * 4096 - 1))) error(path, 'Projection field of view is outside the native range.');
    }
  });
  if(Array.isArray(value.events)) {
    const dialogue=value.events.filter((e:unknown)=>object(e)&&(e.type==='dialogue'||e.type==='dialogue.choice')&&int(e.frame,0,length-1)).sort((a,b)=>a.frame-b.frame);
    for(let i=0;i<dialogue.length;i++) {
      const e=dialogue[i],next=dialogue[i+1],waiting=e.type==='dialogue.choice'||e.waitForInput,end=e.frame+(waiting?1:e.durationFrames);
      if(next&&next.frame<end)error('$.events','Dialogue windows cannot overlap or share a frame.','DIALOGUE_CONFLICT');
      if(waiting&&value.events.some((f:unknown)=>object(f)&&f.type==='screen.fade'&&typeof f.frame==='number'&&typeof f.durationFrames==='number'&&f.frame<=e.frame&&f.frame+f.durationFrames>e.frame))error('$.events','Place wait-for-input dialogue outside active screen fades.','DIALOGUE_CONFLICT');
    }
    const controls=value.events.filter((e:unknown)=>object(e)&&(e.type==='dialogue.choice'||e.type==='timeline.jump'));
    const activeDuration=(e:unknown,at:unknown,strictStart=false)=>object(e)&&typeof at==='number'&&typeof e.frame==='number'&&typeof e.durationFrames==='number'&&(strictStart?e.frame<at:e.frame<=at)&&e.frame+e.durationFrames>at;
    for(const control of controls){
      if(value.events.some((e:unknown)=>object(e)&&e!==control&&e.frame===control.frame))error('$.events','Choices and jumps require their own event frame.','BRANCH_CONFLICT');
      if(value.events.some((e:unknown)=>object(e)&&e.type==='dialogue'&&!e.waitForInput&&activeDuration(e,control.frame)))error('$.events','Finish timed dialogue before a choice or jump.','BRANCH_CONFLICT');
      if(value.events.some((e:unknown)=>object(e)&&e.type==='screen.fade'&&activeDuration(e,control.frame)))error('$.events','Place choices and jumps outside active screen fades.','BRANCH_CONFLICT');
      const targets:unknown[]=control.type==='timeline.jump'?[control.targetFrame]:Array.isArray(control.choices)?control.choices.filter(object).map((c:Record<string,unknown>)=>c.targetFrame):[];
      for(const t of targets)if(value.events.some((e:unknown)=>object(e)&&((e.type==='dialogue'&&!e.waitForInput)||e.type==='screen.fade')&&activeDuration(e,t,true)))error('$.events','A branch cannot land inside an active fade or timed message. Start those events at the target frame.','BRANCH_CONFLICT');
    }
  }
  if (value.actors !== undefined) {
    if (!Array.isArray(value.actors) || value.actors.length > 16) error('$.actors', 'At most 16 NPC tracks are supported.');
    else value.actors.forEach((actor: unknown, i: number) => {
      const path = `$.actors[${i}]`;
      if (!fields(actor, ['id','name','overworldId','frameStep','keys'], ['id','name','overworldId','frameStep','keys'], path)) return;
      if (object(stage) && stage.kind !== 'map') error(path, 'NPC tracks require a map stage.', 'BACKEND_UNSUPPORTED');
      id(actor.id, `${path}.id`);
      if (typeof actor.name !== 'string' || !actor.name.trim() || actor.name.length > 128) error(`${path}.name`, 'Enter an NPC name of 1–128 characters.');
      if (!int(actor.overworldId, 0, 65535)) error(`${path}.overworldId`, 'Use a W2 overworld sprite ID.');
      if (!int(actor.frameStep, 1, 120)) error(`${path}.frameStep`, 'Sprite frame duration must be 1–120 timeline frames.');
      const occupied = new Set<number>();
      if (!Array.isArray(actor.keys) || !actor.keys.length || actor.keys.length > 65535) error(`${path}.keys`, 'Provide at least one NPC position keyframe.');
      else actor.keys.forEach((key: unknown, j: number) => {
        const at = `${path}.keys[${j}]`;
        if (!fields(key, ['id','frame','position','facing','action','easing'], ['id','frame','position','facing','action','easing'], at)) return;
        id(key.id, `${at}.id`); vector(key.position, `${at}.position`);
        if (!int(key.frame, 0, length - 1)) error(`${at}.frame`, 'NPC keyframe is outside the timeline.', 'FRAME_BOUNDS');
        else if (occupied.has(key.frame)) error(`${at}.frame`, 'Only one key per NPC may occupy a frame.', 'ACTOR_CONFLICT'); else occupied.add(key.frame);
        if (!['up','down','left','right'].includes(String(key.facing))) error(`${at}.facing`, 'Choose a cardinal facing direction.');
        if (!['idle','walk'].includes(String(key.action))) error(`${at}.action`, 'Choose idle or walk.');
        if (!['linear','smoothstep','hold'].includes(String(key.easing))) error(`${at}.easing`, 'Choose linear, smoothstep or hold.');
      });
    });
  }
  if (value.skeletal !== undefined) {
    if (!Array.isArray(value.skeletal) || value.skeletal.length > 256) error('$.skeletal', 'At most 256 joint tracks are supported.');
    else {
      const bindings = new Set<string>();
      value.skeletal.forEach((track: unknown, i: number) => {
        const path = `$.skeletal[${i}]`;
        if (!fields(track, ['id','name','modelId','animationId','jointIndex','channels','keys'], ['id','name','modelId','animationId','jointIndex','channels','keys'], path)) return;
        id(track.id, `${path}.id`);
        if (!object(stage) || stage.kind !== 'native-template') error(path, 'Skeletal tracks require a native template with an existing rig and clip.', 'BACKEND_UNSUPPORTED');
        if (typeof track.name !== 'string' || !track.name.trim() || track.name.length > 128) error(`${path}.name`, 'Enter a joint track name of 1–128 characters.');
        for (const key of ['modelId','animationId','jointIndex']) if (!int(track[key],0,key==='jointIndex'?255:65535)) error(`${path}.${key}`, 'Choose a valid native resource or joint index.');
        const binding = `${track.animationId}:${track.jointIndex}`;
        if (bindings.has(binding)) error(path, 'Only one track may own a joint in a native clip.', 'JOINT_CONFLICT'); else bindings.add(binding);
        if (!Array.isArray(track.channels) || !track.channels.length || track.channels.length > 3 || new Set(track.channels).size !== track.channels.length || track.channels.some(c=>!['translation','rotation','scale'].includes(String(c)))) error(`${path}.channels`, 'Choose distinct translation, rotation and/or scale channels.');
        const occupied = new Set<number>();
        if (!Array.isArray(track.keys) || !track.keys.length || track.keys.length > 65535) error(`${path}.keys`, 'Provide at least one joint keyframe.');
        else track.keys.forEach((key: unknown, j: number) => {
          const at = `${path}.keys[${j}]`;
          if (!fields(key, ['id','frame','translation','rotationDegrees','scale','easing'], ['id','frame','translation','rotationDegrees','scale','easing'], at)) return;
          id(key.id, `${at}.id`);
          if (!int(key.frame,0,length-1)) error(`${at}.frame`, 'Joint keyframe is outside the timeline.', 'FRAME_BOUNDS');
          else if (occupied.has(key.frame)) error(`${at}.frame`, 'Only one joint key may occupy a frame.', 'JOINT_CONFLICT'); else occupied.add(key.frame);
          vector(key.translation, `${at}.translation`); vector(key.rotationDegrees, `${at}.rotationDegrees`); vector(key.scale, `${at}.scale`);
          if (Array.isArray(track.channels) && track.channels.includes('scale') && Array.isArray(key.scale) && key.scale.some(n=>typeof n==='number'&&Math.abs(n)<1/4096)) error(`${at}.scale`, 'Joint scales must be nonzero at native precision.');
          if (!['linear','smoothstep','hold'].includes(String(key.easing))) error(`${at}.easing`, 'Choose linear, smoothstep or hold.');
        });
        if(Array.isArray(track.keys)&&Array.isArray(track.channels)&&track.channels.includes('scale')){
          const keys=track.keys.filter(object).sort((a,b)=>Number(a.frame)-Number(b.frame));
          for(let j=1;j<keys.length;j++){
            const a=keys[j-1],b=keys[j],before=a.scale,after=b.scale;
            if(a.easing!=='hold'&&Array.isArray(before)&&Array.isArray(after)&&after.some((n:number,axis:number)=>n*before[axis]<0))error(path,'Interpolated scales cannot cross zero. Use a hold key to change sign.');
          }
        }
      });
    }
  }
  if (fields(value.exit, ['restoreCamera','restoreMusic','restorePlayerControl'], ['restoreCamera','restoreMusic','restorePlayerControl'], '$.exit'))
    for (const [key, v] of Object.entries(value.exit)) if (v !== true) error(`$.exit.${key}`, 'This version always restores the field, music and player control.');
  return errors;
}
export function readCutsceneScene(value: unknown): CutsceneScene {
  const errors = validateCutsceneScene(value);
  if (errors.length) throw new Error(errors.slice(0, 8).map(e => `${e.path}: ${e.message}`).join('\n'));
  return structuredClone(value) as CutsceneScene;
}
const cameraOrder = new WeakMap<CutsceneScene, SceneKeyframe[]>();
export function sampleCutsceneCamera(scene: CutsceneScene, frame: number): SceneKeyframe {
  let keys = cameraOrder.get(scene);
  if (!keys) { keys = [...scene.camera].sort((a,b) => a.frame - b.frame); cameraOrder.set(scene,keys); }
  const at = Math.min(scene.frameCount - 1, Math.max(0, frame));
  let low = 0, high = keys.length;
  while (low < high) { const mid = (low + high) >>> 1; if (keys[mid].frame <= at) low = mid + 1; else high = mid; }
  const a = keys[Math.max(0, low - 1)], b = keys[Math.min(keys.length - 1, low)];
  let t = a === b || a.easing === 'hold' || at <= a.frame ? 0 : (at - a.frame) / (b.frame - a.frame);
  if (a.easing === 'smoothstep') t = t * t * (3 - 2 * t);
  const lerp = (x: number, y: number) => x + (y-x)*t;
  return { ...a, frame: at, position: a.position.map((x,i) => lerp(x,b.position[i])) as SceneVector,
    rotationDegrees: a.rotationDegrees.map((x,i) => x + (((b.rotationDegrees[i]-x+180)%360+360)%360-180)*t) as SceneVector, fov: lerp(a.fov,b.fov) };
}
export function sceneFade(scene: CutsceneScene, frame: number, screen: 'top' | 'bottom' = 'top') {
  let brightness = 0;
  const level = { black: -1, clear: 0, white: 1 };
  // Stable sorting retains document order for simultaneous events; seeking is stateless.
  for (const e of [...scene.events].sort((a,b) => a.frame-b.frame)) if (e.type === 'screen.fade' && e.frame <= frame && (e.screens === 'both' || e.screens === screen)) {
    const t = e.durationFrames ? Math.min(1, (frame-e.frame)/e.durationFrames) : 1;
    brightness = level[e.from] + (level[e.to]-level[e.from])*t;
  }
  return { color: brightness < 0 ? 'black' : 'white', opacity: Math.abs(brightness) };
}
export function nextSceneItemId(scene: CutsceneScene, prefix: string) {
  const ids = new Set([...sceneTimelineItems(scene), ...scene.actors??[], ...scene.skeletal??[],...scene.events.flatMap(e=>e.type==='dialogue.choice'?e.choices:[])].map(k => k.id)); let i = 1;
  while (ids.has(`${prefix}-${i}`)) i++; return `${prefix}-${i}`;
}
export function sceneTimelineItems(scene: CutsceneScene) { return [...scene.camera,...scene.events,...(scene.actors??[]).flatMap(a=>a.keys),...(scene.skeletal??[]).flatMap(a=>a.keys)]; }
/** Bounded-window reduction keeps every sample within tolerance of the linear result.
 * This is an explicit, undoable approximation; native imports themselves remain exact. */
export function simplifyCutsceneCamera(scene: CutsceneScene, tolerance = .01): SceneKeyframe[] {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('Choose a positive keyframe reduction tolerance.');
  const samples = Array.from({length:scene.frameCount},(_,f)=>sampleCutsceneCamera(scene,f)), keep = new Set<number>([0,scene.frameCount-1]);
  const stack:Array<[number,number]>=[];
  for(let start=0;start<scene.frameCount-1;start+=128)stack.push([start,Math.min(scene.frameCount-1,start+128)]);
  while(stack.length){
    const [start,end]=stack.pop()!;keep.add(start);keep.add(end);const a=samples[start],b=samples[end];let maximum=tolerance,split=-1;
    for(let f=start+1;f<end;f++){
      const t=(f-start)/(end-start),actual=samples[f];let error=Math.abs(actual.fov-a.fov-(b.fov-a.fov)*t);
      for(let axis=0;axis<3;axis++){
        error=Math.max(error,Math.abs(actual.position[axis]-a.position[axis]-(b.position[axis]-a.position[axis])*t));
        const turn=((b.rotationDegrees[axis]-a.rotationDegrees[axis]+180)%360+360)%360-180;
        const difference=actual.rotationDegrees[axis]-a.rotationDegrees[axis]-turn*t;
        error=Math.max(error,Math.abs(((difference+180)%360+360)%360-180));
      }
      if(error>maximum){maximum=error;split=f;}
    }
    if(split>=0){stack.push([start,split],[split,end]);}
  }
  const byFrame=new Map(scene.camera.map(k=>[k.frame,k])),ids=new Set([...scene.camera,...scene.events].map(k=>k.id));let next=1;
  return [...keep].sort((a,b)=>a-b).map(f=>{let id=byFrame.get(f)?.id;if(!id){while(ids.has(`reduced-${next}`))next++;id=`reduced-${next++}`;ids.add(id);}return {...samples[f],id,easing:'linear',position:[...samples[f].position],rotationDegrees:[...samples[f].rotationDegrees]};});
}
/** Publish one validated source revision. The source object never aliases a caller's draft. */
export function storeCutsceneScene(project: ProjectState, source: CutsceneScene, expectedRevision?: number) {
  const checked = readCutsceneScene(source), scenes = project.cutsceneAuthoring?.scenes;
  const current = scenes && Object.hasOwn(scenes,checked.id) ? scenes[checked.id] : undefined;
  if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision) throw new Error('The scene changed elsewhere. Reload before applying this edit.');
  project.cutsceneAuthoring ??= { scenes: {} };
  const record = { ...current, source: checked, revision: (current?.revision ?? 0) + 1 };
  project.cutsceneAuthoring.scenes[checked.id] = record; project.cutsceneAuthoring.selectedId = checked.id; return record;
}
export function createMapCutscene(zoneId: number, name: string, pose: { position: SceneVector; rotationDegrees: SceneVector }, id: string): CutsceneScene {
  return readCutsceneScene({ format: 'pokeweb.cutscene', version: 2, id, name, target: 'W2-US', fps: 30, frameCount: 300,
    stage: { kind: 'map', zoneId, season: 'spring' }, camera: [0,299].map((frame,i) => ({ id: `camera-${i+1}`, frame, position: [...pose.position], rotationDegrees: [...pose.rotationDegrees], fov: 40, easing: 'smoothstep' })),
    events: [{ id: 'opening-fade', type: 'screen.fade', frame: 0, screens: 'both', durationFrames: 15, from: 'black', to: 'clear' }],
    exit: { restoreCamera: true, restoreMusic: true, restorePlayerControl: true } });
}
