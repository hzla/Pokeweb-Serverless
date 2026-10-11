import { afterEach, describe, expect, it, vi } from "vitest";
import * as sprites from "../pokeweb/trainerSpriteModel";
import * as animations from "../pokeweb/trainerPwanAnimationModel";
import { compilePwanAnimationFrames } from "../pokeweb/pwanCompiler";
import { pwanOverrideSideFromCompileResult } from "../pokeweb/pwanAnimationModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { renderTrainerSpriteEditor, stopTrainerSpriteEditorPlayback } from "../ui/trainerSpriteEditor";

// Conversion controls have their own canvas/event suite; this checks backend selection.
vi.mock("../ui/pwanGifImportPreview", () => ({
  renderPwanGifImportPreview: () => "",
  installPwanGifImportPreview: () => ({ ready: () => undefined }),
}));

afterEach(() => { stopTrainerSpriteEditorPlayback(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("automatic trainer animation previews", () => {
  it.each(["pwan", "w2anim"] as const)("opens the active %s animation instead of decoding its native carrier", async (backend) => {
    const project = { session: { baseRom: "BW2", baseVersion: "W2" }, texts: { banks: {} }, narcs: {},
      ...(backend === "w2anim" ? { w2animAnimations: { sourceBytes: new Uint8Array() } } : {}),
    } as unknown as ProjectState;
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ putImageData: vi.fn() }) }) });
    vi.stubGlobal("ImageData", class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(sprites, "ensureTrainerSpriteStore").mockResolvedValue(true);
    vi.spyOn(sprites, "trainerGraphicIndexForClass").mockReturnValue(2);
    vi.spyOn(sprites, "getTrainerClassIdsSharingGraphic").mockReturnValue([2]);
    const native = vi.spyOn(sprites, "getTrainerClassSpriteAnimation").mockImplementation(() => { throw new Error("Native carrier must not mask a custom animation"); });
    vi.spyOn(animations, "getTrainerPwanRuntimeStatus").mockReturnValue({ installed: true, supported: true, pmcInstalled: true, message: backend });
    const compiled = compilePwanAnimationFrames([{ index: 0, width: 1, height: 1, delayMs: 100, pixels: Uint8ClampedArray.of(248, 80, 16, 255) }]);
    vi.spyOn(animations, "findTrainerPwanOverride").mockReturnValue({ graphicIndex: 2,
      animation: pwanOverrideSideFromCompileResult({ fileName: "fixture.gif", gifBytes: Uint8Array.of(1) }, compiled) });
    const root = { innerHTML: "", isConnected: true, querySelector: () => undefined, querySelectorAll: () => [] } as unknown as HTMLElement;
    await renderTrainerSpriteEditor(project, root, 2);
    expect(native).not.toHaveBeenCalled();
    expect(root.innerHTML).toContain(`${backend === "w2anim" ? "w2anim" : "PWAN"} battle-intro animation`);
    expect(root.innerHTML).toContain(`${backend === "w2anim" ? "w2anim" : "PWAN"} GIF`);
    expect(root.innerHTML).not.toContain("sprite-editor-error");
  });
});
