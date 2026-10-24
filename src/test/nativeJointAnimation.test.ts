import { describe, expect, it } from 'vitest';
import { writeU16, writeU32 } from '../nds/binary';
import { NitroReader, nitroIdentityPose, readNitroJointAnimation, type NitroVec3 } from '../pokeweb/nitroAnimation';
import { writeNativeJointTracks } from '../pokeweb/nativeJointAnimation';
import { interpolateNativeJoint, nativeJointEuler, nativeJointRotation } from '../pokeweb/nativeObjectMovement';

function fixture() {
  const bytes = new Uint8Array(512), v = new DataView(bytes.buffer), base = 100;
  const text = (at: number, s: string) => bytes.set(new TextEncoder().encode(s), at);
  text(0, 'BCA0'); writeU32(bytes, 8, bytes.length); writeU16(bytes, 14, 1); writeU32(bytes, 16, 20); text(20, 'JNT0'); writeU32(bytes, 24, bytes.length - 20);
  bytes[29] = 1; writeU16(bytes, 34, 16); writeU16(bytes, 44, 4); writeU16(bytes, 46, 8); writeU32(bytes, 48, base - 20); text(52, 'pose');
  text(base, 'J\0AC'); writeU16(bytes, base + 4, 5); writeU16(bytes, base + 6, 2); writeU32(bytes, base + 12, 220); writeU32(bytes, base + 16, 260);
  writeU16(bytes, base + 20, 28); writeU16(bytes, base + 22, 40);
  writeU32(bytes, 128, 0x404); writeU32(bytes, 132, 0x40040000); writeU32(bytes, 136, 200); writeU32(bytes, 140, 0x01000001);
  [0, 30, 60].forEach((degrees, i) => { writeU16(bytes, 300 + i * 2, 0x8000 | i); writeU16(bytes, 320 + i * 6, 0x28); v.setInt16(322 + i * 6, Math.round(Math.cos(degrees * Math.PI / 180) * 4096), true); v.setInt16(324 + i * 6, Math.round(Math.sin(degrees * Math.PI / 180) * 4096), true); });
  const bases = Array.from({ length: 3 }, nitroIdentityPose); bases[0].translation = [1, 2, 3]; bases[2].translation = [4, 5, 6]; bases[2].scale = [1.5, 2, .5]; bases[2].inverseScale = [2 / 3, .5, 2];
  return { bytes, bases };
}
const closeMatrix = (a: number[], b: number[], tolerance = .001) => a.forEach((n, i) => expect(Math.abs(n - b[i])).toBeLessThan(tolerance));

