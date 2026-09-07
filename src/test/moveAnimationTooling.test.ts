import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SpaArchive, SpaResource, SpaTexture } from "../pokeweb/nitroSpa";
import {
  diffSpaArchives,
  hasW2uMoveAnimationRoutingSignature,
  inspectSpaArchive,
  lintMoveAnimationScript,
} from "../../scripts/lib/move-animation-tooling";
import { resolveMoveAnimationWorkflowConfig } from "../../scripts/lib/move-animation-workflow-config";

describe("move animation workflow configuration", () => {
  it("resolves CLI, environment, local file, and portable defaults in order", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moveanim-config-"));
    const serverlessRoot = path.join(root, "Port-Pokeweb", "Pokeweb-Serverless");
    await mkdir(serverlessRoot, { recursive: true });
    await writeFile(path.join(serverlessRoot, ".moveanim.local.json"), JSON.stringify({
      buildRepo: "../local-build",
      mirrorRepo: "../local-mirror",
      cleanRom: "../local-clean.nds",
    }));

    const config = await resolveMoveAnimationWorkflowConfig({
      serverlessRoot,
      cli: { buildRepo: "../cli-build" },
      env: { MOVEANIM_MIRROR_REPO: "../env-mirror" },
    });

    expect(config.sources).toMatchObject({ buildRepo: "cli", mirrorRepo: "env", cleanRom: "local", outputRom: "default", java: "default" });
    expect(config.values.buildRepo).toBe(path.resolve(serverlessRoot, "../cli-build"));
    expect(config.values.mirrorRepo).toBe(path.resolve(serverlessRoot, "../env-mirror"));
    expect(config.values.cleanRom).toBe(path.resolve(serverlessRoot, "../local-clean.nds"));
    expect(config.values.outputRom).toBe(path.resolve(path.dirname(serverlessRoot), "../White2Upgrade.nds"));
    expect(config.values.java).toBe("java");
  });
});

describe("generic SPA inspection and diffing", () => {
  it("reports particle fields and parent/child peak estimates", () => {
    const archive = makeArchive();
    archive.resources[0]!.childResource = {
      usesBehaviors: false,
      hasScaleAnim: false,
      hasAlphaAnim: false,
      rotationType: 0,
      followEmitter: false,
      useChildColor: true,
      drawType: 0,
      polygonRotAxis: 0,
      polygonReferencePlane: 0,
      randomInitVelMag: 0,
      endScale: 1,
      lifeFrames: 4,
      velocityRatio: 1,
      scaleRatio: 1,
      color: [1, 0, 0],
      emissionCount: 1,
      emissionDelay: 0,
      emissionIntervalFrames: 0,
      textureIndex: 0,
      textureTileCountS: 0,
      textureTileCountT: 0,
      flipTextureS: false,
      flipTextureT: false,
      dpolFaceEmitter: false,
    };

    const report = inspectSpaArchive(archive);

    expect(report.resources[0]).toMatchObject({
      textureReferences: [0],
      drawType: 0,
      selfMaintaining: false,
      peak: { peakParents: 6 },
    });
    expect(report.resources[0]!.peak.peakChildren).toBeGreaterThan(0);
  });

  it("allows only explicitly named semantic fields", () => {
    const before = makeArchive();
    const recolored = structuredClone(before);
    recolored.resources[0]!.color = [0, 1, 1];
    expect(diffSpaArchives(before, recolored, ["color"]).disallowed).toHaveLength(0);

    recolored.resources[0]!.baseAlpha = 0.5;
    const report = diffSpaArchives(before, recolored, ["color"]);
    expect(report.disallowed.map((difference) => difference.path)).toContain("resources[0].baseAlpha");
  });

  it("does not expose derived flag changes outside the allowed semantic field", () => {
    const before = makeArchive();
    const animated = structuredClone(before);
    animated.resources[0]!.flags |= 1 << 9;
    animated.resources[0]!.colorAnim = {
      start: [1, 0, 0],
      end: [0, 0, 1],
      curveIn: 0,
      curvePeak: 0.5,
      curveOut: 1,
      interpolate: true,
      loop: false,
      randomStartColor: false,
    };

    const report = diffSpaArchives(before, animated, ["colorAnim"]);

    expect(report.disallowed).toHaveLength(0);
    expect(report.differences.map((difference) => difference.path)).not.toContain("resources[0].flags");
  });

  it("reports texture pixels as one allowlist-controlled semantic change", () => {
    const before = makeArchive();
    const recolored = structuredClone(before);
    recolored.textures[0]!.rgba[0] = 255;

    const denied = diffSpaArchives(before, recolored);
    expect(denied.differences).toHaveLength(1);
    expect(denied.disallowed[0]?.path).toBe("textures[0].pixels");
    expect(diffSpaArchives(before, recolored, ["texturePixels"]).disallowed).toHaveLength(0);
  });
});

