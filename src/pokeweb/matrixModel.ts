import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { addFilePath } from "../nds/fnt";
import { BW_NARCS, BW2_NARCS, isGen5Project, type NarcDefinition } from "./constants";
import { recordGenericChange } from "./actionChangelog";
import { parseHeaders, updateHeaderField, type HeaderRow } from "./headerModel";
import { activeRomMatchesProject, loadActiveRomBytes } from "./persistence";
import { createNarcStore, decodeRecord, markDirty, type ProjectState, type RawRecord } from "./projectStore";
import { GEN5_MATRIX_EMPTY, MATRIX_EDITOR_CELL_LIMIT, materializeGen5MatrixFile, parseGen5MatrixFile } from "./gen5MatrixModel";
import { readAscii, readU16, readU32 } from "../nds/binary";
import { materialRecords } from "./nitroResourceWriter";

export { GEN5_MATRIX_EMPTY, MATRIX_EDITOR_CELL_LIMIT } from "./gen5MatrixModel";
export type MatrixCell = { index: number; x: number; y: number; mapId: number; headerId?: number };
export type MatrixSnapshot = {
  id: number; width: number; height: number; hasHeaders: boolean; editable: boolean;
  cells: MatrixCell[]; referencingHeaders: HeaderRow[];
};
export type MatrixCellEdit = { mapId?: number; headerId?: number };

/** Unassigned cells use a nearby linked header for graphics, without inheriting its events. */
export function resolveMatrixCellGraphicsHeader(
  matrix: { width: number; height: number; hasZones: boolean; chunkIds: readonly number[]; zoneIds: readonly number[] },
  cell: { matrixId: number; x: number; y: number }, headers: HeaderRow[],
): HeaderRow {
  if (![cell.matrixId, cell.x, cell.y].every(value => Number.isSafeInteger(value) && value >= 0)
    || cell.x >= matrix.width || cell.y >= matrix.height) throw new Error("Selected cell is outside the matrix.");
  if (matrix.chunkIds[cell.y * matrix.width + cell.x] < 0 || matrix.chunkIds[cell.y * matrix.width + cell.x] === GEN5_MATRIX_EMPTY) throw new Error("Selected cell has no map.");
  const references = headers.filter(header => Number(header.matrix_id) === cell.matrixId);
  const byId = new Map(references.map(header => [header.index, header]));
  let nearest: HeaderRow | undefined, distance = Infinity;
  if (matrix.hasZones) for (let index = 0; index < matrix.zoneIds.length; index++) {
    const header = byId.get(matrix.zoneIds[index]);
    if (!header) continue;
    const d = Math.abs(index % matrix.width - cell.x) + Math.abs(Math.floor(index / matrix.width) - cell.y);
    if (d < distance) { nearest = header; distance = d; }
  }
  const header = nearest ?? references[0];
  if (!header) throw new Error("Link a header to this matrix to provide graphics resources before opening its maps.");
  return header;
}

const treeMaterialCache = new WeakMap<Uint8Array, boolean>();

/** Inspect native tree texture bindings only; no graphics resources are loaded or rendered. */
export function matrixMapHasTrees(bytes: Uint8Array | undefined): boolean {
  if (!bytes) return false;
  const cached = treeMaterialCache.get(bytes);
  if (cached !== undefined) return cached;
  let trees = false;
  try {
    const count = readU16(bytes, 2), start = readU32(bytes, 4), end = readU32(bytes, 8);
    if (count > 0 && start >= 4 + (count + 1) * 4 && start < end && end <= bytes.length) {
      const model = bytes.subarray(start, end);
      if (readAscii(model, 0, 4) === "BMD0") trees = materialRecords(model).some(material => /^ki0[23][a-d]x?$/iu.test(material.textureName ?? ""));
    }
  } catch { /* Missing or unfamiliar geometry keeps the neutral inspection color. */ }
  treeMaterialCache.set(bytes, trees);
  return trees;
}

