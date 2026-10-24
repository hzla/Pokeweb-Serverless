import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readU32, writeU32 } from "../nds/binary";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import {
  createTrainerFieldTable, emptyTrainerFieldConditions, readTrainerFieldTable, writeTrainerFieldTable,
  getTrainerFieldConditionsStatus, isTrainerFieldConditionsModule,
  TRAINER_GLOBAL_CONDITIONS, TRAINER_SIDE_CONDITIONS, TRAINER_FIELD_CONDITIONS_PATH,
} from "../pokeweb/trainerFieldConditionsModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { renderTrainerFieldSettings, renderTrainerFieldInstaller } from "../ui/trainerFieldConditions";
import white2 from "../assets/codeinjection/trainerFieldConditionsManifest.json";
import black2 from "../assets/codeinjection/trainerFieldConditionsB2Manifest.json";
const profiles = { W2: white2, B2: black2 };
const manifest = white2;

const defaults = emptyTrainerFieldConditions();
const authored = { weather: 5, fields: 0xf6, player: 0x393f, opponent: 0x393f,
  playerSpikes: 3, playerToxicSpikes: 2, opponentSpikes: 1, opponentToxicSpikes: 1 };
const bundles = {
  W2: new Uint8Array(readFileSync(new URL("../assets/codeinjection/TrainerFieldConditionsW2.dll", import.meta.url))),
  B2: new Uint8Array(readFileSync(new URL("../assets/codeinjection/TrainerFieldConditionsB2.dll", import.meta.url))),
};
const bundled = bundles.W2;

describe("trainer field configuration", () => {
  it("defaults every trainer to native battle behavior", () => {
    const table = createTrainerFieldTable(1000);
    for (const id of [0, 1, 999, 1000]) expect(readTrainerFieldTable(table, id)).toEqual(defaults);
  });
  it("round-trips all supported conditions, side layers, and the largest trainer ID", () => {
    const before = createTrainerFieldTable(3), saved = before.slice();
    const table = writeTrainerFieldTable(before, 65535, authored);
    expect(readU32(table, 8)).toBe(65536);
    expect(readTrainerFieldTable(table, 65535)).toEqual(authored);
    expect(readTrainerFieldTable(table, 0)).toEqual(defaults);
    expect(before).toEqual(saved);
    expect(readTrainerFieldTable(writeTrainerFieldTable(table, 65535, defaults), 65535)).toEqual(defaults);
  });
  it("preserves other trainers when editing one record or growing the table", () => {
    let table = writeTrainerFieldTable(createTrainerFieldTable(3), 2, authored);
    table = writeTrainerFieldTable(table, 15, { ...defaults, weather: 1 });
    expect(readTrainerFieldTable(table, 2)).toEqual(authored);
    expect(readTrainerFieldTable(table, 15).weather).toBe(1);
    expect(readTrainerFieldTable(table, 14)).toEqual(defaults);
  });
  it("rejects unsupported effects, transient guards, invalid layers and IDs", () => {
    const table = createTrainerFieldTable(3);
    for (const values of [{ weather: 6 }, { fields: 1 }, { fields: 8 }, { player: 1 << 9 },
      { opponent: 1 << 10 }, { playerSpikes: 4 }, { opponentToxicSpikes: 3 }, { weather: NaN }, { fields: -1 }])
      expect(() => writeTrainerFieldTable(table, 0, { ...defaults, ...values })).toThrow();
    for (const id of [-1, 1.5, 65536]) expect(() => writeTrainerFieldTable(table, id, defaults)).toThrow();
  });
  it("rejects malformed tables without silently overwriting their contents", () => {
    for (const at of [0, 4, 6, 8, 12]) {
      const table = createTrainerFieldTable(3); table[at] ^= 0x10;
      expect(() => readTrainerFieldTable(table, 0)).toThrow();
      expect(() => writeTrainerFieldTable(table, 0, defaults)).toThrow();
    }
    const bytes = createTrainerFieldTable(3); bytes[17] = 1;
    expect(() => readTrainerFieldTable(bytes, 0)).toThrow();
    expect(() => readTrainerFieldTable(bytes.subarray(0, bytes.length - 1), 0)).toThrow();
    writeU32(bytes, 8, 0); expect(() => readTrainerFieldTable(bytes, 0)).toThrow();
  });
  it("uses exactly the native field and side effect masks", () => {
    expect(TRAINER_GLOBAL_CONDITIONS.reduce((mask, { id }) => mask | (1 << id), 0)).toBe(0xf6);
    expect(TRAINER_SIDE_CONDITIONS.reduce((mask, { id }) => mask | (1 << id), 0)).toBe(0x393f);
  });
});

