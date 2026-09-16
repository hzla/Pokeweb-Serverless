import { buildNitroTexturePreviews, readNitroResources, type Map3dPrimitive } from "./map3dModel";
import {
  NitroReader, NITRO_TEXTURE_IDENTITY, nitroIdentity, nitroIdentityPose, nitroMul, nitroPivotRotation,
  nitroScale, nitroStoredMatrix, nitroTextureUv, nitroTranslation, readNitroJointAnimation, readNitroTextureAnimation,
  type NitroJointPose, type NitroMatrix, type NitroTextureSrt, type NitroVec3,
} from "./nitroAnimation";

type MatrixPair = { position: NitroMatrix; normal: NitroMatrix };
type Expression = (values: MatrixPair[], poses: NitroJointPose[]) => MatrixPair;
export type AnimatedNitroPrimitive = Map3dPrimitive & { polygonAttributes: number };
type Vertex = { position: NitroVec3; normal: NitroVec3; color: NitroVec3; uv: [number, number]; matrix: number; normalMatrix: number; lit: boolean };

export function readNitroBasePose(r: NitroReader, offset: number): NitroJointPose {
  const flags = r.u16(offset), pose = nitroIdentityPose(); let p = offset + 4;
  if (!(flags & 1)) { pose.translation = [r.fx(p), r.fx(p + 4), r.fx(p + 8)]; p += 12; }
  if (!(flags & 2)) {
    if (flags & 8) { pose.rotation = nitroPivotRotation(flags >>> 4 & 15, flags >>> 8, r.s16(p) / 4096, r.s16(p + 2) / 4096); p += 4; }
    else { pose.rotation = nitroStoredMatrix([r.s16(offset + 2) / 4096, ...Array.from({ length: 8 }, (_, i) => r.s16(p + i * 2) / 4096)], 3, 3); p += 16; }
  }
  if (!(flags & 4)) { pose.scale = [r.fx(p), r.fx(p + 4), r.fx(p + 8)]; pose.inverseScale = [r.fx(p + 12), r.fx(p + 16), r.fx(p + 20)]; }
  return pose;
}

/** The DS has separate position and direction matrices. Scale never changes normals. */
export function nitroJointMatrices(parent: MatrixPair, pose: NitroJointPose, inverseParentScale?: NitroVec3): MatrixPair {
  let local = nitroTranslation(pose.translation);
  if (inverseParentScale) local = nitroMul(local, nitroScale(inverseParentScale));
  return { position: nitroMul(parent.position, nitroMul(local, nitroMul(pose.rotation, nitroScale(pose.scale)))), normal: nitroMul(parent.normal, pose.rotation) };
}

export function nitroWeightedMatrices(terms: Array<{ matrix: MatrixPair; inverse: MatrixPair; weight: number }>): MatrixPair {
  const result = { position: Array<number>(16).fill(0), normal: Array<number>(16).fill(0) };
  for (const term of terms) for (const key of ["position", "normal"] as const) {
    const m = nitroMul(term.matrix[key], term.inverse[key]);
    for (let i = 0; i < 16; i++) result[key][i] += m[i] * term.weight;
  }
  result.position[15] = result.normal[15] = 1;
  return result;
}

const rgb = (v: number): NitroVec3 => [v & 31, v >>> 5 & 31, v >>> 10 & 31].map((x) => x / 31) as NitroVec3;
const signed = (v: number, bits: number) => v << (32 - bits) >> (32 - bits);
const PARAMS: Record<number, number> = { 0: 0, 0x10: 1, 0x13: 1, 0x14: 1, 0x15: 0, 0x16: 16, 0x17: 12, 0x18: 16, 0x19: 12, 0x1a: 9, 0x1b: 3, 0x1c: 3, 0x20: 1, 0x21: 1, 0x22: 1, 0x23: 2, 0x24: 1, 0x25: 1, 0x26: 1, 0x27: 1, 0x28: 1, 0x40: 1, 0x41: 0 };

