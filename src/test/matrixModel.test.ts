import { describe, expect, it } from "vitest";
import { Folder } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { writeU32 } from "../nds/binary";
import { parseGen5MatrixFile, materializeGen5MatrixFile } from "../pokeweb/gen5MatrixModel";
import { addMatrixHeaderTable, applyMatrixCellEdit, canUseMatrixEditor, countCroppedMatrixCells, createMatrix, duplicateMatrix,
  getMatrixBytes, getMatrixSnapshot, linkHeaderToMatrix, loadMatrixEditorData, matrixSelection, resizeMatrix, GEN5_MATRIX_EMPTY as EMPTY } from "../pokeweb/matrixModel";
import { createProjectDocument } from "../pokeweb/projectDocument";
import { openProjectSession } from "../pokeweb/projectSession";
import { decodeRecord, markDirty } from "../pokeweb/projectStore";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import { parseMapMatrix } from "../pokeweb/map3dModel";
import { makeMatrixProject, matrixBytes } from "./fixtures/matrixProject";

describe("Gen 5 matrix codec", () => {
  it.each([true, false])("round trips optional headers (%s), full unsigned IDs and trailing bytes", hasHeaders => {
    const bytes = matrixBytes(2, 1, [EMPTY, 2], hasHeaders ? [EMPTY, 0] : undefined, Uint8Array.of(1, 2, 3, 4, 5));
    const raw = parseGen5MatrixFile(bytes);
    expect(raw.map_0).toBe(EMPTY); expect(raw.footer_length).toBe(5);
    expect(raw.header_0).toBe(hasHeaders ? EMPTY : undefined);
    expect(materializeGen5MatrixFile(raw, bytes)).toEqual(bytes);
  });
  it("does not mistake a headerless matrix footer for a header table", () => {
    const raw = parseGen5MatrixFile(matrixBytes(1, 1, [3], undefined, new Uint8Array(8)));
    expect(raw.header_0).toBeUndefined(); expect(raw.footer_length).toBe(8);
  });
  it("rejects small files, zero dimensions, unknown flags, and truncated tables", () => {
    expect(() => parseGen5MatrixFile(new Uint8Array(7))).toThrow(/small/);
    expect(() => parseGen5MatrixFile(new Uint8Array(8))).toThrow(/dimensions/);
    const unsupported = matrixBytes(1, 1, [0]); writeU32(unsupported, 0, 2);
    expect(() => parseGen5MatrixFile(unsupported)).toThrow(/flag/);
    for (const bytes of [matrixBytes(2, 1, [0, 1]), matrixBytes(1, 1, [0], [0])])
      expect(() => parseGen5MatrixFile(bytes.subarray(0, bytes.length - 1))).toThrow(/truncated/);
  });
  it("rejects missing or out-of-range authored cells before materializing", () => {
    const bytes = matrixBytes(1, 1, [0]), raw = parseGen5MatrixFile(bytes);
    delete raw.map_0; expect(() => materializeGen5MatrixFile(raw, bytes)).toThrow(/missing/);
    raw.map_0 = -1; expect(() => materializeGen5MatrixFile(raw, bytes)).toThrow(/Invalid/);
  });
});

