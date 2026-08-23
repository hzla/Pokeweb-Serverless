import expansionData from "../assets/data/white2upgradeMoveExpansion.json";
import { readFileSync } from "node:fs";
import { readU16 } from "../nds/binary";
import {
  allocateMoveExpansionParticleAssets,
  applyMoveExpansionCommandHookToOverlay,
  applyMoveExpansionRoutingHookToOverlay,
  detectMoveExpansionRoutingHook,
  parseMoveExpansionAnimationBundle,
  usesFrostMoveExpansionLayout,
} from "../pokeweb/moveExpansionPatch";
import { decompileMoveAnimationBytes, remapMoveAnimationParticleIds } from "../pokeweb/moveAnimationModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import { describe, expect, it, vi } from "vitest";

const romConstructionSpy = vi.hoisted(() => ({ count: 0 }));

vi.mock("../nds/rom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../nds/rom")>();
  return {
    ...actual,
    NintendoDSRom: class extends actual.NintendoDSRom {
      constructor(data: Uint8Array | ArrayBuffer) {
        romConstructionSpy.count += 1;
        super(data);
      }
    },
  };
});

const ORIGINAL_CALLER = [
  0x96, 0x20, 0x80, 0x00, 0x21, 0x5a, 0x27, 0x38, 0x88, 0x4b, 0x81, 0x42, 0x38, 0xd2,
];
const FROST_SIGNATURE = [0x00, 0x00, 0x00, 0x00, 0x88, 0x4b, 0x01, 0x28, 0x38, 0xd0];
const ORIGINAL_COMMAND_HOOK = [0x33, 0x1c, 0x01, 0x90];
const ORIGINAL_SECONDARY_LOADER_HOOK = [0x84, 0x42, 0x10, 0x4b];
const ORIGINAL_BW_VISUAL_HOOK = [0x31, 0x1c, 0x1a, 0x40];

