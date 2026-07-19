import { describe, expect, it } from "vitest";
import {
  BLACK2UPGRADE_MARKER_PATH,
  BLACK2UPGRADE_RUNTIME_FILENAMES,
  detectBw2Upgrade,
  getBlack2UpgradeInstallStatus,
  usesExpandedBw2Data,
} from "../pokeweb/black2UpgradeModel";
import { getNarcFormats } from "../pokeweb/formats";
import type { ProjectState } from "../pokeweb/projectStore";

const CLEAN_B2_SHA256 = "2e6b2415354aa41471bc7617068dce059a59931bf5c4348a264f8043f297683a";
const marker = new TextEncoder().encode(JSON.stringify({
  magic: "B2UP",
  schemaVersion: 1,
  baseGameId: "IREO",
  dataVersion: 1,
  runtimeAbi: 1,
  packageChecksum: "a".repeat(64),
}));

describe("black2UpgradeModel", () => {
  it("accepts only the exact clean IREO base for a fresh install", () => {
    const clean = makeProject(CLEAN_B2_SHA256);
    expect(getBlack2UpgradeInstallStatus(clean)).toMatchObject({ state: "clean-ready", canInstall: true });

    const modified = makeProject("0".repeat(64));
    expect(getBlack2UpgradeInstallStatus(modified)).toMatchObject({ state: "incompatible", canInstall: false });
    expect(getBlack2UpgradeInstallStatus(modified).message).toMatch(/MoonBlack2/u);
  });

  it("detects a marked expanded Black 2 project and exposes the shared expanded-data helper", () => {
    const project = makeProject("0".repeat(64));
    project.fileSystem = { replacements: {}, additions: { [BLACK2UPGRADE_MARKER_PATH]: marker } };

    expect(detectBw2Upgrade(project)).toBe("black2-upgrade");
    expect(usesExpandedBw2Data(project)).toBe(true);
    expect(getBlack2UpgradeInstallStatus(project)).toMatchObject({ state: "runtime-update", canInstall: true });
  });

  it("requires all four upgrade DLLs and PMC before reporting installed", () => {
    const project = makeProject("0".repeat(64));
    project.fileSystem = { replacements: {}, additions: { [BLACK2UPGRADE_MARKER_PATH]: marker } };
    project.codeInjection = {
      pmc: { overlayId: 361, overlayPath: "overlay/overlay_0361.bin", symbolPath: "codeinjection/RPMSYM-PMC.rpm", gameId: "B2" },
      modules: BLACK2UPGRADE_RUNTIME_FILENAMES.map((fileName) => ({ path: `patches/${fileName}`, target: "patches", fileName, gameId: "B2" })),
    };

    expect(getBlack2UpgradeInstallStatus(project)).toMatchObject({ state: "installed", canInstall: true });
  });

  it("blocks unmarked partial runtime installs", () => {
    const project = makeProject(CLEAN_B2_SHA256);
    project.codeInjection = {
      modules: [{ path: "patches/Black2Upgrade.dll", target: "patches", fileName: "Black2Upgrade.dll", gameId: "B2" }],
    };
    expect(getBlack2UpgradeInstallStatus(project)).toMatchObject({ state: "incomplete/conflict", canInstall: false });
  });
});

function makeProject(sourceSha256: string): ProjectState {
  return {
    session: { romName: "black2", generation: "gen5", baseVersion: "B2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "POKEMON B2", idCode: "IREO", fileName: "black2.nds", size: 0x20000000, sourceSha256 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats: getNarcFormats("BW2"),
    trpokInfo: [],
  };
}
