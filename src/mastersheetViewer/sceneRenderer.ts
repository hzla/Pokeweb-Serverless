import * as THREE from "three";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { cutsceneOverworldLibrary } from "../pokeweb/cutsceneActors";
import { decodeCameraPreset, evaluateFieldCamera, loadFieldCamera, type CameraPose } from "../pokeweb/fieldCameraModel";
import { getRomFileBytes } from "../pokeweb/fileSystemModel";
import { parseHeaders } from "../pokeweb/headerModel";
import {
  buildModelPrimitives,
  loadMap3dZone,
  readNitroResources,
  type DecodedTexture,
  type Map3dNpcSpriteFrames,
  type Map3dPrimitive,
  type Map3dSceneData,
} from "../pokeweb/map3dModel";
import type { MsPlacement } from "../pokeweb/mastersheetDocument";
import type { ProjectState } from "../pokeweb/projectStore";

/**
 * Pictures of the field drawn from the ROM with one shared, offscreen WebGL renderer:
 * - a top-down view of a zone, for area and encounter thumbnails;
 * - a trainer standing on the map, in the zone's game camera, with the game's shadow (ov036 fldeff_shadow.c: the
 *   "kage" model, member 47 of a/0/7/4, scaled (1, 1, 0.75), drawn at 19/31 opacity).
 */

/** Direction codes in overworld files: 0 up, 1 down, 2 left, 3 right. */
const DIRECTIONS = ["up", "down", "left", "right"] as const;
/** map3d turns an NPC's facing into a rotation (npcModelRotationY); this turns it back. */
const NPC_DIRECTION_BY_ROTATION: Record<number, (typeof DIRECTIONS)[number]> = { 180: "up", 0: "down", [-90]: "left", 90: "right" };
const DS_WIDTH = 256;
const DS_HEIGHT = 192;
const SHADOW_ARCHIVE = "a/0/7/4";
const SHADOW_MEMBER = 47;
const CAMERA_PRESETS = "a/0/5/9";

