import { describe, expect, it, vi } from "vitest";
import type { ProjectState } from "../pokeweb/projectStore";
import { renderPatchesEditor } from "../ui/patchesEditor";

vi.mock("../pokeweb/romPatchModel", () => ({
  detectDustCloudGemPatch: () => "unknown",
  detectDustCloudItemPatch: () => "unknown",
  detectForgettableHmPatch: () => "unsupported",
  detectMoveExpansionPatch: () => "unknown",
  detectFairyTypePatch: () => "unsupported",
  detectSpecifyTrainerNaturesPatch: () => "unsupported",
}));
vi.mock("../pokeweb/gen4ItemStandardizationModel", () => ({
  detectPlatinumItemStandardization: () => "unsupported",
}));
vi.mock("../pokeweb/cascadeWhitePersonalModel", () => ({
  getCascadePersonalMigrationStatus: () => ({ visible: false }),
}));

describe("Move Expansion panel credits", () => {
  it.each(["BW", "BW2"])("shows all animation credits and counts before installing on %s", (baseRom) => {
    const project = { session: { baseRom, baseVersion: "W2", fairy: true }, patches: { applied: {} } } as ProjectState;
    const root = { innerHTML: "", querySelector: () => null } as unknown as HTMLElement;

    renderPatchesEditor(project, root);

    expect(root.innerHTML).toContain("Move animation credits: Blaze Black/Volt White 2 Redux (11); Cascade White (17); Log(n) (157); Hzla (100).");
    expect(root.innerHTML).toContain("Include Gen 6-9 Animations");
  });
});
