import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { optimizeMoveExpansionAssets } from "../pokeweb/moveExpansionAssetOptimization";
import { decompileMoveAnimationBytes, parseMoveAnimationScript } from "../pokeweb/moveAnimationModel";
import { getGen5BattleSpaWorkspaceBytes, parseSpaArchive, type SpaArchive } from "../pokeweb/nitroSpa";
import { readU32, writeU16, writeU32 } from "../nds/binary";

function assets(path: string) {
  const entries = unzipSync(new Uint8Array(readFileSync(new URL(path, import.meta.url))));
  const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"])) as {
    moves: { sourceMoveId: number; targetMoveId: number; particleIds: number[]; animation: string }[];
    particles: { sourceParticleId: number; particle: string }[];
  };
  return {
    moves: manifest.moves.map((move: { sourceMoveId: number; targetMoveId: number; particleIds: number[]; animation: string }) => ({ ...move, bytes: entries[move.animation] })),
    particles: manifest.particles.map((particle: { sourceParticleId: number; particle: string }) => ({ ...particle, bytes: entries[particle.particle] })),
  };
}

const source = assets("./fixtures/move-expansion/oversize-source-animations.zip");
const optimized = optimizeMoveExpansionAssets(source);

describe("retail-budget expanded animation assets", () => {
  it("isolates the native Pyro Ball allowance without weakening retail exports", () => {
    const move = source.moves.find(move => move.sourceMoveId === 780)!;
    const original = source.particles.find(particle => particle.sourceParticleId === 960)!;
    const spa = parseSpaArchive(original.bytes);
    // Copy complete encoded records, including their optional blocks.
    const textureAt = readU32(original.bytes, 24);
    let end = 32;
    for (let i = 0; i < 2; i++) {
      const flags = readU32(original.bytes, end);
      end += 88;
      for (const [bit, size] of [[8, 12], [9, 12], [10, 8], [11, 12], [16, 20], [24, 8], [25, 8], [26, 16], [27, 4], [28, 8], [29, 16]]) if (flags & (1 << bit)) end += size;
    }
    const firstTwo = original.bytes.slice(32, end);
    const extended = new Uint8Array(original.bytes.length + firstTwo.length);
    extended.set(original.bytes.slice(0, textureAt));
    extended.set(firstTwo, textureAt);
    extended.set(original.bytes.slice(textureAt), textureAt + firstTwo.length);
    writeU16(extended, 8, 24);
    writeU32(extended, 16, readU32(original.bytes, 16) + firstTwo.length);
    writeU32(extended, 24, textureAt + firstTwo.length);
    const input = { moves: [move], particles: [{ ...original, bytes: extended }] };
    expect(() => optimizeMoveExpansionAssets(input)).toThrow(/reviewed optimization/);
    const native = optimizeMoveExpansionAssets(input, { nativePyro: true });
    expect(parseSpaArchive(native.particles[0].bytes).resources).toHaveLength(22);
    expect(getGen5BattleSpaWorkspaceBytes(native.particles[0].bytes)).toBeLessThanOrEqual(0x6000);
    expect(() => optimizeMoveExpansionAssets(source, { nativePyro: true })).toThrow(/isolated/);
  });
  it("optimizes all eleven source SPAs below the unchanged 18 KiB limit and is repeatable", () => {
    expect(optimized.report).toHaveLength(11);
    for (const particle of optimized.particles) expect(getGen5BattleSpaWorkspaceBytes(particle.bytes)).toBeLessThan(0x4800);
    expect(optimizeMoveExpansionAssets(optimized).report).toEqual([]);
    const shipped = assets("../assets/data/white2upgradeGen6MoveAnimations.zip");
    for (const particle of optimized.particles) expect(shipped.particles.find((entry: { sourceParticleId: number }) => entry.sourceParticleId === particle.sourceParticleId)?.bytes).toEqual(particle.bytes);
    for (const move of optimized.moves) expect(shipped.moves.find((entry: { sourceMoveId: number }) => entry.sourceMoveId === move.sourceMoveId)?.bytes).toEqual(move.bytes);
  });

  it("preserves every retained layer's texture, physics, dimensions, birth time and lifetime", () => {
    const beforeSpas = new Map(source.particles.map((particle: { sourceParticleId: number; bytes: Uint8Array }) => [particle.sourceParticleId, parseSpaArchive(particle.bytes)]));
    const afterSpas = new Map(optimized.particles.map(particle => [particle.sourceParticleId, parseSpaArchive(particle.bytes)]));
    for (const before of source.moves) {
      const after = optimized.moves.find(move => move.sourceMoveId === before.sourceMoveId)!;
      const report = optimized.report.find(report => report.targetMoveId === before.targetMoveId)!;
      const oldScript = parseMoveAnimationScript(decompileMoveAnimationBytes(before.bytes));
      const newScript = parseMoveAnimationScript(decompileMoveAnimationBytes(after.bytes));
      expect(newScript.count).toBe(oldScript.count);
      const oldLabels = [...oldScript.scripts.values()], newLabels = [...newScript.scripts.values()];
      expect(newLabels).toHaveLength(oldLabels.length);
      for (let variant = 0; variant < oldLabels.length; variant += 1) {
        const oldEvents = events(oldLabels[variant], beforeSpas, new Set(report.removedResources));
        const newEvents = events(newLabels[variant], afterSpas, new Set());
        expect(newEvents, `move ${before.targetMoveId}, variant ${variant}`).toEqual(oldEvents);
        // The dedicated shake audit checks the intentional shake repairs.
        // Every other command retains its parameters and explicit wait time.
        expect(nonParticleEvents(newLabels[variant])).toEqual(nonParticleEvents(oldLabels[variant]));
      }
    }
  });

  it("keeps one shake per Ceaseless Edge cut and preserves the final impact shake", () => {
    const move = optimized.moves.find(move => move.targetMoveId === 910)!;
    const commands = [...parseMoveAnimationScript(decompileMoveAnimationBytes(move.bytes)).scripts.values()].flat();
    const shakes = commands.filter(command => command.name === "ShakeSprite");
    expect(shakes.map(command => command.params)).toEqual([
      ...Array.from({ length: 5 }, () => [16, 2, 1229, 0, 2, 1, 1]),
      [16, 2, 1638, 0, 2, 1, 12],
    ]);
  });

  it("selects a single 14-resource Terrain Pulse bank for each of its five variants", () => {
    const move = optimized.moves.find(move => move.sourceMoveId === 805)!;
    const scripts = parseMoveAnimationScript(decompileMoveAnimationBytes(move.bytes));
    expect(scripts.count).toBe(5);
    const banks = new Set<number>();
    for (const commands of scripts.scripts.values()) {
      const loads = commands.filter(command => command.name === "LoadSPA");
      expect(loads).toHaveLength(1);
      const id = loads[0].params[0]; banks.add(id);
      const spa = optimized.particles.find(particle => particle.sourceParticleId === id)!;
      expect(parseSpaArchive(spa.bytes).resources).toHaveLength(14);
      expect(commands.filter(command => command.name === "DoSPAAnimation").every(command => command.params[0] === id)).toBe(true);
    }
    expect(banks.size).toBe(5);
  });
});

