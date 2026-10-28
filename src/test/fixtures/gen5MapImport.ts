import { concatBytes, writeU16, writeU32 } from "../../nds/binary";
import { NARC } from "../../nds/narc";
import { NintendoDSRom } from "../../nds/rom";
import { packGameFreakContainer } from "../../pokeweb/map3dModel";
import { align, replaceMaterialRecords, writeDictionary, writeNitroFile } from "../../pokeweb/nitroResourceWriter";
import { createNarcStore } from "../../pokeweb/projectStore";
import { makeMatrixProject } from "./matrixProject";

export function nitroFile(stamp: string, blocks: Uint8Array[]) {
  const header = new Uint8Array(16); header.set(new TextEncoder().encode(stamp));
  writeU16(header, 4, 0xfeff); writeU16(header, 6, stamp === "BMD0" ? 2 : 1); writeU16(header, 12, 16);
  return writeNitroFile(header, blocks);
}

/** Independently authored tiny native triangle: one node, material and shape. */
export function mapModel(texture = "tile", palette = "pal") {
  const dict = (name: string, value = 0) => { const data = new Uint8Array(4); writeU32(data, 0, value); return writeDictionary([{ name, data }], 4); };
  const nodeDict = dict("node"), node = new Uint8Array(4); writeU16(node, 0, 7); writeU32(nodeDict, 20, nodeDict.length);
  const sbc = Uint8Array.from([2, 0, 1, 6, 0, 0, 0, 11, 4, 0, 5, 0, 0x2b, 1]);
  const empty = writeDictionary([], 4), matDict = dict("surface"), material = new Uint8Array(44);
  writeU16(material, 2, 44); writeU32(material, 4, 0x7fff); writeU32(material, 12, 31 << 16); writeU16(material, 30, 14);
  const matAt = align(4 + matDict.length + empty.length * 2), materials = new Uint8Array(matAt + material.length);
  writeU16(materials, 0, 4 + matDict.length); writeU16(materials, 2, 4 + matDict.length + empty.length);
  writeU32(matDict, 20, matAt); materials.set(matDict, 4); materials.set(empty, 4 + matDict.length); materials.set(empty, 4 + matDict.length + empty.length); materials.set(material, matAt);
  const words = [0x23232040, 0, 0x7fff, 0, 0, 4096, 0, 0x00004123, 4096 << 16, 0];
  const gpu = new Uint8Array(words.length * 4); words.forEach((word, i) => writeU32(gpu, i * 4, word >>> 0));
  const shapeDict = dict("shape"), shape = new Uint8Array(16); writeU32(shapeDict, 20, shapeDict.length);
  writeU16(shape, 2, 16); writeU32(shape, 8, 16); writeU32(shape, 12, gpu.length);
  const sbcAt = align(64 + nodeDict.length + node.length), materialsAt = align(sbcAt + sbc.length), shapesAt = align(materialsAt + materials.length);
  const model = new Uint8Array(shapesAt + shapeDict.length + shape.length + gpu.length);
  writeU32(model, 0, model.length); writeU32(model, 4, sbcAt); writeU32(model, 8, materialsAt); writeU32(model, 12, shapesAt); writeU32(model, 16, model.length);
  model[23] = 1; model[24] = 1; model[25] = 1; writeU32(model, 28, 4096); writeU32(model, 32, 4096); writeU16(model, 36, 3); writeU16(model, 38, 1);
  model.set(nodeDict, 64); model.set(node, 64 + nodeDict.length); model.set(sbc, sbcAt); model.set(materials, materialsAt);
  model.set(shapeDict, shapesAt); model.set(shape, shapesAt + shapeDict.length); model.set(gpu, shapesAt + shapeDict.length + shape.length);
  const modelDict = dict("map"), mdl = new Uint8Array(8 + modelDict.length + model.length); writeU32(modelDict, 20, 8 + modelDict.length);
  mdl.set(new TextEncoder().encode("MDL0")); writeU32(mdl, 4, mdl.length); mdl.set(modelDict, 8); mdl.set(model, 8 + modelDict.length);
  const file = nitroFile("BMD0", [mdl]);
  return replaceMaterialRecords(file, [{ name: "surface", bytes: material, textureName: texture, paletteName: palette }]);
}