export function canUseMatrixEditor(project: ProjectState, hasSource: boolean): boolean {
  return isGen5Project(project) && Boolean(project.narcs.headers)
    && (hasSource || Boolean(project.narcs.matrix && project.narcs.maps));
}

export async function loadMatrixEditorData(project: ProjectState, options: { overworlds?: boolean; seasons?: boolean } = {}): Promise<void> {
  requireGen5(project);
  const definitions: NarcDefinition[] = (project.session.baseRom === "BW" ? BW_NARCS : BW2_NARCS)
    .filter(definition => ["matrix", "maps", ...(options.overworlds ? ["overworlds"] : [])].includes(definition.name) && !project.narcs[definition.name]);
  if (options.seasons && (!project.narcs.map_replace || (!project.narcs.map_replace.rawFiles[0]?.length && !project.narcs.map_replace.dirty.has(0)))) definitions.push({ name: "map_replace", path: "a/0/1/0" });
  if (definitions.length) {
    if (!project.originalRomBytes && !await activeRomMatchesProject(project)) throw new Error("Reconnect this project's source ROM to load matrices.");
    const bytes = project.originalRomBytes ?? await loadActiveRomBytes();
    if (!bytes) throw new Error("The project's source ROM is unavailable.");
    const rom = new NintendoDSRom(bytes, { fileData: "view" });
    if (rom.idCode !== project.romInfo.idCode || bytes.length !== project.romInfo.size) throw new Error("Matrix resources do not match this project.");
    // Stage all archives before publishing them, so a load error cannot leave a partial load.
    const stores = definitions.map(definition => {
      const fileId = rom.fileId(definition.path);
      return createNarcStore(definition.name, definition.path, fileId, new NARC(project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId]));
    });
    for (const store of stores) {
      const existing = project.narcs[store.name];
      if (existing) {
        if (store.name === "map_replace" && !existing.dirty.has(0)) { existing.rawFiles = store.rawFiles; existing.records.clear(); existing.parseError = undefined; }
        continue;
      }
      project.narcs[store.name] = store; project.session.fileIds[store.name] = store.fileId;
    }
  }
  if (!project.headers) project.headers = parseHeaders(project);
}

export function getMatrixBytes(project: ProjectState, id: number, fallback?: Uint8Array): Uint8Array {
  const store = project.narcs.matrix, original = store?.rawFiles[id];
  const raw = store?.records.get(id)?.raw;
  if (raw) return materializeGen5MatrixFile(raw, original ?? fallback ?? new Uint8Array());
  const bytes = original?.length ? original : fallback;
  if (!bytes) throw new Error(`Matrix ${id} is missing.`);
  return bytes;
}

export function getMatrixSnapshot(project: ProjectState, id: number): MatrixSnapshot {
  const raw = matrixRaw(project, id), width = raw.width, height = raw.height;
  if (!project.headers && project.narcs.headers) project.headers = parseHeaders(project);
  return { id, width, height, hasHeaders: raw.matrix_flags === 1, editable: width * height <= MATRIX_EDITOR_CELL_LIMIT,
    cells: Array.from({ length: width * height }, (_, index) => ({ index, x: index % width, y: Math.floor(index / width),
      mapId: raw[`map_${index}`], headerId: raw.matrix_flags ? raw[`header_${index}`] : undefined })),
    referencingHeaders: Object.values(project.headers?.rows ?? {}).filter(row => Number(row.matrix_id) === id),
  };
}

export function matrixSelection(width: number, anchor: number, end: number): number[] {
  const x1 = Math.min(anchor % width, end % width), x2 = Math.max(anchor % width, end % width);
  const y1 = Math.min(Math.floor(anchor / width), Math.floor(end / width)), y2 = Math.max(Math.floor(anchor / width), Math.floor(end / width));
  const cells: number[] = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) cells.push(y * width + x);
  return cells;
}

