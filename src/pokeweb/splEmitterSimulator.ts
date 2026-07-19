import type { MoveAnimationPreview, MoveAnimationTimelineEvent } from "./moveAnimationPreviewModel";
import type { SpaArchive, SpaBehavior, SpaChildResource, SpaResource } from "./nitroSpa";
import { CENTER_BATTLE_ANCHOR, copyBattleAnchor, TARGET_BATTLE_ANCHOR, USER_BATTLE_ANCHOR } from "./battlePreviewAnchors";
import {
  GEN5_EFFECT_PARTICLE_DEPTH_OFFSET,
  GEN5_SINGLE_TARGET_POKEMON_POSITION,
  GEN5_SINGLE_USER_POKEMON_POSITION,
} from "./gen5BattleSceneLayout";

const FPS = 30;
const MAX_PARTICLES_PER_EVENT = 256;
// These conversions belong to the original flat preview coordinate system.
// Source-backed Gen 5 battle previews select unit scales in BattleAnchorSet.
const LEGACY_POSITION_SCALE = 4.5;
const LEGACY_VELOCITY_STEP_SCALE = 0.3;
const LEGACY_SPRITE_SCALE = 13.5;
const LEGACY_PROJECTILE_SPEED_SCALE = 0.35;
const LEGACY_PROJECTILE_FALLBACK_SPEED = 0.28;
// Swan's libjn_spl drawXYPlane/drawXZPlane builds each particle quad from
// -FX32_ONE to +FX32_ONE before applying base_scl. The authored scale is
// therefore a half-extent, while Three.js PlaneGeometry uses full dimensions.
const SPL_SOURCE_QUAD_DIAMETER = 2;
const HG_ANCHORED_PANE_TARGET_SCALE = 1.1;
const HG_ANCHORED_PANE_POSITION_SCALE = 1;

type Vec3 = [number, number, number];

type BattleAnchorSet = {
  user: Vec3;
  target: Vec3;
  center: Vec3;
  positionScale: number;
  velocityStepScale: number;
  usesGen5SourceSpace: boolean;
};

export type SplFrameParticle = {
  eventId: string;
  resourceIndex: number;
  textureIndex: number;
  textureRepeatS: number;
  textureRepeatT: number;
  textureFlipS: boolean;
  textureFlipT: boolean;
  textureKind?: "spa" | "circle";
  beamTrail?: boolean;
  renderLayer: number;
  drawType: number;
  sourceDrawType: number;
  polygonRotAxis: number;
  polygonReferencePlane: number;
  polygonOffsetX: number;
  polygonOffsetY: number;
  directionalBillboardScale: number;
  dpolFaceEmitter: boolean;
  position: Vec3;
  relativePosition: Vec3;
  velocity: Vec3;
  scale: number;
  scaleX: number;
  scaleY: number;
  sourceScale: number;
  sourceScaleX: number;
  sourceScaleY: number;
  aspectRatio: number;
  tiltScale: number;
  anchorX: number;
  anchorY: number;
  anchorOffsetY: number;
  color: Vec3;
  alpha: number;
  rotation: number;
  authoredRotation?: number;
  alignToMotion?: boolean;
  alignRotationOffset?: number;
  dspreScreenRotation?: boolean;
};

type SimParticle = {
  position: Vec3;
  velocity: Vec3;
  emitterPos: Vec3;
  baseScale: number;
  animScale: number;
  color: Vec3;
  baseAlpha: number;
  animAlpha: number;
  rotation: number;
  angularVelocity: number;
  lifeFrames: number;
  ageFrames: number;
  emissionTimerFrames: number;
  textureIndex: number;
  lifeRateOffset: number;
  child?: SpaChildResource;
};

export function simulateSplPreview(preview: MoveAnimationPreview, frame: number): SplFrameParticle[] {
  const out: Array<{ eventIndex: number; particleIndex: number; particle: SplFrameParticle }> = [];
  const targetFrame = Math.max(0, Math.round(frame));
  const anchors = battleAnchorsForPreview(preview);
  for (let eventIndex = 0; eventIndex < preview.timeline.length; eventIndex += 1) {
    const event = preview.timeline[eventIndex];
    if (!isSpaEvent(event) || event.spaId === undefined || event.resourceId === undefined) continue;
    if (event.frame > targetFrame) continue;
    const archive = preview.spaArchives.get(event.spaId);
    const resource = archive?.resources[event.resourceId] ?? archive?.resources[0];
    if (!archive || !resource) continue;
    const particleLifeFrames = Math.max(resource.particleLifeFrames, resource.childResource?.lifeFrames ?? 0);
    const lastUsefulFrame = event.frame + eventParams(event).lifeMultiplier * resource.emitterLifeFrames + particleLifeFrames + resource.startDelayFrames + 8;
    if (targetFrame > lastUsefulFrame) continue;
    const particles = simulateEvent(event, archive, resource, targetFrame - event.frame, anchors);
    particles.forEach((particle, particleIndex) => out.push({ eventIndex, particleIndex, particle }));
  }
  return out
    .sort((left, right) => right.eventIndex - left.eventIndex || left.particleIndex - right.particleIndex)
    .map((entry) => entry.particle);
}

function simulateEvent(event: MoveAnimationTimelineEvent, archive: SpaArchive, resource: SpaResource, localFrame: number, anchors: BattleAnchorSet): SplFrameParticle[] {
  const params = eventParams(event);
  const rng = new DeterministicRng(hashString(`${event.id}:${event.spaId}:${event.resourceId}`));
  const emitter = new SplEmitter(resource, archive, params, event, rng, anchors);
  for (let frame = 0; frame <= localFrame && !emitter.dead; frame += 1) emitter.step();
  return emitter.render();
}

class SplEmitter {
  private particles: SimParticle[] = [];
  private ageFrames = 0;
  private emissionTimerFrames = 0;
  private frame1 = true;
  private started: boolean;
  private emissionOrdinal = 0;
  public dead = false;

  private readonly position: Vec3;
  private readonly axis: Vec3;
  private readonly particleInitVelocity: Vec3;
  private readonly emitterVelocity: Vec3 = [0, 0, 0];
  private readonly crossAxis1: Vec3;
  private readonly crossAxis2: Vec3;

  constructor(
    private readonly resource: SpaResource,
    private readonly archive: SpaArchive,
    private readonly params: EventParams,
    private readonly event: MoveAnimationTimelineEvent,
    private readonly rng: DeterministicRng,
    private readonly anchors: BattleAnchorSet,
  ) {
    this.started = resource.startDelayFrames <= 0;
    this.position = this.emitterPositionAt(0);
    this.axis = emitterAxis(event, resource.axis, anchors);
    this.particleInitVelocity = !anchors.usesGen5SourceSpace && isProjectileEvent(event)
      ? legacyProjectileInitialVelocity(event, anchors)
      : [0, 0, 0];
    [this.crossAxis1, this.crossAxis2] = event.particle?.screenPlane ? screenPlaneAxes() : orthogonalAxes(resource.emissionAxis, this.axis);
  }

