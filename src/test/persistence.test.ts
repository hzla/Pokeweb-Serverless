import { describe, expect, it } from "vitest";
import { hydrateNarcRawFiles } from "../pokeweb/persistence";

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
