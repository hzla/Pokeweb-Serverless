import { getMoveAnimationDisplayCommandName, resolveMoveAnimationCommandName } from "./moveAnimationCommandNames";

export type MoveAnimationParamSemanticKind = "enum" | "fx32";
export type MoveAnimationFx32Unit = "multiplier" | "world" | "frame";

export type MoveAnimationEnumValue = {
  value: number;
  name: string;
  aliases?: string[];
  description?: string;
};

export type MoveAnimationParamSemantic = {
  kind: MoveAnimationParamSemanticKind;
  group?: string;
  description?: string;
  unit?: MoveAnimationFx32Unit;
};

export type MoveAnimationParamSemanticHelp = MoveAnimationParamSemantic & {
  values?: MoveAnimationEnumValue[];
};

type CommandParamKey = `${string}:${number}`;

const FX32_ONE = 4096;

const enumGroups = {
  cameraMove: [
    enumValue(0, "MOVE_DIRECT", ["DIRECT"]),
    enumValue(1, "MOVE_INTERPOLATION", ["INTERPOLATION"]),
    enumValue(2, "MOVE_INTERPOLATION_RELATIVE", ["MOVE_INTERPOLATION_RELATIVITY", "INTERPOLATION_RELATIVE"]),
  ],
  cameraPosition: [
    enumValue(0, "CAMERA_AA"),
    enumValue(1, "CAMERA_BB"),
    enumValue(2, "CAMERA_A"),
    enumValue(3, "CAMERA_B"),
    enumValue(4, "CAMERA_C"),
    enumValue(5, "CAMERA_D"),
    enumValue(6, "CAMERA_E"),
    enumValue(7, "CAMERA_F"),
    enumValue(8, "CAMERA_INIT"),
    enumValue(9, "CAMERA_ATTACKER", ["CAMERA_ATTACK", "CAMERA_USER"]),
    enumValue(10, "CAMERA_ATTACKER_PAIR", ["CAMERA_ATTACK_PAIR"]),
    enumValue(11, "CAMERA_DEFENDER", ["CAMERA_DEFENCE", "CAMERA_DEFENSE", "CAMERA_TARGET"]),
    enumValue(12, "CAMERA_DEFENDER_PAIR", ["CAMERA_DEFENCE_PAIR", "CAMERA_DEFENSE_PAIR"]),
    enumValue(13, "CAMERA_PUSH"),
    enumValue(14, "CAMERA_ZOOM_OUT"),
    enumValue(15, "CAMERA_PLURAL_A"),
    enumValue(16, "CAMERA_PLURAL_D"),
    enumValue(17, "CAMERA_INIT_ORTHO"),
    enumValue(18, "CAMERA_B_ORTHO"),
    enumValue(19, "CAMERA_ZOOM_OUT_ROTATION"),
    enumValue(20, "CAMERA_ZOOM_OUT_PERS"),
    enumValue(21, "CAMERA_ZOOM_OUT_ATTACKER", ["CAMERA_ZOOM_OUT_ATTACK"]),
    enumValue(-1, "CAMERA_NONE"),
  ],
  shakeDirection: [
    enumValue(0, "SHAKE_VERTICAL", ["VERTICAL"]),
    enumValue(1, "SHAKE_HORIZON", ["SHAKE_HORIZONTAL", "HORIZONTAL", "HORIZON"]),
  ],
  projectionType: [
    enumValue(0, "PROJECTION_ORTHO", ["ORTHO"]),
    enumValue(1, "PROJECTION_PERSPECTIVE", ["PERSPECTIVE"]),
  ],
  projectionTarget: [
    enumValue(0, "PROJECTION_ALL"),
    enumValue(1, "PROJECTION_ATTACKER", ["PROJECTION_ATTACK"]),
  ],
  particlePosition: [
    enumValue(0, "POS_AA"),
    enumValue(1, "POS_BB"),
    enumValue(2, "POS_A"),
    enumValue(3, "POS_B"),
    enumValue(4, "POS_C"),
    enumValue(5, "POS_D"),
    enumValue(6, "POS_E"),
    enumValue(7, "POS_F"),
    enumValue(8, "SIDE_NONE", ["NONE"]),
    enumValue(9, "SIDE_ATTACKER", ["SIDE_ATTACK", "SIDE_USER"]),
    enumValue(10, "SIDE_ATTACKER_MINUS", ["SIDE_ATTACK_MINUS"]),
    enumValue(11, "SIDE_DEFENDER", ["SIDE_DEFENCE", "SIDE_DEFENSE", "SIDE_TARGET"]),
    enumValue(12, "SIDE_DEFENDER_MINUS", ["SIDE_DEFENCE_MINUS", "SIDE_DEFENSE_MINUS"]),
    enumValue(13, "SIDE_ATTACKER_OFFSET", ["SIDE_ATTACK_OFFSET", "SIDE_ATTACKOFS"]),
    enumValue(14, "POS_A_DOUBLE"),
    enumValue(15, "POS_B_DOUBLE"),
    enumValue(16, "POS_C_DOUBLE"),
    enumValue(17, "POS_D_DOUBLE"),
    enumValue(18, "POS_A_DOUBLE_MINE"),
    enumValue(19, "POS_B_DOUBLE_MINE"),
    enumValue(20, "POS_C_DOUBLE_MINE"),
    enumValue(21, "POS_D_DOUBLE_MINE"),
  ],
  emitterMove: [
    enumValue(0, "EMITTER_NONE"),
    enumValue(1, "EMITTER_STRAIGHT"),
    enumValue(2, "EMITTER_CURVE"),
    enumValue(3, "EMITTER_CURVE_HALF"),
    enumValue(4, "EMITTER_OFFSET"),
    enumValue(5, "EMITTER_WAVE_VERTICAL", ["EMITTER_WAVE_V"]),
    enumValue(6, "EMITTER_WAVE_HORIZONTAL", ["EMITTER_WAVE_H"]),
  ],
  emitterCircleMove: [
    enumValue(0, "CIRCLE_ATTACKER_LEFT", ["CIRCLE_ATTACK_LEFT"]),
    enumValue(1, "CIRCLE_ATTACKER_RIGHT", ["CIRCLE_ATTACK_RIGHT"]),
    enumValue(2, "CIRCLE_DEFENDER_LEFT", ["CIRCLE_DEFENCE_LEFT", "CIRCLE_DEFENSE_LEFT"]),
    enumValue(3, "CIRCLE_DEFENDER_RIGHT", ["CIRCLE_DEFENCE_RIGHT", "CIRCLE_DEFENSE_RIGHT"]),
    enumValue(4, "CIRCLE_CENTER_LEFT"),
    enumValue(5, "CIRCLE_CENTER_RIGHT"),
  ],
  pokemonPosition: [
    enumValue(0, "POKEMON_AA"),
    enumValue(1, "POKEMON_BB"),
    enumValue(2, "POKEMON_A"),
    enumValue(3, "POKEMON_B"),
    enumValue(4, "POKEMON_C"),
    enumValue(5, "POKEMON_D"),
    enumValue(6, "POKEMON_E"),
    enumValue(7, "POKEMON_F"),
    enumValue(8, "TRAINER_AA"),
    enumValue(9, "TRAINER_BB"),
    enumValue(10, "TRAINER_A"),
    enumValue(11, "TRAINER_B"),
    enumValue(12, "TRAINER_C"),
    enumValue(13, "TRAINER_D"),
    enumValue(14, "POKEMON_ATTACKER", ["POKEMON_ATTACK", "POKEMON_USER", "USER"]),
    enumValue(15, "POKEMON_ATTACKER_PAIR", ["POKEMON_ATTACK_PAIR"]),
    enumValue(16, "POKEMON_DEFENDER", ["POKEMON_DEFENCE", "POKEMON_DEFENSE", "POKEMON_TARGET", "TARGET"]),
    enumValue(17, "POKEMON_DEFENDER_PAIR", ["POKEMON_DEFENCE_PAIR", "POKEMON_DEFENSE_PAIR"]),
    enumValue(18, "POKEMON_ALL"),
    enumValue(19, "POKEMON_MINE"),
    enumValue(20, "POKEMON_ENEMY"),
  ],
  motionType: [
    enumValue(0, "MOVE_DIRECT"),
    enumValue(1, "MOVE_INTERPOLATION"),
    enumValue(2, "MOVE_ROUNDTRIP"),
    enumValue(3, "MOVE_ROUNDTRIP_LONG"),
    enumValue(4, "MOVE_INTERPOLATION_DIRECT"),
    enumValue(5, "MOVE_INIT"),
    enumValue(6, "MOVE_INIT_DIRECT"),
  ],
  pokemonSineAxis: [
    enumValue(0, "SINE_X"),
    enumValue(1, "SINE_Y"),
  ],
  toggle: [enumValue(0, "OFF"), enumValue(1, "ON")],
  blinkMode: [
    enumValue(0, "BLINK_ON"),
    enumValue(1, "BLINK_OFF"),
    enumValue(2, "BLINK_FLIP"),
  ],
  animationFlag: [
    enumValue(0, "STOP", ["ANIMATION_STOP"]),
    enumValue(1, "START", ["ANIMATION_START"]),
  ],
  axis: [
    enumValue(0, "AXIS_X_LEFT"),
    enumValue(1, "AXIS_X_RIGHT"),
    enumValue(2, "AXIS_Y_LEFT"),
    enumValue(3, "AXIS_Y_RIGHT"),
    enumValue(4, "AXIS_Z_LEFT"),
    enumValue(5, "AXIS_Z_RIGHT"),
  ],
  shiftDirection: [
    enumValue(0, "SHIFT_H_PLUS"),
    enumValue(1, "SHIFT_H_MINUS"),
    enumValue(2, "SHIFT_V_PLUS"),
    enumValue(3, "SHIFT_V_MINUS"),
  ],
  soundPlayer: [
    enumValue(0, "SE_SYSTEM"),
    enumValue(1, "SE1"),
    enumValue(2, "SE2"),
    enumValue(3, "SE_PSG"),
    enumValue(4, "SE3"),
    enumValue(5, "SE_DEFAULT"),
  ],
  soundPan: [
    enumValue(0, "PAN_LEFT"),
    enumValue(1, "PAN_RIGHT"),
    enumValue(2, "PAN_FLAT"),
  ],
  soundPanType: [
    enumValue(0, "PAN_INTERPOLATION"),
    enumValue(1, "PAN_ROUNDTRIP"),
  ],
  endWait: [
    enumValue(0, "WAIT_ALL"),
    enumValue(1, "WAIT_CAMERA"),
    enumValue(2, "WAIT_PARTICLE"),
    enumValue(3, "WAIT_POKEMON"),
    enumValue(4, "WAIT_ANIME"),
    enumValue(5, "WAIT_BG"),
    enumValue(6, "WAIT_PALFADE_STAGE"),
    enumValue(7, "WAIT_PALFADE_FIELD"),
    enumValue(8, "WAIT_PALFADE_3D"),
    enumValue(9, "WAIT_PALFADE_EFFECT"),
    enumValue(10, "WAIT_SE_ALL"),
    enumValue(11, "WAIT_SE1"),
    enumValue(12, "WAIT_SE2"),
    enumValue(13, "WAIT_SE3"),
    enumValue(14, "WAIT_PSG"),
    enumValue(15, "WAIT_SYSTEM"),
    enumValue(16, "WAIT_VOICE"),
    enumValue(17, "WAIT_WINDOW"),
  ],
  controlMode: [
    enumValue(0, "CONTINUE", ["CONTROL_CONTINUE"]),
    enumValue(1, "SUSPEND", ["CONTROL_SUSPEND"]),
  ],
  workVar: [
    enumValue(0, "WORK_MOVE_RANGE"),
    enumValue(1, "WORK_TURN_COUNT"),
    enumValue(2, "WORK_CONTINUE_COUNT"),
    enumValue(3, "WORK_SHAKE_COUNT"),
    enumValue(4, "WORK_GET_SUCCESS"),
    enumValue(5, "WORK_GET_CRITICAL"),
    enumValue(6, "WORK_ITEM_NO"),
    enumValue(17, "WORK_SEQUENCE_WORK"),
    enumValue(18, "WORK_ATTACKER_POKEMON", ["WORK_ATTACK_POKEMON"]),
    enumValue(19, "WORK_ATTACKER_POKEMON_VANISH", ["WORK_ATTACK_POKEMON_VANISH"]),
    enumValue(20, "WORK_ATTACKER_POKEMON_DIR", ["WORK_ATTACK_POKEMON_DIR"]),
    enumValue(38, "WORK_MULTI"),
    enumValue(39, "WORK_RULE"),
    enumValue(53, "WORK_ZOOM_OUT"),
    enumValue(54, "WORK_PUSH_CAMERA_POS"),
    enumValue(55, "WORK_WCS_CAMERA_WORK"),
    enumValue(56, "WORK_CAMERA_MOVE_IGNORE"),
    enumValue(57, "WORK_DEFENDER_POKEMON", ["WORK_DEFENCE_POKEMON", "WORK_DEFENSE_POKEMON"]),
  ],
  condition: [
    enumValue(0, "COND_EQUAL", ["EQ"]),
    enumValue(1, "COND_NOT_EQUAL", ["NE"]),
    enumValue(2, "COND_LESS_THAN", ["LT"]),
    enumValue(3, "COND_GREATER_THAN", ["GT"]),
    enumValue(4, "COND_LESS_OR_EQUAL", ["LE"]),
    enumValue(5, "COND_GREATER_OR_EQUAL", ["GE"]),
  ],
  existCondition: [enumValue(0, "COND_NO_EXIST"), enumValue(1, "COND_EXIST")],
  substituteMode: [enumValue(0, "SUBSTITUTE_OFF"), enumValue(1, "SUBSTITUTE_ON")],
  cryDirection: [enumValue(0, "CRY_NORMAL"), enumValue(1, "CRY_REVERSE")],
  ballMode: [
    enumValue(0, "BALL_AA"),
    enumValue(1, "BALL_BB"),
    enumValue(2, "BALL_A"),
    enumValue(3, "BALL_B"),
    enumValue(4, "BALL_C"),
    enumValue(5, "BALL_D"),
    enumValue(6, "BALL_E"),
    enumValue(7, "BALL_F"),
    enumValue(8, "BALL_USE_ITEM"),
    enumValue(9, "BALL_ATTACKER", ["BALL_ATTACK"]),
  ],
  gaugeMode: [
    enumValue(0, "GAUGE_DRAW_OFF"),
    enumValue(1, "GAUGE_DRAW_ON"),
    enumValue(2, "GAUGE_MOVE_DRAW_OFF"),
    enumValue(3, "GAUGE_MOVE_DRAW_ON"),
  ],
  gaugeTarget: [
    enumValue(0, "GAUGE_MINE"),
    enumValue(1, "GAUGE_ENEMY"),
    enumValue(2, "GAUGE_ALL"),
    enumValue(3, "GAUGE_ATTACKER", ["GAUGE_ATTACK"]),
    enumValue(4, "GAUGE_DEFENDER", ["GAUGE_DEFENCE", "GAUGE_DEFENSE"]),
  ],
  landingWait: [enumValue(0, "LANDING_MINE"), enumValue(1, "LANDING_ENEMY")],
} satisfies Record<string, MoveAnimationEnumValue[]>;

