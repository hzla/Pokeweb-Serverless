import { describe, expect, it } from "vitest";
import selection from "../assets/data/moveHistorySelectBindings.json";
import callers from "../assets/data/itemSelectionCallBindings.json";
import { writeU16 } from "../nds/binary";
import { buildItemRuleModule, inspectItemEffect, ITEM_EFFECTS_DLL_PATH } from "../pokeweb/itemEffectsModel";
import { itemRulePreset } from "../pokeweb/itemRulePresets";
import { writeRpm } from "../pokeweb/rpm";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";

describe("item move-selection hook", () => {
  it("links the five verified callers and rejects changed call sites", () => {
    const { project } = makeItemEffectsProject(0, 0, true);
    const overlay=new Uint8Array(0x20000), entry=0x1d000; overlay.set(project.overlays[167]!); project.overlays[167]=overlay;
    const bytes=(hex:string)=>Uint8Array.from(hex.match(/../gu)!,v=>parseInt(v,16));
    overlay.set(bytes(selection.IRDO.hex),entry);
    const siteOffsets=[0x1c000,0x1c100,0x1c200,entry+0x2a4,0x1e000];
    const sites=callers.IRDO.map((profile,n)=>{
      const at=siteOffsets[n];overlay.set(bytes(profile.hex),at-12);
      const delta=entry-(at+4);writeU16(overlay,at,0xf000|((delta>>12)&0x7ff));writeU16(overlay,at+2,0xf800|((delta>>1)&0x7ff));return at;
    });
    const many=new Map(Array.from({length:100},(_,index)=>[index+1,itemRulePreset(10012)]));
    const shared=buildItemRuleModule(project,many);
    expect(shared.code.length+shared.bssSize).toBeLessThan(65536);
    expect(shared.relocations.filter(r=>r.target.type==="THUMB_BRANCH_LINK"&&shared.symbols[r.sourceSymbolIndex]?.name==="RuleItemSelect")).toHaveLength(5);
    const rules=new Map([[85,itemRulePreset(10012)]]),dll=buildItemRuleModule(project,rules);
    expect(dll.metadata.PMCVersion).toBe("7.0.0");
    const hooks=dll.relocations.filter(r=>r.target.module==="167"&&r.target.type==="THUMB_BRANCH_LINK"&&dll.symbols[r.sourceSymbolIndex]?.name==="RuleItemSelect");
    expect(hooks).toHaveLength(5);
    project.fileSystem={replacements:{},additions:{[ITEM_EFFECTS_DLL_PATH]:writeRpm(dll,{ident:"DLXF"})}};
    expect(inspectItemEffect(project,85).rules).toEqual(rules.get(85));
    overlay[sites[0]-2]^=1;
    expect(inspectItemEffect(project,85).editable).toBe(false);
  });
});