  step(): void {
    if (this.dead) return;
    if (!this.started) {
      if (this.ageFrames >= this.resource.startDelayFrames) {
        this.started = true;
        this.ageFrames = 0;
        this.emissionTimerFrames = 0;
        this.frame1 = true;
      } else {
        this.ageFrames += 1;
        return;
      }
    }

    const emitInterval = this.resourceIntervalFrames();
    if (emitInterval <= 0 || this.frame1) {
      this.emit(this.resource.emissionCount);
    } else if (this.ageFrames < this.resource.emitterLifeFrames * this.params.lifeMultiplier) {
      while (this.emissionTimerFrames >= emitInterval) {
        this.emit(this.resource.emissionCount);
        this.emissionTimerFrames -= emitInterval;
      }
    }

    const survivors: SimParticle[] = [];
    const spawned: SimParticle[] = [];
    for (const particle of this.particles) {
      this.applyAnimations(particle);
      let acceleration: Vec3 = [0, 0, 0];
      if (!particle.child || particle.child.usesBehaviors) {
        for (const behavior of this.effectiveBehaviors()) acceleration = add(acceleration, this.applyBehavior(particle, behavior));
      }
      particle.rotation += particle.angularVelocity;
      particle.velocity = scaleVec(particle.velocity, this.resource.airResistance);
      particle.velocity = add(particle.velocity, acceleration);
      particle.position = add(particle.position, add(particle.velocity, this.emitterVelocity));
      if ((!particle.child && this.resource.followEmitter) || particle.child?.followEmitter) {
        particle.emitterPos = this.emitterPositionAt(this.ageFrames);
      }
      if (!particle.child && this.resource.childResource) this.emitChildren(particle, this.resource.childResource, spawned);
      particle.ageFrames += 1;
      particle.emissionTimerFrames += 1;
      if (particle.ageFrames < particle.lifeFrames) survivors.push(particle);
    }
    this.particles = survivors.concat(spawned).slice(0, MAX_PARTICLES_PER_EVENT);

    this.ageFrames += 1;
    this.emissionTimerFrames += 1;
    this.frame1 = false;
    if (this.ageFrames > this.resource.emitterLifeFrames * this.params.lifeMultiplier && this.particles.length === 0) this.dead = true;
  }

  render(): SplFrameParticle[] {
    const rendered = this.particles
      .map((particle, index) => ({ particle, index }))
      .filter(({ particle }) => particle.child || !this.resource.hideParent)
      .sort((a, b) => particleRenderLayer(this.resource, a.particle) - particleRenderLayer(this.resource, b.particle) || a.index - b.index)
      .map(({ particle }) => {
        const drawType = particleDrawType(this.resource, particle, this.event);
        const directionalBillboard = drawType === 1;
        const advancedPlacement = usesAdvancedParticlePlacement(this.event);
        const splScale = advancedPlacement || directionalBillboard || isHgAnchoredPaneResource(this.event, this.resource);
        const scaleMultiplier = effectiveScaleMultiplier(this.event, this.resource, this.params);
        const animScale = particleRenderAnimScale(this.event, this.resource, particle);
        const sourceScale = Math.max(0.001, particle.baseScale * animScale * scaleMultiplier);
        const scale = Math.max(0.05, sourceScale * LEGACY_SPRITE_SCALE);
        const paneScale = screenPlanePaneScale(this.event, this.resource, this.params, this.anchors.positionScale);
        const [scaleX, scaleY] = paneScale ?? (splScale ? particleScale(this.resource, particle, scaleMultiplier, animScale) : [scale * Math.max(0.1, this.resource.aspectRatio || 1), scale]);
        const [sourceScaleX, sourceScaleY] = particleSourceScale(this.resource, particle, scaleMultiplier, animScale);
        const useResourceAnchor = advancedPlacement || this.event.particle?.useResourceAnchor === true;
        const [anchorX, anchorY] = useResourceAnchor ? particleAnchor(this.resource, particle.child) : [0.5, 0.5];
        const textureIndex = clampTextureIndex(particle.textureIndex, this.archive);
        const renderVelocity = this.renderParticleVelocity(particle);
        const relativePosition = this.renderRelativePosition(particle);
        const anchorMotionOffset = hgAnchoredPaneMotionOffset(this.event, this.resource, particle, scaleMultiplier);
        const textureFlipS = particle.child?.flipTextureS ?? this.resource.flipTextureS;
        const textureFlipT = particle.child?.flipTextureT ?? this.resource.flipTextureT;
        return {
          eventId: this.event.id,
          resourceIndex: this.resource.index,
          textureIndex,
          textureRepeatS: 2 ** (particle.child?.textureTileCountS ?? this.resource.textureTileCountS),
          textureRepeatT: 2 ** (particle.child?.textureTileCountT ?? this.resource.textureTileCountT),
          textureFlipS: textureFlipS !== (this.event.particle?.invertTextureXAxis === true),
          textureFlipT: textureFlipT !== (this.event.particle?.invertTextureYAxis === true),
          textureKind: "spa" as const,
          renderLayer: particleRenderLayer(this.resource, particle),
          drawType,
          sourceDrawType: particle.child?.drawType ?? this.resource.drawType,
          polygonRotAxis: particle.child?.polygonRotAxis ?? this.resource.polygonRotAxis,
          polygonReferencePlane: particle.child?.polygonReferencePlane ?? this.resource.polygonReferencePlane,
          polygonOffsetX: advancedPlacement && !particle.child ? this.resource.polygonX : 0,
          polygonOffsetY: advancedPlacement && !particle.child ? this.resource.polygonY : 0,
          directionalBillboardScale: this.resource.directionalBillboardScale,
          dpolFaceEmitter: particle.child?.dpolFaceEmitter ?? this.resource.dpolCenter,
          position: add(add(this.renderEmitterPosition(particle), relativePosition), anchorMotionOffset),
          relativePosition,
          velocity: renderVelocity,
          scale,
          scaleX: Math.max(0.05, scaleX),
          scaleY: Math.max(0.05, scaleY),
          sourceScale: sourceScale * SPL_SOURCE_QUAD_DIAMETER,
          sourceScaleX,
          sourceScaleY,
          aspectRatio: Math.max(0.1, this.resource.aspectRatio || 1),
          tiltScale: particleForeshortening(this.event, particle, this.resource),
          anchorX,
          anchorY,
          anchorOffsetY: textureAnchorOffsetY(this.event, this.resource, this.archive, textureIndex, anchorY),
          color: particle.color,
          alpha: clamp01(particle.baseAlpha * particle.animAlpha),
          rotation: particleScreenRotation(this.event, particle, this.resource, renderVelocity),
          authoredRotation: particle.rotation,
          alignToMotion: this.event.particle?.alignToMotion,
          alignRotationOffset: this.event.particle?.alignRotationOffset,
          dspreScreenRotation: this.event.particle?.dspreScreenRotation,
        };
      });
    return this.event.particle?.beamTrail ? addBeamTrails(rendered, this.event.particle.beamTrail) : rendered;
  }

  private renderEmitterPosition(particle: SimParticle): Vec3 {
    if (!this.event.particle?.forceFollowMotion) return particle.emitterPos;
    return this.emitterPositionAt(this.ageFrames);
  }

  private renderParticleVelocity(particle: SimParticle): Vec3 {
    const particleVelocity = scaleVec(particle.velocity, this.anchors.positionScale);
    if (this.event.particle?.forceAxisRotation && this.event.particle.alignDirection) return normalize(this.event.particle.alignDirection);
    if (!this.event.particle?.forceFollowMotion || !this.event.particle.originMotion) {
      if (this.event.particle?.alignToMotion && length(particleVelocity) < 0.0001 && this.event.particle.alignDirection) {
        return normalize(this.event.particle.alignDirection);
      }
      return particleVelocity;
    }
    let emitterVelocity = sub(this.emitterPositionAt(this.ageFrames + 1), this.emitterPositionAt(this.ageFrames));
    if (length(emitterVelocity) < 0.0001 && this.ageFrames > 0) emitterVelocity = sub(this.emitterPositionAt(this.ageFrames), this.emitterPositionAt(this.ageFrames - 1));
    if (length(emitterVelocity) < 0.0001 && this.event.particle.alignDirection) {
      const speed = Math.max(length(emitterVelocity), 1);
      emitterVelocity = scaleVec(normalize(this.event.particle.alignDirection), speed);
    }
    return add(particleVelocity, emitterVelocity);
  }

  private renderRelativePosition(particle: SimParticle): Vec3 {
    let localPosition = particle.position;
    const destination = this.event.particle?.extendToDestination ? this.event.particle.destination : undefined;
    if (destination) {
      const start = this.emitterPositionAt(0);
      const maxDistanceAlongAxis = dot(sub(destination, start), this.axis) / this.anchors.positionScale;
      const distanceAlongAxis = dot(localPosition, this.axis);
      if (maxDistanceAlongAxis > 0 && distanceAlongAxis > maxDistanceAlongAxis) {
        localPosition = sub(localPosition, scaleVec(this.axis, distanceAlongAxis - maxDistanceAlongAxis));
      }
    }
    return scaleVec(localPosition, this.anchors.positionScale);
  }

