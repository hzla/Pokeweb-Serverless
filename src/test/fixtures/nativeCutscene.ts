import { writeU16, writeU32 } from "../../nds/binary";
import { CUTSCENE_ORIGINAL_SIZE, CUTSCENE_ORIGINAL_TABLE, CUTSCENE_OVERLAY_BASE, CUTSCENE_TABLE_READERS } from "../../pokeweb/nativeCutsceneRegistry";

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map(n => parseInt(n, 16)));
export function nativeCutsceneFixture() {
  const overlay = new Uint8Array(CUTSCENE_ORIGINAL_SIZE), v = new DataView(overlay.buffer);
  for (const [address, text] of [
    [0x021a2a0c, "002801d01b2800d300207047"], [0x021a2a18, "08b5fff7f7ff142141430148405808bd"],
    [0x021a2a48, "08b5fff7dfff14214143024840580006000e08bd"], [0x021a2c00, "08b5fff703ff142141430148405808bd"],
    [0x021a2c14, "08b5fff7f9fe142141430148405808bd"], [0x021a2b50, "81815068411e0198818102b0f8bdc046"],
  ] as const) overlay.set(hex(text), address - CUTSCENE_OVERLAY_BASE);
  for (const { address, field } of CUTSCENE_TABLE_READERS) writeU32(overlay, address - CUTSCENE_OVERLAY_BASE, CUTSCENE_ORIGINAL_TABLE + field);
  for (const [address, text] of [
    [0x021a3518, "f8b584b0151c9031aa680978161c071c"],
    [0x021a35a8, "f8b586b00d1c2c68061ce068002807d0"],
    [0x021a368c, "f0b583b00c1c051c161c201c00212822"],
    [0x021a36f8, "10b5041c206a002801d07ef679fe606a"],
    [0x021a2636, "7069641c2d18bc42efd3"],
    [0x021a3b28, "6868fff769f86a69282151434418"],
  ] as const) overlay.set(hex(text), address - CUTSCENE_OVERLAY_BASE);
  writeU32(overlay, 0x021ab458 - CUTSCENE_OVERLAY_BASE, 0x021a3519);
  writeU32(overlay, 0x021a35a4 - CUTSCENE_OVERLAY_BASE, 0x021a35a9);
  const table = CUTSCENE_ORIGINAL_TABLE - CUTSCENE_OVERLAY_BASE, header = table + 5 * 20;
  [0x5800, 0x6000, 0x6080, 0x6100].forEach((n, i) => writeU32(overlay, header + i * 4, CUTSCENE_OVERLAY_BASE + n)); writeU32(overlay, header + 16, 1);
  writeU16(overlay, 0x5804, 427); writeU16(overlay, 0x5806, 1);
  for (const [at, value] of [[12, 40], [16, 4 / 3], [20, 1], [24, 1000], [28, 1]]) v.setInt32(0x5800 + at, Math.round(value * 4096), true);
  writeU32(overlay, 0x6000, 6); writeU32(overlay, 0x6008, 1102); writeU32(overlay, 0x6028, 19); writeU32(overlay, 0x6080, 19);
  writeU32(overlay, 0x6100, CUTSCENE_OVERLAY_BASE + 0x6120); writeU16(overlay, 0x6104, 1);
  writeU32(overlay, 0x6120, CUTSCENE_OVERLAY_BASE + 0x6140); writeU32(overlay, 0x6124, 1);
  writeU32(overlay, 0x6140, CUTSCENE_OVERLAY_BASE + 0x6160); writeU32(overlay, 0x6144, 1); writeU16(overlay, 0x6160, 1);
  for(let id=1;id<27;id++)if(id!==5)overlay.set(overlay.slice(header,header+20),table+id*20);
  const camera = new Uint8Array(56); writeU32(camera, 0, 2); camera.set([0, 1, 1, 0], 4);
  const files = [camera, new TextEncoder().encode("BMD0test")];
  return { overlay, files, table };
}
