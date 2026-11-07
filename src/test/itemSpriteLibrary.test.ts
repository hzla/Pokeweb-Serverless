import { readFileSync } from "node:fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import { PNG } from "pngjs";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("optional item sprite library", () => {
  it("loads on request, caches the archive, and includes both source packs and palette variants", async () => {
    const archive = readFileSync(new URL("../../public/data/item-sprite-library.zip", import.meta.url));
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(archive)));
    vi.stubGlobal("fetch", fetchMock);
    const { loadItemSpriteLibrary } = await import("../pokeweb/itemSpriteLibrary");
    expect(fetchMock).not.toHaveBeenCalled();
    const [library, again] = await Promise.all([loadItemSpriteLibrary(), loadItemSpriteLibrary()]);
    expect(again).toBe(library);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(library.entries.find(e => e.source === "hg" && e.name === "Assault Vest")).toBeTruthy();
    expect(library.entries.find(e => e.source === "emerald" && e.name === "Assault Vest")).toBeTruthy();
    const sprite = (name: string) => {
      const entry = library.entries.find(e => e.source === "emerald" && e.name === name)!;
      expect(entry).toBeTruthy();
      return PNG.sync.read(Buffer.from(library.files[entry.path]));
    };
    const fire = sprite("Fire Gem"), water = sprite("Water Gem"), white = sprite("White Herb"), mental = sprite("Mental Herb");
    expect([fire.width, fire.height]).toEqual([24, 24]);
    expect(fire.data).not.toEqual(water.data);
    expect(white.data).not.toEqual(mental.data);
  });

  it("allows retry after a failed download", async () => {
    const archive = readFileSync(new URL("../../public/data/item-sprite-library.zip", import.meta.url));
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 })).mockResolvedValueOnce(new Response(new Uint8Array(archive)));
    vi.stubGlobal("fetch", fetchMock);
    const { loadItemSpriteLibrary } = await import("../pokeweb/itemSpriteLibrary");
    await expect(loadItemSpriteLibrary()).rejects.toThrow(/Unable to load/);
    await expect(loadItemSpriteLibrary()).resolves.toMatchObject({ entries: expect.any(Array) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
