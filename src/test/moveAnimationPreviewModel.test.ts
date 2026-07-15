import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { compileMoveAnimation, decompileMoveAnimation } from "../pokeweb/moveAnimationModel";
import { buildMoveAnimationPreview, loadMoveBackground, type MoveAnimationPreview } from "../pokeweb/moveAnimationPreviewModel";
import { simulateBattleCamera } from "../pokeweb/battleCameraSimulator";
import { TARGET_BATTLE_ANCHOR, USER_BATTLE_ANCHOR } from "../pokeweb/battlePreviewAnchors";
import { parseNitroBackground } from "../pokeweb/nitroBg";
import { parseSpaArchive } from "../pokeweb/nitroSpa";
import { simulateSplPreview } from "../pokeweb/splEmitterSimulator";
import type { NarcName } from "../pokeweb/constants";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("moveAnimationPreviewModel", () => {
  it("builds a frame timeline from waits and SPA commands", async () => {
    const project = makeProject();
    const preview = await buildMoveAnimationPreview(
      project,
      1,
      makeScript(`
     LoadSPA 5
     Wait 12
     DoSPAAnimation 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
     TerminateMoveScript
`),
      { loadSpaArchive: async () => parseSpaArchive(makeSyntheticSpa()) },
    );

    expect(preview.spaIds).toEqual([0, 5]);
    expect(preview.timeline.map((event) => [event.frame, event.command])).toEqual([
      [0, "LoadSPA"],
      [0, "Wait"],
      [12, "DoSPAAnimation"],
      [12, "TerminateMoveScript"],
    ]);
    expect(preview.timeline.find((event) => event.command === "DoSPAAnimation")?.spaId).toBe(0);
    expect(preview.timeline.find((event) => event.command === "DoSPAAnimation")?.resourceId).toBe(1);
  });

  it("follows called move animations with a recursion cap", async () => {
    const project = makeProject();
    project.narcs.move_animations!.rawFiles[7] = compileMoveAnimation(
      project,
      7,
      makeScript(`
     LoadSPA 2
     Wait 3
     TerminateMoveScript
`),
    );

    const preview = await buildMoveAnimationPreview(
      project,
      1,
      makeScript(`
     LoadSPA 1
     Wait 2
     CallMoveAnimation 7
`),
      { loadSpaArchive: async () => parseSpaArchive(makeSyntheticSpa()) },
    );

    expect(preview.spaIds).toEqual([1, 2]);
    expect(preview.timeline.map((event) => event.command)).toEqual(["LoadSPA", "Wait", "CallMoveAnimation", "LoadSPA", "Wait", "TerminateMoveScript"]);
    expect(preview.timeline.find((event) => event.command === "LoadSPA" && event.spaId === 2)?.frame).toBe(2);
  });

  it("lazy-loads only unique SPA IDs referenced by LoadSPA", async () => {
    const project = makeProject();
    const loaded: number[] = [];

    await buildMoveAnimationPreview(
      project,
      1,
      makeScript(`
     LoadSPA 3
     DoSPAAnimation 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
     LoadSPA 3
     LoadSPA 4
     TerminateMoveScript
`),
      {
        loadSpaArchive: async (_project, spaId) => {
          loaded.push(spaId);
          return parseSpaArchive(makeSyntheticSpa());
        },
      },
    );

    expect(loaded).toEqual([3, 4]);
  });

  it("supports background timeline events and lazy-loads only referenced backgrounds", async () => {
    const project = makeProject();
    const loaded: number[] = [];
    const [screen, characters, palette] = makeSyntheticBackgroundFiles();

    const preview = await buildMoveAnimationPreview(
      project,
      1,
      makeScript(`
     LoadBackground 3
     MoveBackground 0, 16, -8, 10, 0, 1
     ChangeBackgroundColor 0, 0, 16, 8, 31
     ApplyBackground 0, 0
     TerminateMoveScript
`),
      {
        loadSpaArchive: async () => parseSpaArchive(makeSyntheticSpa()),
        loadBackground: async (_project, backgroundId) => {
          loaded.push(backgroundId);
          return parseNitroBackground(backgroundId, screen, characters, palette);
        },
      },
    );

    expect(loaded).toEqual([3]);
    expect(preview.backgrounds.get(3)?.width).toBe(16);
    expect(preview.timeline.map((event) => [event.command, event.status])).toEqual([
      ["LoadBackground", "supported"],
      ["MoveBackground", "supported"],
      ["ChangeBackgroundColor", "supported"],
      ["ApplyBackground", "supported"],
      ["TerminateMoveScript", "marker"],
    ]);
    expect(preview.timeline.find((event) => event.command === "ChangeBackgroundColor")?.message).toContain("rgb555(31, 0, 0)");
  });

  it("decodes 8bpp Nitro background character tiles", () => {
    const [screen, characters, palette] = makeSyntheticBackgroundFiles8bpp();
    const background = parseNitroBackground(99, screen, characters, palette);

    expect(background.indexed.bitsPerPixel).toBe(8);
    expect(background.width).toBe(16);
    expect(background.height).toBe(16);
    expect([...background.rgba.slice(0, 4)]).toEqual([0, 248, 0, 255]);
    expect(background.warnings).not.toEqual(expect.arrayContaining([expect.stringContaining("bit depth 4")]));
  });

  it("models camera commands as supported timeline events and shared camera state", async () => {
    const project = makeProject();
    const preview = await buildMoveAnimationPreview(
      project,
      1,
      makeScript(`
     MoveCamera 1, 11, 16, 0, 9
     LetCMDsFinish 0
     CameraProjection 1, 11
     ShakeScreen 2, 256, 0, 4, 0, 2
     CameraMoveAngle 1, 45, 12, 8, 0, 0
     AdjustCamera 1, 4096, 8192, 12288, 0, 4096, 0, 6, 0, 0
     CameraPosPush
     TerminateMoveScript
`),
      { loadSpaArchive: async () => parseSpaArchive(makeSyntheticSpa()) },
    );

    expect(preview.timeline.filter((event) => event.command.includes("Camera") || event.command === "ShakeScreen").every((event) => event.status === "supported")).toBe(true);
    expect(preview.timeline.find((event) => event.command === "CameraProjection")?.frame).toBe(16);
    const zoomed = simulateBattleCamera(preview.timeline, 16);
    expect(zoomed.backdropZoom).toBeGreaterThan(1);
    expect(zoomed.lookAt[0]).toBeGreaterThan(0);
  });

  it("does not treat generic setup camera preset 20 as a target zoom", async () => {
    const project = makeProject();
    const preview = await buildMoveAnimationPreview(
      project,
      56,
      makeScript(`
     MoveCamera 1, 20, 24, 0, 0
     Wait 24
     MoveCamera 1, 11, 16, 0, 12
     TerminateMoveScript
`),
      { loadSpaArchive: async () => parseSpaArchive(makeSyntheticSpa()) },
    );

    const setup = simulateBattleCamera(preview.timeline, 24);
    const target = simulateBattleCamera(preview.timeline, 40);
    expect(Math.abs(setup.lookAt[0])).toBeLessThan(3);
    expect(setup.backdropZoom).toBeCloseTo(1);
    expect(target.lookAt[0]).toBeGreaterThan(0);
    expect(target.backdropZoom).toBeGreaterThan(1);
  });

  it("parses a minimal SPA archive and decodes palette textures", () => {
    const archive = parseSpaArchive(makeSyntheticSpa());

    expect(archive.resourceCount).toBe(1);
    expect(archive.textureCount).toBe(1);
    expect(archive.resources[0].emissionCount).toBe(2);
    expect(archive.resources[0].textureIndex).toBe(0);
    expect(archive.textures[0].width).toBe(8);
    expect(archive.textures[0].height).toBe(8);
    expect(archive.textures[0].fallback).toBe(false);
  });

  it("renders Nitro tiled background triples into RGBA", () => {
    const [screen, characters, palette] = makeSyntheticBackgroundFiles();
    const background = parseNitroBackground(0, screen, characters, palette);

    expect(background.width).toBe(16);
    expect(background.height).toBe(16);
    expect(background.rgba[4]).toBeGreaterThan(200);
    expect(background.rgba[5]).toBeLessThan(10);
    expect(background.rgba[6]).toBeLessThan(10);
  });

  it("maps wide text backgrounds in DS screen-block order and normalizes their palette bank base", () => {
    const [screen, characters, palette] = makeSyntheticWideBackgroundFiles();
    const background = parseNitroBackground(0, screen, characters, palette, { paletteBankOffset: 8 });

    const secondTileRow = (8 * background.width) * 4;
    const thirdTileRow = (16 * background.width) * 4;
    expect(background.indexed.paletteBankOffset).toBe(8);
    expect([...background.rgba.slice(secondTileRow, secondTileRow + 4)]).toEqual([248, 0, 0, 255]);
    expect([...background.rgba.slice(thirdTileRow, thirdTileRow + 4)]).toEqual([0, 0, 0, 255]);
  });

  it("simulates SPL particles from emitter data without renderer motion heuristics", () => {
    const archive = parseSpaArchive(makeSyntheticSpa());
    const preview = {
      moveId: 1,
      rootLabel: "SCRIPT_A",
      frameCount: 60,
      spaIds: [0],
      spaArchives: new Map([[0, archive]]),
      backgrounds: new Map(),
      warnings: [],
      timeline: [
        {
          id: "synthetic",
          frame: 0,
          label: "SCRIPT_A",
          command: "DoSPAAnimation",
          params: [0, 0, 0, 0, 0, 0, 0, 0, 4096, 4096, 4096],
          status: "supported" as const,
          message: "synthetic",
          spaId: 0,
          resourceId: 0,
        },
      ],
    };

    const particles = simulateSplPreview(preview, 2);
    expect(particles.length).toBeGreaterThan(0);
    expect(Math.max(...particles.map((particle) => Math.abs(particle.position[0] - USER_BATTLE_ANCHOR[0])))).toBeLessThan(0.001);
    expect(Math.max(...particles.map((particle) => Math.abs(particle.position[2] - USER_BATTLE_ANCHOR[2])))).toBeLessThan(0.001);
  });

  it("anchors projectile emitters at the attack side and aims them at defence", () => {
    const bytes = makeSyntheticSpa();
    writeU32(bytes, 32 + 40, 4096);
    const archive = parseSpaArchive(bytes);
    const preview = makeSyntheticPreview(archive);
    preview.timeline[0] = {
      ...preview.timeline[0],
      command: "DoSPAProjectileAnimation",
      params: [0, 0, 1, 9, 11, 8192, 81920, 0, 4096, 4096, 0],
    };

    const particles = simulateSplPreview(preview, 2);
    expect(particles.length).toBeGreaterThan(0);
    expect(Math.min(...particles.map((particle) => particle.position[0]))).toBeGreaterThan(USER_BATTLE_ANCHOR[0]);
    expect(Math.max(...particles.map((particle) => particle.position[2]))).toBeLessThan(USER_BATTLE_ANCHOR[2]);
    expect(Math.max(...particles.map((particle) => particle.position[0]))).toBeLessThan(TARGET_BATTLE_ANCHOR[0]);
  });

  it("keeps SPA-authored particle velocity in preview-world scale", () => {
    const bytes = makeSyntheticSpa();
    writeU32(bytes, 32 + 40, 4096);
    const archive = parseSpaArchive(bytes);
    const preview = makeSyntheticPreview(archive);
    preview.timeline[0].particle = { sourceTarget: 3, destinationTarget: 4, axis: [1, 0, 0] };

    const particle = simulateSplPreview(preview, 10)[0];
    const displacement = (particle?.position[0] ?? USER_BATTLE_ANCHOR[0]) - USER_BATTLE_ANCHOR[0];
    expect(displacement).toBeGreaterThan(2);
    expect(displacement).toBeLessThan(8);
  });

  it("starts delayed SPL emitters after their delay instead of expiring them early", () => {
    const bytes = makeSyntheticSpa();
    writeU16(bytes, 32 + 50, 4);
    writeU16(bytes, 32 + 60, 5);
    const archive = parseSpaArchive(bytes);
    const preview = makeSyntheticPreview(archive);

    expect(simulateSplPreview(preview, 2)).toHaveLength(0);
    expect(simulateSplPreview(preview, 5).length).toBeGreaterThan(0);
  });

  it("does not emit one-frame SPL resources twice at the same origin", () => {
    const bytes = makeSyntheticSpa();
    writeU32(bytes, 32 + 16, 4096);
    writeU32(bytes, 32 + 68, 0xff01);
    writeU16(bytes, 32 + 60, 1);
    writeU16(bytes, 32 + 62, 10);
    const archive = parseSpaArchive(bytes);
    const preview = makeSyntheticPreview(archive);

    expect(simulateSplPreview(preview, 0)).toHaveLength(1);
    expect(simulateSplPreview(preview, 1)).toHaveLength(1);
  });

  it("uses SPL offset position metadata as the rendered sprite anchor", () => {
    const bytes = makeSyntheticSpa();
    writeU32(bytes, 32 + 76, 1 << 2);
    const archive = parseSpaArchive(bytes);
    const preview = makeSyntheticPreview(archive);
    preview.timeline[0].particle = { sourceTarget: 17, destinationTarget: 4, axis: [1, 0, 0] };

    const particles = simulateSplPreview(preview, 1);
    expect(particles[0]?.anchorX).toBe(0.5);
    expect(particles[0]?.anchorY).toBe(1);
  });

  it("keeps legacy SPA events center anchored like the old sprite renderer", () => {
    const bytes = makeSyntheticSpa();
    writeU32(bytes, 32 + 76, 1 << 2);
    const archive = parseSpaArchive(bytes);
    const preview = makeSyntheticPreview(archive);

    const particles = simulateSplPreview(preview, 1);
    expect(particles[0]?.anchorX).toBe(0.5);
    expect(particles[0]?.anchorY).toBe(0.5);
  });

  it("normalizes HG anchored pane resources so fang jaws stay near their target", () => {
    const bytes = makeSyntheticSpa();
    const resource = 32;
    writeU32(bytes, resource + 16, 4096);
    writeU32(bytes, resource + 8, Math.round(1.561 * 4096));
    writeU32(bytes, resource + 44, Math.round(2.260 * 4096));
    writeU32(bytes, resource + 76, 1 << 2);
    const archive = parseSpaArchive(bytes);
    archive.resources[0].scaleAnim = { start: 0.25, mid: 2, end: 0.25, curveIn: 0.5, curveOut: 0.5, loop: false };
    const preview = makeSyntheticPreview(archive);
    preview.timeline[0].effectKind = "spa";
    preview.timeline[0].particle = { sourceTarget: 4, destinationTarget: 4, useResourceAnchor: true, invertResourceYAxis: true };

    const particle = simulateSplPreview(preview, 1)[0];
    const laterParticle = simulateSplPreview(preview, 24)[0];
    expect(particle?.anchorY).toBe(1);
    expect(particle?.scaleY).toBeGreaterThan(14);
    expect(particle?.scaleY).toBeLessThan(16);
    expect(laterParticle?.scaleY).toBeCloseTo(particle?.scaleY ?? 0, 5);
    const startDistance = Math.abs((particle?.position[1] ?? 0) - TARGET_BATTLE_ANCHOR[1]);
    const laterDistance = Math.abs((laterParticle?.position[1] ?? 0) - TARGET_BATTLE_ANCHOR[1]);
    expect(startDistance).toBeGreaterThan(4);
    expect(laterDistance).toBeLessThan(8);
  });

  it("exposes SPL polygon draw metadata for the preview renderer", () => {
    const bytes = makeSyntheticSpa();
    writeU32(bytes, 32, (2 << 4) | (1 << 17) | (1 << 19));
    writeU32(bytes, 32 + 72, 4096 << 8);
    writeU16(bytes, 32 + 80, 2048);
    writeU16(bytes, 32 + 82, 1024);
    const archive = parseSpaArchive(bytes);
    const preview = makeSyntheticPreview(archive);
    preview.timeline[0].particle = { sourceTarget: 17, destinationTarget: 4, axis: [1, 0, 0] };

    const particle = simulateSplPreview(preview, 1)[0];
    expect(particle).toMatchObject({
      drawType: 2,
      polygonRotAxis: 1,
      polygonReferencePlane: 1,
      polygonOffsetX: 0.5,
      polygonOffsetY: 0.25,
      directionalBillboardScale: 1,
    });
    expect(particle?.scaleX).toBeGreaterThan(0);
    expect(particle?.scaleY).toBeGreaterThan(0);
  });

  it("renders plain legacy SPA polygon resources as billboards until script operators orient them", () => {
    const bytes = makeSyntheticSpa();
    writeU32(bytes, 32, 2 << 4);
    const archive = parseSpaArchive(bytes);
    const preview = makeSyntheticPreview(archive);

    const particle = simulateSplPreview(preview, 1)[0];
    expect(particle?.drawType).toBe(0);
    expect(particle?.tiltScale).toBe(1);
  });

  it("preserves plain SPL directional billboards for slash and streak particles", () => {
    const bytes = makeSyntheticSpa();
    writeU32(bytes, 32, 1 << 4);
    const archive = parseSpaArchive(bytes);
    const preview = makeSyntheticPreview(archive);

    const particle = simulateSplPreview(preview, 1)[0];
    expect(particle?.drawType).toBe(1);
    expect(particle?.scaleX).toBeGreaterThan(0);
    expect(particle?.scaleY).toBeGreaterThan(0);
  });

  it("builds a camera-facing temporal pane grid for screen-plane HG particles", () => {
    const bytes = makeSyntheticSpa();
    writeU32(bytes, 32, 3 | (2 << 6));
    writeU32(bytes, 32 + 16, 16 * 4096);
    writeU32(bytes, 32 + 20, 2 * 4096);
    writeU16(bytes, 32 + 28, 4096);
    writeU32(bytes, 32 + 40, 4096);
    writeU32(bytes, 32 + 68, 0x0080ff00);
    const archive = parseSpaArchive(bytes);
    const preview = makeSyntheticPreview(archive);
    preview.timeline[0].particle = { sourceTarget: 3, destinationTarget: 3, screenPlane: true };

    const particles = simulateSplPreview(preview, 0);
    const laterParticles = simulateSplPreview(preview, 8);
    expect(particles.length).toBeGreaterThan(0);
    expect(uniqueRoundedPositions(particles, 0)).toBe(1);
    expect(uniqueRoundedPositions(particles, 1)).toBe(4);
    expect(laterParticles.every((particle) => Math.abs(particle.relativePosition[2]) < 0.001)).toBe(true);
    expect(uniqueRoundedPositions(laterParticles, 0)).toBeGreaterThanOrEqual(9);
    expect(uniqueRoundedPositions(laterParticles, 1)).toBe(4);
    expect(positionExtent(laterParticles, 0)).toBeGreaterThan(positionExtent(particles, 0) + 1);
    expect(positionExtent(laterParticles, 0)).toBeGreaterThan(positionExtent(laterParticles, 1) * 2);
    expect(positionExtent(laterParticles, 1)).toBeCloseTo(positionExtent(particles, 1), 4);
    expect(laterParticles[0]?.scaleX ?? 0).toBeGreaterThan(laterParticles[0]?.scaleY ?? 0);
  });

  it("orders overlapping SPL emitters in reverse creation order while keeping parent-child order local", () => {
    const archive = parseSpaArchive(makeSyntheticSpa());
    archive.resources = [
      { ...archive.resources[0], index: 0, drawChildFirst: false },
      { ...archive.resources[0], index: 1, drawChildFirst: false },
      { ...archive.resources[0], index: 2, drawChildFirst: true },
    ];
    const preview = makeSyntheticPreview(archive);
    preview.timeline = [0, 1, 2].map((resourceId) => ({
      ...preview.timeline[0],
      id: `synthetic-${resourceId}`,
      resourceId,
    }));

    const particles = simulateSplPreview(preview, 1);
    expect([...new Set(particles.map((particle) => particle.resourceIndex))]).toEqual([2, 1, 0]);
    expect(particles[0].renderLayer).toBe(1);
  });

  it("combines preview texture inversion with SPA-authored texture flips", () => {
    const bytes = makeSyntheticSpa();
    writeU32(bytes, 32 + 76, 0x03);
    const archive = parseSpaArchive(bytes);
    const preview = makeSyntheticPreview(archive);
    preview.timeline[0].particle = { sourceTarget: 3, destinationTarget: 4, invertTextureXAxis: true, invertTextureYAxis: true };

    const particle = simulateSplPreview(preview, 1)[0];
    expect(archive.resources[0].flipTextureS).toBe(true);
    expect(archive.resources[0].flipTextureT).toBe(true);
    expect(particle?.textureFlipS).toBe(false);
    expect(particle?.textureFlipT).toBe(false);
  });

  it("keeps command billboard overrides from flattening SPL polygon particles", () => {
    const bytes = makeSyntheticSpa();
    writeU32(bytes, 32, 2 << 4);
    const archive = parseSpaArchive(bytes);
    const preview = makeSyntheticPreview(archive);
    preview.timeline[0].particle = {
      sourceTarget: 17,
      destinationTarget: 4,
      axis: [1, 0, 0],
      foreshorten: false,
      screenRotation: -0.72,
    };

    const particle = simulateSplPreview(preview, 1)[0];
    expect(particle?.drawType).toBe(2);
    expect(particle?.rotation).toBeCloseTo(0);
    expect(particle?.tiltScale).toBeLessThan(1);
  });

  it("renders command motion-aligned polygon resources as rotated billboards", () => {
    const bytes = makeSyntheticSpa();
    writeU32(bytes, 32, 2 << 4);
    const archive = parseSpaArchive(bytes);
    const preview = makeSyntheticPreview(archive);
    preview.timeline[0].particle = {
      sourceTarget: 3,
      destinationTarget: 4,
      axis: [1, 0, 0],
      alignToMotion: true,
      alignDirection: [20, 0, 0],
      alignRotationOffset: -Math.PI / 2,
      foreshorten: false,
      forceFollowMotion: true,
      originMotion: { from: [0, 0, 0], to: [20, 0, 0], duration: 10, easing: "linear" },
    };

    const particle = simulateSplPreview(preview, 2)[0];
    expect(particle?.drawType).toBe(0);
    expect(particle?.rotation).toBeCloseTo(-Math.PI / 2);
    expect(particle?.tiltScale).toBe(1);
  });

  it("keeps DSPRE screen billboard particles on their authored angle", () => {
    const bytes = makeSyntheticSpa();
    const authoredAngle = (216 * Math.PI) / 180;
    writeU16(bytes, 32 + 56, Math.round((authoredAngle / (Math.PI * 2)) * 65535));
    const archive = parseSpaArchive(bytes);
    const preview = makeSyntheticPreview(archive);
    preview.timeline[0].particle = {
      sourceTarget: 3,
      destinationTarget: 4,
      axis: [1, 0, 0],
      alignToMotion: true,
      alignDirection: [20, 0, 0],
      alignRotationOffset: -Math.PI / 2,
      forceFollowMotion: true,
      dspreScreenRotation: true,
      originMotion: { from: [0, 0, 0], to: [20, 0, 0], duration: 10, easing: "linear" },
    };

    const particle = simulateSplPreview(preview, 2)[0];
    expect(particle?.drawType).toBe(0);
    expect(particle?.sourceDrawType).toBe(0);
    expect(particle?.rotation).toBeCloseTo(authoredAngle + Math.PI, 3);
  });

  it("adds command-driven DistortSprite hit overlay particles", () => {
    const archive = parseSpaArchive(makeSyntheticSpa());
    const preview = makeSyntheticPreview(archive);
    preview.spaIds = [166];
    preview.timeline.push({
      id: "distort",
      frame: 0,
      label: "SCRIPT_A",
      command: "DistortSprite",
      params: [16, 2, 1229, -1229, 2, 1, 1],
      status: "marker",
      message: "distort",
    });

    expect(simulateSplPreview(preview, 3).some((particle) => particle.textureKind === "circle")).toBe(true);
  });

  it("simulates SPL child particles from child resource blocks", () => {
    const archive = parseSpaArchive(makeSyntheticChildSpa());
    const preview = makeSyntheticPreview(archive);
    const particles = simulateSplPreview(preview, 0);

    expect(archive.resources[0].childResource).toBeDefined();
    expect(particles.some((particle) => particle.color[1] > 0.9 && particle.color[0] < 0.1)).toBe(true);
  });
});

