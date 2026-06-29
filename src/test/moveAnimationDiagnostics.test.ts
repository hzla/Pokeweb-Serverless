import { describe, expect, it } from "vitest";
import { analyzeMoveAnimationScript, analyzeSpaArchive } from "../pokeweb/moveAnimationDiagnostics";
import type { SpaArchive, SpaResource, SpaTexture } from "../pokeweb/nitroSpa";

describe("move animation diagnostics", () => {
  it("summarizes script dependencies and likely timeline", () => {
    const analysis = analyzeMoveAnimationScript(`
LoadSPA 5
Wait 12
DoSPAAnimation 5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
LoadBackground 126
MoveCamera 1, 11, 0, 0, 15
ShakeSprite 16, 1, 2, 3, 4, 5, 6
PlaySound 1483, 2, 14, 0, 0, 100, 0, 0, 0
TerminateMoveScript
`);

    expect(analysis.ok).toBe(true);
    expect(analysis.loadedSpaIds).toEqual([5]);
    expect(analysis.spawnedSpaEvents).toEqual([{ frame: 12, command: "DoSPAAnimation", spaId: 5, resourceId: 1, label: "SCRIPT_60" }]);
    expect(analysis.backgrounds[0]).toMatchObject({ command: "LoadBackground", backgroundId: 126 });
    expect(analysis.cameraCommands.map((event) => event.command)).toEqual(["MoveCamera"]);
    expect(analysis.spriteCommands.map((event) => event.command)).toEqual(["ShakeSprite"]);
    expect(analysis.sounds.map((event) => event.soundId)).toEqual([1483]);
    expect(analysis.waitCommands).toEqual([{ frame: 0, frames: 12, label: "SCRIPT_60" }]);
    expect(analysis.warnings).toEqual([]);
  });

  it("warns when SPA emitters are spawned before loading their archive", () => {
    const analysis = analyzeMoveAnimationScript(`
DoSPAAnimation 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
TerminateMoveScript
`);

    expect(analysis.warnings).toEqual(["SCRIPT_60 frame 0: DoSPAAnimation references SPA 9 before LoadSPA."]);
  });

  it("detects donor SPA fields that commonly leak color, scale, alpha, children, behavior, and texture constraints", () => {
    const archive = makeDiagnosticSpaArchive();
    const report = analyzeSpaArchive(archive, { spaId: 777, selectedResourceIndex: 0 });
    const selectedTitles = report.selectedResourceDiagnostics.map((diagnostic) => diagnostic.title);
    const archiveTitles = [...report.archiveDiagnostics, ...report.textureDiagnostics].map((diagnostic) => diagnostic.title);

    expect(selectedTitles).toContain("Emitter tint is not white");
    expect(selectedTitles).toContain("Color animation curve");
    expect(selectedTitles).toContain("Alpha animation curve");
    expect(selectedTitles).toContain("Scale animation curve");
    expect(selectedTitles).toContain("Texture animation");
    expect(selectedTitles).toContain("Child particle resource");
    expect(selectedTitles).toContain("Particle behaviors");
    expect(selectedTitles).toContain("Delayed emitter start");
    expect(selectedTitles).toContain("Baked size data");
    expect(selectedTitles).toContain("Spawn volume");
    expect(selectedTitles).toContain("Rotation/random angle");
    expect(archiveTitles).toContain("Color curves present");
    expect(archiveTitles).toContain("Texture 0 uses legacy format 3");
  });
});

function makeDiagnosticSpaArchive(): SpaArchive {
  const texture: SpaTexture = {
    index: 0,
    format: 3,
    width: 16,
    height: 16,
    textureSize: 256,
    paletteSize: 32,
    paletteIndexSize: 0,
    resourceSize: 320,
    useSharedTexture: false,
    sharedTexId: 0,
    rgba: new Uint8ClampedArray(16 * 16 * 4),
    fallback: false,
  };
  return {
    resourceCount: 1,
    textureCount: 1,
    resources: [makeDiagnosticResource()],
    textures: [texture],
    warnings: [],
  };
}

function makeDiagnosticResource(): SpaResource {
  return {
    index: 0,
    flags: 0,
    drawType: 0,
    emissionType: 2,
    emissionAxis: 1,
    emissionCount: 4,
    emitterBasePos: [0, 1, 0],
    radius: 8,
    length: 2,
    axis: [0, 1, 0],
    initVelPosAmplifier: 0,
    initVelAxisAmplifier: 0,
    baseScale: 1.5,
    aspectRatio: 0.5,
    baseAlpha: 1,
    airResistance: 1,
    emissionIntervalFrames: 1,
    textureIndex: 0,
    loopFrames: 30,
    textureTileCountS: 0,
    textureTileCountT: 0,
    scaleAnimDir: 0,
    directionalBillboardScale: 1,
    dpolCenter: false,
    flipTextureS: false,
    flipTextureT: false,
    offsetPos: 0,
    polygonX: 0,
    polygonY: 0,
    polygonRotAxis: 0,
    polygonReferencePlane: 0,
    drawChildFirst: false,
    cameraOffset: false,
    minRotation: 0.25,
    maxRotation: 0.5,
    initAngle: 0.25,
    variance: {
      baseScale: 0,
      lifeTime: 0,
      initVel: 0,
    },
    emitterLifeFrames: 30,
    particleLifeFrames: 20,
    startDelayFrames: 3,
    color: [1, 0.25, 0.5],
    hasRotation: true,
    randomInitAngle: true,
    followEmitter: false,
    hideParent: false,
    randomizeLoopedAnim: false,
    scaleAnim: { start: 0.25, mid: 1, end: 2, curveIn: 0.2, curveOut: 0.8, loop: false },
    colorAnim: { start: [1, 0, 0], end: [0, 1, 0], curveIn: 0.2, curvePeak: 0.5, curveOut: 0.8, randomStartColor: false, loop: false, interpolate: true },
    alphaAnim: { start: 0, mid: 1, end: 0, randomRange: 0, curveIn: 0.2, curveOut: 0.8, loop: false },
    texAnim: { textures: [0], textureCount: 1, step: 0.5, randomizeInit: false, loop: false },
    childResource: {
      usesBehaviors: false,
      hasScaleAnim: false,
      hasAlphaAnim: true,
      rotationType: 0,
      followEmitter: false,
      useChildColor: true,
      drawType: 0,
      polygonRotAxis: 0,
      polygonReferencePlane: 0,
      randomInitVelMag: 0,
      endScale: 0.5,
      lifeFrames: 10,
      velocityRatio: 0.5,
      scaleRatio: 0.5,
      color: [0.5, 1, 0.5],
      emissionCount: 2,
      emissionDelay: 0,
      emissionIntervalFrames: 1,
      textureIndex: 0,
      textureTileCountS: 0,
      textureTileCountT: 0,
      flipTextureS: false,
      flipTextureT: false,
      dpolFaceEmitter: false,
    },
    behaviors: [{ type: "collision", y: 0, elasticity: 1, collisionType: 1 }],
  };
}
