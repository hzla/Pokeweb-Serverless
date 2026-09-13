import {
  getPokemonAnimation, getPokemonMultiCellAnimation, getPokemonMultiCells,
  getPokemonSpriteImage, getRigCells, pokemonAnimationPlayerStateAtTick, resolvePokemonSpriteId,
  type PokemonAnimationFrame, type PokemonAnimationSequence, type PokemonMultiCell,
  type RgbaImageData, type RigCell,
} from "./pokemonSpriteModel";
import { findPwanOverrideForSpecies } from "./pwanAnimationModel";
import { pwanFrameRgbaImage, pwanTimeline, validatePwan } from "./pwanCompiler";
import type { ProjectState } from "./projectStore";

export type PokemonBattleSpritePart = {
  image: RgbaImageData;
  source: [number, number, number, number];
  position: [number, number];
  transform: [number, number, number, number, number, number];
};

export type PokemonBattleSpriteAnimation = {
  kind: "native" | "pwan";
  width: number;
  height: number;
  origin: [number, number];
  frameAtTick: (tick: number) => { key: string; parts: PokemonBattleSpritePart[] };
};

export function loadPokemonBattleSpriteAnimation(
  project: ProjectState, speciesId: number, side: "front" | "back", formIndex = 0,
): PokemonBattleSpriteAnimation | undefined {
  if (project.session.baseRom !== "BW" && project.session.baseRom !== "BW2") return undefined;
  try {
    const override = findPwanOverrideForSpecies(project, speciesId, formIndex)?.[side];
    if (override) return createPwanBattleSpriteAnimation(override.pwanBytes);
  } catch {
    // Missing or invalid custom data must not hide a usable native sprite.
  }
  try {
    const spriteId = resolvePokemonSpriteId(project, speciesId, formIndex);
    return createNativeBattleSpriteAnimation(
      getPokemonSpriteImage(project, spriteId, { kind: "rig", side, gender: "male" }, "normal"),
      getRigCells(project, spriteId, side).cells,
      getPokemonAnimation(project, spriteId, side).sequences,
      getPokemonMultiCells(project, spriteId, side).cells,
      getPokemonMultiCellAnimation(project, spriteId, side).sequences[0],
    );
  } catch {
    return undefined;
  }
}

export function createPwanBattleSpriteAnimation(bytes: Uint8Array): PokemonBattleSpriteAnimation {
  const header = validatePwan(bytes);
  const timeline = pwanTimeline(bytes);
  const totalTicks = timeline.reduce((sum, entry) => sum + Math.max(1, entry.ticks), 0);
  if (!totalTicks) throw new Error("PWAN has no animation frames.");
  const images = new Map<number, RgbaImageData>();
  return {
    kind: "pwan", width: header.width, height: header.height,
    origin: [header.width / 2, header.height],
    frameAtTick(tick) {
      let remaining = Math.max(0, Math.floor(tick)) % totalTicks;
      let index = timeline[0]!.frameIndex;
      for (const entry of timeline) {
        index = entry.frameIndex;
        if (remaining < Math.max(1, entry.ticks)) break;
        remaining -= Math.max(1, entry.ticks);
      }
      let image = images.get(index);
      if (!image) { image = pwanFrameRgbaImage(bytes, index); images.set(index, image); }
      return { key: String(index), parts: [{ image, source: [0, 0, image.width, image.height], position: [-image.width / 2, -image.height], transform: [1, 0, 0, 1, 0, 0] }] };
    },
  };
}

export function createNativeBattleSpriteAnimation(
  image: RgbaImageData, cells: RigCell[], sequences: PokemonAnimationSequence[],
  multiCells: PokemonMultiCell[], outerSequence?: PokemonAnimationSequence,
): PokemonBattleSpriteAnimation | undefined {
  if (!cells.length || !multiCells.length || !sequences.some((sequence) => sequence.frames.length)) return undefined;
  return {
    kind: "native", width: 256, height: 256, origin: [128, 192],
    frameAtTick(tick) {
      tick = Math.max(0, Math.floor(tick));
      const outerPlayback = outerSequence?.frames.length ? pokemonAnimationPlayerStateAtTick(outerSequence, tick) : undefined;
      const outer = outerPlayback ? outerSequence!.frames[outerPlayback.frameIndex] : undefined;
      const multiCell = multiCells[outer?.cellIndex ?? 0] ?? multiCells[0]!;
      const parts: PokemonBattleSpritePart[] = [];
      const keys = [String(outerPlayback?.frameIndex ?? 0)];
      // MCSS draws nodes back-to-front; restart/continue/hold use NMAR's
      // current frame start, not a wall-clock timer in the browser.
      for (const node of [...multiCell.nodes].reverse()) {
        if (!node.visible) continue;
        const sequence = sequences[node.sequenceNumber];
        if (!sequence?.frames.length) continue;
        const nodeTick = node.playMode === 2 ? 0 : node.playMode === 1 ? tick : Math.max(0, tick - (outerPlayback?.frameStartTick ?? 0));
        const playback = pokemonAnimationPlayerStateAtTick(sequence, nodeTick);
        const frame = sequence.frames[playback.frameIndex]!;
        keys.push(`${node.sequenceNumber}:${playback.frameIndex}`);
        const cell = cells[frame.cellIndex];
        if (!cell) continue;
        const inner = frameTransform(frame);
        inner[4] += node.x;
        inner[5] += node.y;
        const transform = outer ? multiplyTransforms(frameTransform(outer), inner) : inner;
        for (const part of [cell, cell.subCell]) {
          if (part.width <= 0 || part.height <= 0) continue;
          parts.push({ image, source: [part.cellX, part.cellY, part.width, part.height], position: [part.spriteX, -part.spriteY], transform });
        }
      }
      return { key: keys.join("/"), parts };
    },
  };
}

function frameTransform(frame: PokemonAnimationFrame): PokemonBattleSpritePart["transform"] {
  const angle = frame.rotation * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return [frame.xScale * cos, frame.xScale * sin, -frame.yScale * sin, frame.yScale * cos, frame.x, frame.y];
}

function multiplyTransforms(a: PokemonBattleSpritePart["transform"], b: PokemonBattleSpritePart["transform"]): PokemonBattleSpritePart["transform"] {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
