import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import type { NarcName } from "../pokeweb/constants";
import { applyGen5InGameTradePatches, gen5InGameTradeTextBankId, scanGen5InGameTrades } from "../pokeweb/ingameTradeModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("ingameTradeModel", () => {
  it("selects the trade text bank for each Gen 5 game family", () => {
    expect(gen5InGameTradeTextBankId("BW")).toBe(35);
    expect(gen5InGameTradeTextBankId("BW2")).toBe(37);
    expect(gen5InGameTradeTextBankId("HGSS")).toBeUndefined();
  });

  it("discovers variable trade records and skips structurally invalid files", () => {
    const project = makeProject([makeTrade(25, 133), new Uint8Array(20), makeTrade(4, 7)]);

    expect(scanGen5InGameTrades(project).map((trade) => [trade.fileId, trade.givenSpeciesId, trade.requestedSpeciesId])).toEqual([
      [0, 25, 133],
      [2, 4, 7],
    ]);
  });

  it("patches trade data and finds relocated script mirrors by command shape", () => {
    const project = makeProject([makeTrade(25, 133)]);
    const script = new Uint8Array(24);
    writeU16(script, 3, 0x57);
    script[5] = 1;
    writeU16(script, 6, 133);
    writeU16(script, 11, 25);
    project.narcs.scripts = makeStore("scripts", [script]);
    const trade = scanGen5InGameTrades(project)[0]!;

    const applied = applyGen5InGameTradePatches(project, [{
      trade,
      givenSpeciesId: 150,
      requestedSpeciesId: 151,
      heldItemId: 42,
      ivs: [1, 2, 3, 4, 5, 6],
    }]);

    const record = project.narcs.ingame_trades!.rawFiles[0]!;
    expect(applied).toEqual({ records: 1, scriptMirrors: 1 });
    expect(readU32(record, 4)).toBe(150);
    expect(readU32(record, 0x5c)).toBe(151);
    expect(readU32(record, 0x4c)).toBe(42);
    expect(Array.from({ length: 6 }, (_unused, index) => readU32(record, 0x10 + index * 4))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(readU16(project.narcs.scripts.rawFiles[0]!, 6)).toBe(151);
    expect(readU16(project.narcs.scripts.rawFiles[0]!, 11)).toBe(150);
    expect(project.narcs.scripts.dirty.has(0)).toBe(true);
  });
});

function makeProject(trades: Uint8Array[]): ProjectState {
  return {
    session: { romName: "trade-test", generation: "gen5", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "IRDO", fileName: "test.nds", size: 1 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      personal: makeStore("personal", Array.from({ length: 200 }, () => new Uint8Array(76))),
      ingame_trades: makeStore("ingame_trades", trades),
    },
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}

function makeTrade(given: number, requested: number): Uint8Array {
  const out = new Uint8Array(108);
  writeU32(out, 4, given);
  writeU32(out, 0x5c, requested);
  return out;
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return { name, sourcePath: "test", fileId: 1, fileCount: rawFiles.length, rawFiles, records: new Map(), dirty: new Set() };
}
