import { describe,expect,it } from "vitest";
import { readFileSync } from "node:fs";
import { NARC } from "../nds/narc";
import { parseRpm } from "../pokeweb/rpm";
import { nuzlockeEncountersArchive,readNuzlockeEncountersArchive,isNuzlockeEncountersModule,NUZLOCKE_ENCOUNTERS_VERSION } from "../pokeweb/nuzlockeEncountersModel";
import manifest from "../assets/codeinjection/nuzlockeEncountersManifest.json";
describe("Nuzlocke Style Encounters",()=>{
  it("prevents encounters for all-dupe methods by default",()=>{
    expect(readNuzlockeEncountersArchive(nuzlockeEncountersArchive(true)).allowExhausted).toBe(false);
  });
  it("preserves enabled/all-dupe settings in its independently versioned archive",()=>{
    for(const enabled of [false,true])for(const allowExhausted of [false,true])
      expect(readNuzlockeEncountersArchive(nuzlockeEncountersArchive(enabled,allowExhausted))).toEqual({enabled,allowExhausted,version:NUZLOCKE_ENCOUNTERS_VERSION});
  });
  it("rejects malformed configuration rather than silently enabling a filter",()=>{
    for(const at of [0,4,6,8,12,16]){const arc=new NARC(nuzlockeEncountersArchive(true));arc.files[0][at]^=4;expect(()=>readNuzlockeEncountersArchive(arc.save())).toThrow();}
  });
  for(const game of ["B2","W2"] as const){
    it(`${game}: binds only the native table-selection sites and has no dynamic companion imports`,()=>{
      const bytes=new Uint8Array(readFileSync(new URL(`../assets/codeinjection/NuzlockeStyleEncounters${game}.dll`,import.meta.url))),rpm=parseRpm(bytes,{allowedMagics:["DLXF"]});
      expect(isNuzlockeEncountersModule(rpm,game)).toBe(true);expect(isNuzlockeEncountersModule(rpm,game==="B2"?"W2":"B2")).toBe(false);
      expect(rpm.relocations.filter(r=>r.target.module!=="base")).toHaveLength(6);
      expect(new Set(rpm.relocations.filter(r=>r.target.module!=="base").map(r=>r.target.module))).toEqual(new Set(["36"]));
      expect(rpm.symbols.some(s=>s.attributes&2)).toBe(false);expect(rpm.bssSize).toBeLessThanOrEqual(9000);
      rpm.code[0]^=1;expect(isNuzlockeEncountersModule(rpm,game)).toBe(false);
    });
    it(`${game}: verifies the native fishing and Surf distributions separately`,()=>{
      const weights=manifest.games[game].signatures.filter(s=>s.label==="Native slot weights");
      expect(weights).toHaveLength(3);
      expect(weights[1].expectedHex.slice(0,10)).toBe("3c1e050401");
      expect(weights[2].expectedHex.slice(0,10)).toBe("28280f0401");
    });
  }
});
