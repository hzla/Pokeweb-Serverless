import { describe, expect, it } from "vitest";
import { settleCatalogLoad } from "../ui/battleBackgroundEditor";

describe("battle background editor catalog loading", () => {
  it("preserves a successful background catalog when the platform catalog fails", async () => {
    const backgroundCatalog = { variants: [{ tableIndex: 0 }] };
    const [backgroundResult, platformResult] = await Promise.all([
      settleCatalogLoad(Promise.resolve(backgroundCatalog)),
      settleCatalogLoad(Promise.reject(new Error("Malformed platform table"))),
    ]);

    expect(backgroundResult).toEqual({ catalog: backgroundCatalog });
    expect(platformResult).toEqual({ error: "Malformed platform table" });
  });

  it("preserves a successful platform catalog when the background catalog fails", async () => {
    const platformCatalog = { variants: [{ tableIndex: 6 }] };
    const [backgroundResult, platformResult] = await Promise.all([
      settleCatalogLoad(Promise.reject(new Error("Missing background table"))),
      settleCatalogLoad(Promise.resolve(platformCatalog)),
    ]);

    expect(backgroundResult).toEqual({ error: "Missing background table" });
    expect(platformResult).toEqual({ catalog: platformCatalog });
  });
});
