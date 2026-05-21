import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { writeU16, writeU32 } from "../nds/binary";
import { Folder, saveFnt } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { compileHgMoveAnimationScript, decompileHgMoveAnimation, loadHgMoveAnimationRom } from "../pokeweb/hgMoveAnimationModel";
import {
  buildHgMoveAnimationPreview,
  DEFAULT_HG_MOVE_ANIMATION_PREVIEW_SCENARIO,
  type HgMoveAnimationPreviewScenario,
} from "../pokeweb/hgMoveAnimationPreviewModel";
import { buildPokemonAnimationFile, buildPokemonCellBankFileFromParsed } from "../pokeweb/pokemonSpriteWriters";
import { simulateSplPreview } from "../pokeweb/splEmitterSimulator";

const BASE_SCENARIO: HgMoveAnimationPreviewScenario = { ...DEFAULT_HG_MOVE_ANIMATION_PREVIEW_SCENARIO };

describe("hgMoveAnimationPreviewModel", () => {
  it("builds a particle timeline from HG load/add/wait commands", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    loadparticle 0, 0
    addparticle 0, 0, ANIM_TARGET_USER
    wait 5
    waitparticle
    end
`,
      BASE_SCENARIO,
    );

    expect(preview.spaIds).toEqual([0]);
    expect(preview.timeline.map((event) => event.command)).toContain("addparticle");
    expect(preview.timeline.find((event) => event.command === "waitparticle")?.frame).toBe(5);
    expect(preview.frameCount).toBeGreaterThanOrEqual(50);
    const particles = simulateSplPreview(preview, 2);
    expect(particles.length).toBeGreaterThan(0);
    expect(particles[0]).toMatchObject({ textureRepeatS: 2, textureRepeatT: 2 });
  });

  it("uses scenario controls to choose HG branch paths", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const script = `
a010_000:
    checkturn turn_a, turn_b
turn_a:
    wait 3
    end
turn_b:
    wait 9
    end
`;

    const first = await buildHgMoveAnimationPreview(state, "move", 0, script, { ...BASE_SCENARIO, checkturn: 0 });
    const second = await buildHgMoveAnimationPreview(state, "move", 0, script, { ...BASE_SCENARIO, checkturn: 1 });

    expect(first.timeline.find((event) => event.command === "wait")?.params[0]).toBe(3);
    expect(second.timeline.find((event) => event.command === "wait")?.params[0]).toBe(9);
  });

  it("follows call/return and bounded loops", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    call setup
    loop 2
body:
    wait 4
    doloop
    end
setup:
    wait 1
    return
`,
      BASE_SCENARIO,
    );

    expect(preview.timeline.filter((event) => event.command === "wait").map((event) => event.params[0])).toEqual([1, 4, 4]);
  });

  it("emits preview events for HG-engine helper macros", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    shadeattackingmon 31, 0, 0
    shaketargetmon 4, 7
    shakescreen
    end
`,
      BASE_SCENARIO,
    );

    expect(preview.timeline.map((event) => event.command)).toEqual(expect.arrayContaining(["ShadeActor", "ShakeSprite", "ShakeScreen"]));
  });

  it("emits CATS cell resource effects for HG addsomething scripts", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      184,
      `
a010_184:
    initresources 0, 1, 1, 1, 1, 1, 0, 0
    loadresources 0, 8
    loadpalette 0, 8, 1
    loadcell 0, 8
    loadcellanm 0, 8
    addsomething 0, 7, 8, 8, 8, 8, 0, 0, 0
    wait 8
    waitstate
    end
`,
      BASE_SCENARIO,
    );

    const event = preview.timeline.find((timelineEvent) => timelineEvent.command === "addsomething");
    expect(event).toMatchObject({
      effectKind: "cell",
      cellEffectId: "8:8:8:8",
      cellEffect: { charId: 8, paletteId: 8, cellId: 8, animationId: 8, supportFuncId: 7, duration: 40, origin: [-13.75, 17.25, 19.5] },
    });
    expect(preview.timeline.find((timelineEvent) => timelineEvent.command === "end")?.frame).toBe(40);
  });

  it("adds Bonemerang CATS cell motion from user to target and back", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      155,
      `
a010_155:
    initresources 0, 1, 1, 1, 1, 1, 0, 0
    loadresources 0, 155
    loadpalette 0, 155, 1
    loadcell 0, 155
    loadcellanm 0, 155
    addsomething 0, 6, 155, 155, 155, 155, 0, 0, 0
    end
`,
      BASE_SCENARIO,
    );

    const event = preview.timeline.find((timelineEvent) => timelineEvent.command === "addsomething");
    expect(event?.cellEffect?.supportFuncId).toBe(6);
    expect(event?.cellEffect?.origin?.[0]).toBeLessThan(0);
    expect(event?.cellEffect?.motion?.legs).toHaveLength(2);
    expect(event?.cellEffect?.motion?.legs[0].from[0]).toBeLessThan(0);
    expect(event?.cellEffect?.motion?.legs[0].to[0]).toBeGreaterThan(0);
    expect(event?.cellEffect?.motion?.legs[1].to[0]).toBeLessThan(0);
    expect(event?.cellEffect?.duration).toBe(20);
  });

  it("adds Icicle Spear CATS cell motion from user to target", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      333,
      `
a010_333:
    initresources 0, 3, 1, 1, 1, 1, 0, 0
    loadresources 0, 333
    loadpalette 0, 333, 1
    loadcell 0, 333
    loadcellanm 0, 333
    addsomething 0, 17, 333, 333, 333, 333, 0, 0, 4, -15, -5, 10, 32
    end
`,
      BASE_SCENARIO,
    );

    const event = preview.timeline.find((timelineEvent) => timelineEvent.command === "addsomething");
    const leg = event?.cellEffect?.motion?.legs[0];
    expect(event?.cellEffect?.supportFuncId).toBe(17);
    expect(event?.cellEffect?.duration).toBe(10);
    expect(event?.cellEffect?.motion?.faceMotion).toBe(true);
    expect(leg?.from[0]).toBeLessThan(0);
    expect(leg?.to[0]).toBeGreaterThan(0);
    expect(leg?.duration).toBe(10);
    expect(leg?.arcHeight).toBeGreaterThan(2);
  });

  it("adds String Shot CATS webbing on the defender and a tight defender-side laser", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      81,
      `
a010_081:
    loadparticle 0, 0
    addparticle 0, 0, 17
    particle_operator 0, 2, 6, 5, 0, 0
    initresources 0, 3, 1, 1, 1, 1, 0, 0
    loadresources 0, 1
    loadpalette 0, 1, 1
    loadcell 0, 1
    loadcellanm 0, 1
    addsomething 0, 1, 1, 1, 1, 1, 0, 0, 1, 3
    end
`,
      BASE_SCENARIO,
    );

    const beam = preview.timeline.find((timelineEvent) => timelineEvent.command === "addparticle");
    expect(beam?.particle?.origin?.[0]).toBeLessThan(-10);
    expect(beam?.particle?.axis?.[0]).toBeGreaterThan(0);
    expect(beam?.particle?.radiusMultiplier).toBeLessThan(1);
    expect(beam?.particle?.beamTrail?.start[0]).toBeLessThan(-10);

    const web = preview.timeline.find((timelineEvent) => timelineEvent.command === "addsomething");
    expect(web?.cellEffect).toMatchObject({
      supportFuncId: 1,
      duration: 115,
      origin: [15, 9.75, -9],
    });
    expect(web?.cellEffect?.instances).toHaveLength(3);
    expect(web?.cellEffect?.instances?.map((instance) => instance.startFrame)).toEqual([8, 13, 18]);
  });

  it("adds Lock-On CATS reticle motion from its source support function", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      199,
      `
a010_199:
    initresources 0, 1, 1, 1, 1, 1, 0, 0
    loadresources 0, 10
    loadpalette 0, 10, 1
    loadcell 0, 10
    loadcellanm 0, 10
    addsomething 0, 9, 10, 10, 10, 10, 0, 0, 0
    wait 16
    loop 4
    playsepan 1801, 117
    wait 8
    doloop
    playsepan 1840, 117
    waitstate
    freeresources 0
    end
`,
      BASE_SCENARIO,
    );

    const event = preview.timeline.find((timelineEvent) => timelineEvent.command === "addsomething");
    expect(event?.cellEffect).toMatchObject({
      supportFuncId: 9,
      duration: 92,
      origin: [15, 14.5, -9],
      scale: 1.1,
    });
    expect(preview.timeline.find((timelineEvent) => timelineEvent.command === "end")?.frame).toBe(92);
  });

  it("loads scanned effectclact cell assets with NCER 1D boundary tile mapping", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom({ includeEffectClact: true, includeEffectClactDecoy: true }));
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      184,
      `
a010_184:
    initresources 0, 1, 1, 1, 1, 1, 0, 0
    loadresources 0, 8
    loadpalette 0, 8, 1
    loadcell 0, 8
    loadcellanm 0, 8
    addsomething 0, 7, 8, 8, 8, 8, 0, 0, 0
    waitstate
    end
`,
      BASE_SCENARIO,
    );

    const effect = preview.cellEffects?.get("8:8:8:8");
    expect(effect?.frames).toHaveLength(1);
    const pixel = effect?.frames[0].rgba.subarray(0, 4);
    expect(Array.from(pixel ?? [])).toEqual([0, 0, 255, 255]);
  });

  it("keeps normal addparticle anchored unless cmd37 supplies a particle axis", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const anchored = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    loadparticle 0, 0
    addparticle 0, 0, ANIM_TARGET_USER
    end
`,
      BASE_SCENARIO,
    );
    const anchoredEvent = anchored.timeline.find((event) => event.command === "addparticle");
    expect(anchoredEvent?.particle?.sourceTarget).toBe(3);
    expect(anchoredEvent?.particle?.destinationTarget).toBe(3);

    const withAxis = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    loadparticle 0, 0
    addparticle 0, 0, ANIM_TARGET_MISC
    cmd37 6, 0, 2, 6, 1, 0, 0
    end