export function mapTextures(color = 0x001f, compressed = false) {
  const td = new Uint8Array(8), pd = new Uint8Array(4); writeU32(td, 0, (compressed ? 5 : 2) << 26);
  const textures = writeDictionary([{ name: "tile", data: td }], 8), palettes = writeDictionary([{ name: "pal", data: pd }], 4);
  const at = align(60 + textures.length + palettes.length, 8), block = new Uint8Array(at + (compressed ? 24 : 16) + 16);
  block.set(new TextEncoder().encode("TEX0")); writeU32(block, 4, block.length); writeU16(block, 14, 60); writeU16(block, 30, 60); writeU32(block, 52, 60 + textures.length);
  writeU16(block, compressed ? 28 : 12, 2); writeU32(block, 20, at); writeU32(block, 36, at); writeU32(block, 40, at + 16);
  writeU16(block, 48, 2); writeU32(block, 56, at + (compressed ? 24 : 16));
  block.set(textures, 60); block.set(palettes, 60 + textures.length);
  if (compressed) for (let i = 0; i < 4; i++) writeU16(block, at + 16 + i * 2, 0x8000);
  for (let i = 0; i < 4; i++) writeU16(block, at + (compressed ? 24 : 16) + i * 2, color);
  return nitroFile("BTX0", [block]);
}

export function mapPermissions(corner = false) {
  const bytes = new Uint8Array(8196 + (corner ? 8 : 0)); writeU16(bytes, 0, 32); writeU16(bytes, 2, 32);
  if (corner) { writeU16(bytes, 4, 2); writeU16(bytes, 8196, 1); writeU16(bytes, 8198, 0); }
  return bytes;
}
export function mapBin(second = false) {
  return packGameFreakContainer("WB", [mapModel(), mapPermissions(), ...(second ? [mapPermissions(true)] : []), new Uint8Array(4), Uint8Array.of(9, 8, 7, 6)]);
}
export function gen5ImportProject(game: "BW" | "BW2" = "BW2") {
  const project = makeMatrixProject(game), narc = (files: Uint8Array[]) => { const n = new NARC(); n.files = files; return n.save(); };
  project.narcs.maps!.rawFiles = Array.from({ length: 8 }, () => mapBin());
  const area = new Uint8Array(10); area[4] = 255; area[5] = 255; area[6] = 1;
  const header = new Uint8Array(0x4000); header.set(new TextEncoder().encode(game === "BW" ? "IRBO" : "IRDO"), 12);
  const raw = new NintendoDSRom(header); raw.arm9 = new Uint8Array(64);
  const entries: Array<{ path: string; bytes: Uint8Array }> = [
    { path: "a/0/0/8", bytes: narc(project.narcs.maps!.rawFiles) }, { path: "a/0/0/9", bytes: narc(project.narcs.matrix!.rawFiles) },
    { path: "a/0/1/2", bytes: narc(project.narcs.headers!.rawFiles) }, { path: "a/0/1/0", bytes: narc([new Uint8Array()]) },
    { path: "a/0/1/3", bytes: area }, { path: "a/0/1/4", bytes: narc([mapTextures()]) },
    { path: "a/0/6/8", bytes: narc([]) }, { path: "a/0/6/9", bytes: narc([]) },
    { path: game === "BW" ? "a/0/4/8" : "a/0/4/7", bytes: narc([new Uint8Array()]) },
    { path: game === "BW" ? "a/0/4/9" : "a/0/4/8", bytes: narc([]) },
    { path: game === "BW" ? "a/1/2/5" : "a/1/2/6", bytes: narc([new Uint8Array(8)]) },
    ...[game === "BW" ? "a/1/7/6" : "a/1/7/4", game === "BW" ? "a/1/7/7" : "a/1/7/5"].map(path => ({ path, bytes: narc([mapTextures()]) })),
    ...[game === "BW" ? "a/2/2/9" : "a/2/2/5", game === "BW" ? "a/2/3/0" : "a/2/2/6"].map(path => ({ path, bytes: narc([]) })),
  ];
  const bytes = raw.save({ addedFiles: entries }), rom = new NintendoDSRom(bytes);
  project.originalRomBytes = bytes; project.arm9 = rom.arm9;
  project.romInfo = { ...project.romInfo, idCode: rom.idCode, size: bytes.length };
  for (const name of ["maps", "matrix", "headers", "map_replace"] as const) {
    const path = name === "maps" ? "a/0/0/8" : name === "matrix" ? "a/0/0/9" : name === "headers" ? "a/0/1/2" : "a/0/1/0";
    project.narcs[name] = createNarcStore(name, path, rom.fileId(path), new NARC(rom.getFileByName(path)));
  }
  return project;
}