type EnumGroupName = keyof typeof enumGroups;

const displayPrefixByEnumGroup: Partial<Record<EnumGroupName, string[]>> = {
  cameraMove: ["MOVE_"],
  cameraPosition: ["CAMERA_"],
  shakeDirection: ["SHAKE_"],
  projectionType: ["PROJECTION_"],
  projectionTarget: ["PROJECTION_"],
  particlePosition: ["SIDE_", "POS_"],
  emitterMove: ["EMITTER_"],
  emitterCircleMove: ["CIRCLE_"],
  pokemonPosition: ["POKEMON_"],
  motionType: ["MOVE_"],
  pokemonSineAxis: ["SINE_"],
  blinkMode: ["BLINK_"],
  axis: ["AXIS_"],
  shiftDirection: ["SHIFT_"],
  soundPlayer: ["SE_"],
  soundPan: ["PAN_"],
  soundPanType: ["PAN_"],
  endWait: ["WAIT_"],
  workVar: ["WORK_"],
  condition: ["COND_"],
  substituteMode: ["SUBSTITUTE_"],
  cryDirection: ["CRY_"],
  ballMode: ["BALL_"],
  gaugeMode: ["GAUGE_"],
  gaugeTarget: ["GAUGE_"],
  landingWait: ["LANDING_"],
};

