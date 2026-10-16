import { describe, expect, it, vi } from "vitest";
import { renderHeaderEditor } from "../ui/headerEditor";
import { makeMatrixProject } from "./fixtures/matrixProject";
vi.mock("../ui/legacyInteractions", () => ({ attachHeaderInteractions: vi.fn() }));
vi.mock("../ui/headerBattleEnvironmentEditor", () => ({ initializeHeaderBattleEnvironmentEditors: vi.fn(), renderBattleBackgroundTypeSelect: () => "", renderHeaderBattleEnvironmentCard: () => "" }));

describe("header seasonal assignments shortcut", () => {
  it("opens native header IDs, including zero, without editing the header", () => {
    const project = makeMatrixProject(), open = vi.fn(), dirty = vi.fn();
    let html = "";
    const links: Array<{ dataset: { openMatrixSeasons: string }; click?: (event: { preventDefault: () => void }) => void }> = [];
    const root = { set innerHTML(value: string) {
      html = value; links.length = 0;
      for (const match of value.matchAll(/data-open-matrix-seasons="(\d+)"/gu)) {
        const link = { dataset: { openMatrixSeasons: match[1] }, addEventListener(_name: string, callback: (event: { preventDefault: () => void }) => void) { link.click = callback; }, click: undefined as ((event: { preventDefault: () => void }) => void) | undefined };
        links.push(link);
      }
    }, querySelectorAll: (selector: string) => selector === "[data-open-matrix-seasons]" ? links : [] };
    renderHeaderEditor(project, root as unknown as HTMLElement, dirty, undefined, open);
    expect(html).toContain('href="#matrixEditor/header/0"'); expect(links).toHaveLength(3);
    links[0].click!({ preventDefault: vi.fn() }); links[2].click!({ preventDefault: vi.fn() });
    expect(open.mock.calls).toEqual([[0], [2]]); expect(dirty).not.toHaveBeenCalled();
    expect(project.headers!.rows[1].matrix_id).toBe(0);
    project.session.baseRom = "Pt";
    renderHeaderEditor(project, root as unknown as HTMLElement, dirty, undefined, open);
    expect(links).toHaveLength(0);
  });
});