describe.each(["BW", "BW2"] as const)("%s matrix operations", baseRom => {
  it("uses native zero-based headers, finds references, and selects rectangles", () => {
    const project = makeMatrixProject(baseRom), snapshot = getMatrixSnapshot(project, 0);
    expect(snapshot.referencingHeaders.map(header => header.index)).toEqual([0, 2]);
    expect(snapshot.cells[3]).toMatchObject({ x: 0, y: 1, mapId: 2, headerId: 1 });
    expect(matrixSelection(3, 5, 1)).toEqual([1, 2, 4, 5]);
    applyMatrixCellEdit(project, 0, [0, 3], { headerId: 2 });
    expect(getMatrixSnapshot(project, 0).cells[0]).toMatchObject({ headerId: 2, mapId: 0 });
    expect(project.headers!.rows[3].matrix_id).toBe(0);
    expect(project.narcs.matrix!.revision).toBe(1);
  });
  it("validates an entire edit atomically and keeps unselected assignments", () => {
    const project = makeMatrixProject(baseRom), original = getMatrixBytes(project, 0).slice();
    for (const action of [
      () => applyMatrixCellEdit(project, 0, [0, 50], { headerId: 1 }),
      () => applyMatrixCellEdit(project, 0, [0], { headerId: 10, mapId: 1 }),
      () => applyMatrixCellEdit(project, 0, [0], { headerId: 1, mapId: 8 }),
      () => applyMatrixCellEdit(project, 0, [0], { headerId: -1 }),
    ]) expect(action).toThrow();
    expect(getMatrixBytes(project, 0)).toEqual(original); expect(project.narcs.matrix!.dirty.size).toBe(0);
    expect(applyMatrixCellEdit(project, 0, [0], { mapId: 0 })).toBe(false);
    applyMatrixCellEdit(project, 0, [0], { mapId: EMPTY, headerId: EMPTY });
    expect(getMatrixSnapshot(project, 0).cells[0]).toMatchObject({ mapId: EMPTY, headerId: EMPTY });
    expect(getMatrixSnapshot(project, 0).cells[1]).toMatchObject({ mapId: 1, headerId: 0 });
  });
  it("retains pre-existing missing references without permitting new invalid assignments", () => {
    const project = makeMatrixProject(baseRom), original = project.narcs.matrix!.rawFiles[0]; writeU32(original, 8, 99);
    expect(getMatrixSnapshot(project, 0).cells[0].mapId).toBe(99);
    applyMatrixCellEdit(project, 0, [1], { headerId: 2 });
    expect(getMatrixSnapshot(project, 0).cells[0].mapId).toBe(99);
    expect(() => applyMatrixCellEdit(project, 0, [1], { mapId: 99 })).toThrow(/does not exist/);
  });
  it("adds a header table explicitly and keeps empty cells unassigned", () => {
    const project = makeMatrixProject(baseRom);
    applyMatrixCellEdit(project, 1, [1], { mapId: EMPTY });
    expect(() => applyMatrixCellEdit(project, 1, [0], { headerId: 0 })).toThrow(/Add a header table/);
    expect(() => addMatrixHeaderTable(project, 1, EMPTY)).toThrow(/existing header/);
    addMatrixHeaderTable(project, 1, 0);
    expect(getMatrixSnapshot(project, 1).cells.map(cell => cell.headerId)).toEqual([0, EMPTY]);
    expect(getMatrixBytes(project, 1).slice(-4)).toEqual(Uint8Array.of(1, 2, 3, 4));
    expect(project.headers!.rows[1].matrix_id).toBe(0);
    expect(linkHeaderToMatrix(project, 1, 0)).toBe(true);
    expect(linkHeaderToMatrix(project, 1, 0)).toBe(false);
    expect(project.headers!.rows[1].matrix_id).toBe(1); expect(project.narcs.headers!.dirty.has(0)).toBe(true);
    expect(project.narcs.headers!.revision).toBe(1);
  });
  it("resizes by coordinates, pads empty cells, and requires confirmation for populated crops", () => {
    const project = makeMatrixProject(baseRom);
    resizeMatrix(project, 0, 4, 3);
    expect(getMatrixSnapshot(project, 0).cells.map(cell => cell.mapId)).toEqual([0, 1, EMPTY, EMPTY, 2, 3, 4, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY]);
    expect(countCroppedMatrixCells(project, 0, 2, 2)).toBe(1);
    const before = getMatrixBytes(project, 0).slice();
    expect(() => resizeMatrix(project, 0, 2, 2)).toThrow(/Confirm/);
    expect(getMatrixBytes(project, 0)).toEqual(before);
    resizeMatrix(project, 0, 2, 2, true);
    expect(getMatrixSnapshot(project, 0).cells.map(cell => cell.mapId)).toEqual([0, 1, 2, 3]);
    expect(getMatrixBytes(project, 0).slice(-2)).toEqual(Uint8Array.of(0xaa, 0xbb));
    expect(() => resizeMatrix(project, 0, 901, 1)).toThrow(/900/);
    expect(() => resizeMatrix(project, 0, 0, 1)).toThrow(/positive/);
  });
  it("appends new and duplicated entries without renumbering existing files", () => {
    const project = makeMatrixProject(baseRom), originals = project.narcs.matrix!.rawFiles.map(bytes => bytes.slice());
    const duplicate = duplicateMatrix(project, 1), created = createMatrix(project);
    expect([duplicate, created]).toEqual([2, 3]); expect(project.narcs.matrix!.fileCount).toBe(4);
    expect(getMatrixBytes(project, duplicate)).toEqual(originals[1]); expect(getMatrixBytes(project, duplicate)).not.toBe(project.narcs.matrix!.rawFiles[1]);
    expect(getMatrixSnapshot(project, created)).toMatchObject({ width: 1, height: 1, hasHeaders: true, cells: [{ mapId: EMPTY, headerId: EMPTY }] });
    expect(project.narcs.matrix!.rawFiles.slice(0, 2)).toEqual(originals);
    expect(createMatrix(project, 30, 30, false)).toBe(4);
    expect(() => createMatrix(project, 30, 31)).toThrow(/900/);
  });
  it("permits inspection but blocks edits to existing matrices over the editor limit", () => {
    const project = makeMatrixProject(baseRom), maps = Array.from({ length: 930 }, () => EMPTY);
    project.narcs.matrix!.rawFiles[1] = matrixBytes(31, 30, maps);
    expect(getMatrixSnapshot(project, 1)).toMatchObject({ width: 31, height: 30, editable: false });
    expect(() => applyMatrixCellEdit(project, 1, [0], { mapId: 0 })).toThrow(/900/);
    expect(() => resizeMatrix(project, 1, 30, 30)).toThrow(/900/);
    expect(() => duplicateMatrix(project, 1)).toThrow(/900/);
    expect(project.narcs.matrix!.dirty.size).toBe(0);
  });
  it("materializes raw edits for save, keeps appended matrices, and starts fresh decoded caches on reopen", () => {
    const project = makeMatrixProject(baseRom), untouched = project.narcs.matrix!.rawFiles[1].slice();
    decodeRecord(project, "matrix", 0).raw!.header_0 = 2; markDirty(project, "matrix", 0);
    const duplicate = duplicateMatrix(project, 0); resizeMatrix(project, duplicate, 4, 2);
    linkHeaderToMatrix(project, duplicate, 2);
    materializeProjectEdits(project);
    const opened = openProjectSession(structuredClone(createProjectDocument(project, false)));
    expect(opened.narcs.matrix!.records.size).toBe(0);
    expect(getMatrixSnapshot(opened, 0).cells[0].headerId).toBe(2);
    expect(getMatrixSnapshot(opened, duplicate).width).toBe(4);
    expect(opened.headers!.rows[3].matrix_id).toBe(duplicate);
    expect(getMatrixBytes(opened, 1)).toEqual(untouched);
    expect(parseMapMatrix(getMatrixBytes(opened, 0)).zoneIds[0]).toBe(2);
  });
  it("loads from existing stores without a source ROM and gates unsupported generations", async () => {
    const project = makeMatrixProject(baseRom);
    expect(canUseMatrixEditor(project, false)).toBe(true); await loadMatrixEditorData(project);
    delete project.narcs.maps; expect(canUseMatrixEditor(project, false)).toBe(false); expect(canUseMatrixEditor(project, true)).toBe(true);
    project.session.baseRom = "Pt"; project.session.generation = "gen4";
    expect(canUseMatrixEditor(project, true)).toBe(false); expect(() => createMatrix(project)).toThrow(/available/);
  });
});

it("preserves named archive member IDs when appending", () => {
  const project = makeMatrixProject(), store = project.narcs.matrix!;
  store.filenames = new Folder({ folders: [["original", new Folder({ firstId: 0, files: ["a.bin", "b.bin"] })]] });
  createMatrix(project);
  const narc = new NARC(); narc.files = store.rawFiles; narc.filenames = store.filenames!;
  const opened = new NARC(narc.save());
  expect(opened.filenames.idOf("original/a.bin")).toBe(0); expect(opened.filenames.idOf("original/b.bin")).toBe(1);
  expect(opened.filenames.idOf("matrix_2/matrix_2.bin")).toBe(2);
});
