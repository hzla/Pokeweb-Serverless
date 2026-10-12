import { describe, expect, it } from "vitest";
import { buildBw2ScriptSourceContext, bw2ScriptAssignedEntities, bw2ScriptMapChoices, bw2ScriptNpcCommandTarget } from "../pokeweb/bw2ScriptContextModel";
import { bw2ScriptCommandHelp } from "../pokeweb/bw2ScriptCommandHelp";
import type { ProjectState } from "../pokeweb/projectStore";
import type { OverworldScene } from "../pokeweb/overworldModel";

describe("script cursor ownership", () => {
  it("tracks shared helpers through nested calls and stops at definition boundaries", () => {
    const source = "script :one, entry: 1 do\nfirst\nend\n\nscript :two, entry: 2 do\nif true\nsecond\nend\nend\ndef first\nsecond\nend\ndef second\nnop\nend\n# outside";
    const context = buildBw2ScriptSourceContext(source);
    expect(context.focusAt(2)).toMatchObject({ name: "one", entries: [1] });
    expect(context.focusAt(11)).toMatchObject({ name: "first", entries: [1] });
    expect(context.focusAt(14)).toMatchObject({ name: "second", entries: [1, 2] });
    expect(context.focusAt(4)).toBeUndefined();
    expect(context.focusAt(16)).toBeUndefined();
  });
  it("tracks conditional calls, aliases, shared blocks, and inline label targets", () => {
    const source = "preserve_layout\nentry 2, :shared\nscript :one, entry: 1 do\ncall_if 1, :inside\nhalt\nend\nblock :shared do\nlabel :inside\ncall :last\nvm_return\nend\ndef last\nvm_return\nend";
    const context = buildBw2ScriptSourceContext(source);
    expect(context.focusAt(8)).toMatchObject({ name: "shared", entries: [1, 2] });
    expect(context.focusAt(13)).toMatchObject({ name: "last", entries: [1, 2] });
  });
  it("keeps current ownership while source has an unfinished argument", () => {
    const source = "script :one, entry: 1 do\nfirst\nend\ndef first\nif true\nactor_set_g_pos 0x\nend\nend";
    expect(buildBw2ScriptSourceContext(source).focusAt(6)).toMatchObject({ name: "first", entries: [1], endLine: 8 });
  });
  it("handles cyclic and uncalled helper graphs without inventing an owner", () => {
    const source = "preserve_layout\nscript :one, entry: 1 do\ncall :a\nhalt\nend\ndef a\ncall :b\nvm_return\nend\ndef b\ncall :a\nvm_return\nend\ndef uncalled\nvm_return\nend";
    const context = buildBw2ScriptSourceContext(source);
    expect(context.focusAt(11)?.entries).toEqual([1]);
    expect(context.focusAt(15)?.entries).toEqual([]);
  });
});

describe("map ownership and command help", () => {
  const scene = { npcs: [{ kind: "npc", index: 0, overworldId: 3 }, { kind: "npc", index: 1, overworldId: 9 }], furniture: [{ kind: "furniture", index: 0, script: 2 }], triggers: [{ kind: "trigger", index: 0, script: 3 }], raw: { npc_0_script_id: 1, npc_1_script_id: 10001 } } as unknown as OverworldScene;
  it("highlights NPCs, signs and triggers using entry IDs, excluding global scripts", () => {
    expect(bw2ScriptAssignedEntities(scene, [1, 2, 3])).toEqual([{ kind: "npc", index: 0 }, { kind: "furniture", index: 0 }, { kind: "trigger", index: 0 }]);
    expect(bw2ScriptAssignedEntities(scene, [6])).toEqual([]);
  });
  it("keeps command actor IDs separate from entry IDs and work operands", () => {
    const project = {} as ProjectState;
    expect(bw2ScriptNpcCommandTarget(project, "  actor_set_g_pos 0x0003, 42, 1, 751, 3", scene)).toEqual({ kind: "npc", index: 0 });
    expect(bw2ScriptNpcCommandTarget(project, "cmd_006d(3, 42, 1, 751, 3)", scene)).toEqual({ kind: "npc", index: 0 });
    expect(bw2ScriptNpcCommandTarget(project, "actor_set_g_pos 0x8000, 42, 1, 751, 3", scene)).toBeUndefined();
    expect(bw2ScriptNpcCommandTarget(project, "work_set 3, 2", scene)).toBeUndefined();
    expect(bw2ScriptNpcCommandTarget(project, "actor_new 3, 42, 1, 3, 1, 0", scene)).toBeUndefined();
  });
  it("finds every map header using the script rather than assuming one map", () => {
    const project = { headers: { count: 3, rows: { 1: { index: 0, script_id: 854, overworlds_id: 8, location_name: "Aspertia" }, 2: { index: 1, script_id: 854, overworlds_id: 9, location_name: "Other" }, 3: { index: 2, script_id: 0, overworlds_id: 10, location_name: "Elsewhere" } } } } as unknown as ProjectState;
    expect(bw2ScriptMapChoices(project, 854).map((choice) => [choice.headerRowId, choice.zoneId, choice.overworldId])).toEqual([[1, 0, 8], [2, 1, 9]]);
    expect(bw2ScriptMapChoices(project, 999)).toEqual([]);
  });
  it("documents position axes, actor IDs and directions without confusing Y with map Z", () => {
    const help = bw2ScriptCommandHelp("actor_set_g_pos")!;
    expect(help.opcode).toBe(0x6d);
    expect(help.parameters.map((parameter) => parameter.name)).toEqual(["actor", "x", "elevation", "z", "direction"]);
    expect(help.parameters[2].description).toContain("height");
    expect(help.parameters[4].description).toContain("3 = right");
    expect(bw2ScriptCommandHelp("cmd_006d")?.description).toBe(help.description);
  });
  it("documents stack booleans and the reversed sense of jump_if 0xff", () => {
    expect(bw2ScriptCommandHelp("stack_cmp")?.parameters[0].description).toContain("6 OR");
    expect(bw2ScriptCommandHelp("jump_if")?.parameters[0].description).toContain("jumps when it is false");
  });
  it("provides known byte layouts without inventing undocumented semantic names", () => {
    expect(bw2ScriptCommandHelp("cmd_03e8", 51)?.parameters).toHaveLength(1);
    expect(bw2ScriptCommandHelp("cmd_03e8")).toBeUndefined();
    expect(bw2ScriptCommandHelp("unknown")).toBeUndefined();
  });
});
