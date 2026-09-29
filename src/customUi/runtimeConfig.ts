import { readU16, writeU16 } from "../nds/binary";
const marker = new TextEncoder().encode("PWUICFG1");
function offset(bytes: Uint8Array): number {
  const hits: number[] = [];
  for (let i = 0; i + 20 <= bytes.length; i++) if (marker.every((v, j) => bytes[i + j] === v)) hits.push(i);
  if (hits.length !== 1 || readU16(bytes, hits[0] + 8) !== 1) throw new Error("The shared UI runtime has an unsupported configuration.");
  return hits[0];
}
export function readCustomUiConfig(bytes: Uint8Array) {
  try { const at = offset(bytes), menu = readU16(bytes, at + 12); return { enabled: readU16(bytes, at + 10) === 1, menu, validMenu: menu !== 65535 && (menu ^ readU16(bytes, at + 14)) === 65535, learnsetEnabled: readU16(bytes, at + 16) === 1 }; } catch { return; }
}
export function configureCustomUi(bytes: Uint8Array, enabled: boolean, menu: number, learnsetEnabled: boolean): Uint8Array {
  if (!Number.isInteger(menu) || menu < 0 || menu >= 65535) throw new Error("Invalid Custom UI message identifier.");
  const at = offset(bytes), output = bytes.slice();
  writeU16(output, at + 10, Number(enabled)); writeU16(output, at + 12, menu); writeU16(output, at + 14, menu ^ 65535); writeU16(output, at + 16, Number(learnsetEnabled)); return output;
}
