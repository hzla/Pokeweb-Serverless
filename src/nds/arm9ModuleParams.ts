import { readU32, writeU32 } from "./binary";

const ARM9_MODULE_PARAMS_MAGIC = [0x21, 0x06, 0xc0, 0xde, 0xde, 0xc0, 0x06, 0x21] as const;
const COMPRESSED_STATIC_END_OFFSET = 0x14;

export function findArm9ModuleParamsOffset(arm9: Uint8Array): number | undefined {
  const searchEnd = Math.min(arm9.length - ARM9_MODULE_PARAMS_MAGIC.length, 0x8000);
  for (let offset = 0; offset <= searchEnd; offset += 4) {
    let matches = true;
    for (let index = 0; index < ARM9_MODULE_PARAMS_MAGIC.length; index += 1) {
      if (arm9[offset + index] !== ARM9_MODULE_PARAMS_MAGIC[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return offset - 0x1c >= 0 ? offset - 0x1c : undefined;
  }
  return undefined;
}

export function getArm9CompressedStaticEnd(arm9: Uint8Array): number | undefined {
  const offset = findArm9ModuleParamsOffset(arm9);
  return offset === undefined ? undefined : readU32(arm9, offset + COMPRESSED_STATIC_END_OFFSET);
}

export function setArm9CompressedStaticEnd(arm9: Uint8Array, value: number): boolean {
  const offset = findArm9ModuleParamsOffset(arm9);
  if (offset === undefined) return false;
  writeU32(arm9, offset + COMPRESSED_STATIC_END_OFFSET, value);
  return true;
}

export function repairDecompressedArm9CompressionMetadata(arm9: Uint8Array): boolean {
  if ((getArm9CompressedStaticEnd(arm9) ?? 0) === 0) return false;
  return setArm9CompressedStaticEnd(arm9, 0);
}
