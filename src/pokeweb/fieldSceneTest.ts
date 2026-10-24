import { readU16, readU32, writeU32 } from '../nds/binary';
import { NintendoDSRom } from '../nds/rom';
import { NARC } from '../nds/narc';
import { gen5ScriptEntries } from './gen5ScriptCommands';
import { compileFieldScene, readFieldScene, fieldCameraStartFrame, fieldPhaseFrames, fieldScenePlayerPath, fieldSceneNpcPath, fieldSceneActorIds, type FieldScene } from './fieldScene';
import { fieldNpcLibrary,appendFieldMapActors,alignFieldDialgaRegistry,aspertiaNpcAgingPlan } from './fieldSceneNpcs';
import {cutsceneOverworldLibrary} from './cutsceneActors';
import { stageFieldSceneDialogue } from './fieldSceneDialogue';
import { appendCutsceneTestTrigger, removeNativeCutsceneTestTriggers, removeFieldSceneTestTriggers } from './nativeCutsceneTest';
import { buildQuickLaunchDownloads, loadTestBattleSave, getTestBattleConfigForProject } from './testBattle';
import { loadMap3dZone, type Map3dSceneData } from './map3dModel';
import {buildFieldEnvironmentAssets} from './fieldEnvironmentAssets';
import {installFieldEnvironmentRuntime,serializeFieldEnvironment} from './fieldEnvironmentRuntime';
import {fieldSeasonExportProject} from './fieldSeasonPersistence';
import {buildFieldTreeAssets} from './fieldTreeGrowth';
import {appendStandaloneSdatStream} from './streamedBgmModel';
import {getRomFileBytes} from './fileSystemModel';
import { isWaterLikePermission } from './gen5PermissionModel';
import { loadFieldCamera } from './fieldCameraModel';
import type { CompiledBw2Script } from './bw2ScriptCompiler';
import type { ProjectState } from './projectStore';

/** Move an entire compiled body together, retaining all relative movement/call offsets. */
export function appendFieldSceneScript(bytes: Uint8Array, compiled: CompiledBw2Script) {
  if (compiled.entries.length !== 1) throw new Error('A field scene requires one public entry.');
  const count = gen5ScriptEntries(bytes).length, end = count * 4;
  if (count >= 65534 || bytes.length < end + 2 || readU16(bytes, end) !== 0xfd13) throw new Error('The map script entry table cannot be extended safely.');
  const body = compiled.bytes.subarray(compiled.entries[0].offset), output = new Uint8Array(bytes.length + 4 + body.length);
  output.set(bytes.subarray(end), end + 4);
  for (let i = 0; i < count; i++) writeU32(output, i * 4, readU32(bytes, i * 4) + 4);
  writeU32(output, end, bytes.length - end);
  output.set(body, bytes.length + 4);
  return { bytes: output, entryId: count + 1 };
}

export function validateFieldSceneGround(scene: FieldScene, data: Pick<Map3dSceneData, 'chunks'>) {
  for(const track of [{name:'Player',path:fieldScenePlayerPath(scene)},...(scene.actors??[]).map(a=>({name:`NPC ${a.name}`,path:fieldSceneNpcPath(scene,a)}))])for (const point of track.path) {
    const chunk = data.chunks.find(c => c.matrixX === Math.floor(point.tileX / 32) && c.matrixY === Math.floor(point.tileZ / 32));
    const p = chunk?.permissions;
    // Terrain meshes are centered on worldX/worldZ; grid coordinates use matrix origin.
    const x = point.tileX % 32, z = point.tileZ % 32, tile = p?.tiles[z * p.width + x];
    if (!chunk || !p || x >= p.width || z >= p.height || !tile) throw new Error(`${track.name} tile ${point.tileX}, ${point.tileZ} has no loaded ground permissions.`);
    if (tile.flags & 1 || tile.tileClass === 1 || tile.tileClass === 18 || isWaterLikePermission(tile)) throw new Error(`${track.name} tile ${point.tileX}, ${point.tileZ} is blocked or water. Choose a walking path on open ground.`);
  }
}

