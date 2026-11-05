import { describe, expect, it, vi } from "vitest";
import { renderHeaderLinks } from "../ui/headerEditor";
import { makeMatrixProject } from "./fixtures/matrixProject";
vi.mock("../ui/legacyInteractions", () => ({ attachHeaderInteractions: vi.fn() }));
vi.mock("../ui/headerBattleEnvironmentEditor", () => ({ initializeHeaderBattleEnvironmentEditors: vi.fn(), renderBattleBackgroundTypeSelect: () => "", renderHeaderBattleEnvironmentCard: () => "" }));

describe("header reference links", () => {
  it("links native header IDs, including zero, to the matrix without editing the header", () => {
    const project = makeMatrixProject();
    const row = project.headers!.rows[1];
    const html = renderHeaderLinks(project, row, { onOpenSeasons: vi.fn() }, false);
    expect(html).toMatch(/data-open-ref="matrix" data-ref-id="0"(?! aria-disabled)/u);
    expect(project.headers!.rows[1].matrix_id).toBe(0);
  });

  it("disables links whose editor is unavailable", () => {
    const project = makeMatrixProject();
    const html = renderHeaderLinks(project, project.headers!.rows[1], {}, false);
    expect(html.match(/aria-disabled="true"/gu)).toHaveLength(6);
  });

  it("marks unused encounter tables as none", () => {
    const project = makeMatrixProject();
    const row = { ...project.headers!.rows[1], enc_data_id: 0xffff, encounter_id: 255 };
    const html = renderHeaderLinks(project, row, { onOpenEncounters: vi.fn() }, false);
    expect(html).toMatch(/data-open-ref="encounters" data-ref-id="65535" aria-disabled="true"[^>]*><span>Encounters<\/span><strong>None<\/strong>/u);
  });
});
