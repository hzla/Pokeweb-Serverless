import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NintendoDSRom } from "../nds/rom";
import { NARC } from "../nds/narc";
import { writeU32 } from "../nds/binary";
import contract from "../../runtime/following-pokemon/contract.json";
import { loadActiveRomBytes } from "../pokeweb/persistence";
import type { ProjectState } from "../pokeweb/projectStore";
import { encodeFollowerDialogueNarc } from "../pokeweb/followingPokemonDialogues";
import { encodeFollowerItemNarc } from "../pokeweb/followingPokemonItems";
import {
  checkFollowerCompatibility, followerProfile, followerRom, followerRuntimeVersion,
  readFollowerAlphaInstall, readFollowerDialogueRules, readFollowerItemRules, readFollowingFile,
  writeFollowerDialogueRules, writeFollowerItemRules,
  FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_ITEM_NARC_PATH, FOLLOWER_RESOURCE_PATH,
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

describe("Following Pokémon ROM memory", () => {
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

  it("keeps the clean-stock fingerprint requirement and does not hash adjacent backing bytes", async () => {
    const { source, project } = fixture(false);
    const backing = new Uint8Array(source.length + 64).fill(0x5a);
    backing.set(source, 32);
    project.originalRomBytes = backing.subarray(32, 32 + source.length);
    const digest = vi.spyOn(crypto.subtle, "digest");
    const rom = await followerRom(project);
    expect(rom.sourceSha256).toBe(createHash("sha256").update(source).digest("hex"));
    const report = await checkFollowerCompatibility(project, rom);
    expect(report.compatible).toBe(false);
    expect(report.message).toContain("pinned clean White 2 baseline");
    expect(digest).toHaveBeenCalledTimes(1);
  });

  it("validates modified staged data even when reusing a detached source", async () => {
    const { project } = fixture();
    const rom = await followerRom(project);
    project.fileSystem = { replacements: { [rom.filenames.idOf(FOLLOWER_DIALOGUE_NARC_PATH)!]: Uint8Array.of(0, 0, 0, 0) } };
    await expect(readFollowerDialogueRules(project, rom)).rejects.toThrow();
    expect(loadActiveRomBytes).toHaveBeenCalledTimes(1);
  });
});
