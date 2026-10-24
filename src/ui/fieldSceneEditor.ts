import * as THREE from 'three';
import example from '../../examples/cutscenes/route13.field-scene.json';
import { readFieldScene, storeFieldScene, fieldCameraStartFrame, fieldStepFrames, fieldPhaseFrames, type FieldScene, type FieldSceneStep } from '../pokeweb/fieldScene';
import { buildFieldSceneTestDownloads } from '../pokeweb/fieldSceneTest';
import { getMap3dZones, loadMap3dZone, loadMap3dPlayerSprite, type Map3dNpcSpriteFrames } from '../pokeweb/map3dModel';
import { loadFieldSpriteClips, compileFieldPlayerMotion, compileFieldNpcMotion } from '../pokeweb/fieldSpriteMotion';
import { fieldDialoguePages } from '../pokeweb/fieldSceneDialogue';
import { FieldScenePlayback } from '../pokeweb/fieldScenePlayback';
import { fieldNpcLibrary } from '../pokeweb/fieldSceneNpcs';
import { mountFieldSceneNpcEditor } from './fieldSceneNpcEditor';
import {fieldEnvironmentPreview,poseFieldLookoutBackdrop} from '../pokeweb/fieldEnvironmentAssets';
import {previewFieldTrees} from '../pokeweb/fieldTreeGrowth';
import {environmentPreviewMap,scopeCutsceneMap} from '../pokeweb/cutsceneEnvironment';
import { loadFieldCamera,evaluateFieldCamera, type FieldCameraDocument } from '../pokeweb/fieldCameraModel';
import {decodeAudioFile,cropStereoPcm,encodeAdpcmStrm,decodeStrmPcm} from '../pokeweb/streamedBgmModel';
import {renderPokemonCryPcm} from '../pokeweb/pokemonCryModel';
import {addRomFile,setRomFileReplacement} from '../pokeweb/fileSystemModel';
import {NintendoDSRom} from '../nds/rom';
import {readU16,readU32} from '../nds/binary';
import {loadActiveRomBytes} from '../pokeweb/persistence';
import { downloadBytes } from '../pokeweb/fileSystemModel';
import type { CutsceneScene, SceneVector } from '../pokeweb/cutsceneScene';
import type { ProjectState } from '../pokeweb/projectStore';
import { mountCutsceneMapPreview } from './cutsceneMapPreview';
import { escapeHtml as esc } from './dom';

const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2) + '\n');
const dirs = ['up', 'down', 'left', 'right'];
const title = (step: FieldSceneStep) => ({ 'camera.move': 'Camera move', 'camera.shake':'Camera shake', 'pokemon.cry':'Pokémon cry', wait: 'Hold', 'player.walk': 'Walk player', 'player.face': 'Face player', 'control.return': 'Return control', dialogue:'Dialogue' })[step.type];
const numeric = (key: string, label: string, value: number) => `<label>${label}<input name="${key}" type="number" step="any" value="${value}" required></label>`;

/** Serial native actions have small scheduling overheads. This is an authoring preview,
 * not a substitute for the native frame-by-frame handoff check. */
function previewSource(scene: FieldScene, doc: FieldCameraDocument, heightAt: (x:number,z:number)=>number = ()=>0): CutsceneScene {
  let p = doc.preset; const player: SceneVector = [scene.entry.tileX * 16 + 8, 0, scene.entry.tileZ * 16 + 8];
  let fov=p.fov;
  let target = [...player] as SceneVector, pitch = p.pitch, yaw = p.yaw, distance = p.distance, frame = 0, facing = scene.entry.facing;
  player[1] = heightAt(player[0],player[2]); target = [...player];
  const initial=evaluateFieldCamera(doc.preset,doc.regions,{x:player[0]-(doc.regions.length?8:0),y:player[1],z:player[2]-(doc.regions.length?8:0)},doc.boundaries);
  if(doc.regions.length){initial.position.x+=8;initial.position.z+=8;initial.target.x+=8;initial.target.z+=8;}
  const delta=[initial.position.x-player[0],initial.position.y-player[1],initial.position.z-player[2]],offset=new THREE.Vector3(initial.target.x-player[0],initial.target.y-player[1],initial.target.z-player[2]);
  if(scene.returnCamera==='entry')p={...p,pitch:Math.atan2(delta[1],Math.hypot(delta[0],delta[2]))*180/Math.PI,yaw:(Math.atan2(delta[0],delta[2])*180/Math.PI+360)%360,distance:Math.hypot(...delta)};
  pitch=p.pitch;yaw=p.yaw;distance=p.distance;
  const camera: CutsceneScene['camera'] = [], keys: NonNullable<CutsceneScene['actors']>[number]['keys'] = [];
  function pose(at: number) {
    const a = pitch * Math.PI / 180, b = yaw * Math.PI / 180;
    const position: SceneVector = [target[0] + Math.sin(b) * Math.cos(a) * distance, target[1] + Math.sin(a) * distance, target[2] + Math.cos(b) * Math.cos(a) * distance];
    const c = new THREE.PerspectiveCamera(); c.position.fromArray(position); c.lookAt(new THREE.Vector3(...target).add(scene.returnCamera==='entry'?offset:new THREE.Vector3(0,p.offset.y,0)));
    const e = new THREE.Euler().setFromQuaternion(c.quaternion, 'YXZ');
    camera.push({ id: `camera-${at}`, frame: at, position, rotationDegrees: [e.x, e.y, e.z].map(n => n * 180 / Math.PI) as SceneVector, easing: 'linear', fov });
  }
  pose(0); keys.push({ id: 'player-0', frame: 0, position: [...player], facing, action: 'idle', easing: 'linear' });
  for (const step of scene.steps) {
    const duration = fieldPhaseFrames(scene,step), from = [...target], before = { pitch, yaw, distance }, start = [...player];
    if (step.type === 'player.walk' || step.type === 'player.face') facing = step.direction;
    for (let k = 1; k <= duration; k++) {
      const t = Math.min(1,k / fieldStepFrames(step));
      const movement=step.type==='dialogue'?step.camera:step.type==='camera.move'?step:undefined;
      if (movement || step.type === 'control.return') {
        const cameraT=movement?Math.min(1,k/movement.durationFrames):t;
        fov=movement?.fov??p.fov;
        const goal = movement ? movement.target : player;
        target = from.map((v, i) => v + (goal[i] - v) * cameraT) as SceneVector;
        const to = movement ?? p;
        const angle = (a: number, b: number) => a + ((b - a + 540) % 360 - 180) * cameraT;
        pitch = angle(before.pitch, to.pitch); yaw = angle(before.yaw, to.yaw); distance = before.distance + (to.distance - before.distance) * cameraT;
      }
      if (step.type === 'player.walk') {
        player[0] = start[0] + (facing === 'right' ? 1 : facing === 'left' ? -1 : 0) * step.tiles * 16 * t;
        player[2] = start[2] + (facing === 'down' ? 1 : facing === 'up' ? -1 : 0) * step.tiles * 16 * t;
        player[1] = heightAt(player[0],player[2]);
      }
      frame++;pose(frame);
      if(step.type==='camera.shake'){
        const key=camera.at(-1)!,wave=Math.sin(k/step.periodFrames*Math.PI*2),fade=Math.min(1,k/3,(duration-k)/3),dx=step.amplitudeX*wave*fade,dy=step.amplitudeY*wave*fade;
        key.position=[key.position[0]+dx,key.position[1]+dy,key.position[2]];
      }
    }
  }
  return { format: 'pokeweb.cutscene', version: 2, target: 'W2-US', fps: 30, id: scene.id, name: scene.name, frameCount: frame + 1,
    stage: { kind: 'map', zoneId: scene.zoneId, season: scene.environment?.sourceSeason??'spring' }, environment:scene.environment,camera, events: [],
    actors: [{ id: 'player', name: 'Player preview', overworldId: 16384, frameStep: 8, keys },...(scene.actors??[]).map(a=>({id:a.id,name:a.name,overworldId:a.overworldId,frameStep:8,keys:[{id:`${a.id}-entry`,frame:0,position:[a.entry.tileX*16+8,0,a.entry.tileZ*16+8] as SceneVector,facing:a.entry.facing,action:'idle' as const,easing:'hold' as const}]}))], exit: { restoreCamera: true, restoreMusic: true, restorePlayerControl: true } };
}

