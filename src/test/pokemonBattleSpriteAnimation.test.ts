import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeBattleSpriteAnimation, createPwanBattleSpriteAnimation, loadPokemonBattleSpriteAnimation } from "../pokeweb/pokemonBattleSpriteAnimation";
import * as sprites from "../pokeweb/pokemonSpriteModel";
import * as pwan from "../pokeweb/pwanAnimationModel";
import type { ProjectState, PwanAnimationOverride } from "../pokeweb/projectStore";

afterEach(() => vi.restoreAllMocks());

describe("battle sprite pose animation", () => {
  it("uses native frame durations and loop modes without changing the sprite canvas", () => {
    const animation = nativeAnimation();
    expect(animation.frameAtTick(0).parts[0]!.transform[4]).toBe(0);
    expect(animation.frameAtTick(1).key).toBe(animation.frameAtTick(0).key);
    expect(animation.frameAtTick(2).parts[0]!.transform[4]).toBe(4);
    expect(animation.frameAtTick(4).key).toBe(animation.frameAtTick(0).key);
    expect(animation.width).toBe(256);
    expect(animation.origin).toEqual([128, 192]);
    const once = nativeAnimation(1);
    expect(once.frameAtTick(20).parts[0]!.transform[4]).toBe(4);
  });

  it("composes outer and node transforms, subcells, visibility, and node play modes", () => {
    const body = cell();
    body.subCell = { ...cell(), width: 1, height: 1, spriteX: 3 };
    const animation = createNativeBattleSpriteAnimation(image, [body], [sequence()], [{
      index: 0, cellAnimationCount: 3,
      nodes: [node(2), { ...node(1), visible: false }, { ...node(1), x: 3 }],
    }], { ...sequence(), frames: [frame({ duration: 4, x: 10, y: 2, xScale: 2 })] })!;
    const parts = animation.frameAtTick(2).parts;
    expect(parts).toHaveLength(4);
    expect(parts[0]!.transform).toEqual([2, 0, -0, 1, 24, 2]);
    expect(parts[1]!.position).toEqual([3, -2]);
    expect(parts[2]!.transform[4]).toBe(10);
  });

  it("restarts node playback at NMAR boundaries but preserves continuous nodes", () => {
    const make = (mode: number) => createNativeBattleSpriteAnimation(image, [cell()], [sequence()], [{ index: 0, cellAnimationCount: 1, nodes: [node(mode)] }], { ...sequence(), frames: [frame({ duration: 3 }), frame({ duration: 3 })] })!;
    expect(make(0).frameAtTick(3).parts[0]!.transform[4]).toBe(0);
    expect(make(1).frameAtTick(3).parts[0]!.transform[4]).toBe(4);
  });

  it("loops PWAN with its own frame durations and keeps transparent palette index zero", () => {
    const animation = createPwanBattleSpriteAnimation(pwanBytes());
    expect(animation.kind).toBe("pwan");
    expect([0, 1, 2, 4, 5].map((tick) => animation.frameAtTick(tick).key)).toEqual(["0", "0", "1", "1", "0"]);
    const first = animation.frameAtTick(0).parts[0]!.image;
    const second = animation.frameAtTick(2).parts[0]!.image;
    expect(first).toBe(animation.frameAtTick(5).parts[0]!.image);
    expect(first.pixels[3]).toBe(255);
    expect(first.pixels[7]).toBe(0);
    expect(second.pixels[0]).not.toBe(first.pixels[0]);
    expect(animation.origin).toEqual([48, 96]);
  });

  it("prefers the selected PWAN side and falls back to native or a still image", () => {
    const project = { session: { baseRom: "BW2" } } as ProjectState;
    vi.spyOn(pwan, "findPwanOverrideForSpecies").mockReturnValue({ front: { pwanBytes: pwanBytes() } } as PwanAnimationOverride);
    const native = vi.spyOn(sprites, "getPokemonAnimation").mockReturnValue({ sequences: [sequence()] } as sprites.PokemonAnimation);
    vi.spyOn(sprites, "resolvePokemonSpriteId").mockReturnValue(1);
    vi.spyOn(sprites, "getPokemonSpriteImage").mockReturnValue(image);
    vi.spyOn(sprites, "getRigCells").mockReturnValue({ cells: [cell()], flags: new Uint8Array() });
    vi.spyOn(sprites, "getPokemonMultiCells").mockReturnValue({ cells: [{ index: 0, nodes: [node(1)], cellAnimationCount: 1 }] } as sprites.PokemonMultiCells);
    vi.spyOn(sprites, "getPokemonMultiCellAnimation").mockReturnValue({ sequences: [] } as unknown as sprites.PokemonAnimation);
    expect(loadPokemonBattleSpriteAnimation(project, 1, "front")?.kind).toBe("pwan");
    expect(native).not.toHaveBeenCalled();
    expect(loadPokemonBattleSpriteAnimation(project, 1, "back")?.kind).toBe("native");
    vi.mocked(pwan.findPwanOverrideForSpecies).mockReturnValue({ front: { pwanBytes: new Uint8Array() } } as PwanAnimationOverride);
    expect(loadPokemonBattleSpriteAnimation(project, 1, "front")?.kind).toBe("native");
    native.mockImplementation(() => { throw new Error("Missing rig"); });
    expect(loadPokemonBattleSpriteAnimation(project, 1, "back")).toBeUndefined();
  });
});

const image: sprites.RgbaImageData = { width: 4, height: 4, pixels: new Uint8ClampedArray(64).fill(255) };
function frame(values: Partial<sprites.PokemonAnimationFrame> = {}): sprites.PokemonAnimationFrame {
  return { duration: 2, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1, frameType: "index-t", valueOffset: 0, sequenceFrameOffset: 0, ...values };
}
function sequence(mode = 2): sprites.PokemonAnimationSequence {
  return { index: 0, frameCount: 2, startFrameIndex: 0, motionType: 2, targetType: 0, mode, frames: [frame(), frame({ x: 4 })] };
}
function node(playMode: number): sprites.PokemonMultiCellNode {
  return { sequenceNumber: 0, x: 0, y: 0, nodeAttr: 0, cellAnimationIndex: 0, playMode, visible: true };
}
function cell(): sprites.RigCell {
  return { cellX: 0, cellY: 0, width: 2, height: 2, spriteX: -1, spriteY: 2, subCell: { width: 0, height: 0 } as sprites.RigCell };
}
function nativeAnimation(mode = 2) {
  return createNativeBattleSpriteAnimation(image, [cell()], [sequence(mode)], [{ index: 0, nodes: [node(1)], cellAnimationCount: 1 }])!;
}
function pwanBytes(): Uint8Array {
  const bytes = new Uint8Array(80 + 2 * 0x1200);
  const view = new DataView(bytes.buffer);
  bytes.set([80, 87, 65, 78]);
  for (const [offset, value] of [[4, 1], [6, 96], [8, 96], [10, 4], [12, 2], [14, 2]]) view.setUint16(offset!, value!, true);
  for (const [offset, value] of [[16, 5], [20, 0x1200], [24, 16], [28, 40], [32, 72], [36, 80]]) view.setUint32(offset!, value!, true);
  view.setUint16(42, 31, true);
  view.setUint16(44, 31 << 10, true);
  view.setUint16(74, 2, true);
  view.setUint16(76, 1, true);
  view.setUint16(78, 3, true);
  bytes[80] = 1;
  bytes[80 + 0x1200] = 2;
  return bytes;
}
