import type { StudioTileset } from "./mapStudioFormats";

const encoder = new TextEncoder();
/** Native PDSMS serialization, including fields unused by the web renderer. */
export function writeStudioTileset(tileset: StudioTileset): Uint8Array {
  let bytes = new Uint8Array(65536), at = 0;
  const reserve = (length: number) => { if (at + length > bytes.length) { const next = new Uint8Array(Math.max(bytes.length * 2, at + length)); next.set(bytes); bytes = next; } };
  const byte = (n: number) => { reserve(1); bytes[at++] = n; };
  const int = (n: number) => { reserve(4); new DataView(bytes.buffer).setInt32(at, n); at += 4; };
  const header = (tag: number, length: number) => { byte(tag); int(length); };
  const ints = (tag: number, values: number[]) => { header(tag, values.length); for (const n of values) int(n); };
  const scalar = (tag: number, n: number | boolean | undefined) => { if (n !== undefined) ints(tag, [Number(n)]); };
  const floats = (tag: number, values: number[]) => { header(tag, values.length); reserve(values.length * 4); const view = new DataView(bytes.buffer); for (const n of values) { view.setFloat32(at, n); at += 4; } };
  const string = (tag: number, value: string) => { const text = encoder.encode(value); header(tag, text.length); reserve(text.length); bytes.set(text, at); at += text.length; };
  for (const [i, m] of tileset.materials.entries()) {
    scalar(9, i); string(1, m.image); string(4, m.name); string(2, m.palette); string(3, m.texture);
    scalar(30, m.fog); scalar(31, m.bothFaces); scalar(32, m.normalOrientation); scalar(35, m.includeInImd);
    for (let light = 0; light < 4; light++) scalar(43 + light, m.light[light]);
    for (const [index, rgb] of [m.diffuse, m.ambient, m.specular, m.emission].entries()) { header(53 + index, 3); for (const n of rgb) byte(n); }
    scalar(47, m.renderBorder); scalar(48, m.vertexColors); scalar(33, m.alpha); scalar(34, m.texGen); scalar(40, m.repeatU); scalar(41, m.repeatV); scalar(42, m.colorFormat); scalar(10, i);
  }
  for (const smart of tileset.smart) { header(26, smart.length); for (const column of smart) { int(column.length); for (const n of column) int(n); } }
  for (const [i, t] of tileset.tiles.entries()) {
    scalar(0, i); scalar(11, t.width); scalar(12, t.height); scalar(13, t.tileX); scalar(14, t.tileY); scalar(36, t.tileU); scalar(37, t.tileV); scalar(27, t.globalMapping);
    floats(28, [t.globalScale]); floats(38, [t.x]); floats(39, [t.y]); floats(23, [t.z]); floats(15, t.vertices); floats(16, t.uvs); floats(22, t.normals); floats(49, t.colors);
    for (const [tag, faces] of [[50, t.quads], [51, t.triangles]] as const) { header(tag, faces.length); for (const f of faces) for (const indices of [f.v, f.t, f.n, f.c]) for (const n of indices) int(n); }
    ints(19, t.materials); ints(24, t.quadOffsets); ints(25, t.triOffsets); string(21, t.name);
  }
  return bytes.slice(0, at);
}

