import { openStudioWorkspace, saveStudioWorkspace, type StudioWorkspace } from "./mapStudioFormats";

// Created only by the Map Studio view. Parsing, compression and compilation never
// execute on another editor's main thread or during ordinary project autosaves.
self.addEventListener("message", (event: MessageEvent<{ id: number; operation: "open" | "save"; files?: Record<string, Uint8Array>; workspace?: StudioWorkspace }>) => {
  const request = event.data;
  try {
    const result = request.operation === "open" ? openStudioWorkspace(request.files!) : saveStudioWorkspace(request.workspace!);
    self.postMessage({ id: request.id, result });
  } catch (error) { self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) }); }
});
