import { compileBw2Script, type CompiledBw2Script } from './bw2ScriptCompiler';
import type { ProjectState } from './projectStore';
import type {FieldEnvironment} from './fieldEnvironmentClock';
import { fieldDialoguePages, formatFieldDialogue, type FieldDialogueBindings } from './fieldSceneDialogue';

export type FieldDirection = 'up' | 'down' | 'left' | 'right';
export type FieldEntry = { tileX: number; tileZ: number; facing: FieldDirection };
export type FieldNpcAction = { id: string; stepId: string; direction: FieldDirection } & (
  | { type: 'walk'; tiles: number } | { type: 'face' }
);
export type FieldNpcTrack = {
  id: string; name: string; overworldId: number; entry: FieldEntry;
  endBehavior: 'stay' | 'remove'; actions: FieldNpcAction[];
  /** Map actors are ordinary zone NPC records, present before and after playback. */
  placement?: 'tour' | 'map';
};
export type FieldCameraMove = {durationFrames:number;target:[number,number,number];pitch:number;yaw:number;distance:number;fov?:number};
export type FieldDialogueStep = {id:string;type:'dialogue';speakerId:string;text:string;window?:'dialogue'|'narration';camera?:FieldCameraMove} & (
  | {waitForInput:true} | {waitForInput:false;durationFrames:number}
);
export type FieldSceneStep = FieldDialogueStep | { id: string } & (
  | ({ type: 'camera.move' } & FieldCameraMove)
  | { type: 'wait'; durationFrames: number }
  | { type: 'pokemon.cry'; species: number; form: number }
  | { type: 'camera.shake'; amplitudeX: number; amplitudeY: number; periodFrames: number; cycles: number }
  | { type: 'player.walk'; direction: FieldDirection; tiles: number }
  | { type: 'player.face'; direction: FieldDirection }
  | { type: 'control.return'; durationFrames: number }
);
/** A field-script program, deliberately separate from the dedicated native renderer. */
export type FieldScene = {
  format: 'pokeweb.field-scene'; version: 1; target: 'W2-US'; fps: 30;
  id: string; name: string; zoneId: number;
  entry: FieldEntry;
  steps: FieldSceneStep[];
  actors?: FieldNpcTrack[];
  trees?:Array<{id:string;position:[number,number,number];startFrame:number;endFrame:number}>;
  environment?:FieldEnvironment;
  music?:{path:string;sourceName:string;startSeconds:number;endSeconds:number;durationFrames:number};
  returnCamera?:'gameplay'|'entry';
  ageHumanNpcs?:boolean;
};
export type FieldSceneAuthoring = { scenes: Record<string, FieldScene>; selectedId?: string; previewPlayer?: 'male' | 'female' };
// Native no-ops identify our export-only launch script without reserving game variables.
export const FIELD_TEST_PREFIX = Uint8Array.from(Array.from({length:32},(_,i)=>[(0x50574631 >>> i)&1,0]).flat());
const directions = ['up', 'down', 'left', 'right'];
const validId = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(s);
const integer = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Reject unsupported authoring fields rather than silently changing their meaning. */
export function readFieldScene(value: unknown): FieldScene {
  const fail = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
  const fields = (v: unknown, keys: string[], path: string, optional: string[] = []): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(path, 'Expected an object.');
    const obj = v as Record<string, unknown>;
    for (const k of keys) if (!(k in obj)) fail(`${path}.${k}`, 'Required property.');
    for (const k of Object.keys(obj)) if (!keys.includes(k) && !optional.includes(k)) fail(`${path}.${k}`, 'Unsupported property.');
    return obj;
  };
  const s = fields(value, ['format', 'version', 'target', 'fps', 'id', 'name', 'zoneId', 'entry', 'steps'], '$', ['actors','trees','environment','returnCamera','music','ageHumanNpcs']);
  if (s.format !== 'pokeweb.field-scene' || s.version !== 1 || s.target !== 'W2-US' || s.fps !== 30) fail('$', 'Use pokeweb.field-scene version 1, W2-US, 30 fps.');
  if (!validId(s.id)) fail('$.id', 'Invalid stable ID.');
  if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 128) fail('$.name', 'Enter a name of 1–128 characters.');
  if (!integer(s.zoneId, 0, 32767)) fail('$.zoneId', 'Invalid map zone.');
  const entry = fields(s.entry, ['tileX', 'tileZ', 'facing'], '$.entry');
  if (!integer(entry.tileX, 0, 2047) || !integer(entry.tileZ, 0, 2047) || !directions.includes(String(entry.facing))) fail('$.entry', 'Choose grid coordinates 0–2047 and a cardinal facing.');
  if (!Array.isArray(s.steps) || s.steps.length < 2 || s.steps.length > 128) fail('$.steps', 'Provide 2–128 steps, ending in Return control.');
  const steps = s.steps as unknown[], ids = new Set<string>();
  steps.forEach((v, i) => {
    const path = `$.steps[${i}]`, type = (v as FieldSceneStep | null)?.type;
    const keys: Record<string, string[]> = { 'camera.move': ['durationFrames', 'target', 'pitch', 'yaw', 'distance'], 'pokemon.cry':['species','form'], 'camera.shake':['amplitudeX','amplitudeY','periodFrames','cycles'], wait: ['durationFrames'], 'player.walk': ['direction', 'tiles'], 'player.face': ['direction'], 'control.return': ['durationFrames'], dialogue:['speakerId','text','waitForInput',...((v as FieldDialogueStep)?.waitForInput===false?['durationFrames']:[])] };
    if (!type || !keys[type]) fail(path, 'Unsupported field scene action.');
    const step = fields(v, ['id', 'type', ...keys[type!]], path,type==='dialogue'?['camera','window']:type==='camera.move'?['fov']:[]);
    if (!validId(step.id) || ids.has(step.id)) fail(`${path}.id`, 'Step IDs must be valid and unique.');
    ids.add(step.id as string);
    if ('durationFrames' in step && !integer(step.durationFrames, 1, 1800)) fail(path, 'Duration must be 1–1800 frames at 30 fps.');
    if (type === 'camera.move') {
      if (!Array.isArray(step.target) || step.target.length !== 3 || step.target.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) >= 32768)) fail(path, 'Camera target requires three world coordinates within ±32768.');
      for (const key of ['pitch', 'yaw']) if (typeof step[key] !== 'number' || !Number.isFinite(step[key]) || (step[key] as number) < 0 || (step[key] as number) >= 360) fail(path, 'Camera angles must be 0–359.999 degrees.');
      if (typeof step.distance !== 'number' || !Number.isFinite(step.distance) || step.distance < 16 || step.distance > 2048) fail(path, 'Camera distance must be 16–2048 world units.');
    }
    if (type === 'player.walk' || type === 'player.face') if (!directions.includes(String(step.direction))) fail(path, 'Choose a cardinal direction.');
    if (type === 'player.walk' && !integer(step.tiles, 1, 32)) fail(path, 'Walk 1–32 tiles per step.');
    const projection=type==='camera.move'?step:type==='dialogue'?step.camera as Record<string,unknown>|undefined:undefined;if(projection?.fov!==undefined&&(typeof projection.fov!=='number'||!Number.isFinite(projection.fov)||projection.fov<1||projection.fov>100))fail(path,'Use a camera field of view from 1–100 degrees.');
    if(type==='dialogue'&&step.window!==undefined&&!['dialogue','narration'].includes(String(step.window)))fail(path,'Choose a dialogue or narration window.');
    if(type==='dialogue'&&typeof step.waitForInput!=='boolean')fail(path,'Choose whether dialogue waits for player input.');
    if(type==='dialogue'&&step.camera!==undefined){const camera=fields(step.camera,['target','pitch','yaw','distance','durationFrames'],`${path}.camera`,['fov']);if(step.waitForInput!==false||!integer(camera.durationFrames,1,Number(step.durationFrames))||!Array.isArray(camera.target)||camera.target.length!==3||camera.target.some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>=32768)||[camera.pitch,camera.yaw].some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>=360)||typeof camera.distance!=='number'||!Number.isFinite(camera.distance)||camera.distance<16||camera.distance>2048)fail(`${path}.camera`,'Use a valid camera move inside a timed dialogue block.');}
    if(type==='pokemon.cry'&&(!integer(step.species,1,649)||!integer(step.form,0,31)))fail(path,'Choose a Gen 5 species and form.');
    if(type==='camera.shake'&&(!integer(step.amplitudeX,0,32)||!integer(step.amplitudeY,0,32)||!(Number(step.amplitudeX)+Number(step.amplitudeY))||!integer(step.periodFrames,2,60)||!integer(step.cycles,1,60)||Number(step.periodFrames)*Number(step.cycles)>1800))fail(path,'Use amplitudes 0–32, a period of 2–60 frames and 1–60 cycles (at most 1800 frames).');
    if ((type === 'control.return') !== (i === steps.length - 1)) fail(path, 'Exactly one Return control step must end the scene.');
  });
  const firstCamera=steps.findIndex(s=>(s as FieldSceneStep).type==='camera.move');
  if(firstCamera<0||steps.slice(0,firstCamera).some(s=>!['pokemon.cry','camera.shake','dialogue','wait'].includes((s as FieldSceneStep).type)))fail('$.steps','Start with a camera move, optionally preceded by cries, shakes, dialogue or holds.');
  if(steps.slice(0,firstCamera).some(s=>(s as FieldDialogueStep).camera))fail('$.steps','Dialogue camera moves require the tour camera to be initialized first.');
  if ('actors' in s) {
    if (!Array.isArray(s.actors) || s.actors.length > 8) fail('$.actors', 'Use up to eight NPC tracks.');
    const actorIds = new Set(['player']);
    (s.actors as unknown[]).forEach((v,i)=>{
      const path=`$.actors[${i}]`,actor=fields(v,['id','name','overworldId','entry','endBehavior','actions'],path,['placement']);
      if(!validId(actor.id)||actorIds.has(actor.id))fail(path,'NPC IDs must be unique; player is reserved.');
      actorIds.add(actor.id as string);
      if(typeof actor.name!=='string'||!actor.name.trim()||actor.name.length>128)fail(path,'Enter an NPC name of 1–128 characters.');
      if(!integer(actor.overworldId,0,16383))fail(path,'Invalid overworld sprite ID.');
      const p=fields(actor.entry,['tileX','tileZ','facing'],`${path}.entry`);
      if(!integer(p.tileX,0,2047)||!integer(p.tileZ,0,2047)||!directions.includes(String(p.facing)))fail(path,'Invalid NPC entry coordinate or facing.');
      if(actor.placement!==undefined&&!['tour','map'].includes(String(actor.placement)))fail(path,'Choose tour or map placement.');
      if(actor.placement==='map'&&actor.endBehavior!=='stay')fail(path,'Map overworlds must stay after the tour.');
      if(actor.endBehavior!=='stay'&&actor.endBehavior!=='remove')fail(path,'Choose stay or remove after the tour.');
      if(!Array.isArray(actor.actions)||actor.actions.length>128)fail(path,'Provide up to 128 NPC actions.');
      const actionIds=new Set<string>(),anchors=new Set<string>();
      (actor.actions as unknown[]).forEach((a,j)=>{
        const action=fields(a,['id','stepId','type','direction',...((a as FieldNpcAction)?.type==='walk'?['tiles']:[])],`${path}.actions[${j}]`);
        if(!validId(action.id)||actionIds.has(action.id))fail(path,'NPC action IDs must be unique.');
        actionIds.add(action.id as string);
        if(!ids.has(String(action.stepId))||anchors.has(String(action.stepId)))fail(path,'Choose an existing tour action; use one NPC action per block.');
        if(steps.some(s=>(s as FieldSceneStep).id===action.stepId&&(s as FieldSceneStep).type==='dialogue'))fail(path,'Dialogue blocks pause movement. Anchor NPC actions to a camera, hold or player block.');
        anchors.add(action.stepId as string);
        if(!['walk','face'].includes(String(action.type))||!directions.includes(String(action.direction)))fail(path,'Choose walk/face and a cardinal direction.');
        if(action.type==='walk'&&!integer(action.tiles,1,32))fail(path,'Walk 1–32 tiles per NPC action.');
      });
    });
  }
  if(s.returnCamera!==undefined&&!['gameplay','entry'].includes(String(s.returnCamera)))fail('$.returnCamera','Choose gameplay or entry.');
  if(s.environment!==undefined){const e=fields(s.environment,['sourceSeason','targetSeason','startFrame','endFrame','dayCycles','ambientSpeed','retainSeason'],'$.environment',['seasonCycles','tempo','persistSeason']);
    if(e.seasonCycles!==undefined&&!integer(e.seasonCycles,1,8))fail('$.environment.seasonCycles','Use 1–8 complete seasonal cycles.');
    if(e.persistSeason!==undefined&&typeof e.persistSeason!=='boolean')fail('$.environment.persistSeason','Choose true or false.');
    if(e.tempo!==undefined){const t=fields(e.tempo,['accelerateFraction','decelerateFraction'],'$.environment.tempo',['boost']);
      if(t.boost!==undefined){const boost=fields(t.boost,['startFrame','durationFrames','multiplier'],'$.environment.tempo.boost');if(!integer(boost.startFrame,Number(e.startFrame),Number(e.endFrame)-1)||!integer(boost.durationFrames,1,1800)||typeof boost.multiplier!=='number'||!Number.isFinite(boost.multiplier)||boost.multiplier<=1||Number(e.ambientSpeed)*boost.multiplier>32||Number(boost.startFrame)<Number(e.startFrame)+(Number(e.endFrame)-Number(e.startFrame))*Number(t.accelerateFraction)||Number(boost.startFrame)+Number(boost.durationFrames)>Number(e.endFrame)-(Number(e.endFrame)-Number(e.startFrame))*Number(t.decelerateFraction))fail('$.environment.tempo.boost','Place a boost between initial acceleration and braking, with a combined speed at most 32×.');}
      if([t.accelerateFraction,t.decelerateFraction].some(n=>typeof n!=='number'||!Number.isFinite(n)||n<=0||n>.5)||Number(t.accelerateFraction)+Number(t.decelerateFraction)>1)fail('$.environment.tempo','Use positive acceleration/deceleration fractions with sum at most 1.');}
    if(!['spring','summer','autumn','winter'].includes(String(e.sourceSeason))||!['spring','summer','autumn','winter'].includes(String(e.targetSeason))||e.retainSeason!==true)fail('$.environment','Choose endpoint seasons and retainSeason:true.');
    if(!integer(e.startFrame,0,17998)||!integer(e.endFrame,1,17999)||Number(e.endFrame)<=Number(e.startFrame)||!integer(e.dayCycles,1,32)||typeof e.ambientSpeed!=='number'||!Number.isFinite(e.ambientSpeed)||e.ambientSpeed<1||e.ambientSpeed>16)fail('$.environment','Invalid transition frames, cycle count or ambient speed.');
  }
  if(s.music!==undefined){const m=fields(s.music,['path','sourceName','startSeconds','endSeconds','durationFrames'],'$.music');if(typeof m.path!=='string'||!/^field-tours\/audio\/[a-zA-Z0-9._-]+\.strm$/.test(m.path)||typeof m.sourceName!=='string'||m.sourceName.length>255||typeof m.startSeconds!=='number'||typeof m.endSeconds!=='number'||!Number.isFinite(m.startSeconds)||!Number.isFinite(m.endSeconds)||m.startSeconds<0||m.endSeconds<=m.startSeconds||!integer(m.durationFrames,1,18000)||Math.abs((m.endSeconds-m.startSeconds)*30-Number(m.durationFrames))>.5)fail('$.music','Use a local STRM clip with matching excerpt duration.');}
  if(s.ageHumanNpcs!==undefined&&(typeof s.ageHumanNpcs!=='boolean'||s.ageHumanNpcs&&(s.zoneId!==427||!s.environment)))fail('$.ageHumanNpcs','NPC aging currently requires an Aspertia environment tour.');
  const scene = structuredClone(value) as FieldScene;
  if(s.trees!==undefined){if(!Array.isArray(s.trees)||s.trees.length>36||!scene.environment||scene.zoneId!==427)fail('$.trees','Use up to 36 growing trees in an Aspertia environment tour.');const names=new Set<string>();for(const [i,v]of (s.trees as unknown[]).entries()){const t=fields(v,['id','position','startFrame','endFrame'],`$.trees[${i}]`);if(!validId(t.id)||names.has(t.id))fail('$.trees','Tree IDs must be valid and unique.');names.add(t.id as string);if(!Array.isArray(t.position)||t.position.length!==3||t.position.some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>=32768)||!integer(t.startFrame,fieldCameraStartFrame(scene),17998)||!integer(t.endFrame,Number(t.startFrame)+1,scene.steps.reduce((n,s)=>n+fieldPhaseFrames(scene,s),0)))fail('$.trees','Choose a world position and growth frames inside the camera tour.');}}
  const end=fieldScenePlayerPath(scene).at(-1)!;
  if(scene.returnCamera==='entry'&&(end.tileX!==scene.entry.tileX||end.tileZ!==scene.entry.tileZ))fail('$.returnCamera','Entry-camera return requires the player to finish on the entry tile.');
  if(scene.environment&&scene.steps.some(s=>s.type==='dialogue'&&s.waitForInput))fail('$.environment','Live time travel requires timed dialogue so the animation never waits for input.');
  if(scene.environment&&scene.environment.startFrame<fieldCameraStartFrame(scene))fail('$.environment.startFrame','Start time travel at or after the first camera move.');
  if(scene.environment&&scene.environment.endFrame>=scene.steps.reduce((n,s)=>n+fieldPhaseFrames(scene,s),0))fail('$.environment.endFrame','The transition must finish before control returns.');
  for(const step of scene.steps)if(step.type==='dialogue')formatFieldDialogue(scene,step);
  for (const p of fieldScenePlayerPath(scene)) if (!integer(p.tileX, 0, 2047) || !integer(p.tileZ, 0, 2047)) fail('$.steps', 'The player path leaves the supported grid.');
  for(const actor of scene.actors??[])for(const p of fieldSceneNpcPath(scene,actor))if(!integer(p.tileX,0,2047)||!integer(p.tileZ,0,2047))fail('$.actors',`${actor.name}'s path leaves the supported grid.`);
  if (scene.steps.reduce((n, step) => n + fieldPhaseFrames(scene,step), 0) > 18000) fail('$.steps', 'Keep field tours under ten minutes.');
  return scene;
}

