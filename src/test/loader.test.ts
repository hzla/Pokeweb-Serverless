import { describe, expect, it } from "vitest";
import { refreshDecodedTextState } from "../pokeweb/loader";
import type { ProjectState } from "../pokeweb/projectStore";
import { encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";

describe("loader text labels", () => {
  it("fills expanded BW2 ability names from the normal-case ability bank", () => {
    const rawFiles: Uint8Array[] = Array.from({ length: 488 }, () => new Uint8Array());
    rawFiles[487] = encodeGen5TextBank(makeBank(165, { 1: "STENCH" }));
    rawFiles[374] = encodeGen5TextBank(makeBank(233, { 1: "Stench", 229: "Grassy Surge" }));
    const project = {
      session: { generation: 5, baseVersion: "W2", baseRom: "BW2" },
      narcs: { message_texts: { rawFiles } },
      texts: { banks: {} },
    } as unknown as ProjectState;

    refreshDecodedTextState(project);

    expect(project.texts.banks.abilities?.[1]).toBe("STENCH");
    expect(project.texts.banks.abilities?.[229]).toBe("Grassy Surge");
  });
});

function makeBank(count: number, overrides: Record<number, string>): Gen5TextEntry[] {
  return Array.from({ length: count }, (_value, index) => [
    `0_${index}`,
    overrides[index] ?? `Ability ${index}`,
    0,
  ]);
}
