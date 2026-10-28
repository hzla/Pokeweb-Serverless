import { concatBytes, writeU16, writeU32 } from "../nds/binary";
import { studioAssert, type StudioMaterial } from "./mapStudioFormats";
import { align, writeDictionary, writeNitroFile, type NativeMaterialRecord } from "./nitroResourceWriter";

function fileHeader(stamp: string, version: number) {
  const bytes = new Uint8Array(16); bytes.set(new TextEncoder().encode(stamp)); writeU16(bytes, 4, 0xfeff); writeU16(bytes, 6, version); writeU16(bytes, 12, 16); return bytes;
}
export function emptyTextures() {
  const tex = new Uint8Array(96); tex.set(new TextEncoder().encode("TEX0")); writeU32(tex, 4, tex.length);
  writeU16(tex, 14, 60); writeU16(tex, 30, 60); writeU32(tex, 52, 76);
  for (const offset of [20, 36, 40, 56]) writeU32(tex, offset, 96);
  tex.set(writeDictionary([], 8), 60); tex.set(writeDictionary([], 4), 76);
  return writeNitroFile(fileHeader("BTX0", 1), [tex]);
}
function materialSection(records: NativeMaterialRecord[]) {
  const entries = records.map(r => ({ name: r.name, data: new Uint8Array(4) }));
  let cursor = 4 + writeDictionary(entries, 4).length;
  const pairings = (["textureName", "paletteName"] as const).map(field => {
    const groups = new Map<string, number[]>(); records.forEach((r, i) => { const name = r[field]; if (name) { const ids = groups.get(name) ?? []; ids.push(i); groups.set(name, ids); } });
    const pairs = [...groups].map(([name]) => ({ name, data: new Uint8Array(4) })); const offset = cursor; cursor += writeDictionary(pairs, 4).length;
    for (const [i, ids] of [...groups.values()].entries()) { writeU16(pairs[i].data, 0, cursor); pairs[i].data[2] = ids.length; cursor += ids.length; }
    const bytes = concatBytes([writeDictionary(pairs, 4), new Uint8Array([...groups.values()].flat()), new Uint8Array(align(cursor) - cursor)]); cursor = align(cursor); return { offset, bytes };
  });
  records.forEach((r, i) => { writeU32(entries[i].data, 0, cursor); cursor += align(r.bytes.length); });
  const segment = new Uint8Array(cursor); writeU16(segment, 0, pairings[0].offset); writeU16(segment, 2, pairings[1].offset);
  segment.set(writeDictionary(entries, 4), 4); pairings.forEach(p => segment.set(p.bytes, p.offset));
  let at = cursor - records.reduce((sum, r) => sum + align(r.bytes.length), 0); for (const r of records) { segment.set(r.bytes, at); at += align(r.bytes.length); }
  return segment;
}
/** A fresh, SDK-independent native model scaffold; no ROM template is needed. */
export function modelTemplate(records: NativeMaterialRecord[]) {
  const root = writeDictionary([{ name: "root", data: new Uint8Array(4) }], 4);
  // Dictionary datum offsets are obtained from the entry table, not names.
  const rv = new DataView(root.buffer), re = rv.getUint16(6, true); writeU32(root, re + 4, root.length);
  const node = new Uint8Array(4); writeU16(node, 0, 7);
  const sbc = Uint8Array.of(2, 0, 1, 6, 0, 0, 0, 11, 1), mat = materialSection(records), shapes = writeDictionary([], 4);
  const sbcAt = align(64 + root.length + 4), matAt = align(sbcAt + sbc.length), shapesAt = matAt + mat.length, inverseAt = align(shapesAt + shapes.length);
  const model = new Uint8Array(inverseAt + 84); writeU32(model, 0, model.length); writeU32(model, 4, sbcAt); writeU32(model, 8, matAt); writeU32(model, 12, shapesAt); writeU32(model, 16, inverseAt);
  model[23] = 1; model[24] = records.length; writeU32(model, 28, 4096); writeU32(model, 32, 4096); writeU32(model, 56, 4096); writeU32(model, 60, 4096);
  model.set(root, 64); model.set(node, 64 + root.length); model.set(sbc, sbcAt); model.set(mat, matAt); model.set(shapes, shapesAt);
  for (const offset of [0, 16, 32, 48, 64, 80]) writeU32(model, inverseAt + offset, 4096);
  const dict = writeDictionary([{ name: "mapstudio", data: new Uint8Array(4) }], 4), entry = new DataView(dict.buffer).getUint16(6, true); writeU32(dict, entry + 4, 8 + dict.length);
  const mdl = new Uint8Array(8 + dict.length + model.length); mdl.set(new TextEncoder().encode("MDL0")); writeU32(mdl, 4, mdl.length); mdl.set(dict, 8); mdl.set(model, 8 + dict.length);
  return writeNitroFile(fileHeader("BMD0", 2), [mdl]);
}
function rgb(values: number[]) { return values.reduce((n, v, i) => n | Math.max(0, Math.min(31, Math.round(v))) << (i * 5), 0); }
export function nativeMaterial(source: StudioMaterial, index: number, width: number, height: number): NativeMaterialRecord {
  studioAssert(source.texGen === 0, `Material ${source.name} uses generated texture coordinates. Bake its UVs before inserting.`);
  const bytes = new Uint8Array(44); writeU16(bytes, 0, 0); writeU16(bytes, 2, 44);
  writeU32(bytes, 4, (rgb(source.diffuse) | 0x8000 | rgb(source.ambient) << 16) >>> 0); writeU32(bytes, 8, (rgb(source.specular) | rgb(source.emission) << 16) >>> 0);
  writeU32(bytes, 12, (source.light.reduce((n, v, i) => n | (v ? 1 << i : 0), 0) | (source.bothFaces ? 3 : 2) << 6 | (source.fog ? 1 << 15 : 0) | source.alpha << 16) >>> 0);
  writeU32(bytes, 16, 0x3f1f08ff);
  const wrap = (source.repeatU !== 1 ? 1 : 0) | (source.repeatV !== 1 ? 2 : 0) | (source.repeatU === 2 ? 4 : 0) | (source.repeatV === 2 ? 8 : 0);
  writeU32(bytes, 20, (wrap << 16) >>> 0); writeU32(bytes, 24, 0xffffffff); writeU16(bytes, 30, 15); writeU16(bytes, 32, width); writeU16(bytes, 34, height); writeU32(bytes, 36, 4096); writeU32(bytes, 40, 4096);
  return { name: `ms_mat_${index}`, bytes, textureName: `ms_tex_${index}`, paletteName: `ms_tex_${index}` };
}