const paramSemantics: Record<CommandParamKey, MoveAnimationParamSemantic> = {};

applyCommandSemantics("MoveCamera", { 0: enumSemantic("cameraMove"), 1: enumSemantic("cameraPosition") });
applyCommandSemantics("AdjustCamera", {
  0: enumSemantic("cameraMove"),
  1: worldFx32Semantic("Camera X coordinate; 4096 is 1px in orthographic/world-unit terms."),
  2: worldFx32Semantic("Camera Y coordinate; 4096 is 1px in orthographic/world-unit terms."),
  3: worldFx32Semantic("Camera Z coordinate; 4096 is 1px in orthographic/world-unit terms."),
  4: worldFx32Semantic("Camera target X coordinate; 4096 is 1px in orthographic/world-unit terms."),
  5: worldFx32Semantic("Camera target Y coordinate; 4096 is 1px in orthographic/world-unit terms."),
  6: worldFx32Semantic("Camera target Z coordinate; 4096 is 1px in orthographic/world-unit terms."),
});
applyCommandSemantics("CameraMoveAngle", { 0: enumSemantic("cameraMove") });
applyCommandSemantics("ShakeScreen", { 0: enumSemantic("shakeDirection"), 1: fx32Semantic("Shake amplitude"), 2: fx32Semantic("Shake offset") });
applyCommandSemantics("CameraProjection", { 0: enumSemantic("projectionType"), 1: enumSemantic("projectionTarget") });
applyCommandSemantics("DoSPAAnimation", {
  2: enumSemantic("particlePosition"),
  3: enumSemantic("particlePosition"),
  4: worldFx32Semantic("Emitter Y offset; 4096 is 1px in orthographic/world-unit terms."),
  7: fx32Semantic(),
  8: fx32Semantic(),
  9: fx32Semantic(),
  10: fx32Semantic(),
});
applyCommandSemantics("DoSPAScreenAnimation", {
  2: worldFx32Semantic("Emitter start X coordinate; 4096 is 1px in orthographic/world-unit terms."),
  3: worldFx32Semantic("Emitter start Y coordinate; 4096 is 1px in orthographic/world-unit terms."),
  4: worldFx32Semantic("Emitter start Z coordinate; 4096 is 1px in orthographic/world-unit terms."),
  5: worldFx32Semantic("Emitter destination X coordinate; 4096 is 1px in orthographic/world-unit terms."),
  6: worldFx32Semantic("Emitter destination Y coordinate; 4096 is 1px in orthographic/world-unit terms."),
  7: worldFx32Semantic("Emitter destination Z coordinate; 4096 is 1px in orthographic/world-unit terms."),
  8: worldFx32Semantic("Emitter Y offset; 4096 is 1px in orthographic/world-unit terms."),
  11: fx32Semantic(),
  12: fx32Semantic(),
  13: fx32Semantic(),
  14: fx32Semantic(),
});
applyCommandSemantics("DoSPAAnimation2", {
  2: enumSemantic("particlePosition"),
  3: enumSemantic("particlePosition"),
  4: worldFx32Semantic("Orthographic emitter X offset; 4096 is 1px."),
  5: worldFx32Semantic("Orthographic emitter Y offset; 4096 is 1px."),
  6: worldFx32Semantic("Orthographic emitter Z offset; 4096 is 1px."),
  7: fx32Semantic(),
  8: fx32Semantic(),
  9: fx32Semantic(),
  10: fx32Semantic(),
});
applyCommandSemantics("DoSPAAllAnimations", {
  1: enumSemantic("particlePosition"),
  2: enumSemantic("particlePosition"),
  3: worldFx32Semantic("Emitter Y offset; 4096 is 1px in orthographic/world-unit terms."),
  6: fx32Semantic(),
  7: fx32Semantic(),
  8: fx32Semantic(),
  9: fx32Semantic(),
});
applyCommandSemantics("DoSPAProjectileAnimation", {
  2: enumSemantic("emitterMove"),
  3: enumSemantic("particlePosition"),
  4: enumSemantic("particlePosition"),
  5: worldFx32Semantic("Projectile Y offset; 4096 is 1px in orthographic/world-unit terms."),
  6: frameFx32Semantic("Projectile movement duration; 4096 is 1 frame."),
  7: worldFx32Semantic("Projectile arc height/top value; 4096 is 1px in orthographic/world-unit terms."),
  8: fx32Semantic(),
  9: fx32Semantic(),
});
applyCommandSemantics("DoSPAProjectileAnimation2", {
  2: enumSemantic("emitterMove"),
  3: worldFx32Semantic("Projectile start X coordinate; 4096 is 1px in orthographic/world-unit terms."),
  4: worldFx32Semantic("Projectile start Y coordinate; 4096 is 1px in orthographic/world-unit terms."),
  5: worldFx32Semantic("Projectile start Z coordinate; 4096 is 1px in orthographic/world-unit terms."),
  6: enumSemantic("particlePosition"),
  7: worldFx32Semantic("Projectile Y offset; 4096 is 1px in orthographic/world-unit terms."),
  8: frameFx32Semantic("Projectile movement duration; 4096 is 1 frame."),
  9: worldFx32Semantic("Projectile arc height/top value; 4096 is 1px in orthographic/world-unit terms."),
  10: fx32Semantic(),
  11: fx32Semantic(),
});
applyCommandSemantics("DoSPAProjectileAnimation3", {
  2: enumSemantic("emitterMove"),
  3: enumSemantic("particlePosition"),
  4: enumSemantic("particlePosition"),
  5: worldFx32Semantic("Orthographic projectile Y offset; 4096 is 1px."),
  6: frameFx32Semantic("Orthographic projectile movement duration; 4096 is 1 frame."),
  7: worldFx32Semantic("Orthographic projectile arc height/top value; 4096 is 1px."),
  8: fx32Semantic(),
  9: fx32Semantic(),
});
applyCommandSemantics("DoSPAProjectileAnimationOrthoCoordinate", {
  2: enumSemantic("emitterMove"),
  3: worldFx32Semantic("Orthographic projectile start X coordinate; 4096 is 1px."),
  4: worldFx32Semantic("Orthographic projectile start Y coordinate; 4096 is 1px."),
  5: worldFx32Semantic("Orthographic projectile start Z coordinate; 4096 is 1px."),
  6: enumSemantic("particlePosition"),
  7: worldFx32Semantic("Orthographic projectile Y offset; 4096 is 1px."),
  8: frameFx32Semantic("Orthographic projectile movement duration; 4096 is 1 frame."),
  9: worldFx32Semantic("Orthographic projectile arc height/top value; 4096 is 1px."),
  10: fx32Semantic(),
  11: fx32Semantic(),
  12: fx32Semantic(),
});
applyCommandSemantics("DoSPACircleAnimation", {
  2: enumSemantic("emitterCircleMove"),
  3: worldFx32Semantic("Circle horizontal radius; 4096 is 1px in orthographic/world-unit terms."),
  4: worldFx32Semantic("Circle vertical radius; 4096 is 1px in orthographic/world-unit terms."),
  5: worldFx32Semantic("Circle Y offset; 4096 is 1px in orthographic/world-unit terms."),
});
applyCommandSemantics("DoSPAOrthoCircleAnimation", {
  2: enumSemantic("emitterCircleMove"),
  3: worldFx32Semantic("Orthographic circle horizontal radius; 4096 is 1px."),
  4: worldFx32Semantic("Orthographic circle vertical radius; 4096 is 1px."),
  5: worldFx32Semantic("Orthographic circle Y offset; 4096 is 1px."),
});
applyCommandSemantics("ShakeSprite", {
  0: enumSemantic("pokemonPosition"),
  2: worldFx32Semantic("Sprite X movement; 4096 is 1px in orthographic/world-unit terms."),
  3: worldFx32Semantic("Sprite Y movement; 4096 is 1px in orthographic/world-unit terms."),
});
applyCommandSemantics("MoveSprite", {
  0: enumSemantic("pokemonPosition"),
  1: enumSemantic("motionType"),
  3: worldFx32Semantic("Circle horizontal radius; 4096 is 1px in orthographic/world-unit terms."),
  4: worldFx32Semantic("Circle vertical radius; 4096 is 1px in orthographic/world-unit terms."),
});
applyCommandSemantics("PokemonSineMove", { 0: enumSemantic("pokemonPosition"), 1: enumSemantic("pokemonSineAxis"), 4: worldFx32Semantic("Sine movement radius; 4096 is 1px in orthographic/world-unit terms.") });
applyCommandSemantics("DistortSprite", {
  0: enumSemantic("pokemonPosition"),
  1: enumSemantic("motionType"),
  2: fx32Semantic("X offset scale; 4096 is 1x. For roundtrip modes this is the scale amplitude, not an axis selector."),
  3: fx32Semantic("Y offset scale; 4096 is 1x. For roundtrip modes this is the scale amplitude, not an axis selector."),
});
applyCommandSemantics("TiltSprite", { 0: enumSemantic("pokemonPosition"), 1: enumSemantic("motionType") });
applyCommandSemantics("SpriteOpacity", { 0: enumSemantic("pokemonPosition"), 1: enumSemantic("motionType") });
applyCommandSemantics("PokemonMosaic", { 0: enumSemantic("pokemonPosition"), 1: enumSemantic("motionType") });
applyCommandSemantics("PokemonBlinkFlag", { 0: enumSemantic("pokemonPosition"), 1: enumSemantic("blinkMode") });
applyCommandSemantics("FreezeSprite", { 0: enumSemantic("pokemonPosition"), 1: enumSemantic("animationFlag") });
applyCommandSemantics("ChangeColor", { 0: enumSemantic("pokemonPosition") });
applyCommandSemantics("ChangeVisibility", { 0: enumSemantic("pokemonPosition"), 1: enumSemantic("toggle") });
applyCommandSemantics("PokemonShadowVanish", { 0: enumSemantic("pokemonPosition"), 1: enumSemantic("toggle") });
applyCommandSemantics("PokemonShadowScale", { 0: enumSemantic("pokemonPosition"), 1: enumSemantic("motionType"), 2: fx32Semantic(), 3: fx32Semantic() });
applyCommandSemantics("DeletePokemon", { 0: enumSemantic("pokemonPosition") });
applyCommandSemantics("SetTrainer", {
  1: enumSemantic("pokemonPosition"),
  2: worldFx32Semantic("Trainer X coordinate; 4096 is 1px in orthographic/world-unit terms."),
  3: worldFx32Semantic("Trainer Y coordinate; 4096 is 1px in orthographic/world-unit terms."),
  4: worldFx32Semantic("Trainer Z coordinate; 4096 is 1px in orthographic/world-unit terms."),
});
applyCommandSemantics("MoveTrainer", {
  0: enumSemantic("pokemonPosition"),
  1: enumSemantic("motionType"),
  2: worldFx32Semantic("Trainer X movement; 4096 is 1px in orthographic/world-unit terms."),
  3: worldFx32Semantic("Trainer Y movement; 4096 is 1px in orthographic/world-unit terms."),
  4: worldFx32Semantic("Trainer Z movement; 4096 is 1px in orthographic/world-unit terms."),
});
applyCommandSemantics("DeleteTrainer", { 0: enumSemantic("pokemonPosition") });
applyCommandSemantics("MoveBackground", { 0: enumSemantic("motionType") });
applyCommandSemantics("BackgroundAlpha", { 0: enumSemantic("motionType") });
applyCommandSemantics("ApplyBackground", { 0: enumSemantic("toggle") });
applyCommandSemantics("SetObject", {
  2: enumSemantic("pokemonPosition"),
  3: worldFx32Semantic("Object X offset; 4096 is 1px in orthographic/world-unit terms."),
  4: worldFx32Semantic("Object Y offset; 4096 is 1px in orthographic/world-unit terms."),
  5: fx32Semantic(),
  6: fx32Semantic(),
});
applyCommandSemantics("MoveObject", {
  1: enumSemantic("motionType"),
  2: worldFx32Semantic("Object X movement; 4096 is 1px in orthographic/world-unit terms."),
  3: worldFx32Semantic("Object Y movement; 4096 is 1px in orthographic/world-unit terms."),
});
applyCommandSemantics("ScaleObject", { 1: enumSemantic("motionType"), 2: fx32Semantic(), 3: fx32Semantic() });
applyCommandSemantics("GaugeVanish", { 0: enumSemantic("gaugeMode"), 1: enumSemantic("gaugeTarget") });
applyCommandSemantics("PlaySound", { 1: enumSemantic("soundPlayer"), 2: enumSemantic("soundPan") });
applyCommandSemantics("StopSound", { 0: enumSemantic("soundPlayer") });
applyCommandSemantics("SwitchAudioSide", { 0: enumSemantic("soundPlayer"), 1: enumSemantic("soundPanType"), 2: enumSemantic("soundPan"), 3: enumSemantic("soundPan") });
applyCommandSemantics("AdjustSound", { 0: enumSemantic("soundPlayer") });
applyCommandSemantics("LetCMDsFinish", { 0: enumSemantic("endWait") });
applyCommandSemantics("AudioContainer", { 0: enumSemantic("controlMode") });
applyCommandSemantics("CheckMoveuser", { 0: enumSemantic("workVar"), 1: enumSemantic("condition") });
applyCommandSemantics("IfWork", { 0: enumSemantic("workVar"), 1: enumSemantic("condition"), 2: enumSemantic("workVar") });
applyCommandSemantics("McssPositionCheck", { 0: enumSemantic("pokemonPosition"), 1: enumSemantic("existCondition") });
applyCommandSemantics("GetWork", { 0: enumSemantic("workVar") });
applyCommandSemantics("SetParam", { 0: enumSemantic("workVar") });
applyCommandSemantics("Substitute", { 0: enumSemantic("substituteMode"), 1: enumSemantic("pokemonPosition") });
applyCommandSemantics("PlayPokemonCry", { 0: enumSemantic("pokemonPosition"), 5: enumSemantic("cryDirection") });
applyCommandSemantics("BallMode", { 0: enumSemantic("ballMode") });
applyCommandSemantics("SetBallObject", {
  1: enumSemantic("pokemonPosition"),
  2: worldFx32Semantic("Ball X offset; 4096 is 1px in orthographic/world-unit terms."),
  3: worldFx32Semantic("Ball Y offset; 4096 is 1px in orthographic/world-unit terms."),
  4: fx32Semantic(),
  5: fx32Semantic(),
});
applyCommandSemantics("CallSequence", { 1: enumSemantic("pokemonPosition"), 2: enumSemantic("pokemonPosition") });
applyCommandSemantics("LandingWait", { 0: enumSemantic("landingWait") });
applyCommandSemantics("ReverseDrawSet", { 0: enumSemantic("toggle") });

