import { compileGifToPwan, type PwanCompileResult } from "./pwanCompiler";

type CompileResponse = {
  id: number;
  result?: PwanCompileResult;
  error?: string;
};

type PendingCompile = {
  resolve: (result: PwanCompileResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

let compilerWorker: Worker | undefined;
let nextRequestId = 1;
const pendingCompiles = new Map<number, PendingCompile>();
const PWAN_COMPILE_TIMEOUT_MS = 60_000;

export function compileGifToPwanAsync(bytes: Uint8Array): Promise<PwanCompileResult> {
  if (typeof Worker === "undefined") return Promise.resolve().then(() => compileGifToPwan(bytes));
  let worker: Worker;
  try {
    worker = getCompilerWorker();
  } catch {
    return Promise.resolve().then(() => compileGifToPwan(bytes));
  }
  const id = nextRequestId++;
  return new Promise<PwanCompileResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      failCompilerWorker(new Error("GIF compilation exceeded 60 seconds. Reduce the GIF dimensions or frame count and try again."));
    }, PWAN_COMPILE_TIMEOUT_MS);
    pendingCompiles.set(id, { resolve, reject, timeout });
    try {
      worker.postMessage({ id, bytes });
    } catch (error) {
      clearTimeout(timeout);
      pendingCompiles.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function getCompilerWorker(): Worker {
  if (compilerWorker) return compilerWorker;
  const worker = new Worker(new URL("./pwanCompileWorker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<CompileResponse>) => {
    const pending = pendingCompiles.get(event.data.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingCompiles.delete(event.data.id);
    if (event.data.result) pending.resolve(event.data.result);
    else pending.reject(new Error(event.data.error ?? "PWAN GIF compilation failed."));
  });
  worker.addEventListener("error", (event) => {
    failCompilerWorker(new Error(event.message || "PWAN GIF compiler worker failed."));
  });
  compilerWorker = worker;
  return worker;
}

function failCompilerWorker(error: Error): void {
  for (const pending of pendingCompiles.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  pendingCompiles.clear();
  compilerWorker?.terminate();
  compilerWorker = undefined;
}
