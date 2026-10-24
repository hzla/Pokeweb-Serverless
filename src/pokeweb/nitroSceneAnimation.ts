import { NitroReader, nitroSampleIndices, type NitroVec3 } from "./nitroAnimation";

export type NitroMaterialSample = { diffuse: NitroVec3; ambient: NitroVec3; specular: NitroVec3; emission: NitroVec3; alpha: number };
const rgb = (n: number): NitroVec3 => [n & 31, n >>> 5 & 31, n >>> 10 & 31].map(v => v / 31) as NitroVec3;
function animation(r: NitroReader, stamp: string, block: string, signature: string) {
  const section = r.block(stamp, block), entries = r.dictionary(section + 8, 4);
  if (entries.length !== 1) throw new Error("Expected one scene animation per resource.");
  const base = section + r.u32(entries[0].offset), frameCount = r.u16(base + 4);
  if (r.text(base, 4) !== signature || !frameCount) throw new Error("Invalid scene animation header.");
  return { base, frameCount };
}
export function readNitroVisibility(bytes: Uint8Array, nodeCount: number) {
  const r = new NitroReader(bytes), { base, frameCount } = animation(r, "BVA0", "VIS0", "V\0AV"), count = r.u16(base + 6);
  if (!count || count > nodeCount) throw new Error("Visibility animation references missing joints.");
  const size = 12 + Math.ceil(frameCount * count / 32) * 4;
  if (r.u16(base + 8) !== size) throw new Error("Invalid visibility animation size.");
  r.check(base, size);
  return { frameCount, sample(frame: number, node: number) {
    if (node < 0 || node >= count) return undefined;
    const bit = Math.max(0, Math.min(frameCount - 1, Math.floor(frame))) * count + node;
    return Boolean(r.u32(base + 12 + (bit >>> 5) * 4) & 1 << (bit & 31));
  } };
}
export function readNitroMaterialAnimation(bytes: Uint8Array) {
  const r = new NitroReader(bytes), { base, frameCount } = animation(r, "BMA0", "MAT0", "M\0AM");
  const tracks = r.dictionary(base + 8, 20).map(entry => {
    const channels = Array.from({ length: 5 }, (_, channel) => {
      const flags = r.u32(entry.offset + channel * 4), constant = Boolean(flags & 0x20000000), step = 1 << (flags >>> 30), last = flags >>> 16 & 0x1fff, start = base + (flags & 0xffff), width = channel === 4 ? 1 : 2;
      if (step > 4 || !constant && step > 1 && (last >= frameCount || last % step)) throw new Error("Invalid material animation sampling.");
      if (!constant) r.check(start, (nitroSampleIndices(frameCount - 1, step, last)[1] + 1) * width);
      const read = (i: number) => constant ? flags & (width === 1 ? 255 : 65535) : width === 1 ? r.u8(start + i) : r.u16(start + i * 2);
      return (frame: number): NitroVec3 | number => {
        const [a, b, t] = constant ? [0, 0, 0] : nitroSampleIndices(frame, step, last);
        if (width === 1) return (read(a) * (1 - t) + read(b) * t) / 31;
        const x = rgb(read(a)), y = rgb(read(b)); return x.map((v, i) => v * (1 - t) + y[i] * t) as NitroVec3;
      };
    });
    return { name: entry.name, channels };
  });
  return { frameCount, sample(frame: number): Map<string, NitroMaterialSample> {
    const f = Math.max(0, Math.min(frameCount - 1, Math.floor(frame)));
    return new Map(tracks.map(({ name, channels: c }) => [name, { diffuse: c[0](f) as NitroVec3, ambient: c[1](f) as NitroVec3, specular: c[2](f) as NitroVec3, emission: c[3](f) as NitroVec3, alpha: c[4](f) as number }]));
  } };
}
