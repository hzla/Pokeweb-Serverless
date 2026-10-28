import { PNG } from "pngjs";
import { newStudioChunk, openStudioWorkspace, writeStudioMap } from "../../pokeweb/mapStudioFormats";

export function studioFixture() {
  const parts: Uint8Array[] = [];
  const i32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n); return b; };
  const ints = (tag: number, values: number[]) => { parts.push(Uint8Array.of(tag), i32(values.length), ...values.map(i32)); };
  const floats = (tag: number, values: number[]) => { parts.push(Uint8Array.of(tag), i32(values.length), ...values.map(n => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, n); return b; })); };
  const string = (tag: number, value: string) => { const bytes = new TextEncoder().encode(value); parts.push(Uint8Array.of(tag), i32(bytes.length), bytes); };
  ints(9, [0]); string(1, "ground.png"); string(4, "ground"); string(2, "ground_pl"); string(3, "ground_tex"); ints(33, [31]); parts.push(Uint8Array.of(53), i32(3), Uint8Array.of(25, 25, 25)); ints(10, [0]);
  ints(0, [0]); ints(11, [1]); ints(12, [1]);
  floats(15, [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]); floats(16, [0, 0, 1, 0, 1, 1, 0, 1]); floats(22, [0, 0, 1]); floats(49, [1, 1, 1]);
  // Extended quad: count followed by four indices for each OBJ attribute.
  parts.push(Uint8Array.of(50), i32(1), ...[1, 2, 3, 4, 1, 2, 3, 4, 1, 1, 1, 1, 1, 1, 1, 1].map(i32));
  ints(19, [0]); ints(24, [0]); ints(25, [0]); string(21, "Grass");
  const binary = new Uint8Array(parts.reduce((sum, b) => sum + b.length, 0)); let offset = 0; for (const p of parts) { binary.set(p, offset); offset += p.length; }
  const image = new PNG({ width: 8, height: 8 }); for (let i = 0; i < 64; i++) image.data.set([24, i < 32 ? 190 : 110, 52, 255], i * 4);
  const chunk = newStudioChunk(); chunk.tiles[0][0] = 0;
  return openStudioWorkspace({ "project/map.pdsmap": new TextEncoder().encode(writeStudioMap({ game: 8, tileset: "set.pdsts", chunks: [chunk] })), "project/set.pdsts": binary, "project/ground.png": new Uint8Array(PNG.sync.write(image)), "project/set.pdsts.meta": new TextEncoder().encode("# metadata\ntile|0|Grass|Ground|0|1|1\n") });
}
