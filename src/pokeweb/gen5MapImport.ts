import { readAscii, readU16, readU32, writeU32 } from "../nds/binary";
import { addFilePath, cloneFolder } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import type { NarcName } from "./constants";
import { recordGenericChange } from "./actionChangelog";
import { invalidateBuildingLibrary, loadBuildingLibrary } from "./buildingLibraryModel";
import { getRomFileBytes } from "./fileSystemModel";
import { equalMapBytes, mergeGen5MapTextures, readGen5MapBin, validateGen5Permissions, validateMapNitro } from "./gen5MapImportFormats";
import { GEN5_MATRIX_EMPTY, materializeGen5MatrixFile, parseGen5MatrixFile } from "./gen5MatrixModel";
import { parseHeaders } from "./headerModel";
import { buildModelPrimitives, invalidateMap3dAssets, loadMap3dZone, packGameFreakContainer, parseAreaHeader, readNitroResources, type Map3dSceneData } from "./map3dModel";
import { getMatrixBytes, getMatrixSnapshot, loadMatrixEditorData, type MatrixSnapshot } from "./matrixModel";
import { ensure, materialRecords, readDictionary, writeNitroFile } from "./nitroResourceWriter";
import { loadActiveRomBytes } from "./persistence";
import { materializeProjectEdits } from "./projectMaterialize";
import { createNarcStore, markDirty, type NarcStore, type ProjectState } from "./projectStore";
import { getMapReplacementBytes, MATRIX_SEASONS, parseMapReplacementFile, replacementRules, resolveSeasonalMatrix, seasonalAreaId, type MatrixSeason } from "./seasonalMatrixModel";

export type Gen5MapImportInput = {
  /** PER slope/distance indices are game-specific; cross-family conversion is unsupported. */
  game: "BW" | "BW2";
  bin?: Uint8Array;
  model?: Uint8Array;
  textures?: Uint8Array;
  permissions?: Uint8Array;
  secondaryPermissions?: Uint8Array;
};
export type Gen5MapImportTarget = { matrixId: number; x: number; y: number; headerId: number; season: MatrixSeason };
type StoreChange = { name: NarcName; before?: NarcStore; after: NarcStore };
type Guard = { name: NarcName; fileId: number; path: string; bytes: Uint8Array[]; filenames: string };
export type Gen5MapImport = {
  target: Gen5MapImportTarget;
  original: Map3dSceneData;
  converted: Map3dSceneData;
  newCell: boolean;
  mapId: number;
  importedTextures: number;
  components: string[];
  notes: string[];
  changes: StoreChange[];
  guards: Guard[];
  context: string;
  applied?: boolean;
};

