import { describe, expect, it } from "vitest";
import type { ProjectState } from "../pokeweb/projectStore";
import { decodeGen5TextBank, encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";
import { displayAbilityName, getAbilityDescription, getAbilitySummaryName, updateAbilityDescription } from "../pokeweb/abilityTextModel";

function fixture(version: "B" | "W" | "B2" | "W2") {
  const bw = version === "B" || version === "W", id = bw ? 183 : 375;
  const entries: Gen5TextEntry[] = [["0_0", "", 0], ["0_1F", "Original\\ndescription.", 0], ["0_2", "Unrelated.", 0]];
  const files: Uint8Array[] = [], banks: Gen5TextEntry[][] = [];
  files[id] = encodeGen5TextBank(entries); banks[id] = decodeGen5TextBank(files[id]);
  const project = { session: { generation: "gen5", baseRom: bw ? "BW" : "BW2", baseVersion: version }, narcs: { message_texts: { name: "message_texts", fileId: 1, fileCount: id + 1, rawFiles: files, records: new Map(), dirty: new Set() } }, texts: { banks: { abilities: ["", "Stench"] }, messageTexts: banks }, formats: {} } as unknown as ProjectState;
  return { project, id };
}
describe("ability descriptions", () => {
  it("title-cases vanilla editor labels without changing custom capitalization",()=>{
    expect(displayAbilityName(3,"SPEED BOOST")).toBe("Speed Boost");
    expect(displayAbilityName(3,"QUICKEN")).toBe("QUICKEN");
    expect(displayAbilityName(165,"SPEED BOOST")).toBe("SPEED BOOST");
    expect(displayAbilityName(3,"Speed BOOST")).toBe("Speed BOOST");
  });
  it("uses the Summary name rather than the uppercase battle label in previews", () => {
    const { project } = fixture("B2");
    project.texts.banks.abilities![1] = "STENCH";
    project.texts.messageTexts![374] = [["0_0", "", 0], ["0_1", "Stench", 0]];
    expect(getAbilitySummaryName(project, 1)).toBe("Stench");
  });
  it.each(["B", "W", "B2", "W2"] as const)("edits and re-encodes the correct description bank in %s", version => {
    const { project, id } = fixture(version);
    expect(getAbilityDescription(project, 1)).toBe("Original\\ndescription.");
    updateAbilityDescription(project, 1, "Pokémon gain power.\r\nWhen it rains.");
    const decoded = decodeGen5TextBank(project.narcs.message_texts!.rawFiles[id]);
    expect(decoded[1].slice(0, 2)).toEqual(["0_1F", "Pokémon gain power.\\nWhen it rains."]);
    expect(decoded[2][1]).toBe("Unrelated.");
    expect(project.texts.banks.abilities![1]).toBe("Stench");
    expect([...project.narcs.message_texts!.dirty]).toEqual([id]);
  });
  it("preflights invalid controls and missing entries without dirtying or changing text", () => {
    const { project } = fixture("B2");
    expect(() => updateAbilityDescription(project, 1, "VAR(")).toThrow();
    expect(() => updateAbilityDescription(project, 200, "Missing")).toThrow();
    expect(getAbilityDescription(project, 1)).toBe("Original\\ndescription.");
    expect(project.narcs.message_texts!.dirty.size).toBe(0);
  });
  it("allows an empty description and avoids rewriting unchanged text", () => {
    const { project } = fixture("B");
    updateAbilityDescription(project, 1, getAbilityDescription(project, 1));
    expect(project.narcs.message_texts!.dirty.size).toBe(0);
    updateAbilityDescription(project, 1, ""); expect(getAbilityDescription(project, 1)).toBe("");
  });
});
