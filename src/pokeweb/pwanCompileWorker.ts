import { compileGifToPwan, type PwanCompileOptions, type PwanCompileResult } from "./pwanCompiler";

type CompileRequest = {
  id: number;
  bytes: Uint8Array;
  options?: PwanCompileOptions;
};

type CompileResponse = {
  id: number;
  result?: PwanCompileResult;
  error?: string;
};

const scope = globalThis as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<CompileRequest>) => void): void;
  postMessage(message: CompileResponse, transfer?: Transferable[]): void;
};

scope.addEventListener("message", (event) => {
  const { id, bytes, options } = event.data;
  try {
    const result = compileGifToPwan(bytes, options);
    scope.postMessage({ id, result }, [result.pwanBytes.buffer, result.paletteBgr555.buffer, ...(result.previewFrames?.map((frame) => frame.pixels.buffer) ?? [])]);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
