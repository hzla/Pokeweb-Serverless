import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NintendoDSRom } from "../nds/rom";
import { NARC } from "../nds/narc";
import { writeU32 } from "../nds/binary";
import contract from "../../runtime/following-pokemon/contract.json";
import bw2PmcContract from "../../runtime/following-pokemon/bw2-pmc-contract.json";
import { loadActiveRomBytes } from "../pokeweb/persistence";
import type { ProjectState } from "../pokeweb/projectStore";
import { encodeFollowerDialogueNarc } from "../pokeweb/followingPokemonDialogues";
import { encodeFollowerItemNarc } from "../pokeweb/followingPokemonItems";
import {
  checkFollowerCompatibility, followerProfile, followerRom, followerRuntimeVersion,
  readFollowerAlphaInstall, readFollowerDialogueRules, readFollowerItemRules, readFollowingFile,
  writeFollowerDialogueRules, writeFollowerItemRules,
  FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_ITEM_NARC_PATH, FOLLOWER_RESOURCE_PATH,
  FOLLOWER_DESCRIPTOR_PATH, type FollowerRom,
} from "../pokeweb/followingPokemonProject";

vi.mock("../pokeweb/persistence", async importOriginal => ({
  ...await importOriginal<typeof import("../pokeweb/persistence")>(),
  loadActiveRomBytes: vi.fn(),
}));

afterEach(() => { vi.restoreAllMocks(); vi.mocked(loadActiveRomBytes).mockReset(); });

