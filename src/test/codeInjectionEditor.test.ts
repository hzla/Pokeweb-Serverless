import { describe, expect, it } from "vitest";
import type { ProjectState } from "../pokeweb/projectStore";
import { renderCodeInjectionEditor } from "../ui/codeInjectionEditor";

describe("code-injection design credits", () => {
  it.each(["W2", "B2"] as const)("credits TrustyPeaches only on the requested %s cards", (version) => {
    const project: ProjectState = {
      originalRomBytes: new Uint8Array(0x200),
      session: { romName: "fixture", baseRom: "BW2", baseVersion: version, fairy: false, fileIds: {}, blacklist: [] },
      romInfo: { title: "fixture", idCode: version === "W2" ? "IRDO" : "IREO", fileName: "fixture.nds", size: 0x200 },
      arm9: new Uint8Array(), overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    };
    const root = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
    renderCodeInjectionEditor(project, root as unknown as HTMLElement, () => {});

    const cards = root.innerHTML.match(/<section class="code-injection-panel">[\s\S]*?<\/section>/g) ?? [];
    for (const title of ["Learnset Viewer", "Type Icons"]) {
      const card = cards.find(html => html.includes(`<h2>${title}</h2>`));
      expect(card).toBeDefined();
      expect(card).toContain(`class="code-injection-credits" aria-label="${title} credits"`);
      expect(card!.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "))
        .toContain("Designed in collaboration with TrustyPeaches");
    }
    expect(cards.filter(html => html.includes("TrustyPeaches"))).toHaveLength(2);
    expect(cards.find(html => html.includes("<h2>Move Effectiveness Preview</h2>")))
      .not.toContain("TrustyPeaches");
  });
});
