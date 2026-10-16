import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyFlyDestinationEdit, getFlyDestinations, getFlyDestinationStatus, type FlyDestination } from "../pokeweb/flyDestinationModel";
import { installBw2MapPreview, type Bw2MapPreview } from "../ui/bw2MapPreview";
import { renderFlyDestinationEditor, stopFlyDestinationEditor } from "../ui/flyDestinationEditor";
import { makeEditProject } from "./fixtures/editProject";

vi.mock("../ui/bw2MapPreview", () => ({ installBw2MapPreview: vi.fn() }));
vi.mock("../pokeweb/flyDestinationModel", async original => ({
  ...await original<typeof import("../pokeweb/flyDestinationModel")>(),
  getFlyDestinations: vi.fn(), getFlyDestinationStatus: vi.fn(), applyFlyDestinationEdit: vi.fn(async () => {}),
}));

class Node {
  value = ""; checked = false; disabled = false; textContent = ""; dataset: Record<string, string> = {};
  classList = { add: vi.fn(), remove: vi.fn() };
  listeners: Record<string, (event?: { preventDefault: () => void }) => unknown> = {};
  html = ""; buttons: Node[] = []; onHtml?: (html: string) => void;
  set innerHTML(html: string) { this.html = html; this.onHtml?.(html); }
  get innerHTML() { return this.html; }
  addEventListener(event: string, action: (event?: { preventDefault: () => void }) => unknown) { this.listeners[event] = action; }
  querySelectorAll() { return this.buttons; }
}

function fixture(version: "B2" | "W2" = "W2") {
  const project = makeEditProject(); project.session.baseVersion = version;
  const entries: FlyDestination[] = [
    { index: 0, zone: 326, landingZone: 326, name: "Route 4", enabled: false, visitFlag: 65535, suggestedVisitFlag: 2501, hiddenFlag: 65535, coordinateKind: "grid", landing: { x: 432, y: 0, z: 491 } },
    { index: 1, zone: 490, landingZone: 326, name: "Join Avenue", enabled: true, visitFlag: 2470, suggestedVisitFlag: 2470, hiddenFlag: 65535, coordinateKind: "grid", landing: { x: 430, y: 0, z: 491 } },
    { index: 2, zone: 28, landingZone: 28, name: "Castelia City", enabled: true, visitFlag: 2476, hiddenFlag: 65535, coordinateKind: "rail", landing: { x: 3, y: 10, z: -2 } },
  ];
  project.headers = { count: 615, rows: Object.fromEntries([28, 326, 551].map(zone => [zone + 1, { index: zone, location_name: zone === 28 ? "Castelia City" : "Route 4", overworlds_id: zone }])) };
  vi.mocked(getFlyDestinations).mockReturnValue(entries);
  vi.mocked(getFlyDestinationStatus).mockReturnValue({ supported: true, compatible: true, installed: false, message: "Supported." });
  const nodes = new Map(["areas", "detail", "search", "filter", "map-preview", "enabled", "visit-flag", "use-visit", "form", "apply", "status", "x", "y", "z"].map(id => [`#fly-${id}`, new Node()]));
  nodes.get("#fly-areas")!.onHtml = html => {
    nodes.get("#fly-areas")!.buttons = [...html.matchAll(/data-fly-area="(\d+)"/g)].map(match => { const button = new Node(); button.dataset.flyArea = match[1]; return button; });
  };
  nodes.get("#fly-detail")!.onHtml = html => {
    for (const id of ["visit-flag", "x", "y", "z"]) nodes.get(`#fly-${id}`)!.value = html.match(new RegExp(`id="fly-${id}"[^>]*value="([^"]*)"`))![1];
    nodes.get("#fly-enabled")!.checked = /id="fly-enabled"[^>]*checked/.test(html);
  };
  const root = { innerHTML: "", querySelector: (selector: string) => nodes.get(selector), querySelectorAll: () => [...nodes.values()] };
  const previews: Bw2MapPreview[] = [];
  vi.mocked(installBw2MapPreview).mockImplementation(() => {
    const preview = { setFocus: vi.fn(), setLanding: vi.fn(), destroy: vi.fn() }; previews.push(preview); return preview;
  });
  const onDirty = vi.fn();
  renderFlyDestinationEditor(project, root as unknown as HTMLElement, onDirty);
  const node = (id: string) => nodes.get(`#fly-${id}`)!;
  const select = (index: number) => node("areas").buttons.find(button => button.dataset.flyArea === String(index))!.listeners.click();
  const input = (id: string, value: string) => { node(id).value = value; node(id).listeners.input(); };
  return { project, entries, previews, node, select, input, onDirty };
}

describe("Fly destination map preview", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { stopFlyDestinationEditor(); });

  it.each(["B2", "W2"] as const)("previews the shared destination map with independent draft coordinates in %s", version => {
    const f = fixture(version), expectedZone = version === "W2" ? 551 : 326;
    expect(vi.mocked(installBw2MapPreview).mock.calls[0][2]).toMatchObject({ choices: [{ zoneId: expectedZone }], landing: { coordinates: { x: 430, y: 0, z: 491 } } });
    f.select(0);
    expect(f.previews[0].destroy).toHaveBeenCalledOnce();
    f.input("x", "440"); f.input("y", "3");
    expect(f.previews[1].setLanding).toHaveBeenLastCalledWith({ x: 440, y: 3, z: 491 }, expect.stringContaining("X 440"));
    expect(applyFlyDestinationEdit).not.toHaveBeenCalled();
    expect(f.entries[0].landing.x).toBe(432);
    f.select(1); expect(f.node("x").value).toBe("430");
    f.select(0); expect(f.node("x").value).toBe("440");
    stopFlyDestinationEditor(); expect(f.previews[3].destroy).toHaveBeenCalledOnce();
  });

  it("clears an invalid landing marker while visit flag edits remain independent of the preview", () => {
    const f = fixture(); f.node("visit-flag").value = "";
    f.input("x", "435");
    expect(f.previews[0].setLanding).toHaveBeenLastCalledWith({ x: 435, y: 0, z: 491 }, expect.any(String));
    f.input("x", "");
    expect(f.previews[0].setLanding).toHaveBeenLastCalledWith(undefined, "X must be a whole number.");
    f.input("x", "32768");
    expect(f.previews[0].setLanding).toHaveBeenLastCalledWith(undefined, expect.stringContaining("allowed range"));
  });

  it("shows rail values without interpreting them as grid coordinates", () => {
    const f = fixture(); f.select(2); f.input("y", "20");
    expect(f.previews[1].setLanding).toHaveBeenLastCalledWith(undefined, expect.stringContaining("cannot yet be plotted"));
    expect(f.previews[1].setLanding).toHaveBeenLastCalledWith(undefined, expect.stringContaining("position 20"));
  });

  it("keeps a completed apply saveable if the user leaves while it is running", async () => {
    const f = fixture();
    let complete!: () => void;
    vi.mocked(applyFlyDestinationEdit).mockReturnValueOnce(new Promise<void>(resolve => { complete = resolve; }));
    f.input("x", "435");
    const pending = f.node("form").listeners.submit({ preventDefault: vi.fn() });
    stopFlyDestinationEditor(); complete(); await pending;
    expect(f.onDirty).toHaveBeenCalledOnce();
    expect(f.previews[0].destroy).toHaveBeenCalledOnce();
    expect(f.node("status").textContent).toBe("Applying Fly destination…");
  });
});
