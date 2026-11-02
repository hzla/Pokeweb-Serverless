import { describe, expect, it } from "vitest";
import { readU32, writeU32 } from "../nds/binary";
import { nativeMoveAssignments, readNativeMoveRegistry, moveHandlerOverlay, moveRegistryDispatcherSignature } from "../pokeweb/nativeMoveRegistry";
import { battleRuntimeResolver } from "../pokeweb/battleRuntimeBindings";
import black from "../assets/data/moveRecipeBindingsB1.json";
import white from "../assets/data/moveRecipeBindingsW1.json";
import bw2 from "../assets/data/moveRecipeBindings.json";
import type { ProjectState } from "../pokeweb/projectStore";

const base = 0x021b0000, armBase = 0x02004000;
function fixture(count = 384) {
  const overlay = new Uint8Array(0x5000), dispatcher = new Uint8Array(120);
  writeU32(dispatcher, 108, base + 64); writeU32(dispatcher, 112, count); writeU32(dispatcher, 116, base + 68);
  const layout = readNativeMoveRegistry(overlay, base, dispatcher);
  const entry = (index: number, id: number, getter: number) => { writeU32(overlay, 64 + index * 8, id); writeU32(overlay, 68 + index * 8, getter); };
  const inspect = () => nativeMoveAssignments(overlay, base, layout, 1000, armBase, 0x1000);
  return { overlay, dispatcher, layout, entry, inspect };
}
describe("native move registry", () => {
  it.each([black, white, bw2])("accepts a changed capacity literal while retaining the dispatcher instruction checks ($overlay)", catalog => {
    const signature = moveRegistryDispatcherSignature(catalog.functions.MoveEvent_AddItem), code = Uint8Array.from(signature.hex.match(/../gu)!, h => parseInt(h, 16));
    writeU32(code, 112, 512);
    const resolver = battleRuntimeResolver(code, base, new Uint8Array(), armBase, { MoveEvent_AddItem: signature });
    expect(resolver.matches("MoveEvent_AddItem", base)).toBe(true);
    code[0] ^= 1;
    expect(resolver.matches("MoveEvent_AddItem", base)).toBe(false);
  });
  it.each([258, 384, 512, 1024])("discovers a relocated %i-row table without assuming stock assignments", count => {
    const f = fixture(count);
    f.entry(0, 900, base + 0x4001); f.entry(count - 1, 24, base + 0x4001); f.entry(1, 33, armBase + 1);
    expect(f.layout).toEqual({ offset: 64, count, byteLength: count * 8 });
    expect([...f.inspect()]).toEqual([[900, base + 0x4001], [33, armBase + 1], [24, base + 0x4001]]);
  });
  it.each([0, 4097, 0xffffffff])("rejects invalid capacities %i", count => {
    const f = fixture(); writeU32(f.dispatcher, 112, count);
    expect(() => readNativeMoveRegistry(f.overlay, base, f.dispatcher)).toThrow(/registry/);
  });
  it("rejects truncated, unaligned and inconsistent table pointers", () => {
    const f = fixture();
    for (const pointer of [base - 8, base + 2, base + f.overlay.length - 8]) {
      writeU32(f.dispatcher, 108, pointer); writeU32(f.dispatcher, 116, pointer + 4);
      expect(() => readNativeMoveRegistry(f.overlay, base, f.dispatcher)).toThrow(/registry/);
    }
    writeU32(f.dispatcher, 108, base + 64); writeU32(f.dispatcher, 116, base + 72);
    expect(() => readNativeMoveRegistry(f.overlay, base, f.dispatcher)).toThrow(/registry/);
  });
  it("rejects ambiguous IDs and bad pointers without forbidding aliases or empty slots", () => {
    const f = fixture(); f.entry(0, 24, base + 0x4001); f.entry(1, 24, base + 0x4001);
    expect(f.inspect).toThrow(/Duplicate/);
    f.entry(1, 1000, 0); expect(f.inspect).toThrow(/Invalid native move ID/);
    f.entry(1, 0, base + 0x4001); expect(f.inspect).toThrow(/Invalid native move ID/);
    f.entry(1, 25, 0x04000001); expect(f.inspect).toThrow(/outside loaded battle code/);
    f.entry(1, 25, 0); expect(f.inspect).toThrow(/no callback/);
    f.entry(1, 25, armBase + 1); expect(f.inspect().get(25)).toBe(armBase + 1);
  });
  it("includes pending address edits beyond row 258 without changing unrelated overlay bytes", () => {
    const f = fixture(), bytes = f.overlay.slice(64, 64 + f.layout.byteLength);
    const project = { session: { baseRom: "BW" }, narcs: { move_effects_table: {
      sourcePath: "overlay93:move_effects_table@64", rawFiles: [bytes], dirty: new Set([0]),
      records: new Map([[0, { raw: { move_id_383: 900, address_383: base + 0x4001 } }]]),
    } } } as unknown as ProjectState;
    const out = moveHandlerOverlay(project, f.overlay, f.layout);
    expect(readU32(out, 64 + 383 * 8)).toBe(900);
    expect(readU32(out, 68 + 383 * 8)).toBe(base + 0x4001);
    expect(out.slice(0, 64)).toEqual(f.overlay.slice(0, 64));
    expect(out.slice(64 + f.layout.byteLength)).toEqual(f.overlay.slice(64 + f.layout.byteLength));
    expect(f.overlay).toEqual(new Uint8Array(f.overlay.length));
    project.narcs.move_effects_table!.sourcePath = "overlay93:move_effects_table";
    expect(() => moveHandlerOverlay(project, f.overlay, f.layout)).toThrow(/different table layout/);
  });
});
