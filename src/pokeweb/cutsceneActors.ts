import { NARC } from '../nds/narc';
import { readAscii } from '../nds/binary';
import type { NintendoDSRom } from '../nds/rom';
import { getRomFileBytes } from './fileSystemModel';
import { buildNpcSpriteFrames, parseNpcRegistry, readNitroResources, type Map3dNpcSpriteFrames } from './map3dModel';
import type { ProjectState } from './projectStore';
import type { SceneNpcTrack, SceneVector } from './cutsceneScene';

/** Registry IDs are explicit; no unknown sprite silently falls back to another actor. */
export function cutsceneOverworldLibrary(project: ProjectState, rom: NintendoDSRom,includeNativeTextures=false) {
  const entries = parseNpcRegistry(new NARC(getRomFileBytes(project, rom, rom.fileId('a/0/4/7'))).files[0]);
  const files = new NARC(getRomFileBytes(project, rom, rom.fileId('a/0/4/8'))).files;
  const cache = new Map<number, Map3dNpcSpriteFrames>();
  const catalog = entries.flatMap((entry, id) => readAscii(files[entry.resourceIndices[0]] ?? new Uint8Array(), 0, 4) === 'BTX0' ? [{ id, label: `${id} · Overworld ${entry.uid}` }] : []);
  return { catalog, load(id: number) {
    let frames = cache.get(id); if (frames) return frames;
    const entry = entries[id], bytes = entry && files[entry.resourceIndices[0]];
    if (!bytes || readAscii(bytes, 0, 4) !== 'BTX0') throw new Error(`Overworld ${id} is not an available W2 sprite. 3D overworld models are not supported as NPC tracks.`);
    const warnings: string[] = [];
    frames = buildNpcSpriteFrames(readNitroResources(bytes), entry, entry.resourceIndices[0], warnings, { up: 0, down: 1, left: 2, right: 3 },includeNativeTextures);
    if (!frames || warnings.length || Object.keys(frames.framesByDirection).length !== 4) throw new Error(`Overworld ${id} has incomplete sprite frames: ${warnings.join('; ')}`);
    cache.set(id, frames); return frames;
  } };
}

const order = new WeakMap<SceneNpcTrack, SceneNpcTrack['keys']>();
export function sampleSceneNpc(actor: SceneNpcTrack, frame: number) {
  let keys = order.get(actor); if (!keys) { keys = [...actor.keys].sort((a,b) => a.frame-b.frame); order.set(actor, keys); }
  let low = 0, high = keys.length;
  while (low < high) { const mid = (low + high) >>> 1; if (keys[mid].frame <= frame) low = mid + 1; else high = mid; }
  const a = keys[Math.max(0,low-1)], b = keys[Math.min(keys.length-1,low)];
  let t = a === b || a.easing === 'hold' || frame <= a.frame ? 0 : (frame-a.frame)/(b.frame-a.frame);
  if (a.easing === 'smoothstep') t = t*t*(3-2*t);
  return { position: a.position.map((n,i) => n+(b.position[i]-n)*t) as SceneVector, facing: a.facing, action: a.action,
    spriteStep: a.action === 'idle' ? 0 : Math.floor(Math.max(0,frame-a.frame)/actor.frameStep) };
}
export function sceneNpcTexture(actor: SceneNpcTrack, frame: number, sprites: Map3dNpcSpriteFrames) {
  const pose = sampleSceneNpc(actor,frame), frames = sprites.framesByDirection[pose.facing];
  if (!frames?.length) throw new Error(`Missing ${pose.facing} sprite for ${actor.name}.`);
  const cycle = frames.length === 3 ? [0,1,0,2] : Array.from({length:frames.length},(_,i)=>i);
  return frames[cycle[pose.spriteStep % cycle.length]];
}
