/** Nitro joint/texture animation evaluation, following TwlSystem g3d/anm.
 * Matrices here are row-major and multiply column vectors (the transpose of
 * the SDK's stored matrices). Playback samples integer DS frames.
 */
export type NitroVec3 = [number, number, number];
export type NitroMatrix = number[];
export type NitroJointPose = { translation: NitroVec3; rotation: NitroMatrix; scale: NitroVec3; inverseScale: NitroVec3 };
export type NitroTextureSrt = { scaleS: number; scaleT: number; sin: number; cos: number; transS: number; transT: number };

export class NitroReader {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  check(offset: number, size: number): void {
    if (!Number.isInteger(offset) || offset < 0 || size < 0 || offset + size > this.bytes.length) throw new Error("Truncated Nitro model or animation data.");
  }
  u8(o: number): number { this.check(o, 1); return this.view.getUint8(o); }
  u16(o: number): number { this.check(o, 2); return this.view.getUint16(o, true); }
  s16(o: number): number { this.check(o, 2); return this.view.getInt16(o, true); }
  u32(o: number): number { this.check(o, 4); return this.view.getUint32(o, true); }
  s32(o: number): number { this.check(o, 4); return this.view.getInt32(o, true); }
  fx(o: number): number { return this.s32(o) / 4096; }
  text(o: number, size: number): string { this.check(o, size); return String.fromCharCode(...this.bytes.subarray(o, o + size)); }
  block(stamp: string, kind: string): number {
    if (this.text(0, 4) !== stamp || this.u32(8) !== this.bytes.length) throw new Error(`Invalid ${stamp} resource.`);
    const count = this.u16(14);
    for (let i = 0; i < count; i++) {
      const offset = this.u32(16 + i * 4);
      this.check(offset, this.u32(offset + 4));
      if (this.text(offset, 4) === kind) return offset;
    }
    throw new Error(`Missing ${kind} resource block.`);
  }
  dictionary(offset: number, expectedStride: number): Array<{ offset: number; name: string }> {
    const count = this.u8(offset + 1), entry = offset + this.u16(offset + 6);
    const stride = this.u16(entry), names = entry + this.u16(entry + 2);
    if (stride !== expectedStride) throw new Error("Unexpected Nitro dictionary entry size.");
    this.check(entry + 4, count * stride); this.check(names, count * 16);
    return Array.from({ length: count }, (_, i) => ({ offset: entry + 4 + i * stride, name: this.text(names + i * 16, 16).split("\0")[0] }));
  }
}

export function nitroIdentity(): NitroMatrix { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
export function nitroMul(a: NitroMatrix, b: NitroMatrix): NitroMatrix {
  const result = Array<number>(16);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) result[row * 4 + col] = a[row * 4] * b[col] + a[row * 4 + 1] * b[col + 4] + a[row * 4 + 2] * b[col + 8] + a[row * 4 + 3] * b[col + 12];
  return result;
}
export function nitroScale(v: NitroVec3): NitroMatrix { const m = nitroIdentity(); m[0] = v[0]; m[5] = v[1]; m[10] = v[2]; return m; }
export function nitroTranslation(v: NitroVec3): NitroMatrix { const m = nitroIdentity(); m[3] = v[0]; m[7] = v[1]; m[11] = v[2]; return m; }
export function nitroTransform(m: NitroMatrix, v: NitroVec3, vector = false): NitroVec3 {
  return [0, 1, 2].map((r) => m[r * 4] * v[0] + m[r * 4 + 1] * v[1] + m[r * 4 + 2] * v[2] + (vector ? 0 : m[r * 4 + 3])) as NitroVec3;
}
export function nitroStoredMatrix(values: number[], columns: number, rows: number): NitroMatrix {
  const m = nitroIdentity();
  for (let c = 0; c < columns; c++) for (let r = 0; r < rows; r++) m[r * 4 + c] = values[c * rows + r];
  return m;
}
export function nitroIdentityPose(): NitroJointPose { return { translation: [0, 0, 0], rotation: nitroIdentity(), scale: [1, 1, 1], inverseScale: [1, 1, 1] }; }

const PIVOTS = [[4, 5, 7, 8], [3, 5, 6, 8], [3, 4, 6, 7], [1, 2, 7, 8], [0, 2, 6, 8], [0, 1, 6, 7], [1, 2, 4, 5], [0, 2, 3, 5], [0, 1, 3, 4]];
export function nitroPivotRotation(pivot: number, signs: number, a: number, b: number): NitroMatrix {
  const positions = PIVOTS[pivot];
  if (!positions) throw new Error("Invalid Nitro rotation pivot.");
  const v = Array<number>(9).fill(0); v[pivot] = signs & 1 ? -1 : 1;
  v[positions[0]] = a; v[positions[1]] = b; v[positions[2]] = signs & 2 ? -b : b; v[positions[3]] = signs & 4 ? -a : a;
  return nitroStoredMatrix(v, 3, 3);
}