export const fieldStepFrames = (step: FieldSceneStep) => step.type === 'player.walk' ? step.tiles * 8 : step.type === 'player.face'||step.type==='pokemon.cry' ? 1 : step.type==='camera.shake'?step.periodFrames*step.cycles:step.type==='dialogue' ? step.waitForInput?1:step.durationFrames*fieldDialoguePages(step.text).length : step.durationFrames;
/** Prelude actions run on the gameplay camera; the live environment and stream
 * begin when the first camera move takes ownership after that prelude. */
export function fieldCameraStartFrame(scene:FieldScene){const index=scene.steps.findIndex(s=>s.type==='camera.move');return scene.steps.slice(0,index).reduce((n,s)=>n+fieldPhaseFrames(scene,s),0);}
export const fieldNpcActionFrames = (action: FieldNpcAction) => action.type==='walk'?action.tiles*8:1;
/** Each block is a native barrier: camera, player and NPCs begin together, then all finish. */
export const fieldPhaseFrames = (scene: FieldScene,step: FieldSceneStep) => Math.max(fieldStepFrames(step),...(scene.actors??[]).flatMap(a=>a.actions.filter(k=>k.stepId===step.id).map(fieldNpcActionFrames)));
export function fieldSceneNpcPath(scene: FieldScene,actor: FieldNpcTrack) {
  let {tileX,tileZ,facing}=actor.entry;
  const points=[{tileX,tileZ,facing}];
  for(const step of scene.steps){const action=actor.actions.find(a=>a.stepId===step.id);if(!action)continue;facing=action.direction;
    if(action.type==='face')points.push({tileX,tileZ,facing});
    if(action.type==='walk')for(let i=0;i<action.tiles;i++){tileX+=facing==='right'?1:facing==='left'?-1:0;tileZ+=facing==='down'?1:facing==='up'?-1:0;points.push({tileX,tileZ,facing});}
  }
  return points;
}
export function fieldSceneActorIds(scene: FieldScene,used: Iterable<number> = []) {
  const occupied=new Set([...used,255]),result:Record<string,number>={};let id=254;
  for(const actor of scene.actors??[]){while(occupied.has(id)&&id>=128)id--;if(id<128)throw new Error('No unused field actor IDs are available.');result[actor.id]=id;occupied.add(id--);}
  return result;
}
export function fieldScenePlayerPath(scene: FieldScene) {
  let { tileX, tileZ, facing } = scene.entry;
  const points = [{ tileX, tileZ, facing }];
  for (const step of scene.steps) {
    if (step.type === 'player.face') facing = step.direction;
    if (step.type === 'player.walk') for (let i = 0; i < step.tiles; i++) {
      facing = step.direction;
      tileX += facing === 'right' ? 1 : facing === 'left' ? -1 : 0;
      tileZ += facing === 'down' ? 1 : facing === 'up' ? -1 : 0;
      points.push({ tileX, tileZ, facing });
    }
  }
  return points;
}

