import { NitroReader, nitroSampleIndices, readNitroJointAnimation, type NitroJointPose, type NitroMatrix, type NitroVec3 } from './nitroAnimation';
import { align } from './nitroResourceWriter';
import { writeU16, writeU32 } from '../nds/binary';

export type NativeJointChannels = { translation?: NitroVec3[]; rotation?: NitroMatrix[]; scale?: NitroVec3[] };
type Piece = { bytes: Uint8Array; data?: Uint8Array; rotation?: boolean };
type JointRecord = { node: number; tag: number; translation: Piece[]; rotation: Piece[]; scale: Piece[] };
const fixed = (n: number) => {
  const value = Math.round(n * 4096);
  if (!Number.isFinite(n) || value < -2147483648 || value > 2147483647) throw new Error('Joint value exceeds the native fixed-point range.');
  return value;
};
const wordArray = (values: number[]) => { const bytes = new Uint8Array(values.length * 4); values.forEach((n, i) => writeU32(bytes, i * 4, n >>> 0)); return bytes; };
const words = (...values: number[]) => wordArray(values);
const key = (bytes: Uint8Array) => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');

/** Rebuild one native clip, retaining the exact compressed samples of unchanged
 * channels. Pools are collected from live references, so repeated edits do not
 * accumulate abandoned records or dense sample buffers. */