function makeSyntheticPreview(archive: ReturnType<typeof parseSpaArchive>): MoveAnimationPreview {
  return {
    moveId: 1,
    rootLabel: "SCRIPT_A",
    frameCount: 60,
    spaIds: [0],
    spaArchives: new Map([[0, archive]]),
    backgrounds: new Map(),
    warnings: [],
    timeline: [
      {
        id: "synthetic",
        frame: 0,
        label: "SCRIPT_A",
        command: "DoSPAAnimation",
        params: [0, 0, 0, 0, 0, 0, 0, 0, 4096, 4096, 4096],
        status: "supported" as "supported" | "marker" | "unsupported",
        message: "synthetic",
        spaId: 0,
        resourceId: 0,
      },
    ],
  };
}

function makeScript(body: string): string {
  return `
.include "B2W2_MOVSCRCMD.s"
.align 4

.word 1 @ Count
${Array.from({ length: 14 }, () => ".word SCRIPT_A").join("\n")}

SCRIPT_A:
${body.trimEnd()}
`;
}

function makeProject(): ProjectState {
  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { move_animations: 1, battle_animations: 2 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      move_animations: makeStore("move_animations", Array.from({ length: 16 }, () => new Uint8Array())),
      battle_animations: makeStore("battle_animations", Array.from({ length: 16 }, () => new Uint8Array())),
    },
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: rawFiles.length,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
}