`,
      BASE_SCENARIO,
    );
    const axisEvent = withAxis.timeline.find((event) => event.command === "addparticle");
    expect(axisEvent?.particle?.origin).toBeDefined();
    expect(axisEvent?.particle?.axis).toBeDefined();
    expect(axisEvent?.message).toContain("cmd37 attacker laser axis");
  });

  it("anchors EMTFUNC_AT_SIDE shield particles on the user side", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      113,
      `
a010_113:
    loadparticle 0, 0
    addparticle 0, 0, 19
    addparticle 0, 0, 19
    end
`,
      BASE_SCENARIO,
    );

    const particles = simulateSplPreview(preview, 2);
    expect(particles.length).toBeGreaterThan(0);
    expect(particles[0].position[0]).toBeLessThan(0);
  });

  it("anchors emitter callbacks to the source attacker and defender clients", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    loadparticle 0, 0
    addparticle 0, 0, 3
    addparticle 0, 0, 4
    addparticle 0, 0, 19
    addparticle 0, 0, 20
    end
`,
      { ...BASE_SCENARIO, attackerSide: "opponent" },
    );

    const events = preview.timeline.filter((event) => event.command === "addparticle");
    expect(events[0].particle?.origin?.[0]).toBeGreaterThan(0);
    expect(events[1].particle?.origin?.[0]).toBeLessThan(0);
    expect(events[2].particle?.origin?.[0]).toBeGreaterThan(0);
    expect(events[3].particle?.origin?.[0]).toBeLessThan(0);
  });

  it("warns instead of failing when a loaded SPA is missing from a029", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    loadparticle 0, 9
    addparticle 0, 0, ANIM_TARGET_DEFENDER
    end
`,
      BASE_SCENARIO,
    );

    expect(preview.warnings.some((warning) => warning.message.includes("SPA 9"))).toBe(true);
  });

  it("loads HG move backgrounds from changebg commands", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    changebg 0, 0x800001
    waitforchangebg
    resetbg 0, 0x1000001
    end
`,
      BASE_SCENARIO,
    );

    expect(preview.timeline.map((event) => event.command)).toEqual(expect.arrayContaining(["LoadBackground", "ApplyBackground"]));
    expect(preview.backgrounds.get(0)?.width).toBe(16);
    expect(preview.backgrounds.get(0)?.height).toBe(16);
  });

  it("translates HG cmd0C background scratch params into continuous background scroll", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    cmd0C 4, 1
    cmd0C 0, 0
    cmd0C 1, 32
    changebg 0, 0x20001
    waitforchangebg
    end
`,
      BASE_SCENARIO,
    );

    const scroll = preview.timeline.find((event) => event.command === "MoveBackground");
    expect(scroll?.params).toEqual([0, 0, 12, 9999, 0, 0]);
  });

  it("treats HG PLANM backgrounds as palette animation, not implicit scrolling", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    cmd0C 7, 1
    changebg 17, 0x800001
    waitforchangebg
    end
`,
      BASE_SCENARIO,
    );

    const scroll = preview.timeline.find((event) => event.command === "MoveBackground");
    expect(scroll).toBeUndefined();
    const palette = preview.timeline.find((event) => event.command === "BackgroundPaletteAnimation");
    expect(palette?.params).toEqual([17, 1]);
    expect(preview.backgroundPaletteAnimations?.get(17)?.frames[0]).toEqual({ paletteIndex: 0, wait: 2 });
    const load = preview.timeline.find((event) => event.command === "LoadBackground");
    expect(load?.backgroundEffect).toBe("hgDiagonalBeam");
  });

  it("translates HG callfunction 76 into raster-wave background distortion", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      94,
      `
a010_094:
    changebg 52, 0x800001
    waitforchangebg2
    callfunction 76, 1, 50, "NaN", "NaN", "NaN", "NaN", "NaN", "NaN", "NaN", "NaN", "NaN"
    waitforchangebg
    end
`,
      BASE_SCENARIO,
    );

    expect(preview.timeline.find((event) => event.command === "DistortBackground")?.params).toEqual([0, 50, 32, 200]);
    expect(preview.timeline.find((event) => event.command === "DistortBackground")?.status).toBe("supported");
  });

  it("does not scroll Fire Blast style PLANM backgrounds without HAIKEI move flags", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      126,
      `
a010_126:
    cmd0C 7, 1
    changebg 22, 0x800001
    waitforchangebg
    resetbg 22, 0x1000001
    end
`,
      BASE_SCENARIO,
    );

    expect(preview.timeline.find((event) => event.command === "MoveBackground")).toBeUndefined();
    expect(preview.timeline.filter((event) => event.command === "BackgroundPaletteAnimation").map((event) => event.params)).toEqual([
      [22, 1],
      [22, 0],
    ]);
    expect(preview.backgroundPaletteAnimations?.get(22)?.paletteArcId).toBe(11);
  });

  it("finds HG PLANM palette animations even when the source filename path is absent", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom({ includePlanmPath: false }));
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      126,
      `
a010_126:
    cmd0C 7, 1
    changebg 22, 0x800001
    waitforchangebg
    end
`,
      BASE_SCENARIO,
    );

    expect(preview.timeline.find((event) => event.command === "BackgroundPaletteAnimation")?.params).toEqual([22, 1]);
    expect(preview.backgroundPaletteAnimations?.get(22)?.frames).toEqual([
      { paletteIndex: 0, wait: 2 },
      { paletteIndex: 1, wait: 4 },
    ]);
    expect(preview.warnings.some((warning) => warning.message.includes("PLANM"))).toBe(false);
  });

  it("keeps Hydro Pump style cmd37 emitters on the user while aiming at target", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    cmd0C 6, 1
    cmd0C 7, 1
    cmd0C 0, -32
    changebg 0, 0x20001
    loadparticle 0, 0
    addparticle 0, 3, ANIM_TARGET_MISC
    cmd37 6, 0, 2, 8, 1, 0, 0
    addparticle 0, 4, ANIM_TARGET_MISC
    cmd37 6, 0, 2, 10, 6, 0, 0
    end
`,
      BASE_SCENARIO,
    );

    const scroll = preview.timeline.find((event) => event.command === "MoveBackground");
    expect(scroll?.params).toEqual([0, 12, 0, 9999, 0, 0]);
    const particles = preview.timeline.filter((event) => event.command === "addparticle");
    expect(particles[0].particle?.origin?.[0]).toBeLessThan(0);
    expect(particles[0].particle?.origin?.[0]).toBeGreaterThan(-18);
    expect(particles[1].particle?.origin?.[0]).toBeLessThan(0);
    expect(particles[1].particle?.origin?.[0]).toBeGreaterThan(-18);
    expect(particles[1].particle?.axis).toBeDefined();
  });

  it("places HG Bite jaws and impact flashes around the target", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    loadparticle 0, 75
    addparticle 0, 0, ANIM_TARGET_DEFENDER
    addparticle 0, 3, ANIM_TARGET_DEFENDER
    addparticle 0, 1, ANIM_TARGET_DEFENDER
    addparticle 0, 4, ANIM_TARGET_DEFENDER
    addparticle 0, 2, ANIM_TARGET_DEFENDER
    end
`,
      BASE_SCENARIO,
    );

    const events = preview.timeline.filter((event) => event.command === "addparticle");
    const impacts = events.find((event) => event.resourceId === 0);
    const lowerJaw = events.find((event) => event.resourceId === 1);
    const lowerFollowThrough = events.find((event) => event.resourceId === 2);
    const upperJaw = events.find((event) => event.resourceId === 3);
    const upperFollowThrough = events.find((event) => event.resourceId === 4);

    expect(impacts?.particle?.emissionOffsets).toEqual([
      [-2.25, 0, 0],
      [2.25, 0, 0],
    ]);
    expect(upperJaw?.particle).toMatchObject({ useResourceAnchor: true, invertResourceYAxis: true, scaleMultiplier: 0.46 });
    expect(lowerJaw?.particle).toMatchObject({ useResourceAnchor: true, invertResourceYAxis: true, scaleMultiplier: 0.46 });
    expect(upperJaw?.particle?.originMotion).toBeUndefined();
    expect(lowerJaw?.particle?.originMotion).toBeUndefined();
    expect(upperFollowThrough?.particle?.useResourceAnchor).toBe(true);
    expect(lowerFollowThrough?.particle?.useResourceAnchor).toBe(true);
  });

  it("applies callfunction 66 as parabolic emitter motion", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      42,
      `
a010_042:
    loadparticle 0, 0
    addparticle2 0, 1, 2, 3
    callfunction 66, 6, 1, 0, 0, 0, 13, 64
    end
`,
      BASE_SCENARIO,
    );

    const emitter = preview.timeline.find((event) => event.command === "addparticle2");
    expect(emitter?.particle?.forceFollowMotion).toBe(true);
    expect(emitter?.particle?.alignToMotion).toBe(true);
    expect(emitter?.particle?.alignDirection?.[0]).toBeCloseTo(33);
    expect(emitter?.particle?.alignDirection?.[1]).toBeCloseTo(6);
    expect(emitter?.particle?.alignDirection?.[2]).toBeCloseTo(-28);
    expect(emitter?.particle?.alignRotationOffset).toBeCloseTo(-Math.PI / 2);
    expect(emitter?.particle?.originMotion).toMatchObject({ from: [0, 0, 0], duration: 13, easing: "linear" });
    expect(emitter?.particle?.originMotion?.to[0]).toBeCloseTo(33);
    expect(emitter?.particle?.originMotion?.to[1]).toBeCloseTo(6);
    expect(emitter?.particle?.originMotion?.to[2]).toBeCloseTo(-28);
    expect(emitter?.particle?.originMotion?.arcHeight).toBeCloseTo(6.01);
    expect(emitter?.particle?.axis?.[0]).toBeGreaterThan(0);
    expect(preview.timeline.find((event) => event.command === "ParabolicEmitter")?.status).toBe("supported");

    const early = simulateSplPreview(preview, 2)[0]?.position;
    const later = simulateSplPreview(preview, 10)[0]?.position;
    expect(later?.[0]).toBeGreaterThan(early?.[0] ?? -Infinity);
    expect(later?.[0]).toBeGreaterThan(0);
  });

  it("applies callfunction 52 as battler sprite horizontal motion", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      20,
      `
a010_020:
    callfunction 52, 3, 3, 24, 258
    waitstate
    callfunction 52, 3, 3, -24, 258
    end
`,
      BASE_SCENARIO,
    );

    const events = preview.timeline.filter((event) => event.command === "BattlerSlideX");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      status: "supported",
      actorMotion: { target: "user", duration: 3 },
    });
    expect(events[0].actorMotion?.offset[0]).toBeGreaterThan(0);
    expect(events[1].actorMotion?.offset[0]).toBeLessThan(0);
    expect(events[1].frame).toBe(3);
  });

  it("applies callfunction 65 as straight emitter motion", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      331,
      `
a010_331:
    loadparticle 0, 0
    addparticle2 0, 1, 0, ANIM_TARGET_USER
    callfunction 65, 6, 1, 0, 0, 0, 10, 64
    end
`,
      BASE_SCENARIO,
    );

    const emitter = preview.timeline.find((event) => event.command === "addparticle2");
    expect(emitter?.particle?.forceFollowMotion).toBe(true);
    expect(emitter?.particle?.alignToMotion).toBe(true);
    expect(emitter?.particle?.alignRotationOffset).toBe(Math.PI);
    expect(emitter?.particle?.originMotion).toMatchObject({ from: [0, 0, 0], duration: 10, delay: 0, easing: "linear" });
    expect(emitter?.particle?.originMotion?.to[0]).toBeCloseTo(33);
    expect(emitter?.particle?.originMotion?.to[1]).toBeCloseTo(6);
    expect(emitter?.particle?.originMotion?.to[2]).toBeCloseTo(-28);
    expect(emitter?.particle?.axis?.[0]).toBeGreaterThan(0);
    expect(preview.timeline.find((event) => event.command === "StraightEmitter")?.status).toBe("supported");

    const earlyMaxX = Math.max(...simulateSplPreview(preview, 1).map((particle) => particle.position[0]));
    const laterMaxX = Math.max(...simulateSplPreview(preview, 9).map((particle) => particle.position[0]));
    expect(laterMaxX).toBeGreaterThan(earlyMaxX);
    expect(laterMaxX).toBeGreaterThan(0);
  });

  it("applies callfunction 65 sine wave without collapsing emitted particles", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      149,
      `
a010_149:
    loadparticle 0, 0
    addparticle2 0, 0, 0, ANIM_TARGET_USER
    callfunction 65, 9, 0, 0, 0, 0, 19, 64, 0, 0, 1
    end
`,
      BASE_SCENARIO,
    );

    const emitter = preview.timeline.find((event) => event.command === "addparticle2");
    expect(emitter?.particle?.forceFollowMotion).toBe(false);
    expect(emitter?.particle?.alignRotationOffset).toBe(Math.PI);
    expect(emitter?.particle?.originMotion?.waveAmplitude).toBeGreaterThan(2);
    expect(preview.timeline.find((event) => event.command === "StraightEmitter")?.status).toBe("supported");

    const particles = simulateSplPreview(preview, 14);
    const xs = particles.map((particle) => particle.position[0]);
    const ys = particles.map((particle) => particle.position[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(20);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(3);
  });

  it("applies callfunction 72 as rotating emitter motion", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      65,
      `
a010_065:
    loadparticle 0, 0
    addparticle2 0, 3, 0, ANIM_TARGET_USER
    callfunction 72, 10, 3, 0, 90, 90, 90, 48, 0, 8, 0, 0
    end
`,
      BASE_SCENARIO,
    );

    const emitter = preview.timeline.find((event) => event.command === "addparticle2");
    expect(emitter?.particle?.origin?.[0]).toBeLessThan(0);
    expect(emitter?.particle?.originMotion?.duration).toBe(8);
    expect(emitter?.particle?.originMotion?.rotation).toMatchObject({
      startAngleX: 0,
      endAngleX: 90,
      startAngleY: 90,
      endAngleY: 90,
    });
    expect(emitter?.particle?.originMotion?.rotation?.radiusX).toBeGreaterThan(0);
    expect(preview.timeline.find((event) => event.command === "RotatingEmitter")?.status).toBe("supported");

    const earlyX = Math.max(...simulateSplPreview(preview, 0).map((particle) => particle.position[0]));
    const laterX = Math.max(...simulateSplPreview(preview, 7).map((particle) => particle.position[0]));
    expect(laterX).toBeGreaterThan(earlyX + 5);
  });

  it("faces parabolic emit-set particles along their travel path", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      42,
      `
a010_042:
    loadparticle 0, 0
    addparticle2 0, 1, 2, 3
    callfunction 66, 6, 1, 0, 0, 0, 13, 64
    end
`,
      BASE_SCENARIO,
    );

    const particle = simulateSplPreview(preview, 6)[0];
    const later = simulateSplPreview(preview, 10)[0];
    expect(particle?.velocity[0]).toBeGreaterThan(0);
    expect(particle?.rotation).toBeGreaterThan(later?.rotation ?? Infinity);
    expect(Math.abs((particle?.rotation ?? 0) - (later?.rotation ?? 0))).toBeGreaterThan(0.2);
  });

  it("uses addparticle2's third argument as the SPA resource and tracks its emitter id", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      121,
      `
a010_121:
    loadparticle 0, 0
    addparticle2 0, 1, 0, ANIM_TARGET_USER
    addparticle2 0, 2, 1, ANIM_TARGET_USER
    callfunction 66, 6, 1, 0, 0, 0, 10, 64
    end
`,
      BASE_SCENARIO,
    );

    const events = preview.timeline.filter((event) => event.command === "addparticle2");
    expect(events[0].resourceId).toBe(0);
    expect(events[1].resourceId).toBe(1);
    expect(events[0].particle?.originMotion?.duration).toBe(10);
    expect(events[1].particle?.originMotion).toBeUndefined();
  });

  it("treats Hydro Cannon style cmd37 mode 20 as a user-origin beam", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    loadparticle 0, 0
    addparticle 0, 3, ANIM_TARGET_MISC
    cmd37 6, 0, 2, 20, 14, 0, 0
    end
`,
      BASE_SCENARIO,
    );

    const beam = preview.timeline.find((event) => event.command === "addparticle");
    expect(beam?.particle?.origin?.[0]).toBeLessThan(0);
    expect(beam?.particle?.origin?.[0]).toBeGreaterThan(-18);
    expect(beam?.particle?.destinationTarget).toBe(4);
    expect(beam?.particle?.axis).toBeDefined();
    expect(beam?.particle?.foreshorten).toBe(false);
    expect(beam?.particle?.screenRotation).toBeCloseTo(-0.72);
  });

  it("applies HG cmd37 operator position offsets after an offset-position mode", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    loadparticle 0, 0
    addparticle 0, 0, ANIM_TARGET_DEFENDER
    cmd37 6, 0, 2, 5, 0, 0, 0
    cmd37 4, 1, 1720, -3440, 0
    end
`,
      BASE_SCENARIO,
    );

    const particle = preview.timeline.find((event) => event.command === "addparticle")?.particle;
    expect(particle?.origin?.[0]).toBeCloseTo(15 + (1720 * 33) / 22304);
    expect(particle?.origin?.[1]).toBeCloseTo(18 - (3440 * 6) / 10992);
  });

  it("applies cmd37 operator records to the adjacent emitter instead of treating priority as a slot", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    loadparticle 0, 0
    loadparticle 1, 0
    addparticle 0, 0, ANIM_TARGET_USER
    addparticle 1, 0, ANIM_TARGET_MISC
    cmd37 6, 0, 2, 5, 0, 0, 0
    end
`,
      BASE_SCENARIO,
    );

    const particles = preview.timeline.filter((event) => event.command === "addparticle");
    expect(particles[0].particle?.origin?.[0]).toBeLessThan(0);
    expect(particles[1].particle?.origin?.[0]).toBeCloseTo(15);
    expect(particles[1].particle?.field?.positionMode).toBe(5);
  });

  it("uses cmd37 target mode to resolve attacker and defender endpoints", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    loadparticle 0, 0
    addparticle 0, 0, ANIM_TARGET_MISC
    cmd37 6, 0, 1, 2, 0, 0, 0
    addparticle 0, 0, ANIM_TARGET_MISC
    cmd37 6, 0, 2, 2, 0, 0, 0
    end
`,
      BASE_SCENARIO,
    );

    const particles = preview.timeline.filter((event) => event.command === "addparticle");
    expect(particles[0].particle?.origin?.[0]).toBeLessThan(0);
    expect(particles[1].particle?.origin?.[0]).toBeGreaterThan(0);
  });

  it("treats cmd37 count-4 records as explicit base positions for OPERATOR_POS_SET", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    loadparticle 0, 0
    addparticle 0, 0, ANIM_TARGET_MISC
    cmd37 6, 0, 2, 3, 0, 0, 0
    cmd37 4, 1, -14936, -5032, 64
    end
`,
      BASE_SCENARIO,
    );

    const particle = preview.timeline.find((event) => event.command === "addparticle")?.particle;
    expect(particle?.origin).toEqual([-18, 12, 18]);
  });

  it("reverses cmd37 position offsets when the source client is on the opposite side", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      0,
      `
a010_000:
    loadparticle 0, 0
    addparticle 0, 0, ANIM_TARGET_MISC
    cmd37 6, 0, 2, 5, 0, 0, 0
    cmd37 4, 0, 4096, 0, 0
    end
`,
      { ...BASE_SCENARIO, attackerSide: "opponent" },
    );

    const particle = preview.timeline.find((event) => event.command === "addparticle")?.particle;
    expect(particle?.origin?.[0]).toBeLessThan(-18);
  });

  it("keeps Protect style position-only field operators camera-facing over the user", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      182,
      `
a010_182:
    loadparticle 0, 0
    addparticle 0, 0, ANIM_TARGET_MISC
    cmd37 6, 0, 1, 2, 0, 0, 0
    end
`,
      BASE_SCENARIO,
    );

    const event = preview.timeline.find((timelineEvent) => timelineEvent.command === "addparticle");
    expect(event?.particle?.origin?.[0]).toBeLessThan(0);
    expect(event?.particle?.axis).toBeUndefined();
    expect(event?.particle?.screenPlane).toBe(true);
  });

  it("applies HG cmd37 field operator data to magnet particles", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      72,
      `
a010_072:
    loadparticle 0, 0
    addparticle 0, 0, ANIM_TARGET_DEFENDER
    cmd37 6, 0, 2, 2, 1, 16, 0
    cmd37 5, 2, 0, 0, 0, 0
    end
`,
      BASE_SCENARIO,
    );

    const event = preview.timeline.find((timelineEvent) => timelineEvent.command === "addparticle");
    expect(event?.particle?.origin).toBeDefined();
    expect(event?.particle?.field?.magnetTarget).toBeDefined();
    expect(event?.particle?.field?.magnetTarget?.[0]).toBeLessThan(0);
    expect(event?.message).toContain("magnet field target");
  });

  it("applies HG cmd37 gravity field overrides to particle behaviors", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      246,
      `
a010_246:
    loadparticle 0, 0
    addparticle 0, 0, ANIM_TARGET_USER
    cmd37 6, 0, 2, 1, 3, 2, 0
    cmd37 5, 1, 1, -120, -41, 0
    end
`,
      BASE_SCENARIO,
    );

    const event = preview.timeline.find((timelineEvent) => timelineEvent.command === "addparticle");
    expect(event?.particle?.field?.gravityMagnitude).toEqual([-120 / 4096, -41 / 4096, 0]);
    expect(event?.message).toContain("gravity field");
    const early = simulateSplPreview(preview, 1)[0]?.position[1] ?? 0;
    const later = simulateSplPreview(preview, 8)[0]?.position[1] ?? 0;
    expect(later).toBeLessThan(early);
  });

  it("applies HG cmd37 random field magnitude and interval overrides to particle behaviors", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      72,
      `
a010_072:
    loadparticle 0, 0
    addparticle 0, 0, ANIM_TARGET_USER
    cmd37 6, 0, 2, 1, 3, 12, 0
    cmd37 5, 1, 1, 64, 128, 0
    cmd37 5, 1, 1, 3, 0, 0
    end
`,
      BASE_SCENARIO,
    );

    const event = preview.timeline.find((timelineEvent) => timelineEvent.command === "addparticle");
    expect(event?.particle?.field?.randomMagnitude).toEqual([64 / 4096, 128 / 4096, 0]);
    expect(event?.particle?.field?.randomIntervalFrames).toBe(3);
    expect(event?.message).toContain("random field magnitude");
    expect(event?.message).toContain("random field interval");
    const first = simulateSplPreview(preview, 1)[0]?.position;
    const later = simulateSplPreview(preview, 6)[0]?.position;
    expect(first).toBeDefined();
    expect(later).toBeDefined();
    expect(later?.[0]).not.toBe(first?.[0]);
  });

  it("uses HG special Bubble operator position and axis modes", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      145,
      `
a010_145:
    loadparticle 0, 0
    addparticle 0, 0, ANIM_TARGET_MISC
    cmd37 6, 0, 2, 31, 24, 0, 4
    end
`,
      BASE_SCENARIO,
    );

    const event = preview.timeline.find((timelineEvent) => timelineEvent.command === "addparticle");
    expect(event?.particle?.origin?.[0]).toBeLessThan(0);
    expect(event?.particle?.origin?.[0]).toBeGreaterThan(-18);
    expect(event?.particle?.axis?.[0]).toBeGreaterThan(0);
    expect(event?.message).toContain("position mode 31");
  });

  it("keeps Razor Leaf style defender-side laser axes moving from user to target", async () => {
    const state = loadHgMoveAnimationRom(makePreviewRom());
    const preview = await buildHgMoveAnimationPreview(
      state,
      "move",
      75,
      `
a010_075:
    loadparticle 0, 0
    addparticle 0, 1, ANIM_TARGET_MISC
    particle_operator 0, 2, 6, 5, 0, 0
    end
`,
      BASE_SCENARIO,
    );

    const event = preview.timeline.find((timelineEvent) => timelineEvent.command === "addparticle");
    expect(event?.particle?.origin?.[0]).toBeLessThan(0);
    expect(event?.particle?.axis?.[0]).toBeGreaterThan(0);
    expect(event?.particle?.destinationTarget).toBe(4);
    expect(event?.message).toContain("attacker laser axis");
  });
});

function makePreviewRom(options: { includePlanmPath?: boolean; includeEffectClact?: boolean; includeEffectClactDecoy?: boolean } = {}): Uint8Array {
  const moveNarc = new NARC();
  moveNarc.files = [compileHgMoveAnimationScript("a010_000:\n    end\n", { archiveKind: "move", fileId: 0 })];
  const subNarc = new NARC();
  subNarc.files = [compileHgMoveAnimationScript("a061_000:\n    end\n", { archiveKind: "sub", fileId: 0 })];
  const particleNarc = new NARC();
  particleNarc.files = [makeSyntheticSpa()];
  const files = [moveNarc.save(), subNarc.save(), particleNarc.save(), makeBattleGfxNarc().save(), makePlanmNarc().save()];
  if (options.includeEffectClact) {
    if (options.includeEffectClactDecoy) files.push(makeRepeatedNarc(551, makeSyntheticCellCharacterFile(1)).save());
    files.push(
      makeRepeatedNarc(37, makeSyntheticCellCharacterFile(2)).save(),
      makeRepeatedNarc(39, makeSyntheticCellPaletteFile()).save(),
      makeRepeatedNarc(37, makeSyntheticCellBankFile()).save(),
      makeRepeatedNarc(37, makeSyntheticCellAnimationFile()).save(),
    );
  }
  return makeRom(files, options);
}

function makeRom(files: Uint8Array[], options: { includePlanmPath?: boolean } = {}): Uint8Array {
  const includePlanmPath = options.includePlanmPath ?? true;
  const fnt = saveFnt(
    new Folder({
      folders: [
        [
          "a",
          new Folder({
            folders: [
              [
                "0",
                new Folder({
                  folders: [
                    ["0", new Folder({ files: ["7"], firstId: 3 })],
                    ["1", new Folder({ files: ["0"], firstId: 0 })],
                    ["6", new Folder({ files: ["1"], firstId: 1 })],
                    ["2", new Folder({ files: ["9"], firstId: 2 })],
                  ],
                }),
              ],
            ],
          }),
        ],
        ...(includePlanmPath ? ([["wazaeffect", new Folder({ files: ["batt_bg_planm.narc"], firstId: 4 })]] as Array<[string, Folder]>) : []),
      ],
    }),
  );
  const out = new Uint8Array(0x8000 + files.reduce((sum, file) => sum + 0x200 + file.length, 0));
  out.set([0x54, 0x45, 0x53, 0x54], 0);
  out.set([0x54, 0x45, 0x53, 0x54], 12);
  writeU32(out, 0x20, 0x4000);
  writeU32(out, 0x2c, 4);
  writeU32(out, 0x30, 0x4800);
  writeU32(out, 0x3c, 4);
  writeU32(out, 0x40, 0x5000);
  writeU32(out, 0x44, fnt.length);
  writeU32(out, 0x48, 0x5200);
  writeU32(out, 0x4c, files.length * 8);
  writeU32(out, 0x50, 0x4a00);
  writeU32(out, 0x54, 0);
  writeU32(out, 0x58, 0x4c00);
  writeU32(out, 0x5c, 0);
  writeU32(out, 0x84, 0x4000);
  out.set([1, 2, 3, 4], 0x4000);
  out.set([5, 6, 7, 8], 0x4800);
  out.set(fnt, 0x5000);
  let cursor = 0x5400;
  files.forEach((file, index) => {
    cursor = align(cursor, 0x200);
    writeU32(out, 0x5200 + index * 8, cursor);
    out.set(file, cursor);
    cursor += file.length;
    writeU32(out, 0x5200 + index * 8 + 4, cursor);
  });
  writeU32(out, 0x80, cursor);
  return out.slice(0, align(cursor, 4));
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
  writeU32(out, resource + 72, (1 << 24) | (1 << 26));

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

function makeBattleGfxNarc(): NARC {
  const [screen, characters, palette] = makeSyntheticBackgroundFiles();
  const narc = new NARC();
  narc.files = Array.from({ length: 305 }, () => new Uint8Array());
  narc.files[56] = screen;
  narc.files[57] = screen;
  narc.files[58] = screen;
  narc.files[59] = characters;
  narc.files[295] = palette;
  narc.files[84] = characters;
  narc.files[85] = screen;
  narc.files[304] = palette;
  return narc;
}

function makePlanmNarc(): NARC {
  const narc = new NARC();
  narc.files = Array.from({ length: 32 }, () => new Uint8Array());
  for (const datId of [8, 10, 18]) {
    narc.files[datId] = makeSyntheticPlanmDat();
    narc.files[datId + 1] = makeSyntheticPlanmPalette();
  }
  return narc;
}

function makeRepeatedNarc(count: number, file: Uint8Array): NARC {
  const narc = new NARC();
  narc.files = Array.from({ length: count }, () => file);
  return narc;
}

function makeSyntheticCellCharacterFile(boundaryTileColorIndex: 1 | 2): Uint8Array {
  const out = new Uint8Array(16 + 32 + 3 * 32);
  writeAscii(out, 0, "RGCN");
  writeU16(out, 4, 0xfeff);
  writeU16(out, 6, 1);
  writeU32(out, 8, out.length);
  writeU16(out, 12, 16);
  writeU16(out, 14, 1);
  writeAscii(out, 16, "RAHC");
  writeU32(out, 20, out.length - 16);
  writeU32(out, 28, 3);
  writeU16(out, 32, 3);
  writeU16(out, 34, 1);
  writeU32(out, 40, 3 * 32);
  out.fill(0x11, 16 + 32 + 32, 16 + 32 + 64);
  out.fill(boundaryTileColorIndex === 1 ? 0x11 : 0x22, 16 + 32 + 64, 16 + 32 + 96);
  return out;
}

function makeSyntheticCellPaletteFile(): Uint8Array {
  const out = new Uint8Array(40 + 32);
  writeAscii(out, 0, "RLCN");
  writeU16(out, 4, 0xfeff);
  writeU16(out, 6, 1);
  writeU32(out, 8, out.length);
  writeU16(out, 12, 16);
  writeU16(out, 14, 1);
  writeAscii(out, 16, "TTLP");
  writeU32(out, 20, out.length - 16);
  writeU32(out, 32, 32);
  writeU16(out, 42, 0x001f);
  writeU16(out, 44, 0x7c00);
  return out;
}

function makeSyntheticCellBankFile(): Uint8Array {
  return buildPokemonCellBankFileFromParsed({
    mappingMode: 1,
    cells: [
      {
        index: 0,
        nAttribs: 1,
        cellAttr: 0,
        minX: 0,
        minY: 0,
        maxX: 8,
        maxY: 8,
        oams: [
          {
            x: 0,
            y: 0,
            width: 8,
            height: 8,
            characterName: 1,
            palette: 0,
            flipX: false,
            flipY: false,
            disable: false,
            rotateScale: false,
            doubleSize: false,
            matrix: 0,
            mode: 0,
            mosaic: false,
            shape: 0,
            size: 0,
            priority: 0,
            characterBits: 4,
          },
        ],
      },
    ],
  });
}

function makeSyntheticCellAnimationFile(): Uint8Array {
  return buildPokemonAnimationFile({ targetType: 1, frames: [[{ duration: 3, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 }]] });
}

function makeSyntheticPlanmDat(): Uint8Array {
  const out = new Uint8Array(128 + 128 * 2);
  out.fill(255, 0, 128);
  for (let offset = 128; offset < out.length; offset += 2) writeU16(out, offset, 65432);
  out[0] = 0;
  out[1] = 1;
  writeU16(out, 128, 4);
  writeU16(out, 130, 6);
  return out;
}

function makeSyntheticPlanmPalette(): Uint8Array {
  const palette = new Uint8Array(0x28 + 64);
  writeAscii(palette, 0, "RLCN");
  writeU16(palette, 4, 0xfeff);
  writeU16(palette, 6, 1);
  writeU32(palette, 8, palette.length);
  writeU16(palette, 12, 16);
  writeU16(palette, 14, 1);
  writeAscii(palette, 16, "TTLP");
  writeU32(palette, 20, palette.length - 16);
  writeU32(palette, 32, 64);
  writeU16(palette, 40, 0x001f);
  writeU16(palette, 42, 0x03e0);
  writeU16(palette, 44, 0x7c00);
  writeU16(palette, 46, 0x7fff);
  writeU16(palette, 72, 0x7fff);
  writeU16(palette, 74, 0x001f);
  writeU16(palette, 76, 0x03e0);
  writeU16(palette, 78, 0x7c00);
  return palette;
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

function writeAscii(out: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) out[offset + index] = value.charCodeAt(index);
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
