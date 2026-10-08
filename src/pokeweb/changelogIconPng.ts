import { zlibSync } from "fflate";
import { concatBytes } from "../nds/binary";
import type { ChangelogIcon } from "./changelogIcons";

// A small RGBA PNG preserves the icon's transparent palette entry in PDF.
export function changelogIconPng(icon: ChangelogIcon): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, icon.width); view.setUint32(4, icon.height);
  header[8] = 8; header[9] = 6;
  const stride = icon.width * 4;
  const scanlines = new Uint8Array((stride + 1) * icon.height);
  for (let row = 0; row < icon.height; row += 1) scanlines.set(icon.pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  return concatBytes([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", zlibSync(scanlines)), chunk("IEND", new Uint8Array()),
  ]);
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set([...type].map((char) => char.charCodeAt(0)), 4); out.set(data, 8);
  let crc = 0xffffffff;
  for (const value of out.subarray(4, out.length - 4)) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0);
  return out;
}