function makeSyntheticSpa(): Uint8Array {
  const out = new Uint8Array(32 + 88 + 32 + 16 + 8);
  writeU32(out, 0, 0x53504120);
  writeU32(out, 4, 0x315f3231);
  writeU16(out, 8, 1);
  writeU16(out, 10, 1);
  writeU32(out, 16, 88);
  writeU32(out, 20, 56);
  writeU32(out, 24, 32 + 88);

  const resource = 32;
  writeU32(out, resource + 16, 2 * 4096);
  writeU16(out, resource + 34, 0x001f);
  writeU32(out, resource + 44, 4096);
  writeU16(out, resource + 60, 30);
  writeU16(out, resource + 62, 45);
  writeU32(out, resource + 68, 0xff00);

  const texture = 32 + 88;
  writeU32(out, texture, 0x53505420);
  writeU32(out, texture + 4, 2 | (1 << 16));
  writeU32(out, texture + 8, 16);
  writeU32(out, texture + 12, 48);
  writeU32(out, texture + 16, 8);
  writeU32(out, texture + 20, 56);
  writeU32(out, texture + 24, 0);
  writeU32(out, texture + 28, 56);
  out.fill(0x55, texture + 32, texture + 48);
  writeU16(out, texture + 48, 0x0000);
  writeU16(out, texture + 50, 0x001f);
  writeU16(out, texture + 52, 0x03e0);
  writeU16(out, texture + 54, 0x7c00);
  return out;
}

