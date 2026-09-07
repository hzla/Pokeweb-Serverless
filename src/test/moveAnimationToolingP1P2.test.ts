import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { simulateBattleCamera } from "../pokeweb/battleCameraSimulator";
import { analyzeMoveAnimationSegments, composeMoveAnimationSegments, extractMoveAnimationSegment } from "../pokeweb/moveAnimationSegments";
import { getMoveAnimationCommandDefinitions } from "../pokeweb/moveAnimationModel";
import { getMoveAnimationPreviewSupport, type MoveAnimationPreview } from "../pokeweb/moveAnimationPreviewModel";
import { formatMoveAnimationParam, parseMoveAnimationParamToken } from "../pokeweb/moveAnimationParamSemantics";
import { getMoveAnimationVmEnumFixtures, getMoveAnimationVmSchema } from "../pokeweb/moveAnimationVmSchema";
import type { SpaArchive, SpaResource, SpaTexture } from "../pokeweb/nitroSpa";
import { applySpaResourceColor, cloneSpaResource, extractSpaResources, transformSpaArchiveTexture, transformSpaTexture } from "../pokeweb/spaTransform";
import { searchMoveAnimationDonors, type MoveAnimationReferenceIndex } from "../../scripts/lib/move-animation-donors";
import { generateMoveAnimationSnapshots, selectAutomaticSnapshotFrames } from "../../scripts/lib/move-animation-snapshots";
import { importSpaTexturePng } from "../../scripts/lib/spa-texture-import";

describe("P1 donor preparation and segment composition", () => {
  it("ranks matching donors while honoring sound and background filters", () => {
    const index = {
      generatedAt: "fixture",
      rom: "fixture",
      baseRom: "white2",
      baseVersion: "white2",
      moves: [
        donor(10, ["projectile", "impact"], [1400], false, 30),
        { ...donor(10, ["projectile", "impact"], [1400], false, 2), moveName: "Move 10", moveDescription: "" },
        donor(11, ["projectile", "impact"], [1400], true, 10),
        donor(12, ["projectile"], [1400], false, 5),
      ],
    } satisfies MoveAnimationReferenceIndex;

    const matches = searchMoveAnimationDonors(index, { tags: ["projectile", "impact"], sounds: [1400], noBackground: true });

    expect(matches.map((match) => match.move.moveId)).toEqual([10]);
    expect(matches[0]!.move.commandCount).toBe(30);
  });

  it("extracts dependencies and composes readable terminating segments", () => {
    const script = `LoadSPA 7\nLoadBackground 12\nWait 5\nDoSPAProjectileAnimation 7, 0, 0, 9, 11, 0, 4096, 0, 4096, 4096, 1\nWait 8\nShakeSprite 16, 0, 4096, 0, 2, 0, 2\nApplyBackground 0, 1\nTerminateMoveScript\n`;
    const analysis = analyzeMoveAnimationSegments(script);
    expect(analysis.inferred.map((range) => range.name)).toEqual(expect.arrayContaining(["setup", "projectile", "impact", "cleanup", "background"]));
    const projectile = extractMoveAnimationSegment(script, "projectile", { phase: "projectile" });
    expect(projectile.script).toContain("LoadSPA 7");
    expect(projectile.script).toContain("DoSPAProjectileAnimation 7");
    const impact = extractMoveAnimationSegment(script, "impact", { phase: "impact" });
    const composed = composeMoveAnimationSegments([projectile, impact]);
    expect(composed.script.match(/LoadSPA 7/gu)).toHaveLength(1);
    expect(composed.script.trimEnd().endsWith("TerminateMoveScript")).toBe(true);
  });
});