  private emitterPositionAt(frame: number): Vec3 {
    const basePosScale = this.anchors.positionScale * resourceBasePositionMultiplier(this.event, this.resource);
    return add(scriptEmitterOriginAt(this.event, frame, this.anchors), scaleVec(this.resource.emitterBasePos, basePosScale));
  }

  private resourceIntervalFrames(): number {
    return Math.max(0, this.resource.emissionIntervalFrames);
  }

  private emit(count: number): void {
    if (this.particles.length >= MAX_PARTICLES_PER_EVENT) return;
    const particleCount = Math.min(count, MAX_PARTICLES_PER_EVENT - this.particles.length);
    this.ensureCrossAxes();
    for (let i = 0; i < particleCount; i += 1) {
      const particle = this.makeParticle(i, particleCount);
      this.particles.push(particle);
      this.emissionOrdinal += 1;
    }
  }

  private emitChildren(parent: SimParticle, child: SpaChildResource, spawned: SimParticle[]): void {
    if (child.emissionCount <= 0) return;
    const lifeRate = clamp01(parent.ageFrames / Math.max(1, parent.lifeFrames));
    if (lifeRate < child.emissionDelay) return;
    if (child.emissionIntervalFrames === 0 || parent.ageFrames === 0) {
      this.makeChildren(parent, child, child.emissionCount, spawned);
      return;
    }
    while (parent.emissionTimerFrames >= child.emissionIntervalFrames && this.particles.length + spawned.length < MAX_PARTICLES_PER_EVENT) {
      this.makeChildren(parent, child, child.emissionCount, spawned);
      parent.emissionTimerFrames -= child.emissionIntervalFrames;
    }
  }

  private makeChildren(parent: SimParticle, child: SpaChildResource, count: number, spawned: SimParticle[]): void {
    const remaining = MAX_PARTICLES_PER_EVENT - this.particles.length - spawned.length;
    const particleCount = Math.min(count, remaining);
    for (let i = 0; i < particleCount; i += 1) {
      const rng = this.rng.fork(Math.round(parent.ageFrames * 4099 + this.emissionOrdinal * 131 + i * 17));
      const rotationType = child.rotationType;
      spawned.push({
        position: [...parent.position],
        velocity: add(scaleVec(parent.velocity, child.velocityRatio), [rng.aroundZero(child.randomInitVelMag), rng.aroundZero(child.randomInitVelMag), rng.aroundZero(child.randomInitVelMag)]),
        emitterPos: this.emitterPositionAt(this.ageFrames),
        baseScale: parent.baseScale * parent.animScale * child.scaleRatio,
        animScale: 1,
        color: child.useChildColor ? child.color : parent.color,
        baseAlpha: parent.baseAlpha * parent.animAlpha,
        animAlpha: 1,
        rotation: rotationType === 1 || rotationType === 2 ? parent.rotation : 0,
        angularVelocity: rotationType === 2 ? parent.angularVelocity : 0,
        lifeFrames: Math.max(1, child.lifeFrames * this.params.lifeMultiplier),
        ageFrames: 0,
        emissionTimerFrames: 0,
        textureIndex: child.textureIndex,
        lifeRateOffset: 0,
        child,
      });
    }
  }

  private makeParticle(index: number, count: number): SimParticle {
    const localRng = this.rng.fork(this.emissionOrdinal + index * 1009);
    const emissionColumn = Math.floor(this.emissionOrdinal / Math.max(1, count));
    const position = this.initialPosition(index, count, localRng, emissionColumn);
    const posNorm = length(position) < 0.00001 ? localRng.unitVector() : normalize(position);
    const magPos = scaledRange2(this.resource.initVelPosAmplifier * this.params.speedMultiplier * this.anchors.velocityStepScale, this.resource.variance.initVel, localRng);
    const axisVelocity = this.screenPlaneRegularCellStep(count) === undefined ? this.resource.initVelAxisAmplifier : 0;
    const magAxis = Math.max(
      scaledRange2(axisVelocity * this.params.speedMultiplier * this.anchors.velocityStepScale, this.resource.variance.initVel, localRng),
      this.destinationReachAxisVelocity(),
    );
    const velocity = add(add(scaleVec(posNorm, magPos), scaleVec(this.axis, magAxis)), this.particleInitVelocity);
    const color = this.initialColor(localRng);
    const textureIndex = this.initialTexture(localRng);
    return {
      position,
      velocity,
      emitterPos: this.emitterPositionAt(this.ageFrames),
      baseScale: scaledRange2(this.resource.baseScale, this.resource.variance.baseScale, localRng),
      animScale: 1,
      color,
      baseAlpha: this.resource.baseAlpha,
      animAlpha: 1,
      rotation: this.resource.randomInitAngle ? localRng.range(0, Math.PI * 2) : this.resource.initAngle,
      angularVelocity: this.resource.hasRotation ? localRng.range(this.resource.minRotation, this.resource.maxRotation) : 0,
      lifeFrames: Math.max(1, scaledRange(this.resource.particleLifeFrames * this.params.lifeMultiplier, this.resource.variance.lifeTime, localRng)),
      ageFrames: 0,
      emissionTimerFrames: 0,
      textureIndex,
      lifeRateOffset: this.resource.randomizeLoopedAnim ? localRng.next() : 0,
    };
  }

  private initialPosition(index: number, count: number, rng: DeterministicRng, emissionColumn = 0): Vec3 {
    const scriptedOffset = this.event.particle?.emissionOffsets?.[index % Math.max(1, this.event.particle.emissionOffsets.length)];
    if (scriptedOffset) return scriptedOffset;
    const radius = nonzero(Math.abs(this.resource.radius) * this.params.radiusMultiplier);
    const lengthValue = Math.abs(this.resource.length) * this.params.radiusMultiplier;
    switch (this.resource.emissionType) {
      case 1:
        return rng.spherical(radius);
      case 2:
        return this.tilt([...rng.circle(radius), 0]);
      case 3: {
        const strip = this.screenPlaneRegularStripPosition(index, count, radius, emissionColumn);
        if (strip) return strip;
        const angle = (index / Math.max(1, count)) * Math.PI * 2;
        return this.tilt([Math.sin(angle) * radius, Math.cos(angle) * radius, 0]);
      }
      case 4:
        return rng.ball(radius);
      case 5:
        return this.tilt([...rng.disk(radius), 0]);
      case 6: {
        const [x, y] = rng.circle(radius);
        return this.tilt([x, y, rng.range(-lengthValue, lengthValue)]);
      }
      case 7:
        return this.tilt([...rng.disk(radius), rng.range(-lengthValue, lengthValue)]);
      case 8: {
        const p = rng.spherical(radius);
        return dot(p, cross(this.crossAxis1, this.crossAxis2)) <= 0 ? scaleVec(p, -1) : p;
      }
      case 9: {
        const p = rng.ball(radius);
        return dot(p, cross(this.crossAxis1, this.crossAxis2)) <= 0 ? scaleVec(p, -1) : p;
      }
      case 0:
      default:
        return [0, 0, 0];
    }
  }

  private initialColor(rng: DeterministicRng): Vec3 {
    const anim = this.resource.colorAnim;
    if (anim?.randomStartColor) {
      const colors = [anim.start, this.resource.color, anim.end];
      return colors[Math.floor(rng.next() * colors.length)] ?? this.resource.color;
    }
    return this.resource.color;
  }

  private initialTexture(rng: DeterministicRng): number {
    const anim = this.resource.texAnim;
    if (!anim) return this.resource.textureIndex;
    const textures = anim.textures.slice(0, Math.max(1, anim.textureCount));
    return anim.randomizeInit ? textures[Math.floor(rng.next() * textures.length)] ?? this.resource.textureIndex : textures[0] ?? this.resource.textureIndex;
  }

