import { compileGifToPwan, type PwanCompileResult } from "./pwanCompiler";

type CompileRequest = {
  id: number;
  bytes: Uint8Array;
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
  const { id, bytes } = event.data;
  try {
    const result = compileGifToPwan(bytes);
    scope.postMessage({ id, result }, [result.pwanBytes.buffer, result.paletteBgr555.buffer]);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