/** Tail frames after lastInterp are stored individually, even on step-2/4 tracks. */
export function nitroSampleIndices(frame: number, step: number, lastInterp: number): [number, number, number] {
  if (step === 1) return [frame, frame, 0];
  if (frame > lastInterp) { const index = lastInterp / step + frame - lastInterp; return [index, index, 0]; }
  const lo = Math.floor(frame / step), fraction = frame % step / step;
  return [lo, fraction ? lo + 1 : lo, fraction];
}

type Channel = (frame: number) => number;
function sampledChannel(r: NitroReader, base: number, info: number, offset: number, frames: number, component: number, components: number, texture = false): Channel {
  const rate = info >>> 30;
  if (rate > 2) throw new Error("Unsupported Nitro animation sample rate.");
  const step = 1 << rate, last = texture ? info & 0xffff : info >>> 16 & 0x1fff;
  if (step > 1 && (last >= frames || last % step !== 0)) throw new Error("Invalid Nitro animation interpolation boundary.");
  const width = info & (texture ? 0x10000000 : 0x20000000) ? 2 : 4;
  const start = base + offset, max = nitroSampleIndices(frames - 1, step, last)[1];
  r.check(start, (max + 1) * width * components);
  const read = (i: number) => (width === 2 ? r.s16(start + (i * components + component) * width) : r.s32(start + (i * components + component) * width)) / 4096;
  return (f) => { const [a, b, t] = nitroSampleIndices(f, step, last); return read(a) * (1 - t) + read(b) * t; };
}

function firstAnimation(r: NitroReader, stamp: string, block: string, signature: string): number {
  const section = r.block(stamp, block), entries = r.dictionary(section + 8, 4);
  if (entries.length !== 1) throw new Error("Title resources must contain one animation.");
  const offset = section + r.u32(entries[0].offset);
  if (r.text(offset, 4) !== signature || !r.u16(offset + 4)) throw new Error("Invalid Nitro animation header.");
  return offset;
}

function normalizeColumns(m: NitroMatrix, cross: boolean): NitroMatrix {
  for (let c = 0; c < (cross ? 2 : 3); c++) {
    const length = Math.hypot(m[c], m[4 + c], m[8 + c]);
    if (length > 1e-12) for (let r = 0; r < 3; r++) m[r * 4 + c] /= length;
  }
  if (cross) {
    m[2] = m[4] * m[9] - m[8] * m[5]; m[6] = m[8] * m[1] - m[0] * m[9]; m[10] = m[0] * m[5] - m[4] * m[1];
  }
  return m;
}

export function readNitroJointAnimation(bytes: Uint8Array, bases: NitroJointPose[]): { frameCount: number; sample: (frame: number) => NitroJointPose[] } {
  const r = new NitroReader(bytes), base = firstAnimation(r, "BCA0", "JNT0", "J\0AC"), frameCount = r.u16(base + 4);
  const pivot = base + r.u32(base + 12), basis = base + r.u32(base + 16);
  const rotations = new Map<number, NitroMatrix>();
  const rotation = (index: number): NitroMatrix => {
    const cached = rotations.get(index); if (cached) return cached;
    const off = index & 0x7fff;
    let m: NitroMatrix;
    if (index & 0x8000) {
      const p = pivot + off * 6, flags = r.u16(p);
      m = nitroPivotRotation(flags & 15, flags >>> 4, r.s16(p + 2) / 4096, r.s16(p + 4) / 4096);
    } else {
      const p = basis + off * 10, d = Array.from({ length: 5 }, (_, i) => r.s16(p + i * 2));
      let packed = d[4] & 7; for (let i = 0; i < 4; i++) packed = packed << 3 | d[i] & 7;
      const last = packed << 19 >> 19;
      const v = [(d[0] >> 3) / 4096, (d[1] >> 3) / 4096, (d[2] >> 3) / 4096, (d[3] >> 3) / 4096, (d[4] >> 3) / 4096, last / 4096, 0, 0, 0];
      m = normalizeColumns(nitroStoredMatrix(v, 3, 3), true);
    }
    rotations.set(index, m); return m;
  };
  const tracks = new Map<number, (f: number) => NitroJointPose>();
  for (let i = 0; i < r.u16(base + 6); i++) {
    let p = base + r.u16(base + 20 + i * 2); const tag = r.u32(p), node = tag >>> 24; p += 4;
    if (!bases[node] || tracks.has(node)) throw new Error("Joint animation references an unknown or duplicate node.");
    const original = bases[node], identity = nitroIdentityPose();
    if (tag & 1) { tracks.set(node, () => identity); continue; }
    const vector = (identityFlag: number, baseFlag: number, constantFlag: number, fallback: NitroVec3, components = 1): [Channel[], Channel[]] => {
      const values: Channel[] = [], inverses: Channel[] = [];
      for (let axis = 0; axis < 3; axis++) {
        if (tag & (identityFlag | baseFlag)) {
          const v = tag & identityFlag ? (components === 2 ? 1 : 0) : fallback[axis];
          values.push(() => v); inverses.push(() => tag & identityFlag ? 1 : original.inverseScale[axis]);
        } else if (tag & constantFlag << axis) {
          const v = r.fx(p), inv = components === 2 ? r.fx(p + 4) : 1; p += components * 4;
          values.push(() => v); inverses.push(() => inv);
        } else {
          const info = r.u32(p), offset = r.u32(p + 4); p += 8;
          values.push(sampledChannel(r, base, info, offset, frameCount, 0, components));
          inverses.push(components === 2 ? sampledChannel(r, base, info, offset, frameCount, 1, components) : () => 1);
        }
      }
      return [values, inverses];
    };
    const [translation] = vector(2, 4, 8, original.translation);
    let sampleRotation: (f: number) => NitroMatrix;
    if (tag & 0x40) sampleRotation = () => identity.rotation;
    else if (tag & 0x80) sampleRotation = () => original.rotation;
    else if (tag & 0x100) { const m = rotation(r.u16(p)); p += 4; sampleRotation = () => m; }
    else {
      const info = r.u32(p), start = base + r.u32(p + 4); p += 8;
      const rate = info >>> 30, step = 1 << rate, last = info >>> 16 & 0x1fff;
      if (rate > 2 || step > 1 && (last >= frameCount || last % step !== 0)) throw new Error("Invalid rotation sampling boundary.");
      const count = nitroSampleIndices(frameCount - 1, step, last)[1] + 1;
      r.check(start, count * 2);
      for (let j = 0; j < count; j++) rotation(r.u16(start + j * 2));
      sampleRotation = (f) => {
        const [a, b, t] = nitroSampleIndices(f, step, last), ia = r.u16(start + a * 2), ib = r.u16(start + b * 2);
        if (!t) return rotation(ia);
        const ma = rotation(ia), mb = rotation(ib);
        return normalizeColumns(ma.map((v, j) => v * (1 - t) + mb[j] * t), !(ia & ib & 0x8000));
      };
    }
    const [scale, inverse] = vector(0x200, 0x400, 0x800, original.scale, 2);
    tracks.set(node, (f) => ({ translation: translation.map((c) => c(f)) as NitroVec3, rotation: sampleRotation(f), scale: scale.map((c) => c(f)) as NitroVec3, inverseScale: inverse.map((c) => c(f)) as NitroVec3 }));
  }
  return { frameCount, sample: (frame) => {
    const f = Math.max(0, Math.min(frameCount - 1, Math.floor(frame)));
    return bases.map((pose, i) => tracks.get(i)?.(f) ?? pose);
  } };
}

