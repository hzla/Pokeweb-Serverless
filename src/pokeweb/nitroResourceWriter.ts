import { concatBytes, readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";

export const align = (n: number, size = 4) => Math.ceil(n / size) * size;
export function ensure(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
export type NitroDictionaryEntry = { name: string; data: Uint8Array };
export function readDictionary(bytes: Uint8Array, offset: number): NitroDictionaryEntry[] {
  ensure(offset >= 0 && offset + 8 <= bytes.length, "Truncated Nitro dictionary.");
  const count = bytes[offset + 1], entry = offset + readU16(bytes, offset + 6);
  const stride = readU16(bytes, entry), names = entry + readU16(bytes, entry + 2);
  ensure(stride > 0 && names + count * 16 <= bytes.length && entry + 4 + stride * count <= bytes.length, "Invalid Nitro dictionary bounds.");
  return Array.from({ length: count }, (_, i) => ({ name: readAscii(bytes, names + i * 16, 16).replace(/\0.*$/, ""), data: bytes.slice(entry + 4 + stride * i, entry + 4 + stride * (i + 1)) }));
}

/** Native name lookup uses a descending-bit Patricia tree, including for material animation bindings. */
export function writeDictionary(entries: NitroDictionaryEntry[], stride: number): Uint8Array {
  ensure(entries.length <= 255 && new Set(entries.map(e => e.name)).size === entries.length, "Nitro dictionaries require at most 255 unique names.");
  ensure(entries.every(e => /^[\x20-\x7e]{1,16}$/.test(e.name) && e.data.length === stride), "Invalid Nitro dictionary name or entry size.");
  const nodes = [{ name: "", bit: 127, left: 0, right: 1, index: 0 }];
  const bit = (name: string, i: number) => ((name.charCodeAt(i >>> 3) || 0) >>> (i & 7)) & 1;
  function traverse(name: string, stop: number) {
    let parent = 0, current = nodes[0].left;
    while (nodes[parent].bit > nodes[current].bit && nodes[current].bit > stop) {
      parent = current; current = bit(name, nodes[current].bit) ? nodes[current].right : nodes[current].left;
    }
    return { parent, current };
  }
  for (const [index, e] of entries.entries()) {
    const previous = nodes[traverse(e.name, -1).current].name;
    let differing = 127;
    while (differing >= 0 && bit(previous, differing) === bit(e.name, differing)) differing--;
    ensure(differing >= 0, "Duplicate Nitro name.");
    const { parent, current } = traverse(e.name, differing), id = nodes.length;
    nodes.push({ name: e.name, bit: differing, left: bit(e.name, differing) ? current : id, right: bit(e.name, differing) ? id : current, index });
    if (bit(e.name, nodes[parent].bit)) nodes[parent].right = id; else nodes[parent].left = id;
  }
  const dataOffset = 8 + nodes.length * 4, namesOffset = 4 + entries.length * stride;
  const out = new Uint8Array(dataOffset + namesOffset + entries.length * 16);
  out[1] = entries.length; writeU16(out, 2, out.length); writeU16(out, 4, 8); writeU16(out, 6, dataOffset);
  nodes.forEach((n, i) => out.set([n.bit, n.left, n.right, n.index], 8 + i * 4));
  writeU16(out, dataOffset, stride); writeU16(out, dataOffset + 2, namesOffset);
  entries.forEach((e, i) => { out.set(e.data, dataOffset + 4 + i * stride); out.set(new TextEncoder().encode(e.name), dataOffset + namesOffset + i * 16); });
  return out;
}
export function nitroBlocks(file: Uint8Array): Uint8Array[] {
  ensure(file.length >= 16, "Truncated Nitro file.");
  return Array.from({ length: readU16(file, 14) }, (_, i) => {
    const offset = readU32(file, 16 + 4 * i), size = readU32(file, offset + 4);
    ensure(size >= 8 && offset + size <= file.length, "Invalid Nitro block."); return file.slice(offset, offset + size);
  });
}
export function writeNitroFile(template: Uint8Array, blocks: Uint8Array[]): Uint8Array {
  const header = template.slice(0, 16), offsets = new Uint8Array(blocks.length * 4);
  let offset = 16 + offsets.length;
  blocks.forEach((b, i) => { ensure(b.length % 4 === 0, "Unaligned Nitro block."); writeU32(offsets, i * 4, offset); offset += b.length; });
  writeU32(header, 8, offset); writeU16(header, 14, blocks.length);
  return concatBytes([header, offsets, ...blocks]);
}
export type NativeMaterialRecord = { name: string; bytes: Uint8Array; textureName?: string; paletteName?: string };
export function materialRecords(template: Uint8Array): NativeMaterialRecord[] {
  const mdl = nitroBlocks(template).find(b => readAscii(b, 0, 4) === "MDL0"); ensure(mdl, "Missing model block.");
  const models = readDictionary(mdl, 8); ensure(models.length === 1, "Only single-model assets are supported.");
  const model = readU32(models[0].data, 0), offset = model + readU32(mdl, model + 8);
  const records: NativeMaterialRecord[] = readDictionary(mdl, offset + 4).map(e => {
    const start = offset + readU32(e.data, 0); return { name: e.name, bytes: mdl.slice(start, start + readU16(mdl, start + 2)) };
  });
  for (const [field, relative] of [["textureName", 0], ["paletteName", 2]] as const) {
    for (const e of readDictionary(mdl, offset + readU16(mdl, offset + relative))) {
      const ids = offset + readU16(e.data, 0);
      for (let i = 0; i < e.data[2]; i++) { ensure(records[mdl[ids + i]], "Invalid material binding."); records[mdl[ids + i]][field] = e.name; }
    }
  }
  return records;
}
export function replaceMaterialRecords(template: Uint8Array, records: NativeMaterialRecord[]): Uint8Array {
  const blocks = nitroBlocks(template), index = blocks.findIndex(b => readAscii(b, 0, 4) === "MDL0");
  ensure(index >= 0, "Missing model block.");
  const mdl = blocks[index], dict = readDictionary(mdl, 8); ensure(dict.length === 1, "Only single-model assets are supported.");
  const modelOffset = readU32(dict[0].data, 0), model = mdl.slice(modelOffset), mat = readU32(model, 8), shape = readU32(model, 12);
  const entries = records.map(r => ({ name: r.name, data: new Uint8Array(4) }));
  let cursor = 4 + writeDictionary(entries, 4).length;
  const associations = (["textureName", "paletteName"] as const).map(field => {
    const groups = new Map<string, number[]>();
    records.forEach((r, i) => { const name = r[field]; if (name) { const ids = groups.get(name) ?? []; ids.push(i); groups.set(name, ids); } });
    const pairs = [...groups].map(([name]) => ({ name, data: new Uint8Array(4) }));
    const offset = cursor; cursor += writeDictionary(pairs, 4).length;
    const ids = [...groups.values()].flat();
    [...groups.values()].forEach((values, i) => { ensure(cursor < 65536, "Material bindings exceed the native offset range."); writeU16(pairs[i].data, 0, cursor); pairs[i].data[2] = values.length; cursor += values.length; });
    const bytes = concatBytes([writeDictionary(pairs, 4), new Uint8Array(ids), new Uint8Array(align(cursor) - cursor)]); cursor = align(cursor);
    return { offset, bytes };
  });
  records.forEach((r, i) => { writeU32(entries[i].data, 0, cursor); cursor += align(r.bytes.length); });
  const segment = new Uint8Array(cursor);
  writeU16(segment, 0, associations[0].offset); writeU16(segment, 2, associations[1].offset);
  segment.set(writeDictionary(entries, 4), 4); associations.forEach(a => segment.set(a.bytes, a.offset));
  records.forEach((r, i) => segment.set(r.bytes, readU32(entries[i].data, 0)));
  const delta = segment.length - (shape - mat), updated = concatBytes([model.subarray(0, mat), segment, model.subarray(shape)]);
  writeU32(updated, 0, readU32(model, 0) + delta); writeU32(updated, 12, shape + delta); writeU32(updated, 16, readU32(model, 16) + delta); updated[24] = records.length;
  blocks[index] = concatBytes([mdl.subarray(0, modelOffset), updated]); writeU32(blocks[index], 4, blocks[index].length);
  return writeNitroFile(template, blocks);
}
