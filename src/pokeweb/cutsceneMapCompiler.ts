import { NARC } from '../nds/narc';
import { readU32, writeU16, writeU32 } from '../nds/binary';
import { getRomFileBytes, replaceRomFile } from './fileSystemModel';
import { buildAspertiaCutsceneClone } from './nativeCutsceneClone';
import { compileCutsceneTimeline } from './cutsceneNativeCompiler';
import { loadMapCutsceneAssets, stagePoint, type MapStageManifest } from './cutsceneMapAssets';
import { openNativeCutscene, readNativeSceneDefinition, type NativeCutsceneLibrary } from './nativeCutsceneModel';
import { CUTSCENE_ID_CHECK, CUTSCENE_MAX_OVERLAY_SIZE, CUTSCENE_ORIGINAL_SIZE, CUTSCENE_OVERLAY_BASE as BASE, CUTSCENE_TABLE_READERS, readNativeCutsceneLayout } from './nativeCutsceneRegistry';
import { readCutsceneScene, type CutsceneScene } from './cutsceneScene';
import type { ProjectState } from './projectStore';
import { cutsceneOverworldLibrary } from './cutsceneActors';
import { compileCutsceneNpc } from './cutsceneActorCompiler';
import { stageCutsceneDialogueBank, type CutsceneDialogueBankBinding } from './cutsceneDialogueBank';
import { installCutsceneDialogueRuntime } from './cutsceneDialogueRuntime';
import { decompressCode } from '../nds/codeCompression';
export type MapCutsceneBinding = {
  version: 1;
  sequenceId: number;
  memberIds: number[];
  overlayStart: number;
  overlayCapacity: number;
  installedFingerprint: string;
  manifest: MapStageManifest;
  dialogue?: CutsceneDialogueBankBinding;
};
const align = (n: number) => (n + 3) & ~3;
function fingerprint(overlay: Uint8Array, files: readonly Uint8Array[], binding: Omit<MapCutsceneBinding, 'installedFingerprint' | 'manifest'>) {
  const layout = readNativeCutsceneLayout(overlay), at = layout.tableOffset + binding.sequenceId * 20;
  let hash = 2166136261;
  for (const bytes of [overlay.subarray(at, at + 20), overlay.subarray(binding.overlayStart, binding.overlayStart + binding.overlayCapacity), ...binding.memberIds.map(id => files[id])]) {
    if (!bytes)
      throw new Error('An installed scene resource is missing.');
    for (const byte of bytes)
      hash = Math.imul(hash ^ byte, 16777619);
  }
  return (hash >>> 0).toString(16);
}
/** Build and validate owned buffers before publishing the archive, registry and source binding together. */
export async function applyMapCutscene(project: ProjectState, library: NativeCutsceneLibrary, input: CutsceneScene) {
  const source = readCutsceneScene(input);
  if (source.stage.kind !== 'map')
    throw new Error('Choose a map-stage timeline.');
  const record = project.cutsceneAuthoring?.scenes[source.id];
  if (!record || JSON.stringify(record.source) !== JSON.stringify(source))
    throw new Error('Save this scene source before compiling.');
  const revision = record.revision, previous = record.mapBinding;
  if (source.camera.some(k => Math.abs(k.fov - 40) > 1 / 4096))
    throw new Error('Map-stage W2 export currently requires a fixed 40° field of view.');
  const original = library.rom.loadArm9Overlays([293]).get(293)!;
  if (original.bssSize || original.ramAddress !== BASE || original.staticInitEnd > BASE + CUTSCENE_ORIGINAL_SIZE)
    throw new Error('Unsupported native cutscene overlay memory layout.');
  const initialOverlay = project.overlays[293] ?? library.overlayBytes, archive = new NARC(getRomFileBytes(project, library.rom, library.fileId)), initialArchive = archive.save();
  let overlay = initialOverlay, files = archive.files, layout = readNativeCutsceneLayout(overlay);
  if (previous) {
    if (previous.version !== 1 || ![previous.sequenceId, previous.overlayStart, previous.overlayCapacity].every(Number.isSafeInteger) || previous.overlayCapacity < 84 || !Array.isArray(previous.memberIds) || previous.memberIds.length < 2 || previous.memberIds.some(id => !Number.isSafeInteger(id) || id < 0 || id >= 65535) || previous.sequenceId < 28 || previous.sequenceId >= layout.count || previous.overlayStart < CUTSCENE_ORIGINAL_SIZE || previous.overlayStart + previous.overlayCapacity > overlay.length || new Set(previous.memberIds).size !== previous.memberIds.length || fingerprint(overlay, files, previous) !== previous.installedFingerprint)
      throw new Error('The installed map cutscene changed outside this timeline. Restore the last project snapshot or import this source with a new scene ID.');
    for (let id = 1; id < layout.count; id++)
      if (id !== previous.sequenceId) {
        const d = readNativeSceneDefinition(overlay, BASE, id);
        if ([d.cameraId, ...d.resources.flatMap(r => r.bundles.flat(2))].some(n => previous.memberIds.includes(n)))
          throw new Error('The map cutscene no longer owns private resources.');
      }
  }
  const dialogue=stageCutsceneDialogueBank(project,library,source,previous?.dialogue,previous?.sequenceId);
  const assets = await loadMapCutsceneAssets(project, source.stage.zoneId, source.stage.season, source.frameCount,source.environment,source.stage.bounds,source.stage.includeNeighbors,source);
  if (source.actors?.length) {
    const sprites = cutsceneOverworldLibrary(project,library.rom);
    assets.manifest.actors = [];
    for (const actor of source.actors) {
      const output = compileCutsceneNpc(actor,sprites.load(actor.overworldId),source.frameCount,assets.manifest);
      assets.manifest.actors.push({id:actor.id,overworldId:actor.overworldId,modelIndex:assets.models.length});
      assets.models.push(output.model);assets.groups.push(output.group);
      assets.manifest.modelBytes += output.model.length; assets.manifest.animationBytes += output.animationBytes;
      assets.manifest.textures += output.textures; assets.manifest.textureBytes += output.textureBytes; assets.manifest.paletteBytes += output.paletteBytes;
      assets.manifest.triangles += 2; assets.manifest.patternTracks++;
    }
    assets.manifest.models = assets.models.length;
    if (assets.models.length > 64 || assets.manifest.textureBytes > 256*1024 || assets.manifest.paletteBytes > 32*1024) throw new Error('NPCs and stage exceed native model or texture/palette limits.');
  }
  const converted = structuredClone(source);
  converted.camera.forEach(k => {
    k.position = stagePoint(k.position, assets.manifest);
  });
  const compiled = compileCutsceneTimeline(converted,dialogue.cues);
  if (assets.manifest.modelBytes + assets.manifest.animationBytes + compiled.camera.bytes.length > 1024 * 1024)
    throw new Error("The stage and camera exceed the 1 MiB asset budget reserved within the native cutscene heap.");
  if (layout.kind === 'original') {
    const clone = buildAspertiaCutsceneClone(overlay, files);
    overlay = clone.overlay;
    files = clone.files;
    layout = readNativeCutsceneLayout(overlay);
  }
  const sequenceId = previous?.sequenceId ?? layout.count;
  if (sequenceId >= 64)
    throw new Error('The custom native sequence registry is full.');
  const memberIds = [...(previous?.memberIds ?? [])], resources = [compiled.camera.bytes, ...assets.groups.flat()];
  resources.forEach((bytes, i) => {
    const id = memberIds[i] ?? files.length;
    if (id >= 65535)
      throw new Error('The native archive has no free member IDs.');
    memberIds[i] = id;
    files[id] = bytes;
  });
  const output = new Uint8Array(CUTSCENE_MAX_OVERLAY_SIZE);
  output.set(overlay);
  let cursor = overlay.length;
  const reserve = (size: number) => {
    cursor = align(cursor);
    const at = cursor;
    cursor += size;
    if (cursor > output.length)
      throw new Error('The custom cutscene metadata exceeds the native overlay budget.');
    return at;
  };
  let table = layout.tableOffset, count = layout.count;
  if (!previous) {
    count++;
    table = reserve(count * 20);
    output.set(overlay.subarray(layout.tableOffset, layout.tableOffset + layout.count * 20), table);
  }
  const bodySize = align(84 + compiled.commands.length + 40 + assets.groups.reduce((n, group) => n + 24 + align(group.length * 2), 0));
  const capacity = previous && bodySize <= previous.overlayCapacity ? previous.overlayCapacity : align(bodySize + 256);
  const start = previous && bodySize <= previous.overlayCapacity ? previous.overlayStart : reserve(capacity);
  output.fill(0, start, start + capacity);
  let body = start;
  const take = (size: number) => {
    const at = body;
    body = align(body + size);
    return at;
  };
  const pointer = (at: number, to: number) => writeU32(output, at, BASE + to);
  const template = readNativeSceneDefinition(overlay, BASE, 5), params = take(84);
  output.set(overlay.subarray(template.paramsOffset, template.paramsOffset + 84), params);
  writeU16(output, params, memberIds[0]);
  writeU16(output, params + 4, source.stage.zoneId);
  output.fill(0, params + 78, params + 82);
  output[params + 79] = 1; // Clear the field transition fade before authored brightness events.
  const commands = take(compiled.commands.length);
  output.set(compiled.commands, commands);
  const end = take(40);
  writeU32(output, end, 19);
  const roots = take(assets.models.length * 8);
  let resourceIndex = 1;
  assets.groups.forEach((resources, i) => {
    const bundle = take(8), group = take(8), ids = take(align(resources.length * 2));
    pointer(roots + i * 8, bundle);
    writeU16(output, roots + i * 8 + 4, 1);
    pointer(bundle, group);
    writeU32(output, bundle + 4, 1);
    pointer(group, ids);
    writeU32(output, group + 4, resources.length);
    resources.forEach((_, j) => writeU16(output, ids + j * 2, memberIds[resourceIndex++]));
  });
  if (body > start + capacity)
    throw new Error('Invalid native stage allocation.');
  const descriptor = table + sequenceId * 20;
  [params, commands, end, roots].forEach((n, i) => pointer(descriptor + i * 4, n));
  writeU32(output, descriptor + 16, assets.models.length);
  output[CUTSCENE_ID_CHECK + 4] = count;
  for (const reader of CUTSCENE_TABLE_READERS)
    pointer(reader.address - BASE, table + reader.field);
  writeU32(output, CUTSCENE_ORIGINAL_SIZE + 4, 2);
  writeU32(output, CUTSCENE_ORIGINAL_SIZE + 8, align(cursor));
  writeU32(output, CUTSCENE_ORIGINAL_SIZE + 12, table);
  writeU32(output, CUTSCENE_ORIGINAL_SIZE + 16, count);
  overlay = output.slice(0, align(cursor));
  if(source.events.some(e=>e.type==='dialogue'||e.type==='dialogue.choice'||e.type==='timeline.jump')) {
    const arm9=decompressCode(project.arm9.length?project.arm9:library.rom.arm9);
    for(const [address,hex]of [[0x0203df28,'08b5fff7ebf9fff7efff08bd'],[0x0203df4c,'08b5fff7d9f9fff7efff08bd'],[0x0203a89c,'08b50268116b814202d10120106108bd'],[0x0203a8b4,'f0b583b0061c351c0191171c02931835'],[0x0203a93c,'004b184779a70302']] as const)if(!hex.match(/../g)!.every((n,i)=>arm9[address-library.rom.arm9RamAddress+i]===parseInt(n,16)))throw new Error('The W2 input or task functions used by cutscene dialogue have changed.');
    overlay=installCutsceneDialogueRuntime(overlay);
  }
  readNativeCutsceneLayout(overlay);
  readNativeSceneDefinition(overlay, BASE, sequenceId);
  const binding: MapCutsceneBinding = { version: 1, sequenceId, memberIds, overlayStart: start, overlayCapacity: capacity, installedFingerprint: '', manifest: assets.manifest };
  if(dialogue.binding)binding.dialogue=dialogue.binding;
  binding.installedFingerprint = fingerprint(overlay, files, binding);
  // An asynchronous map read must not overwrite a more recent source or ROM edit.
  if (project.cutsceneAuthoring?.scenes[source.id] !== record || record.revision !== revision || (project.overlays[293] ?? library.overlayBytes) !== initialOverlay)
    throw new Error('The scene or ROM changed while map assets were converting. Apply again.');
  const current = new NARC(getRomFileBytes(project, library.rom, library.fileId)).save();
  if (current.length !== initialArchive.length || !current.every((n, i) => n === initialArchive[i]))
    throw new Error('The native assets changed while this scene was converting. Apply again.');
  dialogue.assertCurrent();
  archive.files = files;
  if(dialogue.bytes){replaceRomFile(project,library.rom,dialogue.fileId,dialogue.bytes);delete project.texts.messageTexts;}
  replaceRomFile(project, library.rom, library.fileId, archive.save());
  project.overlays[293] = overlay;
  project.patches ??= { dirtyOverlayIds: [] };
  if (!project.patches.dirtyOverlayIds.includes(293))
    project.patches.dirtyOverlayIds.push(293);
  library.overlayBytes = overlay;
  library.definitions = Array.from({ length: count - 1 }, (_, i) => readNativeSceneDefinition(overlay, BASE, i + 1));
  record.mapBinding = binding;
  return { binding, document: openNativeCutscene(project, library, sequenceId) };
}
