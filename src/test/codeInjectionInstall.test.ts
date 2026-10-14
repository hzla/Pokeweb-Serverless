import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installCodeInjectionPatch } from "../pokeweb/codeInjectionInstall";
import * as pmc from "../pokeweb/pmcModel";
import { loadActiveRomBytes } from "../pokeweb/persistence";
import type { ProjectState } from "../pokeweb/projectStore";

vi.mock("../pokeweb/persistence", () => ({ loadActiveRomBytes: vi.fn() }));
vi.mock("../pokeweb/pmcModel", () => ({
  getPmcInstallStatus: vi.fn((p: ProjectState) => ({ supported: true, installed: Boolean(p.codeInjection?.pmc) })),
  adoptExistingPmcInstall: vi.fn(() => false),
  installBundledPmc: vi.fn(),
}));

const runtime = { overlayId: 344, overlayBaseAddress: 0x2300000, overlayPath: "overlay/overlay_0344.bin", symbolPath: "codeinjection/RPMSYM-PMC.rpm" };
function project(): ProjectState {
  return {
    originalRomBytes: new Uint8Array([7]),
    session: { romName: "test", baseRom: "BW2", baseVersion: "W2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "IRDO", fileName: "test.nds", size: 1 },
    arm9: new Uint8Array([1]), overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    fileSystem: { additions: { "keep.bin": new Uint8Array([2]) }, replacements: {} },
  };
}

beforeEach(() => {
  vi.mocked(pmc.getPmcInstallStatus).mockImplementation(p => p.codeInjection?.pmc
    ? { supported: true, installed: true, overlayId: p.codeInjection.pmc.overlayId, message: "fixture" }
    : { supported: true, installed: false, message: "fixture" });
  vi.mocked(pmc.adoptExistingPmcInstall).mockReturnValue(false);
  vi.mocked(pmc.installBundledPmc).mockImplementation(async p => {
    p.arm9[0] = 3;
    p.arm9Dirty = true;
    p.codeInjection = { ...p.codeInjection, pmc: runtime };
    p.fileSystem!.additions![runtime.overlayPath] = new Uint8Array([4]);
    return runtime;
  });
});
afterEach(() => vi.resetAllMocks());

describe("dependency installation transaction", () => {
  it("installs missing PMC before the requested patch and commits both", async () => {
    const p = project(), source = p.originalRomBytes;
    const result = await installCodeInjectionPatch(p, candidate => {
      expect(candidate.codeInjection?.pmc).toEqual(runtime);
      expect(candidate.originalRomBytes).toBe(source);
      candidate.fileSystem!.additions!["patches/requested.dll"] = new Uint8Array([5]);
      return "installed";
    });
    expect(result).toBe("installed");
    expect(pmc.installBundledPmc).toHaveBeenCalledOnce();
    expect(p.arm9[0]).toBe(3);
    expect(p.arm9Dirty).toBe(true);
    expect(p.fileSystem!.additions!["patches/requested.dll"]).toEqual(new Uint8Array([5]));
    expect(p.fileSystem!.additions!["keep.bin"]).toEqual(new Uint8Array([2]));
  });

  it("reuses installed PMC without updating it", async () => {
    const p = project(); p.codeInjection = { pmc: runtime };
    await installCodeInjectionPatch(p, () => {});
    expect(pmc.installBundledPmc).not.toHaveBeenCalled();
    expect(pmc.adoptExistingPmcInstall).not.toHaveBeenCalled();
  });

  it("adopts an existing source-ROM runtime before considering installation", async () => {
    const p = project();
    vi.mocked(pmc.adoptExistingPmcInstall).mockImplementation(candidate => {
      candidate.codeInjection = { pmc: runtime }; return true;
    });
    await installCodeInjectionPatch(p, () => {});
    expect(pmc.installBundledPmc).not.toHaveBeenCalled();
    expect(p.codeInjection?.pmc).toEqual(runtime);
  });

  it.each(["dependency", "requested patch"])("preserves the project when the %s fails", async failure => {
    const p = project(), before = structuredClone(p);
    if (failure === "dependency") vi.mocked(pmc.installBundledPmc).mockRejectedValue(new Error("incompatible dependency"));
    const install = vi.fn((candidate: ProjectState) => {
      candidate.fileSystem!.additions!["keep.bin"][0] = 99;
      candidate.texts.banks.test = ["changed"];
      throw new Error("patch staging failed");
    });
    await expect(installCodeInjectionPatch(p, install)).rejects.toThrow(failure === "dependency" ? "incompatible dependency" : "patch staging failed");
    expect(p).toEqual(before);
    if (failure === "dependency") expect(install).not.toHaveBeenCalled();
  });

  it("recovers the autosaved ROM source", async () => {
    const p = project(); delete p.originalRomBytes;
    vi.mocked(loadActiveRomBytes).mockResolvedValue(new Uint8Array([8]));
    await installCodeInjectionPatch(p, () => {});
    expect(p.originalRomBytes).toEqual(new Uint8Array([8]));
  });

  it("rejects concurrent installs and releases the lock after failure", async () => {
    const p = project();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const first = installCodeInjectionPatch(p, async () => { await waiting; throw new Error("failed"); });
    await expect(installCodeInjectionPatch(p, () => {})).rejects.toThrow("Another patch");
    release();
    await expect(first).rejects.toThrow("failed");
    await expect(installCodeInjectionPatch(p, () => "retry")).resolves.toBe("retry");
  });
});