export class FieldSnapshotRenderer {
  private gl?: THREE.WebGLRenderer;
  private rom?: NintendoDSRom;
  private shadow?: Map3dPrimitive[] | null;
  private sprites?: ReturnType<typeof cutsceneOverworldLibrary>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private project: ProjectState) {}

  /** Jobs share one WebGL context, so they run one at a time. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** A zone from straight above, north up, at most `maxSize` pixels on its longer side. */
  zoneTopDown(zoneId: number, maxSize = 720): Promise<Blob> {
    return this.enqueue(async () => {
      const data = await loadMap3dZone(this.project, zoneId, { season: "spring", cache: false });
      const { scene, dispose } = buildScene(data);
      const extra: Array<{ dispose(): void }> = [];
      try {
        // Measure the map before adding people, so a sprite at the edge can't widen the frame.
        const bounds = new THREE.Box3().setFromObject(scene);
        if (bounds.isEmpty()) throw new Error("This zone has no map geometry.");
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const scale = Math.min(1, maxSize / Math.max(size.x, size.z));
        const width = Math.max(16, Math.round(size.x * scale));
        const height = Math.max(16, Math.round(size.z * scale));
        const camera = new THREE.OrthographicCamera(-size.x / 2, size.x / 2, size.z / 2, -size.z / 2, 1, size.y + 4096);
        camera.position.set(center.x, bounds.max.y + 2048, center.z);
        camera.up.set(0, 0, -1);
        camera.lookAt(center.x, bounds.min.y, center.z);
        this.addNpcs(scene, data, extra);
        return await this.render(scene, camera, width, height);
      } finally {
        extra.forEach((item) => item.dispose());
        dispose();
      }
    });
  }

  /**
   * A trainer where they stand, seen through the zone's game camera centred on them (as if the player stood
   * there), at the DS's 256×192, cropped around the trainer and enlarged 3× with hard pixels.
   */
  trainerScene(placement: MsPlacement, options: { crop?: [number, number]; scale?: number } = {}): Promise<Blob> {
    return this.enqueue(async () => {
      const data = await loadMap3dZone(this.project, placement.zoneId, { season: "spring", cache: false });
      const { scene, dispose } = buildScene(data);
      const extra: Array<{ dispose(): void }> = [];
      try {
        const npc = data.npcModels.find((model) => model.uid === placement.npcIndex && model.objCode === placement.objCode)
          ?? data.npcModels.find((model) => model.objCode === placement.objCode && Math.floor(model.x / 16) === placement.tileX && Math.floor(model.z / 16) === placement.tileZ);
        const position = new THREE.Vector3(npc?.x ?? placement.tileX * 16 + 8, npc?.y ?? placement.height * 16, npc?.z ?? placement.tileZ * 16 + 8);
        const frames = this.spriteFrames(placement.objCode) ?? npc?.spriteFrames;
        const direction = DIRECTIONS[placement.direction] ?? "down";
        const texture = frames?.framesByDirection[direction]?.[0] ?? frames?.framesByDirection.down?.[0];
        if (!frames || !texture) throw new Error("This trainer's overworld sprite couldn't be read.");

        const shadow = this.shadowPrimitives();
        if (shadow) {
          const group = new THREE.Group();
          for (const primitive of shadow) {
            const mesh = primitiveMesh(primitive, extra);
            const material = mesh.material as THREE.MeshBasicMaterial;
            material.color.setRGB(...primitive.material.diffuse);
            material.depthWrite = false;
            material.transparent = true;
            mesh.renderOrder = 1;
            group.add(mesh);
          }
          group.position.copy(position);
          group.scale.set(1, 1, 0.75);
          scene.add(group);
        }

        const spriteTexture = dataTexture(texture, true);
        const spriteMaterial = new THREE.SpriteMaterial({ map: spriteTexture, alphaTest: 0.05, transparent: true });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.center.set(0.5, 0);
        sprite.scale.set(frames.width, frames.height, 1);
        sprite.position.copy(position);
        sprite.renderOrder = 2;
        scene.add(sprite);
        extra.push(spriteTexture, spriteMaterial);

        const pose = await this.cameraPose(placement.zoneId, position);
        const camera = new THREE.PerspectiveCamera(pose.fov, DS_WIDTH / DS_HEIGHT, pose.near, pose.far);
        camera.position.set(pose.position.x, pose.position.y, pose.position.z);
        camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
        camera.updateMatrixWorld(true);

        // Crop around the trainer's middle as it lands on screen.
        const [cropWidth, cropHeight] = options.crop ?? [168, 140];
        const middle = position.clone().add(new THREE.Vector3(0, frames.height / 2, 0)).project(camera);
        const centerX = (middle.x + 1) / 2 * DS_WIDTH;
        const centerY = (1 - middle.y) / 2 * DS_HEIGHT;
        const left = Math.round(Math.min(DS_WIDTH - cropWidth, Math.max(0, centerX - cropWidth / 2)));
        const top = Math.round(Math.min(DS_HEIGHT - cropHeight, Math.max(0, centerY - cropHeight / 2)));
        return await this.render(scene, camera, DS_WIDTH, DS_HEIGHT, { x: left, y: top, width: cropWidth, height: cropHeight, scale: options.scale ?? 3 });
      } finally {
        extra.forEach((item) => item.dispose());
        dispose();
      }
    });
  }

  /**
   * The zone's NPCs, standing where they start, facing the way they face. Sprite NPCs use the overworld sprite library
   * (map3d's own frames are only right for "down"); NPCs that are 3D models use their model.
   * Seen from above, a sprite faces the camera, so it reads like a sprite on a 2D map.
   */
  private addNpcs(scene: THREE.Scene, data: Map3dSceneData, owned: Array<{ dispose(): void }>): void {
    for (const npc of data.npcModels) {
      if (npc.modelType === "model") {
        if (!npc.primitives.length) continue;
        const group = new THREE.Group();
        group.position.set(npc.x, npc.y, npc.z);
        group.rotation.y = npc.rotationY * Math.PI / 180;
        for (const primitive of npc.primitives) group.add(primitiveMesh(primitive, owned));
        scene.add(group);
        continue;
      }
      const frames = this.spriteFrames(npc.objCode) ?? npc.spriteFrames;
      const direction = NPC_DIRECTION_BY_ROTATION[Math.round(npc.rotationY)] ?? "down";
      const texture = frames?.framesByDirection[direction]?.[0] ?? frames?.framesByDirection.down?.[0];
      if (!frames || !texture) continue;
      const map = dataTexture(texture, true);
      const material = new THREE.SpriteMaterial({ map, alphaTest: 0.05, transparent: true });
      const sprite = new THREE.Sprite(material);
      sprite.center.set(0.5, 0);
      sprite.scale.set(frames.width, frames.height, 1);
      // A unit above the ground, so the sprite doesn't flicker into the tile it stands on.
      sprite.position.set(npc.x, npc.y + 1, npc.z);
      sprite.renderOrder = 2;
      scene.add(sprite);
      owned.push(map, material);
    }
  }

  /** The zone's game camera at this spot: its camera regions when Pokeweb can read them, else its preset. */
  private async cameraPose(zoneId: number, at: THREE.Vector3): Promise<CameraPose> {
    const player = { x: at.x, y: at.y, z: at.z };
    try {
      const doc = await loadFieldCamera(this.project, zoneId);
      const shift = doc.regions.length ? 8 : 0;
      const pose = evaluateFieldCamera(doc.preset, doc.regions, { x: player.x - shift, y: player.y, z: player.z - shift }, doc.boundaries);
      return shift ? shiftPose(pose, shift) : pose;
    } catch {
      // Other White 2 / Black 2 builds: the zone's camera preset without its regions.
    }
    try {
      this.project.headers ??= parseHeaders(this.project);
      const row = Object.values(this.project.headers.rows).find((candidate) => Number(candidate.index) === zoneId);
      const presets = new NARC(getRomFileBytes(this.project, this.romFile(), this.romFile().fileId(CAMERA_PRESETS))).files[0];
      const presetId = Number(row?.camera_id ?? 0) >>> 1;
      if (presets && presetId * 44 + 44 <= presets.length) {
        return evaluateFieldCamera(decodeCameraPreset(presets.subarray(presetId * 44, presetId * 44 + 44)), [], player, []);
      }
    } catch {
      // Fall through to a typical outdoor camera.
    }
    return {
      position: { x: player.x, y: player.y + 300, z: player.z + 310 },
      target: { x: player.x, y: player.y, z: player.z },
      fov: 22, near: 32, far: 4096, weight: 0,
    };
  }

  /**
   * The overworld sprite in the game's texture order (up, down, left, right). The zone loader's own per-direction
   * frames are only right for "down", so they are a fallback.
   */
  private spriteFrames(objCode: number): Map3dNpcSpriteFrames | undefined {
    try {
      this.sprites ??= cutsceneOverworldLibrary(this.project, this.romFile());
      return this.sprites.load(objCode);
    } catch {
      return undefined;
    }
  }

  private shadowPrimitives(): Map3dPrimitive[] | undefined {
    if (this.shadow !== undefined) return this.shadow ?? undefined;
    try {
      const rom = this.romFile();
      const archive = new NARC(getRomFileBytes(this.project, rom, rom.fileId(SHADOW_ARCHIVE)));
      const bytes = archive.files[SHADOW_MEMBER];
      this.shadow = bytes ? buildModelPrimitives(readNitroResources(bytes), []) : null;
    } catch {
      this.shadow = null;
    }
    return this.shadow ?? undefined;
  }

  private romFile(): NintendoDSRom {
    if (!this.project.originalRomBytes) throw new Error("The ROM isn't loaded.");
    this.rom ??= new NintendoDSRom(this.project.originalRomBytes, { fileData: "view" });
    return this.rom;
  }

  private async render(
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
    crop?: { x: number; y: number; width: number; height: number; scale: number },
  ): Promise<Blob> {
    this.gl ??= createRenderer();
    const gl = this.gl;
    gl.setSize(width, height, false);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(scene, camera);
    const source = gl.domElement;
    const area = crop ?? { x: 0, y: 0, width, height, scale: 1 };
    const out = document.createElement("canvas");
    out.width = area.width * area.scale;
    out.height = area.height * area.scale;
    const context = out.getContext("2d")!;
    context.imageSmoothingEnabled = false;
    context.drawImage(source, area.x, area.y, area.width, area.height, 0, 0, out.width, out.height);
    return await new Promise<Blob>((resolve, reject) => out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image couldn't be encoded."))), "image/webp", 0.92));
  }

  dispose(): void {
    this.gl?.dispose();
    this.gl?.forceContextLoss();
    this.gl = undefined;
  }
}

