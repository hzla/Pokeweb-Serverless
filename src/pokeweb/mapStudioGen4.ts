import { readAscii, readU16, readU32 } from "../nds/binary";
import { studioAssert } from "./mapStudioFormats";

export type StudioHeightPlate = { x0: number; y0: number; x1: number; y1: number; a: number; b: number; c: number };
/** HGSS BDHC coordinates use tile units (Q16), with a negated plane distance. */
export function readStudioBdhc(bytes: Uint8Array): StudioHeightPlate[] {
  studioAssert(bytes.length >= 16 && readAscii(bytes, 0, 4) === "BDHC", "Invalid BDHC height file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const [points, slopes, heights, plates, stripes, indices] = Array.from({ length: 6 }, (_, i) => readU16(bytes, 4 + i * 2));
  const slopeAt = 16 + points * 8, heightAt = slopeAt + slopes * 12, plateAt = heightAt + heights * 4;
  studioAssert(plateAt + plates * 8 + stripes * 8 + indices * 2 <= bytes.length, "Truncated BDHC height tables.");
  return Array.from({ length: plates }, (_, i) => {
    const at = plateAt + i * 8, p = readU16(bytes, at), q = readU16(bytes, at + 2), s = readU16(bytes, at + 4), h = readU16(bytes, at + 6);
    studioAssert(p < points && q < points && s < slopes && h < heights, "BDHC plate references a missing point, slope or height.");
    const nx = view.getInt32(slopeAt + s * 12, true) / 4096, nz = view.getInt32(slopeAt + s * 12 + 4, true) / 4096, ny = view.getInt32(slopeAt + s * 12 + 8, true) / 4096;
    studioAssert(Math.abs(nz) > 1e-6, "Vertical BDHC planes cannot define walking heights.");
    const distance = -view.getInt32(heightAt + h * 4, true) / 65536;
    const x0 = view.getInt32(16 + p * 8, true) / 65536, y0 = view.getInt32(20 + p * 8, true) / 65536;
    const x1 = view.getInt32(16 + q * 8, true) / 65536, y1 = view.getInt32(20 + q * 8, true) / 65536;
    studioAssert(x1 >= x0 && y1 >= y0, "BDHC plate has reversed bounds.");
    return { x0, y0, x1, y1, a: -nx / nz, b: -ny / nz, c: distance * (nx * nx + ny * ny + nz * nz) / nz };
  });
}

export type StudioGen4Building = { model: number; x: number; y: number; z: number; scale: number[] };
export function readStudioGen4Buildings(bytes: Uint8Array): StudioGen4Building[] {
  studioAssert(bytes.length % 48 === 0, "Truncated Gen 4 BLD placement file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.length / 48 }, (_, i) => {
    const at = i * 48;
    studioAssert(readU32(bytes, at) <= 65535, "Invalid Gen 4 building model ID.");
    studioAssert([16, 20, 24].every(n => readU32(bytes, at + n) === 0), "Rotated Gen 4 BLD records are not supported yet.");
    return { model: readU16(bytes, at), x: view.getInt32(at + 4, true) / 65536, y: view.getInt32(at + 8, true) / 65536, z: view.getInt32(at + 12, true) / 65536,
      scale: [28, 32, 36].map(n => view.getInt32(at + n, true) / 4096) };
  });
}

/** Deliberate behavior conversion: Gen 4's numeric IDs are not Gen 5 IDs. */
export function convertStudioGen4Permission(type: number, collision: number): { tileClass: number; flags: number; unsupported?: number } {
  let flags = collision & 0x80 ? 1 : 0, tileClass = 0, unsupported: number | undefined;
  if (collision & 4) flags |= 0x20;
  switch (type) {
    case 0: case 6: break; // Plain terrain / headbutt tree. Solidness comes from collision.
    case 2: tileClass = 4; flags |= 0x24; break;
    case 3: tileClass = 6; flags |= 0x24; break;
    case 8: case 12: tileClass = 3; break;
    case 16: tileClass = 61; flags |= 0x16; break;
    case 21: tileClass = 63; flags |= 0x16; break;
    case 22: case 23: tileClass = 20; flags |= 0x10; break;
    case 33: tileClass = 11; flags |= 8; break;
    case 45: flags |= 0x40; break;
    case 48: case 49: case 50: case 51: tileClass = 81 + type - 48; break;
    case 56: case 57: case 58: case 59: tileClass = 114 + type - 56; flags |= 0x100; break;
    // Bridges retain their top surface. Underpasses require a second PER surface.
    case 112: case 113: case 114: case 115: case 117: unsupported = type; break;
    default: unsupported = type;
  }
  return { tileClass, flags, unsupported };
}
