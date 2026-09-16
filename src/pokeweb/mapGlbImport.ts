import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { concatBytes, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { modelAssetHash, readStaticGlb, transformStaticMeshes, type StaticGlbNode } from "./buildingGlb";
import { assertStaticBuilding, replaceBuildingModelMember } from "./buildingImportModel";
import { invalidateBuildingLibrary, loadBuildingLibrary } from "./buildingLibraryModel";
import { getRomFileBytes } from "./fileSystemModel";
import { extractGameFreakContainer, getMap3dZoneMetadata, invalidateMap3dAssets, loadMap3dZone, type Map3dPrimitive, type Map3dSceneData } from "./map3dModel";
import { exportMap3dGlb } from "./map3dExport";
import type { MapGlbManifest } from "./mapGlbContract";
import { writeStaticNitroModel, type StaticModelMesh } from "./nitroModelWriter";
import { loadActiveRomBytes } from "./persistence";
import { createNarcStore, markDirty, type NarcStore, type ProjectState } from "./projectStore";
import { sameStaticGeometry } from "./staticMeshCompare";

type StoreName = "maps" | "exterior_building_models" | "interior_building_models";
type Archive = { name: StoreName; path: string; fileId: number; narc: NARC };
type Guard = { archive: Archive; index: number; bytes: Uint8Array };
type Patch = Guard & { after: Uint8Array };
export type MapGlbImport = {
  original: Map3dSceneData;
  converted: Map3dSceneData;
  terrainModels: number;
  buildingModels: number;
  moved: number;
  added: number;
  deleted: number;
  notes: string[];
  patches: Patch[];
  guards: Guard[];
  context: string;
};

function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const staticMeshes = (primitives: Map3dPrimitive[]): StaticModelMesh[] => primitives.map(p => ({ ...p, materialName: p.material.name }));
const hasGeometry = (primitives: Map3dPrimitive[]) => primitives.some(p => p.indices.length && p.positions.length);
function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function context(project: ProjectState, data: Map3dSceneData) {
  return stable({ header: getMap3dZoneMetadata(project, data.zoneId), areaEdits: project.map3dAreaEdits ?? {} });
}
async function sources(project: ProjectState, data: Map3dSceneData) {
  requireValue(project.session.baseRom === "BW2", "Full map import currently supports Black 2 and White 2.");
  const bytes = project.originalRomBytes ?? await loadActiveRomBytes();
  requireValue(bytes, "Reload the ROM before importing a map.");
  const rom = new NintendoDSRom(bytes);
  const kind: "exterior" | "interior" = data.areaMetadata.isExterior ? "exterior" : "interior";
  const archive = (name: StoreName, path: string): Archive => {
    const fileId = rom.fileId(path);
    return { name, path, fileId, narc: new NARC(getRomFileBytes(project, rom, fileId)) };
  };
  const maps = archive("maps", "a/0/0/8");
  const buildings = archive(`${kind}_building_models`, kind === "exterior" ? "a/2/2/5" : "a/2/2/6");
  const library = await loadBuildingLibrary(project);
  const entries = library.entries.filter(e => e.kind === kind && e.bundleId === data.buildingsId);
  return { rom, maps, buildings, library, entries, kind };
}
type Sources = Awaited<ReturnType<typeof sources>>;
function buildingEntry(source: Sources, uid: number) {
  const matches = source.entries.filter(e => e.uid === uid);
  requireValue(matches.length === 1, `Building UID ${uid} has an ambiguous or missing resource in this bundle.`);
  return matches[0];
}

async function manifest(source: Sources, data: Map3dSceneData): Promise<MapGlbManifest> {
  const chunks = await Promise.all([...new Set(data.chunks.map(c => c.chunkId))].map(async id => {
    const bytes = source.maps.narc.files[id]; requireValue(bytes, `Missing chunk ${id}.`);
    return { id, hash: await modelAssetHash(bytes) };
  }));
  const bundle = source.buildings.narc.files[data.buildingsId];
  requireValue(bundle, "The map's building bundle is missing.");
  return { version: 1, game: `${source.rom.idCode}:${source.rom.data[0x1e]}`, zoneId: data.zoneId, season: data.season,
    matrixId: data.matrixId, areaId: data.areaId, areaMetadata: stable(data.areaMetadata), bundleKind: source.kind,
    bundleId: data.buildingsId, chunks, bundleHash: await modelAssetHash(bundle),
    terrain: data.chunks.map(c => ({ id: `terrain:${c.matrixX}:${c.matrixY}:${c.chunkId}`, kind: "terrain", exported: hasGeometry(c.primitives),
      chunkId: c.chunkId, sourceChunkId: c.sourceChunkId, matrixX: c.matrixX, matrixY: c.matrixY })),
    buildings: data.buildings.map(b => {
      requireValue(b.chunkOrigin && Number.isInteger(b.placementIndex), "Reopen this map before exporting import metadata.");
      const entry = buildingEntry(source, b.uid);
      return { id: `building:${b.chunkOrigin.matrixX}:${b.chunkOrigin.matrixY}:${b.chunkId}:${b.placementIndex}`, kind: "building",
        exported: hasGeometry(b.primitives), chunkId: b.chunkId, sourceChunkId: b.sourceChunkId,
        matrixX: b.chunkOrigin.matrixX, matrixY: b.chunkOrigin.matrixY, placementIndex: b.placementIndex, uid: b.uid, resourceIndex: entry.resourceIndex };
    }),
  };
}

export async function exportMapGlbForImport(project: ProjectState, data: Map3dSceneData) {
  return exportMap3dGlb(data, { mapManifest: await manifest(await sources(project, data), data) });
}

function replaceMember(container: Uint8Array, member: number, replacement: Uint8Array): Uint8Array {
  const files = extractGameFreakContainer(container).files;
  requireValue(files[member], "Missing native container member.");
  const start = readU32(container, 4 + member * 4), end = readU32(container, 8 + member * 4);
  requireValue(start >= 4 + (files.length + 1) * 4, "Container member overlaps its header.");
  const delta = replacement.length - (end - start);
  const out = concatBytes([container.subarray(0, start), replacement, container.subarray(end)]);
  for (let i = member + 1; i <= files.length; i++) writeU32(out, 4 + i * 4, readU32(container, 4 + i * 4) + delta);
  return out;
}

function placementRecord(x: number, y: number, z: number, yaw: number, uid: number): Uint8Array {
  requireValue(Number.isInteger(uid) && uid >= 0 && uid < 512, "Building UID exceeds the BW2 range (0–511).");
  const record = new Uint8Array(16);
  [x, y, z].forEach((value, i) => {
    const fixed = Math.round(value * 4096);
    requireValue(Number.isSafeInteger(fixed) && fixed >= -2147483648 && fixed <= 2147483647, "Building position exceeds the native fixed-point range.");
    writeU32(record, i * 4, fixed >>> 0);
  });
  writeU16(record, 12, Math.round(((yaw % 360 + 360) % 360) * 65536 / 360) % 65536);
  record[14] = uid >>> 8; record[15] = uid & 255;
  return record;
}

function cloneStore(store: NarcStore): NarcStore {
  return { ...store, rawFiles: store.rawFiles.slice(), records: new Map(store.records), dirty: new Set(store.dirty) };
}
function patchedStores(project: ProjectState, patches: Patch[], undo: boolean) {
  const stores = new Map<StoreName, NarcStore>();
  for (const patch of patches) {
    const a = patch.archive;
    if (!stores.has(a.name)) {
      const current = project.narcs[a.name];
      requireValue(!current || (current.fileId === a.fileId && current.sourcePath === a.path), "Conflicting native archive store.");
      stores.set(a.name, current ? cloneStore(current) : createNarcStore(a.name, a.path, a.fileId, a.narc));
    }
    const store = stores.get(a.name)!;
    store.rawFiles[patch.index] = (undo ? patch.bytes : patch.after).slice();
    store.records.delete(patch.index);
  }
  return stores;
}

/** Prepare every resource before committing any project edits. */
export async function prepareMapGlbImport(project: ProjectState, data: Map3dSceneData, bytes: Uint8Array): Promise<MapGlbImport> {
  const imported = readStaticGlb(bytes);
  const inputManifest = imported.metadata.mapImport as MapGlbManifest | undefined;
  requireValue(inputManifest?.version === 1, "Export this full map again from Pokeweb and enable Include → Custom Properties in Blender. Older map GLBs cannot be imported.");
  requireValue(inputManifest.zoneId === data.zoneId && inputManifest.season === data.season, "Load the same map and season that this GLB was exported from.");
  const source = await sources(project, data), baseline = await manifest(source, data);
  if (stable(inputManifest) !== stable(baseline)) {
    const chunk = baseline.chunks.find(c => inputManifest.chunks?.find(old => old.id === c.id)?.hash !== c.hash);
    const difference = chunk ? `chunk ${chunk.id} geometry or placements` : inputManifest.bundleHash !== baseline.bundleHash
      ? `${baseline.bundleKind} building bundle ${baseline.bundleId}`
      : Object.keys(baseline).filter(k => stable((baseline as any)[k]) !== stable((inputManifest as any)[k])).join(", ");
    throw new Error(`Map resources or metadata changed since this GLB was exported (${difference}), or it belongs to another ROM. Export the current map again.`);
  }
  const refs = new Map([...baseline.terrain, ...baseline.buildings].filter(r => r.exported).map(r => [r.id, r]));
  const objects = new Map<string, StaticGlbNode[]>();
  function index(node: StaticGlbNode, owner?: string) {
    const id = node.extras.pokewebMapObject;
    if (id !== undefined) {
      requireValue(typeof id === "string" && refs.has(id) && !owner, "Unknown or nested map resource parent. Keep the exported chunk/building parents intact.");
      owner = id; const group = objects.get(id) ?? []; group.push(node); objects.set(id, group);
    }
    requireValue(owner || !node.meshes.length, "A mesh has no map resource parent. Add geometry inside an exported chunk or building parent.");
    node.children.forEach(child => index(child, owner));
  }
  imported.nodes.forEach(node => index(node));
  const native = new Matrix4().makeTranslation(...imported.metadata.sourceOrigin as [number, number, number]).scale(new Vector3().setScalar(16));
  const localMeshes = (node: StaticGlbNode, inversePlacement: Matrix4) => {
    const meshes: StaticModelMesh[] = [];
    const visit = (child: StaticGlbNode) => {
      meshes.push(...transformStaticMeshes(child.meshes, inversePlacement.clone().multiply(native).multiply(child.world)));
      child.children.forEach(visit);
    };
    visit(node);
    requireValue(meshes.length, "A map resource has no meshes. Delete the entire building parent to remove a placement; terrain chunks cannot be deleted.");
    return meshes;
  };
  const guards: Guard[] = baseline.chunks.map(c => ({ archive: source.maps, index: c.id, bytes: source.maps.narc.files[c.id].slice() }));
  guards.push({ archive: source.buildings, index: data.buildingsId, bytes: source.buildings.narc.files[data.buildingsId].slice() });
  const chunkUpdates = new Map<number, Uint8Array>();
  const chunkBytes = (id: number) => chunkUpdates.get(id) ?? source.maps.narc.files[id];
  const terrainEdits = new Map<number, StaticModelMesh[]>(), buildingEdits = new Map<number, StaticModelMesh[]>();
  const result: MapGlbImport = { original: data, converted: data, terrainModels: 0, buildingModels: 0, moved: 0, added: 0, deleted: 0,
    notes: [], guards, patches: [], context: context(project, data) };
  function addGeometry(edits: Map<number, StaticModelMesh[]>, id: number, original: StaticModelMesh[], meshes: StaticModelMesh[], label: string) {
    if (sameStaticGeometry(original, meshes)) return;
    const previous = edits.get(id);
    requireValue(!previous || (sameStaticGeometry(previous, meshes) && sameStaticGeometry(meshes, previous)), `${label} has conflicting mesh edits in different copies. It is a shared resource; use one consistent edit.`);
    edits.set(id, meshes);
  }
  for (const [i, ref] of baseline.terrain.entries()) {
    if (!ref.exported) continue;
    const nodes = objects.get(ref.id);
    requireValue(nodes?.length === 1, `Keep exactly one parent for terrain chunk ${ref.chunkId} at cell ${ref.matrixX}, ${ref.matrixY}.`);
    const chunk = data.chunks[i];
    const inverse = new Matrix4().makeTranslation(-chunk.worldX, -(chunk.worldY ?? 0), -chunk.worldZ);
    addGeometry(terrainEdits, chunk.chunkId, staticMeshes(chunk.primitives), localMeshes(nodes[0], inverse), `Terrain chunk ${chunk.chunkId}`);
  }

  type Placement = { chunkId: number; record: Uint8Array };
  const changes = new Map<string, Placement | null>(), additions: Placement[] = [];
  const repeats = new Set(data.chunks.filter((c, i) => data.chunks.findIndex(other => other.chunkId === c.chunkId) !== i).map(c => c.chunkId));
  for (const [i, ref] of baseline.buildings.entries()) {
    if (!ref.exported) continue;
    const building = data.buildings[i];
    const nodes = objects.get(ref.id) ?? [];
    const owner = data.chunks.find(c => c.matrixX === ref.matrixX && c.matrixY === ref.matrixY)!;
    const originalRecord = placementRecord(building.worldX - owner.worldX, building.worldY, owner.worldZ - building.worldZ, building.rotationY, building.uid);
    const key = `${ref.chunkId}:${ref.placementIndex}`;
    if (!nodes.length) {
      requireValue(!repeats.has(ref.chunkId), "Placement edits to a chunk reused in multiple map cells are not supported yet.");
      changes.set(key, null); result.deleted++; continue;
    }
    // A Blender duplicate inherits custom properties. The copy nearest the original keeps its identity.
    nodes.sort((a, b) => {
      const distance = (n: StaticGlbNode) => new Vector3().setFromMatrixPosition(native.clone().multiply(n.world)).distanceToSquared(new Vector3(building.worldX, building.worldY, building.worldZ));
      return distance(a) - distance(b);
    });
    for (const [copy, node] of nodes.entries()) {
      const world = native.clone().multiply(node.world);
      const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3(); world.decompose(position, rotation, scale);
      let yaw = new Euler().setFromQuaternion(rotation, "YXZ").y * 180 / Math.PI;
      const angleDifference = ((yaw - building.rotationY + 540) % 360) - 180;
      if (Math.abs(angleDifference) < 0.001) yaw = building.rotationY;
      // Suppress floating-point drift introduced by Blender's transform decomposition.
      ["x", "y", "z"].forEach((axis, a) => { const target = [building.worldX, building.worldY, building.worldZ][a]; if (Math.abs(position[axis as "x"] - target) < 0.002) position[axis as "x"] = target; });
      const transform = new Matrix4().makeTranslation(position.x, position.y, position.z).multiply(new Matrix4().makeRotationY(yaw * Math.PI / 180));
      const meshes = localMeshes(node, transform.clone().invert());
      addGeometry(buildingEdits, building.uid, staticMeshes(building.primitives), meshes, `Building UID ${building.uid}`);
      const moved = position.distanceTo(new Vector3(building.worldX, building.worldY, building.worldZ)) > 0.002;
      const destination = moved || copy > 0 ? data.chunks.find(c => position.x >= c.worldX - data.chunkSpan / 2 && position.x < c.worldX + data.chunkSpan / 2
        && position.z >= c.worldZ - data.chunkSpan / 2 && position.z < c.worldZ + data.chunkSpan / 2) : owner;
      requireValue(destination, `Building UID ${building.uid} moved outside the loaded map. Keep placements inside its terrain cells.`);
      const placement = { chunkId: destination.chunkId, record: placementRecord(position.x - destination.worldX, position.y, destination.worldZ - position.z, yaw, building.uid) };
      if (copy > 0 || destination.chunkId !== ref.chunkId || !sameBytes(originalRecord, placement.record)) {
        requireValue(!repeats.has(ref.chunkId) && !repeats.has(destination.chunkId), "Placement edits to a chunk reused in multiple map cells are not supported yet.");
        if (copy > 0) { additions.push(placement); result.added++; }
        else { changes.set(key, placement); result.moved++; }
      }
    }
  }

  for (const [id, meshes] of terrainEdits) {
    try {
      const bytes = chunkBytes(id), model = extractGameFreakContainer(bytes).files[0];
      chunkUpdates.set(id, replaceBuildingModelMember(bytes, 0, writeStaticNitroModel(model, meshes)));
    } catch (error) { throw new Error(`Terrain chunk ${id}: ${error instanceof Error ? error.message : error}`); }
  }
  result.terrainModels = terrainEdits.size;
  let bundle = source.buildings.narc.files[data.buildingsId];
  for (const [uid, meshes] of buildingEdits) {
    const entry = buildingEntry(source, uid), asset = source.library.load(entry.id);
    try {
      assertStaticBuilding(asset);
      const memberCount = extractGameFreakContainer(bundle).files.length;
      requireValue(memberCount % 2 === 0, "Unpaired building bundle members.");
      bundle = replaceBuildingModelMember(bundle, memberCount / 2 + entry.resourceIndex, writeStaticNitroModel(asset.modelBytes, meshes));
    } catch (error) { throw new Error(`Building UID ${uid}: ${error instanceof Error ? error.message : error}`); }
    result.notes.push(`UID ${uid}: replaces the shared model for all placements using ${source.kind} bundle ${data.buildingsId}, including other maps that use this bundle.`);
  }
  result.buildingModels = buildingEdits.size;
  if (terrainEdits.size) result.notes.push("Terrain replacements also affect other maps or seasons that reference these same chunk resources.");
  for (const [key, placement] of changes) if (placement && placement.chunkId !== Number(key.split(":")[0])) additions.push(placement);
  for (const id of new Set([...data.chunks.map(c => c.chunkId)])) {
    const bytes = chunkBytes(id), member = extractGameFreakContainer(bytes).files[2];
    if (!member) { requireValue(!additions.some(p => p.chunkId === id), `Chunk ${id} has no building placement table.`); continue; }
    const count = readU32(member, 0);
    requireValue(4 + count * 16 <= member.length, `Chunk ${id} has a truncated placement table.`);
    const records: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
      const key = `${id}:${i}`;
      if (!changes.has(key)) records.push(member.slice(4 + i * 16, 20 + i * 16));
      else { const replacement = changes.get(key); if (replacement?.chunkId === id) records.push(replacement.record); }
    }
    records.push(...additions.filter(p => p.chunkId === id).map(p => p.record));
    const replacement = concatBytes([new Uint8Array(4), ...records, member.subarray(4 + count * 16)]);
    writeU32(replacement, 0, records.length);
    if (sameBytes(member, replacement)) continue;
    // A referenced subordinate model consumes an additional runtime object slot.
    let slots = 0;
    for (const record of records) {
      const uid = record[14] * 256 + record[15];
      const entry = source.entries.find(e => e.uid === uid);
      slots += 1 + (entry && readU16(entry.metadataBytes, 4) < 512 ? 1 : 0);
    }
    requireValue(slots <= 32, `Chunk ${id} needs ${slots} building slots; BW2 supports 32. Remove buildings or move them to another chunk.`);
    chunkUpdates.set(id, replaceMember(bytes, 2, replacement));
  }
  for (const guard of guards) {
    const after = guard.archive.name === "maps" ? chunkUpdates.get(guard.index) : bundle;
    if (after && !sameBytes(guard.bytes, after)) result.patches.push({ ...guard, after });
  }
  if (result.patches.length) {
    const previewProject = { ...project, narcs: { ...project.narcs } };
    for (const [name, store] of patchedStores(project, result.patches, false)) previewProject.narcs[name] = store;
    result.converted = await loadMap3dZone(previewProject, data.zoneId, { season: data.season });
    requireValue(result.converted.chunks.length === data.chunks.length, "Converted map failed terrain validation.");
    requireValue(result.converted.buildings.length === data.buildings.length + result.added - result.deleted, "Converted map failed building placement validation.");
    const newWarnings = result.converted.warnings.filter(w => !data.warnings.includes(w));
    requireValue(!newWarnings.length, `Converted map failed validation: ${newWarnings.join("; ")}`);
  }
  return result;
}