/** Compile SBC and display lists once. Frame sampling only updates reusable vertex buffers. */
export function compileNitroAnimatedModel(bytes: Uint8Array, jointBytes?: Uint8Array, textureBytes?: Uint8Array) {
  const r = new NitroReader(bytes), section = r.block("BMD0", "MDL0"), entries = r.dictionary(section + 8, 4);
  if (entries.length !== 1) throw new Error("Title previews require one model per resource.");
  const base = section + r.u32(entries[0].offset), scalingRule = r.u8(base + 21);
  if (scalingRule > 1 || r.u8(base + 22) !== 0) throw new Error("Unsupported title model scaling or texture convention.");
  const bases = r.dictionary(base + 64, 4).map((entry) => readNitroBasePose(r, base + 64 + r.u32(entry.offset)));
  const joint = jointBytes ? readNitroJointAnimation(jointBytes, bases) : undefined;
  const textureAnimation = textureBytes ? readNitroTextureAnimation(textureBytes) : undefined;
  const resources = readNitroResources(bytes), model = resources.models[0], textures = buildNitroTexturePreviews(resources);
  const matBase = base + r.u32(base + 8);
  const materials = r.dictionary(matBase + 4, 4).map((entry, i) => {
    const offset = matBase + r.u32(entry.offset), flags = r.u16(offset + 30), attributes = r.u32(offset + 12);
    const srt = { ...NITRO_TEXTURE_IDENTITY }; let p = offset + 44;
    if (!(flags & 2)) { srt.scaleS = r.fx(p); srt.scaleT = r.fx(p + 4); p += 8; }
    if (!(flags & 4)) { srt.sin = r.s16(p) / 4096; srt.cos = r.s16(p + 2) / 4096; p += 4; }
    if (!(flags & 8)) { srt.transS = r.fx(p); srt.transT = r.fx(p + 4); }
    if (model.materials[i].textureTransformMode > 1) throw new Error("Generated texture coordinates are not supported in the title preview.");
    const image = textures.find((t) => t.bindings.some((b) => b.materialIndex === i))?.image;
    if (model.materials[i].textureName && !image) throw new Error(`Unable to decode texture for ${entry.name}.`);
    return { ...model.materials[i], texture: image, attributes, srt, ambient: rgb(r.u32(offset + 4) >>> 16), emission: rgb(r.u32(offset + 8) >>> 16) };
  });
  const identity = (): MatrixPair => ({ position: nitroIdentity(), normal: nitroIdentity() });
  const expressions: Expression[] = [identity]; let current = 0;
  const add = (expression: Expression) => { expressions.push(expression); return expressions.length - 1; };
  const stack = new Map<number, number>();
  const restore = (index: number) => { const e = stack.get(index); if (e === undefined) throw new Error(`Uninitialized Nitro matrix slot ${index}.`); return e; };
  const multiply = (position: NitroMatrix, normal = nitroIdentity()) => { const parent = current; current = add((values) => ({ position: nitroMul(values[parent].position, position), normal: nitroMul(values[parent].normal, normal) })); };
  let materialIndex = 0, visible = true;
  const compiled: Array<{ vertices: Vertex[]; primitive: AnimatedNitroPrimitive; material: typeof materials[number] }> = [];
  let position: NitroVec3 = [0, 0, 0], normal: NitroVec3 = [0, 0, 1], color: NitroVec3 = [1, 1, 1], uv: [number, number] = [0, 0], normalMatrix = 0, lit = false;
  const draw = (piece: number) => {
    const material = materials[materialIndex], commands = model.pieces[piece]?.commands;
    if (!commands || !material) throw new Error("Title draw references a missing shape or material.");
    const dl = new NitroReader(commands), vertices: Vertex[] = [], indices: number[] = [];
    let p = 0, mode = 0, start = 0;
    const vertex = () => {
      const i = vertices.length, n = i - start;
      vertices.push({ position: [...position], normal: [...normal], color: [...color], uv: [...uv], matrix: current, normalMatrix, lit });
      if (mode === 0 && n % 3 === 2) indices.push(i - 2, i - 1, i);
      else if (mode === 1 && n % 4 === 3) indices.push(i - 3, i - 2, i - 1, i - 3, i - 1, i);
      else if (mode === 2 && n >= 2) indices.push(...(n % 2 ? [i - 1, i - 2, i] : [i - 2, i - 1, i]));
      else if (mode === 3 && n >= 3 && n % 2) indices.push(i - 3, i - 2, i, i - 3, i, i - 1);
      if (i >= 65535) throw new Error("Title shape exceeds the preview vertex limit.");
    };
    while (p < commands.length) {
      const ops = [dl.u8(p), dl.u8(p + 1), dl.u8(p + 2), dl.u8(p + 3)]; p += 4;
      for (const op of ops) {
        const count = PARAMS[op]; if (count === undefined) throw new Error(`Unsupported title GPU command 0x${op.toString(16)}.`);
        dl.check(p, count * 4); const a = count ? dl.u32(p) : 0;
        const args = Array.from({ length: count }, (_, i) => dl.u32(p + i * 4)); p += count * 4;
        if (op === 0x10 && a !== 2) throw new Error("Title display list changes matrix mode.");
        else if (op === 0x13) stack.set(a & 31, current);
        else if (op === 0x14) current = restore(a & 31);
        else if (op === 0x15) current = 0;
        else if (op >= 0x16 && op <= 0x1a) {
          const m = nitroStoredMatrix(args.map((v) => (v | 0) / 4096), op === 0x1a ? 3 : 4, op === 0x16 || op === 0x18 ? 4 : 3);
          if (op <= 0x17) current = add(() => ({ position: m, normal: m })); else multiply(m, m);
        } else if (op === 0x1b) multiply(nitroScale(args.map((v) => (v | 0) / 4096) as NitroVec3));
        else if (op === 0x1c) multiply(nitroTranslation(args.map((v) => (v | 0) / 4096) as NitroVec3));
        else if (op === 0x20) { color = rgb(a); lit = false; }
        else if (op === 0x21) { normal = [0, 10, 20].map((s) => signed(a >>> s & 1023, 10) / 512) as NitroVec3; normalMatrix = current; lit = true; }
        else if (op === 0x22) uv = [signed(a & 65535, 16) / 16, signed(a >>> 16, 16) / 16];
        else if (op === 0x23) { position = [signed(a & 65535, 16) / 4096, signed(a >>> 16, 16) / 4096, signed(args[1] & 65535, 16) / 4096]; vertex(); }
        else if (op === 0x24) { position = [0, 10, 20].map((s) => signed(a >>> s & 1023, 10) / 64) as NitroVec3; vertex(); }
        else if (op >= 0x25 && op <= 0x27) { const axes = op === 0x25 ? [0, 1] : op === 0x26 ? [0, 2] : [1, 2]; position[axes[0]] = signed(a & 65535, 16) / 4096; position[axes[1]] = signed(a >>> 16, 16) / 4096; vertex(); }
        else if (op === 0x28) { position = position.map((v, i) => v + signed(a >>> (i * 10) & 1023, 10) / 4096) as NitroVec3; vertex(); }
        else if (op === 0x40) { mode = a & 3; start = vertices.length; }
      }
    }
    if (visible && indices.length) compiled.push({ vertices, material, primitive: { material: { name: material.name, diffuse: [1, 1, 1], alpha: material.alpha, texture: material.texture, repeatS: material.repeatS, repeatT: material.repeatT, flipS: material.flipS, flipT: material.flipT }, polygonAttributes: material.attributes, positions: new Float32Array(vertices.length * 3), normals: new Float32Array(vertices.length * 3), colors: new Float32Array(vertices.length * 3), uvs: new Float32Array(vertices.length * 2), indices: new Uint16Array(indices) } });
  };
  let p = base + r.u32(base + 4); const end = matBase;
  while (p < end) {
    const op = r.u8(p++), cmd = op & 31;
    if (cmd === 0) continue;
    if (cmd === 1) break;
    if (cmd === 2) { p++; visible = Boolean(r.u8(p++)); }
    else if (cmd === 3) current = restore(r.u8(p++));
    else if (cmd === 4) { materialIndex = r.u8(p++); const m = materials[materialIndex]; if (!m) throw new Error("Missing title material."); if (m.defaultVertexColor) { color = m.diffuse; lit = false; } }
    else if (cmd === 5) draw(r.u8(p++));
    else if (cmd === 6) {
      const node = r.u8(p++), parentNode = r.u8(p++), flags = r.u8(p++), dest = op & 32 ? r.u8(p++) : undefined;
      if (op & 64) current = restore(r.u8(p++));
      if (!bases[node] || !bases[parentNode]) throw new Error("Missing title joint.");
      const parent = current;
      current = add((values, poses) => nitroJointMatrices(values[parent], poses[node], scalingRule === 1 && flags & 1 ? poses[parentNode].inverseScale : undefined));
      if (dest !== undefined) stack.set(dest, current);
    } else if (cmd === 9) {
      const dest = r.u8(p++), count = r.u8(p++), terms: Array<{ expression: number; inverse: MatrixPair; weight: number }> = [];
      for (let i = 0; i < count; i++) {
        const expression = restore(r.u8(p++)), node = r.u8(p++), weight = r.u8(p++) / 256;
        if (!bases[node]) throw new Error("Missing title envelope joint.");
        const offset = base + r.u32(base + 16) + node * 84;
        terms.push({ expression, weight, inverse: { position: nitroStoredMatrix(Array.from({ length: 12 }, (_, j) => r.fx(offset + j * 4)), 4, 3), normal: nitroStoredMatrix(Array.from({ length: 9 }, (_, j) => r.fx(offset + 48 + j * 4)), 3, 3) } });
      }
      current = add((values) => nitroWeightedMatrices(terms.map((term) => ({ ...term, matrix: values[term.expression] })))); stack.set(dest, current);
    } else if (cmd === 11) { const scale = r.fx(base + (op & 32 ? 32 : 28)); multiply(nitroScale([scale, scale, scale])); }
    else throw new Error(`Unsupported title SBC command 0x${op.toString(16)}.`);
  }
  const values: MatrixPair[] = [];
  const sample = (frame: number) => {
    const poses = joint?.sample(frame) ?? bases, srts = textureAnimation?.sample(frame);
    for (let i = 0; i < expressions.length; i++) values[i] = expressions[i](values, poses);
    for (const { vertices, primitive, material } of compiled) {
      const srt: NitroTextureSrt = srts?.get(material.name) ?? material.srt;
      vertices.forEach((v, i) => {
        const m = values[v.matrix].position, n = values[v.normalMatrix].normal, [x, y, z] = v.position;
        const nx = n[0] * v.normal[0] + n[1] * v.normal[1] + n[2] * v.normal[2], ny = n[4] * v.normal[0] + n[5] * v.normal[1] + n[6] * v.normal[2], nz = n[8] * v.normal[0] + n[9] * v.normal[1] + n[10] * v.normal[2];
        for (let axis = 0; axis < 3; axis++) {
          primitive.positions[i * 3 + axis] = m[axis * 4] * x + m[axis * 4 + 1] * y + m[axis * 4 + 2] * z + m[axis * 4 + 3];
          primitive.normals![i * 3 + axis] = [nx, ny, nz][axis];
          let c = v.color[axis];
          if (v.lit) {
            c = material.emission[axis];
            for (let light = 0; light < 4; light++) if (material.attributes & 1 << light) {
              // Title light vectors are the fixed world-space values from title.c.
              const diffuse = Math.max(0, Math.min(1, light === 0 ? -nx + ny * .5 + nz : nx + ny + nz));
              c += material.ambient[axis] + material.diffuse[axis] * diffuse;
            }
          }
          primitive.colors![i * 3 + axis] = Math.min(1, Math.max(0, c));
        }
        const tex = nitroTextureUv(v.uv[0], v.uv[1], material.width, material.height, srt);
        primitive.uvs![i * 2] = tex[0]; primitive.uvs![i * 2 + 1] = tex[1];
      });
    }
  };
  sample(0);
  return { primitives: compiled.map((c) => c.primitive), textures, frameCount: joint?.frameCount ?? textureAnimation?.frameCount ?? 1, sample };
}

export type NitroAnimatedModel = ReturnType<typeof compileNitroAnimatedModel>;