function uniqueRoundedPositions(particles: ReturnType<typeof simulateSplPreview>, axis: 0 | 1 | 2): number {
  return new Set(particles.map((particle) => particle.relativePosition[axis].toFixed(3))).size;
}

function positionExtent(particles: ReturnType<typeof simulateSplPreview>, axis: 0 | 1 | 2): number {
  const values = particles.map((particle) => particle.relativePosition[axis]);
  return Math.max(...values) - Math.min(...values);
}

function makeSyntheticChildSpa(): Uint8Array {
  const out = new Uint8Array(32 + 88 + 20 + 32 + 16 + 8);
  writeU32(out, 0, 0x53504120);
  writeU32(out, 4, 0x315f3231);
  writeU16(out, 8, 1);
  writeU16(out, 10, 1);
  writeU32(out, 16, 88);
  writeU32(out, 20, 56);
  writeU32(out, 24, 32 + 88 + 20);

  const resource = 32;
  writeU32(out, resource, 1 << 16);
  writeU32(out, resource + 16, 1 * 4096);
  writeU16(out, resource + 34, 0x001f);
  writeU32(out, resource + 44, 4096);
  writeU16(out, resource + 60, 30);
  writeU16(out, resource + 62, 45);
  writeU32(out, resource + 68, 0xff00);

  const child = 32 + 88;
  writeU16(out, child, 1 << 6);
  writeU16(out, child + 4, 4096);
  writeU16(out, child + 6, 20);
  out[child + 8] = 0;
  out[child + 9] = 63;
  writeU16(out, child + 10, 0x03e0);
  writeU32(out, child + 12, 2 | (1 << 16));

  const texture = 32 + 88 + 20;
  writeU32(out, texture, 0x53505420);
  writeU32(out, texture + 4, 2 | (1 << 16));
  writeU32(out, texture + 8, 16);
  writeU32(out, texture + 12, 48);
  writeU32(out, texture + 16, 8);
  writeU32(out, texture + 20, 56);
  writeU32(out, texture + 24, 0);
  writeU32(out, texture + 28, 56);
  out.fill(0x55, texture + 32, texture + 48);
  writeU16(out, texture + 48, 0x0000);
  writeU16(out, texture + 50, 0x001f);
  writeU16(out, texture + 52, 0x03e0);
  writeU16(out, texture + 54, 0x7c00);
  return out;
}

