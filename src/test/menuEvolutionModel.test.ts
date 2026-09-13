import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { readAscii, readU16 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { EVO_METHODS } from "../pokeweb/constants";
import { canUninstallBattleLog, getBattleLogInstallStatus, installBattleLog, uninstallBattleLog } from "../pokeweb/battleLogModel";
import { KO_MOVE_LEARNSET_PATH, appendPokemonKoMove, ensureKoMoveLearnsetNarc, getPokemonKoMoves, updatePokemonKoMoveField } from "../pokeweb/koMoveLearnsetModel";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { loadActiveRomBytes } from "../pokeweb/persistence";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { prepareBw2TestBattleCodeInjection } from "../pokeweb/pmcModel";
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
  ensureRelearnMessage,
  getMenuEvolutionInstallStatus,
  installMenuEvolution,
  isKoMoveEditorAvailable,
  uninstallMenuEvolution,
} from "../pokeweb/menuEvolutionModel";
import { evolutionParamAutofillKey } from "../pokeweb/pokemonModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm } from "../pokeweb/rpm";
import { encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";

// Keep this mock independent of the real persistence module's model imports,
// so all installer/export callers see the same IndexedDB-backed source stub.
vi.mock("../pokeweb/persistence", () => ({
  loadActiveRomBytes: vi.fn(),
}));

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
        "12:215b4d8:THUMB_BRANCH_LINK",
        "12:215c3a6:THUMB_BRANCH_LINK",
        "12:215c3e4:THUMB_BRANCH",
        "165:219bb3e:THUMB_BRANCH_LINK",
        "165:219cf24:THUMB_BRANCH_LINK",
        "165:219fe04:THUMB_BRANCH_LINK",
        "166:219cfa4:THUMB_BRANCH_LINK",
        "166:219d2aa:THUMB_BRANCH_LINK",
      ]],
      ["B2", menuEvolutionB2, [
        "12:2156fdc:THUMB_BRANCH",
        "12:215b498:THUMB_BRANCH_LINK",
        "12:215c366:THUMB_BRANCH_LINK",
        "12:215c3a4:THUMB_BRANCH",
        "165:219bafe:THUMB_BRANCH_LINK",
        "165:219cee4:THUMB_BRANCH_LINK",
        "165:219fdc4:THUMB_BRANCH_LINK",
        "166:219cf64:THUMB_BRANCH_LINK",
        "166:219d26a:THUMB_BRANCH_LINK",
      ]],
    ] as const) {
      expect(readAscii(dll, 0, 4)).toBe("DLXF");
      const rpm = parseRpm(dll, { allowedMagics: ["DLXF"] });
      expect(rpm.metadata).toMatchObject({ PMCGameID: version, PMCModulePriority: 4, PMCVersion: "1.3.1" });
      expect(rpm.symbols.every((symbol) => symbol.name === null)).toBe(true);
      expect(externalHooks(dll)).toEqual(hooks);
    }
  });

  it("does not overlap the existing added-form evolution hook locations", () => {
    expect(intersection(externalHooks(menuEvolutionW2), externalHooks(formEvolutionW2))).toEqual([]);
    expect(intersection(externalHooks(menuEvolutionB2), externalHooks(formEvolutionB2))).toEqual([]);
  });

  it("configures both versioned party-command message fields without changing the source artifact", () => {
    const configured = configureMenuEvolutionDll(menuEvolutionW2, 321, 654);
    const marker = findMarker(configured);

    expect(marker).toBeGreaterThanOrEqual(0);
    expect(readU16(configured, marker + 8)).toBe(MENU_EVOLUTION_CONFIG_VERSION);
    expect(readU16(configured, marker + 10)).toBe(321);
    expect(readU16(configured, marker + 12)).toBe(321 ^ 0xffff);
    expect(readU16(configured, marker + 14)).toBe(654);
    expect(readU16(configured, marker + 16)).toBe(654 ^ 0xffff);
    expect(readU16(menuEvolutionW2, marker + 10)).toBe(0xffff);
    expect(readU16(menuEvolutionW2, marker + 14)).toBe(0xffff);
    expect(readU16(configured, marker + 18)).toBe(0);
    for (let offset = 0; offset < configured.length; offset += 1) {
      if (offset < marker + 10 || offset >= marker + 18) expect(configured[offset]).toBe(menuEvolutionW2[offset]);
    }
    for (const invalid of [-1, 0xffff, 0x10000, NaN, 1.5]) {
      expect(() => configureMenuEvolutionDll(menuEvolutionW2, invalid, 1)).toThrow(/Invalid/u);
      expect(() => configureMenuEvolutionDll(menuEvolutionW2, 1, invalid)).toThrow(/Invalid/u);
    }
    const boundaries = configureMenuEvolutionDll(menuEvolutionW2, 0, 0xfffe);
    expect(readU16(boundaries, marker + 10)).toBe(0);
    expect(readU16(boundaries, marker + 14)).toBe(0xfffe);
    const legacy = menuEvolutionW2.slice();
    legacy[marker + 8] = 1;
    expect(() => configureMenuEvolutionDll(legacy, 1, 2)).toThrow(/unsupported/u);
    expect(() => configureMenuEvolutionDll(menuEvolutionW2.subarray(0, marker + 19), 1, 2)).toThrow(/unsupported/u);
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

  it("appends reusable EVOLVE and RELEARN IDs and preserves them across companion uninstall", () => {
    const project = makeProject("W2", true);
    const first = ensureEvolveMessage(project);
    const second = ensureEvolveMessage(project);

    expect(first).toBe(2);
    expect(second).toBe(first);
    expect(project.texts.messageTexts?.[MENU_EVOLUTION_MESSAGE_BANK_ID]?.filter((entry) => entry[1] === "EVOLVE")).toHaveLength(1);
    const relearn = ensureRelearnMessage(project);
    expect(relearn).toBe(3);
    const relearnEntry = project.texts.messageTexts![MENU_EVOLUTION_MESSAGE_BANK_ID]!.find((entry) => entry[1] === "RELEARN")!;
    relearnEntry[1] = "Relearn";
    expect(ensureRelearnMessage(project)).toBe(relearn);
    expect(relearnEntry[1]).toBe("RELEARN");
    expect(ensureEvolveMessage(project)).toBe(first);

    project.codeInjection!.menuEvolution = { messageBankId: MENU_EVOLUTION_MESSAGE_BANK_ID, messageEntryId: first };
    project.codeInjection!.modules!.push({ path: MENU_EVOLUTION_W2_PATH, target: "patches", fileName: "MenuEvolutionW2.dll" });
    project.fileSystem!.additions![MENU_EVOLUTION_W2_PATH] = menuEvolutionW2;
    expect(canUninstallMenuEvolution(project)).toBe(true);
    uninstallMenuEvolution(project);

    expect(project.fileSystem?.additions?.[MENU_EVOLUTION_W2_PATH]).toBeUndefined();
    expect(project.codeInjection?.menuEvolution).toBeUndefined();
    expect(project.texts.messageTexts?.[MENU_EVOLUTION_MESSAGE_BANK_ID]?.some((entry) => entry[1] === "EVOLVE")).toBe(true);
    expect(project.texts.messageTexts?.[MENU_EVOLUTION_MESSAGE_BANK_ID]?.some((entry) => entry[1] === "RELEARN")).toBe(true);
  });

  it("offers an update for the previous companion and recognizes configured 1.3.1 artifacts", () => {
    const project = makeProject("W2", true);
    project.narcs.learnsets = {
      name: "learnsets", fileId: 1, sourcePath: "a/0/1/8", fileCount: 1,
      rawFiles: [new Uint8Array()], records: new Map(), dirty: new Set(),
    };
    ensureKoMoveLearnsetNarc(project);
    project.codeInjection!.modules!.push({ path: MENU_EVOLUTION_W2_PATH, target: "patches", fileName: "MenuEvolutionW2.dll", version: "1.3.0" });
    expect(getMenuEvolutionInstallStatus(project)).toMatchObject({ installed: true, upToDate: false, updateAvailable: true });
    // Bytes are authoritative even when persisted browser metadata is old.
    project.fileSystem!.additions![MENU_EVOLUTION_W2_PATH] = configureMenuEvolutionDll(menuEvolutionW2, 2, 3);
    expect(getMenuEvolutionInstallStatus(project)).toMatchObject({ installed: true, upToDate: true, updateAvailable: false });
  });

  it("reports the matching battle-counter DLL as a required dependency", () => {
    const missing = getMenuEvolutionInstallStatus(makeProject("B2", false));
    const ready = getMenuEvolutionInstallStatus(makeProject("B2", true));

    expect(missing).toMatchObject({ supported: true, compatible: true, installed: false, dependencyInstalled: false });
    expect(ready).toMatchObject({ supported: true, compatible: true, installed: false, dependencyInstalled: true });
  });

  it("keeps the KO Moves editor hidden when only its retained data NARC exists", () => {
    const project = makeProject("W2", true);
    project.narcs.learnsets = {
      name: "learnsets",
      fileId: 1,
      sourcePath: "a/0/1/8",
      fileCount: 4,
      rawFiles: Array.from({ length: 4 }, () => new Uint8Array()),
      records: new Map(),
      dirty: new Set(),
    };
    ensureKoMoveLearnsetNarc(project);

    expect(isKoMoveEditorAvailable(project)).toBe(false);
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
    expect(() => uninstallBattleLog(project)).toThrow(/Uninstall Enhanced Party Menu and Battle Log Integration/u);
  });

  for (const [version, filename] of [["B2", "cleanblack2.nds"], ["W2", "cleanwhite2.nds"]] as const) {
    const fixture = new URL(`../../../${filename}`, import.meta.url);
    it.runIf(existsSync(fixture))(`preserves KO edits through ${version} import, autosave, update, and Test Battle export preparation`, async () => {
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input));
        const name = url.pathname.split("/").pop()!;
        return new Response(new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${name}`, import.meta.url))));
      }));
      try {
        const project = await loadProjectFromRomBytes(new Uint8Array(readFileSync(fixture)), filename, { selectedNarcs: ["message_texts", "evolutions", "learnsets"] });
        await installBattleLog(project);
        await installMenuEvolution(project);
        appendPokemonKoMove(project, 6);
        updatePokemonKoMoveField(project, 6, "move_id_0", "126");
        updatePokemonKoMoveField(project, 6, "ko_count_0", "1");
        const exported = await exportModifiedRom(project);
        const reloaded = await loadProjectFromRomBytes(exported, filename, { selectedNarcs: ["message_texts", "evolutions", "learnsets"] });
        const source = reloaded.originalRomBytes!;
        const fileId = new NintendoDSRom(source).fileId(KO_MOVE_LEARNSET_PATH);
        vi.mocked(loadActiveRomBytes).mockResolvedValue(source);
        delete reloaded.originalRomBytes;
        expect({ menu: getMenuEvolutionInstallStatus(reloaded), battle: getBattleLogInstallStatus(reloaded) }).toMatchObject({
          menu: { upToDate: true }, battle: { upToDate: true },
        });
        expect(isKoMoveEditorAvailable(reloaded)).toBe(true);
        expect(getPokemonKoMoves(reloaded, 6)).toMatchObject([{ moveId: 126, koCount: 1 }]);
        updatePokemonKoMoveField(reloaded, 6, "ko_count_0", "2");
        // Older saved projects lack the new small archive-source cache.
        delete reloaded.koMoveLearnsetSource;
        await installMenuEvolution(reloaded);
        expect(getPokemonKoMoves(reloaded, 6)).toMatchObject([{ moveId: 126, koCount: 2 }]);
        expect(reloaded.fileSystem?.additions?.[KO_MOVE_LEARNSET_PATH]).toBeUndefined();
        const temporary = structuredClone(reloaded);
        await prepareBw2TestBattleCodeInjection(temporary);
        const testRomBytes = await exportModifiedRom(temporary, { preserveOriginalLength: true });
        const testRom = new NintendoDSRom(testRomBytes);
        expect(testRom.filenames.idOf(`patches/MainMenuSkip${version}.dll`)).toBeDefined();
        expect(testRom.fileId(KO_MOVE_LEARNSET_PATH)).toBe(fileId);
        expect(testRom.getFileByName(KO_MOVE_LEARNSET_PATH)).toEqual(reloaded.fileSystem!.replacements[fileId]);
        expect(reloaded.fileSystem?.additions?.[`patches/MainMenuSkip${version}.dll`]).toBeUndefined();
      } finally {
        vi.unstubAllGlobals();
        vi.mocked(loadActiveRomBytes).mockReset();
      }
    }, 30000);
  }
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