export async function renderFieldSceneEditor(project: ProjectState, root: HTMLElement, onDirty: () => void) {
  const zones = getMap3dZones(project);
  let source = readFieldScene(project.fieldScenes?.scenes[project.fieldScenes.selectedId ?? ''] ?? Object.values(project.fieldScenes?.scenes ?? {})[0] ?? example);
  let selected = source.steps[0].id, frame = 0, playing = false, last = 0, preview: ReturnType<typeof mountCutsceneMapPreview> | undefined, synthetic: CutsceneScene, free = false, generation = 0, picking: 'target' | 'entry' | {npc:string} | undefined;
  let playerGender=project.fieldScenes?.previewPlayer??'female',playerSprites:Map3dNpcSpriteFrames|undefined,playerMotion:ReturnType<typeof compileFieldPlayerMotion>|undefined,poseDirection='';
  let npcLibrary:ReturnType<typeof fieldNpcLibrary>|undefined,poseActor='player',animationFrame=0,playback:FieldScenePlayback|undefined;
  const npcMotions=new Map<string,ReturnType<typeof compileFieldNpcMotion>>();
  root.innerHTML = `<div class="scene-workspace field-scene-workspace"><header class="scene-workspace-bar"><h2>Field tours</h2><select data-tour aria-label="Field tour"></select><button data-act="new">New tour</button><button data-act="import">Import JSON</button><input data-file type="file" accept=".json" hidden></header><div class="scene-authoring"><section class="scene-main"><div data-preview class="scene-preview"></div><div class="scene-transport"><button data-act="play">Play</button><button data-act="restart">Restart</button><button data-act="previous" aria-label="Previous display frame">◀</button><button data-act="next" aria-label="Next display frame">▶</button><button data-act="view">Free view</button><label>Preview frame<input data-frame type="number" min="0" step="0.5" value="0"></label><span data-time></span><label>Preview player<select data-player><option value="male">Nate</option><option value="female">Rosa</option></select></label></div><div class="field-player-poses"><label>Inspect poses<select data-pose-actor><option value="player">Player</option></select></label><span data-pose-label></span><div data-pose-strip>${[0,1,2,3].map(i=>`<canvas width="32" height="32" data-pose="${i}" aria-label="Actor pose ${i}"></canvas>`).join('')}</div></div><div class="scene-toolbar"><select data-type aria-label="New field action"><option value="camera.move">Camera move</option><option value="wait">Hold</option><option value="player.walk">Walk player</option><option value="player.face">Face player</option><option value="dialogue">Dialogue</option><option value="pokemon.cry">Pokémon cry</option><option value="camera.shake">Camera shake</option></select><button data-act="add">Add action before return</button></div><div data-steps class="field-scene-steps" aria-label="Field scene actions"></div><section data-npc-tracks class="field-npc-tracks" aria-label="NPC tracks"></section><p>Sprite poses use W2’s native animation records. Step at 60 display frames per second to inspect each pose. Script scheduling and terrain height are estimated; the ROM uses the actual player, independently of the preview avatar.</p></section><aside class="scene-inspector"><h2>Live field scene</h2><p>Tour the loaded map, move its actual player, then restore the gameplay camera and control without an ending transition.</p><form data-settings></form><details data-time-travel open><summary>Time travel</summary><form data-environment></form></details><details open><summary>Music excerpt</summary><form data-music></form><input data-music-file type="file" accept="audio/*,video/mp4,.strm" hidden></details><div data-inspector></div><section data-npc-inspector class="scene-npc-panel"></section><details class="scene-json"><summary>JSON source / language authoring</summary><textarea data-json aria-label="Field scene JSON" spellcheck="false"></textarea><div class="scene-actions"><button data-act="apply-json">Apply JSON</button><button data-act="json">Download JSON</button><button data-act="script">Download field script</button></div></details><div class="scene-actions"><button data-act="export">Download W2 test ROM</button></div><p data-test-launch>Test: press Down in the bundled Aspertia save. An initial warp loads this map; the tour and handoff stay on the live field. The save is supplied unchanged. Field tours support camera moves, holds, player and NPC walks/facing, dialogue, seasonal time travel and Return control. Dialogue can wait for A/B or close after a timed hold. Branches, skip and doorway choreography need a later field compiler.</p></aside></div><p data-status role="status" aria-live="polite"></p></div>`;
  const shell = root.firstElementChild as HTMLElement, q = <T extends Element = HTMLElement>(s: string) => shell.querySelector<T>(s)!, status = q('[data-status]');
  const report = (s: string) => { status.textContent = s; };
  const run = (f: () => void | Promise<void>) => { void Promise.resolve().then(f).catch(e => report(e instanceof Error ? e.message : String(e))); };
  const save = () => { source = storeFieldScene(project, source); onDirty(); };
  const dialogue=document.createElement('div');dialogue.className='scene-dialogue-box field-dialogue-box';dialogue.hidden=true;dialogue.setAttribute('aria-label','Field tour dialogue');dialogue.innerHTML='<pre data-dialogue-text></pre><footer><span data-dialogue-caption></span><button data-act="continue">Continue / Enter</button></footer>';
  let audioContext:AudioContext|undefined;const audioSources:AudioBufferSourceNode[]=[],cryPcm=new Map<number,Awaited<ReturnType<typeof renderPokemonCryPcm>>>();
  function stopMusic(){for(const node of audioSources.splice(0)){node.stop();node.disconnect();}}
  async function startMusic(){stopMusic();audioContext??=new AudioContext();await audioContext.resume();const now=audioContext.currentTime;
    const schedule=(pcm:{left:Float32Array;right:Float32Array;sampleRate:number},at:number)=>{const relative=(frame-at)/30,buffer=audioContext!.createBuffer(2,pcm.left.length,pcm.sampleRate);if(relative>=buffer.duration)return;buffer.copyToChannel(new Float32Array(pcm.left),0);buffer.copyToChannel(new Float32Array(pcm.right),1);const node=audioContext!.createBufferSource();node.buffer=buffer;node.connect(audioContext!.destination);audioSources.push(node);node.start(now+Math.max(0,-relative),Math.max(0,relative));};
    const bytes=source.music&&project.fileSystem?.additions?.[source.music.path];if(bytes)schedule(decodeStrmPcm(bytes),fieldCameraStartFrame(source));
    let at=0;for(const step of source.steps){if(step.type==='pokemon.cry'){const pcm=cryPcm.get(step.species);if(pcm)schedule(pcm,at);}at+=fieldPhaseFrames(source,step);}
  }
  function seek(at:number){stopMusic();playback??=new FieldScenePlayback(source);playback.seek(at);frame=playback.frame;animationFrame=frame;}
  function advanceDialogue(){if(playback?.advance()){frame=playback.frame;playing=frame<playback.frameCount-1;draw();}}
  const npcEditor=mountFieldSceneNpcEditor(q('[data-npc-tracks]'),q('[data-npc-inspector]'),{
    scene:()=>source,catalog:()=>npcLibrary?.catalog??[],publish,run,
    select(id,at){poseActor=id||'player';poseDirection='';q<HTMLSelectElement>('[data-pose-actor]').value=poseActor;if(at!==undefined){playing=false;seek(at);}draw();},
    pick(id){picking={npc:id};report('Click the map to place this NPC entry. Use Free view to look around.');}
  });
  function options() {
    const scenes = { ...project.fieldScenes?.scenes, [source.id]: source };
    q<HTMLSelectElement>('[data-tour]').innerHTML = Object.values(scenes).map(s => `<option value="${esc(s.id)}" ${s.id === source.id ? 'selected' : ''}>${esc(s.name)} · Zone ${s.zoneId}</option>`).join('');
    if(!source.actors?.some(a=>a.id===poseActor))poseActor='player';
    q<HTMLSelectElement>('[data-pose-actor]').innerHTML=`<option value="player">Player</option>${(source.actors??[]).map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}`;
    q<HTMLSelectElement>('[data-pose-actor]').value=poseActor;
  }
  function inspector() {
    const step = source.steps.find(s => s.id === selected)!;
    let start = 0;
    q('[data-steps]').innerHTML = source.steps.map(s => { const at = start; start += fieldPhaseFrames(source,s); return `<button data-act="select" data-id="${esc(s.id)}" aria-pressed="${s.id === selected}">${at}f · ${title(s)} · ${s.type==='dialogue'&&s.waitForInput?'wait for input':`${fieldPhaseFrames(source,s)}f`}${s.type === 'player.walk' ? ` · ${s.tiles} ${s.direction}` : ''}</button>`; }).join('');
    const dialogueForm=step.type==='dialogue'?`<label>Speaker<select name="speaker"><option value="player" ${step.speakerId==='player'?'selected':''}>Player</option>${(source.actors??[]).map(a=>`<option value="${esc(a.id)}" ${a.id===step.speakerId?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label><label>Text window<select name="dialogue-window"><option value="dialogue" ${step.window!=='narration'?'selected':''}>Actor dialogue</option><option value="narration" ${step.window==='narration'?'selected':''}>Native narration</option></select></label><label>Dialogue text<textarea name="dialogue-text" aria-label="Dialogue text" rows="5" maxlength="512" required>${esc(step.text)}</textarea></label><label class="scene-dialogue-check"><input name="wait-input" type="checkbox" ${step.waitForInput?'checked':''}>Pause until player advances</label><label>Hold per page after printing (30 fps)<input name="dialogue-hold" type="number" min="1" max="1800" step="1" value="${step.waitForInput?45:step.durationFrames}" ${step.waitForInput?'disabled':''} required></label><label><input name="dialogue-camera" type="checkbox" ${step.camera?'checked':''}>Move camera while timed text is shown</label>${[0,1,2].map(i=>numeric(`dialogue-target-${i}`,`Camera target ${['X','Y','Z'][i]}`,step.camera?.target[i]??0)).join('')}${numeric('dialogue-pitch','Camera pitch (degrees)',step.camera?.pitch??35.936279296875)}${numeric('dialogue-yaw','Camera yaw (degrees)',step.camera?.yaw??0)}${numeric('dialogue-distance','Camera distance',step.camera?.distance??150)}${numeric('dialogue-camera-duration','Camera movement frames',step.camera?.durationFrames??90)}<label><input name="dialogue-fov-enabled" type="checkbox" ${step.camera?.fov!==undefined?'checked':''}>Override dialogue camera field of view</label>${numeric('dialogue-fov','Dialogue camera FOV (degrees)',step.camera?.fov??40)}<p>${fieldDialoguePages(step.text).length} page(s), two wrapped lines each. Actors hold position during dialogue; timed text can accompany a camera move. Native text printing adds time; the preview shows complete pages immediately.</p>`:'';
    const direction = 'direction' in step ? `<label>Facing / direction<select name="direction">${dirs.map(d => `<option ${d === step.direction ? 'selected' : ''}>${d}</option>`).join('')}</select></label>` : '';
    const effects=step.type==='pokemon.cry'?numeric('species','Pokémon species ID',step.species)+numeric('form','Form',step.form)+'<p>Plays the native W2 cry in the exported ROM.</p>':step.type==='camera.shake'?numeric('amplitudeX','Horizontal amplitude',step.amplitudeX)+numeric('amplitudeY','Vertical amplitude',step.amplitudeY)+numeric('period','Frames per oscillation',step.periodFrames)+numeric('cycles','Oscillations',step.cycles):'';
    q('[data-inspector]').innerHTML = `<h3>${title(step)}</h3><form data-step>${'durationFrames' in step && step.type!=='dialogue' ? numeric('duration', 'Duration (frames at 30 fps)', step.durationFrames) : ''}${direction}${dialogueForm}${effects}${step.type === 'player.walk' ? numeric('tiles', 'Tiles', step.tiles) : ''}${step.type === 'camera.move' ? step.target.map((n, i) => numeric(`target-${i}`, `Target world ${['X', 'Y', 'Z'][i]}`, n)).join('') + numeric('pitch', 'Pitch (degrees)', step.pitch) + numeric('yaw', 'Yaw (degrees)', step.yaw) + numeric('distance', 'Distance', step.distance) + `<label><input name="camera-fov-enabled" type="checkbox" ${step.fov!==undefined?'checked':''}>Override field of view</label>${numeric('camera-fov','Field of view (degrees)',step.fov??40)}` : ''}<button type="submit">Apply action</button></form>${step.type === 'camera.move' ? '<div class="scene-actions"><button data-act="pick-target">Pick target on map</button><button data-act="capture">Use free-view camera</button></div>' : ''}<div class="scene-actions"><button data-act="earlier" ${source.steps.indexOf(step) <= 0 || step.type === 'control.return' ? 'disabled' : ''}>Earlier</button><button data-act="later" ${source.steps.indexOf(step) >= source.steps.length - 2 ? 'disabled' : ''}>Later</button><button data-act="remove" ${(step.type==='camera.move'&&source.steps.filter(s=>s.type==='camera.move').length===1)||step.type==='control.return' ? 'disabled' : ''}>Remove action</button></div>`;
    q<HTMLTextAreaElement>('[data-json]').value = JSON.stringify(source, null, 2); options();npcEditor.render();
  }
  function settings() {
    const e=source.environment,seasons=['spring','summer','autumn','winter'];
    q('[data-music]').innerHTML=`${numeric('music-start','Source start (seconds)',source.music?.startSeconds??9)}${numeric('music-end','Source end (seconds)',source.music?.endSeconds??38)}<label><input name="music-fit" type="checkbox" checked>Fit tour duration to excerpt</label><button type="button" data-act="import-music">Import audio or video</button><button type="button" data-act="download-music" ${source.music?'':'disabled'}>Download clip</button><p>${source.music?`${esc(source.music.sourceName)} · ${(source.music.durationFrames/30).toFixed(2)} seconds`:'No music clip imported.'}</p>`;
    q('[data-environment]').innerHTML=`<label><input name="enabled" type="checkbox" ${e?'checked':''}>Enable seasonal time travel</label><label>Start season<select name="source-season">${seasons.map(s=>`<option ${s===(e?.sourceSeason??'summer')?'selected':''}>${s}</option>`).join('')}</select></label><label>Finish season<select name="target-season">${seasons.map(s=>`<option ${s===(e?.targetSeason??'autumn')?'selected':''}>${s}</option>`).join('')}</select></label>${numeric('start','Transition start frame',e?.startFrame??60)}${numeric('end','Transition end frame',e?.endFrame??660)}${numeric('cycles','Day/night cycles',e?.dayCycles??8)}${numeric('speed','Peak ambient speed (×)',e?.ambientSpeed??4)}${numeric('season-cycles','Complete seasonal cycles (0 = direct blend)',e?.seasonCycles??0)}<label>Time speed curve<select name="tempo"><option value="constant" ${e?.tempo?'':'selected'}>Constant</option><option value="ramp" ${e?.tempo?'selected':''}>Accelerate, cruise, brake</option></select></label>${numeric('ramp-up','Acceleration fraction',e?.tempo?.accelerateFraction??.3)}${numeric('ramp-down','Braking fraction',e?.tempo?.decelerateFraction??.3)}<label><input name="boost" type="checkbox" ${e?.tempo?.boost?'checked':''}>Second acceleration</label>${numeric('boost-start','Boost start frame',e?.tempo?.boost?.startFrame??676)}${numeric('boost-duration','Boost duration (frames)',e?.tempo?.boost?.durationFrames??60)}${numeric('boost-multiplier','Boost multiplier',e?.tempo?.boost?.multiplier??2)}<label><input name="persist" type="checkbox" ${e?.persistSeason?'checked':''}>Keep final season after saving and reloading</label><label><input name="age-npcs" type="checkbox" ${source.zoneId===427?'':'disabled'} ${source.ageHumanNpcs?'checked':''}>Age Aspertia human NPCs after transition (ROM)</label><label>Return camera<select name="return-camera"><option value="gameplay" ${source.returnCamera!=='entry'?'selected':''}>Gameplay preset</option><option value="entry" ${source.returnCamera==='entry'?'selected':''}>Entry pose (stationary player)</option></select></label><button type="submit">Apply time travel</button><p>Ends in the selected season with live player control and no ending fade. W2 export supports Aspertia, including four-season cycles ending in autumn. It installs a field runtime extension. Binary outlines use a pixel-coverage dissolve in game.</p>`;
    q('[data-test-launch]').textContent=source.environment?`Test: walk to the lookout railing at tile X${source.entry.tileX}/Z${source.entry.tileZ}. Stepping onto that tile starts the tour in place, with no launch warp. The bundled Aspertia save is unchanged. The same player regains control in autumn without an ending fade.`:'Test: press Down in the bundled Aspertia save. An initial warp loads this map; the tour and handoff stay on the live field. The save is supplied unchanged.';
    q('[data-settings]').innerHTML = `<label>Name<input name="name" value="${esc(source.name)}" maxlength="128" required></label><label>Target map<select name="zone">${zones.map(z => `<option value="${z.zoneId}" ${source.zoneId === z.zoneId ? 'selected' : ''}>${esc(z.label)}</option>`).join('')}</select></label>${numeric('x', 'Entry tile X', source.entry.tileX)}${numeric('z', 'Entry tile Z', source.entry.tileZ)}<label>Entry facing<select name="facing">${dirs.map(d => `<option ${d === source.entry.facing ? 'selected' : ''}>${d}</option>`).join('')}</select></label><button type="submit">Apply scene settings</button><button type="button" data-act="pick-entry">Pick entry on map</button>`;
  }
  async function rebuild() {
    const ticket = ++generation; playing = false; preview?.dispose(); preview = undefined;
    report('Loading live-map preview…');
    const [rawData, camera] = await Promise.all([loadMap3dZone(project, source.zoneId, { season: source.environment?.sourceSeason??'spring', includeNeighbors:Boolean(source.environment),cache: false }), loadFieldCamera(project, source.zoneId)]);
    for(const step of source.steps)if(step.type==='pokemon.cry'&&!cryPcm.has(step.species))cryPcm.set(step.species,await renderPokemonCryPcm(project,step.species));
    if (ticket !== generation || !shell.isConnected) return;
    let data=scopeCutsceneMap(rawData,undefined,Boolean(source.environment));
    if(source.environment){const maps=await Promise.all((['spring','summer','autumn','winter'] as const).map(async season=>poseFieldLookoutBackdrop(scopeCutsceneMap(await loadMap3dZone(project,source.zoneId,{season,includeNeighbors:true,cache:false}),undefined,true),camera.rom)));data=fieldEnvironmentPreview(maps,source.environment,source.steps.reduce((n,s)=>n+fieldPhaseFrames(source,s),0)+1);}
    data=previewFieldTrees(data,source);
    synthetic = previewSource(source, camera);
    const player = playerSprites = loadMap3dPlayerSprite(project, camera.rom,playerGender);
    const clips=loadFieldSpriteClips(project,camera.rom,player?.controllerType??1);
    npcLibrary=fieldNpcLibrary(project,camera.rom);
    for(const actor of source.actors??[])npcLibrary.load(actor.overworldId);
    playerMotion=compileFieldPlayerMotion(source,clips,()=>0);poseDirection='';
    npcMotions.clear();for(const actor of source.actors??[])npcMotions.set(actor.id,compileFieldNpcMotion(source,actor,loadFieldSpriteClips(project,camera.rom,npcLibrary.controller(actor.overworldId)),()=>0));
    preview = mountCutsceneMapPreview(q('[data-preview]'), data, () => synthetic, id => { if(id!==16384)return npcLibrary!.load(id);if (!player) throw new Error('Player preview sprite unavailable.'); return player; }, point => {
      if (!picking) return; const next = structuredClone(source),pick=picking,entry=typeof pick==='object'?next.actors?.find(a=>a.id===pick.npc)?.entry:pick==='entry'?next.entry:undefined;
      if(entry){entry.tileX=Math.floor(point[0]/16);entry.tileZ=Math.floor(point[2]/16);}else{const step=next.steps.find(s=>s.id===selected);if(step?.type==='camera.move')step.target=[point[0],point[1]+4,point[2]];}
      picking=undefined;run(()=>publish(next));
    },{discreteCamera:true,sampleActor:(id,at,sprites)=>{const p=(id==='player'?playerMotion!:npcMotions.get(id)!).sample(at),direction=dirs[p.textureIndex>=12?p.textureIndex-12:Math.floor(p.textureIndex/3)] as keyof typeof sprites.framesByDirection,texture=sprites.nativeTextures?.[p.textureIndex]??sprites.framesByDirection[direction]?.[p.poseIndex];if(!texture)throw new Error(`Missing native actor texture ${p.textureIndex}.`);const actor=source.actors?.find(a=>a.id===id),offset=actor?npcLibrary!.renderOffset(actor.overworldId):[0,0,0];return {position:p.position.map((v,i)=>v+offset[i]) as [number,number,number],texture,visible:at<synthetic.frameCount-1||source.actors?.find(a=>a.id===id)?.endBehavior!=='remove'};}});
    playerMotion=compileFieldPlayerMotion(source,clips,(x,z)=>preview!.groundHeight(x,z)??0);
    for(const actor of source.actors??[])npcMotions.set(actor.id,compileFieldNpcMotion(source,actor,loadFieldSpriteClips(project,camera.rom,npcLibrary.controller(actor.overworldId)),(x,z)=>preview!.groundHeight(x,z)??0));
    synthetic = previewSource(source,camera,(x,z)=>preview!.groundHeight(x,z)??0); preview.updatePath();
    q('[data-preview]').append(dialogue);playback=new FieldScenePlayback(source,frame);frame=playback.frame;animationFrame=frame;
    npcEditor.render();
    preview.setSceneCamera(!free); frame = Math.min(frame, synthetic.frameCount - 1); draw();
    report('Edit an action or the JSON source. Return control always ends the scene; export validates the walking path against map permissions.');
  }
  function draw() {
    const displayFrame=Math.floor(frame*2)/2;preview?.draw(displayFrame,animationFrame);q<HTMLInputElement>('[data-frame]').value=String(displayFrame);
    q('[data-time]').textContent=synthetic?`${(displayFrame/30).toFixed(2)} / ${((synthetic.frameCount-1)/30).toFixed(2)}s · display ${displayFrame*2}${playback?.pending?' · waiting for text':''}`:'';
    q('[data-act="play"]').textContent=playing?'Pause':'Play';
    const speech=playback?.visible();dialogue.hidden=!speech;dialogue.classList.toggle('field-dialogue-narration',speech?.step.window==='narration');
    if(speech){dialogue.querySelector('pre')!.textContent=speech.pages[speech.page].join('\n');dialogue.querySelector('[data-dialogue-caption]')!.textContent=`${speech.speaker} · ${speech.page+1}/${speech.pages.length}${speech.step.waitForInput?' · waiting for input':' · timed'}`;(dialogue.querySelector('button') as HTMLButtonElement).hidden=!speech.step.waitForInput;}
    const actor=source.actors?.find(a=>a.id===poseActor),motion=actor?npcMotions.get(actor.id):playerMotion,sprites=actor?npcLibrary?.load(actor.overworldId):playerSprites;
    if(motion&&sprites){const p=motion.sample(displayFrame),direction=dirs[p.textureIndex>=12?p.textureIndex-12:Math.floor(p.textureIndex/3)] as keyof typeof sprites.framesByDirection;
      q('[data-pose-label]').textContent=`${actor?.name??(playerGender==='female'?'Rosa':'Nate')} · ${direction} · texture ${p.textureIndex} · pose ${p.poseIndex}${p.walking?` · tile ${p.tileProgress.toFixed(3)}`:' · standing'}`;
      for(const canvas of q('[data-pose-strip]').querySelectorAll<HTMLCanvasElement>('canvas')){const index=Number(canvas.dataset.pose);canvas.hidden=index===3&&sprites.controllerType!==6;canvas.classList.toggle('active',index===p.poseIndex);if(poseDirection!==direction){const image=index===3?sprites.nativeTextures?.[12+dirs.indexOf(direction)]:sprites.framesByDirection[direction]?.[index];if(image){canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.rgba),image.width,image.height),0,0);}}}poseDirection=direction;
    }
  }
  async function publish(value: unknown) { const checked = readFieldScene(value); source = checked; save(); if (!source.steps.some(s => s.id === selected)) selected = source.steps[0].id; settings(); inspector(); await rebuild(); }
  q<HTMLInputElement>('[data-music-file]').addEventListener('change',event=>run(async()=>{
    const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;stopMusic();playing=false;const form=q<HTMLFormElement>('[data-music]'),start=Number(new FormData(form).get('music-start')),end=Number(new FormData(form).get('music-end'));
    let bytes:Uint8Array,duration:number;
    if(file.name.toLowerCase().endsWith('.strm')){bytes=new Uint8Array(await file.arrayBuffer());duration=readU32(bytes,0x24)/readU16(bytes,0x1c);if(Math.abs(duration-(end-start))>1/30)throw new Error('This cropped clip does not match the chosen source interval.');}
    else {const full=await decodeAudioFile(file),pcm=cropStereoPcm(full,Math.round(start*full.sampleRate),Math.round(end*full.sampleRate)),encoded=encodeAdpcmStrm(pcm,0,pcm.left.length,false);bytes=encoded.bytes;duration=encoded.sampleCount/encoded.sampleRate;}
    const next=structuredClone(source),path=`field-tours/audio/${source.id}.strm`,rom=new NintendoDSRom(project.originalRomBytes??(await loadActiveRomBytes())!,{fileData:'view'}),id=rom.filenames.idOf(path);
    if(project.fileSystem?.additions?.[path])project.fileSystem.additions[path]=bytes;else if(id===undefined)addRomFile(project,path,bytes);else setRomFileReplacement(project,id,bytes);
    next.music={path,sourceName:file.name,startSeconds:start,endSeconds:end,durationFrames:Math.round(duration*30)};
    if(new FormData(form).has('music-fit')){const total=next.steps.reduce((n,s)=>n+fieldPhaseFrames(next,s),0)-fieldCameraStartFrame(next),hold=next.steps.slice(next.steps.findIndex(s=>s.type==='camera.move')).find(s=>s.type==='wait');if(!hold||hold.type!=='wait'||hold.durationFrames+next.music.durationFrames-total<1)throw new Error('This clip is too short for the camera/actor actions.');hold.durationFrames+=next.music.durationFrames-total;}
    await publish(next);report(`Imported ${duration.toFixed(2)} seconds of music; the clip is saved with this project.`);
  }));
  q<HTMLSelectElement>('[data-player]').value=playerGender;
  q<HTMLSelectElement>('[data-pose-actor]').addEventListener('change',e=>{poseActor=(e.target as HTMLSelectElement).value;poseDirection='';if(poseActor!=='player')npcEditor.select(poseActor);draw();});
  q<HTMLSelectElement>('[data-player]').addEventListener('change',e=>run(async()=>{playerGender=(e.target as HTMLSelectElement).value as 'male'|'female';source=storeFieldScene(project,source);project.fieldScenes!.previewPlayer=playerGender;onDirty();await rebuild();}));
  q<HTMLSelectElement>('[data-tour]').addEventListener('change', e => run(() => publish(project.fieldScenes!.scenes[(e.target as HTMLSelectElement).value])));
  q<HTMLInputElement>('[data-file]').addEventListener('change', e => run(async () => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) await publish(JSON.parse(await f.text())); }));
  q<HTMLInputElement>('[data-frame]').addEventListener('input', e => { playing = false; seek(Math.max(0, Math.min(synthetic.frameCount - 1, Math.round(Number((e.target as HTMLInputElement).value)*2)/2 || 0))); draw(); });
  shell.addEventListener('keydown',e=>{if(e.repeat||(e.target as Element).closest('input,textarea,select,[contenteditable=true]'))return;if(playback?.pending&&['Enter',' ','a','A','b','B'].includes(e.key)){e.preventDefault();advanceDialogue();}});
  shell.addEventListener('change',e=>{if((e.target as Element).matches('[name=wait-input]'))q<HTMLInputElement>('[name=dialogue-hold]').disabled=(e.target as HTMLInputElement).checked;});
  shell.addEventListener('submit', e => { e.preventDefault(); const f = e.target as HTMLFormElement, get = (s: string) => (f.elements.namedItem(s) as HTMLInputElement).value, n = (s: string) => Number(get(s)); run(async () => {
    const next = structuredClone(source);
    if(f.matches('[data-environment]')){if((f.elements.namedItem('age-npcs') as HTMLInputElement).checked&&(f.elements.namedItem('enabled') as HTMLInputElement).checked)next.ageHumanNpcs=true;else delete next.ageHumanNpcs;next.returnCamera=get('return-camera') as FieldScene['returnCamera'];if((f.elements.namedItem('enabled') as HTMLInputElement).checked)next.environment={sourceSeason:get('source-season') as NonNullable<FieldScene['environment']>['sourceSeason'],targetSeason:get('target-season') as NonNullable<FieldScene['environment']>['targetSeason'],startFrame:n('start'),endFrame:n('end'),dayCycles:n('cycles'),ambientSpeed:n('speed'),retainSeason:true,...(n('season-cycles')?{seasonCycles:n('season-cycles')}:{ }),...(get('tempo')==='ramp'?{tempo:{accelerateFraction:n('ramp-up'),decelerateFraction:n('ramp-down'),...((f.elements.namedItem('boost') as HTMLInputElement).checked?{boost:{startFrame:n('boost-start'),durationFrames:n('boost-duration'),multiplier:n('boost-multiplier')}}:{})}}:{}),persistSeason:(f.elements.namedItem('persist') as HTMLInputElement).checked};else delete next.environment;}
    if (f.matches('[data-settings]')) { next.name = get('name'); next.zoneId = n('zone'); next.entry = { tileX: n('x'), tileZ: n('z'), facing: get('facing') as FieldScene['entry']['facing'] }; }
    if (f.matches('[data-step]')) { const step = next.steps.find(s => s.id === selected)!; if ('durationFrames' in step && step.type!=='dialogue') step.durationFrames = n('duration'); if ('direction' in step) step.direction = get('direction') as FieldScene['entry']['facing']; if (step.type === 'player.walk') step.tiles = n('tiles'); if (step.type === 'camera.move') { step.target = [n('target-0'), n('target-1'), n('target-2')]; step.pitch = n('pitch'); step.yaw = n('yaw'); step.distance = n('distance');if((f.elements.namedItem('camera-fov-enabled') as HTMLInputElement).checked)step.fov=n('camera-fov');else delete step.fov; } }
    if(f.matches('[data-step]')){const i=next.steps.findIndex(s=>s.id===selected),step=next.steps[i];if(step.type==='dialogue'){const common={id:step.id,type:'dialogue' as const,speakerId:get('speaker'),text:get('dialogue-text'),window:get('dialogue-window') as 'dialogue'|'narration'};next.steps[i]=(f.elements.namedItem('wait-input') as HTMLInputElement).checked?{...common,waitForInput:true}:{...common,waitForInput:false,durationFrames:n('dialogue-hold'),...((f.elements.namedItem('dialogue-camera') as HTMLInputElement).checked?{camera:{target:[n('dialogue-target-0'),n('dialogue-target-1'),n('dialogue-target-2')],pitch:n('dialogue-pitch'),yaw:n('dialogue-yaw'),distance:n('dialogue-distance'),durationFrames:n('dialogue-camera-duration'),...((f.elements.namedItem('dialogue-fov-enabled') as HTMLInputElement).checked?{fov:n('dialogue-fov')}:{})}}:{})};}}
    if(f.matches('[data-step]')){const step=next.steps.find(s=>s.id===selected)!;if(step.type==='pokemon.cry'){step.species=n('species');step.form=n('form');}if(step.type==='camera.shake'){step.amplitudeX=n('amplitudeX');step.amplitudeY=n('amplitudeY');step.periodFrames=n('period');step.cycles=n('cycles');}}
    await publish(next);
  }); });
  shell.addEventListener('click', e => { const b = (e.target as Element).closest<HTMLButtonElement>('button[data-act]'); if (!b) return; run(async () => {
    const act = b.dataset.act, next = structuredClone(source), index = next.steps.findIndex(s => s.id === selected);
    if (act === 'select') { selected = b.dataset.id!; frame = source.steps.slice(0, source.steps.findIndex(s => s.id === selected)).reduce((n, s) => n + fieldPhaseFrames(source,s), 0); playing = false; seek(frame); inspector(); draw(); return; }
    if (act === 'play') { playing = !playing; if (frame >= synthetic.frameCount - 1) seek(0);if(playing)await startMusic();else stopMusic();draw(); return; }
    if(act==='previous'||act==='next'){playing=false;seek(Math.max(0,Math.min(synthetic.frameCount-1,Math.floor(frame*2)/2+(act==='next'?.5:-.5))));draw();return;}
    if (act === 'continue') { advanceDialogue();return; }
    if (act === 'restart') { seek(0); playing = false; draw(); return; }
    if (act === 'view') { free = !free; preview?.setSceneCamera(!free); b.textContent = free ? 'Scene view' : 'Free view'; return; }
    if (act === 'pick-target' || act === 'pick-entry') { picking = act === 'pick-target' ? 'target' : 'entry'; report('Click a map surface to choose this coordinate. Use Free view to look around.'); return; }
    if (act === 'capture') { if (!free || !preview) throw new Error('Switch to Free view and position the camera first.'); const step = next.steps[index]; if (step.type !== 'camera.move') return; const pose = preview.capture(), direction = new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(...pose.rotation.map(n=>n*Math.PI/180) as SceneVector,'YXZ')); step.target = pose.position.map((v,i)=>v+direction.getComponent(i)*step.distance) as SceneVector; step.pitch = (Math.asin(-direction.y)*180/Math.PI+360)%360; step.yaw = (Math.atan2(-direction.x,-direction.z)*180/Math.PI+360)%360; await publish(next); return; }
    if(act==='import-music'){q<HTMLInputElement>('[data-music-file]').value='';q<HTMLInputElement>('[data-music-file]').click();return;}
    if(act==='download-music'&&source.music){const bytes=project.fileSystem?.additions?.[source.music.path];if(!bytes)throw new Error('The clip asset is missing.');downloadBytes(bytes,`${source.id}.music.strm`);return;}
    if (act === 'import') { q<HTMLInputElement>('[data-file]').value = ''; q<HTMLInputElement>('[data-file]').click(); return; }
    if (act === 'apply-json') { await publish(JSON.parse(q<HTMLTextAreaElement>('[data-json]').value)); return; }
    if (act === 'json') { downloadBytes(encode(source), `${source.id}.scene.json`); return; }
    if (act === 'script' || act === 'export') {
      if (q<HTMLTextAreaElement>('[data-json]').value !== JSON.stringify(source, null, 2)) throw new Error('Apply the JSON draft before exporting.');
      b.disabled = true; report('Preparing field scene test…');
      try { const dl = await buildFieldSceneTestDownloads(project, source); if (act === 'script') downloadBytes(new TextEncoder().encode(dl.source), `${source.id}.test.rb`); else { downloadBytes(dl.romBytes, `${source.id}.nds`); downloadBytes(dl.saveBytes, `${source.id}.sav`); } report(dl.trigger.launchMode==='entry-step'?`Test exported. Walk onto the lookout tile X${dl.trigger.tileX}/Z${dl.trigger.tileZ} to start the tour in place.`:'Test exported. Press Down in the matching Aspertia save to load the target map and play the field tour.'); } finally { b.disabled = false; } return;
    }
    if (act === 'new') { let i = 1; while (project.fieldScenes?.scenes[`field-tour-${i}`]) i++; next.id = `field-tour-${i}`; next.name = `Field tour ${i}`; await publish(next); return; }
    if (act === 'remove' && index >= 0 && index < next.steps.length - 1) {const [removed]=next.steps.splice(index, 1);for(const actor of next.actors??[])actor.actions=actor.actions.filter(a=>a.stepId!==removed.id);}
    else if (act === 'earlier' && index > 0 && index < next.steps.length - 1) [next.steps[index - 1], next.steps[index]] = [next.steps[index], next.steps[index - 1]];
    else if (act === 'later' && index >= 0 && index < next.steps.length - 2) [next.steps[index + 1], next.steps[index]] = [next.steps[index], next.steps[index + 1]];
    else if (act === 'add') { let id = 1; while (next.steps.some(s => s.id === `step-${id}`)) id++; const type = q<HTMLSelectElement>('[data-type]').value; const step: FieldSceneStep = type==='pokemon.cry'?{id:'',type:'pokemon.cry',species:483,form:0}:type==='camera.shake'?{id:'',type:'camera.shake',amplitudeX:2,amplitudeY:1,periodFrames:6,cycles:10}:type === 'dialogue'?{id:'',type:'dialogue',speakerId:source.actors?.[0]?.id??'player',text:'Hello there!',waitForInput:true}:type === 'camera.move' ? { ...next.steps.find(s => s.type === 'camera.move')! } : type === 'player.walk' ? { id: '', type: 'player.walk', direction: 'down', tiles: 1 } : type === 'player.face' ? { id: '', type: 'player.face', direction: 'down' } : { id: '', type: 'wait', durationFrames: 30 }; step.id = `step-${id}`; selected = step.id; next.steps.splice(next.steps.length - 1, 0, step); }
    else return;
    await publish(next);
  }); });
  settings(); inspector();
  try { await rebuild(); } catch (error) { report(error instanceof Error ? error.message : String(error)); }
  function tick(time: number) { if (!shell.isConnected) { generation++; stopMusic();void audioContext?.close();preview?.dispose(); return; } if (playing && synthetic) { const delta=Math.min(100,time-last)*.03;animationFrame+=delta;frame=playback!.step(delta); if (frame >= synthetic.frameCount - 1) {playing = false;stopMusic();} draw(); } last = time; requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
}