/** Grid trigger heights are world units, rounded to the native 16-unit layer. */
function entryTriggerPosition(scene: FieldScene, data: Pick<Map3dSceneData, 'chunks'>) {
  const x=scene.entry.tileX*16+8,z=scene.entry.tileZ*16+8;let height=-Infinity;
  for(const c of data.chunks)for(const p of c.primitives)for(let i=0;i<p.indices.length;i+=3){
    const a=p.indices[i]*3,b=p.indices[i+1]*3,d=p.indices[i+2]*3,v=p.positions;
    const ax=v[a]+c.worldX,az=v[a+2]+c.worldZ,bx=v[b]+c.worldX,bz=v[b+2]+c.worldZ,dx=v[d]+c.worldX,dz=v[d+2]+c.worldZ;
    const determinant=(bz-dz)*(ax-dx)+(dx-bx)*(az-dz);if(Math.abs(determinant)<1e-8)continue;
    const u=((bz-dz)*(x-dx)+(dx-bx)*(z-dz))/determinant,w=((dz-az)*(x-dx)+(ax-dx)*(z-dz))/determinant;
    if(u>=-1e-5&&w>=-1e-5&&u+w<=1.00001)height=Math.max(height,u*v[a+1]+w*v[b+1]+(1-u-w)*v[d+1]+(c.worldY??0));
  }
  if(!Number.isFinite(height))throw new Error('The entry trigger has no terrain surface.');
  return {gridX:scene.entry.tileX,gridZ:scene.entry.tileZ-1,gridY:Math.round(height/16)};
}

/** Native interpolation multiplies signed fx32 deltas by elapsed frames before division. */
export function validateFieldSceneInterpolation(scene: FieldScene, data: Pick<Map3dSceneData, 'chunks'>, defaultDistance: number) {
  let minY=0,maxY=0;
  for(const c of data.chunks)for(const p of c.primitives)for(let i=1;i<p.positions.length;i+=3){minY=Math.min(minY,p.positions[i]+(c.worldY??0));maxY=Math.max(maxY,p.positions[i]+(c.worldY??0));}
  let x=scene.entry.tileX*16+8,z=scene.entry.tileZ*16+8,distance=defaultDistance,lowY=minY-32,highY=maxY+32;
  const final=fieldScenePlayerPath(scene).at(-1)!;
  for(const action of scene.steps){const step=action.type==='dialogue'?action.camera:action;if(!step||!('target'in step)&&step.type!=='control.return')continue;
    const target='target'in step?step.target:[final.tileX*16+8,0,final.tileZ*16+8];
    const nextLow='target'in step?target[1]:minY-32,nextHigh='target'in step?target[1]:maxY+32,nextDistance='target'in step?step.distance:defaultDistance;
    const delta=Math.max(Math.abs(target[0]-x),Math.abs(target[2]-z),Math.abs(nextLow-highY),Math.abs(nextHigh-lowY),Math.abs(nextDistance-distance));
    if(Math.ceil(delta*4096)*step.durationFrames>0x7fffffff)throw new Error(`Camera action ${action.id} exceeds W2's interpolation range. Add intermediate camera moves or shorten its duration.`);
    [x,z,distance,lowY,highY]=[target[0],target[2],nextDistance,nextLow,nextHigh];
  }
}