const guardedNames: NarcName[] = ["maps", "matrix", "map_replace", "headers", "map_textures", "exterior_building_models", "interior_building_models", "exterior_building_textures", "interior_building_textures"];
function cloneStore(store: NarcStore, copyBytes = false): NarcStore {
  return { ...store, rawFiles: store.rawFiles.map(b => copyBytes ? b.slice() : b), filenames: store.filenames ? cloneFolder(store.filenames) : undefined,
    records: new Map([...store.records].map(([id, r]) => [id, { ...r, raw: r.raw ? { ...r.raw } : undefined, readable: r.readable ? { ...r.readable } : undefined }])), dirty: new Set(store.dirty) };
}
function detached(project: ProjectState): ProjectState {
  return { ...project, session: { ...project.session, fileIds: { ...project.session.fileIds } },
    narcs: Object.fromEntries(Object.entries(project.narcs).map(([name, s]) => [name, s ? cloneStore(s) : s])),
    headers: project.headers ? structuredClone(project.headers) : undefined,
    actionChangelog: project.actionChangelog ? structuredClone(project.actionChangelog) : undefined };
}
function context(project: ProjectState) {
  return JSON.stringify({ game: project.session.baseRom, rom: project.romInfo, headers: project.headers?.rows,
    areas: project.map3dAreaEdits, files: project.fileSystem });
}
function put(project: ProjectState, name: NarcName, index: number, bytes: Uint8Array) {
  const store = project.narcs[name]!;
  store.rawFiles[index] = bytes; store.records.delete(index); store.fileCount = store.rawFiles.length;
  markDirty(project, name, index);
}
function appendMap(project: ProjectState, bytes: Uint8Array): number {
  const store = project.narcs.maps!, id = store.rawFiles.length;
  ensure(id < 65535, "The map archive has reached the seasonal ID limit (65535 entries).");
  for (let matrix = 0; matrix < project.narcs.matrix!.fileCount; matrix++) ensure(!getMatrixSnapshot(project, matrix).cells.some(c => c.mapId === id), "The next map ID already has a missing-resource reference. Repair that reference before adding chunks.");
  ensure(!replacementRules(getMapReplacementBytes(project)).some(r => r.patchType === 0 && r.values.slice(0, 4).includes(id)), "A seasonal rule already references the next missing map ID. Repair it before adding chunks.");
  if (store.filenames && (store.filenames.files.length || store.filenames.folders.length)) {
    let directory = `import_${id}`;
    while (store.filenames.folders.some(([name]) => name === directory)) directory += "_";
    store.filenames = addFilePath(store.filenames, `${directory}/map.bin`, id);
  }
  put(project, "maps", id, bytes); return id;
}
function cell(snapshot: MatrixSnapshot, target: Gen5MapImportTarget) {
  ensure(Number.isSafeInteger(target.x) && Number.isSafeInteger(target.y) && target.x >= 0 && target.y >= 0 && target.x < snapshot.width && target.y < snapshot.height,
    `Cell ${target.x}, ${target.y} is outside matrix ${snapshot.id}. Resize it in the matrix editor first.`);
  ensure(snapshot.editable, "This matrix exceeds the 900-cell editor limit.");
  return snapshot.cells[target.y * snapshot.width + target.x];
}
function assign(project: ProjectState, matrixId: number, target: Gen5MapImportTarget, mapId: number, header = false) {
  const bytes = getMatrixBytes(project, matrixId), raw = parseGen5MatrixFile(bytes), index = target.y * raw.width + target.x;
  raw[`map_${index}`] = mapId;
  if (header && raw.matrix_flags) raw[`header_${index}`] = target.headerId;
  put(project, "matrix", matrixId, materializeGen5MatrixFile(raw, bytes));
}