describe("P1 shared SPA transformations", () => {
  it("requires a deliberate mode for every donor field and scrubs hidden state", () => {
    const resource = makeResource();
    resource.colorAnim = { start: [1, 0, 0], end: [0, 0, 1], curveIn: 0, curvePeak: 0.5, curveOut: 1, randomStartColor: true, loop: true, interpolate: true };
    resource.startDelayFrames = 9;
    resource.behaviors = [{ type: "gravity", magnitude: [1, 2, 3] }];
    const clone = cloneSpaResource(resource, {
      color: "scrub",
      alpha: "preserve",
      scale: "preserve",
      texture: "preserve",
      child: "scrub",
      startDelay: "scrub",
      behaviors: "scrub",
    });
    expect(clone.color).toEqual([1, 1, 1]);
    expect(clone.colorAnim).toBeUndefined();
    expect(clone.startDelayFrames).toBe(0);
    expect(clone.behaviors).toEqual([]);
  });

  it("compacts resource texture references and rotates non-square pixels", () => {
    const archive = makeArchive();
    archive.textures.push({ ...makeTexture(), index: 1, width: 16, height: 8, rgba: patternedRgba(16, 8) });
    archive.textureCount = 2;
    archive.resources[0]!.textureIndex = 1;
    const extracted = extractSpaResources(archive, [0], () => preservePolicy());
    expect(extracted.archive.textureCount).toBe(1);
    expect(extracted.archive.resources[0]!.textureIndex).toBe(0);
    const texture = extracted.archive.textures[0]!;
    transformSpaTexture(texture, { rotate: 90, flipX: true });
    expect([texture.width, texture.height]).toEqual([8, 16]);
    expect(texture.sourceChanged).toBe(true);
  });

  it("updates donor flip metadata through an explicit orientation policy", () => {
    const archive = makeArchive();
    archive.resources[0]!.flipTextureS = true;
    transformSpaArchiveTexture(archive, 0, { flipX: true }, "compose-resource-flips");
    expect(archive.resources[0]!.flipTextureS).toBe(false);
    transformSpaArchiveTexture(archive, 0, { rotate: 180 }, "clear-resource-flips");
    expect([archive.resources[0]!.flipTextureS, archive.resources[0]!.flipTextureT]).toEqual([false, false]);
  });

  it("imports PNG textures through each supported DS format with a quantization report", () => {
    const png = new PNG({ width: 8, height: 8 });
    for (let index = 0; index < 64; index += 1) png.data.set(index % 2 ? [255, 32, 180, 255] : [32, 180, 255, 96], index * 4);
    for (const [format, expected] of [["direct", 7], ["a5i3", 6], ["a3i5", 1]] as const) {
      const archive = makeArchive();
      const report = importSpaTexturePng(archive, 0, PNG.sync.write(png), format);
      expect(report).toMatchObject({ requestedFormat: format, format: expected, width: 8, height: 8 });
      expect(Number.isFinite(report.meanAbsoluteError)).toBe(true);
      expect(archive.textures[0]!.format).toBe(expected);
    }
  });

  it("applies a three-anchor random spectrum to parent and child colors", () => {
    const resource = makeResource();
    resource.childResource = {
      usesBehaviors: false, hasScaleAnim: false, hasAlphaAnim: false, rotationType: 0, followEmitter: false, useChildColor: false,
      drawType: 0, polygonRotAxis: 0, polygonReferencePlane: 0, randomInitVelMag: 0, endScale: 1, lifeFrames: 4,
      velocityRatio: 1, scaleRatio: 1, color: [1, 1, 1], emissionCount: 1, emissionDelay: 0, emissionIntervalFrames: 0,
      textureIndex: 0, textureTileCountS: 0, textureTileCountT: 0, flipTextureS: false, flipTextureT: false, dpolFaceEmitter: false,
    };
    applySpaResourceColor(resource, [[1, 0, 1], [0, 1, 1], [1, 1, 0]], { randomSpectrum: true, child: true });
    expect(resource.colorAnim).toMatchObject({ start: [0, 1, 1], end: [1, 1, 0], randomStartColor: true });
    expect(resource.childResource).toMatchObject({ color: [0, 1, 1], useChildColor: true });
  });
});

