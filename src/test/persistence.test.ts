import { describe, expect, it, vi } from "vitest";
import { hydrateMissingOverlays, hydrateNarcRawFiles } from "../pokeweb/persistence";
import type { ProjectState } from "../pokeweb/projectStore";
import type { NintendoDSRom } from "../nds/rom";

describe("Overlay persistence hydration", () => {
  it("preserves saved routing and other overlay edits while hydrating missing data", () => {
    const patched = Uint8Array.of(1, 2, 3);
    const project = { overlays: { 167: patched, 168: new Uint8Array() } } as unknown as ProjectState;
    const loadArm9Overlays = vi.fn((ids: number[]) => new Map(ids.map((id) => [id, { data: Uint8Array.of(id) }])));
    const rom = { loadArm9Overlays } as unknown as NintendoDSRom;

    hydrateMissingOverlays(project, rom, [167, 168, 168, 36]);

    expect(loadArm9Overlays).toHaveBeenCalledTimes(1);
    expect(loadArm9Overlays).toHaveBeenCalledWith([168, 36]);
    expect(project.overlays[167]).toBe(patched);
    expect(project.overlays[168]).toEqual(Uint8Array.of(168));
    expect(project.overlays[36]).toEqual(Uint8Array.of(36));
    hydrateMissingOverlays(project, rom, [167, 168, 36]);
    expect(loadArm9Overlays).toHaveBeenCalledTimes(1);
  });
});

describe("NARC persistence hydration", () => {
  it("retains appended files and intentionally empty dirty filler entries", () => {
    const original = [Uint8Array.of(1), Uint8Array.of(2), new Uint8Array()];
    const persisted = [new Uint8Array(), Uint8Array.of(9), new Uint8Array(), Uint8Array.of(4), new Uint8Array()];

    const hydrated = hydrateNarcRawFiles(persisted, new Set([1, 3, 4]), 5, original);

    expect(hydrated).toHaveLength(5);
    expect(hydrated[0]).toEqual(Uint8Array.of(1));
    expect(hydrated[1]).toEqual(Uint8Array.of(9));
    expect(hydrated[2]).toEqual(new Uint8Array());
    expect(hydrated[3]).toEqual(Uint8Array.of(4));
    expect(hydrated[4]).toEqual(new Uint8Array());
  });

  it("uses the persisted archive length even when the saved fileCount is stale", () => {
    const hydrated = hydrateNarcRawFiles(
      [new Uint8Array(), Uint8Array.of(7), Uint8Array.of(8)],
      new Set([2]),
      2,
      [Uint8Array.of(1), Uint8Array.of(2)],
    );

    expect(hydrated).toEqual([Uint8Array.of(1), Uint8Array.of(7), Uint8Array.of(8)]);
  });
});
