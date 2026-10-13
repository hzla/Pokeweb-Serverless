import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "../assets/codeinjection/save-menu-compatibility.json";
import { parseRpm } from "../pokeweb/rpm";
import { getSaveMenuStatus, installSaveMenu } from "../pokeweb/saveMenuModel";
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
  it.each(["localhost", "127.0.0.1", "::1", "[::1]"])("shows the installation card on %s", hostname => {
    vi.stubGlobal("window", { location: { hostname } });
    const input = project(), root = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
    expect(getSaveMenuStatus(input).supported).toBe(true);
    renderCodeInjectionEditor(input, root as unknown as HTMLElement, () => {});
    expect(root.innerHTML).toContain("Black 2 / White 2 Save Menu");
    expect(root.innerHTML).toContain('id="install-save-menu-btn"');
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
    await expect(installSaveMenu(input)).rejects.toThrow("native menu code changed");
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
    expect(module.metadata.PMCGameID).toBe(version); expect(module.metadata.PMCVersion).toBe("0.3.6");
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
    expect(manifest.automaticCgearYes).toBe(true);
    expect(manifest.music).toEqual({ sequence: 0x0446, ticksPerBeat: 48, ticksPerSpriteStep: 24, restartAtEnd: true });
    expect(manifest.games.W2.soundSequence.sha256).toBe(manifest.games.B2.soundSequence.sha256);
    expect(manifest.style.background.archive).toBe("a/0/7/5");
    expect(manifest.style.selectorGlow.periodFrames).toBe(64);
  });
});