export function getMoveAnimationParamSemantic(commandName: string, paramIndex: number): MoveAnimationParamSemantic | undefined {
  return paramSemantics[paramKey(commandName, paramIndex)];
}

export function getMoveAnimationParamSemanticHelp(commandName: string, paramIndex: number): MoveAnimationParamSemanticHelp | undefined {
  const semantic = getMoveAnimationParamSemantic(commandName, paramIndex);
  if (!semantic) return undefined;
  if (semantic.kind === "enum" && semantic.group) {
    const group = semantic.group as EnumGroupName;
    return { ...semantic, values: enumGroups[group]?.map((value) => enumValueForDisplay(group, value)) ?? [] };
  }
  return { ...semantic };
}

export function getMoveAnimationCommandSemanticHelp(commandName: string): Map<number, MoveAnimationParamSemanticHelp> {
  const out = new Map<number, MoveAnimationParamSemanticHelp>();
  const resolvedName = resolveMoveAnimationCommandName(commandName);
  for (const key of Object.keys(paramSemantics) as CommandParamKey[]) {
    const [name, indexText] = key.split(":");
    if (name.toLowerCase() !== resolvedName.toLowerCase()) continue;
    const index = Number(indexText);
    const help = getMoveAnimationParamSemanticHelp(resolvedName, index);
    if (help) out.set(index, help);
  }
  return out;
}

