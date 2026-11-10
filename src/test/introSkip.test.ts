import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeU32 } from "../nds/binary";
import { Folder, addFilePath } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import manifest from "../assets/codeinjection/introSkipManifest.json";
import { getIntroSkipStatus, installIntroSkip, isIntroSkipModule, uninstallIntroSkip, type IntroSkipVersion } from "../pokeweb/introSkipModel";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "../pokeweb/pmcModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm, writeRpm } from "../pokeweb/rpm";

afterEach(() => vi.unstubAllGlobals());
const assets = () => vi.stubGlobal("fetch", vi.fn(async (url: URL) => new Response(new Uint8Array(readFileSync(url)))));
const asset = (name: string) => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${name}`, import.meta.url)));
const GAMES = ["B2", "W2"] as const;

/** Synthetic Black 2 / White 2 ROM with the retail bytes at every overlay 35 call site. */
async function fixture(game: IntroSkipVersion, override: Record<string, string> = {}, idCode?: string): Promise<ProjectState> {
  const profile = manifest.games[game];
  const rom = new NintendoDSRom(new Uint8Array(0x200));
  rom.data.set(new TextEncoder().encode(idCode ?? profile.idCode), 12);
  rom.arm9RamAddress = 0x02004000; writeU32(rom.data, 0x28, 0x02004000);
  rom.arm9 = new Uint8Array(0x1000); rom.arm7 = new Uint8Array(4);
  const overlayCount = 344;
  rom.files = Array.from({ length: overlayCount + 3 }, () => new Uint8Array(4));
  rom.arm9OverlayTable = new Uint8Array(overlayCount * 32); rom.filenames = new Folder();
  for (let id = 0; id < overlayCount; ++id) { writeU32(rom.arm9OverlayTable, id * 32, id); writeU32(rom.arm9OverlayTable, id * 32 + 24, id); }
  const hooks = Object.entries(profile.hooks);
  const addresses = hooks.map(([, hook]) => Number.parseInt(hook.address, 16));
  const base = Math.min(...addresses) & ~0xff;
  const data = new Uint8Array(Math.max(...addresses) - base + 0x20);
  for (const [name, hook] of hooks) data.set(Buffer.from(override[name] ?? hook.bytes, "hex"), Number.parseInt(hook.address, 16) - base);
  rom.files[manifest.overlay] = data;
  writeU32(rom.arm9OverlayTable, manifest.overlay * 32 + 4, base); writeU32(rom.arm9OverlayTable, manifest.overlay * 32 + 8, data.length);
  const headers = new NARC(); headers.files = [new Uint8Array(48)];
  for (const [index, path, bytes] of [[0, "a/0/0/2", new NARC().save()], [1, "a/0/0/3", new NARC().save()], [2, "a/0/1/2", headers.save()]] as const) {
    rom.files[overlayCount + index] = bytes; rom.filenames = addFilePath(rom.filenames, path, overlayCount + index);
  }
  const project = await loadProjectFromRomBytes(rom.save({ filenames: rom.filenames }), "fixture.nds", { selectedNarcs: [] });
  project.codeInjection = { pmc: { overlayId: 344, overlayBaseAddress: 0x021fd1c0, overlayPath: "overlay/overlay_0344.bin", symbolPath: "codeinjection/RPMSYM-PMC.rpm", gameId: game } };
  return project;
}

describe.each(GAMES)("Skip Intro on %s", game => {
  it("bundles a module matching its manifest", async () => {
    const dll = asset(manifest.games[game].fileName);
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(dll))).toString("hex");
    expect(hash).toBe(manifest.games[game].sha256);
    const rpm = parseRpm(dll, { allowedMagics: ["DLXF"] });
    expect(isIntroSkipModule(rpm, game)).toBe(true);
    expect(isIntroSkipModule(rpm, game === "B2" ? "W2" : "B2")).toBe(false);
    expect(rpm.relocations.filter(r => r.target.module !== "base")).toHaveLength(5);
  });

  it("stages the DLL, then removes it", async () => {
    const project = await fixture(game); assets();
    expect(getIntroSkipStatus(project)).toMatchObject({ supported: true, installed: false, compatible: true });
    await installIntroSkip(project);
    expect(project.fileSystem!.additions![`patches/IntroSkip${game}.dll`]).toEqual(asset(`IntroSkip${game}.dll`));
    expect(getIntroSkipStatus(project)).toMatchObject({ installed: true, compatible: true, updateAvailable: false, canUninstall: true });
    await uninstallIntroSkip(project);
    expect(listCodeInjectionDlls(project).some(entry => /IntroSkip/u.test(entry.fileName))).toBe(false);
    expect(getIntroSkipStatus(project)).toMatchObject({ installed: false, compatible: true });
  });

  it("refuses changed new-game code", async () => {
    const project = await fixture(game, { spawn: "00bf00bf" }); assets();
    expect(getIntroSkipStatus(project)).toMatchObject({ compatible: false, message: expect.stringMatching(/new-game spawn call/u) });
    await expect(installIntroSkip(project)).rejects.toThrow(/new-game spawn call/u);
    expect(listCodeInjectionDlls(project)).toEqual([]);
  });

  it("refuses a DLL that already hooks one of the call sites", async () => {
    const project = await fixture(game); assets();
    const other = parseRpm(asset(`IntroSkip${game}.dll`), { allowedMagics: ["DLXF"] });
    stageCodeInjectionDll(project, "Other.dll", writeRpm({ ...other, metadata: { ...other.metadata, PMCVersion: "other" } }, { ident: "DLXF" }), "patches", project.originalRomBytes);
    expect(getIntroSkipStatus(project).message).toMatch(/Other\.dll already patches the new-game code/u);
  });
});

it("is not offered outside US Black 2 / White 2", async () => {
  const project = await fixture("W2", {}, "IRDJ");
  expect(getIntroSkipStatus(project)).toMatchObject({ supported: true, compatible: false, message: expect.stringMatching(/IRDJ/u) });
  project.session.baseVersion = "W";
  expect(getIntroSkipStatus(project)).toMatchObject({ supported: false, message: "Skip Intro supports US Black 2 and White 2." });
});
