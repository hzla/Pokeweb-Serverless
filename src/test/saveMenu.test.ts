import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "../assets/codeinjection/save-menu-compatibility.json";
import { parseRpm } from "../pokeweb/rpm";
import { decodeSaveMenuSettings, encodeSaveMenuSettings, getSaveMenuSettings, getSaveMenuStatus, installSaveMenu } from "../pokeweb/saveMenuModel";
import { removeFollowerAlpha, setFollowerAlphaEnabled } from "../pokeweb/followingPokemonProject";
import { renderCodeInjectionEditor } from "../ui/codeInjectionEditor";
import type { ProjectState } from "../pokeweb/projectStore";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function project(version: "W2" | "B2" | "B" = "W2"): ProjectState {
  const bytes = new Uint8Array(0x200), idCode = { W2: "IRDO", B2: "IREO", B: "IRBO" }[version];
  bytes.set(new TextEncoder().encode(idCode), 12);
  return { originalRomBytes: bytes, session: { romName: "fixture", baseRom: version === "B" ? "BW" : "BW2", baseVersion: version, fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "fixture", idCode, fileName: "fixture.nds", size: bytes.length }, arm9: new Uint8Array(), overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [] };
}
afterEach(() => vi.unstubAllGlobals());
describe("save-menu installer", () => {
  it("defaults a new installation to the v1.0 header label", () => {
    expect(getSaveMenuSettings(project()).versionLabel).toBe("v1.0");
  });
  it("keeps the required follower patch enabled while a save menu is staged", async () => {
    const input = project();
    input.fileSystem = { replacements: {}, additions: { "patches/SaveMenuW2.dll": new Uint8Array([1]) } };
    await expect(setFollowerAlphaEnabled(input, false)).rejects.toThrow("dependent save menu");
    await expect(removeFollowerAlpha(input)).rejects.toThrow("dependent save menu");
  });
  it.each(["localhost", "pokeweb.example"])("shows the installation card on %s", hostname => {
    vi.stubGlobal("window", { location: { hostname } });
    const input = project(), root = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
    expect(getSaveMenuStatus(input).supported).toBe(true);
    expect(getSaveMenuStatus(input).dependencyPresent).toBe(false);
    renderCodeInjectionEditor(input, root as unknown as HTMLElement, () => {});
    expect(root.innerHTML).toContain("Interactive Save Menu");
    expect(root.innerHTML).toContain("Install and enable Following Pokémon");
    expect(root.innerHTML).toContain('id="install-save-menu-btn"');
  });
  it("validates dependencies without changing the project or fetching assets", async () => {
    const input = project(), before = structuredClone(input);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(installSaveMenu(input)).rejects.toThrow("Following Pokémon patch");
    expect(fetch).not.toHaveBeenCalled(); expect(input).toEqual(before);
  });
  it("rejects BW1 on hosted Pokeweb", async () => {
    vi.stubGlobal("window", { location: { hostname: "pokeweb.example" } });
    await expect(installSaveMenu(project("B"))).rejects.toThrow("English Black 2 or White 2");
  });
});
describe("bundled save-menu resource contract", () => {
  it.each(["W2", "B2"] as const)("ships the matching %s module with the sole verified menu hook", version => {
    const info = manifest.modules[version], bytes = readFileSync(new URL(`../assets/codeinjection/${info.fileName}`, import.meta.url));
    expect(hash(bytes)).toBe(info.sha256); expect(info.recognizedSha256).toContain(info.sha256);
    const module = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    expect(module.metadata.PMCGameID).toBe(version); expect(module.metadata.PMCVersion).toBe("0.3.12");
    let nameHash = 0x811c9dc5;
    for (const byte of new TextEncoder().encode("OriginalSaveMenuMain")) nameHash = Math.imul(nameHash ^ byte, 0x01000193) >>> 0;
    const original = module.symbols.find(symbol => symbol.nameHash === nameHash);
    expect(original).toBeDefined();
    expect(new DataView(module.code.buffer, module.code.byteOffset, module.code.byteLength).getUint32(original!.address + 20, true)).toBe(manifest.games[version].stateTable);
    const hooks = module.relocations.filter(r => r.target.module !== "base");
    expect(hooks).toHaveLength(1); expect(hooks[0].target).toEqual({ module: "162", address: manifest.games[version].hook, type: "FULL_COPY" });
    expect(module.symbols[hooks[0].sourceSymbolIndex].size).toBe(16);
    expect(info.expandedSize).toBeLessThan(65536);
  });
  it("ships the matching compressed map", () => {
    const map = readFileSync(new URL("../assets/codeinjection/save-menu-map.lz", import.meta.url));
    expect(map.length).toBe(manifest.map.bytes); expect(hash(map)).toBe(manifest.map.sha256);
    expect([...map.subarray(0, 4)]).toEqual([0x10, 0, 168, 0]);
  });
  it("encodes a selectable stream and shared sprite cadence as a bounded ROM asset", () => {
    const settings = { music: "stream" as const, streamId: 7, bpm: 128, stepsPerBeat: 4 as const };
    expect(decodeSaveMenuSettings(encodeSaveMenuSettings(settings))).toEqual(settings);
    const labeled = { ...settings, versionLabel: "v1.3-beta" };
    const labeledBytes = encodeSaveMenuSettings(labeled);
    expect(labeledBytes).toHaveLength(48);
    expect(decodeSaveMenuSettings(labeledBytes)).toEqual(labeled);
    const legacyBytes = encodeSaveMenuSettings(settings).subarray(0, 16).slice();
    new DataView(legacyBytes.buffer).setUint16(4, 1, true);
    expect(decodeSaveMenuSettings(legacyBytes)).toEqual(settings);
    expect(decodeSaveMenuSettings(encodeSaveMenuSettings({ music: "relic-song", bpm: 150, stepsPerBeat: 2 }))).toEqual({ music: "relic-song", bpm: 150, stepsPerBeat: 2 });
    const off = { music: "off" as const, bpm: 153, stepsPerBeat: 2 as const };
    expect(decodeSaveMenuSettings(encodeSaveMenuSettings(off))).toEqual(off);
    expect(new DataView(encodeSaveMenuSettings(off).buffer).getUint16(6, true)).toBe(2);
    expect(() => encodeSaveMenuSettings({ ...settings, bpm: 0 })).toThrow(/tempo/u);
    expect(() => encodeSaveMenuSettings({ ...settings, versionLabel: "A".repeat(31) })).toThrow(/version label/u);
    expect(() => encodeSaveMenuSettings({ ...settings, versionLabel: "v1.3/unsafe" })).toThrow(/version label/u);
    labeledBytes[20] = 0xff;
    expect(() => decodeSaveMenuSettings(labeledBytes)).toThrow(/version label/u);
  });
});