function makeSyntheticBackgroundFiles(): [Uint8Array, Uint8Array, Uint8Array] {
  const screen = new Uint8Array(0x24 + 8);
  writeAscii(screen, 0, "RCSN");
  writeU16(screen, 4, 0xfeff);
  writeU16(screen, 6, 1);
  writeU32(screen, 8, screen.length);
  writeU16(screen, 12, 16);
  writeU16(screen, 14, 1);
  writeAscii(screen, 16, "NRCS");
  writeU32(screen, 20, screen.length - 16);
  writeU16(screen, 24, 16);
  writeU16(screen, 26, 16);
  writeU32(screen, 32, 8);
  writeU16(screen, 36, 1);
  writeU16(screen, 38, 1);
  writeU16(screen, 40, 1);
  writeU16(screen, 42, 1);

  const characters = new Uint8Array(0x30 + 64);
  writeAscii(characters, 0, "RGCN");
  writeU16(characters, 4, 0xfeff);
  writeU16(characters, 6, 1);
  writeU32(characters, 8, characters.length);
  writeU16(characters, 12, 16);
  writeU16(characters, 14, 1);
  writeAscii(characters, 16, "RAHC");
  writeU32(characters, 20, characters.length - 16);
  writeU32(characters, 28, 3);
  writeU32(characters, 40, 64);
  for (let offset = 0x30 + 32; offset < characters.length; offset += 1) characters[offset] = 0x11;

  const palette = new Uint8Array(0x28 + 32);
  writeAscii(palette, 0, "RLCN");
  writeU16(palette, 4, 0xfeff);
  writeU16(palette, 6, 1);
  writeU32(palette, 8, palette.length);
  writeU16(palette, 12, 16);
  writeU16(palette, 14, 1);
  writeAscii(palette, 16, "TTLP");
  writeU32(palette, 20, palette.length - 16);
  writeU32(palette, 32, 32);
  writeU16(palette, 42, 0x001f);
  return [screen, characters, palette];
}

