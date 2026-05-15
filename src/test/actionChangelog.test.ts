import { describe, expect, it } from "vitest";
import {
  ensureActionChangelog,
  recordFieldChange,
  recordGenericChange,
  renderActionChangelogText,
  resetActionChangelog,
} from "../pokeweb/actionChangelog";
import type { ProjectState } from "../pokeweb/projectStore";

describe("actionChangelog", () => {
  it("ignores unchanged field values", () => {
    const project = makeProject();

    recordFieldChange(project, "personal", "Bulbasaur", "base hp", 45, "45");

    expect(ensureActionChangelog(project).entries).toHaveLength(0);
  });

  it("coalesces repeated field edits while preserving the first before and latest after", () => {
    const project = makeProject();

    recordFieldChange(project, "personal", "Bulbasaur", "base hp", 45, 50, { key: "pokemon:1:base_hp" });
    recordFieldChange(project, "personal", "Bulbasaur", "base hp", 50, 60, { key: "pokemon:1:base_hp" });

    const entries = ensureActionChangelog(project).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      before: "45",
      after: "60",
      text: "Bulbasaur base hp changed from 45 to 60.",
    });
  });

  it("removes a coalesced field entry when the value returns to its original state", () => {
    const project = makeProject();

    recordFieldChange(project, "moves", "Tackle", "power", 40, 50, { key: "move:1:power" });
    recordFieldChange(project, "moves", "Tackle", "power", 50, 40, { key: "move:1:power" });

    expect(ensureActionChangelog(project).entries).toHaveLength(0);
  });

  it("records generic asset changes without retaining bytes", () => {
    const project = makeProject();
    const bytes = Uint8Array.of(1, 2, 3);

    recordGenericChange(project, "pokemon_sprites", "Pokemon sprite file 25 changed.", "Bulbasaur", { key: "asset:25" });

    const entry = ensureActionChangelog(project).entries[0];
    expect(entry.text).toBe("Pokemon sprite file 25 changed.");
    expect(JSON.stringify(entry)).not.toContain(String(bytes));
  });

  it("resets for a new ROM session and renders grouped raw text", () => {
    const project = makeProject();
    recordFieldChange(project, "items", "Potion", "market value", 300, 500);
    resetActionChangelog(project, "2026-05-15T00:00:00.000Z");

    expect(ensureActionChangelog(project).entries).toHaveLength(0);
    expect(renderActionChangelogText(project)).toContain("Changelog: test.nds");
  });
});

function makeProject(): ProjectState {
  return {
    session: {
      romName: "test.nds",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}