export const NITRO_TEXTURE_IDENTITY: NitroTextureSrt = { scaleS: 1, scaleT: 1, sin: 0, cos: 1, transS: 0, transT: 0 };
export function readNitroTextureAnimation(bytes: Uint8Array): { frameCount: number; sample: (frame: number) => Map<string, NitroTextureSrt> } {
  const r = new NitroReader(bytes), base = firstAnimation(r, "BTA0", "SRT0", "M\0AT"), frameCount = r.u16(base + 4);
  const tracks = r.dictionary(base + 8, 40).map(({ offset, name }) => {
    const channels: Channel[] = [];
    for (let i = 0; i < 5; i++) {
      const info = r.u32(offset + i * 8), data = r.u32(offset + i * 8 + 4);
      if (i === 2) {
        const constant = Boolean(info & 0x20000000), step = 1 << (info >>> 30), last = info & 0xffff, start = base + data;
        if (step > 4 || !constant && step > 1 && (last >= frameCount || last % step)) throw new Error("Invalid texture rotation sampling.");
        if (!constant) r.check(start, (nitroSampleIndices(frameCount - 1, step, last)[1] + 1) * 4);
        const read = (index: number, component: number) => constant ? ((data >>> (component * 16) & 0xffff) << 16 >> 16) / 4096 : r.s16(start + index * 4 + component * 2) / 4096;
        for (let component = 0; component < 2; component++) channels.push((f) => { const [a, b, t] = constant ? [0, 0, 0] : nitroSampleIndices(f, step, last); return read(a, component) * (1 - t) + read(b, component) * t; });
      } else channels.push(info & 0x20000000 ? () => (data | 0) / 4096 : sampledChannel(r, base, info, data, frameCount, 0, 1, true));
    }
    return { name, channels };
  });
  return { frameCount, sample: (frame) => {
    const f = Math.max(0, Math.min(frameCount - 1, Math.floor(frame)));
    return new Map(tracks.map(({ name, channels: c }) => [name, { scaleS: c[0](f), scaleT: c[1](f), sin: c[2](f), cos: c[3](f), transS: c[4](f), transT: c[5](f) }]));
  } };
}

/** Maya's texture transform operates around the image centre with inverted T. */
export function nitroTextureUv(s: number, t: number, width: number, height: number, a: NitroTextureSrt): [number, number] {
  const u = s / width, v = t / height;
  return [a.scaleS * (a.cos * (u - .5) + a.sin * (v - .5) + .5 - a.transS), a.scaleT * (-a.sin * (u - .5) + a.cos * (v - .5) - .5 + a.transT) + 1];
}
