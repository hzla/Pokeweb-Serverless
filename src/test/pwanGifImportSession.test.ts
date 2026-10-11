import { describe, expect, it, vi } from "vitest";
import { PwanGifImportSession } from "../pokeweb/pwanGifImportSession";
import { compileGifToPwan, type PwanCompileOptions, type PwanCompileResult } from "../pokeweb/pwanCompiler";
import { pwanOverrideSideFromCompileResult } from "../pokeweb/pwanAnimationModel";
import { renderPwanGifImportPreview } from "../ui/pwanGifImportPreview";

const gif = () => new Uint8Array(Buffer.from("R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICRAEAOw==", "base64"));
const result = (preset: "none" | "gen5" = "none") => compileGifToPwan(gif(), { colorPreset: preset, includePreview: true });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("GIF conversion previews", () => {
  it("keeps imports preview-only and applies the exact reviewed bytes without sharing mutable buffers", async () => {
    const session = new PwanGifImportSession();
    const source = gif();
    expect(session.ready()).toBeUndefined();
    await session.setSource({ fileName: "sprite.gif", bytes: source });
    const ready = session.ready()!;
    const side = pwanOverrideSideFromCompileResult({ fileName: ready.source.fileName, gifBytes: ready.source.bytes }, ready.result);
    expect(side.pwanBytes).toEqual(ready.result.pwanBytes);
    expect(side.pwanBytes).not.toBe(ready.result.pwanBytes);
    expect(side.sourceGifBytes).toEqual(source);
    expect(side.sourceGifBytes).not.toBe(ready.source.bytes);
    expect(side.paletteBgr555).not.toBe(ready.result.paletteBgr555);
    expect(session.colorPreset).toBe("none");
  });

  it("invalidates Apply immediately when the preset changes and ignores stale completions", async () => {
    const old = deferred<PwanCompileResult>();
    const next = deferred<PwanCompileResult>();
    const compile = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const session = new PwanGifImportSession({ compile });
    const first = session.setSource({ fileName: "sprite.gif", bytes: gif() });
    const second = session.setPreset("gen5");
    expect(session.busy).toBe(true);
    expect(session.ready()).toBeUndefined();
    old.resolve(result());
    await first;
    expect(session.ready()).toBeUndefined();
    next.resolve(result("gen5"));
    await second;
    expect(session.ready()!.result.conversion.colorPreset).toBe("gen5");
    expect(compile.mock.calls[1]![1]).toEqual({ colorPreset: "gen5", includePreview: true });
  });

  it("does not resurrect an old preview after canceling a conversion", async () => {
    const pending = deferred<PwanCompileResult>();
    const session = new PwanGifImportSession({ compile: () => pending.promise });
    const work = session.setSource({ fileName: "sprite.gif", bytes: gif() });
    await session.setSource();
    pending.resolve(result());
    await work;
    expect(session.ready()).toBeUndefined();
    expect(session.source).toBeUndefined();
    expect(session.busy).toBe(false);
  });

  it("keeps the latest file even when an older file read finishes later", async () => {
    const older = deferred<ArrayBuffer>();
    const compile = vi.fn(async () => result());
    const session = new PwanGifImportSession({ compile });
    const work = session.setFile({ name: "old.gif", arrayBuffer: () => older.promise });
    await session.setFile({ name: "new.gif", arrayBuffer: async () => gif().buffer });
    older.resolve(gif().buffer);
    await work;
    expect(session.ready()!.source.fileName).toBe("new.gif");
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it("uses the latest preset if it changes while the file is still being read", async () => {
    const reading = deferred<ArrayBuffer>();
    const compile = vi.fn(async (_bytes: Uint8Array, _options: PwanCompileOptions) => result("gen5"));
    const session = new PwanGifImportSession({ compile });
    const work = session.setFile({ name: "sprite.gif", arrayBuffer: () => reading.promise });
    await session.setPreset("gen5");
    reading.resolve(gif().buffer);
    await work;
    expect(compile.mock.calls[0]![1]).toEqual({ colorPreset: "gen5", includePreview: true });
    expect(session.ready()).toBeDefined();
  });

  it("does not allow a failed file to fall back to the previous successful conversion", async () => {
    const session = new PwanGifImportSession();
    await session.setSource({ fileName: "valid.gif", bytes: gif() });
    await session.setSource({ fileName: "invalid.gif", bytes: Uint8Array.of(1, 2, 3) });
    expect(session.ready()).toBeUndefined();
    expect(session.result).toBeUndefined();
    expect(session.error).toBeTruthy();
    expect(session.busy).toBe(false);
    await session.setSource({ fileName: "valid-again.gif", bytes: gif() });
    expect(session.ready()).toBeDefined();
    expect(session.error).toBeUndefined();
  });

  it("ignores a stale error without invalidating a newer successful preview", async () => {
    const older = deferred<PwanCompileResult>();
    const compile = vi.fn().mockReturnValueOnce(older.promise).mockResolvedValueOnce(result());
    const session = new PwanGifImportSession({ compile });
    const work = session.setSource({ fileName: "old.gif", bytes: gif() });
    await session.setSource({ fileName: "new.gif", bytes: gif() });
    older.reject(new Error("stale failure"));
    await work;
    expect(session.ready()!.source.fileName).toBe("new.gif");
    expect(session.error).toBeUndefined();
  });

  it("renders pixel-sized before/after canvases, opt-in grading, and synchronized frame controls", () => {
    const html = renderPwanGifImportPreview("front");
    expect(html).toContain('value="none" selected');
    expect(html).toContain('value="gen5" ');
    expect(html.match(/width="96" height="96"/g)).toHaveLength(2);
    expect(html).toContain("source, pixel-resized");
    expect(html).toContain("15 visible colors + transparency");
    expect(html).toContain('data-conversion-slider type="range"');
    expect(html).toContain("before applying");
    expect(renderPwanGifImportPreview("trainer", "gen5")).toContain('value="gen5" selected');
    expect(renderPwanGifImportPreview('<script>"')).not.toContain("<script>");
  });
});
