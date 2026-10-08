import { describe, expect, it } from "vitest";
import type { ProjectState } from "../pokeweb/projectStore";
import { renderCodeInjectionEditor } from "../ui/codeInjectionEditor";

function renderFixture(version: "W2" | "B2" | "B" | "W", pmcInstalled = false): string {
  const project: ProjectState = {
    originalRomBytes: new Uint8Array(0x200),
    session: { romName: "fixture", baseRom: version === "B" || version === "W" ? "BW" : "BW2", baseVersion: version, fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "fixture", idCode: version === "W2" ? "IRDO" : "IREO", fileName: "fixture.nds", size: 0x200 },
    arm9: new Uint8Array(), overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
  };
  if (pmcInstalled) project.codeInjection = { pmc: { overlayId: 237, overlayBaseAddress: 0x02217d20, overlayPath: "overlay/overlay_0237.bin", symbolPath: "codeinjection/RPMSYM-PMC.rpm" } };
  const root = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
  renderCodeInjectionEditor(project, root as unknown as HTMLElement, () => {});
  return root.innerHTML;
}

describe("code-injection design credits", () => {
  it.each(["W2", "B2"] as const)("credits TrustyPeaches only on the requested %s cards", (version) => {
    const cards = renderFixture(version).match(/<section class="code-injection-panel">[\s\S]*?<\/section>/g) ?? [];
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

describe("code-injection patch categories", () => {
  it("enables Black 1 doubles only after PMC is installed and leaves White 1 unavailable", () => {
    const card = (version: "B" | "W", installed: boolean) => renderFixture(version, installed)
      .match(/<section class="code-injection-panel">[\s\S]*?<\/section>/g)!
      .find(html => html.includes("<h2>Single-NPC Double Battle Fix</h2>"))!;
    expect(card("B", false)).toMatch(/id="install-double-battle-fix-btn"[^>]*disabled/u);
    expect(card("B", true)).not.toMatch(/id="install-double-battle-fix-btn"[^>]*disabled/u);
    expect(card("B", true)).toContain("US Black 1");
    expect(card("W", true)).toContain("Unsupported");
    expect(card("W", true)).toMatch(/id="install-double-battle-fix-btn"[^>]*disabled/u);
  });
  it.each(["W2", "B2"] as const)("offers the EV option by default on the %s Summary card", version => {
    const card = renderFixture(version).match(/<section class="code-injection-panel">[\s\S]*?<\/section>/g)
      ?.find(html => html.includes("<h2>Summary IV/EV Viewer</h2>"));
    expect(card).toContain("Include EV view");
    expect(card).toMatch(/id="summary-stat-evs" checked/u);
    expect(card).toContain("Install Summary IV/EV Viewer");
  });

  it("places every patch in its functional tab and keeps PMC in the sidebar", () => {
    const html = renderFixture("W2");
    const headings = (section: string) => [...section.matchAll(/<h2>([^<]+)<\/h2>/g)].map(match => match[1]);
    const panelIds = ["infrastructure", "graphics", "quality-of-life", "add-ons", "debug-helpers"];
    const panels = panelIds.map((id, index) => {
      const start = html.indexOf(`id="code-injection-panel-${id}"`);
      const end = index + 1 < panelIds.length
        ? html.indexOf(`id="code-injection-panel-${panelIds[index + 1]}"`)
        : html.indexOf("</main>", start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return html.slice(start, end);
    });

    expect(headings(panels[0])).toEqual([
      "PWAN GIF Support", "Trainer PWAN GIF Support", "Overworld Weather Runtime", "Trainer Battle Log",
    ]);
    expect(headings(panels[1])).toEqual([
      "Summary IV/EV Viewer", "Enhanced Party Menu and Battle Log Integration", "Type Icons", "Learnset Viewer", "Move Effectiveness Preview",
    ]);
    expect(headings(panels[2])).toEqual(["Instant Fast Text", "Background Music Toggle"]);
    expect(headings(panels[3])).toEqual([
      "Infinite Rare Candy", "Hard Level Caps", "Single-NPC Double Battle Fix",
      "Tag Battle Stabilization", "Porta PC", "Added-Form Evolution Support",
    ]);
    expect(headings(panels[4])).toEqual(["Walk Through Walls", "Instant Battle Victory"]);
    expect(html).toContain(">Debug Helpers</button>");
    expect(html.slice(html.indexOf("<aside"), html.indexOf("</aside>"))).toContain("<h2>PMC Runtime</h2>");
    expect(html.slice(html.indexOf("<main"), html.indexOf("</main>"))).not.toContain("<h2>PMC Runtime</h2>");
    expect(html).toContain("<div><span>Version</span>");
    expect(html).not.toContain("<span>Overlay</span>");
    expect(html).not.toContain("<span>Base Address</span>");
    expect(html).not.toContain("Install runtime support for prebuilt Gen V patch modules.");
    expect(html).not.toContain("Prebuilt DLL upload will use the ROM filesystem support added for /patches and /lib.");
    expect(html).not.toContain("Patch DLLs are staged in patches/. Library DLLs are staged in lib/.");
    const actionNotes = [...html.matchAll(/<div class="code-injection-note" id="[^"]+-note" aria-live="polite">([\s\S]*?)<\/div>/g)];
    expect(actionNotes).toHaveLength(20);
    expect(actionNotes.every((match) => match[1] === "")).toBe(true);
  });
});
