import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MOVE_DLL_FLAGS, defaultMoveDllFlags, encodeMoveClassOverrides, moveDllFlags, validateMoveClassOverrides, expandedMoveDllDefaults } from "../pokeweb/abilityMoveClasses";
import { CURRENT_ABILITY_RUNTIME_VERSION, ABILITY_EFFECTS_DLL_PATH, buildAbilityRuleModule, inspectAbilityEffects, inspectMoveDllFlags } from "../pokeweb/abilityEffectsModel";
import { abilityImport } from "../pokeweb/abilityLibrary";
import { encodeGen5TextBank } from "../pokeweb/text";
import { readU16 } from "../nds/binary";
import { writeRpm } from "../pokeweb/rpm";
import type { ProjectState } from "../pokeweb/projectStore";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";
import { makeBw1AbilityProject } from "./fixtures/blackAbilityProject";
import { renderMoveDllFlags } from "../ui/moveDllFlagsEditor";
import { renderAbilityRuntimeUpdate } from "../ui/abilityRuntimeUpdate";

function fixture(game: "B" | "W" | "W2") {
  const project = game === "W2" ? makeItemEffectsProject(0, 0, true, true).project : makeBw1AbilityProject(game).project;
  project.narcs.moves = { name: "moves", fileId: 0, sourcePath: "a/0/2/1", fileCount: 1200, rawFiles: [], records: new Map(), dirty: new Set() };
  return project;
}
const overrides = new Map([[33, 34], [352, 0], [999, 127]]);
describe("DLL move classifications", () => {
  it.each(["base", "recipes", "scoped"])("reopens version 3 %s and preserves classifications in its current replacement", name => {
    const project=fixture("W2"),old=new Uint8Array(readFileSync(new URL(`./fixtures/ability-runtime-v3/${name}.dll`,import.meta.url)));
    project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:old}};
    const state=inspectAbilityEffects(project);expect(state.editable,state.message).toBe(true);expect(state.runtimeVersion).toBe(3);
    expect(renderAbilityRuntimeUpdate(project)).not.toContain('data-update-ability-runtime disabled');
    const next=buildAbilityRuleModule(project,state.rules);project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(next,{ident:"DLXF"});
    expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:CURRENT_ABILITY_RUNTIME_VERSION,rules:state.rules});
    expect(inspectMoveDllFlags(project,33)).toMatchObject({editable:true,flags:34,customized:true});
  });
  it("keeps stock defaults, explicit clears and expanded IDs separate", () => {
    expect(defaultMoveDllFlags(352) & 2).toBe(2); expect(defaultMoveDllFlags(16) & 32).toBe(32);
    expect(defaultMoveDllFlags(999)).toBe(0); expect(moveDllFlags(overrides, 352)).toBe(0);
    expect(moveDllFlags(overrides, 33)).toBe(34); expect(moveDllFlags(overrides, 999)).toBe(127);
    expect(moveDllFlags(overrides, 16)).toBe(defaultMoveDllFlags(16));
    const bytes = encodeMoveClassOverrides(new Map([...overrides].reverse()));
    expect(readU16(bytes, 0)).toBe(3); expect(Array.from({ length: 6 }, (_, i) => readU16(bytes, 2 + i * 2))).toEqual([33, 34, 352, 0, 999, 127]);
    for (const bad of [[[33, 128]], [[65536, 1]], [[-1, 1]], [[33, .5]], [[33, 0]], [[33, 1], [33, 2]]]) expect(() => validateMoveClassOverrides(bad)).toThrow();
  });
  it.each(["B", "W", "W2"] as const)("stores flags before any ability recipes in %s and retains them when recipes are added", game => {
    const project = fixture(game), before = project.overlays[game === "W2" ? 167 : 93]!.slice();
    const module = buildAbilityRuleModule(project, new Map(), overrides);
    expect(module.metadata.PokewebAbilityRules).toBe("[]");
    expect(module.relocations.some(r => r.target.module !== "base")).toBe(false);
    project.fileSystem = { replacements: {}, additions: { [ABILITY_EFFECTS_DLL_PATH]: writeRpm(module, { ident: "DLXF" }) } };
    expect(inspectAbilityEffects(project)).toMatchObject({ editable: true, runtimeVersion: CURRENT_ABILITY_RUNTIME_VERSION });
    expect(inspectMoveDllFlags(project, 352)).toMatchObject({ flags: 0, customized: true, editable: true });
    const next = buildAbilityRuleModule(project, new Map([[165, abilityImport(274).rule], [166, abilityImport(178).rule]]));
    expect(JSON.parse(String(next.metadata.PokewebMoveClassOverrides))).toEqual([...overrides]);
    project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH] = writeRpm(next, { ident: "DLXF" });
    expect(inspectAbilityEffects(project).rules.size).toBe(2);
    expect(inspectMoveDllFlags(project, 999)).toMatchObject({ flags: 127, editable: true });
    expect(project.overlays[game === "W2" ? 167 : 93]).toEqual(before); expect(project.narcs.moves!.dirty.size).toBe(0);
  });
  it("maps populated expansion records, preserves explicit clears and survives renamed moves", () => {
    const project=fixture("B"), id=875;
    project.texts.banks.moves=Array(1200).fill("Pound");
    project.texts.banks.moves[id]="Pollen Puff";
    expect(expandedMoveDllDefaults(project).size).toBe(0);
    project.patches={dirtyOverlayIds:[],applied:{moveExpansion:true}};
    expect(expandedMoveDllDefaults(project).get(id)).toBe(4);
    expect(expandedMoveDllDefaults(project).size).toBe(1);
    const module=buildAbilityRuleModule(project,new Map([[165,abilityImport(171).rule]]));
    project.fileSystem={replacements:{},additions:{[ABILITY_EFFECTS_DLL_PATH]:writeRpm(module,{ident:"DLXF"})}};
    expect(inspectMoveDllFlags(project,id)).toMatchObject({editable:true,flags:4,customized:false});
    project.texts.banks.moves[id]="Renamed ball";
    expect(inspectAbilityEffects(project).editable).toBe(true);
    expect(inspectMoveDllFlags(project,id).flags).toBe(4);
    const next=buildAbilityRuleModule(project,inspectAbilityEffects(project).rules,new Map([[id,0]]));
    project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH]=writeRpm(next,{ident:"DLXF"});
    expect(inspectMoveDllFlags(project,id)).toMatchObject({editable:true,flags:0,customized:true});
    expect(JSON.parse(String(next.metadata.PokewebMoveClassOverrides))).toEqual([[id,0]]);
    expect(JSON.parse(String(next.metadata.PokewebMoveClassDefaults))).toEqual([[id,4]]);
  });
  it("reads expanded BW battle names when the uppercase list is still vanilla length", () => {
    const project=fixture("B");
    project.patches={dirtyOverlayIds:[],applied:{moveExpansion:true}};
    project.texts.banks.moves=Array(560).fill("Pound");
    const bank=Array.from({length:900},(_,id)=>[`0_${id}`,id===875?"Pollen Puff":id===876?"BleakwindStorm":"Pound",0] as [string,string,number]);
    project.narcs.message_texts={name:"message_texts",fileId:1,sourcePath:"a/0/0/2",fileCount:204,rawFiles:Array.from({length:204},()=>new Uint8Array()),records:new Map(),dirty:new Set()};
    project.narcs.message_texts.rawFiles[203]=encodeGen5TextBank(bank);
    if(project.texts.messageTexts) delete project.texts.messageTexts[203];
    expect([...expandedMoveDllDefaults(project)]).toEqual([[875,4],[876,32]]);
    expect(project.texts.banks.moves.length).toBe(560);
  });
  it("rejects unrecognized runtime edits before exposing saved classifications", () => {
    const project = fixture("W2"), module = buildAbilityRuleModule(project, new Map([[165, abilityImport(274).rule]]), overrides);
    module.code[0] ^= 1;
    project.fileSystem = { replacements: {}, additions: { [ABILITY_EFFECTS_DLL_PATH]: writeRpm(module, { ident: "DLXF" }) } };
    expect(inspectMoveDllFlags(project, 33).editable).toBe(false);
    expect(inspectMoveDllFlags(project, 1200).editable).toBe(false);
  });
  it("renders a separate labeled row without treating these as vanilla properties", () => {
    const html = renderMoveDllFlags(fixture("W2"), 352);
    expect(html).toContain('aria-label="Expanded Flags"');
    for (const flag of MOVE_DLL_FLAGS) expect(html).toContain(`aria-label="Expanded ${flag.label}"`);
    expect(html).not.toContain("move-prop"); expect(html).not.toContain("data-field-name");
    expect(renderAbilityRuntimeUpdate(fixture("W2"))).toContain('data-update-ability-runtime disabled');
  });
});
