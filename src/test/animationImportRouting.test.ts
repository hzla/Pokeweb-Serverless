import { afterEach, describe, expect, it, vi } from "vitest";
import * as pwan from "../pokeweb/pwanAnimationModel";
import { compilePwanAnimationFrames } from "../pokeweb/pwanCompiler";
import type { ProjectState } from "../pokeweb/projectStore";
import { installPwanImportFormEvents, renderPwanImportPanel } from "../ui/pwanAnimationEditor";

const preview = vi.hoisted(() => ({ value: undefined as any }));
vi.mock("../ui/pwanGifImportPreview", () => ({
  installPwanGifImportPreview: () => ({ ready: () => preview.value }),
  renderPwanGifImportPreview: () => "<div>GIF comparison</div>",
}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("shared GIF import routing", () => {
  it.each(["pwan", "w2anim"] as const)("applies a reviewed GIF to the selected form in a %s project", async (backend) => {
    const project = { session: { baseVersion: "W2", baseRom: "BW2" }, narcs: {}, texts: { banks: {} },
      ...(backend === "w2anim" ? { w2animAnimations: { sourceBytes: new Uint8Array() } } : {}),
    } as unknown as ProjectState;
    const compiled = compilePwanAnimationFrames([{ index: 0, width: 1, height: 1, delayMs: 100,
      pixels: Uint8ClampedArray.of(128, 240, 64, 255) }], { colorPreset: "gen5" });
    preview.value = { source: { fileName: "fixture.gif", bytes: Uint8Array.of(1) }, result: compiled };
    const resolve = vi.spyOn(pwan, "resolvePwanSpeciesTarget").mockReturnValue({ requestedSpeciesId: 6, speciesId: 6, formIndex: 3, assetIndex: 840 });
    const apply = vi.spyOn(pwan, "upsertPwanOverride").mockImplementation(() => {});
    const lookup = vi.spyOn(pwan, "findPwanOverrideForSpecies").mockReturnValue(undefined);
    renderPwanImportPanel(project, { defaultSpeciesId: 6, defaultFormIndex: 3, showSpeciesField: false, showImportStatus: true });
    expect(lookup).toHaveBeenCalledWith(project, 6, 3);
    let click: (() => Promise<void>) | undefined;
    const message = { textContent: "", classList: { toggle: vi.fn() } };
    const button = { disabled: false, textContent: "", addEventListener: (_type: string, callback: () => Promise<void>) => { click = callback; } };
    const fields = { "#pwan-save-override": button, "#pwan-form-status": message,
      "#pwan-species-id": { value: "6" }, "#pwan-palette-source": { value: "front" } };
    const root = { querySelector: (selector: string) => fields[selector as keyof typeof fields] } as unknown as HTMLElement;
    const refresh = vi.fn();
    vi.stubGlobal("window", { alert: vi.fn() });
    installPwanImportFormEvents(project, root, { defaultFormIndex: 3, onRefresh: refresh });
    await click!();
    expect(resolve).toHaveBeenCalledWith(project, 6, 3);
    expect(apply).toHaveBeenCalledWith(project, expect.objectContaining({ speciesId: 6, formIndex: 3, assetIndex: 840,
      front: expect.objectContaining({ pwanBytes: compiled.pwanBytes, paletteBgr555: compiled.paletteBgr555 }) }));
    expect(message.textContent).toContain(backend === "w2anim" ? "w2anim assets" : "PWAN assets");
    expect(refresh).toHaveBeenCalledOnce();
    expect(window.alert).not.toHaveBeenCalled();
  });
});
