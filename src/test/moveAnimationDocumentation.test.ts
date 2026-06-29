import { describe, expect, it } from "vitest";
import {
  MOVE_ANIMATION_WORKFLOW_GUIDES,
  SCRIPT_SPA_BOUNDARY_REFERENCES,
  SPA_FIELD_REFERENCE_DOCS,
  getMoveAnimationCommandDocumentationGaps,
  getMoveAnimationCommandDocsByCategory,
} from "../pokeweb/moveAnimationDocumentation";
import { getMoveAnimationCommandDefinitions } from "../pokeweb/moveAnimationModel";

describe("move animation documentation", () => {
  it("documents every known BW2 move animation command and parameter", () => {
    expect(getMoveAnimationCommandDocumentationGaps()).toEqual([]);
  });

  it("keeps command docs categorized for the editor browser", () => {
    const definitions = getMoveAnimationCommandDefinitions();
    const documented = getMoveAnimationCommandDocsByCategory().flatMap((group) => group.commands);

    expect(documented).toHaveLength(definitions.length);
    expect(getMoveAnimationCommandDocsByCategory().map((group) => group.category)).toContain("Camera");
    expect(getMoveAnimationCommandDocsByCategory().map((group) => group.category)).toContain("Sound");
  });

  it("includes workflow, SPA field, and script-vs-SPA boundary references", () => {
    expect(MOVE_ANIMATION_WORKFLOW_GUIDES.some((guide) => guide.id === "recoloring")).toBe(true);
    expect(MOVE_ANIMATION_WORKFLOW_GUIDES.some((guide) => guide.id === "projectiles")).toBe(true);
    expect(SPA_FIELD_REFERENCE_DOCS.some((field) => field.key === "resource.colorAnim")).toBe(true);
    expect(SCRIPT_SPA_BOUNDARY_REFERENCES.some((reference) => reference.topic === "Particle Shape")).toBe(true);
  });
});