  private applyAnimations(particle: SimParticle): void {
    if (particle.child) {
      const lifeRate = clamp01(particle.ageFrames / Math.max(1, particle.lifeFrames));
      if (particle.child.hasScaleAnim) particle.animScale = mix(0, particle.child.endScale, lifeRate);
      if (particle.child.hasAlphaAnim) particle.animAlpha = mix(1, 0, lifeRate);
      return;
    }
    const loopRate = this.resource.loopFrames > 0 ? fract(particle.lifeRateOffset + particle.ageFrames / this.resource.loopFrames) : 0;
    const lifeRate = clamp01(particle.ageFrames / Math.max(1, particle.lifeFrames));
    const scaleRate = this.resource.scaleAnim?.loop ? loopRate : lifeRate;
    const colorRate = this.resource.colorAnim?.loop ? loopRate : lifeRate;
    const alphaRate = this.resource.alphaAnim?.loop ? loopRate : lifeRate;
    const texRate = this.resource.texAnim?.loop ? loopRate : lifeRate;
    if (this.resource.scaleAnim) particle.animScale = applyScaleAnim(this.resource.scaleAnim, scaleRate);
    if (this.resource.colorAnim && !this.resource.colorAnim.randomStartColor) particle.color = applyColorAnim(this.resource.colorAnim, this.resource.color, colorRate);
    if (this.resource.alphaAnim) particle.animAlpha = applyAlphaAnim(this.resource.alphaAnim, alphaRate, this.rng.fork(Math.round(particle.ageFrames + particle.lifeFrames * 17)));
    if (this.resource.texAnim && !this.resource.texAnim.randomizeInit) particle.textureIndex = applyTexAnim(this.resource.texAnim, texRate, this.resource.textureIndex);
  }

  private applyBehavior(particle: SimParticle, behavior: SpaBehavior): Vec3 {
    switch (behavior.type) {
      case "gravity":
        return scaleVec(behavior.magnitude, this.anchors.velocityStepScale);
      case "random":
        if (behavior.applyIntervalFrames <= 0 || Math.round(particle.ageFrames) % behavior.applyIntervalFrames === 0) {
          const rng = this.rng.fork(Math.round(particle.ageFrames * 997 + this.emissionOrdinal));
          return [
            rng.aroundZero(behavior.magnitude[0]) * this.anchors.velocityStepScale,
            rng.aroundZero(behavior.magnitude[1]) * this.anchors.velocityStepScale,
            rng.aroundZero(behavior.magnitude[2]) * this.anchors.velocityStepScale,
          ];
        }
        return [0, 0, 0];
      case "magnet":
        return scaleVec(sub(behavior.target, add(particle.position, particle.velocity)), behavior.force);
      case "spin":
        particle.position = rotateAxis(particle.position, behavior.axis, behavior.angle);
        return [0, 0, 0];
      case "collision": {
        const movedAbove = particle.emitterPos[1] < behavior.y && particle.emitterPos[1] + particle.position[1] > behavior.y;
        const movedBelow = particle.emitterPos[1] >= behavior.y && particle.emitterPos[1] + particle.position[1] < behavior.y;
        if (movedAbove || movedBelow) {
          particle.position[1] = behavior.y - particle.emitterPos[1];
          if (behavior.collisionType === 0) particle.ageFrames = particle.lifeFrames;
          else particle.velocity[1] *= -behavior.elasticity;
        }
        return [0, 0, 0];
      }
      case "convergence":
        particle.position = add(particle.position, scaleVec(sub(behavior.target, particle.position), behavior.force));
        return [0, 0, 0];
    }
  }

  private effectiveBehaviors(): SpaBehavior[] {
    const field = this.event.particle?.field;
    const scriptTarget = scriptedBehaviorTarget(this.event, this.anchors);
    if (
      !field?.gravityMagnitude &&
      !field?.randomMagnitude &&
      field?.randomIntervalFrames === undefined &&
      !field?.magnetTarget &&
      field?.magnetForce === undefined &&
      !field?.convergenceTarget &&
      field?.convergenceForce === undefined &&
      !scriptTarget
    ) return this.resource.behaviors;
    let hasGravity = false;
    let hasRandom = false;
    let hasMagnet = false;
    let hasConvergence = false;
    const fieldOrigin = this.emitterPositionAt(0);
    const behaviors = this.resource.behaviors.map((behavior): SpaBehavior => {
      if (behavior.type === "gravity") {
        hasGravity = true;
        return {
          ...behavior,
          magnitude: field?.gravityMagnitude ?? behavior.magnitude,
        };
      }
      if (behavior.type === "random") {
        hasRandom = true;
        return {
          ...behavior,
          magnitude: field?.randomMagnitude ?? behavior.magnitude,
          applyIntervalFrames: field?.randomIntervalFrames ?? behavior.applyIntervalFrames,
        };
      }
      if (behavior.type === "magnet") {
        hasMagnet = true;
        return {
          ...behavior,
          target: field?.magnetTarget
            ? fieldTargetToSimulation(field.magnetTarget, this.anchors.positionScale, field.magnetTargetRelative, fieldOrigin)
            : scriptTarget ?? behavior.target,
          force: field?.magnetForce ?? nonzeroBehaviorForce(behavior.force, 0.045),
        };
      }
      if (behavior.type === "convergence") {
        hasConvergence = true;
        return {
          ...behavior,
          target: field?.convergenceTarget
            ? fieldTargetToSimulation(field.convergenceTarget, this.anchors.positionScale, field.convergenceTargetRelative, fieldOrigin)
            : scriptTarget ?? behavior.target,
          force: field?.convergenceForce ?? nonzeroBehaviorForce(behavior.force, 0.06),
        };
      }
      return behavior;
    });
    if (field?.gravityMagnitude && !hasGravity) behaviors.push({ type: "gravity", magnitude: field.gravityMagnitude });
    if ((field?.randomMagnitude || field?.randomIntervalFrames !== undefined) && !hasRandom) {
      behaviors.push({ type: "random", magnitude: field.randomMagnitude ?? [0, 0, 0], applyIntervalFrames: field.randomIntervalFrames ?? 1 });
    }
    if (field?.magnetTarget && !hasMagnet) behaviors.push({ type: "magnet", target: fieldTargetToSimulation(field.magnetTarget, this.anchors.positionScale, field.magnetTargetRelative, fieldOrigin), force: field.magnetForce ?? 0.045 });
    if (field?.convergenceTarget && !hasConvergence) behaviors.push({ type: "convergence", target: fieldTargetToSimulation(field.convergenceTarget, this.anchors.positionScale, field.convergenceTargetRelative, fieldOrigin), force: field.convergenceForce ?? 0.06 });
    return behaviors;
  }

  private tilt(value: Vec3): Vec3 {
    return add(add(scaleVec(this.crossAxis1, value[0]), scaleVec(this.crossAxis2, value[1])), scaleVec(this.axis, value[2]));
  }

  private screenPlaneRegularStripPosition(index: number, count: number, radius: number, emissionColumn: number): Vec3 | undefined {
    if (!this.event.particle?.screenPlane) return undefined;
    const side = screenPlaneRegularSide(count);
    if (!side) return undefined;
    const row = index % side;
    const step = (radius * 2) / (side - 1);
    const columns = Math.max(1, Math.round(this.resource.particleLifeFrames * this.params.lifeMultiplier));
    const column = ((emissionColumn % columns) + columns) % columns;
    const x = (column - (columns - 1) / 2) * step;
    const y = ((side - 1) / 2 - row) * step;
    return this.tilt([x, y, 0]);
  }

  private screenPlaneRegularCellStep(count: number): number | undefined {
    if (!this.event.particle?.screenPlane) return undefined;
    const side = screenPlaneRegularSide(count);
    if (!side) return undefined;
    const radius = nonzero(Math.abs(this.resource.radius) * this.params.radiusMultiplier);
    return (radius * 2) / (side - 1);
  }

  private ensureCrossAxes(): void {
    // The axes are computed in the constructor; this method preserves the emitter lifecycle shape.
  }

