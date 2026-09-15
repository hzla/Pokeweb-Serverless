export type BattleLogGuardVersion = "B" | "W" | "B2" | "W2";

const urls = {
  B: new URL("../assets/codeinjection/BattleLogSaveGuardB.dll", import.meta.url).href,
  W: new URL("../assets/codeinjection/BattleLogSaveGuardW.dll", import.meta.url).href,
  B2: new URL("../assets/codeinjection/BattleLogSaveGuardB2.dll", import.meta.url).href,
  W2: new URL("../assets/codeinjection/BattleLogSaveGuardW2.dll", import.meta.url).href,
};

export function battleLogSaveGuard(version: BattleLogGuardVersion) {
  const bw2 = version.endsWith("2");
  const filename = `BattleLogSaveGuard${version}.dll`;
  return {
    filename, path: `patches/${filename}`, url: urls[version],
    // One lazily allocated root-application-heap buffer; no extra flash writes.
    bssSize: 4, applicationHeapBytes: 10320,
    imports: [{ label: "Application heap allocator", overlayId: 0,
      address: version === "W2" ? 0x02039dc8 : version === "B2" ? 0x02039d9c : version === "W" ? 0x020300b0 : 0x02030098,
      expectedHex: bw2 ? "f8b582b0051c022080030f1c284202d00324e44300e00424" : "f8432de9b4809fe50070a0e10160a0e1ac009fe5020917e3" }],
    hooks: [
      { label: "Isolate Geonet / Unity Tower / trade history", overlayId: 0,
        address: bw2 ? 0x02009b78 : 0x02009470,
        expectedHex: bw2 ? "014b1d211847c04649740002" : "014b1d211847c046cd710002" },
      { label: "Isolate Pal Pad save data", overlayId: 0,
        address: bw2 ? 0x0200a424 : 0x02009d08,
        expectedHex: bw2 ? "10b51e21fdf70ef80021041cfff75efe201c10bd" : "10b51e21fdf75efa0021041cfff75efe201c10bd" },
      { label: "Isolate trade-negotiation history", overlayId: 0,
        address: bw2 ? 0x0200a5e4 : 0x02009ec8,
        expectedHex: bw2 ? "014b1f211847c04649740002" : "014b1f211847c046cd710002" },
    ],
    daily: {
      label: "Disable daily Geonet rewrite", overlayId: 0,
      address: bw2 ? 0x02009c48 : 0x0200952c,
      expectedHex: "f8b58646002703220221ff2603207346",
      disabledHex: "70478646002703220221ff2603207346",
    },
  };
}

/** Verify the whole entry before making an idempotent, reversible 2-byte edit. */
export function patchBattleLogGeonet(arm9: Uint8Array, base: number, version: BattleLogGuardVersion, restore = false): Uint8Array {
  const guard = battleLogSaveGuard(version).daily;
  const offset = guard.address - base;
  const actual = Array.from(arm9.subarray(Math.max(offset, 0), offset + 16), (b) => b.toString(16).padStart(2, "0")).join("");
  if (offset < 0 || (actual !== guard.expectedHex && actual !== guard.disabledHex)) {
    throw new Error("Geonet save-guard signature mismatch; no changes made.");
  }
  const result = arm9.slice();
  result.set(restore ? [0xf8, 0xb5] : [0x70, 0x47], offset);
  return result;
}
