import { compileStudioChunk } from "./mapStudioCompiler";
import type { StudioWorkspace } from "./mapStudioFormats";
import { previewStudioBuildings, readStudioBuildingSource } from "./mapStudioBuildings";

self.addEventListener("message", (event: MessageEvent<{ id: number; operation: string; workspace: StudioWorkspace; chunk: number; layer: number; game: "BW" | "BW2"; bytes: Uint8Array }>) => {
  try { self.postMessage({ id: event.data.id, result: event.data.operation === "source" ? readStudioBuildingSource(event.data.workspace, event.data.bytes) : event.data.operation === "buildings" ? previewStudioBuildings(event.data.workspace, event.data.workspace.map.chunks[event.data.chunk]) : compileStudioChunk(event.data.workspace, event.data.chunk, event.data.layer, event.data.game) }); }
  catch (error) { self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : String(error) }); }
});