describe('native skeletal transform authoring', () => {
  it('owns copies of Node Buffer and subarray input before rewriting offsets and rotation indices', () => {
    const { bytes, bases } = fixture(), backing = Buffer.alloc(bytes.length + 32, 0xab), input = backing.subarray(16, 16 + bytes.length); input.set(bytes); const original = Buffer.from(backing);
    const scale: NitroVec3[] = Array.from({ length: 5 }, (_, f) => [1 + f / 4, 1, 1]);
    const result = writeNativeJointTracks(input, bases, new Map([[0, { scale }]]));
    expect(backing).toEqual(original); expect(readNitroJointAnimation(input, bases).sample(2)[0].scale).toEqual([1, 1, 1]);
    expect(readNitroJointAnimation(result, bases).sample(2)[0].scale).toEqual([1.5, 1, 1]);
    result.fill(0); expect(backing).toEqual(original);
  });
  it('writes all channels, including native inverse scale, without changing other frames or joints', () => {
    const { bytes, bases } = fixture(), beforeBytes = bytes.slice(), before = readNitroJointAnimation(bytes, bases);
    const translation = Array.from({ length: 5 }, (_, f) => before.sample(f)[0].translation), rotation = Array.from({ length: 5 }, (_, f) => before.sample(f)[0].rotation), scale = Array.from({ length: 5 }, (_, f) => before.sample(f)[0].scale);
    translation[2] = [8, -3, 2]; rotation[2] = nativeJointRotation([22.5, -35, 77]); scale[2] = [2, .5, -1.25];
    const out = writeNativeJointTracks(bytes, bases, new Map([[0, { translation, rotation, scale }]])), after = readNitroJointAnimation(out, bases);
    expect(after.sample(2)[0].translation).toEqual(translation[2]); closeMatrix(after.sample(2)[0].rotation, rotation[2]); expect(after.sample(2)[0].scale).toEqual(scale[2]); closeMatrix(after.sample(2)[0].inverseScale, [.5, 2, -.8], .00025);
    for (let f = 0; f < 5; f++) { expect(after.sample(f)[1]).toEqual(before.sample(f)[1]); expect(after.sample(f)[2]).toEqual(before.sample(f)[2]); if (f !== 2) closeMatrix(after.sample(f)[0].rotation, before.sample(f)[0].rotation); }
    expect(bytes).toEqual(beforeBytes);
  });
  it('preserves compressed rotations bit-for-bit when only translation or scale changes', () => {
    const { bytes, bases } = fixture(), before = readNitroJointAnimation(bytes, bases), scale: NitroVec3[] = Array.from({ length: 5 }, (_, f) => [1 + f / 4, 1, 1]);
    const out = writeNativeJointTracks(bytes, bases, new Map([[0, { scale }]])), after = readNitroJointAnimation(out, bases);
    for (let f = 0; f < 5; f++) { expect(after.sample(f)[0].rotation).toEqual(before.sample(f)[0].rotation); expect(after.sample(f)[0].translation).toEqual(before.sample(f)[0].translation); }
  });
  it('retains existing collapsed scale samples and their stored inverses outside the edit', () => {
    const { bytes, bases } = fixture(); bases[0].scale = [0, 1, 1]; bases[0].inverseScale = [3, 1, 1];
    const scale: NitroVec3[] = Array.from({ length: 5 }, () => [0, 1, 1]); scale[2] = [2, 1, 1];
    const after = readNitroJointAnimation(writeNativeJointTracks(bytes, bases, new Map([[0, { scale }]])), bases);
    expect(after.sample(0)[0].scale[0]).toBe(0); expect(after.sample(0)[0].inverseScale[0]).toBe(3);
    expect(after.sample(2)[0].scale[0]).toBe(2); expect(after.sample(2)[0].inverseScale[0]).toBe(.5);
  });
  it('adds a previously absent joint track and expands an identity record without losing fallback channels', () => {
    const { bytes, bases } = fixture(), rotation = Array.from({ length: 5 }, (_, f) => nativeJointRotation([f * 20, f * 15, 0]));
    const out = writeNativeJointTracks(bytes, bases, new Map([[2, { rotation }], [1, { scale: Array.from({ length: 5 }, () => [2, 3, 4] as NitroVec3) }]])), after = readNitroJointAnimation(out, bases);
    expect(after.sample(3)[2].translation).toEqual(bases[2].translation); expect(after.sample(3)[2].scale).toEqual(bases[2].scale); expect(after.sample(3)[2].inverseScale).toEqual(bases[2].inverseScale); closeMatrix(after.sample(3)[2].rotation, rotation[3]);
    expect(after.sample(3)[1].translation).toEqual([0, 0, 0]); expect(after.sample(3)[1].rotation).toEqual(nitroIdentityPose().rotation); expect(after.sample(3)[1].scale).toEqual([2, 3, 4]);
  });
  it('encodes all axis pivots and compound rotations with a bounded native matrix error', () => {
    const { bytes, bases } = fixture();
    for (let i = 0; i < 90; i++) {
      const degrees: NitroVec3 = i < 3 ? [i === 0 ? 90 : 0, i === 1 ? -90 : 0, i === 2 ? 180 : 0] : [i * 37.3, i * -11.7, i * 23.1], matrix = nativeJointRotation(degrees);
      const out = writeNativeJointTracks(bytes, bases, new Map([[0, { rotation: Array.from({ length: 5 }, () => matrix) }]]));
      closeMatrix(readNitroJointAnimation(out, bases).sample(2)[0].rotation, matrix);
    }
  });
  it('keeps no-op resources exact and repeated edits bounded', () => {
    const { bytes, bases } = fixture(), before = readNitroJointAnimation(bytes, bases);
    expect(writeNativeJointTracks(bytes, bases, new Map([[0, { rotation: Array.from({ length: 5 }, (_, f) => before.sample(f)[0].rotation) }]]))).toBe(bytes);
    let out: Uint8Array = bytes;
    for (let i = 0; i < 80; i++) out = writeNativeJointTracks(out, bases, new Map([[0, { rotation: Array.from({ length: 5 }, () => nativeJointRotation([i, i / 2, -i / 3])) }]]));
    expect(out.length).toBeLessThan(512); expect(new NitroReader(out).block('BCA0', 'JNT0')).toBe(20);
  });
  it('rejects zero/overflowing scales, malformed rotations, bad durations and unknown joints before mutation', () => {
    const { bytes, bases } = fixture(), copy = bytes.slice();
    expect(() => writeNativeJointTracks(bytes, bases, new Map([[0, { scale: Array.from({ length: 5 }, () => [0, 1, 1] as NitroVec3) }]]))).toThrow('nonzero');
    expect(() => writeNativeJointTracks(bytes, bases, new Map([[0, { scale: Array.from({ length: 5 }, () => [524288, 1, 1] as NitroVec3) }]]))).toThrow('range');
    const bad = nativeJointRotation([0, 0, 0]); bad[0] = 2;
    expect(() => writeNativeJointTracks(bytes, bases, new Map([[0, { rotation: Array.from({ length: 5 }, () => bad) }]]))).toThrow('orthonormal');
    expect(() => writeNativeJointTracks(bytes, bases, new Map([[0, { rotation: [] }]]))).toThrow('duration');
    expect(() => writeNativeJointTracks(bytes, bases, new Map([[99, {}]]))).toThrow('Unknown'); expect(bytes).toEqual(copy);
  });
  it('uses shortest-arc rotations in ranges and isolates selected channels', () => {
    const a = nitroIdentityPose(), b = nitroIdentityPose(); a.rotation = nativeJointRotation([0, 0, 170]); b.rotation = nativeJointRotation([0, 0, -170]); b.translation = [10, 20, 30]; b.scale = [3, 2, .5];
    const middle = interpolateNativeJoint(a, b, .5, 'all'); expect(middle.translation).toEqual([5, 10, 15]); expect(middle.scale).toEqual([2, 1.5, .75]); expect(Math.abs(nativeJointEuler(middle.rotation!)[2])).toBeCloseTo(180);
    expect(Object.keys(interpolateNativeJoint(a, b, .5, 'rotation'))).toEqual(['rotation']);
    closeMatrix(nativeJointRotation(nativeJointEuler(nativeJointRotation([35, -28, 72]))), nativeJointRotation([35, -28, 72]), 1e-10);
  });
});
