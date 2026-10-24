/** Dense float32 camera samples used by native Gen 5 scenes. Angles are degrees. */
export type NativeCameraTrack = { bytes: Uint8Array; frameCount: number; stride: number; hasScale: boolean; hasRotation: boolean; hasTranslation: boolean };
export type NativeCameraPose = { position: number[]; rotation: number[] };
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
export const cameraTrackEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

export function readNativeCameraTrack(bytes: Uint8Array): NativeCameraTrack {
  if (bytes.length < 8) throw new Error("Camera track is missing its header.");
  const v = view(bytes), frameCount = v.getUint32(0, true), flags = [...bytes.subarray(4, 7)];
  if (flags.some(f => f > 1) || flags[1] !== 1 || flags[2] !== 1) throw new Error("Camera requires rotation and position channels.");
  const stride = flags.reduce((sum, f) => sum + f * 12, 0);
  if (!frameCount || frameCount > 65535 || bytes.length !== 8 + frameCount * stride) throw new Error("Camera track length does not match its frame count.");
  for (let at = 8; at < bytes.length; at += 4) if (!Number.isFinite(v.getFloat32(at, true)) || Math.abs(v.getFloat32(at, true)) >= 524288) throw new Error("Camera sample is not a finite native coordinate.");
  return { bytes, frameCount, stride, hasScale: flags[0] === 1, hasRotation: true, hasTranslation: true };
}

function frameOffset(track: NativeCameraTrack, frame: number): number {
  if (!Number.isInteger(frame) || frame < 0 || frame >= track.frameCount) throw new Error("Camera frame is outside the timeline.");
  return 8 + frame * track.stride + (track.hasScale ? 12 : 0);
}

export function nativeCameraPose(track: NativeCameraTrack, frame: number): NativeCameraPose {
  const at = frameOffset(track, frame), v = view(track.bytes);
  return { rotation: [0, 4, 8].map(i => v.getFloat32(at + i, true)), position: [12, 16, 20].map(i => v.getFloat32(at + i, true)) };
}

/** Preserve presence flags, padding, scale channels, and all untouched sample bits. */
export function writeNativeCameraPose(track: NativeCameraTrack, frame: number, pose: NativeCameraPose): void {
  const at = frameOffset(track, frame), values = [...pose.rotation, ...pose.position];
  if (pose.rotation.length !== 3 || pose.position.length !== 3 || values.some(n => !Number.isFinite(n) || Math.abs(Math.fround(n)) >= 524288)) throw new Error("Enter three finite coordinates and angles within the native range.");
  const v = view(track.bytes); values.forEach((n, i) => v.setFloat32(at + i * 4, n, true));
}

/** Bake into the existing dense timeline without retiming model animation or cues. */
export function interpolateNativeCamera(track: NativeCameraTrack, start: number, end: number, easing: "linear" | "smooth"): void {
  const a = nativeCameraPose(track, start), b = nativeCameraPose(track, end);
  if (end <= start) throw new Error("Range end must be after its start.");
  for (let frame = start + 1; frame < end; frame++) {
    let t = (frame - start) / (end - start); if (easing === "smooth") t = t * t * (3 - 2 * t);
    const rotation = a.rotation.map((v, i) => v + (((b.rotation[i] - v + 180) % 360 + 360) % 360 - 180) * t);
    writeNativeCameraPose(track, frame, { rotation, position: a.position.map((v, i) => v + (b.position[i] - v) * t) });
  }
}