/** Only existing W2 field opcodes: no native sequence assets or executable patch. */
export function compileFieldScene(input: FieldScene, testWarp: boolean | 'entry-trigger' = false, actorIds?: Record<string,number>,dialogueBindings:FieldDialogueBindings={}): { source: string; compiled: CompiledBw2Script } {
  const scene = readFieldScene(input), nativeIds=actorIds??fieldSceneActorIds(scene), lines = ['preserve_layout', 'script :field_tour, entry: 1 do'];
  if(testWarp) for(let i=0;i<FIELD_TEST_PREFIX.length;i+=2) lines.push(FIELD_TEST_PREFIX[i]?'  cmd_0001':'  nop');
  lines.push('  lock');
  if (testWarp === true) lines.push(`  cmd_00c2 ${scene.zoneId}, ${scene.entry.tileX}, ${scene.entry.tileZ}, ${directions.indexOf(scene.entry.facing)}`, `  sleep ${scene.environment?60:30}`, '  lock');
  const assigned=new Set<number>();
  for(const actor of scene.actors??[]){const id=nativeIds[actor.id];if(!integer(id,128,254)||assigned.has(id))throw new Error('Provide unique unused native NPC actor IDs from 128–254.');assigned.add(id);
    // Dynamic actor: grid X/Z, facing, actor ID, sprite registry ID, stationary move code.
    // Delete only the explicitly assigned transient ID, allowing a controlled replay.
    if(actor.placement!=='map')lines.push(`  cmd_006c ${id}`,`  cmd_0069 ${actor.entry.tileX}, ${actor.entry.tileZ}, ${directions.indexOf(actor.entry.facing)}, ${id}, ${actor.overworldId}, 0`);
  }
  lines.push('  apply_movement 255, :entry_facing', '  wait_movement');
  let cameraStarted=false;
  const movements: string[] = [`movement :entry_facing do\n  face_${scene.entry.facing} 1\nend`], fx = (n: number) => String(Math.round(n * 4096) >>> 0), angle = (n: number) => String(Math.round(n * 65536 / 360) & 65535);
  scene.steps.forEach((step, i) => {
    if(step.type==='camera.move'&&!cameraStarted){lines.push('  cmd_013f','  cmd_0141');cameraStarted=true;}
    let moving=false;
    for(const [a,actor]of (scene.actors??[]).entries()){const key=actor.actions.find(k=>k.stepId===step.id);if(!key)continue;moving=true;
      lines.push(`  apply_movement ${nativeIds[actor.id]}, :npc_${a}_${i}`);
      movements.push(`movement :npc_${a}_${i} do\n  ${key.type}_${key.direction} ${key.type==='walk'?key.tiles:1}\nend`);
    }
    if (step.type === 'camera.move') lines.push(`  cmd_0143 ${angle(step.pitch)}, ${angle(step.yaw)}, ${fx(step.distance)}, ${step.target.map(fx).join(', ')}, ${step.durationFrames}`, '  cmd_0145');
    if (step.type === 'wait') lines.push(`  sleep ${step.durationFrames}`);
    if(step.type==='pokemon.cry')lines.push(`  cmd_00ab ${step.species}, ${step.form}`);
    // Native shake: X/Y amplitude, period, cycles, X/Y decrement,
    // decrement threshold and interval. Zero decrements keep amplitude stable.
    if(step.type==='camera.shake')lines.push(`  cmd_0148 ${step.amplitudeX}, ${step.amplitudeY}, ${step.periodFrames}, ${step.cycles}, 0, 0, 0, 1`);
    if(step.type==='dialogue'){
      if(step.camera){const c=step.camera;lines.push(`  cmd_0143 ${angle(c.pitch)}, ${angle(c.yaw)}, ${fx(c.distance)}, ${c.target.map(fx).join(', ')}, ${c.durationFrames}`);}
      const binding=dialogueBindings[step.id],pages=formatFieldDialogue(scene,step).pages;
      if(!binding||!integer(binding.bankId,0,0x3fff)||binding.bankId===0x400||binding.messageIds.length!==pages.length||binding.messageIds.some(n=>!integer(n,0,0x3fff)))throw new Error('Stage a private dialogue text bank before compiling this field scene.');
      const speaker=step.speakerId==='player'?255:nativeIds[step.speakerId];
      for(const message of binding.messageIds){
        lines.push(step.window==='narration'?`  cmd_0034 ${message}, 0`:`  cmd_003c ${binding.bankId}, ${message}, ${speaker}, 2, 0`);
        lines.push(step.waitForInput?'  cmd_0031':`  sleep ${step.durationFrames}`);
      }
      lines.push(step.window==='narration'?'  cmd_0036':'  cmd_003e');
      if(step.camera)lines.push('  cmd_0145');
    }
    if (step.type === 'player.walk' || step.type === 'player.face') {
      moving=true;lines.push(`  apply_movement 255, :player_${i}`);
      movements.push(`movement :player_${i} do\n  ${step.type === 'player.walk' ? 'walk' : 'face'}_${step.direction} ${step.type === 'player.walk' ? step.tiles : 1}\nend`);
    }
    // Default recalculates at the player's FINAL position, unlike saved-pose return.
    if (step.type === 'control.return') lines.push(`  ${scene.returnCamera==='entry'?'cmd_0144':'cmd_0147'} ${step.durationFrames}`, '  cmd_0145');
    if(moving)lines.push('  wait_movement');
    if(step.type==='control.return'){
      for(const actor of scene.actors??[])if(actor.endBehavior==='remove')lines.push(`  cmd_006c ${nativeIds[actor.id]}`);
      lines.push('  cmd_0142', '  cmd_0140', '  unlock', '  halt');
    }
  });
  const source = [...lines, 'end', ...movements, ''].join('\n');
  return { source, compiled: compileBw2Script(source) };
}

export function storeFieldScene(project: ProjectState, input: unknown) {
  const scene = readFieldScene(input);
  project.fieldScenes ??= { scenes: {} };
  project.fieldScenes.scenes[scene.id] = scene;
  project.fieldScenes.selectedId = scene.id;
  return scene;
}
