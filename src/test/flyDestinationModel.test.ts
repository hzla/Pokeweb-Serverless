import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { configureFlyDestinationRuntime, getFlyDestinations, getFlyDestinationStatus,
  readFlyDestinationRuntime, validateFlyDestinationEdit } from "../pokeweb/flyDestinationModel";
import { createProjectDocument } from "../pokeweb/projectDocument";
import { openProjectSession } from "../pokeweb/projectSession";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import { makeEditProject } from "./fixtures/editProject";

function fixture(version: "B2" | "W2" = "W2") {
  const project = makeEditProject();
  project.session.baseVersion = version; project.romInfo.idCode = version === "W2" ? "IRDO" : "IREO";
  const bytes = new Uint8Array(85 * 54), view = new DataView(bytes.buffer);
  for (let i = 0; i < 85; i++) {
    view.setUint16(i * 54, i, true); view.setUint16(i * 54 + 30, 0xffff, true); view.setUint16(i * 54 + 32, 0xffff, true);
  }
  view.setUint16(40 * 54, 326, true);
  view.setUint16(65 * 54, 490, true); view.setUint16(65 * 54 + 24, 1, true); view.setUint16(65 * 54 + 30, 2470, true);
  project.narcs.town_map = { name: "town_map", sourcePath: "a/0/8/5", fileId: 4, fileCount: 1, rawFiles: [bytes], dirty: new Set(), records: new Map() };
  const headers = new Uint8Array(615 * 48);
  const hv = new DataView(headers.buffer);
  for (let zone = 0; zone < 615; zone++) {
    hv.setInt32(zone * 48 + 36, zone === 490 ? 15 : 430, true);
    hv.setInt32(zone * 48 + 44, zone === 490 ? 77 : 491, true);
  }
  project.narcs.headers = { name: "headers", sourcePath: "a/0/1/2", fileId: 5, fileCount: 1, rawFiles: [headers], dirty: new Set(), records: new Map() };
  return project;
}