export function getMoveAnimationEnumCompletions(commandName: string, paramIndex: number): MoveAnimationEnumValue[] {
  const semantic = getMoveAnimationParamSemantic(commandName, paramIndex);
  if (!semantic || semantic.kind !== "enum" || !semantic.group) return [];
  const group = semantic.group as EnumGroupName;
  return enumGroups[group]?.map((value) => enumValueForDisplay(group, value)) ?? [];
}

export function parseMoveAnimationParamToken(commandName: string, paramIndex: number, token: string): number {
  const integer = tryParseIntegerToken(token);
  if (integer !== undefined) return integer;

  const semantic = getMoveAnimationParamSemantic(commandName, paramIndex);
  const displayCommandName = getMoveAnimationDisplayCommandName(commandName);
  if (semantic?.kind === "fx32") {
    const fx32 = tryParseFx32Token(token, semantic.unit);
    if (fx32 !== undefined) return fx32;
  }

  if (semantic?.kind === "enum" && semantic.group) {
    const matched = parseEnumToken(semantic.group as EnumGroupName, token);
    if (matched !== undefined) return matched;
    throw new Error(`${displayCommandName} parameter ${paramIndex + 1} must be an integer or one of: ${validEnumNames(semantic.group as EnumGroupName)}`);
  }

  throw new Error(`${displayCommandName} parameter ${paramIndex + 1} must be an integer`);
}

