import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAscii, readU16, readU32, writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import {
  buildBattleLogAncestryNarc,
  detectBattleLogCompatibility,
  getBattleLogInstallStatus,
  patchBattleLogWifiListSync,
  restoreBattleLogWifiListSync,
  uninstallBattleLog,
} from "../pokeweb/battleLogModel";
import { parseRpm } from "../pokeweb/rpm";
import type { ProjectState } from "../pokeweb/projectStore";

const white2BattleLogDll = new Uint8Array(
  readFileSync(new URL("../assets/codeinjection/White2UpgradeBattleLog.dll", import.meta.url)),
);
const white2BattleLogSummaryDll = new Uint8Array(
  readFileSync(new URL("../assets/codeinjection/White2UpgradeBattleLogSummary.dll", import.meta.url)),
);
const black2BattleLogDll = new Uint8Array(
  readFileSync(new URL("../assets/codeinjection/Black2UpgradeBattleLog.dll", import.meta.url)),
);
const black2BattleLogSummaryDll = new Uint8Array(
  readFileSync(new URL("../assets/codeinjection/Black2UpgradeBattleLogSummary.dll", import.meta.url)),
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

  it("handles cyclic evolution mappings without duplicating family members", () => {
    const evolutions = [new Uint8Array(42), new Uint8Array(42), new Uint8Array(42)];
    setEvolution(evolutions[1]!, 0, 4, 2);
    setEvolution(evolutions[2]!, 0, 4, 1);
    const archive = new NARC(buildBattleLogAncestryNarc(evolutions));
    expect(readAncestryMember(archive.files[1]!)).toEqual([1, 2]);
    expect(readAncestryMember(archive.files[2]!)).toEqual([1, 2]);
  });

  it("bundles split White 2 battle and summary DLXF runtimes", () => {
    expect(readAscii(white2BattleLogDll, 0, 4)).toBe("DLXF");
    expect(readAscii(white2BattleLogSummaryDll, 0, 4)).toBe("DLXF");
    expect(externalHooks(white2BattleLogDll)).toEqual([
      "167:219ca89:THUMB_BRANCH",
      "167:21a8a65:THUMB_BRANCH",
      "167:21ae36d:THUMB_BRANCH",
    ]);
    expect(externalHooks(white2BattleLogSummaryDll)).toEqual([
      "207:21b6f36:THUMB_BRANCH_LINK",
      "207:21b6f4c:THUMB_BRANCH_LINK",
    ]);
  });

  it("bundles split relocated Black 2 battle and summary DLXF runtimes", () => {
    expect(readAscii(black2BattleLogDll, 0, 4)).toBe("DLXF");
    expect(readAscii(black2BattleLogSummaryDll, 0, 4)).toBe("DLXF");
    for (const dll of [black2BattleLogDll, black2BattleLogSummaryDll]) {
      const rpm = parseRpm(dll, { allowedMagics: ["DLXF"] });
      expect(rpm.metadata).toMatchObject({ PMCGameID: "B2", PMCModulePriority: 4 });
    }
    expect(externalHooks(black2BattleLogDll)).toEqual([
      "167:219ca49:THUMB_BRANCH",
      "167:21a8a25:THUMB_BRANCH",
      "167:21ae32d:THUMB_BRANCH",
    ]);
    expect(externalHooks(black2BattleLogSummaryDll)).toEqual([
      "207:21b6ef6:THUMB_BRANCH_LINK",
      "207:21b6f0c:THUMB_BRANCH_LINK",
    ]);
  });

  it("bundles only stripped battle-log runtimes", () => {
    for (const dll of [
      white2BattleLogDll,
      white2BattleLogSummaryDll,
      black2BattleLogDll,
      black2BattleLogSummaryDll,
    ]) {
      const rpm = parseRpm(dll, { allowedMagics: ["DLXF"] });
      expect(rpm.symbols.every((symbol) => symbol.name === null)).toBe(true);
    }
  });

  it("keeps the White 2 battle-time allocation within the observed fragmented-heap slot", () => {
    // cascdev's 160 KiB PMC heap had 7,136 bytes free but only a 2,528-byte
    // contiguous block when overlay 167 loaded.
    expect(readU32(white2BattleLogDll, 4)).toBeLessThanOrEqual(2528);
    expect(readU32(white2BattleLogSummaryDll, 4)).toBeLessThan(readU32(white2BattleLogDll, 4));
  });

  it("does not recursively import the three retail functions replaced by entry hooks", () => {
    for (const dll of [white2BattleLogDll, black2BattleLogDll]) {
      const rpm = parseRpm(dll, { allowedMagics: ["DLXF"] });
      const imports = rpm.symbols
        .filter((symbol) => (symbol.attributes & 2) !== 0)
        .map((symbol) => symbol.name);

      expect(imports).not.toContain("ServerControl_RegisterTargets");
      expect(imports).not.toContain("ServerControl_CheckFainted");
      expect(imports).not.toContain("MainModule_NotifyBattleResult");
    }
  });

  it("resumes retail entry hooks after the complete eight-byte branch stub", () => {
    // RegisterTargets advances another four bytes so its live r3 moveParam is
    // copied to r7 before the trampoline uses r3 for the absolute branch.
    expect(countU32Occurrences(white2BattleLogDll, 0x021ae379)).toBe(1);
    expect(countU32Occurrences(white2BattleLogDll, 0x021a8a6d)).toBe(1);
    expect(countU32Occurrences(black2BattleLogDll, 0x021ae339)).toBe(1);
    expect(countU32Occurrences(black2BattleLogDll, 0x021a8a2d)).toBe(1);
    expect(countU32Occurrences(white2BattleLogDll, 0x021ae375)).toBe(0);
    expect(countU32Occurrences(white2BattleLogDll, 0x021ae371)).toBe(0);
    expect(countU32Occurrences(white2BattleLogDll, 0x021a8a69)).toBe(0);
    expect(countU32Occurrences(black2BattleLogDll, 0x021ae335)).toBe(0);
    expect(countU32Occurrences(black2BattleLogDll, 0x021ae331)).toBe(0);
    expect(countU32Occurrences(black2BattleLogDll, 0x021a8a29)).toBe(0);
  });

  it("accepts Black 2 and defers byte checks until a ROM is available", () => {
    const project = makeProject("B2");
    expect(detectBattleLogCompatibility(project)).toMatchObject({ supported: true, compatible: true, checked: false });
  });

  it("statically retires the Wi-Fi List shadow copy and is idempotent", () => {
    const arm9 = hexBytes("014a024b1847c046c40700004c890702");
    const once = patchBattleLogWifiListSync(arm9, 0x02009f0c);
    const twice = patchBattleLogWifiListSync(once, 0x02009f0c);

    expect([...once]).toEqual([...hexBytes("7047024b1847c046c40700004c890702")]);
    expect([...twice]).toEqual([...once]);
    expect([...arm9]).toEqual([...hexBytes("014a024b1847c046c40700004c890702")]);
  });

  it("retires Black 2's relocated memcpy target without changing its source", () => {
    const arm9 = hexBytes("014a024b1847c046c407000020890702");
    const patched = patchBattleLogWifiListSync(arm9, 0x02009f0c, "B2");

    expect([...patched]).toEqual([...hexBytes("7047024b1847c046c407000020890702")]);
    expect([...arm9]).toEqual([...hexBytes("014a024b1847c046c407000020890702")]);
  });

  it("restores the Wi-Fi List routine when staged battle-log DLLs are uninstalled", () => {
    const project = makeProject("W2");
    const guardOffset = 0x02009f0c - 0x02004000;
    project.arm9 = new Uint8Array(guardOffset + 16);
    project.arm9.set(hexBytes("7047024b1847c046c40700004c890702"), guardOffset);
    project.fileSystem = {
      replacements: {},
      additions: {
        "patches/White2UpgradeBattleLog.dll": white2BattleLogDll,
        "patches/White2UpgradeBattleLogSummary.dll": white2BattleLogSummaryDll,
        "battlelog/ancestry.narc": new Uint8Array([1]),
      },
    };
    project.codeInjection = {
      battleLog: { ancestryPath: "battlelog/ancestry.narc" },
      modules: [
        { path: "patches/White2UpgradeBattleLog.dll", target: "patches", fileName: "White2UpgradeBattleLog.dll" },
        { path: "patches/White2UpgradeBattleLogSummary.dll", target: "patches", fileName: "White2UpgradeBattleLogSummary.dll" },
      ],
    };

    uninstallBattleLog(project);

    expect(project.arm9.subarray(guardOffset, guardOffset + 16)).toEqual(hexBytes("014a024b1847c046c40700004c890702"));
    expect(project.fileSystem.additions).toEqual({});
    expect(project.codeInjection.modules).toEqual([]);
    expect(project.codeInjection.battleLog).toBeUndefined();
    expect(getBattleLogInstallStatus(project).installed).toBe(false);
  });

  it("restores a disabled Wi-Fi List routine idempotently", () => {
    const disabled = hexBytes("7047024b1847c046c40700004c890702");
    const restored = restoreBattleLogWifiListSync(disabled, 0x02009f0c);
    expect(restored).toEqual(hexBytes("014a024b1847c046c40700004c890702"));
    expect(restoreBattleLogWifiListSync(restored, 0x02009f0c)).toEqual(restored);
  });

  it("recognizes an installed split runtime after persistence releases the source ROM bytes", () => {
    const project = makeProject("W2");
    const guardOffset = 0x02009f0c - 0x02004000;
    project.arm9 = new Uint8Array(guardOffset + 16);
    project.arm9.set(hexBytes("7047024b1847c046c40700004c890702"), guardOffset);
    project.fileSystem = {
      // Existing modified ROMs replace the ancestry file by numeric file ID.
      // Once persistence releases originalRomBytes, the path can only be
      // recovered from the explicit battle-log install marker.
      replacements: { 123: new Uint8Array([1]) },
    };
    project.codeInjection = {
      pmc: { overlayId: 344, overlayPath: "overlay/overlay_0344.bin" },
      battleLog: { ancestryPath: "battlelog/ancestry.narc" },
      modules: [
        { path: "patches/White2UpgradeBattleLog.dll", target: "patches", fileName: "White2UpgradeBattleLog.dll" },
        { path: "patches/White2UpgradeBattleLogSummary.dll", target: "patches", fileName: "White2UpgradeBattleLogSummary.dll" },
      ],
    };
    expect(getBattleLogInstallStatus(project)).toMatchObject({
      installed: true,
      dllInstalled: true,
      summaryDllInstalled: true,
      saveGuardInstalled: true,
    });
  });
});

function externalHooks(bytes: Uint8Array): string[] {
  return parseRpm(bytes, { allowedMagics: ["DLXF"] }).relocations
    .filter((relocation) => relocation.target.module !== "base")
    .map((relocation) => `${relocation.target.module}:${relocation.target.address.toString(16)}:${relocation.target.type}`)
    .sort();
}

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
