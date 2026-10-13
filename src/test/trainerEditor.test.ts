import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTrainerRecord, type TrainerRecord } from "../pokeweb/trainerModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { getTrainerTestBattleTeamText, renderTrainerPanel, renderTrainerRow } from "../ui/trainerEditor";

vi.mock("../pokeweb/trainerModel", async (original) => ({
  ...await original<typeof import("../pokeweb/trainerModel")>(),
  getTrainerRecord: vi.fn(),
}));
vi.mock("../pokeweb/romPatchModel", async (original) => ({
  ...await original<typeof import("../pokeweb/romPatchModel")>(),
  detectSpecifyTrainerNaturesPatch: () => "patched",
}));

const project = { session: { baseRom: "BW2", baseVersion: "W2" }, narcs: {}, overlays: {}, arm9: new Uint8Array() } as unknown as ProjectState;
let trainer: TrainerRecord;
beforeEach(() => {
  trainer = {
    id: 1, raw: { class: 2 }, readable: { name: "Test <Trainer>", class: "Leader", class_id: 2, battle_type_1: "Singles", item_1: "Potion" },
    hasMoves: true, hasItems: true, spritePath: "unused.png",
    party: [0, 1].map((slot) => ({
      slot, speciesId: slot + 1, speciesName: slot ? "Ivysaur" : "Bulbasaur", spriteSlug: slot ? "ivysaur" : "bulbasaur",
      level: 12, ivs: 50, abilitySlot: 1, resolvedAbilitySlot: 1, abilityName: "Overgrow", gender: "Default", form: 0,
      moves: ["Tackle"], nature: "Hardy", natureSetting: "Auto", natureValue: 0,
    })),
    texts: [{ label: "Intro", typeId: 0, entryIndex: 0, bankIndex: 10, exists: true, value: "Let's battle!" }],
  };
  vi.mocked(getTrainerRecord).mockReset().mockImplementation(() => trainer);
});

describe("lazy trainer editors", () => {
  it("renders only summary fields and party previews on initial load", () => {
    const row = renderTrainerRow(project, 1);
    expect(getTrainerRecord).toHaveBeenCalledWith(project, 1, { includeTexts: false });
    expect(row).toContain("Test &lt;Trainer&gt;");
    expect(row).toContain('data-show="pok-0"');
    expect(row).toContain('data-show="pok-1"');
    expect(row).not.toContain("expanded-card-content");
    expect(row).not.toContain("expanded-card-subcontent");
    expect(row).not.toContain('data-narc="trpok" data-field-name=');
    expect(row).not.toContain("Let's battle!");
  });

  it("loads trainer settings and dialogue only when that panel is requested", () => {
    const panel = renderTrainerPanel(project, 1, "trainer");
    expect(getTrainerRecord).toHaveBeenCalledWith(project, 1, { includeTexts: true });
    expect(panel).toContain("trainer-ai");
    expect(panel).toContain('data-field-name="item_1"');
    expect(panel).toContain('data-field-name="text_0_entry_0"');
    expect(panel).not.toContain("expanded-pok");
  });

  it("renders only the requested Pokemon with current values and nature controls", () => {
    trainer.party[1].level = 42;
    const panel = renderTrainerPanel(project, 1, 1);
    expect(getTrainerRecord).toHaveBeenCalledWith(project, 1, { includeTexts: false });
    expect(panel).toContain('data-sub-index="1"');
    expect(panel).toContain('data-field-name="level_1"');
    expect(panel).toContain('>42</div>');
    expect(panel).toContain('data-field-name="nature_1"');
    expect(panel).not.toContain('data-sub-index="0"');
    expect(panel).not.toContain("trainer-ai");
    expect(panel).not.toContain("trainer-texts");
  });

  it("does not recreate deleted party slots", () => {
    trainer.party.pop();
    expect(renderTrainerPanel(project, 1, 1)).toBe("");
  });

  it("keeps fallback image URLs dormant until their cells approach the viewport", () => {
    const images = renderTrainerRow(project, 1).match(/<img\b[^>]*>/gu)!;
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image).toContain("data-trainer-image-src=");
      expect(image).toContain('loading="lazy"');
      expect(image).toContain('decoding="async"');
      expect(image).not.toMatch(/\ssrc=/u);
    }
  });
});

describe("quick-launch test team selection", () => {
  afterEach(() => vi.unstubAllGlobals());
  const teamProject = { session: { baseVersion: "W2", romName: "custom-white-2" } } as ProjectState;

  it("uses the current textarea, including edits not yet stored and an explicitly empty value", () => {
    const getItem = vi.fn(() => "old team");
    vi.stubGlobal("localStorage", { getItem });
    for (const value of ["Dewott\nLevel: 35", ""]) {
      const root = { querySelector: () => ({ value }) } as unknown as ParentNode;
      expect(getTrainerTestBattleTeamText(teamProject, root)).toBe(value);
    }
    expect(getItem).not.toHaveBeenCalled();
  });

  it("uses the same ROM's saved team after navigating away from Trainers", () => {
    const getItem = vi.fn((key: string) => key === "pokeweb.testBattle.teamText.W2.custom-white-2" ? "Dewott" : null);
    vi.stubGlobal("localStorage", { getItem });
    const root = { querySelector: () => null } as unknown as ParentNode;
    expect(getTrainerTestBattleTeamText(teamProject, root)).toBe("Dewott");
    expect(getTrainerTestBattleTeamText({ session: { baseVersion: "B2", romName: "another-rom" } } as ProjectState, root)).toBe("");
  });

  it("allows quick launch when browser storage is unavailable", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("Storage unavailable"); } });
    expect(getTrainerTestBattleTeamText(teamProject)).toBe("");
  });
});
