import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMatrixSnapshot, GEN5_MATRIX_EMPTY } from "../pokeweb/matrixModel";
import { installMatrixThumbnails, matrixThumbnailKey } from "../ui/matrixThumbnails";
import { makeMatrixProject } from "./fixtures/matrixProject";

const graphics = vi.hoisted(() => ({ load: vi.fn(), render: vi.fn(), dispose: vi.fn(), create: vi.fn() }));
vi.mock("../pokeweb/map3dModel", () => ({ loadMap3dZone: graphics.load }));
vi.mock("../ui/overworldMapRenderer", () => ({ createOverworldMapThumbnailRenderer: graphics.create }));

function fixture(mapIds?: number[]) {
  const project = makeMatrixProject(), snapshot = getMatrixSnapshot(project, 1);
  if (mapIds) {
    snapshot.width = mapIds.length; snapshot.height = 1;
    snapshot.cells = mapIds.map((mapId, index) => ({ index, x: index, y: 0, mapId }));
    project.narcs.maps!.rawFiles = Array.from({ length: Math.max(...mapIds) + 1 }, () => Uint8Array.of(1));
  }
  const buttons = snapshot.cells.map(cell => ({ dataset: { matrixCell: String(cell.index) } as Record<string, string>,
    style: { backgroundImage: "" }, title: "Cell", classList: { add: vi.fn() } }));
  const observers: TestObserver[] = [];
  class TestObserver {
    observed = new Set<unknown>();
    constructor(public callback: IntersectionObserverCallback) { observers.push(this); }
    observe(target: unknown) { this.observed.add(target); }
    unobserve(target: unknown) { this.observed.delete(target); }
    disconnect() { this.observed.clear(); }
    fire() { this.callback([...this.observed].map(target => ({ target, isIntersecting: true })) as IntersectionObserverEntry[], this as unknown as IntersectionObserver); }
  }
  vi.stubGlobal("IntersectionObserver", TestObserver);
  const controller = installMatrixThumbnails(project, {} as HTMLElement, { querySelectorAll: () => buttons } as unknown as HTMLElement);
  return { project, snapshot, buttons, observers, controller, visible: () => observers.at(-1)!.fire() };
}