function createRenderer(): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function shiftPose(pose: CameraPose, shift: number): CameraPose {
  return {
    ...pose,
    position: { x: pose.position.x + shift, y: pose.position.y, z: pose.position.z + shift },
    target: { x: pose.target.x + shift, y: pose.target.y, z: pose.target.z + shift },
  };
}

/** The zone's terrain and buildings as three.js meshes (unlit, like the game's baked lighting). */
function buildScene(data: Map3dSceneData): { scene: THREE.Scene; dispose(): void } {
  const scene = new THREE.Scene();
  const owned: Array<{ dispose(): void }> = [];
  for (const chunk of data.chunks) {
    const group = new THREE.Group();
    group.position.set(chunk.worldX, chunk.worldY ?? 0, chunk.worldZ);
    for (const primitive of chunk.primitives) group.add(primitiveMesh(primitive, owned));
    scene.add(group);
  }
  for (const building of data.buildings) {
    const group = new THREE.Group();
    group.position.set(building.worldX, building.worldY, building.worldZ);
    group.rotation.y = building.rotationY * Math.PI / 180;
    for (const primitive of building.primitives) group.add(primitiveMesh(primitive, owned));
    scene.add(group);
  }
  return { scene, dispose: () => owned.forEach((item) => item.dispose()) };
}