  private destinationReachAxisVelocity(): number {
    if (!this.event.particle?.extendToDestination || !this.event.particle.destination) return 0;
    if (this.resource.initVelAxisAmplifier <= 0) return 0;
    const start = this.emitterPositionAt(0);
    const delta = sub(this.event.particle.destination, start);
    const distanceAlongAxis = dot(delta, this.axis);
    if (distanceAlongAxis <= 0) return 0;
    const travelFrames = Math.max(1, this.resource.particleLifeFrames * this.params.lifeMultiplier * 0.82);
    return distanceAlongAxis / this.anchors.positionScale / travelFrames;
  }
}

type EventParams = {
  scaleMultiplier: number;
  lifeMultiplier: number;
  speedMultiplier: number;
  radiusMultiplier: number;
};

function addBeamTrails(
  particles: SplFrameParticle[],
  trail: NonNullable<NonNullable<MoveAnimationTimelineEvent["particle"]>["beamTrail"]>,
): SplFrameParticle[] {
  const out: SplFrameParticle[] = [];
  for (const particle of particles) {
    if (!particle.beamTrail && particle.textureKind === "spa" && !particle.eventId.includes(":beam:")) {
      const delta = sub(particle.position, trail.start);
      const distance = length(delta);
      if (distance > 0.5) {
        const segmentCount = Math.min(12, Math.max(2, Math.ceil(distance / 4)));
        const segmentScaleY = Math.max(1.8, Math.min(4.5, (distance / segmentCount) * (trail.scale ?? 1)));
        for (let segment = 0; segment < segmentCount; segment += 1) {
          const t = (segment + 0.35) / segmentCount;
          out.push({
            ...particle,
            eventId: `${particle.eventId}:beam:${segment}`,
            textureKind: "circle",
            beamTrail: true,
            renderLayer: particle.renderLayer - 1,
            drawType: 1,
            position: mixVec(trail.start, particle.position, t),
            relativePosition: scaleVec(delta, t),
            velocity: delta,
            scaleX: 0.18,
            scaleY: segmentScaleY,
            tiltScale: 1,
            anchorX: 0.5,
            anchorY: 0.5,
            anchorOffsetY: 0,
            color: [1, 1, 1],
            alpha: particle.alpha * (trail.alpha ?? 0.75),
          });
        }
      }
    }
    out.push(particle);
  }
  return out;
}

function eventParams(event: MoveAnimationTimelineEvent): EventParams {
  if (event.particle) {
    return {
      lifeMultiplier: clampMultiplier(event.particle.lifeMultiplier ?? 1, 0.25, 4),
      scaleMultiplier: clampMultiplier(event.particle.scaleMultiplier ?? 1, 0.125, 8),
      speedMultiplier: clampMultiplier(event.particle.speedMultiplier ?? 1, 0.125, 8),
      radiusMultiplier: clampMultiplier(event.particle.radiusMultiplier ?? 1, 0.25, 4),
    };
  }
  // Swan's EFFVM_INIT_EMITTER_CIRCLE_MOVE only installs the movement
  // callback. Its frame/wait/count fields are not SPL resource multipliers.
  if (isCircleEmitterCommand(event)) {
    return { lifeMultiplier: 1, scaleMultiplier: 1, speedMultiplier: 1, radiusMultiplier: 1 };
  }
  const layout = spaCommandLayout(event);
  return {
    lifeMultiplier: clampMultiplier(fxParam(event.params[layout.lifeParam]), 0.25, 4),
    scaleMultiplier: clampMultiplier(fxParam(event.params[layout.scaleParam]), 0.125, 8),
    speedMultiplier: clampMultiplier(fxParam(event.params[layout.speedParam]), 0.125, 8),
    radiusMultiplier: clampMultiplier(fxParam(event.params[layout.radiusParam]), 0.25, 4),
  };
}

function scriptEmitterOrigin(event: MoveAnimationTimelineEvent, anchors: BattleAnchorSet): Vec3 {
  if (event.particle?.origin) return event.particle.origin;
  if (!anchors.usesGen5SourceSpace && (event.particle?.screen || event.command.includes("Screen"))) return [0, 18, 0];
  const source = commandSource(event, anchors);
  if (!anchors.usesGen5SourceSpace) return source;
  const offset = gen5CommandOffset(event);
  const depthOffset = isCircleEmitterCommand(event) ? 0 : GEN5_EFFECT_PARTICLE_DEPTH_OFFSET;
  return [source[0] + offset[0], source[1] + offset[1], source[2] + offset[2] + depthOffset];
}

function scriptEmitterOriginAt(event: MoveAnimationTimelineEvent, frame: number, anchors: BattleAnchorSet): Vec3 {
  const base = scriptEmitterOrigin(event, anchors);
  if (anchors.usesGen5SourceSpace) {
    if (isCircleEmitterCommand(event)) return gen5CircleEmitterPosition(event, frame, anchors);
    if (isProjectileEvent(event)) return gen5ProjectileEmitterPosition(event, frame, anchors);
  }
  const motion = event.particle?.originMotion;
  if (!motion) return base;
  const localFrame = Math.max(0, frame - Math.max(0, motion.delay ?? 0));
  if (motion.rotation) return add(base, rotatingMotionOffset(motion.rotation, motion.duration, localFrame));
  const duration = Math.max(1, motion.duration);
  const t = clamp01(localFrame / duration);
  const eased = motion.easing === "linear" ? t : 1 - (1 - t) ** 3;
  const offset = mixVec(motion.from, motion.to, eased);
  if (motion.arcHeight) offset[1] += Math.sin(t * Math.PI) * motion.arcHeight;
  if (motion.waveAmplitude) offset[1] += Math.sin(t * Math.PI * 2) * motion.waveAmplitude;
  return add(base, offset);
}

function gen5CommandOffset(event: MoveAnimationTimelineEvent): Vec3 {
  switch (event.command) {
    case "DoSPAAnimation":
      return [0, fxParam(event.params[4]), 0];
    case "DoSPAAnimation2":
      return [fxParam(event.params[4]), fxParam(event.params[5]), fxParam(event.params[6])];
    case "DoSPAScreenAnimation":
      return [0, fxParam(event.params[8]), 0];
    case "DoSPAProjectileAnimation":
    case "DoSPAProjectileAnimation3":
      return [0, fxParam(event.params[5]), 0];
    case "DoSPAProjectileAnimation2":
      return [0, fxParam(event.params[7]), 0];
    case "DoSPACircleAnimation":
      return [0, fxParam(event.params[5]), 0];
    default:
      return [0, 0, 0];
  }
}

function gen5ProjectileEmitterPosition(event: MoveAnimationTimelineEvent, frame: number, anchors: BattleAnchorSet): Vec3 {
  let source = scriptEmitterOrigin(event, anchors);
  const offset = gen5CommandOffset(event);
  let destination = commandDestination(event, anchors);
  destination = [
    destination[0] + offset[0],
    destination[1] + offset[1],
    destination[2] + offset[2] + GEN5_EFFECT_PARTICLE_DEPTH_OFFSET,
  ];
  const moveType = event.params[2] ?? 0;
  if (moveType === 0) return source;
  if (moveType === 4) {
    const originalSource = source;
    source = destination;
    destination = add(originalSource, destination);
  }
  const durationParam = event.command === "DoSPAProjectileAnimation2" ? 8 : 6;
  const duration = Math.round(fxParam(event.params[durationParam]));
  // Swan leaves the emitter fixed at its source when move_frame is zero.
  // Resources such as Ancient Power and Hydro Cannon then travel using their
  // own axis velocity; moving the emitter to the destination as a one-frame
  // fallback adds a second source-to-target displacement to those particles.
  if (duration <= 0) return source;
  const t = clamp01(frame / duration);
  const eased = (1 - Math.cos(Math.PI * t)) / 2;
  const position = mixVec(source, destination, eased);
  const amplitude = fxParam(event.params[event.command === "DoSPAProjectileAnimation2" ? 9 : 7]);
  if (moveType === 2 || moveType === 3) position[1] += Math.sin(Math.PI * t) * amplitude;
  const wave = Math.max(1, fxParam(event.params[event.command === "DoSPAProjectileAnimation2" ? 12 : 10]));
  if (moveType === 5) position[1] += Math.sin(Math.PI * 2 * wave * t) * amplitude;
  if (moveType === 6) position[2] += Math.sin(Math.PI * 2 * wave * t) * amplitude;
  return position;
}

