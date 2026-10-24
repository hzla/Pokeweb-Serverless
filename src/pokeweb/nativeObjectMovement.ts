import { Euler, Matrix4, Quaternion } from "three";
import { writeNativeJointTracks, type NativeJointChannels } from "./nativeJointAnimation";
import { NitroReader, readNitroJointAnimation, type NitroJointPose, type NitroVec3, type NitroMatrix } from "./nitroAnimation";
import { readNitroBasePose } from "./nitroAnimatedModel";
import type { NativeCutsceneDocument } from "./nativeCutsceneModel";

export function readNativeObject(modelBytes: Uint8Array, animationBytes: Uint8Array) {
  const model = new NitroReader(modelBytes), mdl = model.block("BMD0", "MDL0"), entry = model.dictionary(mdl + 8, 4)[0], base = mdl + model.u32(entry.offset);
  const nodes = model.dictionary(base + 64, 4), bases = nodes.map(n => readNitroBasePose(model, base + 64 + model.u32(n.offset)));
  const animation = readNitroJointAnimation(animationBytes, bases);
  const a = new NitroReader(animationBytes), section = a.block("BCA0", "JNT0"), clip = section + a.u32(a.dictionary(section + 8, 4)[0].offset);
  const animatedNodes = new Set(Array.from({ length: a.u16(clip + 6) }, (_, i) => a.u32(clip + a.u16(clip + 20 + i * 2)) >>> 24));
  return { name: entry.name, nodes: nodes.map(n => n.name), bases, animation, animatedNodes };
}

export type NativeJointChange = { translation?: NitroVec3; rotation?: NitroMatrix; scale?: NitroVec3 };
export type NativeJointChannel = 'all' | 'translation' | 'rotation' | 'scale';

/** Local Euler XYZ angles are authoring controls; native resources store matrices. */
export function nativeJointEuler(matrix: NitroMatrix): NitroVec3 {
  const m = new Matrix4().fromArray(matrix).transpose(), e = new Euler().setFromRotationMatrix(m, 'XYZ');
  return [e.x, e.y, e.z].map(n => n * 180 / Math.PI) as NitroVec3;
}
export function nativeJointRotation(degrees: NitroVec3): NitroMatrix {
  if (degrees.some(n => !Number.isFinite(n))) throw new Error('Enter finite joint rotation angles.');
  return new Matrix4().makeRotationFromEuler(new Euler(...degrees.map(n => n * Math.PI / 180) as NitroVec3, 'XYZ')).transpose().toArray();
}
export function interpolateNativeJoint(a: NitroJointPose, b: NitroJointPose, t: number, channel: NativeJointChannel): NativeJointChange {
  const out: NativeJointChange = {};
  if (channel === 'all' || channel === 'translation') out.translation = a.translation.map((n, i) => n + (b.translation[i] - n) * t) as NitroVec3;
  if (channel === 'all' || channel === 'scale') out.scale = a.scale.map((n, i) => n + (b.scale[i] - n) * t) as NitroVec3;
  if (channel === 'all' || channel === 'rotation') {
    const q = (m: NitroMatrix) => new Quaternion().setFromRotationMatrix(new Matrix4().fromArray(m).transpose()).normalize();
    out.rotation = new Matrix4().makeRotationFromQuaternion(q(a.rotation).slerp(q(b.rotation), t)).transpose().toArray();
  }
  return out;
}

export function writeNativeObjectPositions(bytes: Uint8Array, bases: NitroJointPose[], node: number, positions: NitroVec3[]): Uint8Array {
  return writeNativeJointTracks(bytes, bases, new Map([[node, { translation: positions }]]));
}

export function stageNativeObjectTransforms(document: NativeCutsceneDocument, modelId: number, animationId: number, node: number, changes: Map<number, NativeJointChange>): void {
  const object = readNativeObject(document.files[modelId], document.files[animationId]);
  if (!object.bases[node]) throw new Error('Unknown skeletal joint.');
  const tracks: Partial<Record<'translation' | 'rotation' | 'scale', number[][]>> = {};
  for (const [frame, value] of changes) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= object.animation.frameCount) throw new Error('Joint frame is outside the native animation.');
    for (const channel of ['translation', 'rotation', 'scale'] as const) if (value[channel]) {
      if (!tracks[channel]) tracks[channel] = Array.from({ length: object.animation.frameCount }, (_, f) => object.animation.sample(f)[node][channel].slice());
      (tracks[channel] as number[][])[frame] = value[channel]!.slice();
    }
  }
  const original = document.files[animationId], bytes = writeNativeJointTracks(original, object.bases, new Map([[node, tracks as NativeJointChannels]]));
  if (bytes === original) return;
  const edit = document.assets?.get(animationId) ?? { baseline: new Uint8Array(original), bytes };
  edit.bytes = bytes; document.assets ??= new Map(); document.assets.set(animationId, edit); document.files[animationId] = bytes;
}

export function stageNativeObjectPositions(document: NativeCutsceneDocument, modelId: number, animationId: number, node: number, changes: Map<number, NitroVec3>): void {
  stageNativeObjectTransforms(document, modelId, animationId, node, new Map([...changes].map(([frame, translation]) => [frame, { translation }])));
}
