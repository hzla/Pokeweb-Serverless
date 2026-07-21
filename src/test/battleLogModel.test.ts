import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAscii, readU16, readU32, writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import {
  buildBattleLogAncestryNarc,
  detectBattleLogCompatibility,
  patchBattleLogWifiListSync,
} from "../pokeweb/battleLogModel";
import { parseRpm } from "../pokeweb/rpm";
import type { ProjectState } from "../pokeweb/projectStore";

const battleLogDll = new Uint8Array(
  readFileSync(new URL("../assets/codeinjection/White2UpgradeBattleLog.dll", import.meta.url)),
);

describe("trainer battle log", () => {
  it("builds 1,024 ancestry members from vanilla evolution records", () => {
    const evolutions = Array.from({ length: 5 }, () => new Uint8Array(42));
    setEvolution(evolutions[1]!, 0, 4, 2);
    setEvolution(evolutions[2]!, 0, 4, 3);
    setEvolution(evolutions[1]!, 1, 4, 4);

    const archive = new NARC(buildBattleLogAncestryNarc(evolutions));

    expect(archive.files).toHaveLength(1024);
    expect(readAncestryMember(archive.files[3]!)).toEqual([1, 2, 3]);
    expect(readAncestryMember(archive.files[4]!)).toEqual([1, 4]);
    expect(readAncestryMember(archive.files[900]!)).toEqual([900]);
  });

  it("accepts expanded 48-byte evolution records and rejects mixed record sizes", () => {
    expect(() => buildBattleLogAncestryNarc([new Uint8Array(48)])).not.toThrow();
    expect(() => buildBattleLogAncestryNarc([new Uint8Array(42), new Uint8Array(48)])).toThrow(/expected 42/u);
  });

  it("rejects cyclic evolution mappings", () => {
    const evolutions = [new Uint8Array(42), new Uint8Array(42), new Uint8Array(42)];
    setEvolution(evolutions[1]!, 0, 4, 2);
    setEvolution(evolutions[2]!, 0, 4, 1);
    expect(() => buildBattleLogAncestryNarc(evolutions)).toThrow(/cycle/u);
  });

  it("bundles the current two-overlay DLXF runtime", () => {
    expect(readAscii(battleLogDll, 0, 4)).toBe("DLXF");
    const rpm = parseRpm(battleLogDll, { allowedMagics: ["DLXF"] });
    const hooks = rpm.relocations
      .filter((relocation) => relocation.target.module !== "base")
      .map((relocation) => `${relocation.target.module}:${relocation.target.address.toString(16)}:${relocation.target.type}`)
      .sort();

    expect(hooks).toEqual([
      "167:219ca89:THUMB_BRANCH",
      "167:21a8a65:THUMB_BRANCH",
      "167:21ae36d:THUMB_BRANCH",
      "207:21b6f36:THUMB_BRANCH_LINK",
      "207:21b6f4c:THUMB_BRANCH_LINK",
    ]);
  });

  it("does not recursively import the three retail functions replaced by entry hooks", () => {
    const rpm = parseRpm(battleLogDll, { allowedMagics: ["DLXF"] });
    const imports = rpm.symbols
      .filter((symbol) => (symbol.attributes & 2) !== 0)
      .map((symbol) => symbol.name);

    expect(imports).not.toContain("ServerControl_RegisterTargets");
    expect(imports).not.toContain("ServerControl_CheckFainted");
    expect(imports).not.toContain("MainModule_NotifyBattleResult");
  });

  it("resumes retail entry hooks after the complete eight-byte branch stub", () => {
    // RegisterTargets advances another four bytes so its live r3 moveParam is
    // copied to r7 before the trampoline uses r3 for the absolute branch.
    expect(countU32Occurrences(battleLogDll, 0x021ae379)).toBe(1);
    expect(countU32Occurrences(battleLogDll, 0x021a8a6d)).toBe(1);
    expect(countU32Occurrences(battleLogDll, 0x021ae375)).toBe(0);
    expect(countU32Occurrences(battleLogDll, 0x021ae371)).toBe(0);
    expect(countU32Occurrences(battleLogDll, 0x021a8a69)).toBe(0);
  });

  it("rejects Black 2 before checking hook bytes", () => {
    const project = makeProject("B2");
    expect(detectBattleLogCompatibility(project)).toMatchObject({ supported: false, compatible: false });
  });

  it("statically retires the Wi-Fi List shadow copy and is idempotent", () => {
    const arm9 = hexBytes("014a024b1847c046c40700004c890702");
    const once = patchBattleLogWifiListSync(arm9, 0x02009f0c);
    const twice = patchBattleLogWifiListSync(once, 0x02009f0c);

    expect([...once]).toEqual([...hexBytes("7047024b1847c046c40700004c890702")]);
    expect([...twice]).toEqual([...once]);
    expect([...arm9]).toEqual([...hexBytes("014a024b1847c046c40700004c890702")]);
  });
});

function setEvolution(member: Uint8Array, slot: number, method: number, target: number): void {
  const offset = slot * 6;
  writeU16(member, offset, method);
  writeU16(member, offset + 4, target);
}

function readAncestryMember(member: Uint8Array): number[] {
  expect(member[0]).toBe(1);
  return Array.from({ length: member[1] ?? 0 }, (_value, index) => readU16(member, 2 + index * 2));
}

function countU32Occurrences(bytes: Uint8Array, value: number): number {
  let count = 0;
  for (let offset = 0; offset + 4 <= bytes.length; offset += 1) {
    if (readU32(bytes, offset) === value) count += 1;
  }
  return count;
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from({ length: hex.length / 2 }, (_value, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

function makeProject(baseVersion: "B2" | "W2"): ProjectState {
  return {
    session: {
      romName: "test",
      baseVersion,
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: baseVersion === "W2" ? "IRDO" : "IREO", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}
