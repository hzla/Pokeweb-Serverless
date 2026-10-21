import * as THREE from "three";
import { nitroTextureUv } from "../pokeweb/nitroAnimation";
import type { DecodedTexture, Map3dPrimitive } from "../pokeweb/map3dModel";
import type { MapTextureAnimation } from "../pokeweb/mapTextureAnimation";

type Target = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  animation: MapTextureAnimation;
  originalUvs?: Float32Array;
  originalMap: THREE.Texture | null;
  texture: (source: DecodedTexture) => THREE.Texture;
};

/** Owns preview buffers/materials only. Cached scene data stays safe for export. */
export class Map3dTexturePreview {
  enabled = true;
  playing = true;
  readonly fps = 30;
  frame = 0;
  private lastMs?: number;
  private sampledFrame = -1;
  private targets = new Map<THREE.Object3D, Target>();
  private animatedTextures = new Set<THREE.Texture>();
  private duration = 1;

  get count(): number { return this.targets.size; }
  get frameCount(): number { return this.duration; }

  add(mesh: Target["mesh"], source: Map3dPrimitive, texture: Target["texture"]): void {
    if (!source.textureAnimation) return;
    const uv = mesh.geometry.getAttribute("uv");
    const originalUvs = uv ? new Float32Array(uv.array) : undefined;
    if (originalUvs) mesh.geometry.setAttribute("uv", new THREE.BufferAttribute(originalUvs.slice(), 2));
    this.targets.set(mesh, { mesh, animation: source.textureAnimation, originalUvs, originalMap: mesh.material.map, texture });
    this.duration = Math.max(this.duration, source.textureAnimation.frameCount);
    this.sampledFrame = -1;
  }

  removeGroup(group: THREE.Object3D): void {
    group.traverse(object => this.targets.delete(object)); this.sampledFrame = -1;
    this.duration = Math.max(1, ...Array.from(this.targets.values(), t => t.animation.frameCount));
  }
  clear(): void {
    this.animatedTextures.forEach(texture => texture.dispose()); this.animatedTextures.clear();
    this.targets.clear(); this.duration = 1; this.frame = 0; this.lastMs = undefined; this.sampledFrame = -1;
  }
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled; this.lastMs = undefined; this.sampledFrame = -1;
    if (enabled) this.apply();
    else for (const target of this.targets.values()) {
      if (target.originalUvs) this.setUvs(target, target.originalUvs);
      this.setMap(target, target.originalMap);
    }
  }
  setPlaying(playing: boolean): void { this.playing = playing; this.lastMs = undefined; }
  seek(frame: number): void { this.frame = Number.isFinite(frame) ? Math.max(0, frame) : 0; this.sampledFrame = -1; this.lastMs = undefined; this.apply(); }
  update(nowMs: number): boolean {
    if (!this.targets.size) { this.lastMs = nowMs; return false; }
    if (this.enabled && this.playing && this.lastMs !== undefined) this.frame += Math.max(0, nowMs - this.lastMs) * this.fps / 1000;
    this.lastMs = nowMs;
    const previous = this.sampledFrame;
    this.apply();
    return previous !== this.sampledFrame;
  }

  private apply(): void {
    const frame = Math.floor(this.frame);
    if (!this.enabled || this.sampledFrame === frame) return;
    this.sampledFrame = frame;
    for (const target of this.targets.values()) {
      const sample = target.animation.sample(frame), raw = target.animation.rawUvs;
      if (sample.srt && raw) {
        const uv = target.mesh.geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
        if (uv) {
          for (let i = 0; i < raw.length; i += 2) {
            const [u, v] = nitroTextureUv(raw[i], raw[i + 1], 1, 1, sample.srt);
            uv.setXY(i / 2, u, v);
          }
          uv.needsUpdate = true;
        }
      }
      if (sample.texture) {
        const texture = target.texture(sample.texture);
        this.animatedTextures.add(texture);
        this.setMap(target, texture);
      }
    }
  }
  private setUvs(target: Target, values: Float32Array): void {
    const uv = target.mesh.geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
    if (uv) { (uv.array as Float32Array).set(values); uv.needsUpdate = true; }
  }
  private setMap(target: Target, texture: THREE.Texture | null): void {
    const material = target.mesh.material;
    if (material.map === texture) return;
    if (Boolean(material.map) !== Boolean(texture)) material.needsUpdate = true;
    material.map = texture;
  }
}