describe("bundled runtime and supported profiles", () => {
  for (const game of ["W2", "B2"] as const) {
    it(`${game}: binds gameplay and animation evidence to the shipped DLL`, () => {
      const receipt = JSON.parse(readFileSync(new URL("../../runtime/trainer-field-conditions/verification.json", import.meta.url), "utf8")).profiles[game];
      expect(createHash("sha256").update(bundles[game]).digest("hex")).toBe(receipt.dllSha256);
      expect(receipt.cpu.result).toBe("passed");
      expect(receipt.dsGameplay.afterTenTurns).toEqual(receipt.dsGameplay.initial);
      expect(receipt.dsGameplay.afterBrickBreak.reflect).toBe(0);
      expect(receipt.dsGameplay.afterBrickBreak.lightScreen).toBe(0);
      expect(receipt.dsDrought.initial.weather).toBe(1);
      expect(receipt.dsGameplay.openingMessages.map((m: { id: number }) => m.id)).toEqual([857, 148, 125, 129, 133, 141, 145, 153]);
      expect(receipt.dsAllConditionsOpening.openingMessages).toHaveLength(30);
      expect(receipt.romRoundtrip.updateFrom).toBe("0.1.0");
    });
    it(`${game}: recognizes the exact runtime and its own first-turn hooks`, () => {
      const rpm = parseRpm(bundles[game], { allowedMagics: ["DLXF"] });
      expect(isTrainerFieldConditionsModule(rpm)).toBe(true);
      expect(isTrainerFieldConditionsModule(rpm, game)).toBe(true);
      expect(isTrainerFieldConditionsModule(rpm, game === "W2" ? "B2" : "W2")).toBe(false);
      expect(rpm.bssSize).toBe(0);
      expect(rpm.relocations.filter(r => r.target.module !== "base").map(r => r.target).sort((a, b) => a.address - b.address)).toEqual(
        profiles[game].hooks.map(h => expect.objectContaining({ module: h.module, address: h.address, type: "THUMB_BRANCH_LINK" })),
      );
      rpm.code[0] ^= 1; expect(isTrainerFieldConditionsModule(rpm)).toBe(false);
    });
    it(`${game}: selects the matching ROM profile and rejects the other game's DLL`, () => {
      const profile = profiles[game], foreign = game === "W2" ? "B2" : "W2";
      const project = { session: { baseRom: "BW2", baseVersion: game }, romInfo: { idCode: profile.idCode },
        narcs: {}, overlays: {}, arm9: new Uint8Array() } as unknown as ProjectState;
      expect(getTrainerFieldConditionsStatus(project)).toMatchObject({ supported: true, compatible: false, installed: false });
      project.fileSystem = { replacements: {}, additions: { [`patches/${profiles[foreign].fileName}`]: bundles[foreign] } };
      project.codeInjection = { modules: [{ path: `patches/${profiles[foreign].fileName}`, fileName: profiles[foreign].fileName, target: "patches" }] } as ProjectState["codeInjection"];
      expect(getTrainerFieldConditionsStatus(project)).toMatchObject({ supported: true, compatible: false, installed: false, message: expect.stringContaining("Conflicting") });
    });
    it(`${game}: offers an update for the exact previous runtime and rejects altered copies`, () => {
      const legacy = new Uint8Array(readFileSync(new URL(`./fixtures/trainer-fields-0.1.0/TrainerFieldConditions${game}.dll`, import.meta.url)));
      const path = `patches/${profiles[game].fileName}`;
      const project = { session: { baseRom: "BW2", baseVersion: game }, romInfo: { idCode: profiles[game].idCode },
        narcs: {}, overlays: {}, arm9: new Uint8Array(), fileSystem: { additions: { [path]: legacy }, replacements: {} },
        codeInjection: { modules: [{ path, fileName: profiles[game].fileName, target: "patches" }] } } as unknown as ProjectState;
      expect(getTrainerFieldConditionsStatus(project)).toMatchObject({ installed: true, updateAvailable: true });
      const rpm = parseRpm(legacy, { allowedMagics: ["DLXF"] });
      expect(isTrainerFieldConditionsModule(rpm)).toBe(false);
      rpm.code[0] ^= 1;
      project.fileSystem!.additions![path] = writeRpm(rpm, { ident: "DLXF" });
      expect(getTrainerFieldConditionsStatus(project)).toMatchObject({ installed: false, message: expect.stringContaining("Conflicting") });
    });
  }
  it("keeps BW1, non-US and mismatched games unavailable", () => {
    for (const [baseRom, baseVersion, idCode] of [["BW", "B", "IRBO"], ["BW2", "W2", "IRDI"], ["BW2", "B2", "IREJ"], ["BW2", "B2", "IRDO"], ["BW2", "W2", "IREO"]])
      expect(getTrainerFieldConditionsStatus({ session: { baseRom, baseVersion }, romInfo: { idCode } } as ProjectState).supported).toBe(false);
  });
  it("renders a clear installation state in either entry point", () => {
    const state = { installed: false, compatible: true, supported: true, updateAvailable: false, message: "Ready" };
    expect(renderTrainerFieldInstaller(state, true)).toContain("data-install-trainer-fields");
    expect(renderTrainerFieldInstaller(state, true)).not.toContain("Battle Field Conditions");
    expect(renderTrainerFieldInstaller(state, true)).not.toContain("<p");
    expect(renderTrainerFieldInstaller(state, true)).toContain("inline-status");
    expect(renderTrainerFieldInstaller({ ...state, installed: true })).toContain('disabled>Installed');
    const update = renderTrainerFieldInstaller({ ...state, installed: true, updateAvailable: true });
    expect(update).toContain("Update available");
    expect(update).toContain("Update Field Conditions");
    expect(update).not.toContain('disabled>');
  });
  it("hides extra fields until the exact runtime is installed, then renders separate sides", () => {
    const project = { session: { baseRom: "BW2", baseVersion: "W2" }, romInfo: { idCode: "IRDO" }, narcs: {}, overlays: {}, arm9: new Uint8Array() } as unknown as ProjectState;
    expect(renderTrainerFieldSettings(project, 1)).toBe("");
    // The status still disables edits until a source ROM verifies the native interfaces.
    project.fileSystem = { replacements: {}, additions: {
      [`patches/${manifest.fileName}`]: bundled,
      [TRAINER_FIELD_CONDITIONS_PATH]: writeTrainerFieldTable(createTrainerFieldTable(3), 1, authored),
    } };
    project.codeInjection = { modules: [{ path: `patches/${manifest.fileName}`, fileName: manifest.fileName, target: "patches" }] } as ProjectState["codeInjection"];
    const html = renderTrainerFieldSettings(project, 1);
    expect(html).toContain('data-trainer-field="weather"');
    expect(html).toContain('data-trainer-field="player_0" checked');
    expect(html).toContain('data-trainer-field="opponent_1" checked');
    expect(html).toContain('data-trainer-field="playerSpikes"');
    expect(html).toContain('data-trainer-field="opponentToxicSpikes"');
    expect(html).toContain('value="5" selected>Sandstorm');
    expect(html).not.toContain("<h3>");
    expect(html).not.toContain("Opening weather and move animations");
    expect(html).not.toContain("primary opposing trainer supplies these settings");
  });
});
