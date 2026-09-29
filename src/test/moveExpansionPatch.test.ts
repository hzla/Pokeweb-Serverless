import expansionData from "../assets/data/white2upgradeMoveExpansion.json";
import { readFileSync } from "node:fs";
import { unzipSync, zipSync } from "fflate";
import { readU16, writeU32 } from "../nds/binary";
import type { NintendoDSRom } from "../nds/rom";
import {
  allocateMoveExpansionParticleAssets,
  allocateMoveExpansionBackgroundAssets,
  applyMoveExpansionCommandHookToOverlay,
  applyMoveExpansionRoutingHookToOverlay,
  detectMoveExpansionRoutingHook,
  parseMoveExpansionAnimationBundle,
  planMoveExpansionRouting,
  repairMoveExpansionOverlayLoadSize,
  usesFrostMoveExpansionLayout,
} from "../pokeweb/moveExpansionPatch";
import { decompileMoveAnimationBytes, parseMoveAnimationScript, remapMoveAnimationAssets, remapMoveAnimationParticleIds } from "../pokeweb/moveAnimationModel";
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
const COMMAND_CONTEXT = [0x08, 0x98, 0x39, 0x1c, 0x00, 0x90, 0x09, 0x98, ...ORIGINAL_COMMAND_HOOK, 0x08, 0xa8, 0x00, 0x7a, 0x02, 0x90];
const ORIGINAL_SECONDARY_LOADER_HOOK = [0x84, 0x42, 0x10, 0x4b];
const ORIGINAL_BW_VISUAL_HOOK = [0x31, 0x1c, 0x1a, 0x40];