export function formatMoveAnimationParam(commandName: string, paramIndex: number, value: number): string {
  const semantic = getMoveAnimationParamSemantic(commandName, paramIndex);
  if (semantic?.kind === "enum" && semantic.group) {
    const group = semantic.group as EnumGroupName;
    const entry = enumGroups[group]?.find((candidate) => candidate.value === value);
    if (entry) return displayEnumName(group, entry);
  }
  if (semantic?.kind === "fx32") {
    return formatFx32Value(value, semantic.unit);
  }
  return String(value);
}

export function parseMoveAnimationEditorParam(commandName: string, paramIndex: number, token: string): number | undefined {
  try {
    return parseMoveAnimationParamToken(commandName, paramIndex, token);
  } catch {
    return undefined;
  }
}

export function isMoveAnimationEnumToken(token: string): boolean {
  const normalized = normalizeSymbol(token);
  if (!normalized) return false;
  return (Object.keys(enumGroups) as EnumGroupName[]).some((group) => enumGroups[group].some((value) => enumNames(group, value).some((name) => normalizeSymbol(name) === normalized)));
}

export function isMoveAnimationFx32Token(token: string): boolean {
  return tryParseFx32Token(token, "multiplier") !== undefined || tryParseFx32Token(token, "world") !== undefined || tryParseFx32Token(token, "frame") !== undefined;
}

