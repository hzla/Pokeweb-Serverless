import { listCodeInjectionDlls } from "../pokeweb/pmcModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { describe, expect, it, vi } from "vitest";

const romConstructionSpy = vi.hoisted(() => ({ count: 0 }));

vi.mock("../nds/rom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../nds/rom")>();
  return {
    ...actual,
    NintendoDSRom: class extends actual.NintendoDSRom {
      constructor(data: Uint8Array | ArrayBuffer) {
        romConstructionSpy.count += 1;
        super(data);
      }
    },
  };
});

describe("code-injection DLL discovery cache", () => {
  it("parses unchanged source ROM bytes only once while preserving staged modules", () => {
    const project = {
      originalRomBytes: new Uint8Array(0x200),
      codeInjection: {},
      fileSystem: {},
    } as ProjectState;
    const initialConstructionCount = romConstructionSpy.count;

    expect(listCodeInjectionDlls(project)).toEqual([]);
    expect(listCodeInjectionDlls(project)).toEqual([]);
    expect(romConstructionSpy.count - initialConstructionCount).toBe(1);

    project.codeInjection = {
      modules: [{ path: "patches/Staged.dll", target: "patches", fileName: "Staged.dll" }],
    };
    expect(listCodeInjectionDlls(project).map((module) => module.path)).toEqual(["patches/Staged.dll"]);
    expect(romConstructionSpy.count - initialConstructionCount).toBe(1);

    project.originalRomBytes = new Uint8Array(0x200);
    expect(listCodeInjectionDlls(project).map((module) => module.path)).toEqual(["patches/Staged.dll"]);
    expect(romConstructionSpy.count - initialConstructionCount).toBe(2);
  });
});
