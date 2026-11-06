import { describe, expect, it, vi } from "vitest";
import { NintendoDSRom } from "../nds/rom";
import type { ProjectState } from "../pokeweb/projectStore";
import { defaults } from "../systemShops/document";
import { renderSystemShopsEditor } from "../ui/systemShopsEditor";

vi.mock("../pokeweb/systemShopsModel", async importOriginal => ({
  ...await importOriginal<typeof import("../pokeweb/systemShopsModel")>(),
  systemShopAssets: () => ({ names: new Map(), items: [], pockets: new Uint8Array() }),
}));
vi.mock("../pokeweb/tmModel", () => ({ getTmEntries: () => [], tmFieldItemId: () => 0 }));
vi.mock("../pokeweb/cgearQuickActionsModel", () => ({ installCGearQuickActions: vi.fn() }));

async function fixture(includePokemart?: boolean) {
  const document = defaults();
  if (includePokemart !== undefined) document.includePokemart = includePokemart;
  const header = new Uint8Array(0x400);
  header.set(new TextEncoder().encode("IRDO"), 12);
  const bytes = new NintendoDSRom(header).save();
  const project: ProjectState = {
    originalRomBytes: bytes,
    romInfo: { title: "fixture", idCode: "IRDO", fileName: "test.nds", size: bytes.length },
    session: { romName: "test", baseRom: "BW2", baseVersion: "W2", fairy: false, fileIds: {}, blacklist: [] },
    arm9: new Uint8Array(), overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
    systemShops: { document, applied: structuredClone(document) },
  };
  type Control = { onchange?: (event: { target: { checked: boolean } }) => void; onclick?: () => void };
  const checkbox: Control = {}, controls: Record<string, Control> = {
    "#ss-include-pokemart": checkbox, "#ss-add-shop": {}, ".ss-dependencies": {}, ".ss-apply": {},
  };
  const root = { innerHTML: "", isConnected: true, querySelectorAll: () => [],
    querySelector: (selector: string) => controls[selector] ?? (selector === ".system-shops" ? {} : null) };
  const dirty = vi.fn();
  await renderSystemShopsEditor(project, root as unknown as HTMLElement, dirty);
  return { project, root, checkbox, dirty };
}

describe("C-Gear Shops Pokémart option", () => {
  it("is checked by default for existing projects", async () => {
    const f = await fixture();
    expect(f.root.innerHTML).toMatch(/id="ss-include-pokemart" type="checkbox" checked/);
    expect(f.root.innerHTML).toContain("Include Pokémart");
    expect(f.dirty).not.toHaveBeenCalled();
  });

  it("autosaves the draft toggle without changing the applied shops", async () => {
    const f = await fixture();
    f.checkbox.onchange!({ target: { checked: false } });
    expect(f.project.systemShops!.document.includePokemart).toBe(false);
    expect(f.project.systemShops!.applied!.includePokemart).toBeUndefined();
    expect(f.root.innerHTML).not.toMatch(/id="ss-include-pokemart" type="checkbox" checked/);
    expect(f.root.innerHTML).toContain("Unapplied changes");
    expect(f.dirty).toHaveBeenCalledOnce();
    f.checkbox.onchange!({ target: { checked: true } });
    expect(f.project.systemShops!.document.includePokemart).toBeUndefined();
    expect(f.root.innerHTML).toContain("Applied configuration is up to date");
  });

  it("reopens custom-only shops with the option unchecked", async () => {
    const f = await fixture(false);
    expect(f.root.innerHTML).not.toMatch(/id="ss-include-pokemart" type="checkbox" checked/);
    expect(f.root.innerHTML).toContain("Applied configuration is up to date");
  });
});
