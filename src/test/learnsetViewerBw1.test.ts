import { deepStrictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../assets/codeinjection/learnsetViewerManifest.json";
import { writeU32 } from "../nds/binary";
import { Folder } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { getLearnsetViewerStatus, installLearnsetViewer, learnsetViewerPaths, uninstallLearnsetViewer } from "../pokeweb/learnsetViewerModel";
import * as pmc from "../pokeweb/pmcModel";
import { createNarcStore, type ProjectState } from "../pokeweb/projectStore";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import { encodeGen5TextBank } from "../pokeweb/text";
import { commitTextBank, getTextBank } from "../pokeweb/textModel";

const asset = (name: string) => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${name}`, import.meta.url)));
const shippedAcceptance = { B: manifest.games.B.dsAccepted, W: manifest.games.W.dsAccepted };
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  manifest.games.B.dsAccepted = shippedAcceptance.B; manifest.games.W.dsAccepted = shippedAcceptance.W;
});
function stubAssets() {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => new Response(asset(url.pathname.split("/").pop()!).slice())));
}
for (const game of ["B", "W"] as const) describe(`BW1 Learnset ${game}`, () => {
  beforeEach(() => { manifest.games.B.dsAccepted = manifest.games.W.dsAccepted = true; stubAssets(); });
  it("requires both retail acceptance flags and US revision 0", () => {
    const p = fixture(game); manifest.games.W.dsAccepted = false;
    expect(getLearnsetViewerStatus(p)).toMatchObject({ supported: false, compatible: false });
    manifest.games.W.dsAccepted = true; expect(getLearnsetViewerStatus(p).compatible).toBe(true);
    p.originalRomBytes![0x1e] = 1; expect(getLearnsetViewerStatus(p).supported).toBe(false);
  });
  it("installs both companions with only PMC, repairs partial installs, and reuses private text", async () => {
    const p = fixture(game), original = getTextBank(p, "message_texts", 204).slice();
    const ids = await installLearnsetViewer(p);
    expect(getLearnsetViewerStatus(p)).toMatchObject({ installed: true, compatible: true, updateAvailable: false, canUninstall: true });
    expect(p.codeInjection!.learnsetViewer).toMatchObject({ menuBankId: 157, viewerBankId: 204, runtimeVersion: manifest.games[game].version });
    expect(p.codeInjection!.pmc!.overlayId).toBe(237);
    const count = getTextBank(p, "message_texts", 204).length;
    expect(getTextBank(p, "message_texts", 204).slice(0, original.length)).toEqual(original);
    getTextBank(p, "message_texts", 204)[ids.error][1] = "Private edited message"; commitTextBank(p, "message_texts", 204);
    expect(await installLearnsetViewer(p)).toEqual(ids);
    expect(getTextBank(p, "message_texts", 204)).toHaveLength(count);
    expect(getTextBank(p, "message_texts", 204)[ids.error][1]).toBe("Private edited message");
    pmc.removeStagedCodeInjectionDll(p, learnsetViewerPaths(game)[1]);
    expect(getLearnsetViewerStatus(p).partial).toBe(true);
    expect(await installLearnsetViewer(p)).toEqual(ids);
    uninstallLearnsetViewer(p);
    expect(getLearnsetViewerStatus(p)).toMatchObject({ installed: false, pmcInstalled: true });
    expect(await installLearnsetViewer(p)).toEqual(ids);
  });
  it("retains IDs/private text on export and updates the existing FAT entries", async () => {
    const p = fixture(game), ids = await installLearnsetViewer(p);
    const info = p.codeInjection!.learnsetViewer!.infoMessageIds![0];
    getTextBank(p, "message_texts", 204)[info][1] = "Private title {0}"; commitTextBank(p, "message_texts", 204);
    const bytes = await exportModifiedRom(p), reopened = fixture(game, bytes), rom = new NintendoDSRom(bytes);
    expect(getLearnsetViewerStatus(reopened)).toMatchObject({ installed: true, compatible: true, canUninstall: false, updateAvailable: false, messageIds: ids });
    await installLearnsetViewer(reopened);
    for (const path of learnsetViewerPaths(game)) expect(reopened.fileSystem!.replacements[rom.fileId(path)]).toBeDefined();
    expect(getTextBank(reopened, "message_texts", 204)[info][1]).toBe("Private title {0}");
  });
  it("rejects altered native APIs, hooks, resources, duplicates and conflicting DLLs", async () => {
    const p = fixture(game); const api = manifest.games[game].apis.find(a => a.segment === "ARM9")!;
    p.arm9[(api.entry & ~1) - 0x02004000] ^= 1;
    expect(getLearnsetViewerStatus(p).message).toContain("native");
    const resource = fixture(game), rom = new NintendoDSRom(resource.originalRomBytes!);
    resource.fileSystem = { replacements: { [rom.fileId("a/1/2/4")]: new NARC().save() }, additions: {} };
    const before = structuredClone(resource); await expect(installLearnsetViewer(resource)).rejects.toThrow("Unsupported tutor graphics");
    // Node compares typed arrays by bytes rather than enumerating the full ROM.
    deepStrictEqual(structuredClone(resource), before);
    const installed = fixture(game); await installLearnsetViewer(installed);
    const path = learnsetViewerPaths(game)[1];
    installed.codeInjection!.modules!.push({ ...installed.codeInjection!.modules![1] });
    expect(getLearnsetViewerStatus(installed).message).toContain("Duplicate"); installed.codeInjection!.modules!.pop();
    pmc.stageCodeInjectionDll(installed, "OtherTutorPatch.dll", asset(`LearnsetViewer${game}.dll`), "patches", installed.originalRomBytes!);
    expect(getLearnsetViewerStatus(installed).message).toContain("conflicts");
  });
  it("checks instructions and relocation sources in configured companions", async () => {
    const p = fixture(game); await installLearnsetViewer(p);
    const path = learnsetViewerPaths(game)[1], rpm = parseRpm(p.fileSystem!.additions![path], { allowedMagics: ["DLXF"] });
    rpm.code[0] ^= 1; p.fileSystem!.additions![path] = writeRpm(rpm, { ident: "DLXF" });
    expect(getLearnsetViewerStatus(p)).toMatchObject({ installed: true, compatible: false });
  });
  it("rolls back PMC, private text and the first companion if the second cannot stage", async () => {
    const p = fixture(game), before = structuredClone(p), original = pmc.stageCodeInjectionDll;
    vi.spyOn(pmc, "stageCodeInjectionDll").mockImplementationOnce(original).mockImplementationOnce(() => { throw new Error("Second companion failed"); });
    await expect(installLearnsetViewer(p)).rejects.toThrow("Second companion failed"); deepStrictEqual(structuredClone(p), before);
  });
});

function fixture(game: "B" | "W", input?: Uint8Array): ProjectState {
  const profile = manifest.games[game];
  let bytes = input;
  if (!bytes) {
    const rom = new NintendoDSRom(new Uint8Array(0x200)); rom.data.set(new TextEncoder().encode(profile.idCode), 12);
    rom.arm9RamAddress = 0x02004000; writeU32(rom.data, 0x28, rom.arm9RamAddress); rom.arm9 = new Uint8Array(0x90000); rom.arm7 = new Uint8Array(4);
    rom.arm9OverlayTable = new Uint8Array(237 * 32); rom.files = Array.from({ length: 241 }, () => new Uint8Array(4));
    for (let id = 0; id < 237; ++id) { writeU32(rom.arm9OverlayTable, id * 32, id); writeU32(rom.arm9OverlayTable, id * 32 + 24, id); }
    for (const id of [10, 91, 173]) {
      const base = profile.segments[String(id) as "10"].address;
      const signatures = [...profile.hooks.filter(h => h.overlayId === id).map(h => ({ address: h.address, expectedHex: h.expectedHex })),
        ...profile.apis.filter(a => a.segment === id).map(a => ({ address: a.entry & ~1, expectedHex: a.expectedHex }))];
      const end = Math.max(...signatures.map(s => s.address + s.expectedHex.length / 2)); rom.files[id] = new Uint8Array(end - base + 16);
      writeU32(rom.arm9OverlayTable, id * 32 + 4, base); writeU32(rom.arm9OverlayTable, id * 32 + 8, rom.files[id].length);
      for (const s of signatures) rom.files[id].set(Buffer.from(s.expectedHex, "hex"), s.address - base);
    }
    for (const s of profile.apis.filter(a => a.segment === "ARM9")) rom.arm9.set(Buffer.from(s.expectedHex, "hex"), (s.entry & ~1) - rom.arm9RamAddress);
    const delta = game === "B" ? -0x18 : 0;
    for (const [address, hex] of [[0x0200512a, "00f097f9"], [0x02034b94 + delta, "b81101eb"], [0x02034a68 + delta, "181201eb"], [0x02078ec0 + delta, "ed000000"]] as const)
      rom.arm9.set(Buffer.from(hex, "hex"), address - rom.arm9RamAddress);
    rom.arm9[0x02078d8f + delta - rom.arm9RamAddress] = 0x0a;
    for (const [id, path] of [[237, "a/1/2/4"], [238, "a/0/8/3"], [239, "a/0/0/7"]] as const)
      rom.files[id] = new Uint8Array(readFileSync(new URL(`./fixtures/learnset-viewer/bw1-${path.replaceAll("/", "-")}.narc`, import.meta.url)));
    const messages = new NARC(); messages.files = Array.from({ length: 205 }, () => encodeGen5TextBank([["0_0", "Native message", 0]])); rom.files[240] = messages.save();
    const folder0 = new Folder({ folders: [["0", new Folder({ files: ["7"], firstId: 239 })], ["8", new Folder({ files: ["3"], firstId: 238 })]] });
    rom.filenames = new Folder({ files: ["texts.bin"], firstId: 240, folders: [["a", new Folder({ folders: [["0", folder0], ["1", new Folder({ folders: [["2", new Folder({ files: ["4"], firstId: 237 })]] })]] })]] });
    bytes = rom.save({ filenames: rom.filenames });
  }
  const rom = new NintendoDSRom(bytes), textId = rom.filenames.idOf("texts.bin")!;
  return { originalRomBytes: bytes, session: { romName: "fixture", baseVersion: game, baseRom: "BW", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "fixture", idCode: profile.idCode, fileName: "fixture.nds", size: bytes.length }, arm9: rom.arm9,
    overlays: {}, narcs: { message_texts: createNarcStore("message_texts", "texts.bin", textId, new NARC(rom.files[textId])) },
    texts: { banks: {} }, formats: {}, trpokInfo: [], codeInjection: pmc.detectPmcInstallFromRom(rom) } as ProjectState;
}
