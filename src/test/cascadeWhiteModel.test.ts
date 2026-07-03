import { describe, expect, it } from "vitest";
import {
  CASCADE_WHITE_AI_DLL_PATH,
  cascadeWhitePersonalName,
  cascadeWhiteTrainerAbilityName,
  detectCascadeWhiteRom,
  trainerAbilitySlotMax,
} from "../pokeweb/cascadeWhiteModel";
import { CASCADE_WHITE_AI_ABILITY_ROW_COUNT, cascadeWhiteAiAbilitiesForSpecies } from "../pokeweb/cascadeWhiteAiAbilities";
import type { ProjectState } from "../pokeweb/projectStore";

describe("cascadeWhiteModel", () => {
  it("detects Cascade White from the AI changes DLL and exposes custom labels", () => {
    const project = makeProject();

    expect(detectCascadeWhiteRom(project)).toBe(false);
    expect(trainerAbilitySlotMax(project)).toBe(3);
    expect(cascadeWhitePersonalName(project, 652)).toBeUndefined();

    project.codeInjection = {
      modules: [{ path: CASCADE_WHITE_AI_DLL_PATH, target: "patches", fileName: "A2_AIChanges.dll" }],
    };

    expect(detectCascadeWhiteRom(project)).toBe(true);
    expect(trainerAbilitySlotMax(project)).toBe(6);
    expect(cascadeWhitePersonalName(project, 652)).toBe("Sawsbuck-Summer");
    expect(cascadeWhitePersonalName(project, 656)).toBe("Gastrodon-East");
    expect(cascadeWhiteTrainerAbilityName(project, 1, 4)).toBe("Drought");
    expect(cascadeWhiteTrainerAbilityName(project, 1, 6)).toBe("Flower Gift");
  });

  it("keeps the historical AI ability table available by species id", () => {
    expect(CASCADE_WHITE_AI_ABILITY_ROW_COUNT).toBe(651);
    expect(cascadeWhiteAiAbilitiesForSpecies(1)).toEqual(["Drought", "Chlorophyll", "Flower Gift"]);
    expect(cascadeWhiteAiAbilitiesForSpecies(2)).toEqual(["Drought", "Chlorophyll", "Flower Gift"]);
    expect(cascadeWhiteAiAbilitiesForSpecies(25)).toEqual(["Plus", "Minus", "Minus"]);
    expect(cascadeWhiteAiAbilitiesForSpecies(1025)).toEqual(["Drought", "Chlorophyll", "Flower Gift"]);
  });
});

function makeProject(): ProjectState {
  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 1 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}