/** Mutates only the caller's detached draft. Exported to test routing independently of graphics. */
export function stageGen5MapDestination(project: ProjectState, target: Gen5MapImportTarget, bytes: Uint8Array): { mapId: number; newCell: boolean } {
  ensure(MATRIX_SEASONS.includes(target.season), "Choose a valid season.");
  const snapshots = MATRIX_SEASONS.map(season => resolveSeasonalMatrix(project, target.matrixId, season));
  const slot = MATRIX_SEASONS.indexOf(target.season), selected = snapshots[slot], current = cell(selected, target);
  const newCell = current.mapId === GEN5_MATRIX_EMPTY;
  if (!newCell && project.narcs.maps?.rawFiles[current.mapId] && equalMapBytes(project.narcs.maps.rawFiles[current.mapId], bytes)) return { mapId: current.mapId, newCell: false };
  const affectedMatrices = new Set(newCell ? snapshots.map(s => s.id) : [selected.id]);
  const rules = replacementRules(getMapReplacementBytes(project));
  // Non-seasonal two-way conditions leave the later value slots zero-filled.
  ensure(!rules.some(rule => rule.condition !== 0 && rule.patchType === 1 && rule.values.slice(0, 2).some(id => affectedMatrices.has(id))),
    "This matrix has conditional seasonal routing. Resolve its event-dependent assignments before importing.");
  for (const rule of rules) if (affectedMatrices.has(rule.matrixId) && (rule.condition !== 0 || ![0, 1].includes(rule.patchType))) {
    const base = cell(getMatrixSnapshot(project, selected.id), target).mapId;
    ensure(rule.patchType === 0 && rule.values[0] !== base && rule.values[0] !== current.mapId,
      "This cell has conditional map routing. Resolve its event-dependent assignments before importing.");
  }
  // Audit every root that can load a changed matrix, including whole-matrix substitutions.
  const baselines: Array<{ root: number; season: MatrixSeason; snapshot: MatrixSnapshot }> = [];
  for (let root = 0; root < project.narcs.matrix!.fileCount; root++) for (const season of MATRIX_SEASONS) {
    const snapshot = resolveSeasonalMatrix(project, root, season);
    if (affectedMatrices.has(snapshot.id)) baselines.push({ root, season, snapshot });
  }
  const originalMaps = project.narcs.maps!.rawFiles.slice();
  let mapId: number;
  if (newCell) {
    for (const snapshot of snapshots) ensure(cell(snapshot, target).mapId === GEN5_MATRIX_EMPTY, "The destination must be empty in every season. Choose a different cell or edit its seasonal matrices first.");
    mapId = appendMap(project, bytes);
    for (const id of affectedMatrices) assign(project, id, target, mapId, true);
  } else {
    const old = originalMaps[current.mapId]; ensure(old, "The destination map resource is missing.");
    if (equalMapBytes(old, bytes)) return { mapId: current.mapId, newCell: false };
    const base = cell(getMatrixSnapshot(project, selected.id), target).mapId;
    ensure(originalMaps[base], "The base map is missing; repair the seasonal assignment before importing.");
    const local = MATRIX_SEASONS.map(season => resolveSeasonalMatrix(project, selected.id, season));
    const anchor = appendMap(project, slot === 0 ? bytes : originalMaps[base].slice());
    mapId = slot === 0 ? anchor : appendMap(project, bytes);
    assign(project, selected.id, target, anchor);
    const values = local.map((snapshot, i) => i === 0 ? anchor : snapshot.id === selected.id ? cell(snapshot, target).mapId : anchor);
    values[slot] = mapId;
    ensure(values.every(value => value < 65535), "This seasonal assignment cannot represent an empty or out-of-range map.");
    const oldRules = getMapReplacementBytes(project), extra = new Uint8Array(16);
    extra[0] = selected.id & 255; extra[1] = selected.id >>> 8;
    values.forEach((value, i) => { extra[4 + i * 2] = value & 255; extra[5 + i * 2] = value >>> 8; }); extra[14] = 255; extra[15] = 255;
    const next = new Uint8Array(oldRules.length + 16); next.set(oldRules); next.set(extra, oldRules.length);
    parseMapReplacementFile(next); put(project, "map_replace", 0, next);
  }
  for (const { root, season, snapshot } of baselines) {
    const after = resolveSeasonalMatrix(project, root, season);
    ensure(after.id === snapshot.id && after.width === snapshot.width && after.height === snapshot.height, "Import changed unrelated seasonal matrix routing.");
    for (const beforeCell of snapshot.cells) {
      const next = after.cells[beforeCell.index], intended = beforeCell.x === target.x && beforeCell.y === target.y && (newCell || season === target.season);
      if (intended) ensure(next.mapId === mapId, "Existing seasonal rules conflict with this import.");
      else ensure(next.headerId === beforeCell.headerId && (next.mapId === beforeCell.mapId || (originalMaps[beforeCell.mapId] && equalMapBytes(project.narcs.maps!.rawFiles[next.mapId], originalMaps[beforeCell.mapId]))), "Import would change another cell or season. Resolve conflicting seasonal rules first.");
    }
  }
  return { mapId, newCell };
}

