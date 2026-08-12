import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAscii, readU16 } from "../nds/binary";
import { EVO_METHODS } from "../pokeweb/constants";
import { canUninstallBattleLog, uninstallBattleLog } from "../pokeweb/battleLogModel";
import {
  MENU_EVOLUTION_B2_PATH,
  MENU_EVOLUTION_CONFIG_VERSION,
  MENU_EVOLUTION_COUNTER_PARAMETER_IDS,
  MENU_EVOLUTION_GET_PARTY_PARAMETER_COMMAND,
  MENU_EVOLUTION_MESSAGE_BANK_ID,
  MENU_EVOLUTION_W2_PATH,
  canUninstallMenuEvolution,
  configureMenuEvolutionDll,
  ensureEvolveMessage,
  getMenuEvolutionInstallStatus,
  uninstallMenuEvolution,
} from "../pokeweb/menuEvolutionModel";
import { evolutionParamAutofillKey } from "../pokeweb/pokemonModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm } from "../pokeweb/rpm";
import { encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";

const menuEvolutionW2 = new Uint8Array(
  readFileSync(new URL("../assets/codeinjection/MenuEvolutionW2.dll", import.meta.url)),
);
const menuEvolutionB2 = new Uint8Array(
  readFileSync(new URL("../assets/codeinjection/MenuEvolutionB2.dll", import.meta.url)),
);
const formEvolutionW2 = new Uint8Array(
  readFileSync(new URL("../assets/codeinjection/FormEvolutionW2.dll", import.meta.url)),
);
const formEvolutionB2 = new Uint8Array(
  readFileSync(new URL("../assets/codeinjection/FormEvolutionB2.dll", import.meta.url)),
);

describe("BW2 Menu Evolution", () => {
  it("bundles stripped, versioned B2 and W2 runtimes with the intended hooks", () => {
    for (const [version, dll, hooks] of [
      ["W2", menuEvolutionW2, [
        "12:215701c:THUMB_BRANCH",
        "12:215c3a6:THUMB_BRANCH_LINK",
        "12:215c3e4:THUMB_BRANCH",
        "165:219bb3e:THUMB_BRANCH_LINK",
        "165:219cf24:THUMB_BRANCH_LINK",
        "165:219fe04:THUMB_BRANCH_LINK",
      ]],
      ["B2", menuEvolutionB2, [
        "12:2156fdc:THUMB_BRANCH",
        "12:215c366:THUMB_BRANCH_LINK",
        "12:215c3a4:THUMB_BRANCH",
        "165:219bafe:THUMB_BRANCH_LINK",
        "165:219cee4:THUMB_BRANCH_LINK",
        "165:219fdc4:THUMB_BRANCH_LINK",
      ]],
    ] as const) {
      expect(readAscii(dll, 0, 4)).toBe("DLXF");
      const rpm = parseRpm(dll, { allowedMagics: ["DLXF"] });
      expect(rpm.metadata).toMatchObject({ PMCGameID: version, PMCModulePriority: 4 });
      expect(rpm.symbols.every((symbol) => symbol.name === null)).toBe(true);
      expect(externalHooks(dll)).toEqual(hooks);
    }
  });

  it("does not overlap the existing added-form evolution hook locations", () => {
    expect(intersection(externalHooks(menuEvolutionW2), externalHooks(formEvolutionW2))).toEqual([]);
    expect(intersection(externalHooks(menuEvolutionB2), externalHooks(formEvolutionB2))).toEqual([]);
  });

  it("configures exactly one versioned Evolve message field without changing the source artifact", () => {
    const configured = configureMenuEvolutionDll(menuEvolutionW2, 321);
    const marker = findMarker(configured);

    expect(marker).toBeGreaterThanOrEqual(0);
    expect(readU16(configured, marker + 8)).toBe(MENU_EVOLUTION_CONFIG_VERSION);
    expect(readU16(configured, marker + 10)).toBe(321);
    expect(readU16(configured, marker + 12)).toBe(321 ^ 0xffff);
    expect(readU16(menuEvolutionW2, marker + 10)).toBe(0xffff);
    expect(() => configureMenuEvolutionDll(menuEvolutionW2, 0x10000)).toThrow(/Invalid/u);
  });

  it("adds the three counter evolution methods as unsigned integer thresholds", () => {
    expect(EVO_METHODS.slice(29, 32)).toEqual(["KO Count", "Battle Count", "Battles Used Count"]);
    expect(evolutionParamAutofillKey(29)).toBeUndefined();
    expect(evolutionParamAutofillKey(30)).toBeUndefined();
    expect(evolutionParamAutofillKey(31)).toBeUndefined();
  });

  it("publishes the field-script command and read-only counter parameter IDs", () => {
    expect(MENU_EVOLUTION_GET_PARTY_PARAMETER_COMMAND).toBe(0x010c);
    expect(MENU_EVOLUTION_COUNTER_PARAMETER_IDS).toEqual({
      kos: 0x0400,
      battlesBrought: 0x0401,
      battlesUsed: 0x0402,
    });
  });

  it("appends one reusable Evolve message ID and preserves it across companion uninstall", () => {
    const project = makeProject("W2", true);
    const first = ensureEvolveMessage(project);
    const second = ensureEvolveMessage(project);

    expect(first).toBe(2);
    expect(second).toBe(first);
    expect(project.texts.messageTexts?.[MENU_EVOLUTION_MESSAGE_BANK_ID]?.filter((entry) => entry[1] === "EVOLVE")).toHaveLength(1);

    project.codeInjection!.menuEvolution = { messageBankId: MENU_EVOLUTION_MESSAGE_BANK_ID, messageEntryId: first };
    project.codeInjection!.modules!.push({ path: MENU_EVOLUTION_W2_PATH, target: "patches", fileName: "MenuEvolutionW2.dll" });
    project.fileSystem!.additions![MENU_EVOLUTION_W2_PATH] = menuEvolutionW2;
    expect(canUninstallMenuEvolution(project)).toBe(true);
    uninstallMenuEvolution(project);

    expect(project.fileSystem?.additions?.[MENU_EVOLUTION_W2_PATH]).toBeUndefined();
    expect(project.codeInjection?.menuEvolution).toBeUndefined();
    expect(project.texts.messageTexts?.[MENU_EVOLUTION_MESSAGE_BANK_ID]?.some((entry) => entry[1] === "EVOLVE")).toBe(true);
  });

  it("reports the matching battle-counter DLL as a required dependency", () => {
    const missing = getMenuEvolutionInstallStatus(makeProject("B2", false));
    const ready = getMenuEvolutionInstallStatus(makeProject("B2", true));

    expect(missing).toMatchObject({ supported: true, compatible: true, installed: false, dependencyInstalled: false });
    expect(ready).toMatchObject({ supported: true, compatible: true, installed: false, dependencyInstalled: true });
  });

  it("prevents removing battle counters while the companion remains installed", () => {
    const project = makeProject("W2", true);
    project.codeInjection!.menuEvolution = { messageBankId: MENU_EVOLUTION_MESSAGE_BANK_ID, messageEntryId: 15 };
    for (const fileName of ["White2UpgradeBattleLog.dll", "White2UpgradeBattleLogSummary.dll", "MenuEvolutionW2.dll"]) {
      const path = `patches/${fileName}`;
      project.codeInjection!.modules!.push({ path, target: "patches", fileName });
      project.fileSystem!.additions![path] = new Uint8Array([1]);
    }
    project.fileSystem!.additions!["patches/White2UpgradeBattleCounters.dll"] = new Uint8Array([1]);

    expect(canUninstallBattleLog(project)).toBe(false);
    expect(() => uninstallBattleLog(project)).toThrow(/Uninstall Menu Evolution/u);
  });
});

function externalHooks(bytes: Uint8Array): string[] {
  return parseRpm(bytes, { allowedMagics: ["DLXF"] }).relocations
    .filter((relocation) => relocation.target.module !== "base")
    .map((relocation) => `${relocation.target.module}:${relocation.target.address.toString(16)}:${relocation.target.type}`)
    .sort();
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function findMarker(bytes: Uint8Array): number {
  const marker = new TextEncoder().encode("MEVOMSG\0");
  for (let offset = 0; offset + marker.length <= bytes.length; offset += 1) {
    if (marker.every((value, index) => bytes[offset + index] === value)) return offset;
  }
  return -1;
}

function makeProject(version: "B2" | "W2", withCounter: boolean): ProjectState {
  const bank: Gen5TextEntry[] = [
    ["0_0", "Summary", 0],
    ["0_1", "Cancel", 0],
  ];
  const rawFiles: Uint8Array[] = Array.from({ length: MENU_EVOLUTION_MESSAGE_BANK_ID + 1 }, () => new Uint8Array());
  rawFiles[MENU_EVOLUTION_MESSAGE_BANK_ID] = encodeGen5TextBank(bank);
  const project: ProjectState = {
    session: {
      romName: "test",
      baseVersion: version,
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: version === "W2" ? "IRDO" : "IREO", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      message_texts: {
        name: "message_texts",
        fileId: 0,
        sourcePath: "a/0/0/2",
        fileCount: rawFiles.length,
        rawFiles,
        records: new Map(),
        dirty: new Set(),
      },
    },
    texts: {
      banks: {},
      messageTexts: Array.from({ length: MENU_EVOLUTION_MESSAGE_BANK_ID + 1 }, (_value, index) => index === MENU_EVOLUTION_MESSAGE_BANK_ID ? bank : []),
    },
    formats: {},
    trpokInfo: [],
    fileSystem: { replacements: {}, additions: {} },
    codeInjection: { modules: [] },
  };
  if (withCounter) {
    const fileName = version === "W2" ? "White2UpgradeBattleCounters.dll" : "Black2UpgradeBattleCounters.dll";
    project.codeInjection!.modules!.push({ path: `patches/${fileName}`, target: "patches", fileName });
  }
  return project;
}