export function writeNativeJointTracks(bytes: Uint8Array, bases: NitroJointPose[], edits: Map<number, NativeJointChannels>): Uint8Array {
  const r = new NitroReader(bytes), section = r.block('BCA0', 'JNT0'), entries = r.dictionary(section + 8, 4);
  if (entries.length !== 1 || r.u16(14) !== 1) throw new Error('Joint editing requires one animation in one native resource block.');
  const base = section + r.u32(entries[0].offset), animation = readNitroJointAnimation(bytes, bases), frames = animation.frameCount;
  let changed = false;
  for (const [node, edit] of edits) {
    if (!Number.isInteger(node) || node < 0 || node > 255 || !bases[node]) throw new Error('Unknown skeletal joint.');
    for (const channel of ['translation', 'rotation', 'scale'] as const) {
      const values = edit[channel]; if (!values) continue;
      if (values.length !== frames) throw new Error('Joint channel duration must match the native animation.');
      values.forEach((v, f) => {
        const prior = animation.sample(f)[node], sampleChanged = v.some((n, i) => Math.abs(n - prior[channel][i]) > 1e-12);
        if (v.length !== (channel === 'rotation' ? 16 : 3) || v.some(n => !Number.isFinite(n))) throw new Error('Enter a complete finite joint transform.');
        if (channel === 'rotation') { if (sampleChanged) validateRotation(v); }
        else v.forEach((n, axis) => { const fx = fixed(n); if (channel === 'scale') { if (!fx && (n !== 0 || prior.scale[axis] !== 0)) throw new Error('Joint scale must remain nonzero at native precision.'); if (fx) fixed(4096 / fx); } });
        if (sampleChanged) changed = true;
      });
    }
  }
  if (!changed) return bytes;
  const oldPivot = base + r.u32(base + 12), oldBasis = base + r.u32(base + 16);
  const pivotEntries: Uint8Array[] = [], basisEntries: Uint8Array[] = [], rotations = new Map<string, number>();
  const storeRotation = (data: Uint8Array, pivot: boolean) => {
    const id = `${pivot ? 'p' : 'b'}${key(data)}`, old = rotations.get(id); if (old !== undefined) return old;
    const pool = pivot ? pivotEntries : basisEntries;
    if (pool.length >= 32768) throw new Error('Joint rotations exceed the native 15-bit pool limit.');
    const index = pool.length | (pivot ? 0x8000 : 0); pool.push(data); rotations.set(id, index); return index;
  };
  const oldRotation = (index: number) => {
    const pivot = Boolean(index & 0x8000), at = (pivot ? oldPivot : oldBasis) + (index & 0x7fff) * (pivot ? 6 : 10), size = pivot ? 6 : 10;
    r.check(at, size); return storeRotation(new Uint8Array(bytes.subarray(at, at + size)), pivot);
  };
  const indices = (data: Uint8Array) => { const out = new Uint8Array(data); for (let i = 0; i < out.length; i += 2) writeU16(out, i, oldRotation(data[i] | data[i + 1] << 8)); return out; };
  const records: JointRecord[] = [];
  for (let i = 0; i < r.u16(base + 6); i++) {
    let p = base + r.u16(base + 20 + i * 2); const tag = r.u32(p), node = tag >>> 24; p += 4;
    const record: JointRecord = { node, tag, translation: [], rotation: [], scale: [] };
    if (!(tag & 1)) {
      const vector = (unit: number, fallback: number, constant: number, components: number) => {
        const out: Piece[] = [];
        if (!(tag & (unit | fallback))) for (let axis = 0; axis < 3; axis++) {
          const size = tag & constant << axis ? components * 4 : 8, raw = new Uint8Array(bytes.subarray(p, p + size)); r.check(p, size);
          if (tag & constant << axis) out.push({ bytes: raw });
          else { const info = r.u32(p), start = base + r.u32(p + 4), step = 1 << (info >>> 30), count = nitroSampleIndices(frames - 1, step, info >>> 16 & 0x1fff)[1] + 1, length = count * components * (info & 0x20000000 ? 2 : 4); r.check(start, length); out.push({ bytes: raw, data: new Uint8Array(bytes.subarray(start, start + length)) }); }
          p += size;
        }
        return out;
      };
      record.translation = vector(2, 4, 8, 1);
      if (!(tag & 0xc0)) {
        if (tag & 0x100) { const raw = new Uint8Array(bytes.subarray(p, p + 4)); writeU16(raw, 0, oldRotation(r.u16(p))); record.rotation.push({ bytes: raw }); p += 4; }
        else { const info = r.u32(p), start = base + r.u32(p + 4), count = nitroSampleIndices(frames - 1, 1 << (info >>> 30), info >>> 16 & 0x1fff)[1] + 1; r.check(start, count * 2); record.rotation.push({ bytes: new Uint8Array(bytes.subarray(p, p + 8)), data: indices(bytes.subarray(start, start + count * 2)), rotation: true }); p += 8; }
      }
      record.scale = vector(0x200, 0x400, 0x800, 2);
    }
    records.push(record);
  }
  for (const [node, edit] of edits) {
    let record = records.find(t => t.node === node);
    if (!record) { record = { node, tag: (node << 24 | 0x484) >>> 0, translation: [], rotation: [], scale: [] }; records.push(record); }
    if (record.tag & 1) record.tag = (record.tag & ~1) | 0x242;
    const vector = (values: NitroVec3[], scale: boolean) => {
      record!.tag &= ~(scale ? 0x3e00 : 0x3e);
      return [0, 1, 2].map(axis => {
        const samples = values.map((v, f) => { const value = fixed(v[axis]); return scale ? [value, value ? fixed(4096 / value) : fixed(animation.sample(f)[node].inverseScale[axis])] : [value]; });
        if (samples.every(v => v.every((n, k) => n === samples[0][k]))) { record!.tag |= (scale ? 0x800 : 8) << axis; return { bytes: words(...samples[0]) }; }
        return { bytes: words(0, 0), data: wordArray(samples.flat()) };
      });
    };
    if (edit.translation) record.translation = vector(edit.translation, false);
    if (edit.scale) record.scale = vector(edit.scale, true);
    if (edit.rotation) {
      record.tag &= ~0x1c0;
      const samples = edit.rotation.map(matrix => { const packed = packRotation(matrix); return storeRotation(packed.bytes, packed.pivot); });
      if (samples.every(n => n === samples[0])) { record.tag |= 0x100; record.rotation = [{ bytes: words(samples[0]) }]; }
      else { const data = new Uint8Array(frames * 2); samples.forEach((n, i) => writeU16(data, i * 2, n)); record.rotation = [{ bytes: words(0, 0), data, rotation: true }]; }
    }
  }
  records.sort((a, b) => a.node - b.node);
  const recordSize = (t: JointRecord) => 4 + [...t.translation, ...t.rotation, ...t.scale].reduce((n, p) => n + p.bytes.length, 0);
  let cursor = align(base + 20 + records.length * 2);
  const offsets = records.map(record => { const at = cursor; cursor += recordSize(record); if (at - base > 65535) throw new Error('Joint records exceed the native 16-bit offset limit.'); return at; });
  const header = new Uint8Array(bytes.subarray(0, base + 20)), recordEnd = align(cursor), parts: Array<{ at: number; data: Uint8Array }> = [], dataOffsets = new Map<string, number>(); cursor = recordEnd;
  const append = (data: Uint8Array) => { const id = key(data), prior = dataOffsets.get(id); if (prior !== undefined) return prior; const at = cursor; parts.push({ at, data }); cursor += align(data.length); dataOffsets.set(id, at); return at; };
  const prepared = records.map(record => [...record.translation, ...record.rotation, ...record.scale].map(piece => {
    const raw = new Uint8Array(piece.bytes); if (piece.data) writeU32(raw, 4, append(piece.data) - base); return raw;
  }));
  const join = (pool: Uint8Array[]) => { const out = new Uint8Array(pool.reduce((n, b) => n + b.length, 0)); let at = 0; for (const b of pool) { out.set(b, at); at += b.length; } return out; };
  const pivot = append(join(pivotEntries)), basis = append(join(basisEntries));
  const out = new Uint8Array(cursor); out.set(header); writeU16(out, base + 6, records.length); writeU32(out, base + 12, pivot - base); writeU32(out, base + 16, basis - base);
  records.forEach((record, i) => { let at = offsets[i]; writeU16(out, base + 20 + i * 2, at - base); writeU32(out, at, record.tag >>> 0); at += 4; for (const raw of prepared[i]) { out.set(raw, at); at += raw.length; } });
  for (const { at, data } of parts) out.set(data, at);
  writeU32(out, 8, out.length); writeU32(out, section + 4, out.length - section);
  readNitroJointAnimation(out, bases); return out;
}