export async function applyMapGlbImport(project: ProjectState, result: MapGlbImport, undo = false): Promise<void> {
  requireValue(project.session.baseRom === "BW2", "Full map import currently supports BW2.");
  const bytes = project.originalRomBytes ?? await loadActiveRomBytes();
  requireValue(bytes, "Reload the ROM before applying this map import.");
  const rom = new NintendoDSRom(bytes), archives = new Map<string, NARC>();
  requireValue(context(project, result.original) === result.context, "Map metadata changed during review. Import again before applying.");
  // No awaits after validation starts: all new stores are prepared before any project mutation.
  for (const guard of result.guards) {
    const a = guard.archive;
    if (!archives.has(a.path)) archives.set(a.path, new NARC(getRomFileBytes(project, rom, a.fileId)));
    const current = archives.get(a.path)!.files[guard.index];
    const expected = undo ? result.patches.find(p => p.archive.name === a.name && p.index === guard.index)?.after ?? guard.bytes : guard.bytes;
    requireValue(current && sameBytes(current, expected), "Map resources changed during review. Import again before applying or undoing.");
  }
  const stores = patchedStores(project, result.patches, undo);
  for (const [name, store] of stores) project.narcs[name] = store;
  for (const patch of result.patches) markDirty(project, patch.archive.name, patch.index);
  if (result.patches.length) recordGenericChange(project, "maps3d", `${undo ? "Undid" : "Applied"} GLB map import: ${result.terrainModels} terrain models, ${result.buildingModels} building models, ${result.moved} moves, ${result.added} additions, ${result.deleted} deletions.`, result.original.label);
  invalidateBuildingLibrary(project); invalidateMap3dAssets();
}
