import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Map3dCameraEditor } from "../ui/map3dCameraEditor";
import type { FieldCameraDocument } from "../pokeweb/fieldCameraModel";
import type { Map3dSceneData } from "../pokeweb/map3dModel";
import type { ProjectState } from "../pokeweb/projectStore";

// Exercise the real camera actions and captured key handlers without a WebGL renderer.
class Node {
  value = ""; hidden = false; textContent = ""; innerHTML = "";
  children = new Map<string, Node>();
  listeners = new Map<string, Array<{ capture: boolean; handler: (event: unknown) => void }>>();
  focus = vi.fn(); setAttribute() {} closest() { return undefined; } remove() {}
  querySelector(selector: string): Node {
    if (!this.children.has(selector)) this.children.set(selector, new Node());
    return this.children.get(selector)!;
  }
  addEventListener(type: string, handler: (event: unknown) => void, options?: { capture?: boolean }) {
    const handlers = this.listeners.get(type) ?? []; handlers.push({ capture: !!options?.capture, handler }); this.listeners.set(type, handlers);
  }
  emit(type: string, key = "") {
    let stopped = false;
    const event = { key, repeat: false, altKey: false, ctrlKey: false, metaKey: false,
      preventDefault: vi.fn(), stopImmediatePropagation: () => { stopped = true; } };
    for (const listener of [...this.listeners.get(type) ?? []].sort((a, b) => Number(b.capture) - Number(a.capture))) {
      if (stopped) break; listener.handler(event);
    }
    return event;
  }
}

function fixture() {
  const hud = new Node(); vi.stubGlobal("document", { createElement: () => hud });
  // Form rendering is covered in-browser; keep the fields stable for action/key regression checks.
  vi.spyOn(Map3dCameraEditor.prototype as unknown as { render(): void }, "render").mockImplementation(() => {});
  const host = new Node(), canvas = new Node(), pan = vi.fn();
  for (const [name, value] of Object.entries({ "point-x": "48.5", "point-z": "720.5", "point-y": "0" })) host.querySelector(`[name="${name}"]`).value = value;
  canvas.addEventListener("keydown", event => { if ((event as { key: string }).key.startsWith("Arrow")) pan(); });
  const scene = new THREE.Scene(), terrainGroup = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(512, 512), new THREE.MeshBasicMaterial());
  floor.rotation.x = -Math.PI / 2; floor.position.set(768, 0, 11520); terrainGroup.add(floor); scene.add(terrainGroup);
  const state = { scene, terrainGroup, renderer: { domElement: canvas }, camera: new THREE.PerspectiveCamera(),
    target: new THREE.Vector3(), distance: 1400, yaw: 0, pitch: 0.9 } as unknown as ConstructorParameters<typeof Map3dCameraEditor>[2];
  const editor = new Map3dCameraEditor({} as ProjectState, host as unknown as HTMLElement, state);
  const actions = editor as unknown as { action(name: string): void; doc: FieldCameraDocument; data: Map3dSceneData; player: THREE.Sprite };
  actions.doc = { zoneId: 427, presetId: 0, regions: [], boundaries: [], layout: { kind: "native" }, sharedZones: [], baseline: new Uint8Array(),
    rom: {} as FieldCameraDocument["rom"], preset: {
    pitch: 45, yaw: 0, distance: 237, fov: 40, near: 1, far: 1024, roll: 0, followsPlayer: true, offset: { x: 0, y: 0, z: 0 },
  } };
  actions.data = { chunks: [{ matrixX: 1, matrixY: 22 }] } as Map3dSceneData;
  const player = new THREE.Sprite(new THREE.SpriteMaterial()); player.visible = false; scene.add(player); actions.player = player;
  return { editor, actions, canvas, player, state, pan, hud };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Snap camera navigation", () => {
  it("starts walking, shows the player and focuses the canvas; arrows retain the camera pose without reaching free-view panning", () => {
    const f = fixture(); f.actions.action("preview");
    expect(f.canvas.focus).toHaveBeenCalled(); expect(f.player.visible).toBe(true);
    const distance = () => new THREE.Vector3().copy(f.state.cameraPose!.position).distanceTo(new THREE.Vector3().copy(f.state.cameraPose!.target));
    const beforeDistance = distance(), x = f.player.position.x;
    const event = f.canvas.emit("keydown", "ArrowRight");
    expect(event.preventDefault).toHaveBeenCalled(); expect(f.pan).not.toHaveBeenCalled();
    expect(f.state.cameraPose).toBeDefined(); expect(f.player.visible).toBe(true); expect(f.player.position.x).toBe(x + 16);
    expect(distance()).toBeCloseTo(beforeDistance);
    expect(f.hud.querySelector("[data-camera-location-help]").textContent).toContain("Arrow keys: walk");
    f.canvas.emit("keydown", "Escape");
    expect(f.state.cameraPose).toBeUndefined(); expect(f.player.visible).toBe(false);
    f.canvas.emit("keydown", "ArrowRight"); expect(f.pan).toHaveBeenCalledOnce();
    f.editor.dispose();
  });
  it("returns from the overhead locator to walking with the same player position", () => {
    const f = fixture(); f.actions.action("preview"); const start = f.player.position.clone();
    f.hud.querySelector("button").emit("click"); expect(f.state.cameraPose).toBeUndefined();
    f.hud.querySelector("button").emit("click");
    expect(f.player.visible).toBe(true); expect(f.player.position).toEqual(start);
    f.canvas.emit("keydown", "ArrowUp");
    expect(f.state.cameraPose).toBeDefined(); expect(f.player.position.z).toBe(start.z - 16); expect(f.pan).not.toHaveBeenCalled();
    f.editor.dispose();
  });
});
