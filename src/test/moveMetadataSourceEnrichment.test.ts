import { describe, expect, it } from "vitest";
import { enrichMoveMetadataSource } from "../pokeweb/moveMetadataSourceEnrichment";

describe("moveMetadataSourceEnrichment", () => {
  it("updates only supplied move metadata in an assigned data source", () => {
    const source = `backup_data = {
  "title": "Example",
  "moves": {
    "Take Down": {
      "basePower": 90,
      "recoil": [10, 100]
    },
    "Giga Drain": {
      "basePower": 75,
      "recoil": [1, 2]
    },
    "Recover": {
      "basePower": 0,
      "critRatio": 2
    }
  },
  "formatted_sets": {"Example": {"moves": ["Take Down"]}}
}`;

    const result = enrichMoveMetadataSource(source, {
      "Take Down": { critRatio: 2, recoil: [1, 4] },
      "Giga Drain": { drain: [1, 2] },
      Recover: { heal: [1, 2] },
      Missing: { recoil: [1, 3] },
    });

    expect(result.modifiedMoves).toEqual(["Take Down", "Giga Drain", "Recover"]);
    expect(result.unmatchedMoves).toEqual(["Missing"]);
    expect(result.source).toContain('"critRatio": 2');
    expect(result.source).toContain('"recoil": [\n        1,\n        4\n      ]');
    expect(result.source).toContain('"drain": [\n        1,\n        2\n      ]');
    expect(result.source).not.toContain('"Giga Drain": {\n      "basePower": 75,\n      "recoil"');
    expect(result.source).toContain('"heal": [\n        1,\n        2\n      ]');
    expect(result.source).toContain('"formatted_sets": {"Example": {"moves": ["Take Down"]}}');
  });

  it("preserves existing fields when ROM metadata omits them", () => {
    const source = 'overrides = {"moves":{"Recover":{"heal":[1,2],"recoil":[1,4]}}}';
    const result = enrichMoveMetadataSource(source, { Recover: { critRatio: 2 } });

    expect(result.source).toContain('"heal": [');
    expect(result.source).toContain('"recoil": [');
  });

  it("resolves renamed calc moves through move_replacements", () => {
    const source = `backup_data = {
  "move_replacements": {"peck": "aquacutter"},
  "moves": {
    "Peck": {"basePower": 70}
  }
}`;
    const result = enrichMoveMetadataSource(source, { "Aqua Cutter": { critRatio: 2 } });

    expect(result.modifiedMoves).toEqual(["Peck"]);
    expect(result.unmatchedMoves).toEqual([]);
    expect(result.source).toContain('"critRatio": 2');
  });

  it("resolves renamed moves by their stable ROM slot", () => {
    const source = `overrides = {
  "moves": {
    "Pound": {"num": 0, "basePower": 40},
    "Peck": {"num": 1, "basePower": 70}
  }
}`;
    const result = enrichMoveMetadataSource(
      source,
      { "Aqua Cutter": { critRatio: 2 } },
      { "Aqua Cutter": 1 },
    );

    expect(result.modifiedMoves).toEqual(["Peck"]);
    expect(result.unmatchedMoves).toEqual([]);
    expect(result.source).toContain('"critRatio": 2');
  });
});
