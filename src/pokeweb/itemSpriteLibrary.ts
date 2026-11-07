import { publicAsset } from "../assetUrl";

export type ItemSpriteLibraryEntry = { source: "emerald" | "hg"; name: string; path: string };
export type ItemSpriteLibrary = { entries: ItemSpriteLibraryEntry[]; files: Record<string, Uint8Array> };
let pending: Promise<ItemSpriteLibrary> | undefined;

/** Download and unpack the optional library only after it is requested. */
export function loadItemSpriteLibrary(): Promise<ItemSpriteLibrary> {
  if (!pending) pending = (async () => {
    const response = await fetch(publicAsset("data/item-sprite-library.zip"));
    if (!response.ok) throw Error("Unable to load the sprite library.");
    const { unzipSync } = await import("fflate");
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"])) as { version: number; entries: ItemSpriteLibraryEntry[] };
    if (manifest.version !== 1 || !Array.isArray(manifest.entries) || !manifest.entries.every(entry =>
      (entry.source === "emerald" || entry.source === "hg") && typeof entry.name === "string" && typeof entry.path === "string" && Boolean(files[entry.path]))) throw Error("Invalid sprite library.");
    return { entries: manifest.entries, files };
  })().catch(error => { pending = undefined; throw error; });
  return pending;
}