export async function prepareGen5MapImport(project: ProjectState, input: Gen5MapImportInput, target: Gen5MapImportTarget): Promise<Gen5MapImport> {
  ensure((project.session.baseRom === "BW" || project.session.baseRom === "BW2") && input.game === project.session.baseRom, "Import exports made for the same game family: BW or BW2.");
  ensure(input.bin || input.model || input.textures || input.permissions || input.secondaryPermissions, "Choose at least one map component.");
  ensure(!input.bin || (!input.model && !input.permissions && !input.secondaryPermissions), "Use either a complete BIN or separate model/collision files.");
  const source = project.originalRomBytes ?? await loadActiveRomBytes(); ensure(source, "Reconnect the project's source ROM before importing.");
  const rom = new NintendoDSRom(source, { fileData: "view" }), draft = detached(project);
  draft.originalRomBytes = source;
  materializeProjectEdits(draft);
  await loadMatrixEditorData(draft, { seasons: true });
  draft.headers ??= parseHeaders(draft);
  const header = Object.values(draft.headers.rows).find(h => h.index === target.headerId);
  ensure(header && Number(header.matrix_id) === target.matrixId, "Choose an existing graphics header linked to the destination matrix.");
  const selected = resolveSeasonalMatrix(draft, target.matrixId, target.season), destination = cell(selected, target);
  ensure(destination.headerId === undefined || destination.headerId === GEN5_MATRIX_EMPTY || destination.headerId === target.headerId || destination.headerId === Number(header.parent_map_id), "Choose the destination cell's existing header.");
  const newCell = destination.mapId === GEN5_MATRIX_EMPTY;
  const original = await loadMap3dZone(draft, target.headerId, { season: target.season, cache: false });
  const baseline = Object.fromEntries(guardedNames.map(name => [name, draft.narcs[name] ? cloneStore(draft.narcs[name]!, true) : undefined])) as Partial<Record<NarcName, NarcStore>>;
  const guards: Guard[] = guardedNames.filter(name => draft.narcs[name]).map(name => {
    const store = draft.narcs[name]!; return { name, fileId: store.fileId, path: store.sourcePath, bytes: store.rawFiles.map(b => b.slice()), filenames: JSON.stringify(store.filenames) };
  });
  let native = input.bin ? readGen5MapBin(input.bin) : !newCell ? readGen5MapBin(draft.narcs.maps!.rawFiles[destination.mapId]) : undefined;
  if (!native) {
    ensure(input.model && input.permissions, "A new chunk requires an NSBMD model and primary PER collision file.");
    native = { signature: "WB", files: [input.model, input.permissions, new Uint8Array(4)], placements: 2 };
  }
  const files: Uint8Array[] = native.files.map(b => b.slice()), components: string[] = [], notes: string[] = [];
  if (input.bin) {
    components.push("Terrain model", "Collision and walking heights", "Building placements");
    if (native.placements === 3) components.push("Second collision layer");
  }
  if (input.model) { files[0] = input.model.slice(); components.push("Terrain model"); }
  if (input.permissions) { validateGen5Permissions(input.permissions); files[1] = input.permissions.slice(); components.push("Collision and walking heights"); }
  if (input.secondaryPermissions) {
    validateGen5Permissions(input.secondaryPermissions);
    if (native.placements === 2) { files.splice(2, 0, input.secondaryPermissions.slice()); native.placements = 3; }
    else files[2] = input.secondaryPermissions.slice();
    components.push("Second collision layer");
  }
  const blocks = validateMapNitro(files[0], "BMD0"), embedded = blocks.some(b => readAscii(b, 0, 4) === "TEX0");
  if (input.textures) validateMapNitro(input.textures, "BTX0");
  const textureSource = input.textures ?? (embedded ? files[0] : undefined);
  let model = embedded ? writeNitroFile(files[0], blocks.filter(b => readAscii(b, 0, 4) !== "TEX0")) : files[0];
  const mdl = validateMapNitro(model, "BMD0").find(b => readAscii(b, 0, 4) === "MDL0")!, dictionary = readDictionary(mdl, 8);
  ensure(dictionary.length === 1, "Map chunks require exactly one native model.");
  const at = readU32(dictionary[0].data, 0); ensure(at + 64 <= mdl.length, "Truncated model information.");
  ensure(readU16(mdl, at + 38) <= 2048 && readU16(mdl, at + 36) <= 6144, "The model exceeds the DS geometry budget (2048 polygons / 6144 vertices).");
  const textureId = rom.fileId("a/0/1/4");
  draft.narcs.map_textures ??= createNarcStore("map_textures", "a/0/1/4", textureId, new NARC(getRomFileBytes(draft, rom, textureId)));
  if (!baseline.map_textures) {
    baseline.map_textures = cloneStore(draft.narcs.map_textures, true);
    guards.push({ name: "map_textures", fileId: textureId, path: "a/0/1/4", bytes: draft.narcs.map_textures.rawFiles.map(b => b.slice()), filenames: JSON.stringify(draft.narcs.map_textures.filenames) });
  }
  const textureIds = new Set<number>(), seasons = newCell ? MATRIX_SEASONS : [target.season];
  const areaTable = getRomFileBytes(draft, rom, rom.fileId("a/0/1/3"));
  for (const season of seasons) {
    const areaId = seasonalAreaId(input.game, Number(header.texture_id), season), area = draft.map3dAreaEdits?.[String(areaId)] ?? parseAreaHeader(areaTable, areaId);
    textureIds.add(area.texturesId);
  }
  let importedTextures = 0, compiled: Uint8Array | undefined;
  for (const id of textureIds) {
    const current = draft.narcs.map_textures.rawFiles[id]; ensure(current, `Texture pack ${id} is missing.`);
    let nextModel = model;
    if (textureSource) {
      const merged = mergeGen5MapTextures(current, textureSource, model, newCell);
      nextModel = merged.model; importedTextures += merged.added;
      if (!equalMapBytes(merged.textures, current)) put(draft, "map_textures", id, merged.textures);
    }
    ensure(!compiled || equalMapBytes(compiled, nextModel), "Seasonal texture bindings conflict. Use compatible graphics resources for this new cell."); compiled = nextModel;
    const resources = readNitroResources(nextModel), external = readNitroResources(draft.narcs.map_textures.rawFiles[id]);
    resources.textures.push(...external.textures); resources.palettes.push(...external.palettes);
    for (const material of materialRecords(nextModel)) {
      ensure(!material.textureName || resources.textures.some(t => t.name === material.textureName), `Missing texture ${material.textureName}; supply an NSBTX file.`);
      ensure(!material.paletteName || resources.palettes.some(p => p.name === material.paletteName), `Missing palette ${material.paletteName}; supply an NSBTX file.`);
    }
    const warnings: string[] = [], primitives = buildModelPrimitives(resources, warnings);
    ensure(primitives.some(p => p.indices.length) && !warnings.length, `Imported model cannot be previewed: ${warnings.join("; ") || "no geometry"}.`);
  }
  if (textureSource) components.push(input.textures ? "NSBTX textures" : "Embedded textures");
  files[0] = compiled ?? model;
  let packed = packGameFreakContainer(native.signature, files);
  const template = input.bin ?? (!newCell ? draft.narcs.maps!.rawFiles[destination.mapId] : undefined);
  if (template) {
    const oldHeader = 4 + (readU16(template, 2) + 1) * 4, prefix = template.subarray(oldHeader, readU32(template, 4));
    if (prefix.length) {
      const headerLength = 4 + (files.length + 1) * 4, withPrefix = new Uint8Array(packed.length + prefix.length);
      withPrefix.set(packed.subarray(0, headerLength)); withPrefix.set(prefix, headerLength); withPrefix.set(packed.subarray(headerLength), headerLength + prefix.length);
      for (let i = 0; i <= files.length; i++) writeU32(withPrefix, 4 + i * 4, readU32(packed, 4 + i * 4) + prefix.length);
      packed = withPrefix;
    }
  }
  const parsed = readGen5MapBin(packed), table = files[parsed.placements];
  const count = readU32(table, 0);
  if (count) {
    const library = await loadBuildingLibrary(draft);
    for (const season of seasons) {
      const areaId = seasonalAreaId(input.game, Number(header.texture_id), season), area = draft.map3dAreaEdits?.[String(areaId)] ?? parseAreaHeader(areaTable, areaId);
      const bundleId = input.game === "BW2" ? area.buildingsId : areaId >= 210 ? areaId - 210 : areaId >= 2 ? Math.floor((areaId - 2) / 4) : 0;
      let slots = 0;
      for (let i = 0; i < count; i++) {
        const uid = table[18 + 16 * i] * 256 + table[19 + 16 * i];
        const entries = library.entries.filter(e => e.kind === (area.isExterior ? "exterior" : "interior") && e.bundleId === bundleId && e.uid === uid);
        ensure(entries.length === 1 && uid < 512, `Building UID ${uid} is missing or ambiguous in the destination bundle ${bundleId}.`);
        slots += 1 + (readU16(entries[0].metadataBytes, 4) < 512 ? 1 : 0);
      }
      ensure(slots <= 32, "The imported map exceeds the 32 native building slots, including subordinate models.");
    }
  }
  const staged = stageGen5MapDestination(draft, target, packed);
  const converted = await loadMap3dZone(draft, target.headerId, { season: target.season, cache: false });
  ensure(converted.chunks.some(c => c.chunkId === staged.mapId && c.matrixX === target.x && c.matrixY === target.y), "Imported map is not visible through the selected header. Repair its matrix header assignment first.");
  const newWarnings = converted.warnings.filter(w => !original.warnings.includes(w)); ensure(!newWarnings.length, `Imported map failed preview validation: ${newWarnings.join("; ")}`);
  const changes: StoreChange[] = [];
  for (const name of guardedNames) {
    const before = baseline[name], after = draft.narcs[name]; if (!after) continue;
    if (before && before.rawFiles.length === after.rawFiles.length && before.rawFiles.every((b, i) => equalMapBytes(b, after.rawFiles[i]))) continue;
    changes.push({ name, before, after: cloneStore(after, true) });
  }
  notes.push(newCell ? "New cell: all seasons." : "Replacement: selected cell and season. Other uses retain their map data.");
  if (input.textures && embedded) notes.push("Selected NSBTX takes precedence over embedded textures.");
  return { target: { ...target }, original, converted, ...staged, importedTextures, components, notes, changes, guards, context: context(project) };
}

