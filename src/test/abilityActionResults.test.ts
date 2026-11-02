import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ensureAbilityPresentationMessages } from "../pokeweb/abilityBattleMessages";
import { ABILITY_EFFECTS_DLL_PATH, buildAbilityRuleModule, CURRENT_ABILITY_RUNTIME_VERSION, inspectAbilityEffects } from "../pokeweb/abilityEffectsModel";
import { abilityImport } from "../pokeweb/abilityLibrary";
import { TYPES } from "../pokeweb/constants";
import { encodeGen5TextBank, decodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";
import { parseTextEntryId } from "../pokeweb/textModel";
import { writeRpm } from "../pokeweb/rpm";
import type { ProjectState } from "../pokeweb/projectStore";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";

describe("ability activation results", () => {
  it.each(["base", "status", "aura"])("recognizes retained v5 %s and rebuilds it without changing recipes or move flags", name => {
    const { project } = makeItemEffectsProject(0,0,true,true);
    const bytes = new Uint8Array(readFileSync(new URL(`./fixtures/ability-runtime-v5/${name}.dll`, import.meta.url)));
    project.fileSystem = { replacements: {}, additions: { [ABILITY_EFFECTS_DLL_PATH]: bytes } };
    const old = inspectAbilityEffects(project); expect(old.editable,old.message).toBe(true); expect(old.runtimeVersion).toBe(5);
    const module = buildAbilityRuleModule(project, old.rules);
    expect(module.metadata.PokewebAbilityActionResults).toBe(1);
    project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH] = writeRpm(module,{ident:"DLXF"});
    expect(inspectAbilityEffects(project)).toMatchObject({editable:true,runtimeVersion:CURRENT_ABILITY_RUNTIME_VERSION,rules:old.rules});
    expect(JSON.parse(String(module.metadata.PokewebMoveClassOverrides))).toContainEqual([33,34]);
    delete module.metadata.PokewebAbilityActionResults;
    project.fileSystem.additions![ABILITY_EFFECTS_DLL_PATH] = writeRpm(module,{ident:"DLXF"});
    expect(inspectAbilityEffects(project).editable).toBe(false);
  });
  it.each(["BW", "BW2"] as const)("encodes Fairy, Dark and edited aura labels without the native type formatter in %s", baseRom => {
    const bankId = baseRom === "BW" ? 14 : 18, entries: Gen5TextEntry[] = [["0_0", "Existing battle text.", 0]];
    const rawFiles: Uint8Array[] = [], banks: Gen5TextEntry[][] = []; rawFiles[bankId] = encodeGen5TextBank(entries); banks[bankId] = entries;
    const project = { session: { generation:"gen5", baseRom }, narcs: { message_texts: { name:"message_texts", fileId:1, fileCount:bankId+1, rawFiles, records:new Map(), dirty:new Set() } }, texts: { banks:{types:[...TYPES]}, messageTexts:banks }, formats:{} } as unknown as ProjectState;
    project.texts.banks.types![10] = "Tide";
    const rules = new Map([[165,abilityImport(187)!.rule],[166,abilityImport(186)!.rule],[167,{...abilityImport(186)!.rule,effects:[{kind:"abilityRecipe:fieldPower" as const,value:1.333333,parameters:{type:10}}]}]]);
    const ids = ensureAbilityPresentationMessages(project,rules)!;
    expect(ids).toHaveLength(33);
    const decoded = decodeGen5TextBank(rawFiles[bankId]), text = new Map(decoded.map(e=>[parseTextEntryId(e[0]).entry,e[1]]));
    expect(text.get(0)).toBe("Existing battle text.");
    for (const [type,name] of [[17,"Fairy"],[16,"Dark"],[10,"Tide"]] as const) for(let variant=0;variant<3;variant++) {
      expect(text.get(ids[15+type]+variant)).toContain(`an aura of ${name}!`);
      expect(text.get(ids[15+type]+variant)).not.toContain("VAR(259");
    }
    expect(ids[15+1]).toBe(0);
    const before=rawFiles[bankId].slice();
    expect(ensureAbilityPresentationMessages(project,rules)).toEqual(ids);
    expect(rawFiles[bankId]).toEqual(before);
  });
});