function validateFieldHandlers(rom: NintendoDSRom) {
  const table = rom.loadArm9Overlays([12]).get(12), field = rom.loadArm9Overlays([36]).get(36);
  const audited = [
    [0x13f, 0x021ae76d, 'f8b50f1c381ca6f71bfd'], [0x140, 0x021ae7dd, '10b5081ca6f7e4fc'],
    [0x141, 0x021ae7fd, '08b5081ca6f7d4fc'], [0x142, 0x021ae815, '08b5081ca6f7c8fc'],
    [0x143, 0x021ae82d, '70b592b0051c081c'], [0x145, 0x021ae96d, '38b50d1c281ca6f727fc'],
    [0x147, 0x021ae945, '38b5051c081ca6f72ffc'], [0x64, 0x021a9935, 'f8b50c1c051c201c'],
    [0xc2, 0x021a7ef9, 'f0b587b0041c081c'],
    [0x65,0x021a9fdd,'08b502496bf652fd'],[0x69,0x021aa109,'f0b589b00c1c051c'],[0x6c,0x021aa1a5,'70b50e1c051c301c'],
    [0x34,0x021a8751,'70b50c1c051c201cacf7'],[0x36,0x021a8879,'08b5081cfff73cff0020'],
    [0x3c,0x021a8f65,'f0b585b0051c0c1c'],[0x3e,0x021a9131,'08b5fff7d3fd0120'],[0x31,0x021548f5,'08b50249c1f6c6f8'],
    [0xab,0x021a7329,'f8b50d1c041c281c'],[0x148,0x021ae999,'f8b58eb0041c0d1c'],
  ] as const;
  for (const [opcode, pointer, signature] of audited) {
    const address=pointer&~1,code=field&&address>=field.ramAddress&&address<field.ramAddress+field.data.length?field:table,at=code?address-code.ramAddress:-1;
    if (!table || !code || at < 0 || readU32(table.data, 0x1b178 + opcode * 4) !== pointer || !signature.match(/../g)!.every((n, i) => code.data[at + i] === parseInt(n, 16))) throw new Error('This ROM has unsupported field camera, movement or dialogue handlers.');
  }
}

