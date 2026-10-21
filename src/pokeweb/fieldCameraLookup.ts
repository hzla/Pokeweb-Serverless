/** White 2's camera selector is a 48-byte Thumb function with two private literals. */
export const FIELD_CAMERA_LOOKUP_ADDRESS = 0x02018e38;
export type FieldCameraLayout = { kind: "native" } | { kind: "indexed"; firstZoneMember: number };
export type FieldCameraBinding = { zoneId: number; memberId: number; offset?: number };
const nativeBody = [8, 75, 0, 36, 97, 0, 89, 90, 74, 5, 82, 13, 144, 66, 2, 209, 8, 4, 192, 14, 16, 189, 100, 28];
const dataView = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function thumbCall(bytes: Uint8Array, at: number, target: number): void {
  const delta = target - (FIELD_CAMERA_LOOKUP_ADDRESS + at + 4), v = dataView(bytes);
  v.setUint16(at, 0xf000 | ((delta >> 12) & 2047), true);
  v.setUint16(at + 2, 0xf800 | ((delta >> 1) & 2047), true);
}

export function indexedCameraLookup(firstZoneMember: number): Uint8Array {
  if (!Number.isInteger(firstZoneMember) || firstZoneMember < 1 || firstZoneMember >= 65535) throw new Error("Invalid camera archive prefix length.");
  const bytes = new Uint8Array(48), v = dataView(bytes);
  const words = [
    [0, 0xb510],       // Preserve the caller's r4 and return address.
    [6, 0x4908],       // First zone member, from the private literal at +40.
    [8, 0x1844],       // Member = native resolved zone + first zone member.
    [10, 0x209c],      // Camera region archive ID.
    [16, 0x4284],      // Do not query members beyond the archive's file count.
    [18, 0xd207],
    [20, 0x1c21],
    [22, 0x209c],
    [28, 0x2800],      // Empty members follow the existing no-region path.
    [30, 0xd001],
    [32, 0x1c20],
    [34, 0xbd10],
    [36, 0x4801],
    [38, 0xbd10],
  ];
  for (const [at, word] of words) v.setUint16(at, word, true);
  thumbCall(bytes, 2, 0x020187ec); // Keep native zone substitutions.
  thumbCall(bytes, 12, 0x0204a9e4); // Read archive member count without allocating.
  thumbCall(bytes, 24, 0x0204aa30); // Read member length without loading its contents.
  v.setUint32(40, firstZoneMember, true); v.setUint32(44, 65535, true);
  return bytes;
}

export function readFieldCameraLayout(arm9: Uint8Array, base: number): FieldCameraLayout {
  const at = FIELD_CAMERA_LOOKUP_ADDRESS - base;
  if (at < 0 || at + 48 > arm9.length) throw new Error("This ROM's camera lookup is not supported. US White 2 revision 0 is required.");
  const bytes = arm9.subarray(at, at + 48), v = dataView(bytes);
  const candidateBase = v.getUint32(40, true);
  if (candidateBase > 0 && candidateBase < 65535 && indexedCameraLookup(candidateBase).every((n, i) => bytes[i] === n)) return { kind: "indexed", firstZoneMember: candidateBase };
  const prologue = new Uint8Array(6); dataView(prologue).setUint16(0, 0xb510, true); thumbCall(prologue, 2, 0x020187ec);
  if (!prologue.every((n, i) => bytes[i] === n) || !nativeBody.every((n, i) => bytes[i + 6] === n) || bytes[31] !== 0x2c || v.getUint16(32, true) !== 0xd3f3 || v.getUint32(44, true) !== 65535) {
    throw new Error("This ROM's camera lookup is not supported. US White 2 revision 0 is required.");
  }
  return { kind: "native" };
}

export function readFieldCameraBindings(arm9: Uint8Array, base: number, members?: readonly Uint8Array[]): FieldCameraBinding[] {
  const layout = readFieldCameraLayout(arm9, base);
  if (layout.kind === "indexed") {
    if (!members || members.length < layout.firstZoneMember) throw new Error("The expanded camera archive is missing its retained members.");
    return members.flatMap((bytes, memberId) => memberId >= layout.firstZoneMember && bytes.length ? [{ zoneId: memberId - layout.firstZoneMember, memberId }] : []);
  }
  const at = FIELD_CAMERA_LOOKUP_ADDRESS - base, v = dataView(arm9);
  const count = arm9[at + 30], table = v.getUint32(at + 40, true) - base;
  if (count < 1 || table < 0 || table + count * 2 > arm9.length) throw new Error("Invalid native camera binding table.");
  const bindings = Array.from({ length: count }, (_, i) => {
    const offset = table + i * 2, packed = v.getUint16(offset, true);
    return { zoneId: packed & 2047, memberId: packed >>> 11, offset };
  });
  if (new Set(bindings.map(b => b.zoneId)).size !== bindings.length) throw new Error("Duplicate native camera zone bindings.");
  return bindings;
}

/** Check both called metadata readers before installing the expanded selector. */
export function validateCameraArchiveReaders(arm9: Uint8Array, base: number): void {
  const windows = [
    { address: 0x0204a9e4, bytes: [0x18, 0xb5, 0x95, 0xb0, 0x01, 0x1c, 0x00, 0x20, 0x03, 0xac] },
    { address: 0x0204aa30, bytes: [0x38, 0xb5, 0x92, 0xb0, 0x02, 0x1c, 0x00, 0xad, 0x0c, 0x1c] },
  ];
  for (const window of windows) {
    const at = window.address - base;
    if (at < 0 || !window.bytes.every((n, i) => arm9[at + i] === n)) throw new Error("The ROM's camera archive readers have been modified. Camera expansion cannot be installed safely.");
  }
}