function fixture(upgrade = true) {
  const header = new Uint8Array(0x4000);
  header.set(new TextEncoder().encode("IRDO"), 12);
  const rom = new NintendoDSRom(header);
  rom.arm9 = new Uint8Array(64);
  const segment = Number([...contract.hooks, ...contract.nativeAdapters].find(site => site.segment !== "ARM9")!.segment);
  rom.arm9OverlayTable = new Uint8Array(32);
  writeU32(rom.arm9OverlayTable, 0, segment);
  writeU32(rom.arm9OverlayTable, 4, 0x02000000);
  writeU32(rom.arm9OverlayTable, 8, 64);
  writeU32(rom.arm9OverlayTable, 24, 1);
  const personal = new NARC(); personal.files = Array.from({ length: 1024 }, () => new Uint8Array(76));
  const resources = new NARC(); resources.files = [Uint8Array.of(1, 2, 3)];
  const source = rom.save({ addedFiles: [
    { path: "unrelated-large.bin", bytes: new Uint8Array(1024 * 1024) },
    { path: "overlay/needed.bin", bytes: new Uint8Array(64) },
    { path: "a/0/1/6", bytes: personal.save() },
    { path: FOLLOWER_RESOURCE_PATH, bytes: resources.save() },
    { path: FOLLOWER_DIALOGUE_NARC_PATH, bytes: encodeFollowerDialogueNarc([{ zone: 42, text: "Hello" }]) },
    { path: FOLLOWER_ITEM_NARC_PATH, bytes: encodeFollowerItemNarc([]) },
    ...(upgrade ? [{ path: "patches/White2Upgrade.dll", bytes: Uint8Array.of(1, 2, 3) }] : []),
  ] });
  const project = {
    session: { baseVersion: "W2", baseRom: "BW2", romName: "test", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { idCode: "IRDO", fileName: "test.nds", size: source.length },
    arm9: new Uint8Array(64), overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
  } as unknown as ProjectState;
  vi.mocked(loadActiveRomBytes).mockImplementation(async () => source.slice());
  return { source, project };
}

function compatibleStockFixture(): { project: ProjectState; rom: FollowerRom } {
  const base = 0x02004000;
  const arm9 = new Uint8Array(0x90000), overlays: Record<number, Uint8Array> = {};
  const sites = [...contract.hooks, ...contract.nativeAdapters];
  const overlayBases = new Map<number, number>();
  for (const site of sites) if (site.segment !== "ARM9") {
    const id = Number(site.segment);
    overlayBases.set(id, Math.min(overlayBases.get(id) ?? site.address, site.address) & ~0xfff);
  }
  for (const [id, address] of overlayBases) {
    const end = Math.max(...sites.filter(site => Number(site.segment) === id).map(site => site.address + site.expectedHex.length / 2));
    overlays[id] = new Uint8Array(end - address);
  }
  const writeSite = (site: { segment?: string; address: number; expectedHex: string }) => {
    const data = site.segment && site.segment !== "ARM9" ? overlays[Number(site.segment)] : arm9;
    const at = site.address - (site.segment && site.segment !== "ARM9" ? overlayBases.get(Number(site.segment))! : base);
    data.set(Uint8Array.from(site.expectedHex.match(/../g)!, byte => Number.parseInt(byte, 16)), at);
  };
  for (const site of sites) writeSite(site);
  for (const site of [...bw2PmcContract.profiles.IRDO.hooks, ...bw2PmcContract.profiles.IRDO.imports]) writeSite(site);
  const descriptor = new NARC(); descriptor.files = [new Uint8Array(4 + 1008 * 28)];
  writeU32(descriptor.files[0], 0, 1008);
  const resources = new NARC(); resources.files = Array.from({ length: 975 }, () => new Uint8Array());
  resources.files[0] = new Uint8Array(readFileSync(new URL("../assets/following/template-32-8.btx", import.meta.url)));
  const personal = new NARC(); personal.files = Array.from({ length: 710 }, () => new Uint8Array(76));
  const appearances = new NARC(); appearances.files = [new Uint8Array(620 * 8)];
  appearances.files[0][0] = 1; // The stock fallback appearance for every synthetic species.
  const paths = [FOLLOWER_DESCRIPTOR_PATH, FOLLOWER_RESOURCE_PATH, "a/0/1/6", "a/2/0/8"];
  const files = [descriptor.save(), resources.save(), personal.save(), appearances.save()];
  const table = new Uint8Array(overlayBases.size * 32);
  [...overlayBases].forEach(([id, address], index) => {
    writeU32(table, index * 32, id); writeU32(table, index * 32 + 4, address);
    writeU32(table, index * 32 + 8, overlays[id].length); writeU32(table, index * 32 + 24, paths.length + index);
    files.push(overlays[id]);
  });
  const project = { session: {baseRom: "BW2", baseVersion: "W2"}, arm9, overlays, narcs: {}, fileSystem: { additions: {}, replacements: {} } } as unknown as ProjectState;
  const rom = { idCode: "IRDO", revision: 0, arm9RamAddress: base, arm9OverlayTable: table, files,
    filenames: { idOf: (path: string) => paths.indexOf(path) < 0 ? undefined : paths.indexOf(path) } } as unknown as FollowerRom;
  return { project, rom };
}

describe("Following Pokémon ROM memory", () => {
  it("accepts an uninstalled modified stock ROM when audited sites and archives match", async () => {
    const { project, rom } = compatibleStockFixture();
    expect((await checkFollowerCompatibility(project, rom)).compatible).toBe(true);
    const hook = contract.hooks.find(site => site.segment === "ARM9")!;
    project.arm9[hook.address - rom.arm9RamAddress] ^= 1;
    const report = await checkFollowerCompatibility(project, rom);
    expect(report.compatible).toBe(false);
    expect(report.checks.find(check => check.name === hook.id)?.passed).toBe(false);
  });
  it("shares one stored ROM read across page checks, rules, and rule saves", async () => {
    const { project } = fixture();
    const digest = vi.spyOn(crypto.subtle, "digest");
    const rom = await followerRom(project);
    expect(await followerProfile(project, rom)).toBe("white2upgrade");
    await followerRuntimeVersion(project, rom);
    // The fixture's fake upgrade module must still fail compatibility.
    expect((await checkFollowerCompatibility(project, rom)).compatible).toBe(false);
    expect(await readFollowerAlphaInstall(project, rom)).toBeUndefined();
    expect(await readFollowerDialogueRules(project, rom)).toEqual([{ zone: 42, text: "Hello" }]);
    expect(await readFollowerItemRules(project, rom)).toEqual([]);
    await writeFollowerDialogueRules(project, [{ zone: 1, text: "Changed" }], rom);
    await writeFollowerItemRules(project, [{ slot: 0, itemId: 1, quantity: 1, itemName: "Potion", zone: 1, text: "Gift" }], rom);
    expect(await readFollowerDialogueRules(project, rom)).toEqual([{ zone: 1, text: "Changed" }]);
    expect((await readFollowerItemRules(project, rom))[0].itemId).toBe(1);
    expect(loadActiveRomBytes).toHaveBeenCalledTimes(1);
    expect(digest.mock.calls.every(([, bytes]) => bytes.byteLength < 1024 * 1024)).toBe(true);
  });

  it("detaches required files and excludes unrelated payloads from the page context", async () => {
    const { source, project } = fixture();
    project.originalRomBytes = source;
    const rom = await followerRom(project);
    expect(loadActiveRomBytes).not.toHaveBeenCalled();
    expect(rom.files[rom.filenames.idOf("unrelated-large.bin")!].length).toBe(0);
    expect(rom.files[1].length).toBe(64); // Required hook overlay.
    expect(readFollowingFile(project, rom, FOLLOWER_RESOURCE_PATH)!.length).toBeGreaterThan(0);
    for (const bytes of [...rom.files, rom.arm9OverlayTable]) {
      expect(bytes.buffer).not.toBe(source.buffer);
      expect(bytes.buffer.byteLength).toBe(bytes.byteLength);
    }
    expect("data" in rom).toBe(false);
    expect(rom.files.reduce((sum, bytes) => sum + bytes.length, 0)).toBeLessThan(source.length / 4);
  });

  it("does not hash an edited stock ROM before checking its binary sites", async () => {
    const { source, project } = fixture(false);
    const backing = new Uint8Array(source.length + 64).fill(0x5a);
    backing.set(source, 32);
    project.originalRomBytes = backing.subarray(32, 32 + source.length);
    const digest = vi.spyOn(crypto.subtle, "digest");
    const rom = await followerRom(project);
    const report = await checkFollowerCompatibility(project, rom);
    expect(report.compatible).toBe(false);
    expect(report.checks.some(check => check.name === "object-code-lookup" && !check.passed)).toBe(true);
    expect(report.message).toContain("binary site");
    expect(digest).not.toHaveBeenCalled();
  });

  it("validates modified staged data even when reusing a detached source", async () => {
    const { project } = fixture();
    const rom = await followerRom(project);
    project.fileSystem = { replacements: { [rom.filenames.idOf(FOLLOWER_DIALOGUE_NARC_PATH)!]: Uint8Array.of(0, 0, 0, 0) } };
    await expect(readFollowerDialogueRules(project, rom)).rejects.toThrow();
    expect(loadActiveRomBytes).toHaveBeenCalledTimes(1);
  });
});