describe("Move Expansion patch", () => {
  it.each([
    ["BW" as const, 0x3046, 0x33fcc, undefined, 0x021b6100, 0x021f6560],
    ["BW2" as const, 0x3536, 0x363cc, 0x6456, 0x021998c0, 0x021dda60],
  ])("recognizes the legacy appended %s helpers used by imported ROMs", (baseRom, callerOffset, commandHookOffset, secondaryHookOffset, commandRamAddress, loaderRamAddress) => {
    const bssSize = 0x20;
    const commandOverlay = new Uint8Array(commandHookOffset + 0x40);
    commandOverlay.set(COMMAND_CONTEXT, commandHookOffset - 8);

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

  it("bundles all staged Gen 6-7 animations with every particle and background dependency", () => {
    const bundle = loadMoveAnimationBundle();

    expect(bundle.moves).toHaveLength(128);
    expect(bundle.moves[0]).toMatchObject({ sourceMoveId: 560, targetMoveId: 680 });
    expect(bundle.moves.at(-1)).toMatchObject({ sourceMoveId: 742, targetMoveId: 825 });
    expect(bundle.completeAssets).toBe(true);
    expect(bundle.particles).toHaveLength(176);
    expect(bundle.backgrounds).toHaveLength(15);
    const bundledParticleIds = new Set(bundle.particles.map((particle) => particle.sourceParticleId));
    expect(bundle.moves.flatMap((move) => move.particleIds).every((particleId) => bundledParticleIds.has(particleId))).toBe(true);
    for (const move of bundle.moves) {
      const commands = [...parseMoveAnimationScript(decompileMoveAnimationBytes(move.bytes)).scripts.values()].flat();
      for (const command of commands.filter((command) => command.name === "LoadBackground")) {
        expect(move.backgroundIds).toContain(command.params[0]);
        expect(bundle.backgrounds.find((background) => background.sourceBackgroundId === command.params[0])?.files).toHaveLength(3);
      }
      for (const command of commands.filter((command) => command.name === "LoadSPA")) expect(bundledParticleIds.has(command.params[0])).toBe(true);
    }
  });

  it("appends occupied particle IDs and rewrites the installed animation references", () => {
    const bundle = loadMoveAnimationBundle();
    const store = makeParticleStore(740);
    const occupied739 = store.rawFiles[739].slice();
    const uniqueBundledParticles = new Set(bundle.particles.map((particle) => Buffer.from(particle.bytes).toString("hex"))).size;

    const allocation = allocateMoveExpansionParticleAssets(store, bundle.particles);

    expect(allocation.addedIds).toHaveLength(uniqueBundledParticles);
    expect(allocation.particleIdMap.get(739)).toBeGreaterThanOrEqual(740);
    expect(allocation.particleIdMap.get(770)).toBeGreaterThanOrEqual(740);
    expect([...store.rawFiles[739]]).toEqual([...occupied739]);

    const matBlock = bundle.moves.find((move) => move.sourceMoveId === 564)!;
    const remapped = remapMoveAnimationParticleIds(matBlock.bytes, allocation.particleIdMap);
    const text = decompileMoveAnimationBytes(remapped.bytes);
    expect(remapped.referencesChanged).toBeGreaterThan(0);
    expect(text).toContain(`LoadSPA ${allocation.particleIdMap.get(770)}`);
    expect(allocateMoveExpansionParticleAssets(store, bundle.particles).addedIds).toHaveLength(0);
  });

  it("preserves existing background triplets and reuses identical dependencies on reinstall", () => {
    const original = [Uint8Array.of(1), Uint8Array.of(2), Uint8Array.of(3)];
    const files = original.map((bytes) => bytes.slice());
    const backgrounds = [{ sourceBackgroundId: 0, files: [Uint8Array.of(4), Uint8Array.of(5), Uint8Array.of(6)] }, { sourceBackgroundId: 186, files: original }];
    const first = allocateMoveExpansionBackgroundAssets(files, backgrounds);
    expect(first.backgroundIdMap.get(0)).toBe(3);
    expect(first.backgroundIdMap.get(186)).toBe(0);
    expect(files.slice(0, 3)).toEqual(original);
    expect(allocateMoveExpansionBackgroundAssets(files, backgrounds).filesAdded).toBe(0);
  });

  it.each(["particles", "backgrounds"] as const)("rejects an incomplete v3 %s dependency list", (kind) => {
    const entries = unzipSync(new Uint8Array(readFileSync(new URL("../assets/data/white2upgradeGen6MoveAnimations.zip", import.meta.url))));
    const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"]));
    // Low SPA IDs must also be bundled: the BW1 file at that ID may differ.
    manifest[kind] = [];
    entries["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest));
    expect(() => parseMoveExpansionAnimationBundle(zipSync(entries))).toThrow(/requires (?:particle file|background)/u);
  });

  it("omits incompatible BW2 background effects on BW1 while keeping scripts assemblable", () => {
    for (const move of loadMoveAnimationBundle().moves) {
      const bw = remapMoveAnimationAssets(move.bytes, new Map(), new Map([[186, 165]]), "BW");
      const text = decompileMoveAnimationBytes(bw.bytes);
      expect(text).not.toMatch(/\b(?:DistortBackground|BackgroundPaletteAnimation)\b/u);
      expect(text).not.toContain("LoadBackground 186");
      expect(() => parseMoveAnimationScript(text)).not.toThrow();
      const bw2 = remapMoveAnimationAssets(move.bytes, new Map(), new Map(), "BW2");
      expect(bw2.bytes).toEqual(move.bytes);
    }
  });

  it.each(["BW", "BW2"] as const)("keeps %s routing inside both native overlay footprints and migrates old helpers", (baseRom) => {
    const { loader, command, hook, caller, secondary } = routingFixture(baseRom);
    const nativeFootprint = loader.data.length + loader.bssSize;
    const compact = planMoveExpansionRouting(loader, command, baseRom)!;
    expect(compact).toBeDefined();
    expect(compact.loader.overlay.length).toBe(nativeFootprint);
    expect(compact.command.overlay.length).toBe(command.data.length);
    expect(compact.loader.overlay.slice(loader.data.length, loader.data.length + 4)).toEqual(new Uint8Array(4));
    expect(detectMoveExpansionRoutingHook(compact.loader.overlay, baseRom)).toBe("patched");
    const commandTarget = decodeThumbBlTarget(compact.command.overlay, hook, command.ramAddress + hook);
    expect(commandTarget).toBeGreaterThanOrEqual(command.ramAddress);
    expect(commandTarget).toBeLessThan(command.ramAddress + command.data.length);
    const repeated = planMoveExpansionRouting({ ...loader, data: compact.loader.overlay, ramSize: nativeFootprint, bssSize: 0 }, { ...command, data: compact.command.overlay }, baseRom)!;
    expect(repeated.loader.status).toBe("already-applied");
    expect(repeated.command.status).toBe("already-applied");
    if (secondary !== undefined) {
      expect([...compact.loader.overlay.slice(caller + 12, caller + 14)]).toEqual([0x38, 0xd0]);
      expect([...compact.loader.overlay.slice(secondary + 4, secondary + 6)]).toEqual([0x02, 0xd0]);
    }
    const old = applyMoveExpansionRoutingHookToOverlay(loader.data, baseRom, loader.ramAddress, 32)!;
    const oldCommand = applyMoveExpansionCommandHookToOverlay(command.data, baseRom, command.ramAddress, 0, old.commandHelperAddress)!;
    for (const ramSize of [loader.ramSize, old.overlay.length]) {
      const migrated = planMoveExpansionRouting({ ...loader, data: old.overlay, ramSize }, { ...command, data: oldCommand.overlay }, baseRom)!;
      expect(migrated.loader.overlay).toEqual(compact.loader.overlay);
      expect(migrated.command.overlay).toEqual(compact.command.overlay);
    }
    const extra = new Uint8Array(old.overlay.length + 4);
    extra.set(old.overlay);
    expect(planMoveExpansionRouting({ ...loader, data: extra }, { ...command, data: oldCommand.overlay }, baseRom)).toBeUndefined();
    const occupied = loader.data.slice();
    occupied[occupied.length - 1] = 1;
    expect(planMoveExpansionRouting({ ...loader, data: occupied }, command, baseRom)).toBeUndefined();
    const extraGlobal = loader.data.slice();
    writeU32(extraGlobal, 0, loader.ramAddress + loader.data.length + 4);
    expect(planMoveExpansionRouting({ ...loader, data: extraGlobal }, command, baseRom)).toBeUndefined();
    expect(planMoveExpansionRouting({ ...loader, bssSize: 64 }, command, baseRom)).toBeUndefined();
  });

  it("installs after Frost Fairy prepends overlay 93, and repairs a stale helper load size on export", () => {
    const loaderBase = 0x021f6560;
    const loader = new Uint8Array(0x149c0);
    loader.set([0x00, 0xf0, 0x00, 0xf8, ...FROST_SIGNATURE], 0x3046);
    setEndMarker(loader, "btlv_finger_cursor.c", 16);
    loader.set(ORIGINAL_BW_VISUAL_HOOK, 0x305e);
    const routing = applyMoveExpansionRoutingHookToOverlay(loader, "BW", loaderBase, 0x20)!;
    const command = new Uint8Array(0x3fb20);
    command.set(COMMAND_CONTEXT, 0x360cc - 8);
    setEndMarker(command, "btl_field.c", 29);
    const hooked = applyMoveExpansionCommandHookToOverlay(command, "BW", 0x021b4000, 0x2a40, routing.commandHelperAddress)!;
    expect(hooked.status).toBe("applied");
    expect(decodeThumbBlTarget(hooked.overlay, 0x360cc, 0x021ea0cc)).toBe(routing.commandHelperAddress);
    expect(hooked.overlay.slice(0x33fcc, 0x33fd0)).toEqual(command.slice(0x33fcc, 0x33fd0));
    const table = new Uint8Array(64);
    [[93, 0x021b4000, command.length], [94, loaderBase, loader.length]].forEach((values, index) => values.forEach((value, field) => writeU32(table, index * 32 + field * 4, value)));
    writeU32(table, 44, 32);
    const rom = { arm9OverlayTable: table, loadArm9Overlays: () => new Map() } as unknown as NintendoDSRom;
    const project = { session: { baseRom: "BW" }, overlays: { 93: hooked.overlay, 94: routing.overlay } } as unknown as ProjectState;
    expect(repairMoveExpansionOverlayLoadSize(project, rom)).toBe(true);
    expect(project.patches?.dirtyOverlayIds).toEqual(expect.arrayContaining([93, 94]));
    expect(project.overlays[94]!.length).toBe(loader.length + 32);
    expect(project.patches?.arm9OverlayTable?.slice(44, 48)).toEqual(new Uint8Array(4));
    expect(repairMoveExpansionOverlayLoadSize(project, rom)).toBe(false);
    // A different command target must not trigger this narrowly scoped repair.
    project.overlays[93] = command;
    expect(repairMoveExpansionOverlayLoadSize(project, rom)).toBe(false);
    command.set(COMMAND_CONTEXT, 0x37000 - 8);
    expect(applyMoveExpansionCommandHookToOverlay(command, "BW", 0x021b4000, 0, routing.commandHelperAddress)).toBeUndefined();
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

function setEndMarker(data: Uint8Array, marker: string, trailingZeros: number): void {
  data.set(new TextEncoder().encode(marker), data.length - trailingZeros - marker.length);
}

function routingFixture(baseRom: "BW" | "BW2") {
  const bw = baseRom === "BW";
  const caller = bw ? 0x3046 : 0x3536;
  const hook = bw ? 0x33fcc : 0x363cc;
  const secondary = bw ? undefined : 0x6456;
  const loaderData = new Uint8Array(bw ? 0x149c0 : 0x167e0);
  const commandData = new Uint8Array(bw ? 0x3da20 : 0x41740);
  setEndMarker(loaderData, "btlv_finger_cursor.c", bw ? 16 : 24);
  setEndMarker(commandData, bw ? "btl_field.c" : "pokewood_cutin.c", bw ? 29 : 16);
  loaderData.set(ORIGINAL_CALLER, caller);
  if (secondary !== undefined) loaderData.set([...ORIGINAL_SECONDARY_LOADER_HOOK, 0x02, 0xda], secondary);
  else loaderData.set(ORIGINAL_BW_VISUAL_HOOK, caller + 0x18);
  commandData.set(COMMAND_CONTEXT, hook - 8);
  return {
    loader: { data: loaderData, ramSize: loaderData.length, ramAddress: bw ? 0x021f6560 : 0x021dda60, bssSize: 32 },
    command: { data: commandData, ramSize: commandData.length, ramAddress: bw ? 0x021b6100 : 0x021998c0, bssSize: 0 },
    caller, hook, secondary,
  };
}