function validateRotation(m: NitroMatrix) {
  if ([3, 7, 11, 12, 13, 14].some(i => Math.abs(m[i]) > 1e-8) || Math.abs(m[15] - 1) > 1e-8) throw new Error('Joint rotation must be a pure rotation matrix.');
  for (let a = 0; a < 3; a++) for (let b = a; b < 3; b++) { const dot = m[a] * m[b] + m[4 + a] * m[4 + b] + m[8 + a] * m[8 + b]; if (Math.abs(dot - Number(a === b)) > .002) throw new Error('Joint rotation axes must be orthonormal.'); }
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
  if (Math.abs(det - 1) > .003) throw new Error('Joint rotation must have positive unit determinant.');
}

/** Native basis entries hold two columns in five signed words. The sixth
 * component occupies their low bits; the engine derives the final column. */
function packRotation(matrix: NitroMatrix): { bytes: Uint8Array; pivot: boolean } {
  const columns = [matrix[0], matrix[4], matrix[8], matrix[1], matrix[5], matrix[9], matrix[2], matrix[6], matrix[10]];
  const patterns = [[4, 5, 7, 8], [3, 5, 6, 8], [3, 4, 6, 7], [1, 2, 7, 8], [0, 2, 6, 8], [0, 1, 6, 7], [1, 2, 4, 5], [0, 2, 3, 5], [0, 1, 3, 4]];
  for (let pivot = 0; pivot < 9; pivot++) {
    if (Math.abs(Math.abs(columns[pivot]) - 1) > 1e-8) continue;
    const positions = patterns[pivot], a = fixed(columns[positions[0]]), b = fixed(columns[positions[1]]);
    for (let signs = 0; signs < 8; signs++) {
      const expected = Array<number>(9).fill(0); expected[pivot] = signs & 1 ? -1 : 1;
      expected[positions[0]] = a / 4096; expected[positions[1]] = b / 4096; expected[positions[2]] = (signs & 2 ? -b : b) / 4096; expected[positions[3]] = (signs & 4 ? -a : a) / 4096;
      if (expected.some((n, i) => Math.abs(n - columns[i]) > 1 / 4096)) continue;
      const bytes = new Uint8Array(6), v = new DataView(bytes.buffer); writeU16(bytes, 0, pivot | signs << 4); v.setInt16(2, a, true); v.setInt16(4, b, true); return { bytes, pivot: true };
    }
  }
  const values = columns.slice(0, 6).map(n => Math.max(-4096, Math.min(4095, fixed(n)))), last = values[5], bytes = new Uint8Array(10), v = new DataView(bytes.buffer);
  [9, 6, 3, 0, 12].forEach((shift, i) => v.setInt16(i * 2, values[i] << 3 | last >> shift & 7, true));
  return { bytes, pivot: false };
}