export function applyMatrixCellEdit(project: ProjectState, id: number, indices: readonly number[], edit: MatrixCellEdit): boolean {
  const raw = editableRaw(project, id), count = raw.width * raw.height;
  if (!indices.length) throw new Error("Select at least one cell.");
  for (const index of indices) if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error("Selected cell is outside the matrix.");
  if (edit.mapId !== undefined) validateMap(project, edit.mapId);
  if (edit.headerId !== undefined) {
    if (!raw.matrix_flags) throw new Error("Add a header table before assigning cell headers.");
    validateHeader(project, edit.headerId);
  }
  const next = { ...raw };
  for (const index of indices) {
    if (edit.mapId !== undefined) next[`map_${index}`] = edit.mapId;
    if (edit.headerId !== undefined) next[`header_${index}`] = edit.headerId;
  }
  return commit(project, id, raw, next, `Updated ${new Set(indices).size} cell(s) in matrix ${id}.`);
}

export function addMatrixHeaderTable(project: ProjectState, id: number, initialHeaderId: number): boolean {
  const raw = editableRaw(project, id);
  if (raw.matrix_flags) throw new Error("This matrix already has a header table.");
  validateHeader(project, initialHeaderId);
  if (initialHeaderId === GEN5_MATRIX_EMPTY) throw new Error("Choose an existing header for populated cells.");
  const next: RawRecord = { ...raw, matrix_flags: 1 };
  for (let i = 0; i < raw.width * raw.height; i++) next[`header_${i}`] = raw[`map_${i}`] === GEN5_MATRIX_EMPTY ? GEN5_MATRIX_EMPTY : initialHeaderId;
  return commit(project, id, raw, next, `Added a header table to matrix ${id}.`);
}

export function countCroppedMatrixCells(project: ProjectState, id: number, width: number, height: number): number {
  validateDimensions(width, height);
  return getMatrixSnapshot(project, id).cells.filter(cell => (cell.x >= width || cell.y >= height)
    && (cell.mapId !== GEN5_MATRIX_EMPTY || (cell.headerId !== undefined && cell.headerId !== GEN5_MATRIX_EMPTY))).length;
}

export function resizeMatrix(project: ProjectState, id: number, width: number, height: number, confirmCrop = false): boolean {
  const raw = editableRaw(project, id); validateDimensions(width, height);
  const cropped = countCroppedMatrixCells(project, id, width, height);
  if (cropped && !confirmCrop) throw new Error(`Resizing removes ${cropped} populated cell(s). Confirm the crop first.`);
  const next: RawRecord = { ...raw, width, height };
  for (const key of Object.keys(next)) if (/^(map|header)_\d+$/u.test(key)) delete next[key];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x, oldIndex = y * raw.width + x, retained = x < raw.width && y < raw.height;
    next[`map_${index}`] = retained ? raw[`map_${oldIndex}`] : GEN5_MATRIX_EMPTY;
    if (raw.matrix_flags) next[`header_${index}`] = retained ? raw[`header_${oldIndex}`] : GEN5_MATRIX_EMPTY;
  }
  return commit(project, id, raw, next, `Resized matrix ${id} from ${raw.width} × ${raw.height} to ${width} × ${height}.`);
}

export function createMatrix(project: ProjectState, width = 1, height = 1, hasHeaders = true): number {
  requireGen5(project); validateDimensions(width, height);
  const raw: RawRecord = { width, height, matrix_flags: hasHeaders ? 1 : 0, footer_length: 0 };
  for (let i = 0; i < width * height; i++) { raw[`map_${i}`] = GEN5_MATRIX_EMPTY; if (hasHeaders) raw[`header_${i}`] = GEN5_MATRIX_EMPTY; }
  return appendMatrix(project, materializeGen5MatrixFile(raw, new Uint8Array()), "Created");
}

export function duplicateMatrix(project: ProjectState, id: number): number {
  editableRaw(project, id);
  return appendMatrix(project, getMatrixBytes(project, id).slice(), `Duplicated matrix ${id} as`);
}

