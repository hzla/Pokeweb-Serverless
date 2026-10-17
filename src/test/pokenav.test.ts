import { describe, expect, it } from "vitest";
import { pokenavArchive, readPokenavArchive, POKENAV_VERSION } from "../pokeweb/pokenavModel";
import { actionsFor, defaults, newButton } from "../cgearButtons/document";
import { compile } from "../cgearButtons/compiler";
import { recoverCGearButtons } from "../pokeweb/cgearButtonsModel";
import { buttonTestAssets } from "./cgearButtonsFixture";
import { NARC } from "../nds/narc";

describe("Pokenav installation configuration", () => {
  it("round trips enabled and disabled states", () => {
    for (const enabled of [true, false]) expect(readPokenavArchive(pokenavArchive(enabled))).toEqual({ enabled, version: POKENAV_VERSION });
  });
  it("rejects corrupt flags, ABI versions, and metadata", () => {
    for (const offset of [0, 4, 6, 8, 12]) {
      const arc = new NARC(pokenavArchive(true)); arc.files[0][offset] ^= 2;
      expect(() => readPokenavArchive(arc.save())).toThrow(/Pokenav/);
    }
    const arc = new NARC(pokenavArchive(true)); arc.files[1] = new TextEncoder().encode('{}');
    expect(() => readPokenavArchive(arc.save())).toThrow(/metadata/);
  });
  it("offers action 18 only in BW2 and preserves editable button metadata", () => {
    expect(actionsFor().find(a => a.id === "pokenav")).toMatchObject({ code: 18, label: "NAV", item: 0 });
    expect(actionsFor("BW").some(a => a.id === "pokenav")).toBe(false);
    const document = defaults(); const button = newButton(document, "pokenav"); document.buttons.push(button);
    const result = compile(document, buttonTestAssets(), true, { document, applied: document, enabled: true });
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(recoverCGearButtons(result.archive!).document.buttons.at(-1)).toEqual(button);
  });
});
