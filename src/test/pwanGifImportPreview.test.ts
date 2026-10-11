import { afterEach, describe, expect, it, vi } from "vitest";
import { compileGifToPwan, compilePwanAnimationFrames, pwanFrameRgbaImage, pwanTimeline, pwanToGifBytes } from "../pokeweb/pwanCompiler";
import { installPwanGifImportPreview } from "../ui/pwanGifImportPreview";

// Minimal DOM/canvas adapter: exercises event wiring without a browser dependency.
function element() {
  const listeners = new Map<string, (event: any) => void>();
  const context = { putImageData: vi.fn() };
  return {
    hidden: false, value: "0", max: "0", disabled: false, textContent: "", innerHTML: "", isConnected: true,
    classList: { toggle: vi.fn() },
    getContext: () => context,
    addEventListener: (type: string, listener: (event: any) => void) => { listeners.set(type, listener); },
    fire(type: string) { listeners.get(type)?.({ currentTarget: this }); },
    querySelector: (_selector: string): any => undefined,
    context,
  };
}

function fixture() {
  const container = element();
  const controls = Object.fromEntries(["before", "after", "slider", "play", "preset", "frame", "status", "warnings", "images", "playback"].map(key => [key, element()]));
  container.querySelector = (selector: string) => controls[selector.slice("[data-conversion-".length, -1)];
  const root = { querySelector: () => container } as unknown as HTMLElement;
  const frames = [[80, 128, 176], [96, 176, 128]].map((rgb, index) => ({ index, width: 1, height: 1, delayMs: 100, pixels: Uint8ClampedArray.from([...rgb, 255]) }));
  const bytes = pwanToGifBytes(compilePwanAnimationFrames(frames).pwanBytes);
  const result = compileGifToPwan(bytes, { includePreview: true });
  return { container, controls, root, bytes, result };
}

afterEach(() => vi.unstubAllGlobals());

describe("GIF before/after preview event wiring", () => {
  it("preserves a paused comparison frame across preset recompilation and draws actual encoded colors", async () => {
    vi.stubGlobal("Worker", undefined);
    vi.stubGlobal("ImageData", class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { root, controls, bytes, result } = fixture();
    const session = installPwanGifImportPreview(root, "front", { source: { fileName: "fixture.gif", bytes }, result });
    controls.slider!.value = "1";
    controls.slider!.fire("input");
    expect(controls.frame!.textContent).toBe("2 / 2");
    expect(controls.play!.textContent).toBe("Play");
    const before = controls.before!.context.putImageData.mock.lastCall![0].data;
    controls.preset!.value = "gen5";
    controls.preset!.fire("change");
    expect(session.ready()).toBeUndefined();
    expect(controls.images!.hidden).toBe(true);
    await vi.waitFor(() => expect(session.ready()).toBeDefined());
    expect(controls.frame!.textContent).toBe("2 / 2");
    expect(controls.images!.hidden).toBe(false);
    expect(controls.before!.context.putImageData.mock.lastCall![0].data).toEqual(before);
    const ready = session.ready()!;
    const expected = pwanFrameRgbaImage(ready.result.pwanBytes, pwanTimeline(ready.result.pwanBytes)[1]!.frameIndex).pixels;
    expect(controls.after!.context.putImageData.mock.lastCall![0].data).toEqual(expected);
    expect(controls.status!.textContent).toContain("Gen 5-inspired");
  });

  it("stops playback and prevents stale UI callbacks after the editor is detached", async () => {
    vi.stubGlobal("Worker", undefined);
    vi.stubGlobal("ImageData", class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
    const raf = vi.fn((_callback: FrameRequestCallback) => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const { root, container, bytes, result } = fixture();
    const onChange = vi.fn();
    const session = installPwanGifImportPreview(root, "front", { source: { fileName: "fixture.gif", bytes }, result, onChange });
    expect(raf).toHaveBeenCalledTimes(1);
    container.isConnected = false;
    const tick = raf.mock.calls[0]![0] as (time: number) => void;
    tick(100);
    expect(raf).toHaveBeenCalledTimes(1);
    await session.setPreset("gen5");
    expect(onChange).not.toHaveBeenCalled();
  });
});