export function formatFx32Value(value: number, unit: MoveAnimationFx32Unit = "multiplier"): string {
  if (value === 0) return "0";
  const scaled = value / FX32_ONE;
  if (!Number.isInteger(scaled * 16)) return String(value);
  const suffix = unit === "world" ? "px" : unit === "frame" ? "f" : "x";
  if (Number.isInteger(scaled)) return `${scaled}${suffix}`;
  const text = scaled.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
  return `${text}${suffix}`;
}

function applyCommandSemantics(commandName: string, params: Record<number, MoveAnimationParamSemantic>): void {
  for (const [index, semantic] of Object.entries(params)) {
    paramSemantics[paramKey(commandName, Number(index))] = semantic;
  }
}

function enumSemantic(group: keyof typeof enumGroups, description?: string): MoveAnimationParamSemantic {
  return { kind: "enum", group, description };
}

function fx32Semantic(description = "FX32 multiplier; 4096 is 1x."): MoveAnimationParamSemantic {
  return { kind: "fx32", description, unit: "multiplier" };
}

function worldFx32Semantic(description = "FX32 world-unit value; 4096 is 1px."): MoveAnimationParamSemantic {
  return { kind: "fx32", description, unit: "world" };
}

function frameFx32Semantic(description = "FX32 frame count; 4096 is 1 frame."): MoveAnimationParamSemantic {
  return { kind: "fx32", description, unit: "frame" };
}