describe("BW2 Fly destinations", () => {
  it.each(["B2", "W2"] as const)("keeps stock Route 4 eligibility distinct from Join Avenue in %s", version => {
    const project = fixture(version), entries = getFlyDestinations(project);
    expect(entries[40]).toMatchObject({ zone: 326, enabled: false, visitFlag: 65535, suggestedVisitFlag: 2501, landing: { x: 430, y: 0, z: 491 } });
    expect(entries[65]).toMatchObject({ zone: 490, landingZone: 326, enabled: true, visitFlag: 2470, landing: { x: 430, y: 0, z: 491 } });
    project.flyDestinations = { overrides: { 326: { x: 432, y: 2, z: 490 }, 490: { x: 430, y: 0, z: 491 } } };
    expect(getFlyDestinations(project)[40].landing).toEqual({ x: 432, y: 2, z: 490 });
    expect(getFlyDestinations(project)[65].landing).toEqual({ x: 430, y: 0, z: 491 });
    expect(new DataView(project.narcs.headers!.rawFiles[0].buffer).getInt32(551 * 48 + 36, true)).toBe(430);
  });

  it("preserves enabled/disabled bytes and independent coordinates across a project save", () => {
    const project = fixture();
    const view = new DataView(project.narcs.town_map!.rawFiles[0].buffer);
    view.setUint16(40 * 54 + 24, 1, true); view.setUint16(40 * 54 + 30, 2501, true);
    view.setUint16(65 * 54 + 24, 0, true); project.narcs.town_map!.dirty.add(0);
    project.flyDestinations = { overrides: { 326: { x: 433, y: 0, z: 485 }, 490: { x: 430, y: 0, z: 491 } } };
    const reopened = openProjectSession(structuredClone(createProjectDocument(project, false)));
    expect(getFlyDestinations(reopened)[40]).toMatchObject({ enabled: true, visitFlag: 2501, landing: { x: 433, y: 0, z: 485 } });
    expect(getFlyDestinations(reopened)[65]).toMatchObject({ enabled: false, visitFlag: 2470, landing: { x: 430, y: 0, z: 491 } });
  });

  it("requires an unlock flag and bounds grid and rail positions", () => {
    const destination = getFlyDestinations(fixture())[40];
    expect(() => validateFlyDestinationEdit(destination, { ...destination.landing, enabled: true, visitFlag: 65535 })).toThrow("needs a visit flag");
    expect(() => validateFlyDestinationEdit(destination, { x: 32768, y: 0, z: 0, enabled: true, visitFlag: 2501 })).toThrow("X must");
    expect(() => validateFlyDestinationEdit(destination, { ...destination.landing, enabled: true, visitFlag: 0 })).toThrow("1–3059");
    expect(() => validateFlyDestinationEdit({ ...destination, coordinateKind: "rail" }, { x: 65535, y: 65535, z: -32768, enabled: true, visitFlag: 2501 })).not.toThrow();
    expect(() => validateFlyDestinationEdit(destination, { ...destination.landing, enabled: false, visitFlag: 65535 })).not.toThrow();
  });

  it.each(["B2", "W2"] as const)("configures and reloads the actual %s runtime without changing its hooks", version => {
    const bytes = new Uint8Array(readFileSync(new URL(`../assets/codeinjection/FlyDestinations${version}.dll`, import.meta.url)));
    const state = { overrides: { 326: { x: 432, y: -1, z: 490 }, 490: { x: 430, y: 0, z: 491 }, 28: { x: 3, y: 7, z: -2 } } };
    const configured = configureFlyDestinationRuntime(bytes, version, state);
    const runtime = parseRpm(configured, { allowedMagics: ["DLXF"] });
    expect(runtime.metadata.PMCVersion).toBe("1.0.1");
    expect(runtime.relocations.filter(r => r.target.module !== "base").map(r => [r.target.module, r.target.type]).sort()).toEqual([
      ["144", "FULL_COPY"], ["33", "THUMB_BRANCH_LINK"],
    ]);
    expect(readFlyDestinationRuntime(configured, version)).toEqual(state);
    expect(parseRpm(configured, { allowedMagics: ["DLXF"] }).relocations).toEqual(parseRpm(bytes, { allowedMagics: ["DLXF"] }).relocations);
    const altered = parseRpm(configured, { allowedMagics: ["DLXF"] });
    altered.relocations.find(r => r.target.module === "33")!.target.address += 2;
    expect(() => readFlyDestinationRuntime(writeRpm(altered, { ident: "DLXF" }), version)).toThrow("hook contract");
    expect(() => configureFlyDestinationRuntime(bytes, version, { overrides: { 326: { x: 32768, y: 0, z: 0 } } })).toThrow("invalid landing coordinate");
    expect(() => configureFlyDestinationRuntime(bytes, version, { overrides: { 615: { x: 1, y: 0, z: 1 } } })).toThrow("invalid area ID");
  });

  it.each(["B2", "W2"] as const)("keeps existing %s landing settings readable for the update that preserves map visuals", version => {
    const legacy = new Uint8Array(readFileSync(new URL(`./fixtures/fly-destinations-v1.0.0/${version}.dll`, import.meta.url)));
    const state = { overrides: { 326: { x: 433, y: 0, z: 489 }, 490: { x: 430, y: 0, z: 491 } } };
    const configured = configureFlyDestinationRuntime(legacy, version, state);
    expect(readFlyDestinationRuntime(configured, version)).toEqual(state);
    const current = new Uint8Array(readFileSync(new URL(`../assets/codeinjection/FlyDestinations${version}.dll`, import.meta.url)));
    expect(readFlyDestinationRuntime(configureFlyDestinationRuntime(current, version, readFlyDestinationRuntime(configured, version)), version)).toEqual(state);
  });

  it("blocks unsupported game families and malformed Town Map counts", () => {
    const project = fixture(); project.session.baseRom = "BW";
    expect(getFlyDestinationStatus(project).supported).toBe(false);
    project.narcs.town_map!.rawFiles[0] = new Uint8Array(86 * 54);
    expect(() => getFlyDestinations(project)).toThrow("85 area records");
  });
});
