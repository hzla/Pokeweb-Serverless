import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash, webcrypto } from "node:crypto";
import { serialize } from "node:v8";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../assets/codeinjection/menuEvolutionBw1Manifest.json";
import { NintendoDSRom } from "../nds/rom";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { exportModifiedRom } from "../pokeweb/exportRom";
import * as battleLog from "../pokeweb/battleLogModel";
import * as pmc from "../pokeweb/pmcModel";
import { detectMenuEvolutionCompatibility, getMenuEvolutionInstallStatus, installMenuEvolution, uninstallMenuEvolution } from "../pokeweb/menuEvolutionModel";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import { commitTextBank, getTextBank } from "../pokeweb/textModel";
import { appendPokemonKoMove, getPokemonKoMoves, updatePokemonKoMoveField } from "../pokeweb/koMoveLearnsetModel";
import type { ProjectState } from "../pokeweb/projectStore";

const shipped = { B: manifest.games.B.dsAccepted, W: manifest.games.W.dsAccepted };
const asset = (name: string) => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${name}`, import.meta.url)));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); manifest.games.B.dsAccepted = shipped.B; manifest.games.W.dsAccepted = shipped.W; });
const paths = { B: process.env.MENU_EVOLUTION_B_ROM ? pathToFileURL(resolve(process.env.MENU_EVOLUTION_B_ROM)) : new URL("../../../cleanblack.nds", import.meta.url),
  W: pathToFileURL(resolve(process.env.MENU_EVOLUTION_W_ROM ?? `${homedir()}/Downloads/cleanroms/cleanwhite.nds`)) };
const snapshot = (p: ProjectState) => createHash("sha256").update(serialize({ arm9: p.arm9, arm9Dirty: p.arm9Dirty,
  overlays: p.overlays, narcs: p.narcs, texts: p.texts, fileSystem: p.fileSystem, codeInjection: p.codeInjection,
  patches: p.patches, actionChangelog: p.actionChangelog, koSource: p.koMoveLearnsetSource })).digest("hex");

for (const game of ["B", "W"] as const) describe.runIf(existsSync(paths[game]))(`BW1 Enhanced Party Menu ${game}`, () => {
  beforeEach(() => {
    manifest.games.B.dsAccepted = manifest.games.W.dsAccepted = true;
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("fetch", vi.fn(async (url: URL | string) => new Response(asset(new URL(String(url), "https://pokeweb.invalid").pathname.split("/").pop()!).slice())));
  });
  const fixture = async (input?: Uint8Array) => {
    const p = await loadProjectFromRomBytes(input ?? new Uint8Array(readFileSync(paths[game])), "fixture.nds", { selectedNarcs: ["message_texts", "learnsets", "evolutions"] });
    if (!input) {
      await battleLog.installBattleLog(p);
    }
    return p;
  };
  it("keeps both release gates and revision checks, rejects missing/outdated dependencies", async () => {
    const p = await fixture(); manifest.games.W.dsAccepted = false;
    expect(detectMenuEvolutionCompatibility(p).supported).toBe(false);
    await expect(installMenuEvolution(p)).rejects.toThrow("acceptance");
    manifest.games.W.dsAccepted = true; expect(detectMenuEvolutionCompatibility(p).compatible).toBe(true);
    p.originalRomBytes![0x1e] = 1; expect(detectMenuEvolutionCompatibility(p).supported).toBe(false); p.originalRomBytes![0x1e] = 0;
    vi.spyOn(battleLog, "getBattleLogInstallStatus").mockReturnValue({ upToDate: true, bundledRuntimeVersion: 7 } as ReturnType<typeof battleLog.getBattleLogInstallStatus>);
    await expect(installMenuEvolution(p)).rejects.toThrow("runtime version 8");
    vi.restoreAllMocks();
    p.codeInjection!.modules = []; p.fileSystem!.additions = {}; await expect(installMenuEvolution(p)).rejects.toThrow("Install the battle log first");
  });
  it("preserves private text, KO edits, configured IDs, and FAT entries across updates and reopen", async () => {
    const p = await fixture(), result = await installMenuEvolution(p);
    expect(result.messageBankId).toBe(157); expect(p.codeInjection!.pmc!.overlayId).toBe(237);
    const bank = getTextBank(p, "message_texts", 157), count = bank.length;
    bank[result.messageEntryId][1] = "Private EVOLVE"; bank[result.relearnMessageEntryId][1] = "Private RELEARN"; commitTextBank(p, "message_texts", 157);
    expect(await installMenuEvolution(p)).toEqual(result); expect(getTextBank(p, "message_texts", 157)).toHaveLength(count);
    expect(getMenuEvolutionInstallStatus(p)).toMatchObject({ installed: true, upToDate: true, compatible: true });
    appendPokemonKoMove(p, 25); updatePokemonKoMoveField(p, 25, "move_id_0", "85"); updatePokemonKoMoveField(p, 25, "ko_count_0", "31");
    const bytes = await exportModifiedRom(p), reopened = await fixture(bytes), rom = new NintendoDSRom(bytes);
    expect(getMenuEvolutionInstallStatus(reopened)).toMatchObject({ installed: true, upToDate: true, compatible: true, canUninstall: false,
      messageEntryId: result.messageEntryId, relearnMessageEntryId: result.relearnMessageEntryId });
    const installed = await installMenuEvolution(reopened); expect(installed.messageEntryId).toBe(result.messageEntryId);
    expect(installed.relearnMessageEntryId).toBe(result.relearnMessageEntryId);
    expect(getTextBank(reopened, "message_texts", 157)[result.messageEntryId][1]).toBe("Private EVOLVE");
    expect(getPokemonKoMoves(reopened, 25)).toMatchObject([{ moveId: 85, koCount: 31 }]);
    expect(reopened.fileSystem!.replacements[rom.fileId(result.dllPath)]).toBeDefined();
    uninstallMenuEvolution(p); expect(getMenuEvolutionInstallStatus(p).installed).toBe(false);
    expect((await installMenuEvolution(p)).messageEntryId).toBe(result.messageEntryId);
  }, 30000);
  it("rejects altered bindings, DLL instructions, relocation sources, duplicate and conflicting hooks", async () => {
    const p = await fixture(), api = manifest.games[game].api.find(a => a.segment === "ARM9")!;
    p.arm9[(api.entry & ~1) - 0x02004000] ^= 1;
    expect(detectMenuEvolutionCompatibility(p).compatible).toBe(false); p.arm9[(api.entry & ~1) - 0x02004000] ^= 1;
    const result = await installMenuEvolution(p), original = p.fileSystem!.additions![result.dllPath];
    const rpm = parseRpm(original, { allowedMagics: ["DLXF"] }); rpm.code[0] ^= 1;
    p.fileSystem!.additions![result.dllPath] = writeRpm(rpm, { ident: "DLXF" });
    expect(getMenuEvolutionInstallStatus(p)).toMatchObject({ compatible: false, upToDate: false });
    p.fileSystem!.additions![result.dllPath] = original;
    p.codeInjection!.modules!.push({ ...p.codeInjection!.modules!.find(m => m.path === result.dllPath)! });
    expect(detectMenuEvolutionCompatibility(p).compatible).toBe(false); p.codeInjection!.modules!.pop();
    pmc.stageCodeInjectionDll(p, "ConflictingMenu.dll", original, "patches", p.originalRomBytes!);
    expect(detectMenuEvolutionCompatibility(p).checks.some(c => c.label === "Conflicting companion" && !c.matched)).toBe(true);
  }, 30000);
  it("installs the runtime-8 dependency from a clean ROM and rolls back late staging failures", async () => {
    const p = await loadProjectFromRomBytes(new Uint8Array(readFileSync(paths[game])), "fixture.nds", { selectedNarcs: ["message_texts", "learnsets", "evolutions"] });
    const before = snapshot(p);
    vi.spyOn(pmc, "stageCodeInjectionDll").mockImplementation(() => { throw new Error("Dependency staging rejected"); });
    await expect(battleLog.installBattleLog(p)).rejects.toThrow("Dependency staging rejected");
    expect(snapshot(p)).toBe(before);
    vi.restoreAllMocks(); await battleLog.installBattleLog(p);
    expect(battleLog.getBattleLogInstallStatus(p)).toMatchObject({ installed: true, upToDate: true, runtimeVersion: 8 });
    await installMenuEvolution(p);
    expect(battleLog.canUninstallBattleLog(p)).toBe(false);
    expect(() => battleLog.uninstallBattleLog(p)).toThrow("Uninstall Enhanced Party Menu");
  }, 30000);
  it("rejects foreign and partially overlapping KO-learning hooks without changing the project", async () => {
    const p = await fixture();
    expect(battleLog.detectBattleLogCompatibility(p).compatible).toBe(true);
    const counter = asset(`${game === "B" ? "Black1" : "White1"}BattleCounters.dll`);
    const rpm = parseRpm(counter, { allowedMagics: ["DLXF"] });
    const learning = rpm.relocations.find(r => r.target.module === "93" && r.target.type === "THUMB_BRANCH_LINK")!;
    learning.target.address += 2; // Claim the suffix of a retail BL instruction.
    pmc.stageCodeInjectionDll(p, "ConflictingCounters.dll", writeRpm(rpm, { ident: "DLXF" }), "patches", p.originalRomBytes!);
    expect(battleLog.detectBattleLogCompatibility(p).checks.some(c => !c.matched && c.label === "Zero-EXP KO learning")).toBe(true);
    const before = snapshot(p);
    await expect(battleLog.installBattleLog(p)).rejects.toThrow("compatibility failed");
    expect(snapshot(p)).toBe(before);
    p.fileSystem!.additions!["patches/ConflictingCounters.dll"] = counter;
    expect(battleLog.detectBattleLogCompatibility(p).checks.some(c => !c.matched && c.label === "Native KO move learning")).toBe(true);
  }, 30000);
  it("rolls back PMC, text, KO source and all staged files on failure", async () => {
    const p = await fixture(), before = snapshot(p);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 500 })));
    await expect(installMenuEvolution(p)).rejects.toThrow("Could not load"); expect(snapshot(p)).toBe(before);
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => new Response(asset(url.pathname.split("/").pop()!).slice())));
    vi.spyOn(pmc, "stageCodeInjectionDll").mockImplementation(() => { throw new Error("Staging rejected"); });
    await expect(installMenuEvolution(p)).rejects.toThrow("Staging rejected"); expect(snapshot(p)).toBe(before);
  }, 30000);
  it.runIf(Boolean(process.env.BW1_MENU_VALIDATION_OUTPUT))("exports a normal-installer runtime-8 gameplay candidate", async () => {
    const p = await fixture();
    await battleLog.installBattleLog(p); await installMenuEvolution(p);
    expect(battleLog.getBattleLogInstallStatus(p)).toMatchObject({ upToDate: true, bundledRuntimeVersion: 8 });
    // These changes belong only to the exported fixture: Haxorus has a
    // level-one Fraxure target, and Latios learns Flamethrower at its next KO.
    const evolution = new Uint8Array(42); evolution.set([4, 0, 1, 0, 0x63, 2]);
    p.narcs.evolutions!.rawFiles[612] = evolution; p.narcs.evolutions!.dirty.add(612);
    if (process.env.BW1_MENU_VALIDATION_KO_EVOLUTION === "1") {
      const koEvolution = new Uint8Array(42); koEvolution.set([29, 0, 1, 0, 0x7c, 1]);
      p.narcs.evolutions!.rawFiles[381] = koEvolution; p.narcs.evolutions!.dirty.add(381);
    }
    appendPokemonKoMove(p, 381); updatePokemonKoMoveField(p, 381, "move_id_0", "53"); updatePokemonKoMoveField(p, 381, "ko_count_0", "1");
    const tag = process.env.BW1_MENU_VALIDATION_TAG ?? "v1";
    if (!/^[a-z0-9-]+$/u.test(tag)) throw new Error("Invalid validation version tag.");
    const output = resolve(process.env.BW1_MENU_VALIDATION_OUTPUT!, `${game === "B" ? "Black1" : "White1"}-UI-Port-EnhancedParty-${tag}-20261008.nds`);
    writeFileSync(output, await exportModifiedRom(p), { flag: "wx" });
  }, 30000);
});