function enumValue(value: number, name: string, aliases: string[] = [], description?: string): MoveAnimationEnumValue {
  return { value, name, aliases, description };
}

function paramKey(commandName: string, paramIndex: number): CommandParamKey {
  return `${resolveMoveAnimationCommandName(commandName).toLowerCase()}:${paramIndex}`;
}

function enumNames(group: EnumGroupName, value: MoveAnimationEnumValue): string[] {
  return uniqueStrings([displayEnumName(group, value), value.name, ...(value.aliases ?? [])]);
}

function parseEnumToken(group: EnumGroupName, token: string): number | undefined {
  const normalized = normalizeSymbol(token);
  for (const value of enumGroups[group]) {
    if (enumNames(group, value).some((name) => normalizeSymbol(name) === normalized)) return value.value;
  }
  return undefined;
}

function validEnumNames(group: EnumGroupName): string {
  return enumGroups[group].map((value) => displayEnumName(group, value)).join(", ");
}

function enumValueForDisplay(group: EnumGroupName, value: MoveAnimationEnumValue): MoveAnimationEnumValue {
  const displayName = displayEnumName(group, value);
  const aliases = uniqueStrings([value.name, ...(value.aliases ?? [])]).filter((alias) => normalizeSymbol(alias) !== normalizeSymbol(displayName));
  return { ...value, name: displayName, aliases };
}

function displayEnumName(group: EnumGroupName, value: MoveAnimationEnumValue): string {
  const prefixes = displayPrefixByEnumGroup[group] ?? [];
  for (const prefix of prefixes) {
    if (value.name.startsWith(prefix) && value.name.length > prefix.length) return value.name.slice(prefix.length);
  }
  return value.name;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeSymbol(token: string): string {
  return token.trim().replace(/^[-+]/u, "").toUpperCase();
}

function tryParseIntegerToken(token: string): number | undefined {
  if (!/^[-+]?(?:0x[0-9a-f]+|\d+)$/iu.test(token)) return undefined;
  const sign = token.startsWith("-") ? -1 : 1;
  const normalized = token.replace(/^[-+]/u, "");
  const value = sign * (normalized.toLowerCase().startsWith("0x") ? Number.parseInt(normalized.slice(2), 16) : Number.parseInt(normalized, 10));
  if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647) throw new Error("value must fit in signed 32-bit range");
  return value;
}

function tryParseFx32Token(token: string, unit: MoveAnimationFx32Unit = "multiplier"): number | undefined {
  const suffix = unit === "world" ? "px" : unit === "frame" ? "f(?:rames?)?" : "x";
  const match = new RegExp(`^([-+]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))${suffix}$`, "iu").exec(token.trim());
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return undefined;
  const scaled = Math.round(value * FX32_ONE);
  if (!Number.isSafeInteger(scaled) || scaled < -2147483648 || scaled > 2147483647) throw new Error("FX32 value must fit in signed 32-bit range");
  return scaled;
}