function makeSyntheticWideBackgroundFiles(): [Uint8Array, Uint8Array, Uint8Array] {
  const [, characters, palette] = makeSyntheticBackgroundFiles();
  const screen = new Uint8Array(0x24 + 64 * 64 * 2);
  writeAscii(screen, 0, "RCSN");
  writeU16(screen, 4, 0xfeff);
  writeU16(screen, 6, 1);
  writeU32(screen, 8, screen.length);
  writeU16(screen, 12, 16);
  writeU16(screen, 14, 1);
  writeAscii(screen, 16, "NRCS");
  writeU32(screen, 20, screen.length - 16);
  writeU16(screen, 24, 512);
  writeU16(screen, 26, 512);
  writeU32(screen, 32, 64 * 64 * 2);
  writeU16(screen, 36 + 32 * 2, 0x8001);
  return [screen, characters, palette];
}

function makeSyntheticBackgroundFiles8bpp(): [Uint8Array, Uint8Array, Uint8Array] {
  const screen = new Uint8Array(0x24 + 8);
  writeAscii(screen, 0, "RCSN");
  writeU16(screen, 4, 0xfeff);
  writeU16(screen, 6, 1);
  writeU32(screen, 8, screen.length);
  writeU16(screen, 12, 16);
  writeU16(screen, 14, 1);
  writeAscii(screen, 16, "NRCS");
  writeU32(screen, 20, screen.length - 16);
  writeU16(screen, 24, 16);
  writeU16(screen, 26, 16);
  writeU32(screen, 32, 8);
  writeU16(screen, 36, 1);
  writeU16(screen, 38, 1);
  writeU16(screen, 40, 1);
  writeU16(screen, 42, 1);

  const characters = new Uint8Array(0x30 + 128);
  writeAscii(characters, 0, "RGCN");
  writeU16(characters, 4, 0xfeff);
  writeU16(characters, 6, 1);
  writeU32(characters, 8, characters.length);
  writeU16(characters, 12, 16);
  writeU16(characters, 14, 1);
  writeAscii(characters, 16, "RAHC");
  writeU32(characters, 20, characters.length - 16);
  writeU32(characters, 28, 4);
  writeU32(characters, 40, 128);
  characters.fill(2, 0x30 + 64, 0x30 + 128);

  const palette = new Uint8Array(0x28 + 512);
  writeAscii(palette, 0, "RLCN");
  writeU16(palette, 4, 0xfeff);
  writeU16(palette, 6, 1);
  writeU32(palette, 8, palette.length);
  writeU16(palette, 12, 16);
  writeU16(palette, 14, 1);
  writeAscii(palette, 16, "TTLP");
  writeU32(palette, 20, palette.length - 16);
  writeU32(palette, 32, 512);
  writeU16(palette, 44, 0x03e0);
  return [screen, characters, palette];
}

function writeAscii(out: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) out[offset + index] = value.charCodeAt(index);
}