describe("matrix map thumbnails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    graphics.load.mockReset().mockResolvedValue({}); graphics.render.mockReset().mockReturnValue("data:image/png;base64,dGVzdA==");
    graphics.create.mockReset().mockReturnValue({ render: graphics.render, dispose: graphics.dispose });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("keeps matrix zero entirely free of thumbnail loading", () => {
    const f = fixture(); f.controller.show(getMatrixSnapshot(f.project, 0));
    expect(f.observers).toHaveLength(0); expect(graphics.load).not.toHaveBeenCalled(); expect(graphics.create).not.toHaveBeenCalled();
    f.controller.destroy();
  });
  it("loads matrix zero only when opted in, and cancels pending work when disabled", async () => {
    const f = fixture(), world = getMatrixSnapshot(f.project, 0); let release!: (data: unknown) => void;
    graphics.load.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    f.controller.show(world, { allowMatrixZero: true }); f.visible();
    await vi.waitFor(() => expect(graphics.load).toHaveBeenCalledOnce());
    f.controller.show(world); release({});
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(graphics.render).not.toHaveBeenCalled(); expect(f.observers[0].observed.size).toBe(0);
    f.controller.show(world, { allowMatrixZero: true }); f.visible();
    await vi.waitFor(() => expect(graphics.render).toHaveBeenCalledTimes(2));
    expect(f.buttons.every(button => button.dataset.matrixThumbnail === "ready")).toBe(true);
    f.controller.destroy();
  });
  it("decodes and renders duplicate map IDs once when their graphics area matches", async () => {
    const f = fixture(); f.snapshot.hasHeaders = true;
    f.project.headers!.rows[1].matrix_id = 1; f.project.headers!.rows[3].matrix_id = 1;
    f.snapshot.cells[0].headerId = 0; f.snapshot.cells[1].headerId = 2;
    f.snapshot.cells[1].mapId = f.snapshot.cells[0].mapId;
    f.controller.show(f.snapshot); f.visible();
    await vi.waitFor(() => expect(f.buttons.every(button => button.dataset.matrixThumbnail === "ready")).toBe(true));
    expect(graphics.load).toHaveBeenCalledOnce(); expect(graphics.render).toHaveBeenCalledOnce();
    expect(f.buttons[0].style.backgroundImage).toBe(f.buttons[1].style.backgroundImage);
    // Reuse also survives switching between matrix indexes.
    const world = getMatrixSnapshot(f.project, 0); world.cells[0].mapId = world.cells[1].mapId = f.snapshot.cells[0].mapId;
    f.controller.show(world, { allowMatrixZero: true }); f.visible();
    expect(graphics.load).toHaveBeenCalledOnce(); f.controller.destroy();
  });
  it("renders the same map separately when its header selects another graphics area", async () => {
    const f = fixture(); f.snapshot.hasHeaders = true;
    f.project.headers!.rows[1].matrix_id = 1; f.project.headers!.rows[3].matrix_id = 1;
    f.project.headers!.rows[3].texture_id = 77;
    f.snapshot.cells[0].headerId = 0; f.snapshot.cells[1].headerId = 2;
    f.snapshot.cells[1].mapId = f.snapshot.cells[0].mapId;
    f.controller.show(f.snapshot); f.visible();
    await vi.waitFor(() => expect(graphics.render).toHaveBeenCalledTimes(2));
    expect(graphics.load).toHaveBeenCalledTimes(2); f.controller.destroy();
  });
  it("loads visible cells serially with one renderer, then reuses cached images", async () => {
    const f = fixture(); let release!: (data: unknown) => void;
    graphics.load.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    f.controller.show(f.snapshot); expect(graphics.load).not.toHaveBeenCalled(); f.visible();
    await vi.waitFor(() => expect(graphics.load).toHaveBeenCalledTimes(1));
    release({});
    await vi.waitFor(() => expect(graphics.render).toHaveBeenCalledTimes(2));
    expect(graphics.create).toHaveBeenCalledOnce();
    expect(graphics.create).toHaveBeenCalledWith(128);
    expect(graphics.load.mock.calls.map(call => call[2])).toEqual([
      { season: "spring", cache: false, matrixCell: { matrixId: 1, x: 0, y: 0 } },
      { season: "spring", cache: false, matrixCell: { matrixId: 1, x: 1, y: 0 } },
    ]);
    expect(f.buttons.every(button => button.dataset.matrixThumbnail === "ready")).toBe(true);
    f.controller.show(f.snapshot); f.visible();
    expect(graphics.load).toHaveBeenCalledTimes(2);
    f.project.narcs.maps!.revision = (f.project.narcs.maps!.revision ?? 0) + 1; f.controller.show(f.snapshot); f.visible();
    await vi.waitFor(() => expect(graphics.render).toHaveBeenCalledTimes(4));
    f.controller.destroy(); expect(graphics.dispose).toHaveBeenCalledOnce();
  });
  it.each([{ area: 0, loads: 2 }, { area: 2, loads: 4 }])("reuses seasonal previews according to their actual graphics area ($area)", async ({ area, loads }) => {
    const f = fixture(); f.project.headers!.rows[2].texture_id = area;
    const seasons = ["spring", "summer", "autumn", "winter"] as const;
    const buttons = seasons.map(() => ({ ...f.buttons[0], style: { backgroundImage: "" }, dataset: { matrixCell: "0" } as Record<string, string> }));
    f.controller.showPreviews(seasons.map((season, i) => ({ season, headerId: 1,
      snapshot: { ...f.snapshot, width: 1, height: 1, cells: [{ ...f.snapshot.cells[0], mapId: i === 3 ? 6 : 5 }] },
      root: { querySelectorAll: () => [buttons[i]] } as unknown as HTMLElement })));
    f.visible(); await vi.waitFor(() => expect(buttons.every(button => button.dataset.matrixThumbnail === "ready")).toBe(true));
    expect(graphics.load).toHaveBeenCalledTimes(loads);
    expect(graphics.load.mock.calls[0][2]).toMatchObject({ season: "spring", cache: false, previewMap: { mapId: 5, headerId: 1 } });
    expect(graphics.load.mock.calls.at(-1)![2]).toMatchObject({ season: "winter", previewMap: { mapId: 6, headerId: 1 } });
    f.controller.destroy();
  });
  it("uses each cell's header resources when previewing an alternate whole matrix", async () => {
    const f = fixture(); f.snapshot.hasHeaders = true; f.snapshot.cells[0].headerId = 0; f.snapshot.cells[1].headerId = 2;
    f.snapshot.cells[1].mapId = f.snapshot.cells[0].mapId; f.project.headers!.rows[3].texture_id = 77;
    f.controller.showPreviews([{ snapshot: f.snapshot, season: "winter", resourceMatrixId: 0, fallbackHeaderId: 1, preview: true,
      root: { querySelectorAll: () => f.buttons } as unknown as HTMLElement }]);
    f.visible(); await vi.waitFor(() => expect(graphics.render).toHaveBeenCalledTimes(2));
    expect(graphics.load.mock.calls.map(call => call[2].previewMap.headerId)).toEqual([0, 2]);
    f.controller.destroy();
  });
  it("retains a full grid larger than the old cache limit across thumbnail toggles", async () => {
    const f = fixture([...Array.from({ length: 100 }, (_, id) => id), 0]);
    f.controller.show(f.snapshot); f.visible();
    await vi.waitFor(() => expect(f.buttons.every(button => button.dataset.matrixThumbnail === "ready")).toBe(true), { timeout: 3000 });
    expect(graphics.load).toHaveBeenCalledTimes(100); expect(graphics.render).toHaveBeenCalledTimes(100);
    f.controller.show();
    for (const button of f.buttons) { button.style.backgroundImage = ""; delete button.dataset.matrixThumbnail; }
    f.controller.show(f.snapshot); f.visible();
    expect(f.buttons.every(button => button.dataset.matrixThumbnail === "ready")).toBe(true);
    expect(graphics.load).toHaveBeenCalledTimes(100); expect(graphics.render).toHaveBeenCalledTimes(100);
    f.controller.destroy();
  });
  it("skips empty maps and falls back to the cell color when graphics cannot load", async () => {
    const f = fixture(); f.snapshot.cells[1].mapId = GEN5_MATRIX_EMPTY;
    graphics.load.mockRejectedValueOnce(new Error("Reconnect source ROM"));
    f.controller.show(f.snapshot); f.visible();
    await vi.waitFor(() => expect(f.buttons[0].dataset.matrixThumbnail).toBe("unavailable"));
    expect(f.buttons[0].title).toContain("Reconnect source ROM");
    expect(f.buttons[0].style.backgroundImage).toBe(""); expect(f.buttons[1].dataset.matrixThumbnail).toBeUndefined();
    expect(graphics.load).toHaveBeenCalledOnce(); expect(graphics.create).not.toHaveBeenCalled(); f.controller.destroy();
  });
  it("does not render or apply an old request after switching matrices or closing the editor", async () => {
    const f = fixture(); let release!: (data: unknown) => void;
    graphics.load.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    f.controller.show(f.snapshot); f.visible(); await vi.waitFor(() => expect(graphics.load).toHaveBeenCalledOnce());
    f.controller.show(getMatrixSnapshot(f.project, 0)); release({});
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(graphics.render).not.toHaveBeenCalled(); expect(f.buttons[0].dataset.matrixThumbnail).toBeUndefined();
    f.controller.destroy(); f.controller.show(f.snapshot); f.visible();
    expect(graphics.load).toHaveBeenCalledOnce();
  });
  it("invalidates images for matrix, header, graphics, and area-resource changes", () => {
    const f = fixture(), key = () => matrixThumbnailKey(f.project, 5, 0);
    let previous = key();
    expect(matrixThumbnailKey(f.project, 6, 0)).not.toBe(previous);
    expect(matrixThumbnailKey(f.project, 5, 1)).not.toBe(previous);
    for (const name of ["matrix", "headers", "maps"] as const) {
      const store = f.project.narcs[name]!; store.revision = (store.revision ?? 0) + 1; expect(key()).not.toBe(previous); previous = key();
    }
    f.project.map3dAreaEdits = { 0: { texturesId: 2, buildingsId: 0, srtAnimeIdx: 0, patAnimeIdx: 0, isExterior: true } };
    expect(key()).not.toBe(previous); f.controller.destroy();
  });
});