function isCircleEmitterCommand(event: MoveAnimationTimelineEvent): boolean {
  return event.command === "DoSPACircleAnimation";
}

function gen5CircleCenter(code: number | undefined, anchors: BattleAnchorSet): Vec3 {
  switch (code) {
    case 0:
    case 1:
      return copyBattleAnchor(anchors.user);
    case 2:
    case 3:
      return copyBattleAnchor(anchors.target);
    case 4:
    case 5:
    default:
      return [0, 0, 0];
  }
}

function gen5CircleEmitterPosition(event: MoveAnimationTimelineEvent, frame: number, anchors: BattleAnchorSet): Vec3 {
  const centerCode = event.params[2] ?? 4;
  const center = gen5CircleCenter(centerCode, anchors);
  center[1] += fxParam(event.params[5]);
  if (frame <= 0) return center;
  const radiusH = fxParam(event.params[3]);
  const radiusV = fxParam(event.params[4]);
  const framesPerTurn = Math.max(1, Math.round(event.params[6] ?? 1));
  const wait = Math.max(0, Math.round(event.params[7] ?? 0));
  const steps = Math.floor((frame - 1) / (wait + 1)) + 1;
  const startAngle = centerCode === 2 || centerCode === 3 ? Math.PI : 0;
  const direction = (centerCode & 1) === 1 ? -1 : 1;
  const angle = startAngle + direction * (steps / framesPerTurn) * Math.PI * 2;
  return [center[0] + Math.sin(angle) * radiusH, center[1], center[2] + Math.cos(angle) * radiusV];
}

type ParticleRotationMotion = NonNullable<NonNullable<NonNullable<MoveAnimationTimelineEvent["particle"]>["originMotion"]>["rotation"]>;

function rotatingMotionOffset(rotation: ParticleRotationMotion, duration: number, frame: number): Vec3 {
  const t = clamp01((frame + 1) / Math.max(1, duration));
  const angleX = degToRad(mix(rotation.startAngleX, rotation.endAngleX, t));
  const angleY = degToRad(mix(rotation.startAngleY, rotation.endAngleY, t));
  return [Math.sin(angleX) * rotation.radiusX, Math.cos(angleY) * rotation.radiusY, 0];
}

function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function emitterAxis(event: MoveAnimationTimelineEvent, fallback: Vec3, anchors: BattleAnchorSet): Vec3 {
  if (event.particle?.axis) return normalize(event.particle.axis);
  if (isCircleEmitterCommand(event)) return normalize(fallback);
  if (event.particle?.screen || event.command.includes("Screen")) return normalize(fallback);
  const src = commandSource(event, anchors);
  const dst = commandDestination(event, anchors);
  const delta = sub(dst, src);
  if (length(delta) <= 0.0001) return normalize(fallback);
  if (!anchors.usesGen5SourceSpace) return normalize(delta);
  return aimAuthoredAxisToward(fallback, delta);
}

function aimAuthoredAxisToward(axis: Vec3, targetDelta: Vec3): Vec3 {
  // EFFVM_InitEmitterPos rotates the SPA axis in the XZ plane toward the
  // destination. It deliberately retains the axis's authored Y component,
  // which controls the elevation of resource-velocity projectiles.
  const authored = normalize(axis);
  const authoredHorizontalLength = Math.hypot(authored[0], authored[2]);
  const targetHorizontalLength = Math.hypot(targetDelta[0], targetDelta[2]);
  if (authoredHorizontalLength <= 0.0001 || targetHorizontalLength <= 0.0001) return authored;
  return normalize([
    (targetDelta[0] / targetHorizontalLength) * authoredHorizontalLength,
    authored[1],
    (targetDelta[2] / targetHorizontalLength) * authoredHorizontalLength,
  ]);
}

function battleAnchor(code: number | undefined, anchors: BattleAnchorSet): Vec3 {
  switch (code) {
    case 9:
    case 10:
    case 13:
      return copyBattleAnchor(anchors.user);
    case 11:
    case 12:
      return copyBattleAnchor(anchors.target);
    case 8:
      return copyBattleAnchor(anchors.center);
    case 0:
    case 2:
      return copyBattleAnchor(anchors.user);
    case 1:
    case 3:
      return copyBattleAnchor(anchors.target);
    default:
      return copyBattleAnchor(anchors.target);
  }
}

function legacyProjectileInitialVelocity(event: MoveAnimationTimelineEvent, anchors: BattleAnchorSet): Vec3 {
  const start = commandSource(event, anchors);
  const end = commandDestination(event, anchors);
  const scriptedSpeed = Math.max(0, fxParam(event.params[spaCommandLayout(event).speedParam]));
  const fallbackSpeed = event.effectKind === "spa" && event.particle?.projectile ? LEGACY_PROJECTILE_FALLBACK_SPEED : 0;
  return scaleVec(normalize(sub(end, start)), (scriptedSpeed > 0 ? scriptedSpeed * LEGACY_PROJECTILE_SPEED_SCALE : fallbackSpeed));
}

type SpaCommandLayout = {
  sourceParam: number;
  destinationParam: number;
  radiusParam: number;
  lifeParam: number;
  scaleParam: number;
  speedParam: number;
};

function spaCommandLayout(event: MoveAnimationTimelineEvent): SpaCommandLayout {
  if (event.command === "DoSPAScreenAnimation") {
    return { sourceParam: -1, destinationParam: -1, radiusParam: 11, lifeParam: 12, scaleParam: 13, speedParam: 14 };
  }
  if (event.command === "DoSPAProjectileAnimation" || event.command === "DoSPAProjectileAnimation3") {
    return { sourceParam: 3, destinationParam: 4, radiusParam: -1, lifeParam: 8, scaleParam: -1, speedParam: 9 };
  }
  if (event.command === "DoSPAProjectileAnimation2") {
    return { sourceParam: -1, destinationParam: 6, radiusParam: -1, lifeParam: 10, scaleParam: -1, speedParam: 11 };
  }
  return { sourceParam: 2, destinationParam: 3, radiusParam: 7, lifeParam: 8, scaleParam: 9, speedParam: 10 };
}

function commandSource(event: MoveAnimationTimelineEvent, anchors: BattleAnchorSet): Vec3 {
  if (event.particle?.origin) return event.particle.origin;
  if (event.particle) return hgBattleAnchor(event.particle.sourceTarget, anchors);
  if (event.command === "DoSPAScreenAnimation") {
    return [fxParam(event.params[2]) * anchors.positionScale, fxParam(event.params[3]) * anchors.positionScale, fxParam(event.params[4]) * anchors.positionScale];
  }
  if (event.command === "DoSPAProjectileAnimation2") {
    return [fxParam(event.params[3]) * anchors.positionScale, fxParam(event.params[4]) * anchors.positionScale, fxParam(event.params[5]) * anchors.positionScale];
  }
  if (isCircleEmitterCommand(event)) return gen5CircleCenter(event.params[2], anchors);
  const layout = spaCommandLayout(event);
  return battleAnchor(event.params[layout.sourceParam], anchors);
}

function commandDestination(event: MoveAnimationTimelineEvent, anchors: BattleAnchorSet): Vec3 {
  if (event.particle?.destination) return event.particle.destination;
  if (event.particle) return hgBattleAnchor(event.particle.destinationTarget ?? event.particle.sourceTarget, anchors);
  if (event.command === "DoSPAScreenAnimation") {
    return [fxParam(event.params[5]) * anchors.positionScale, fxParam(event.params[6]) * anchors.positionScale, fxParam(event.params[7]) * anchors.positionScale];
  }
  const layout = spaCommandLayout(event);
  const destination = event.params[layout.destinationParam];
  if (destination === 8) return commandSource(event, anchors);
  if (!Number.isFinite(destination) || destination === undefined) return commandSource(event, anchors);
  return battleAnchor(destination, anchors);
}

