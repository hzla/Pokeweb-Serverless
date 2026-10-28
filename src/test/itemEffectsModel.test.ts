import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { assignItemEffect, buildItemTypeHealingModule, configureItemTypeHealingBatch, hydrateItemEffectsSource, inspectItemEffect, ITEM_EFFECTS_DLL_PATH, updateItemEffectControl } from "../pokeweb/itemEffectsModel";
import profiles from "../assets/data/itemEffectProfiles.json";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { createProjectDocument } from "../pokeweb/projectDocument";
import { openProjectSession } from "../pokeweb/projectSession";
import { parseRpm, updateRpmCodeImageForBase, writeRpm } from "../pokeweb/rpm";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";

describe("native BW2 held effects", () => {
  it.each([[0, 0], [0x18c0, 0], [0x2200, 0], [0, 0x1400], [0x1200, 0x2800]])("discovers the real table and callbacks after placement %i and relocation %i", (shift, relocation) => {
    const { project, base } = makeItemEffectsProject(shift, relocation);
    expect(inspectItemEffect(project, 234)).toMatchObject({ editable: true, profileId: 234, controls: [{ key: "healingDivisor", value: 16 }] });
    expect(inspectItemEffect(project, 220)).toMatchObject({ editable: true, profileId: 220, controls: [{ key: "multiplier", value: 1.5 }] });
    expect(inspectItemEffect(project, 238)).toMatchObject({ editable: true, profileId: 238, controls: [{ key: "parameter", value: 20 }] });
    expect(inspectItemEffect(project, 234).address! > base).toBe(true);
  });

  it("rewrites the actual assignment pointer and retains donor discovery after every holder is reassigned", () => {
    const { project, table } = makeItemEffectsProject();
    const original = project.overlays[167]!.slice(), source = inspectItemEffect(project, 234).address!;
    assignItemEffect(project, 238, 234);
    expect(inspectItemEffect(project, 238)).toMatchObject({ editable: true, profileId: 234, address: source });
    expect([...project.overlays[167]!].filter((b, i) => b !== original[i]).length).toBeLessThanOrEqual(4);
    assignItemEffect(project, 234, 220);
    assignItemEffect(project, 238, 238);
    expect(inspectItemEffect(project, 238).profileId).toBe(238);
    expect(project.patches?.dirtyOverlayIds).toEqual([167]);
    expect(table).toBeGreaterThan(0);
  });

  it("edits only the recognized heal and multiplier operands, preserving choice-lock callbacks", () => {
    const { project, offsets } = makeItemEffectsProject();
    const events = inspectItemEffect(project, 220).events;
    updateItemEffectControl(project, 234, "healingDivisor", 8);
    updateItemEffectControl(project, 220, "multiplier", 1.75);
    expect(project.overlays[167]![offsets.get("HandlerLeftoversUse")! + 0x34]).toBe(8);
    expect(inspectItemEffect(project, 220).controls[0].value).toBe(1.75);
    expect(inspectItemEffect(project, 220).events).toEqual(events);
    expect(() => updateItemEffectControl(project, 234, "healingDivisor", 0)).toThrow();
    expect(() => updateItemEffectControl(project, 220, "multiplier", 1.3)).toThrow();
    expect(() => updateItemEffectControl(project, 238, "multiplier", 2)).toThrow();
  });

  it("reads the receiving item's parameter, rather than the donor item's parameter", () => {
    const { project } = makeItemEffectsProject();
    assignItemEffect(project, 234, 238);
    expect(inspectItemEffect(project, 234).controls[0].value).toBe(10);
    updateItemEffectControl(project, 234, "parameter", 40);
    expect(inspectItemEffect(project, 234).controls[0].value).toBe(40);
    expect(inspectItemEffect(project, 238).controls[0].value).toBe(20);
  });

  it("fails closed on a modified callback, broken dispatcher, duplicate table and conflicting DLL", () => {
    for (const change of ["callback", "service", "dispatcher", "duplicate", "dll"]) {
      const { project, offsets, table, base } = makeItemEffectsProject();
      const overlay = project.overlays[167]!.slice();
      if (change === "callback") overlay[offsets.get("HandlerLeftoversUse")! + 2] ^= 1;
      if (change === "service") overlay[offsets.get("DivideMaxHPZeroCheck")!] ^= 1;
      if (change === "dispatcher") writeU32(overlay, offsets.get("ItemEvent_AddItemCore")! + 0x58, 0);
      if (change === "duplicate") {
        const expanded = new Uint8Array(overlay.length + 0x1000); expanded.set(overlay); expanded.set(overlay.subarray(table, table + 172 * 8), overlay.length);
        project.overlays[167] = expanded;
      } else project.overlays[167] = overlay;
      if (change === "dll") project.fileSystem = { replacements: {}, additions: { "patches/Conflicting.dll": writeRpm({ code: new Uint8Array(4), bssSize: 0, baseAddress: 0, metadata: {}, symbols: [{ name: null, address: 0, size: 4, type: "SECTION", attributes: 0 }], relocations: [{ target: { module: "167", address: base + offsets.get("HandlerLeftoversUse")!, type: "FULL_COPY" }, sourceSymbolIndex: 0 }] }, { ident: "DLXF" }) } };
      expect(inspectItemEffect(project, 234).editable, change).toBe(false);
      const before = project.overlays[167]!.slice();
      expect(() => updateItemEffectControl(project, 234, "healingDivisor", 8)).toThrow();
      expect(project.overlays[167]).toEqual(before);
    }
  });

  it("rechecks native code after an in-place change by another editor", () => {
    const { project, offsets } = makeItemEffectsProject();
    expect(inspectItemEffect(project, 234).editable).toBe(true);
    project.overlays[167]![offsets.get("HandlerLeftoversUse")! + 2] ^= 1;
    expect(inspectItemEffect(project, 234).editable).toBe(false);
  });

  it("relocates a separate type-gated native callback without changing Black Sludge", () => {
    const { project, offsets, base } = makeItemEffectsProject(0x1800, 0x2400);
    const before = project.overlays[167]!.slice();
    const rpm = buildItemTypeHealingModule(project, 238, 5);
    expect(readU16(rpm.code, 20 + 0x2a)).toBe(0x1c39);
    expect(rpm.code[rpm.code.length - 640 + 238]).toBe(5);
    expect(readU16(rpm.code, 20 + 0x32)).toBe(0xd057);
    expect(rpm.relocations.filter(r => r.target.module === "167")).toHaveLength(1);
    expect(rpm.symbols.some(symbol => symbol.attributes === 4 && symbol.address === base + offsets.get("GetPokeType")!)).toBe(true);
    rpm.baseAddress = 0x022f0000; updateRpmCodeImageForBase(rpm);
    expect(readU32(rpm.code, 8)).toBe(0x022f002c);
    expect(readU32(rpm.code, 16)).toBe(0x022f0035);
    expect(project.overlays[167]).toEqual(before);
    expect(base + offsets.get("HandlerBlackSludge")!).toBeGreaterThan(0x02000000);
  });

  it("packs 100 independently configured items into one fixed-size native callback and type table", async () => {
    const { project } = makeItemEffectsProject();
    project.codeInjection = { pmc: { overlayId: 344, overlayBaseAddress: 0x022f0000, overlayPath: "overlay/overlay_0344.bin", symbolPath: "codeinjection/RPMSYM-PMC.rpm" } };
    const edits = profiles.rows.slice(0, 100).map((row, i) => ({ itemId: row.id, type: i % 18, divisor: i % 31 + 1 }));
    await configureItemTypeHealingBatch(project, edits);
    const files = Object.entries(project.fileSystem!.additions!).filter(([path]) => path.endsWith(".dll"));
    expect(files.map(([path]) => path)).toEqual([ITEM_EFFECTS_DLL_PATH]);
    const rpm = parseRpm(files[0][1], { allowedMagics: ["DLXF"] });
    expect(rpm.code.length).toBe(948);
    expect(rpm.bssSize).toBe(0);
    expect(rpm.relocations.filter(r => r.target.module === "167")).toHaveLength(100);
    for (const { itemId, type } of edits) expect(inspectItemEffect(project, itemId).typeHealing).toBe(type);
    const saved = openProjectSession(createProjectDocument(project, false));
    saved.originalRomBytes = project.originalRomBytes;
    hydrateItemEffectsSource(saved, new NintendoDSRom(saved.originalRomBytes!, { fileData: "view" }));
    const rom = new NintendoDSRom(await exportModifiedRom(saved, { forDsi: false }), { fileData: "view" });
    saved.originalRomBytes = rom.data;
    saved.overlays[167] = rom.loadArm9Overlays([167]).get(167)!.data;
    hydrateItemEffectsSource(saved, rom);
    for (const { itemId, type } of edits) expect(inspectItemEffect(saved, itemId).typeHealing).toBe(type);
    const retained = edits[99];
    assignItemEffect(saved, edits[0].itemId, 234);
    expect(inspectItemEffect(saved, edits[0].itemId).typeHealing).toBeUndefined();
    expect(inspectItemEffect(saved, retained.itemId).typeHealing).toBe(retained.type);
    expect(parseRpm(saved.fileSystem!.replacements![rom.fileId(ITEM_EFFECTS_DLL_PATH)], { allowedMagics: ["DLXF"] }).relocations.filter(r => r.target.module === "167")).toHaveLength(99);
  });

  it("rejects a malformed shared registry or a conflicting bulk edit before changing any item", async () => {
    const { project, table, base } = makeItemEffectsProject();
    project.codeInjection = { pmc: { overlayId: 344, overlayBaseAddress: 0x022f0000, overlayPath: "overlay/overlay_0344.bin", symbolPath: "codeinjection/RPMSYM-PMC.rpm" } };
    await configureItemTypeHealingBatch(project, [{ itemId: 238, type: 5, divisor: 16 }]);
    const bytes = project.fileSystem!.additions![ITEM_EFFECTS_DLL_PATH];
    const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    rpm.code[rpm.code.length - 640 + 238] ^= 1;
    project.fileSystem!.additions![ITEM_EFFECTS_DLL_PATH] = writeRpm(rpm, { ident: "DLXF" });
    expect(inspectItemEffect(project, 238).editable).toBe(false);
    project.fileSystem!.additions![ITEM_EFFECTS_DLL_PATH] = bytes;
    const conflict = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    conflict.relocations = [{ target: { module: "167", address: base + table + 4, type: "OFFSET" }, sourceSymbolIndex: 0 }];
    project.fileSystem!.additions!["patches/Other.dll"] = writeRpm(conflict, { ident: "DLXF" });
    const before = JSON.stringify(createProjectDocument(project, false));
    await expect(configureItemTypeHealingBatch(project, [{ itemId: profiles.rows[0].id, type: 1, divisor: 8 }, { itemId: 238, type: 5, divisor: 32 }])).rejects.toThrow("Conflicting");
    expect(JSON.stringify(createProjectDocument(project, false))).toBe(before);
    conflict.relocations[0].target.address = base + table + profiles.rows.findIndex(row => row.id === 238) * 8 + 4;
    project.fileSystem!.additions!["patches/Other.dll"] = writeRpm(conflict, { ident: "DLXF" });
    const retainedBefore = JSON.stringify(createProjectDocument(project, false));
    await expect(configureItemTypeHealingBatch(project, [{ itemId: 220, type: 1, divisor: 8 }])).rejects.toThrow("Conflicting");
    expect(JSON.stringify(createProjectDocument(project, false))).toBe(retainedBefore);
  });

  it("migrates previously exported per-item DLLs without leaving executable loader records", async () => {
    const { project, table, base } = makeItemEffectsProject();
    project.codeInjection = { pmc: { overlayId: 344, overlayBaseAddress: 0x022f0000, overlayPath: "overlay/overlay_0344.bin", symbolPath: "codeinjection/RPMSYM-PMC.rpm" } };
    project.fileSystem = { replacements: {}, additions: {} };
    // Reconstruct the original version-1 format as an independent saved-ROM fixture.
    for (const [id, type] of [[238, 5], [234, 10]]) {
      const rpm = buildItemTypeHealingModule(project, id, type), gate = 264;
      const matcher = rpm.relocations.find(r => r.target.module === "base" && r.target.address === gate + 0x1a)!.sourceSymbolIndex;
      rpm.code = rpm.code.slice(0, gate);
      writeU16(rpm.code, 20 + 0x2a, 0x2100 | type);
      rpm.relocations = rpm.relocations.filter(r => r.target.module === "base" ? r.target.address < gate
        : r.target.address === base + table + profiles.rows.findIndex(row => row.id === id) * 8 + 4);
      rpm.relocations.find(r => r.target.module === "base" && r.target.address === 20 + 0x2c)!.sourceSymbolIndex = matcher;
      rpm.symbols.splice(-2);
      rpm.metadata = { PMCGameID: "W2", PMCVersion: "1.0.0", PMCModulePriority: 4, PokewebItem: id, PokewebHealType: type };
      project.fileSystem.additions![`patches/ItemTypeHealing${id}.dll`] = writeRpm(rpm, { ident: "DLXF" });
    }
    const oldRom = new NintendoDSRom(await exportModifiedRom(project, { forDsi: false }), { fileData: "view" });
    project.originalRomBytes = oldRom.data;
    project.fileSystem = { replacements: {}, additions: {} };
    hydrateItemEffectsSource(project, oldRom);
    expect(inspectItemEffect(project, 238).typeHealing).toBe(5);
    await configureItemTypeHealingBatch(project, [{ itemId: 220, type: 1, divisor: 8 }]);
    for (const [id, type] of [[238, 5], [234, 10], [220, 1]]) expect(inspectItemEffect(project, id).typeHealing).toBe(type);
    const migrated = new NintendoDSRom(await exportModifiedRom(project, { forDsi: false }), { fileData: "view" });
    for (const id of [238, 234]) expect([...migrated.files[migrated.fileId(`patches/ItemTypeHealing${id}.dll`)]]).toEqual([0x50, 0x57, 0x49, 0x52]);
    expect(parseRpm(migrated.files[migrated.fileId(ITEM_EFFECTS_DLL_PATH)], { allowedMagics: ["DLXF"] }).relocations.filter(r => r.target.module === "167")).toHaveLength(3);
    project.originalRomBytes = migrated.data;
    project.fileSystem = { replacements: {}, additions: {} };
    hydrateItemEffectsSource(project, migrated);
    for (const id of [238, 234, 220]) assignItemEffect(project, id, 234);
    const cleared = new NintendoDSRom(await exportModifiedRom(project, { forDsi: false }), { fileData: "view" });
    expect([...cleared.files[cleared.fileId(ITEM_EFFECTS_DLL_PATH)]]).toEqual([0x50, 0x57, 0x49, 0x52]);
  });

  it("preserves native edits through project save and actual ROM export/reload", async () => {
    const { project } = makeItemEffectsProject(0x18c0);
    assignItemEffect(project, 238, 234);
    updateItemEffectControl(project, 234, "healingDivisor", 8);
    updateItemEffectControl(project, 220, "multiplier", 1.75);
    const restored = openProjectSession(createProjectDocument(project, false));
    restored.originalRomBytes = project.originalRomBytes;
    hydrateItemEffectsSource(restored, new NintendoDSRom(restored.originalRomBytes!, { fileData: "view" }));
    expect(inspectItemEffect(restored, 238).profileId).toBe(234);
    const exported = new NintendoDSRom(await exportModifiedRom(restored, { forDsi: false }), { fileData: "view" });
    restored.originalRomBytes = exported.data;
    restored.overlays[167] = exported.loadArm9Overlays([167]).get(167)!.data;
    hydrateItemEffectsSource(restored, exported);
    expect(inspectItemEffect(restored, 238)).toMatchObject({ editable: true, profileId: 234, controls: [{ value: 8 }] });
    expect(inspectItemEffect(restored, 220).controls[0].value).toBe(1.75);
  });
});
