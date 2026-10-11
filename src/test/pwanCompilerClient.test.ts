import { afterEach, describe, expect, it, vi } from "vitest";
import { compileGifToPwan } from "../pokeweb/pwanCompiler";

const gif = () => new Uint8Array(Buffer.from("R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICRAEAOw==", "base64"));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("GIF compiler options across worker boundaries", () => {
  it("uses identical preset and preview options in the no-worker fallback", async () => {
    vi.stubGlobal("Worker", undefined);
    const { compileGifToPwanAsync } = await import("../pokeweb/pwanCompilerClient");
    const options = { colorPreset: "gen5", includePreview: true } as const;
    expect(await compileGifToPwanAsync(gif(), options)).toEqual(compileGifToPwan(gif(), options));
  });

  it("preserves options if worker creation is blocked", async () => {
    vi.stubGlobal("Worker", class { constructor() { throw new Error("blocked"); } });
    const { compileGifToPwanAsync } = await import("../pokeweb/pwanCompilerClient");
    expect((await compileGifToPwanAsync(gif(), { colorPreset: "gen5" })).conversion.colorPreset).toBe("gen5");
  });

  it("sends options to the worker without transferring away source GIF bytes", async () => {
    let message: any;
    const listeners = new Map<string, (event: any) => void>();
    vi.stubGlobal("Worker", class {
      addEventListener(type: string, listener: (event: any) => void) { listeners.set(type, listener); }
      postMessage(request: any) {
        message = request;
        queueMicrotask(() => listeners.get("message")!({ data: { id: request.id, result: compileGifToPwan(request.bytes, request.options) } }));
      }
      terminate() {}
    });
    const { compileGifToPwanAsync } = await import("../pokeweb/pwanCompilerClient");
    const bytes = gif();
    const result = await compileGifToPwanAsync(bytes, { colorPreset: "gen5", includePreview: true });
    expect(message.options).toEqual({ colorPreset: "gen5", includePreview: true });
    expect(bytes).toEqual(gif());
    expect(result.previewFrames).toHaveLength(1);
  });

  it("the real worker compiles the preset and transfers optional preview buffers", async () => {
    let receive!: (event: any) => void;
    const post = vi.fn();
    vi.stubGlobal("addEventListener", (_type: string, callback: (event: any) => void) => { receive = callback; });
    vi.stubGlobal("postMessage", post);
    await import("../pokeweb/pwanCompileWorker");
    receive({ data: { id: 7, bytes: gif(), options: { colorPreset: "gen5", includePreview: true } } });
    const [response, transfers] = post.mock.calls[0]!;
    expect(response.id).toBe(7);
    expect(response.result).toEqual(compileGifToPwan(gif(), { colorPreset: "gen5", includePreview: true }));
    expect(transfers).toHaveLength(3);
    expect(new Set(transfers).size).toBe(transfers.length);
    receive({ data: { id: 8, bytes: Uint8Array.of(1, 2, 3) } });
    expect(post.mock.calls[1]![0]).toMatchObject({ id: 8, error: expect.any(String) });
  });
});