function scriptedBehaviorTarget(event: MoveAnimationTimelineEvent, anchors: BattleAnchorSet): Vec3 | undefined {
  // EFFVM_InitEmitterPos replaces SPA-authored magnet and convergence
  // positions with a source-relative vector whenever the script supplies two
  // distinct battle positions. Drain effects such as Absorb depend on this:
  // their resource field is redirected from the defender to the attacker.
  if (event.particle) return undefined;
  if (
    event.command === "DoSPAScreenAnimation" ||
    event.command === "DoSPAProjectileAnimation2" ||
    isCircleEmitterCommand(event)
  ) return undefined;
  const layout = spaCommandLayout(event);
  const source = event.params[layout.sourceParam];
  const destination = event.params[layout.destinationParam];
  if (!Number.isFinite(source) || !Number.isFinite(destination) || destination === 8 || source === destination) return undefined;
  return scaleVec(sub(commandDestination(event, anchors), commandSource(event, anchors)), 1 / anchors.positionScale);
}

function isSpaEvent(event: MoveAnimationTimelineEvent): boolean {
  return event.effectKind === "spa" || event.command.startsWith("DoSPA");
}

function isProjectileEvent(event: MoveAnimationTimelineEvent): boolean {
  return event.particle?.projectile === true || event.command.includes("Projectile");
}

function particleRenderLayer(resource: SpaResource, particle: SimParticle): number {
  if (!particle.child) return resource.drawChildFirst ? 1 : 0;
  return resource.drawChildFirst ? 0 : 1;
}

function particleDrawType(resource: SpaResource, particle: SimParticle, event: MoveAnimationTimelineEvent): number {
  const drawType = particle.child?.drawType ?? resource.drawType;
  if (drawType <= 1) return drawType;
  if (event.particle?.alignToMotion) return 0;
  if (!usesAdvancedParticlePlacement(event)) return 0;
  return drawType;
}

function usesAdvancedParticlePlacement(event: MoveAnimationTimelineEvent): boolean {
  return event.particle?.axis !== undefined;
}

function particleScale(resource: SpaResource, particle: SimParticle, scaleMultiplier: number, animScale = particle.animScale): [number, number] {
  const base = particle.baseScale * scaleMultiplier * LEGACY_SPRITE_SCALE;
  let scaleX = base * Math.max(0.1, resource.aspectRatio || 1);
  let scaleY = base;
  switch (resource.scaleAnimDir) {
    case 1:
      scaleX *= animScale;
      break;
    case 2:
      scaleY *= animScale;
      break;
    case 0:
    default:
      scaleX *= animScale;
      scaleY *= animScale;
      break;
  }
  return [scaleX, scaleY];
}

function particleSourceScale(resource: SpaResource, particle: SimParticle, scaleMultiplier: number, animScale = particle.animScale): [number, number] {
  const base = particle.baseScale * scaleMultiplier * SPL_SOURCE_QUAD_DIAMETER;
  let scaleX = base * Math.max(0.1, resource.aspectRatio || 1);
  let scaleY = base;
  switch (resource.scaleAnimDir) {
    case 1:
      scaleX *= animScale;
      break;
    case 2:
      scaleY *= animScale;
      break;
    case 0:
    default:
      scaleX *= animScale;
      scaleY *= animScale;
      break;
  }
  return [Math.max(0.001, scaleX), Math.max(0.001, scaleY)];
}

function particleRenderAnimScale(event: MoveAnimationTimelineEvent, resource: SpaResource, particle: SimParticle): number {
  if (!isHgAnchoredPaneResource(event, resource) || particle.child) return particle.animScale;
  return stableHgAnchoredPaneAnimScale(resource);
}

function stableHgAnchoredPaneAnimScale(resource: SpaResource): number {
  const anim = resource.scaleAnim;
  if (!anim) return 1;
  return Math.max(0.001, anim.start, anim.mid, anim.end);
}

function hgAnchoredPaneMotionOffset(event: MoveAnimationTimelineEvent, resource: SpaResource, particle: SimParticle, scaleMultiplier: number): Vec3 {
  if (!isHgAnchoredPaneResource(event, resource) || particle.child) return [0, 0, 0];
  const stableScale = stableHgAnchoredPaneAnimScale(resource);
  const travelScale = Math.max(0, stableScale - particle.animScale);
  if (travelScale <= 0) return [0, 0, 0];
  const base = particle.baseScale * scaleMultiplier * LEGACY_SPRITE_SCALE;
  const direction = event.particle?.anchoredPaneMotionDirection ?? (resource.offsetPos === 2 ? 1 : -1);
  return [0, direction * base * travelScale, 0];
}

function effectiveScaleMultiplier(event: MoveAnimationTimelineEvent, resource: SpaResource, params: EventParams): number {
  if (!isHgAnchoredPaneResource(event, resource)) return params.scaleMultiplier;
  const normalized = HG_ANCHORED_PANE_TARGET_SCALE / Math.max(0.001, resource.baseScale * stableHgAnchoredPaneAnimScale(resource));
  return Math.min(params.scaleMultiplier, normalized);
}

function resourceBasePositionMultiplier(event: MoveAnimationTimelineEvent, resource: SpaResource): number {
  return isHgAnchoredPaneResource(event, resource) ? HG_ANCHORED_PANE_POSITION_SCALE : 1;
}

function isHgAnchoredPaneResource(event: MoveAnimationTimelineEvent, resource: SpaResource): boolean {
  return event.particle?.useResourceAnchor === true && (resource.emissionType === 0 || resource.emissionType === 7) && resource.emissionCount === 1 && (resource.offsetPos === 1 || resource.offsetPos === 2);
}

function textureAnchorOffsetY(event: MoveAnimationTimelineEvent, resource: SpaResource, archive: SpaArchive, textureIndex: number, anchorY: number): number {
  if (!isHgAnchoredPaneResource(event, resource)) return 0;
  const texture = archive.textures[textureIndex];
  if (!texture) return 0;
  const bounds = textureAlphaBounds(texture.rgba, texture.width, texture.height);
  if (!bounds) return 0;
  if (anchorY === 1) return bounds.minY / texture.height;
  if (anchorY === 0) return -((texture.height - (bounds.maxY + 1)) / texture.height);
  return 0;
}

function textureAlphaBounds(rgba: Uint8ClampedArray, width: number, height: number): { minY: number; maxY: number } | undefined {
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return maxY >= minY ? { minY, maxY } : undefined;
}

function screenPlanePaneScale(event: MoveAnimationTimelineEvent, resource: SpaResource, params: EventParams, positionScale: number): [number, number] | undefined {
  if (!event.particle?.screenPlane || resource.emissionType !== 3) return undefined;
  const side = screenPlaneRegularSide(resource.emissionCount);
  if (!side) return undefined;
  const radius = nonzero(Math.abs(resource.radius) * params.radiusMultiplier);
  const cell = (radius * 2 * positionScale) / (side - 1);
  return [cell * 1.35, cell * 0.85];
}

function screenPlaneRegularSide(count: number): number | undefined {
  const side = Math.round(Math.sqrt(count));
  return side >= 2 && side * side === count ? side : undefined;
}

function particleForeshortening(event: MoveAnimationTimelineEvent, particle: SimParticle, resource: SpaResource): number {
  const drawType = particleDrawType(resource, particle, event);
  if (event.particle?.foreshorten === false && drawType < 2) return 1;
  if (!event.particle?.axis && drawType < 2) return 1;
  const phase = particle.rotation * 1.7 + particle.ageFrames * 0.28 + particle.lifeRateOffset * Math.PI * 2;
  const faceAmount = Math.abs(Math.sin(phase));
  return 0.12 + faceAmount * 0.88;
}

