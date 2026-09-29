import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeU32 } from "../nds/binary";
import { Folder } from "../nds/fnt";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { detectPmcInstallFromRom, getPmcInstallStatus, installBundledPmc, listCodeInjectionDlls, stageCodeInjectionDll } from "../pokeweb/pmcModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import { TESTING_PATCHES, getTestingPatchStatus, installTestingPatch, isTestingPatchRuntime, uninstallTestingPatch, type TestingPatchId } from "../pokeweb/testingPatchesModel";

const ids = Object.keys(TESTING_PATCHES) as TestingPatchId[];
const asset = (name: string) => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${name}`, import.meta.url)));
const dll = (id: TestingPatchId) => asset(TESTING_PATCHES[id].fileName);
afterEach(() => vi.unstubAllGlobals());
function stubAssets() {
  vi.stubGlobal("fetch", async (url: URL) => new Response(asset(url.pathname.split("/").pop()!)));
}

describe.each(ids)("White 2 %s", (id) => {
  it("recognizes the bundled binary and rejects tampering", () => {
    const rpm = parseRpm(dll(id), { allowedMagics: ["DLXF"] });
    expect(isTestingPatchRuntime(rpm, id)).toBe(true);
    rpm.code[0] ^= 1;
    expect(isTestingPatchRuntime(rpm, id)).toBe(false);
  });
  it("installs, detects renamed copies, removes staged copies and refuses duplicates", async () => {
    const p = project(); stubAssets();
    expect(getTestingPatchStatus(p, id)).toMatchObject({ supported: true, compatible: true, installed: false });
    const installed = await installTestingPatch(p, id);
    expect(getTestingPatchStatus(p, id)).toMatchObject({ installed: true, compatible: true, canUninstall: true });
    expect((await installTestingPatch(p, id)).path).toBe(installed.path);
    expect(listCodeInjectionDlls(p)).toHaveLength(1);
    uninstallTestingPatch(p, id);
    stageCodeInjectionDll(p, "renamed.dll", dll(id));
    expect((await installTestingPatch(p, id)).path).toBe("patches/renamed.dll");
    stageCodeInjectionDll(p, "duplicate.dll", dll(id));
    await expect(installTestingPatch(p, id)).rejects.toThrow(/duplicate/u);
  });
  it("rejects altered native code, raw replacements and competing hooks before mutation", async () => {
    const p = project(); const rom = new NintendoDSRom(p.originalRomBytes!);
    const sig = TESTING_PATCHES[id].signatures[0];
    if (sig.module === "ARM9") {
      p.arm9![sig.address - rom.arm9RamAddress] ^= 1;
    } else {
      const ov = rom.loadArm9Overlays([Number(sig.module)]).get(Number(sig.module))!;
      const data = ov.data.slice(); data[sig.address - ov.ramAddress] ^= 1;
      p.fileSystem = { replacements: { [ov.fileId]: data } };
    }
    await expect(installTestingPatch(p, id)).rejects.toThrow(/Native code differs/u);
    expect(getPmcInstallStatus(p).installed).toBe(false);
    const clean = project(); stubAssets(); await installBundledPmc(clean);
    const rpm = parseRpm(dll(id), { allowedMagics: ["DLXF"] }); rpm.code[0] ^= 1;
    stageCodeInjectionDll(clean, "competing.dll", writeRpm(rpm, { ident: "DLXF" }));
    await expect(installTestingPatch(clean, id)).rejects.toThrow(/Conflicting/u);
  });
  it("does not install into BW1, Black 2, another region or ROM revision", () => {
    for (const [version, family, code, revision] of [["B2", "BW2", "IREO", 0], ["W", "BW", "IRAO", 0], ["W2", "BW2", "IRDI", 0], ["W2", "BW2", "IRDO", 1]] as const) {
      const p = project(); p.session.baseVersion = version; p.session.baseRom = family;
      p.originalRomBytes!.set(new TextEncoder().encode(code), 12); p.originalRomBytes![0x1e] = revision;
      expect(getTestingPatchStatus(p, id).supported).toBe(false);
    }
  });
});

it("exports all three independent modules together and recognizes them on reimport", async () => {
  const p = project(); stubAssets();
  for (const id of ids) await installTestingPatch(p, id);
  const out = await exportModifiedRom(p); const exported = new NintendoDSRom(out);
  const loaded = project(out);
  for (const id of ids) {
    expect(exported.getFileByName(`patches/${TESTING_PATCHES[id].fileName}`)).toEqual(dll(id));
    expect(getTestingPatchStatus(loaded, id)).toMatchObject({ compatible: true, installed: true, canUninstall: false });
    expect(() => uninstallTestingPatch(loaded, id)).toThrow(/staged/u);
  }
  const original = new NintendoDSRom(p.originalRomBytes!);
  for (const ov of [36, 167, 169]) expect(exported.loadArm9Overlays([ov]).get(ov)!.data).toEqual(original.loadArm9Overlays([ov]).get(ov)!.data);
});

function project(bytes = fixture()): ProjectState {
  const rom = new NintendoDSRom(bytes);
  return { originalRomBytes: bytes,
    session: { romName: "fixture", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "fixture", idCode: rom.idCode, fileName: "fixture.nds", size: bytes.length },
    arm9: rom.arm9, overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [], codeInjection: detectPmcInstallFromRom(rom) };
}
function fixture(): Uint8Array {
  const rom = new NintendoDSRom(new Uint8Array(0x200));
  rom.data.set(new TextEncoder().encode("IRDO"), 12);
  rom.arm9 = new Uint8Array(0x90000); rom.arm9RamAddress = 0x02004000;
  writeU32(rom.data, 0x28, rom.arm9RamAddress);
  rom.arm7 = new Uint8Array(4); rom.arm9OverlayTable = new Uint8Array(344 * 32);
  rom.files = Array.from({ length: 345 }, () => new Uint8Array(4));
  rom.filenames = new Folder({ files: ["base.bin"], firstId: 344 });
  for (let id = 0; id < 344; id++) {
    writeU32(rom.arm9OverlayTable, id * 32, id); writeU32(rom.arm9OverlayTable, id * 32 + 24, id);
  }
  const bases: Record<string, number> = { "36": 0x0217f640, "167": 0x02199900, "169": 0x06898020 };
  for (const [id, base] of Object.entries(bases)) {
    rom.files[Number(id)] = new Uint8Array(0x60000);
    writeU32(rom.arm9OverlayTable, Number(id) * 32 + 4, base);
    writeU32(rom.arm9OverlayTable, Number(id) * 32 + 8, 0x60000);
  }
  for (const patch of Object.values(TESTING_PATCHES)) for (const sig of patch.signatures) {
    const data = sig.module === "ARM9" ? rom.arm9 : rom.files[Number(sig.module)];
    const base = sig.module === "ARM9" ? rom.arm9RamAddress : bases[sig.module];
    data.set(Buffer.from(sig.hex, "hex"), sig.address - base);
  }
  return rom.save();
}
