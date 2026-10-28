import { compileStudioChunk } from "./mapStudioCompiler";
import type { StudioWorkspace } from "./mapStudioFormats";

self.addEventListener("message", (event: MessageEvent<{ id: number; workspace: StudioWorkspace; chunk: number; layer: number }>) => {
  try { self.postMessage({ id: event.data.id, result: compileStudioChunk(event.data.workspace, event.data.chunk, event.data.layer) }); }
  catch (error) { self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : String(error) }); }
});