function particleScreenRotation(event: MoveAnimationTimelineEvent, particle: SimParticle, resource: SpaResource, renderVelocity: Vec3): number {
  const drawType = particleDrawType(resource, particle, event);
  if (drawType >= 2) return particle.rotation;
  if (event.particle?.screenRotation !== undefined) {
    const wobble = Math.sin(particle.ageFrames * 0.35 + particle.lifeRateOffset * Math.PI * 2) * 0.08;
    return event.particle.screenRotation + wobble;
  }
  const sourceDrawType = particle.child?.drawType ?? resource.drawType;
  const dspreScreenRotation = event.particle?.dspreScreenRotation === true;
  if (event.particle?.alignToMotion && (!dspreScreenRotation || sourceDrawType !== 0) && drawType !== 1 && length(renderVelocity) > 0.0001) {
    return Math.atan2(renderVelocity[1], renderVelocity[0]) + (event.particle.alignRotationOffset ?? 0) + particle.rotation;
  }
  if (dspreScreenRotation && sourceDrawType === 0) return particle.rotation + Math.PI;
  return particle.rotation;
}

function particleAnchor(resource: SpaResource, child?: SpaChildResource): [number, number] {
  if (child) return [0.5, 0.5];
  switch (resource.offsetPos) {
    case 1:
      return [0.5, 1];
    case 2:
      return [0.5, 0];
    case 3:
      return [1, 0.5];
    case 4:
      return [0, 0.5];
    case 0:
    default:
      return [0.5, 0.5];
  }
}

function hgBattleAnchor(code: number | undefined, anchors: BattleAnchorSet): Vec3 {
  switch (code) {
    case 3:
    case 19:
      return copyBattleAnchor(anchors.user);
    case 4:
    case 20:
      return copyBattleAnchor(anchors.target);
    case 17:
      return copyBattleAnchor(anchors.center);
    default:
      return copyBattleAnchor(anchors.target);
  }
}

function battleAnchorsForPreview(preview: MoveAnimationPreview): BattleAnchorSet {
  if (!preview.battleEnvironment) {
    return {
      user: copyBattleAnchor(USER_BATTLE_ANCHOR),
      target: copyBattleAnchor(TARGET_BATTLE_ANCHOR),
      center: copyBattleAnchor(CENTER_BATTLE_ANCHOR),
      positionScale: LEGACY_POSITION_SCALE,
      velocityStepScale: LEGACY_VELOCITY_STEP_SCALE,
      usesGen5SourceSpace: false,
    };
  }
  const user: Vec3 = [...GEN5_SINGLE_USER_POKEMON_POSITION];
  const target: Vec3 = [...GEN5_SINGLE_TARGET_POKEMON_POSITION];
  return {
    user,
    target,
    center: [(user[0] + target[0]) / 2, (user[1] + target[1]) / 2, (user[2] + target[2]) / 2],
    positionScale: 1,
    velocityStepScale: 1,
    usesGen5SourceSpace: true,
  };
}

function applyScaleAnim(anim: NonNullable<SpaResource["scaleAnim"]>, lifeRate: number): number {
  const curveIn = Math.max(0.0001, anim.curveIn);
  const curveOut = Math.min(0.9999, Math.max(curveIn, anim.curveOut));
  if (lifeRate < curveIn) return mix(anim.start, anim.mid, lifeRate / curveIn);
  if (lifeRate < curveOut) return anim.mid;
  return mix(anim.mid, anim.end, (lifeRate - curveOut) / Math.max(0.0001, 1 - curveOut));
}

function applyColorAnim(anim: NonNullable<SpaResource["colorAnim"]>, base: Vec3, lifeRate: number): Vec3 {
  if (lifeRate < anim.curveIn) return anim.start;
  if (lifeRate < anim.curvePeak) return anim.interpolate ? mixVec(anim.start, base, (lifeRate - anim.curveIn) / Math.max(0.0001, anim.curvePeak - anim.curveIn)) : base;
  if (lifeRate < anim.curveOut) return anim.interpolate ? mixVec(base, anim.end, (lifeRate - anim.curvePeak) / Math.max(0.0001, anim.curveOut - anim.curvePeak)) : anim.end;
  return anim.end;
}

function applyAlphaAnim(anim: NonNullable<SpaResource["alphaAnim"]>, lifeRate: number, rng: DeterministicRng): number {
  const curveIn = Math.max(0.0001, anim.curveIn);
  const curveOut = Math.min(0.9999, Math.max(curveIn, anim.curveOut));
  let alpha = anim.mid;
  if (lifeRate < curveIn) alpha = mix(anim.start, anim.mid, lifeRate / curveIn);
  else if (lifeRate >= curveOut) alpha = mix(anim.mid, anim.end, (lifeRate - curveOut) / Math.max(0.0001, 1 - curveOut));
  return clamp01(scaledRange(alpha, anim.randomRange, rng));
}

function applyTexAnim(anim: NonNullable<SpaResource["texAnim"]>, lifeRate: number, fallback: number): number {
  const textures = anim.textures.slice(0, Math.max(1, anim.textureCount));
  for (let i = 0; i < textures.length; i += 1) {
    if (lifeRate < anim.step * (i + 1)) return textures[i] ?? fallback;
  }
  return textures[textures.length - 1] ?? fallback;
}

class DeterministicRng {
  constructor(private state: number) {
    if (this.state === 0) this.state = 0x6d2b79f5;
  }

  next(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  fork(salt: number): DeterministicRng {
    return new DeterministicRng((this.state ^ ((salt * 2654435761) >>> 0)) >>> 0);
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  aroundZero(range: number): number {
    return this.range(-range, range);
  }

  unitVector(): Vec3 {
    return normalize([this.next() * 2 - 1, this.next() * 2 - 1, this.next() * 2 - 1]);
  }

  circle(radius: number): [number, number] {
    const angle = this.next() * Math.PI * 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  }

  disk(radius: number): [number, number] {
    const [x, y] = this.circle(Math.sqrt(this.next()) * radius);
    return [x, y];
  }

  spherical(radius: number): Vec3 {
    return scaleVec(this.unitVector(), radius);
  }

  ball(radius: number): Vec3 {
    return scaleVec(this.unitVector(), Math.cbrt(this.next()) * radius);
  }
}

function orthogonalAxes(axisKind: number, axis: Vec3): [Vec3, Vec3] {
  if (axisKind === 2) return [[0, 1, 0], [0, 0, 1]];
  if (axisKind === 1) return [[1, 0, 0], [0, 0, 1]];
  if (axisKind === 3) {
    const helper: Vec3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const a = normalize(cross(axis, helper));
    return [a, normalize(cross(axis, a))];
  }
  return [[1, 0, 0], [0, 1, 0]];
}

function screenPlaneAxes(): [Vec3, Vec3] {
  return [[1, 0, 0], [0, 1, 0]];
}

function scaledRange(n: number, variance: number, rng: DeterministicRng): number {
  const min = n * (1 - variance / 2);
  const max = n * (1 + variance / 2);
  return rng.range(min, max);
}

function scaledRange2(n: number, variance: number, rng: DeterministicRng): number {
  return rng.range(n, n * (1 + variance));
}

function clampTextureIndex(index: number, archive: SpaArchive): number {
  if (archive.textures[index]) return index;
  return archive.textures.length > 0 ? 0 : index;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fxParam(value?: number): number {
  if (!Number.isFinite(value) || value === undefined) return 0;
  return value / 4096;
}

function clampMultiplier(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(min, Math.min(max, value));
}

function nonzero(value: number): number {
  return value === 0 ? 1 / 4096 : value;
}

function nonzeroBehaviorForce(value: number, fallback: number): number {
  return Math.abs(value) < 0.00001 ? fallback : value;
}

function fieldTargetToSimulation(target: Vec3, positionScale: number, relative?: boolean, origin?: Vec3): Vec3 {
  return scaleVec(relative && origin ? sub(target, origin) : target, 1 / positionScale);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

function mixVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scaleVec(v: Vec3, scale: number): Vec3 {
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: Vec3): Vec3 {
  const len = length(v);
  return len < 0.00001 ? [0, 1, 0] : [v[0] / len, v[1] / len, v[2] / len];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function rotateAxis(v: Vec3, axis: number, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  if (axis === 0) return [v[0], v[1] * cos - v[2] * sin, v[1] * sin + v[2] * cos];
  if (axis === 1) return [v[0] * cos + v[2] * sin, v[1], -v[0] * sin + v[2] * cos];
  return [v[0] * cos - v[1] * sin, v[0] * sin + v[1] * cos, v[2]];
}