describe("P1/P2 VM schema and Swan conformance", () => {
  it("covers every opcode and stays aligned with compiler definitions", () => {
    const schema = getMoveAnimationVmSchema();
    const definitions = getMoveAnimationCommandDefinitions();
    expect(schema).toHaveLength(78);
    expect(schema.map((command) => command.opcode)).toEqual(Array.from({ length: 78 }, (_, index) => index));
    expect(schema.map((command) => [command.name, command.argumentCount])).toEqual(definitions.map((command) => [command.name, command.params.length]));
    expect(schema.every((command) => command.swan.handler !== "UNKNOWN" && command.swan.source.endsWith("btlv_effvm.c"))).toBe(true);
    expect(schema.map((command) => [command.name, command.preview])).toEqual(schema.map((command) => [command.name, getMoveAnimationPreviewSupport(command.name)]));
    expect(schema.filter((command) => command.preview === "supported").every((command) => command.state.reads.length > 0 && command.state.writes.length > 0)).toBe(true);
  });

  it("round trips every semantic enum fixture through its canonical short name", () => {
    for (const fixture of getMoveAnimationVmEnumFixtures()) {
      expect(parseMoveAnimationParamToken(fixture.command.name, fixture.param.index, fixture.value.name)).toBe(fixture.value.value);
      for (const alias of fixture.value.aliases ?? []) {
        expect(parseMoveAnimationParamToken(fixture.command.name, fixture.param.index, alias)).toBe(fixture.value.value);
      }
      const formatted = formatMoveAnimationParam(fixture.command.name, fixture.param.index, fixture.value.value);
      expect(parseMoveAnimationParamToken(fixture.command.name, fixture.param.index, formatted)).toBe(fixture.value.value);
    }
  });

  it("round trips every declared FX32 display unit", () => {
    const tokens = { multiplier: "1x", world: "1px", frame: "1f" } as const;
    const fx32Params = getMoveAnimationVmSchema().flatMap((command) => command.params
      .filter((param) => param.fx32Unit)
      .map((param) => ({ command, param })));
    expect(new Set(fx32Params.map(({ param }) => param.fx32Unit))).toEqual(new Set(Object.keys(tokens)));
    for (const { command, param } of fx32Params) {
      const token = tokens[param.fx32Unit!];
      expect(parseMoveAnimationParamToken(command.name, param.index, token)).toBe(4096);
      expect(formatMoveAnimationParam(command.name, param.index, 4096)).toBe(token);
    }
  });

  it("matches Swan's relative camera mode for Shadow Ball's opening adjustment", () => {
    const timeline: MoveAnimationPreview["timeline"] = [{
      id: "shadow-ball-camera",
      frame: 0,
      label: "SCRIPT_60",
      command: "AdjustCamera",
      params: [2, 3 * 4096, 0, 3 * 4096, 0, 0, 0, 16, 0, 12],
      status: "supported",
      message: "Shadow Ball opening camera",
    }];
    const complete = simulateBattleCamera(timeline, 16);
    expect(complete.position).toEqual([9.7, 6.7, 20.3]);
    expect(complete.lookAt).toEqual([0, 2.6, 0]);
  });
});

describe("P1 deterministic preview snapshots", () => {
  it("selects semantic key frames and writes both side contact sheets", async () => {
    const preview = makePreview();
    expect(selectAutomaticSnapshotFrames(preview)).toEqual(expect.arrayContaining([0, 5, 9, 12, 29]));
    const directory = await mkdtemp(path.join(os.tmpdir(), "moveanim-snapshots-"));
    const report = await generateMoveAnimationSnapshots({ preview, outputDirectory: directory, frames: "auto" });
    expect(report.sides.map((side) => side.name)).toEqual(["normal", "swapped"]);
    for (const side of report.sides) expect((await readFile(path.join(directory, side.contactSheet))).subarray(1, 4).toString()).toBe("PNG");
  });
});