describe("Move Expansion patch", () => {
  it.each([
    ["BW" as const, 0x3046, 0x33fcc, undefined, 0x021b6100, 0x021f6560],
    ["BW2" as const, 0x3536, 0x363cc, 0x6456, 0x021998c0, 0x021dda60],
  ])("installs context-safe %s move animation routing and preserves BSS addresses", (baseRom, callerOffset, commandHookOffset, secondaryHookOffset, commandRamAddress, loaderRamAddress) => {
    const bssSize = 0x20;
    const commandOverlay = new Uint8Array(commandHookOffset + 0x40);
    commandOverlay.set(ORIGINAL_COMMAND_HOOK, commandHookOffset);

    const overlayLength = Math.max(callerOffset + 0x40, (secondaryHookOffset ?? 0) + 0x40);
    const overlay = new Uint8Array(overlayLength);
    overlay.set(ORIGINAL_CALLER, callerOffset);
    if (secondaryHookOffset !== undefined) overlay.set(ORIGINAL_SECONDARY_LOADER_HOOK, secondaryHookOffset);
    else overlay.set(ORIGINAL_BW_VISUAL_HOOK, callerOffset + 0x18);

    const result = applyMoveExpansionRoutingHookToOverlay(
      overlay,
      baseRom,
      loaderRamAddress,
      bssSize,
    );

    expect(result?.status).toBe("applied");
    expect(result?.helperOffset).toBe(Math.ceil((overlay.length + bssSize) / 4) * 4);
    expect([...result!.overlay.slice(overlay.length, overlay.length + bssSize)]).toEqual(Array(bssSize).fill(0));
    expect([...result!.overlay.slice(callerOffset, callerOffset + 8)]).toEqual(ORIGINAL_CALLER.slice(0, 8));
    const primaryHookOffset = baseRom === "BW2" ? callerOffset + 8 : callerOffset + 0x18;
    expect(decodeThumbBlTarget(result!.overlay, primaryHookOffset, loaderRamAddress + primaryHookOffset)).toBe(
      loaderRamAddress + result!.helperOffset!,
    );
    if (secondaryHookOffset !== undefined) expect(isThumbBl(result!.overlay, secondaryHookOffset)).toBe(true);
    expect(detectMoveExpansionRoutingHook(result!.overlay, baseRom)).toBe("patched");

    const commandResult = applyMoveExpansionCommandHookToOverlay(
      commandOverlay,
      baseRom,
      commandRamAddress,
      bssSize,
      result?.commandHelperAddress,
    );
    expect(commandResult?.status).toBe("applied");
    expect(commandResult?.overlay).toHaveLength(commandOverlay.length);
    expect(decodeThumbBlTarget(commandResult!.overlay, commandHookOffset, commandRamAddress + commandHookOffset)).toBe(
      result?.commandHelperAddress,
    );

    const repeated = applyMoveExpansionRoutingHookToOverlay(
      result!.overlay,
      baseRom,
      loaderRamAddress,
      bssSize,
    );
    expect(repeated?.status).toBe("already-applied");
    expect(repeated?.commandHelperAddress).toBe(result?.commandHelperAddress);
    const repeatedCommand = applyMoveExpansionCommandHookToOverlay(
      commandResult!.overlay,
      baseRom,
      commandRamAddress,
      bssSize,
      repeated?.commandHelperAddress,
    );
    expect(repeatedCommand?.status).toBe("already-applied");
  });

  it("upgrades the legacy one-loader Frost signature instead of treating it as safe routing", () => {
    const callerOffset = 0x3536;
    const secondaryHookOffset = 0x6456;
    const ramAddress = 0x021dda60;
    const overlay = new Uint8Array(secondaryHookOffset + 0x40);
    overlay.set([0x00, 0xf0, 0x00, 0xf8], callerOffset);
    overlay.set(FROST_SIGNATURE, callerOffset + 4);
    overlay.set(ORIGINAL_SECONDARY_LOADER_HOOK, secondaryHookOffset);

    expect(detectMoveExpansionRoutingHook(overlay, "BW2")).toBe("unpatched");
    const result = applyMoveExpansionRoutingHookToOverlay(overlay, "BW2", ramAddress);

    expect(result?.status).toBe("applied");
    expect([...result!.overlay.slice(callerOffset, callerOffset + 8)]).toEqual(ORIGINAL_CALLER.slice(0, 8));
    expect(isThumbBl(result!.overlay, callerOffset + 8)).toBe(true);
    expect(isThumbBl(result!.overlay, secondaryHookOffset)).toBe(true);
  });

  it("refuses a conflicting routing modification", () => {
    expect(applyMoveExpansionRoutingHookToOverlay(new Uint8Array(0x3600), "BW2", 0x021d0000)).toBeUndefined();
  });

  it("parses the source ROM only once when many move records probe the expansion layout", () => {
    const project = {
      originalRomBytes: new Uint8Array(0x200),
      session: { baseRom: "BW2" },
      overlays: {},
    } as ProjectState;
    const initialConstructionCount = romConstructionSpy.count;

    expect(usesFrostMoveExpansionLayout(project)).toBe(false);
    expect(usesFrostMoveExpansionLayout(project)).toBe(false);
    expect(usesFrostMoveExpansionLayout(project)).toBe(false);
    expect(romConstructionSpy.count - initialConstructionCount).toBe(1);

    project.originalRomBytes = new Uint8Array(0x200);
    expect(usesFrostMoveExpansionLayout(project)).toBe(false);
    expect(romConstructionSpy.count - initialConstructionCount).toBe(2);
  });

  it("bundles every selectable White2Upgrade move that fits the expansion", () => {
    expect(expansionData.source).toContain("White2Upgrade-Original-pokeweb");
    expect(expansionData.moves).toHaveLength(305);
    expect(expansionData.moves[0]).toMatchObject({ sourceId: 560, name: "Flying Press" });
    expect(expansionData.moves.at(-1)).toMatchObject({ sourceId: 919, name: "Malignant Chain" });
    expect(expansionData.moves.every((move) => move.data[5] > 0)).toBe(true);
    expect(expansionData.firstTargetMoveId + expansionData.moves.length).toBeLessThanOrEqual(expansionData.targetMoveCount);
  });

  it("bundles all staged Gen 6-7 animations with their custom particle dependencies", () => {
    const bundle = loadMoveAnimationBundle();

    expect(bundle.moves).toHaveLength(128);
    expect(bundle.moves[0]).toMatchObject({ sourceMoveId: 560, targetMoveId: 680 });
    expect(bundle.moves.at(-1)).toMatchObject({ sourceMoveId: 742, targetMoveId: 825 });
    expect(bundle.particles).toHaveLength(65);
    const bundledParticleIds = new Set(bundle.particles.map((particle) => particle.sourceParticleId));
    expect(bundle.moves.flatMap((move) => move.particleIds).filter((particleId) => particleId >= 733).every((particleId) => bundledParticleIds.has(particleId))).toBe(true);
  });

  it("appends occupied particle IDs and rewrites the installed animation references", () => {
    const bundle = loadMoveAnimationBundle();
    const store = makeParticleStore(740);
    const occupied739 = store.rawFiles[739].slice();
    const uniqueBundledParticles = new Set(bundle.particles.map((particle) => Buffer.from(particle.bytes).toString("hex"))).size;

    const allocation = allocateMoveExpansionParticleAssets(store, bundle.particles);

    expect(allocation.addedIds).toHaveLength(uniqueBundledParticles);
    expect(allocation.particleIdMap.get(739)).toBe(740);
    expect(allocation.particleIdMap.get(770)).toBe(766);
    expect([...store.rawFiles[739]]).toEqual([...occupied739]);

    const matBlock = bundle.moves.find((move) => move.sourceMoveId === 564)!;
    const remapped = remapMoveAnimationParticleIds(matBlock.bytes, allocation.particleIdMap);
    const text = decompileMoveAnimationBytes(remapped.bytes);
    expect(remapped.referencesChanged).toBeGreaterThan(0);
    expect(text).toContain("LoadSPA 766");
    expect(text).not.toContain("LoadSPA 770");
  });
});

function loadMoveAnimationBundle() {
  return parseMoveExpansionAnimationBundle(
    new Uint8Array(readFileSync(new URL("../assets/data/white2upgradeGen6MoveAnimations.zip", import.meta.url))),
  );
}

function makeParticleStore(count: number): NarcStore {
  return {
    name: "move_spas",
    sourcePath: "a/0/0/6",
    container: "narc",
    fileId: 1,
    fileCount: count,
    rawFiles: Array.from({ length: count }, (_, index) => Uint8Array.of(index & 0xff, (index >> 8) & 0xff)),
    records: new Map(),
    dirty: new Set(),
  };
}

function decodeThumbBlTarget(data: Uint8Array, offset: number, fromAddress: number): number {
  const high = readU16(data, offset);
  const low = readU16(data, offset + 2);
  let delta = ((high & 0x7ff) << 12) | ((low & 0x7ff) << 1);
  if ((delta & 0x400000) !== 0) delta |= ~0x7fffff;
  return fromAddress + 4 + delta;
}

function isThumbBl(data: Uint8Array, offset: number): boolean {
  return (readU16(data, offset) & 0xf800) === 0xf000 && (readU16(data, offset + 2) & 0xf800) === 0xf800;
}
