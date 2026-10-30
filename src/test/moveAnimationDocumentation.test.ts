import { describe, expect, it } from "vitest";
import {
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
  });
});