function primitiveMesh(primitive: Map3dPrimitive, owned: Array<{ dispose(): void }>): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(primitive.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(primitive.indices, 1));
  if (primitive.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(primitive.uvs, 2));
  if (primitive.colors) geometry.setAttribute("color", new THREE.BufferAttribute(primitive.colors, 3));
  const source = primitive.material;
  const map = source.texture ? dataTexture(source.texture, false, source) : null;
  const material = new THREE.MeshBasicMaterial({
    map,
    color: map ? 0xffffff : new THREE.Color(...source.diffuse),
    vertexColors: Boolean(primitive.colors),
    side: THREE.DoubleSide,
    opacity: source.alpha,
    transparent: source.alpha < 1 || Boolean(map),
    alphaTest: 0.01,
  });
  owned.push(geometry, material);
  if (map) owned.push(map);
  return new THREE.Mesh(geometry, material);
}

function dataTexture(image: DecodedTexture, flipY: boolean, material?: Map3dPrimitive["material"]): THREE.DataTexture {
  const texture = new THREE.DataTexture(image.rgba, image.width, image.height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.flipY = flipY;
  if (material) {
    texture.wrapS = material.repeatS ? (material.flipS ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping) : THREE.ClampToEdgeWrapping;
    texture.wrapT = material.repeatT ? (material.flipT ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping) : THREE.ClampToEdgeWrapping;
  }
  texture.needsUpdate = true;
  return texture;
}

