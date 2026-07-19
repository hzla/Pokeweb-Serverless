import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAscii } from "../nds/binary";
import { parseRpm } from "../pokeweb/rpm";
import { PWAN_CARRIER_METADATA_OFFSETS } from "../pokeweb/pwanCarrierPatch";

const assetUrl = (name: string): URL => new URL(`../assets/codeinjection/${name}`, import.meta.url);
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

describe("bundled PWAN runtime artifacts", () => {
  it("bundles the current split targets and no obsolete monolith", () => {
    const expected = {
      "PokewebPwanSummaryW2.dll": "W2",
      "PokewebPwanBattleW2.dll": "W2",
      "PokewebPwanMiscW2.dll": "W2",
      "PokewebPwanSummaryB2.dll": "B2",
      "PokewebPwanBattleB2.dll": "B2",
      "PokewebPwanMiscB2.dll": "B2",
      "PokewebPwanLegacyRetiredW2.dll": "W2",
    } as const;
    const manifest = JSON.parse(readFileSync(assetUrl("pwan-runtime-manifest.json"), "utf8")) as {
      artifacts: Record<string, { gameId: string; scope: string; sha256: string; size: number }>;
    };

    for (const [fileName, gameId] of Object.entries(expected)) {
      const bytes = new Uint8Array(readFileSync(assetUrl(fileName)));
      expect(readAscii(bytes, 0, 4), fileName).toBe("DLXF");
      expect(manifest.artifacts[fileName]).toMatchObject({ gameId, sha256: sha256(bytes), size: bytes.length });
    }
    expect(existsSync(assetUrl("PokewebPwanW2.dll"))).toBe(false);
  });

  it("keeps a separately addressable Black 2 carrier set", () => {
    const manifest = JSON.parse(readFileSync(new URL("../assets/pwan/carrier-b2/manifest.json", import.meta.url), "utf8")) as {
      gameId: string;
      archivePath: string;
      sourceAssetIndex: number;
      files: Record<string, string>;
    };
    expect(manifest).toMatchObject({ gameId: "IREO", archivePath: "a/0/0/4", sourceAssetIndex: 0 });
    for (const offset of PWAN_CARRIER_METADATA_OFFSETS) {
      const black2 = readFileSync(new URL(`../assets/pwan/carrier-b2/file${offset}.bin`, import.meta.url));
      expect(sha256(black2), `carrier file ${offset}`).toBe(manifest.files[String(offset)]);
    }
  });

  it("limits the Black 2 DLL to the seven verified battle hook sites", () => {
    const bytes = new Uint8Array(readFileSync(assetUrl("PokewebPwanBattleB2.dll")));
    const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    const hooks = rpm.relocations
      .filter((relocation) => relocation.target.type === "THUMB_BRANCH_LINK" && relocation.target.module !== "base")
      .map((relocation) => `${relocation.target.module}:${relocation.target.address.toString(16)}`)
      .sort();

    expect(hooks).toEqual([
      "167:21d36c0",
      "168:21df208",
      "168:21df280",
      "168:21df2b8",
      "168:21df79c",
      "168:21e07e2",
      "168:21e08d2",
    ]);
  });

  it("limits the Black 2 summary DLL to its three overlay 207 hook sites", () => {
    const bytes = new Uint8Array(readFileSync(assetUrl("PokewebPwanSummaryB2.dll")));
    const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    const hooks = rpm.relocations
      .filter((relocation) => relocation.target.type === "THUMB_BRANCH_LINK" && relocation.target.module !== "base")
      .map((relocation) => `${relocation.target.module}:${relocation.target.address.toString(16)}`)
      .sort();

    expect(hooks).toEqual(["207:21b316a", "207:21b333e", "207:21b3356"]);
  });

  it("limits the Black 2 misc DLL to its verified non-battle hook sites", () => {
    const bytes = new Uint8Array(readFileSync(assetUrl("PokewebPwanMiscB2.dll")));
    const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    const hooks = rpm.relocations
      .filter((relocation) => relocation.target.type === "THUMB_BRANCH_LINK" && relocation.target.module !== "base")
      .map((relocation) => `${relocation.target.module}:${relocation.target.address.toString(16)}`)
      .sort();

    expect(hooks).toEqual([
      "265:2199ebc",
      "265:219a116",
      "265:219a126",
      "265:219a154",
      "284:21e3d6e",
      "284:21e5170",
      "284:21e5176",
      "284:21e5192",
      "284:21e5198",
      "284:21e5324",
      "284:21e536e",
      "284:21e53b0",
      "298:21a8624",
      "298:21a8eba",
      "298:21a8eca",
      "298:21a8f08",
      "307:21de000",
      "307:21dee3a",
      "307:21dee46",
      "307:21def14",
      "307:21df0ca",
    ]);
  });
});