describe("retail move animation linting", () => {
  it("recognizes the W2U expanded animation routing helpers", () => {
    const signature = Uint8Array.from(Buffer.from(
      "00b50d4b814205db0c48814201da012101e0733e00210120814200bd" +
      "c0b5064b844205db0548844201da012601e0733c00260127be42c0bd" +
      "ff7f0000a4020000",
      "hex",
    ));
    expect(hasW2uMoveAnimationRoutingSignature(Uint8Array.from([1, 2, ...signature, 3]))).toBe(true);
    signature[10] ^= 0xff;
    expect(hasW2uMoveAnimationRoutingSignature(signature)).toBe(false);
  });

  it("detects more than 16 loaded SPA archives", () => {
    const script = `${Array.from({ length: 17 }, (_, index) => `LoadSPA ${index}`).join("\n")}\nTerminateMoveScript`;
    const archives = new Map(Array.from({ length: 17 }, (_, index) => [index, makeArchive()]));

    const report = lintMoveAnimationScript(script, archives);

    expect(report.metrics.maxLoadedSpas).toBe(17);
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "loaded-spa-limit", severity: "error" })]));
  });

  it("detects more than 16 concurrent moving emitter work entries", () => {
    const projectiles = Array.from({ length: 17 }, () => "DoSPAProjectileAnimation 1, 0, 0, 9, 11, 0, 409600, 0, 4096, 4096, 1").join("\n");
    const report = lintMoveAnimationScript(`LoadSPA 1\n${projectiles}\nTerminateMoveScript`, new Map([[1, makeArchive()]]));

    expect(report.metrics.maxTemporaryEmitters).toBe(17);
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "temporary-emitter-limit", severity: "error" })]));
  });

  it("explains broad waits and identifies the active SPA task", () => {
    const report = lintMoveAnimationScript(
      "LoadSPA 1\nWait 5\nDoSPAAnimation 1, 0, 9, 8, 0, 0, 0, 4096, 4096, 4096, 4096\nLetCMDsFinish 0\nTerminateMoveScript",
      new Map([[1, makeArchive()]]),
    );

    expect(report.waits[0]!.activeTasks.join(" ")).toContain("SPA 1 resource 0");
    expect(report.waits[0]!.waitedUntil).toBeGreaterThan(0);
    expect(Number.isFinite(report.metrics.maxConcurrentParticles)).toBe(true);
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "broad-wait" })]));
  });

  it("flags dirty target sprite and projection state", () => {
    const report = lintMoveAnimationScript(`
DistortSprite 16, 0, 8192, 8192, 0, 0, 0
ChangeVisibility 16, 0
FreezeSprite 16, 1
PokemonShadowVanish 16, 1
CameraProjection 0, 0
TerminateMoveScript
`.trimStart(), new Map());

    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "sprite-scale-dirty",
      "sprite-hidden",
      "sprite-frozen",
      "sprite-shadow-hidden",
      "projection-dirty",
    ]));
  });
});

function makeArchive(): SpaArchive {
  return {
    resourceCount: 1,
    textureCount: 1,
    warnings: [],
    resources: [makeResource()],
    textures: [makeTexture()],
  };
}

function makeResource(): SpaResource {
  return {
    index: 0,
    flags: 0,
    drawType: 0,
    emissionType: 0,
    emissionAxis: 0,
    emissionCount: 2,
    emitterBasePos: [0, 0, 0],
    radius: 0,
    length: 0,
    axis: [0, 1, 0],
    initVelPosAmplifier: 0,
    initVelAxisAmplifier: 0,
    baseScale: 1,
    aspectRatio: 1,
    baseAlpha: 1,
    airResistance: 1,
    emissionIntervalFrames: 1,
    textureIndex: 0,
    loopFrames: 0,
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
    minRotation: 0,
    maxRotation: 0,
    initAngle: 0,
    variance: { baseScale: 0, lifeTime: 0, initVel: 0 },
    emitterLifeFrames: 3,
    particleLifeFrames: 6,
    startDelayFrames: 0,
    color: [1, 1, 1],
    hasRotation: false,
    randomInitAngle: false,
    selfMaintaining: false,
    followEmitter: false,
    hideParent: false,
    randomizeLoopedAnim: false,
    behaviors: [],
  };
}

function makeTexture(): SpaTexture {
  return {
    index: 0,
    format: 7,
    width: 8,
    height: 8,
    textureSize: 128,
    paletteSize: 0,
    paletteIndexSize: 0,
    resourceSize: 160,
    useSharedTexture: false,
    sharedTexId: 0,
    rgba: new Uint8ClampedArray(8 * 8 * 4),
    fallback: false,
  };
}
