import { openStudioWorkspace, saveStudioWorkspace, type StudioTileset, type StudioWorkspace } from "./mapStudioFormats";
import { attachStudioTileset, openStudioTilesetPack, saveStudioTilesetPack } from "./mapStudioTilesets";
import { deriveStudioLayouts } from "./mapStudioPalette";

// Created only by the Map Studio view. Parsing, compression and compilation never
// execute on another editor's main thread or during ordinary project autosaves.
self.addEventListener("message", async (event: MessageEvent<{ id: number; operation: "open" | "save" | "tileset" | "layouts"; files?: Record<string, Uint8Array>; workspace?: StudioWorkspace; tileset?: StudioTileset; metadata?: Uint8Array; name?: string; game?: number }>) => {
  const request = event.data;
  try {
    let result: unknown;
    if (request.operation === "tileset") {
      const pack = openStudioTilesetPack(request.files!, request.name), zip = saveStudioTilesetPack(pack);
      // Arrangement edits keep the same library identity as the original pack.
      const hash = await crypto.subtle.digest("SHA-256", saveStudioTilesetPack(pack, false).slice().buffer), id = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
      result = { ...attachStudioTileset(request.workspace, pack, id, request.game), library: { id, name: pack.name, count: pack.tileset.tiles.length }, zip };
    } else if (request.operation === "layouts") result = deriveStudioLayouts(request.tileset!, request.metadata);
    else if (request.operation === "open") { const ws = openStudioWorkspace(request.files!); ws.layouts ??= deriveStudioLayouts(ws.tileset, ws.files[ws.tilesetPath + ".meta"]); result = ws; }
    else result = saveStudioWorkspace(request.workspace!);
    self.postMessage({ id: request.id, result });
  } catch (error) { self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) }); }
});
