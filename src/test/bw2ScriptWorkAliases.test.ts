import { describe, expect, it } from "vitest";
import { BW2_WORK_ALIASES, bw2WorkAlias } from "../pokeweb/bw2ScriptCompiler";
import { BW2_WORK_OPERANDS } from "../pokeweb/bw2ScriptCompiler/workAliases";
import { bw2CommandByOpcode } from "../pokeweb/bw2ScriptCompiler/commands";

describe("BW2 descriptive work catalog", () => {
  it("keeps unique, legal aliases and IDs, excluding boundary markers", () => {
    expect(BW2_WORK_ALIASES).toHaveLength(420);
    expect(new Set(BW2_WORK_ALIASES.map((work) => work.id)).size).toBe(420);
    expect(new Set(BW2_WORK_ALIASES.map((work) => work.name)).size).toBe(420);
    for (const work of BW2_WORK_ALIASES) {
      expect(work.name).toMatch(/^[a-z_][a-z_0-9]*$/);
      expect(work.id).toBeGreaterThanOrEqual(0x4000);
      expect(work.id).toBeLessThanOrEqual(0xffff);
      expect(work.description.length).toBeGreaterThan(20);
      expect(work.name).not.toMatch(/area_start|area_end|total_min|total_max/);
      expect(work.name).not.toMatch(/_flag$/);
    }
  });
  it("distinguishes Aspertia story state, map-local slots, and reused temporary slots", () => {
    expect(bw2WorkAlias(0x40a1)).toMatchObject({ name: "bianca_intro_progress", scope: "saved" });
    expect(bw2WorkAlias(0x40a1).description).toContain("not a Boolean");
    expect(bw2WorkAlias(0x4115).name).toBe("lake_guardians_cave_of_being_event_progress");
    expect(bw2WorkAlias(0x4000).scope).toBe("map-local");
    expect(bw2WorkAlias(0x8020)).toMatchObject({ name: "event_temp_0", scope: "temporary" });
    expect(bw2WorkAlias(0x8010).description).toContain("callee");
    expect(bw2WorkAlias(0x7777)).toMatchObject({ name: "work_7777", scope: "unknown" });
  });
  it("allows work aliases only at known 16-bit non-relative operand positions", () => {
    for (const [id, indices] of Object.entries(BW2_WORK_OPERANDS)) {
      const command = bw2CommandByOpcode(Number(id))!;
      expect(command).toBeDefined();
      for (const index of indices) {
        expect(command.definition.widths[index]).toBe(2);
        expect(command.definition.relative?.[index]).toBeUndefined();
      }
    }
    expect(BW2_WORK_OPERANDS[8]).toBeUndefined();
    expect(BW2_WORK_OPERANDS[0x28]).toEqual([0]);
  });
});