function donor(moveId: number, tags: string[], soundIds: number[], hasSpecialBackground: boolean, commandCount: number) {
  return { moveId, moveName: `Donor ${moveId}`, moveDescription: "fixture move", sourcePath: "a/0/6/5", fileIndex: moveId, byteLength: 100, estimatedWaitFrames: 20, commandCount, commandNames: ["DoSPAAnimation"], spaIds: [1], spaResources: [{ spaId: 1, resourceId: 0, commands: ["DoSPAAnimation"], tags }], backgroundIds: [], soundIds, cameraCommands: [], hasSpecialBackground, tags, summary: "fixture" };
}

function preservePolicy() {
  return { color: "preserve", alpha: "preserve", scale: "preserve", texture: "preserve", child: "preserve", startDelay: "preserve", behaviors: "preserve" } as const;
}

function makeArchive(): SpaArchive {
  return { resourceCount: 1, textureCount: 1, resources: [makeResource()], textures: [makeTexture()], warnings: [] };
}

function makeResource(): SpaResource {
  return {
    index: 0, flags: 0, drawType: 0, emissionType: 0, emissionAxis: 0, emissionCount: 1,
    emitterBasePos: [0, 0, 0], radius: 0, length: 0, axis: [0, 1, 0], initVelPosAmplifier: 0, initVelAxisAmplifier: 0,
    baseScale: 1, aspectRatio: 1, baseAlpha: 1, airResistance: 1, emissionIntervalFrames: 1, textureIndex: 0,
    loopFrames: 0, textureTileCountS: 0, textureTileCountT: 0, scaleAnimDir: 0, directionalBillboardScale: 1,
    dpolCenter: false, flipTextureS: false, flipTextureT: false, offsetPos: 0, polygonX: 0, polygonY: 0,
    polygonRotAxis: 0, polygonReferencePlane: 0, drawChildFirst: false, cameraOffset: false, minRotation: 0, maxRotation: 0,
    initAngle: 0, variance: { baseScale: 0, lifeTime: 0, initVel: 0 }, emitterLifeFrames: 3, particleLifeFrames: 6,
    startDelayFrames: 0, color: [1, 1, 1], hasRotation: false, randomInitAngle: false, selfMaintaining: false,
    followEmitter: false, hideParent: false, randomizeLoopedAnim: false, behaviors: [],
  };
}

function makeTexture(): SpaTexture {
  return { index: 0, format: 7, width: 8, height: 8, textureSize: 128, paletteSize: 0, paletteIndexSize: 0, resourceSize: 160, useSharedTexture: false, sharedTexId: 0, rgba: patternedRgba(8, 8), fallback: false };
}

function patternedRgba(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) rgba.set([index % 255, (index * 2) % 255, 255, 255], index * 4);
  return rgba;
}

function makePreview(): MoveAnimationPreview {
  const archive = makeArchive();
  return {
    moveId: 722,
    frameCount: 30,
    rootLabel: "SCRIPT_1",
    spaIds: [1],
    spaArchives: new Map([[1, archive]]),
    backgrounds: new Map(),
    warnings: [{ command: "FreezeSprite", message: "marker fixture" }],
    timeline: [
      { id: "camera", frame: 0, label: "SCRIPT_1", command: "MoveCamera", params: [1, 11, 5, 0, 0], status: "supported", message: "camera" },
      { id: "projectile", frame: 5, label: "SCRIPT_1", command: "DoSPAProjectileAnimation", params: [1, 0], status: "supported", message: "projectile", effectKind: "spa", spaId: 1, resourceId: 0, taskDuration: 4, particle: { projectile: true, sourceTarget: 9, destinationTarget: 11 } },
      { id: "impact", frame: 12, label: "SCRIPT_1", command: "ShakeSprite", params: [16, 0, 4096, 0, 2, 0, 2], status: "supported", message: "impact" },
      { id: "end", frame: 29, label: "SCRIPT_1", command: "TerminateMoveScript", params: [], status: "marker", message: "end" },
    ],
  };
}