type Command = ReturnType<typeof parseMoveAnimationScript>["scripts"] extends Map<string, infer T> ? T extends Array<infer C> ? C : never : never;

function events(commands: Command[], spas: Map<number, SpaArchive>, removed: Set<number>) {
  let frame = 0;
  const rows: string[] = [];
  for (const command of commands) {
    if (command.name === "Wait") frame += command.params[0];
    if (command.name !== "DoSPAAnimation" || removed.has(command.params[1])) continue;
    const params = command.params;
    const spa = spas.get(params[0])!;
    const resource = structuredClone(spa.resources[params[1]]);
    const pixelKey = (id: number) => createHash("sha256").update(spa.textures[id].rgba).digest("hex");
    const { index: _index, rawHeader: _raw, startDelayFrames, textureIndex, ...rest } = resource;
    rest.baseScale = Math.floor(Math.round(rest.baseScale * 4096) * params[9] / 4096) / 4096;
    rest.particleLifeFrames = Math.floor(rest.particleLifeFrames * params[8] / 4096);
    rest.emitterLifeFrames = Math.floor(rest.emitterLifeFrames * params[8] / 4096);
    const texAnim = rest.texAnim ? { ...rest.texAnim, textures: rest.texAnim.textures.slice(0, rest.texAnim.textureCount).map(pixelKey) } : undefined;
    rows.push(JSON.stringify({ frame: frame + startDelayFrames, anchor: params.slice(2, 7), radius: params[7], speed: params[10], texture: pixelKey(textureIndex), resource: { ...rest, texAnim } }));
  }
  return rows.sort();
}

function nonParticleEvents(commands: Command[]) {
  let frame = 0;
  return commands.flatMap(command => {
    if (command.name === "Wait") { frame += command.params[0]; return []; }
    if (["DoSPAAnimation", "LoadSPA", "ShakeSprite"].includes(command.name)) return [];
    return [{ frame, name: command.name, params: command.params }];
  });
}
