import { concatBytes, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { compileMoveAnimation, decompileMoveAnimationBytes, getMoveAnimationParticleIds, parseMoveAnimationScript } from "./moveAnimationModel";
import { getGen5BattleSpaWorkspaceBytes } from "./nitroSpa";
import type { ProjectState } from "./projectStore";

type MoveAsset = { sourceMoveId: number; targetMoveId: number; particleIds: number[]; bytes: Uint8Array };
type ParticleAsset = { sourceParticleId: number; bytes: Uint8Array };
export type MoveParticleOptimization = {
  sourceParticleId: number; targetMoveId: number; beforeBytes: number; afterBytes: number[];
  removedResources: number[]; reusedResources: number[][]; detail: string;
};
type Reuse = { resources: number[]; scale?: boolean; life?: boolean };

const LIMIT = 0x4800;
const RULES: Record<number, { count: number; remove?: number[]; reuse?: Reuse[]; detail: string }> = {
  845: { count: 25, remove: [17], detail: "Deduplicate the charge texture and omit the translucent outer projectile halo; retain the cannon, fire and impact layers." },
  914: { count: 31, remove: [3, 8, 19, 22, 25, 28], detail: "Omit a charge glow, its small inner highlight and four secondary white impact cores; retain the wings, colored flares and debris." },
  938: { count: 21, detail: "Deduplicate two byte-identical textures; retain every emitter and command." },
  958: { count: 35, remove: [21, 31], reuse: [
    { resources: [4, 6] }, { resources: [9, 11] }, { resources: [13, 15] },
    { resources: [14, 16] }, { resources: [17, 18, 19, 20] },
    { resources: [5, 7], life: true }, { resources: [10, 12], life: true },
  ], detail: "Reuse timed mallet/ripple definitions, preserve each beat and hold duration, and omit two auxiliary ripple glows." },
  960: { count: 22, reuse: [{ resources: [4, 5, 6] }], detail: "Emit the same charge-ring definition at its original three start times; retain every visible layer." },
  1004: { count: 30, remove: [8, 11, 28, 29], detail: "Deduplicate two textures and omit charge/projectile/impact haze plus a small drifting-snow layer; retain the lances, ice burst and main debris." },
  1013: { count: 25, reuse: [{ resources: [1, 3, 5], scale: true }], detail: "Reuse one timed charge-glow definition with exact per-emission sizes and deduplicate its texture; retain every layer." },
  1016: { count: 25, remove: [24], detail: "Omit the secondary impact haze; retain the three wind projectiles, impact flashes and ice debris." },
  1024: { count: 30, remove: [15, 16, 19, 21, 28, 29], detail: "Omit auxiliary spark trails, two secondary impact cores and the background haze; retain all three ghost orbs and their projectiles." },
  1025: { count: 30, remove: [6, 9, 12], detail: "Deduplicate two textures and omit three brief intermediate white strobes; retain all five red/black cuts, opening/final strobes and all spike resources." },
};

/** Build-time asset changes only. The native 24-emitter/200-particle pools and
 * 18 KiB arena remain unchanged. Exact record copies preserve unknown SPA bits.
 */
export function optimizeMoveExpansionAssets(input: { moves: MoveAsset[]; particles: ParticleAsset[] }) {
  const moves = input.moves.map(move => ({ ...move, particleIds: move.particleIds.slice() }));
  const particles = input.particles.map(particle => ({ ...particle }));
  const report: MoveParticleOptimization[] = [];
  const originalIds = new Set(particles.map(particle => particle.sourceParticleId));
  for (const particle of [...particles]) {
    const beforeBytes = getGen5BattleSpaWorkspaceBytes(particle.bytes);
    if (beforeBytes <= LIMIT) continue;
    const users = moves.filter(move => move.particleIds.includes(particle.sourceParticleId));
    if (users.length !== 1) throw new Error(`Oversize SPA ${particle.sourceParticleId} needs a reviewed single-move optimization.`);
    const move = users[0];
    const original = splitSpa(particle.bytes);
    const script = decompileMoveAnimationBytes(move.bytes);
    if (particle.sourceParticleId === 985) {
      if (original.resources.length !== 70) throw new Error("Terrain Pulse's particle layout changed.");
      const parsed = parseMoveAnimationScript(script);
      const packs = Array.from({ length: 5 }, (_, variant) => {
        const id = variant === 0 ? 985 : 1030 + variant;
        if (variant > 0 && originalIds.has(id)) throw new Error(`Terrain Pulse particle ID ${id} is already occupied.`);
        return { id, ...compactSpa(particle.bytes, Array.from({ length: 14 }, (_, index) => variant * 14 + index)) };
      });
      let label = parsed.labelOrder[0];
      const rewritten = script.split("\n").map(line => {
        const match = /^\s*(\w+):\s*$/u.exec(line);
        if (match) label = match[1];
        const commands = parsed.scripts.get(label) ?? [];
        const emissions = commands.filter(command => command.name === "DoSPAAnimation");
        if (!emissions.length) return line;
        const variant = Math.floor(emissions[0].params[1] / 14);
        if (emissions.some(command => Math.floor(command.params[1] / 14) !== variant)) throw new Error("Terrain Pulse mixes variant resources.");
        const pack = packs[variant];
        return remapParticleLine(line, 985, pack.id, pack.resourceMap);
      }).join("\n");
      particle.bytes = packs[0].bytes;
      for (const pack of packs.slice(1)) particles.push({ sourceParticleId: pack.id, bytes: pack.bytes });
      move.bytes = compileMoveAnimation({} as ProjectState, move.sourceMoveId, rewritten);
      move.particleIds = getMoveAnimationParticleIds(rewritten).sort((a, b) => a - b);
      report.push({ sourceParticleId: 985, targetMoveId: move.targetMoveId, beforeBytes, afterBytes: packs.map(pack => getGen5BattleSpaWorkspaceBytes(pack.bytes)), removedResources: [], reusedResources: [], detail: "Keep the five terrain variants in separate banks; each script loads only its own 14 resources. No layers or timing are changed." });
      continue;
    }
    const rule = RULES[particle.sourceParticleId];
    if (!rule || original.resources.length !== rule.count) throw new Error(`SPA ${particle.sourceParticleId} needs a reviewed optimization for its current layout.`);
    const working = particle.bytes.slice();
    const aliases = new Map<number, { canonical: number; delay: number; scale?: number; life?: number }>();
    for (const group of rule.reuse ?? []) {
      const canonical = group.resources[0];
      const normalized: Uint8Array[] = [];
      const minLife = Math.min(...group.resources.map(index => readU16(original.resources[index], 62)));
      for (const index of group.resources) {
        const record = original.resources[index];
        const next = record.slice();
        const delay = readU16(record, 50);
        const scale = group.scale ? readU32(record, 44) : undefined;
        const life = group.life ? Math.ceil(readU16(record, 62) * 4096 / minLife) : undefined;
        writeU16(next, 50, 0);
        if (group.scale) writeU32(next, 44, 4096);
        if (group.life) {
          // All reviewed mallet holds emit once. The multiplier must retain
          // emitterLife=1 and reconstruct the original integer particle life.
          if (readU16(record, 60) !== 1 || life! < 4096 || life! >= 8192 ||
              Math.floor(minLife * life! / 4096) !== readU16(record, 62)) throw new Error("Cannot preserve mallet lifetime.");
          writeU16(next, 62, minLife);
        }
        normalized.push(next);
        working.set(next, original.resourceOffsets[index]);
        aliases.set(index, { canonical, delay, scale, life });
      }
      if (normalized.some(record => !equalBytes(record, normalized[0]))) throw new Error(`SPA ${particle.sourceParticleId} reuse group changed.`);
    }
    const remove = new Set(rule.remove ?? []);
    const keep = original.resources.map((_resource, index) => index).filter(index => !remove.has(index) && (!aliases.has(index) || aliases.get(index)!.canonical === index));
    const pack = compactSpa(working, keep);
    const rewritten = rewriteEmissions(script, particle.sourceParticleId, pack.resourceMap, remove, aliases);
    particle.bytes = pack.bytes;
    move.bytes = compileMoveAnimation({} as ProjectState, move.sourceMoveId, rewritten);
    report.push({ sourceParticleId: particle.sourceParticleId, targetMoveId: move.targetMoveId, beforeBytes, afterBytes: [getGen5BattleSpaWorkspaceBytes(pack.bytes)], removedResources: [...remove], reusedResources: (rule.reuse ?? []).map(group => group.resources), detail: rule.detail });
  }
  // Each cut starts five frames after the previous one. Three roundtrips per
  // cut overlap native movement tasks and leave the target hidden during the
  // subsequent damage blink. One roundtrip fits between cuts; the final shake
  // and every cut/flash/sound keep their original timing.
  const ceaseless = moves.find(move => move.sourceMoveId === 845 && move.targetMoveId === 910);
  if (ceaseless) {
    const script = decompileMoveAnimationBytes(ceaseless.bytes);
    const overlapping = /^ShakeSprite DEFENDER, 2, 1229, 0, 2, 1, 3$/gmu;
    const count = [...script.matchAll(overlapping)].length;
    if (count !== 0 && count !== 5) throw new Error("Ceaseless Edge's hit-shake layout changed.");
    if (count) ceaseless.bytes = compileMoveAnimation({} as ProjectState, ceaseless.sourceMoveId,
      script.replace(overlapping, "ShakeSprite DEFENDER, 2, 1229, 0, 2, 1, 1"));
  }
  for (const particle of particles) if (getGen5BattleSpaWorkspaceBytes(particle.bytes) > LIMIT) throw new Error(`Optimized SPA ${particle.sourceParticleId} still exceeds the retail arena.`);
  return { moves, particles, report };
}

function rewriteEmissions(script: string, spaId: number, map: Map<number, number>, remove: Set<number>, aliases: Map<number, { canonical: number; delay: number; scale?: number; life?: number }>): string {
  const commands = [...parseMoveAnimationScript(script).scripts.values()].flat();
  const byLine = new Map(commands.map(command => [command.line.trim(), command]));
  const events = new Map<number, string[]>();
  let frame = 0;
  for (const command of commands) {
    if (command.name === "Wait") frame += command.params[0];
    if (command.name !== "DoSPAAnimation" || command.params[0] !== spaId || remove.has(command.params[1])) continue;
    const reuse = aliases.get(command.params[1]);
    if (!reuse) continue;
    const params = command.params.slice();
    params[1] = map.get(reuse.canonical)!;
    if (reuse.scale !== undefined) params[9] = Math.floor((params[9] * reuse.scale + 2048) / 4096);
    if (reuse.life !== undefined) params[8] = Math.floor(params[8] * reuse.life / 4096);
    const time = frame + reuse.delay;
    events.set(time, [...(events.get(time) ?? []), `DoSPAAnimation ${params.join(", ")}`]);
  }
  const output: string[] = [];
  frame = 0;
  let started = false;
  const flush = () => { output.push(...(events.get(frame) ?? [])); events.delete(frame); };
  for (const line of script.split("\n")) {
    const command = byLine.get(line.trim());
    if (command?.name === "DoSPAAnimation" && !started) { started = true; flush(); }
    if (command?.name === "Wait") {
      const end = frame + command.params[0];
      for (const time of [...events.keys()].filter(time => time > frame && time <= end).sort((a, b) => a - b)) {
        output.push(`Wait ${time - frame}`); frame = time; flush();
      }
      if (end > frame) output.push(`Wait ${end - frame}`);
      frame = end;
      continue;
    }
    if (command?.name === "DoSPAAnimation" && command.params[0] === spaId) {
      if (remove.has(command.params[1]) || aliases.has(command.params[1])) continue;
    }
    output.push(remapParticleLine(line, spaId, spaId, map));
  }
  if (events.size) throw new Error("A reused emitter falls outside the move timeline.");
  return output.join("\n");
}

function remapParticleLine(line: string, sourceId: number, targetId: number, resourceMap: Map<number, number>): string {
  const match = /^(\s*)(LoadSPA|Emit|DoSPAAnimation|DeleteSPA)\s+(.+)$/u.exec(line);
  if (!match) return line;
  const params = match[3].split(",").map(value => value.trim());
  if (Number(params[0]) !== sourceId) return line;
  params[0] = String(targetId);
  if (match[2] === "Emit" || match[2] === "DoSPAAnimation") {
    const target = resourceMap.get(Number(params[1]));
    if (target === undefined) throw new Error(`Missing retained emitter ${params[1]}.`);
    params[1] = String(target);
  }
  return `${match[1]}${match[2]} ${params.join(", ")}`;
}

/** Preserve raw resource records and encoded textures; rewrite indices only. */
export function compactSpa(bytes: Uint8Array, resourceIds: number[]) {
  const source = splitSpa(bytes);
  const resourceMap = new Map(resourceIds.map((id, index) => [id, index]));
  const used = new Set<number>();
  const addTexture = (id: number) => {
    if (used.has(id)) return;
    const texture = source.textures[id];
    if (!texture) throw new Error(`Missing SPA texture ${id}.`);
    used.add(id);
    const param = readU32(texture, 4);
    if (param & (1 << 17)) addTexture((param >>> 18) & 255);
  };
  const references = (record: Uint8Array) => {
    const offsets = [71];
    const flags = readU32(record, 0);
    let offset = 88 + ((flags & 256) ? 12 : 0) + ((flags & 512) ? 12 : 0) + ((flags & 1024) ? 8 : 0);
    if (flags & 2048) { for (let index = 0; index < 8; index += 1) offsets.push(offset + index); offset += 12; }
    if (flags & 65536) offsets.push(offset + 15);
    return offsets;
  };
  for (const id of resourceIds) for (const offset of references(source.resources[id])) addTexture(source.resources[id][offset]);
  const textureMap = new Map<number, number>();
  const textures: Uint8Array[] = [];
  for (const id of [...used].sort((a, b) => a - b)) {
    const texture = source.textures[id];
    const duplicate = textures.findIndex(candidate => equalBytes(texture, candidate));
    textureMap.set(id, duplicate >= 0 ? duplicate : textures.length);
    if (duplicate < 0) textures.push(texture.slice());
  }
  for (const texture of textures) {
    const param = readU32(texture, 4);
    if (param & (1 << 17)) writeU32(texture, 4, (param & ~(255 << 18)) | (textureMap.get((param >>> 18) & 255)! << 18));
  }
  const resources = resourceIds.map(id => {
    const record = source.resources[id].slice();
    for (const offset of references(record)) record[offset] = textureMap.get(record[offset])!;
    return record;
  });
  const header = bytes.slice(0, 32);
  writeU16(header, 8, resources.length); writeU16(header, 10, textures.length);
  const resourceBytes = resources.reduce((sum, record) => sum + record.length, 0);
  writeU32(header, 16, resourceBytes); writeU32(header, 20, textures.reduce((sum, texture) => sum + texture.length, 0));
  writeU32(header, 24, 32 + resourceBytes);
  return { bytes: concatBytes([header, ...resources, ...textures]), resourceMap, textureMap };
}

function splitSpa(bytes: Uint8Array) {
  getGen5BattleSpaWorkspaceBytes(bytes);
  const resources: Uint8Array[] = [], textures: Uint8Array[] = [], resourceOffsets: number[] = [];
  let cursor = 32;
  for (let index = 0; index < readU16(bytes, 8); index += 1) {
    const start = cursor, flags = readU32(bytes, cursor); resourceOffsets.push(start);
    cursor += 88;
    for (const [bit, size] of [[8, 12], [9, 12], [10, 8], [11, 12], [16, 20], [24, 8], [25, 8], [26, 16], [27, 4], [28, 8], [29, 16]]) if (flags & (1 << bit)) cursor += size;
    resources.push(bytes.slice(start, cursor));
  }
  for (let index = 0; index < readU16(bytes, 10); index += 1) { const size = readU32(bytes, cursor + 28); textures.push(bytes.slice(cursor, cursor + size)); cursor += size; }
  return { resources, textures, resourceOffsets };
}

function equalBytes(a: Uint8Array, b: Uint8Array) { return a.length === b.length && a.every((value, index) => value === b[index]); }
