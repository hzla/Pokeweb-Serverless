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
  it.each(["localhost", "127.0.0.1", "::1", "[::1]"])("shows the installation card on %s", hostname => {
    vi.stubGlobal("window", { location: { hostname } });
    const input = project(), root = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
    expect(getSaveMenuStatus(input).supported).toBe(true);
    expect(getSaveMenuStatus(input).dependencyPresent).toBe(false);
    renderCodeInjectionEditor(input, root as unknown as HTMLElement, () => {});
    expect(root.innerHTML).toContain("Black 2 / White 2 Save Menu");
    expect(root.innerHTML).toContain("Install and enable Following Pokémon");
    expect(root.innerHTML).toContain('id="install-save-menu-btn"');
    expect(root.innerHTML).toContain('id="save-menu-song"');
    expect(root.innerHTML).toContain('<option value="off"');
    expect(root.innerHTML).toContain('id="save-menu-bpm"');
    expect(root.innerHTML).toContain('id="save-menu-steps-per-beat"');
    expect(root.innerHTML).toContain('id="save-menu-version-label"');
    expect(root.innerHTML).toContain('value="v1.0"');
    expect(root.innerHTML).toContain('href="#followingPokemon" data-route="followingPokemon">Install Following Pokémon</a>');
  });
  it.each(["pokeweb.example", "localhost.example", "192.168.1.2", "0.0.0.0"])("shows the card and validates ROM compatibility on %s", async hostname => {
    vi.stubGlobal("window", { location: { hostname } });
    const input = project(), before = structuredClone(input), root = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    renderCodeInjectionEditor(input, root as unknown as HTMLElement, () => {});
    expect(getSaveMenuStatus(input).supported).toBe(true);
    expect(root.innerHTML).toContain('id="install-save-menu-btn"');
    // The tiny fixture lacks native code. Reaching this check proves the
    // handler accepts the host while preserving compatibility and rollback.
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
  it("ships an authenticated independent map and follower-style recall timing", () => {
    const map = readFileSync(new URL("../assets/codeinjection/save-menu-map.lz", import.meta.url));
    expect(map.length).toBe(manifest.map.bytes); expect(hash(map)).toBe(manifest.map.sha256);
    expect([...map.subarray(0, 4)]).toEqual([0x10, 0, 168, 0]);
    expect(manifest.recall.scale).toEqual([4096, 4096, 4096, 3440, 2784, 2112, 1456, 768]);
    expect(manifest.recall.totalFrames).toBe(8); expect(manifest.recall.ballFrames).toBe(0); expect(manifest.jump.totalFrames).toBe(42);
    expect(manifest.fly.raisePoses).toEqual([1,2,3]); expect(manifest.fly.reversePoses).toEqual([2,1,0]);
    expect(manifest.recall.staggerFrames).toBe(2); expect(manifest.recall.direction).toBe("right-to-left");
    expect(manifest.jump.playerPose).toBe(1); expect(manifest.jump.sound).toBe(1374);
    expect(manifest.partyHop.buttons).toEqual({ L: "slots 1–3", R: "slots 4–6", Y: "slots 1, 3, 5", X: "slots 2, 4, 6" });
    expect(manifest.partyHop.motionHeights).toEqual([0,5,8,9,9,9,8,5,0]);
    expect(manifest.partyHop.playerArt).toMatchObject({ maleMember: 212, femaleMember: 221, frame: 1, leftMirrored: true });
    expect(manifest.partyHop.sound).toBe(false); expect(manifest.partyHop.walkCadenceUnchanged).toBe(true);
    expect(manifest.partySpin).toEqual({ modifier: "Select", groups: { L: "slots 1–3", R: "slots 4–6", Y: "slots 1, 3, 5", X: "slots 2, 4, 6" },
      directions: ["down", "left", "up", "right"], framesPerDirection: 3,
      footPhase: "shared walking cadence", registryPath: "following/runtime-registry.bin", artPath: "a/0/4/8",
      defaultDirection: "down", requiresFollowerPatch: true });
    expect(manifest.automaticCgearYes).toBe(true);
    expect(manifest.music).toEqual({ sequence: 0x0446, ticksPerBeat: 48, ticksPerSpriteStep: 24, restartAtEnd: true, configPath: "ui/save-menu/settings.bin", streamedAudio: true });
    expect(manifest.transition).toEqual({ framesPerLogicalFrame: 2, actualZoomFrames: 80, actualJumpFrames: 84 });
    expect(manifest.games.W2.soundSequence.sha256).toBe(manifest.games.B2.soundSequence.sha256);
    expect(manifest.style.background.archive).toBe("a/0/7/5");
    expect(manifest.style.selectorGlow.periodFrames).toBe(64);
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