/** Export-only fixture. Scene data never changes the user's player save or native renderer. */
export async function buildFieldSceneTestDownloads(project: ProjectState, input: FieldScene) {
  const scene = readFieldScene(input);
  if(!scene.environment&&scene.steps.some(s=>s.type==='camera.move'?s.fov!==undefined:s.type==='dialogue'&&s.camera?.fov!==undefined))throw new Error('Projection overrides currently require the live field environment adapter.');
  if (project.session.baseVersion !== 'W2' || project.romInfo.idCode !== 'IRDO') throw new Error('Field tours currently require US White 2.');
  const [data,camera] = await Promise.all([loadMap3dZone(project, scene.zoneId, { season: scene.environment?.sourceSeason??'spring', cache: false }),loadFieldCamera(project,scene.zoneId)]);
  if(scene.actors?.length){const library=fieldNpcLibrary(project,camera.rom);for(const actor of scene.actors){library.load(actor.overworldId);if(actor.overworldId===0x1218&&(actor.entry.facing!=='up'||actor.actions.length))throw new Error('The Dialga follower track currently supports standing north only.');}}
  validateFieldSceneGround(scene, data);
  if(!camera.preset.followsPlayer||camera.preset.roll!==0||(camera.regions.length&&(!scene.environment||scene.returnCamera!=='entry')))throw new Error('This first field-tour exporter requires a following gameplay camera without dynamic regions. Route 13 is the verified fixture.');
  const end=fieldScenePlayerPath(scene).at(-1)!;
  if(camera.boundaries.some(b=>b.type!==0&&(b.type!==1||end.tileX*16+8<b.west||end.tileX*16+8>b.east||end.tileZ*16+8<b.north||end.tileZ*16+8>b.south)))throw new Error('The final player tile is outside a supported gameplay camera boundary.');
  validateFieldSceneInterpolation(scene,data,camera.preset.distance);
  if(scene.music&&scene.music.durationFrames!==scene.steps.reduce((n,s)=>n+fieldPhaseFrames(scene,s),0)-fieldCameraStartFrame(scene))throw new Error('Fit the camera tour duration (after the prelude) to the music excerpt before exporting.');
  const exportProject=scene.environment?.persistSeason?await fieldSeasonExportProject(project):project;
  const [{ romBytes }, save] = await Promise.all([buildQuickLaunchDownloads(exportProject), loadTestBattleSave(getTestBattleConfigForProject(project))]);
  if(scene.zoneId!==save.zoneId&&scene.steps.some(s=>s.type==='dialogue'&&s.window==='narration'))throw new Error('Native narration currently requires the on-site Aspertia tour fixture.');
  if (save.zoneId !== 427) throw new Error('The field tour test fixture must start in Aspertia City.');
  const rom = new NintendoDSRom(romBytes, { fileData: 'view' });
  validateFieldHandlers(rom);
  const headers = new NARC(rom.getFileByName('a/0/1/2')).files[0], scriptId = readU16(headers, save.zoneId * 48 + 6), eventId = readU16(headers, save.zoneId * 48 + 22);
  const scriptFile = rom.fileId('a/0/5/6'), eventFile = rom.fileId('a/1/2/6'), scripts = new NARC(rom.files[scriptFile]), events = new NARC(rom.files[eventFile]);
  // Avoid every static NPC ID, including adjacent loaded maps, not just the target zone.
  const used=new Set<number>();
  for(const bytes of events.files){if(bytes.length<8)continue;for(let i=0;i<bytes[5];i++){const at=8+bytes[4]*20+i*36;if(at+36<=bytes.length)used.add(readU16(bytes,at));}}
  const actorIds=fieldSceneActorIds(scene,used);
  const aging=scene.ageHumanNpcs?aspertiaNpcAgingPlan(events.files[readU16(headers,scene.zoneId*48+22)]):[];
  if(scene.ageHumanNpcs){const library=cutsceneOverworldLibrary(project,rom);library.load(28);library.load(29);}
  // Field actor messages read the story archive (native archive ID 3).
  const textFile=rom.fileId('a/0/0/3'),dialogue=stageFieldSceneDialogue(rom.files[textFile],scene,readU16(headers,scene.zoneId*48+10));
  const launchAtEntry=Boolean(scene.environment),triggerPosition=launchAtEntry?entryTriggerPosition(scene,data):save;
  if(launchAtEntry&&scene.zoneId!==save.zoneId)throw new Error('The entry-trigger fixture requires the target map to match the supplied save map.');
  const program = compileFieldScene(scene, launchAtEntry?'entry-trigger':true,actorIds,dialogue.bindings), appended = appendFieldSceneScript(scripts.files[scriptId], program.compiled);
  let cleaned = removeFieldSceneTestTriggers(scripts.files[scriptId],removeNativeCutsceneTestTriggers(scripts.files[scriptId],events.files[eventId],save),save);
  if(launchAtEntry)cleaned=removeFieldSceneTestTriggers(scripts.files[scriptId],cleaned,triggerPosition);
  const start=8+cleaned[4]*20+cleaned[5]*36+cleaned[6]*20;
  for(let i=0;i<cleaned[7];i++){const at=start+i*22,x=readU16(cleaned,at+10),z=readU16(cleaned,at+12),w=readU16(cleaned,at+14),h=readU16(cleaned,at+16);if(triggerPosition.gridX>=x&&triggerPosition.gridX<x+w&&triggerPosition.gridZ+1>=z&&triggerPosition.gridZ+1<z+h)throw new Error('The temporary launch tile already has an unrecognized trigger.');}
  scripts.files[scriptId] = appended.bytes;
  const targetEvents=readU16(headers,scene.zoneId*48+22),mapActors=appendFieldMapActors(targetEvents===eventId?cleaned:events.files[targetEvents],scene,actorIds,(tileX,tileZ)=>entryTriggerPosition({...scene,entry:{tileX,tileZ,facing:'up'}},data).gridY*16);
  if(targetEvents!==eventId)events.files[targetEvents]=mapActors;
  events.files[eventId] = appendCutsceneTestTrigger(targetEvents===eventId?mapActors:cleaned, appended.entryId, triggerPosition);
  const files=new Map([[scriptFile,scripts.save()],[eventFile,events.save()]]);
  if(scene.actors?.some(a=>a.overworldId===0x1218)){const id=rom.fileId('a/0/4/7'),registry=new NARC(rom.files[id]);registry.files[0]=alignFieldDialgaRegistry(registry.files[0]);files.set(id,registry.save());}
  if(dialogue.bytes)files.set(textFile,dialogue.bytes);
  let streamId:number|undefined;
  if(scene.music){const id=rom.filenames.idOf(scene.music.path),clip=exportProject.fileSystem?.additions?.[scene.music.path]??(id===undefined?undefined:getRomFileBytes(exportProject,rom,id));if(!clip)throw new Error('Import the scene music clip before exporting.');const sdatId=rom.files.findIndex(b=>b[0]===83&&b[1]===68&&b[2]===65&&b[3]===84);if(sdatId<0)throw new Error('Missing native sound archive.');const song=appendStandaloneSdatStream(rom.files[sdatId],clip);files.set(sdatId,song.bytes);streamId=song.streamId;}
  let environment:Record<string,unknown>|undefined,overlays:Map<number,Uint8Array>|undefined;
  if(scene.environment){
    const assets=await buildFieldEnvironmentAssets(project,rom,scene);for(const [id,bytes]of assets.files)files.set(id,bytes);
    const treeAssets=scene.trees?.length?buildFieldTreeAssets(rom,await loadMap3dZone(project,scene.zoneId,{season:'summer',includeNeighbors:true,cache:false}),scene):undefined;if(treeAssets)files.set(treeAssets.fileId,treeAssets.bytes);
    const patternsId=rom.fileId('a/0/6/9'),patterns=new NARC(rom.files[patternsId]),configId=patterns.files.length,blob=serializeFieldEnvironment(scene,assets.programs,streamId,treeAssets?.program,(scene.actors??[]).filter(a=>a.placement==='map').map(a=>({...a,nativeId:actorIds[a.id]})),aging);patterns.files.push(blob);files.set(patternsId,patterns.save());
    const installed=installFieldEnvironmentRuntime(rom,configId);overlays=installed.overlays;environment={...assets.manifest,originalTerrainAndCollisionsUnchanged:!treeAssets,treeGrowth:treeAssets?.manifest,runtime:installed.manifest,configBytes:blob.length,npcAging:scene.ageHumanNpcs?{temporary:true,swaps:aging,oldMan:28,oldLady:29}:undefined,persistSeason:Boolean(scene.environment.persistSeason),music:scene.music?{...scene.music,streamId}:undefined};
  }
  const overlayTable=rom.arm9OverlayTable.slice();
  if(overlays)for(let at=0;at<overlayTable.length;at+=32){const id=readU32(overlayTable,at),bytes=overlays.get(id);if(!bytes)continue;files.set(readU32(overlayTable,at+24),bytes);writeU32(overlayTable,at+8,bytes.length);writeU32(overlayTable,at+28,readU32(overlayTable,at+28)&0xfe000000);}
  return {
    romBytes: rom.save({ files, arm9OverlayTable:overlayTable, preserveOriginalLength: true }),
    saveBytes: new Uint8Array(save.rawSaveBytes), source: program.source,
    actorIds,environment,
    dialogue:{bankId:dialogue.bankId,bindings:dialogue.bindings},
    trigger: { zoneId: save.zoneId, tileX: triggerPosition.gridX, tileZ: triggerPosition.gridZ + 1, worldY:triggerPosition.gridY*16, launchMode:launchAtEntry?'entry-step':'save-warp', scriptId, eventId, entryId: appended.entryId },
  };
}