async function commit(project: ProjectState, result: Gen5MapImport, undo: boolean): Promise<void> {
  ensure(undo ? result.applied : !result.applied, undo ? "This import has not been applied." : "This import was already applied.");
  ensure(context(project) === result.context, "Map metadata or ROM files changed. Prepare the import again before applying or undoing.");
  const source = project.originalRomBytes ?? await loadActiveRomBytes(); ensure(source, "Reconnect the project's source ROM.");
  ensure(context(project) === result.context, "Map metadata changed while loading the source ROM. Prepare the import again.");
  const rom = new NintendoDSRom(source, { fileData: "view" }), current = detached(project); materializeProjectEdits(current);
  // Validation and publishing are synchronous from here, so no edit can interleave them.
  for (const guard of result.guards) {
    const change = result.changes.find(c => c.name === guard.name), store = current.narcs[guard.name];
    ensure(!store || (store.fileId === guard.fileId && store.sourcePath === guard.path), "Conflicting map archive store.");
    const fallback = store ? undefined : new NARC(getRomFileBytes(current, rom, guard.fileId));
    const actual = store?.rawFiles ?? fallback!.files;
    const expected = undo && change ? change.after.rawFiles : guard.bytes;
    ensure((!store || store.fileCount === expected.length) && JSON.stringify(store?.filenames ?? fallback?.filenames) === (undo && change ? JSON.stringify(change.after.filenames) : guard.filenames), "Map archive counts or filenames changed. Prepare the import again.");
    ensure(actual.length === expected.length && expected.every((b, i) => equalMapBytes(b, actual[i])), "Map resources changed during review or after Apply. Import again before applying or undoing.");
  }
  for (const change of result.changes) {
    const store = undo ? change.before : change.after;
    if (store) project.narcs[change.name] = cloneStore(store, true); else delete project.narcs[change.name];
    if (store) project.session.fileIds[change.name] = store.fileId;
  }
  result.applied = !undo;
  if (result.changes.length) recordGenericChange(project, "maps3d", `${undo ? "Undid" : "Applied"} DS Map Studio import at matrix ${result.target.matrixId}, cell ${result.target.x}, ${result.target.y}.`, result.original.label);
  invalidateMap3dAssets(); invalidateBuildingLibrary(project);
}
export async function applyGen5MapImport(project: ProjectState, result: Gen5MapImport): Promise<void> { await commit(project, result, false); }
export async function undoGen5MapImport(project: ProjectState, result: Gen5MapImport): Promise<void> { await commit(project, result, true); }