export function linkHeaderToMatrix(project: ProjectState, id: number, headerId: number): boolean {
  editableRaw(project, id); validateHeader(project, headerId);
  if (id > 65535) throw new Error("Matrix index exceeds the header's Matrix ID range.");
  if (headerId === GEN5_MATRIX_EMPTY) throw new Error("Choose an existing header to link.");
  if (Number(project.headers!.rows[headerId + 1].matrix_id) === id) return false;
  updateHeaderField(project, headerId + 1, "matrix_id", String(id));
  markDirty(project, "headers", 0);
  return true;
}

function matrixRaw(project: ProjectState, id: number): RawRecord {
  requireGen5(project);
  if (!Number.isInteger(id) || id < 0) throw new Error("Invalid matrix index.");
  const raw = decodeRecord(project, "matrix", id).raw!;
  return raw;
}
function editableRaw(project: ProjectState, id: number): RawRecord {
  const raw = matrixRaw(project, id); validateDimensions(raw.width, raw.height); return raw;
}
function validateDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MATRIX_EDITOR_CELL_LIMIT)
    throw new Error(`Use positive whole-number dimensions with at most ${MATRIX_EDITOR_CELL_LIMIT} cells.`);
}
function requireGen5(project: ProjectState): void {
  if (!isGen5Project(project)) throw new Error("Matrix editing is available for Black/White and Black 2/White 2.");
}
function validateHeader(project: ProjectState, id: number): void {
  if (!Number.isInteger(id) || id < 0 || id > GEN5_MATRIX_EMPTY) throw new Error("Enter a valid header ID or Empty.");
  if (id === GEN5_MATRIX_EMPTY) return;
  if (!project.headers) project.headers = parseHeaders(project);
  if (!project.headers.rows[id + 1]) throw new Error(`Header ${id} does not exist.`);
}
function validateMap(project: ProjectState, id: number): void {
  if (!Number.isInteger(id) || id < 0 || id > GEN5_MATRIX_EMPTY) throw new Error("Enter a valid map ID or Empty.");
  if (id === GEN5_MATRIX_EMPTY) return;
  const store = project.narcs.maps;
  if (!store) throw new Error("Load the maps archive before assigning map IDs.");
  if (id >= store.fileCount || !store.rawFiles[id]?.length) throw new Error(`Map ${id} does not exist.`);
}
function commit(project: ProjectState, id: number, before: RawRecord, after: RawRecord, text: string): boolean {
  if (Object.keys(before).length === Object.keys(after).length && Object.keys(after).every(key => before[key] === after[key])) return false;
  const store = project.narcs.matrix!, record = store.records.get(id)!;
  const bytes = materializeGen5MatrixFile(after, store.rawFiles[id]);
  record.raw = after; record.readable = { ...after, index: id }; record.bytes = bytes; store.rawFiles[id] = bytes;
  markDirty(project, "matrix", id);
  recordGenericChange(project, "matrix", text, `Matrix ${id}`, { key: `matrix-edit:${id}` });
  return true;
}
function appendMatrix(project: ProjectState, bytes: Uint8Array, action: string): number {
  const store = project.narcs.matrix;
  if (!store) throw new Error("The matrices archive is not loaded.");
  const id = store.rawFiles.length;
  if (id >= 65535) throw new Error("The matrix archive cannot contain more than 65535 entries.");
  const raw = parseGen5MatrixFile(bytes);
  let filenames = store.filenames;
  if (filenames && (filenames.files.length || filenames.folders.length)) {
    let directory = `matrix_${id}`;
    while (filenames.folders.some(([name]) => name === directory)) directory += "_";
    filenames = addFilePath(filenames, `${directory}/matrix_${id}.bin`, id);
  }
  store.rawFiles.push(bytes); store.fileCount = store.rawFiles.length;
  store.filenames = filenames;
  store.records.set(id, { id, bytes, raw, readable: { ...raw, index: id } });
  markDirty(project, "matrix", id);
  recordGenericChange(project, "matrix", `${action} matrix ${id}.`, `Matrix ${id}`, { key: `matrix-create:${id}` });
  return id;
}
