import { getMoveAnimationDisplayCommandName, resolveMoveAnimationCommandName } from "./moveAnimationCommandNames";

export type MoveAnimationParamSemanticKind = "enum" | "fx32";
export type MoveAnimationFx32Unit = "multiplier" | "world";

export type MoveAnimationEnumValue = {
  value: number;
  name: string;
  aliases?: string[];
  source?: string;
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
    enumValue(0, "MOVE_DIRECT", "BTLEFF_CAMERA_MOVE_DIRECT", ["DIRECT"]),
    enumValue(1, "MOVE_INTERPOLATION", "BTLEFF_CAMERA_MOVE_INTERPOLATION", ["INTERPOLATION"]),
    enumValue(2, "MOVE_INTERPOLATION_RELATIVE", "BTLEFF_CAMERA_MOVE_INTERPOLATION_RELATIVITY", ["MOVE_INTERPOLATION_RELATIVITY", "INTERPOLATION_RELATIVE"]),
  ],
  cameraPosition: [
    enumValue(0, "CAMERA_AA", "BTLEFF_CAMERA_POS_AA"),
    enumValue(1, "CAMERA_BB", "BTLEFF_CAMERA_POS_BB"),
    enumValue(2, "CAMERA_A", "BTLEFF_CAMERA_POS_A"),
    enumValue(3, "CAMERA_B", "BTLEFF_CAMERA_POS_B"),
    enumValue(4, "CAMERA_C", "BTLEFF_CAMERA_POS_C"),
    enumValue(5, "CAMERA_D", "BTLEFF_CAMERA_POS_D"),
    enumValue(6, "CAMERA_E", "BTLEFF_CAMERA_POS_E"),
    enumValue(7, "CAMERA_F", "BTLEFF_CAMERA_POS_F"),
    enumValue(8, "CAMERA_INIT", "BTLEFF_CAMERA_POS_INIT"),
    enumValue(9, "CAMERA_ATTACKER", "BTLEFF_CAMERA_POS_ATTACK", ["CAMERA_ATTACK", "CAMERA_USER"]),
    enumValue(10, "CAMERA_ATTACKER_PAIR", "BTLEFF_CAMERA_POS_ATTACK_PAIR", ["CAMERA_ATTACK_PAIR"]),
    enumValue(11, "CAMERA_DEFENDER", "BTLEFF_CAMERA_POS_DEFENCE", ["CAMERA_DEFENCE", "CAMERA_DEFENSE", "CAMERA_TARGET"]),
    enumValue(12, "CAMERA_DEFENDER_PAIR", "BTLEFF_CAMERA_POS_DEFENCE_PAIR", ["CAMERA_DEFENCE_PAIR", "CAMERA_DEFENSE_PAIR"]),
    enumValue(13, "CAMERA_PUSH", "BTLEFF_CAMERA_POS_PUSH"),
    enumValue(14, "CAMERA_ZOOM_OUT", "BTLEFF_CAMERA_POS_ZOOM_OUT"),
    enumValue(15, "CAMERA_PLURAL_A", "BTLEFF_CAMERA_POS_PLURAL_A"),
    enumValue(16, "CAMERA_PLURAL_D", "BTLEFF_CAMERA_POS_PLURAL_D"),
    enumValue(17, "CAMERA_INIT_ORTHO", "BTLEFF_CAMERA_POS_INIT_ORTHO"),
    enumValue(18, "CAMERA_B_ORTHO", "BTLEFF_CAMERA_POS_B_ORTHO"),
    enumValue(19, "CAMERA_ZOOM_OUT_ROTATION", "BTLEFF_CAMERA_POS_ZOOM_OUT_ROTATION"),
    enumValue(20, "CAMERA_ZOOM_OUT_PERS", "BTLEFF_CAMERA_POS_ZOOM_OUT_PERS"),
    enumValue(21, "CAMERA_ZOOM_OUT_ATTACKER", "BTLEFF_CAMERA_POS_ZOOM_OUT_ATTACK", ["CAMERA_ZOOM_OUT_ATTACK"]),
    enumValue(-1, "CAMERA_NONE", "BTLEFF_CAMERA_POS_NONE"),
  ],
  shakeDirection: [
    enumValue(0, "SHAKE_VERTICAL", "BTLEFF_CAMERA_SHAKE_VERTICAL", ["VERTICAL"]),
    enumValue(1, "SHAKE_HORIZON", "BTLEFF_CAMERA_SHAKE_HORIZON", ["SHAKE_HORIZONTAL", "HORIZONTAL", "HORIZON"]),
  ],
  projectionType: [
    enumValue(0, "PROJECTION_ORTHO", "BTLEFF_CAMERA_PROJECTION_ORTHO", ["ORTHO"]),
    enumValue(1, "PROJECTION_PERSPECTIVE", "BTLEFF_CAMERA_PROJECTION_PERSPECTIVE", ["PERSPECTIVE"]),
  ],
  projectionTarget: [
    enumValue(0, "PROJECTION_ALL", "BTLEFF_CAMERA_PROJECTION_ALL"),
    enumValue(1, "PROJECTION_ATTACKER", "BTLEFF_CAMERA_PROJECTION_ATTACK", ["PROJECTION_ATTACK"]),
  ],
  particlePosition: [
    enumValue(0, "POS_AA", "BTLEFF_PARTICLE_PLAY_POS_AA"),
    enumValue(1, "POS_BB", "BTLEFF_PARTICLE_PLAY_POS_BB"),
    enumValue(2, "POS_A", "BTLEFF_PARTICLE_PLAY_POS_A"),
    enumValue(3, "POS_B", "BTLEFF_PARTICLE_PLAY_POS_B"),
    enumValue(4, "POS_C", "BTLEFF_PARTICLE_PLAY_POS_C"),
    enumValue(5, "POS_D", "BTLEFF_PARTICLE_PLAY_POS_D"),
    enumValue(6, "POS_E", "BTLEFF_PARTICLE_PLAY_POS_E"),
    enumValue(7, "POS_F", "BTLEFF_PARTICLE_PLAY_POS_F"),
    enumValue(8, "SIDE_NONE", "BTLEFF_PARTICLE_PLAY_SIDE_NONE", ["NONE"]),
    enumValue(9, "SIDE_ATTACKER", "BTLEFF_PARTICLE_PLAY_SIDE_ATTACK", ["SIDE_ATTACK", "SIDE_USER"]),
    enumValue(10, "SIDE_ATTACKER_MINUS", "BTLEFF_PARTICLE_PLAY_SIDE_ATTACK_MINUS", ["SIDE_ATTACK_MINUS"]),
    enumValue(11, "SIDE_DEFENDER", "BTLEFF_PARTICLE_PLAY_SIDE_DEFENCE", ["SIDE_DEFENCE", "SIDE_DEFENSE", "SIDE_TARGET"]),
    enumValue(12, "SIDE_DEFENDER_MINUS", "BTLEFF_PARTICLE_PLAY_SIDE_DEFENCE_MINUS", ["SIDE_DEFENCE_MINUS", "SIDE_DEFENSE_MINUS"]),
    enumValue(13, "SIDE_ATTACKER_OFFSET", "BTLEFF_PARTICLE_PLAY_SIDE_ATTACKOFS", ["SIDE_ATTACK_OFFSET", "SIDE_ATTACKOFS"]),
    enumValue(14, "POS_A_DOUBLE", "BTLEFF_PARTICLE_PLAY_POS_A_DOUBLE"),
    enumValue(15, "POS_B_DOUBLE", "BTLEFF_PARTICLE_PLAY_POS_B_DOUBLE"),
    enumValue(16, "POS_C_DOUBLE", "BTLEFF_PARTICLE_PLAY_POS_C_DOUBLE"),
    enumValue(17, "POS_D_DOUBLE", "BTLEFF_PARTICLE_PLAY_POS_D_DOUBLE"),
    enumValue(18, "POS_A_DOUBLE_MINE", "BTLEFF_PARTICLE_PLAY_POS_A_DOUBLE_MINE"),
    enumValue(19, "POS_B_DOUBLE_MINE", "BTLEFF_PARTICLE_PLAY_POS_B_DOUBLE_MINE"),
    enumValue(20, "POS_C_DOUBLE_MINE", "BTLEFF_PARTICLE_PLAY_POS_C_DOUBLE_MINE"),
    enumValue(21, "POS_D_DOUBLE_MINE", "BTLEFF_PARTICLE_PLAY_POS_D_DOUBLE_MINE"),
  ],
  emitterMove: [
    enumValue(0, "EMITTER_NONE", "BTLEFF_EMITTER_MOVE_NONE"),
    enumValue(1, "EMITTER_STRAIGHT", "BTLEFF_EMITTER_MOVE_STRAIGHT"),
    enumValue(2, "EMITTER_CURVE", "BTLEFF_EMITTER_MOVE_CURVE"),
    enumValue(3, "EMITTER_CURVE_HALF", "BTLEFF_EMITTER_MOVE_CURVE_HALF"),
    enumValue(4, "EMITTER_OFFSET", "BTLEFF_EMITTER_MOVE_OFFSET"),
    enumValue(5, "EMITTER_WAVE_VERTICAL", "BTLEFF_EMITTER_MOVE_WAVE_V", ["EMITTER_WAVE_V"]),
    enumValue(6, "EMITTER_WAVE_HORIZONTAL", "BTLEFF_EMITTER_MOVE_WAVE_H", ["EMITTER_WAVE_H"]),
  ],
  emitterCircleMove: [
    enumValue(0, "CIRCLE_ATTACKER_LEFT", "BTLEFF_EMITTER_CIRCLE_MOVE_ATTACK_L", ["CIRCLE_ATTACK_LEFT"]),
    enumValue(1, "CIRCLE_ATTACKER_RIGHT", "BTLEFF_EMITTER_CIRCLE_MOVE_ATTACK_R", ["CIRCLE_ATTACK_RIGHT"]),
    enumValue(2, "CIRCLE_DEFENDER_LEFT", "BTLEFF_EMITTER_CIRCLE_MOVE_DEFENCE_L", ["CIRCLE_DEFENCE_LEFT", "CIRCLE_DEFENSE_LEFT"]),
    enumValue(3, "CIRCLE_DEFENDER_RIGHT", "BTLEFF_EMITTER_CIRCLE_MOVE_DEFENCE_R", ["CIRCLE_DEFENCE_RIGHT", "CIRCLE_DEFENSE_RIGHT"]),
    enumValue(4, "CIRCLE_CENTER_LEFT", "BTLEFF_EMITTER_CIRCLE_MOVE_CENTER_L"),
    enumValue(5, "CIRCLE_CENTER_RIGHT", "BTLEFF_EMITTER_CIRCLE_MOVE_CENTER_R"),
  ],
  pokemonPosition: [
    enumValue(0, "POKEMON_AA", "BTLEFF_POKEMON_POS_AA"),
    enumValue(1, "POKEMON_BB", "BTLEFF_POKEMON_POS_BB"),
    enumValue(2, "POKEMON_A", "BTLEFF_POKEMON_POS_A"),
    enumValue(3, "POKEMON_B", "BTLEFF_POKEMON_POS_B"),
    enumValue(4, "POKEMON_C", "BTLEFF_POKEMON_POS_C"),
    enumValue(5, "POKEMON_D", "BTLEFF_POKEMON_POS_D"),
    enumValue(6, "POKEMON_E", "BTLEFF_POKEMON_POS_E"),
    enumValue(7, "POKEMON_F", "BTLEFF_POKEMON_POS_F"),
    enumValue(8, "TRAINER_AA", "BTLEFF_TRAINER_POS_AA"),
    enumValue(9, "TRAINER_BB", "BTLEFF_TRAINER_POS_BB"),
    enumValue(10, "TRAINER_A", "BTLEFF_TRAINER_POS_A"),
    enumValue(11, "TRAINER_B", "BTLEFF_TRAINER_POS_B"),
    enumValue(12, "TRAINER_C", "BTLEFF_TRAINER_POS_C"),
    enumValue(13, "TRAINER_D", "BTLEFF_TRAINER_POS_D"),
    enumValue(14, "POKEMON_ATTACKER", "BTLEFF_POKEMON_SIDE_ATTACK", ["POKEMON_ATTACK", "POKEMON_USER", "USER"]),
    enumValue(15, "POKEMON_ATTACKER_PAIR", "BTLEFF_POKEMON_SIDE_ATTACK_PAIR", ["POKEMON_ATTACK_PAIR"]),
    enumValue(16, "POKEMON_DEFENDER", "BTLEFF_POKEMON_SIDE_DEFENCE", ["POKEMON_DEFENCE", "POKEMON_DEFENSE", "POKEMON_TARGET", "TARGET"]),
    enumValue(17, "POKEMON_DEFENDER_PAIR", "BTLEFF_POKEMON_SIDE_DEFENCE_PAIR", ["POKEMON_DEFENCE_PAIR", "POKEMON_DEFENSE_PAIR"]),
    enumValue(18, "POKEMON_ALL", "BTLEFF_POKEMON_ALL"),
    enumValue(19, "POKEMON_MINE", "BTLEFF_POKEMON_SIDE_MINE"),
    enumValue(20, "POKEMON_ENEMY", "BTLEFF_POKEMON_SIDE_ENEMY"),
  ],
  motionType: [
    enumValue(0, "MOVE_DIRECT", "EFFTOOL_CALCTYPE_DIRECT", ["BTLEFF_POKEMON_MOVE_DIRECT", "BTLEFF_POKEMON_SCALE_DIRECT", "BTLEFF_POKEMON_ROTATE_DIRECT", "BTLEFF_POKEMON_ALPHA_DIRECT", "BTLEFF_BG_SCROLL_DIRECT", "BTLEFF_BG_ALPHA_DIRECT", "BTLEFF_OBJ_MOVE_DIRECT", "BTLEFF_OBJ_SCALE_DIRECT"]),
    enumValue(1, "MOVE_INTERPOLATION", "EFFTOOL_CALCTYPE_INTERPOLATION", ["BTLEFF_POKEMON_MOVE_INTERPOLATION", "BTLEFF_POKEMON_SCALE_INTERPOLATION", "BTLEFF_POKEMON_ROTATE_INTERPOLATION", "BTLEFF_POKEMON_ALPHA_INTERPOLATION", "BTLEFF_BG_SCROLL_INTERPOLATION", "BTLEFF_BG_ALPHA_INTERPOLATION", "BTLEFF_OBJ_MOVE_INTERPOLATION", "BTLEFF_OBJ_SCALE_INTERPOLATION"]),
    enumValue(2, "MOVE_ROUNDTRIP", "EFFTOOL_CALCTYPE_ROUNDTRIP", ["BTLEFF_POKEMON_MOVE_ROUNDTRIP", "BTLEFF_POKEMON_SCALE_ROUNDTRIP", "BTLEFF_POKEMON_ROTATE_ROUNDTRIP", "BTLEFF_POKEMON_ALPHA_ROUNDTRIP", "BTLEFF_BG_SCROLL_ROUNDTRIP", "BTLEFF_BG_ALPHA_ROUNDTRIP", "BTLEFF_OBJ_MOVE_ROUNDTRIP", "BTLEFF_OBJ_SCALE_ROUNDTRIP"]),
    enumValue(3, "MOVE_ROUNDTRIP_LONG", "EFFTOOL_CALCTYPE_ROUNDTRIP_LONG", ["BTLEFF_POKEMON_MOVE_ROUNDTRIP_LONG", "BTLEFF_POKEMON_SCALE_ROUNDTRIP_LONG", "BTLEFF_POKEMON_ROTATE_ROUNDTRIP_LONG", "BTLEFF_POKEMON_ALPHA_ROUNDTRIP_LONG", "BTLEFF_BG_SCROLL_ROUNDTRIP_LONG", "BTLEFF_BG_ALPHA_ROUNDTRIP_LONG", "BTLEFF_OBJ_MOVE_ROUNDTRIP_LONG", "BTLEFF_OBJ_SCALE_ROUNDTRIP_LONG"]),
    enumValue(4, "MOVE_INTERPOLATION_DIRECT", "EFFTOOL_CALCTYPE_INTERPOLATION_DIRECT", ["BTLEFF_POKEMON_MOVE_INTERPOLATION_DIRECT"]),
    enumValue(5, "MOVE_INIT", "BTLEFF_POKEMON_MOVE_INIT"),
    enumValue(6, "MOVE_INIT_DIRECT", "BTLEFF_POKEMON_MOVE_INIT_DIRECT"),
  ],
  pokemonSineAxis: [
    enumValue(0, "SINE_X", "BTLEFF_POKEMON_SIN_MOVE_X"),
    enumValue(1, "SINE_Y", "BTLEFF_POKEMON_SIN_MOVE_Y"),
  ],
  toggle: [enumValue(0, "OFF"), enumValue(1, "ON")],
  blinkMode: [
    enumValue(0, "BLINK_ON", "BTLEFF_MEPACHI_ON"),
    enumValue(1, "BLINK_OFF", "BTLEFF_MEPACHI_OFF"),
    enumValue(2, "BLINK_FLIP", "BTLEFF_MEPACHI_MABATAKI"),
  ],
  animationFlag: [
    enumValue(0, "STOP", "BTLEFF_ANM_STOP", ["ANIMATION_STOP"]),
    enumValue(1, "START", "BTLEFF_ANM_START", ["ANIMATION_START"]),
  ],
  axis: [
    enumValue(0, "AXIS_X_LEFT", "BTLEFF_AXIS_X_L"),
    enumValue(1, "AXIS_X_RIGHT", "BTLEFF_AXIS_X_R"),
    enumValue(2, "AXIS_Y_LEFT", "BTLEFF_AXIS_Y_L"),
    enumValue(3, "AXIS_Y_RIGHT", "BTLEFF_AXIS_Y_R"),
    enumValue(4, "AXIS_Z_LEFT", "BTLEFF_AXIS_Z_L"),
    enumValue(5, "AXIS_Z_RIGHT", "BTLEFF_AXIS_Z_R"),
  ],
  shiftDirection: [
    enumValue(0, "SHIFT_H_PLUS", "BTLEFF_SHIFT_H_P"),
    enumValue(1, "SHIFT_H_MINUS", "BTLEFF_SHIFT_H_M"),
    enumValue(2, "SHIFT_V_PLUS", "BTLEFF_SHIFT_V_P"),
    enumValue(3, "SHIFT_V_MINUS", "BTLEFF_SHIFT_V_M"),
  ],
  soundPlayer: [
    enumValue(0, "SE_SYSTEM", "BTLEFF_SEPLAY_SYSTEM"),
    enumValue(1, "SE1", "BTLEFF_SEPLAY_SE1"),
    enumValue(2, "SE2", "BTLEFF_SEPLAY_SE2"),
    enumValue(3, "SE_PSG", "BTLEFF_SEPLAY_PSG"),
    enumValue(4, "SE3", "BTLEFF_SEPLAY_SE3"),
    enumValue(5, "SE_DEFAULT", "BTLEFF_SEPLAY_DEFAULT"),
  ],
  soundPan: [
    enumValue(0, "PAN_LEFT", "BTLEFF_SEPAN_L"),
    enumValue(1, "PAN_RIGHT", "BTLEFF_SEPAN_R"),
    enumValue(2, "PAN_FLAT", "BTLEFF_SEPAN_FLAT"),
  ],
  soundPanType: [
    enumValue(0, "PAN_INTERPOLATION", "BTLEFF_SEPAN_INTERPOLATION"),
    enumValue(1, "PAN_ROUNDTRIP", "BTLEFF_SEPAN_ROUNDTRIP"),
  ],
  endWait: [
    enumValue(0, "WAIT_ALL", "BTLEFF_EFFENDWAIT_ALL"),
    enumValue(1, "WAIT_CAMERA", "BTLEFF_EFFENDWAIT_CAMERA"),
    enumValue(2, "WAIT_PARTICLE", "BTLEFF_EFFENDWAIT_PARTICLE"),
    enumValue(3, "WAIT_POKEMON", "BTLEFF_EFFENDWAIT_POKEMON"),
    enumValue(4, "WAIT_ANIME", "BTLEFF_EFFENDWAIT_ANIME"),
    enumValue(5, "WAIT_BG", "BTLEFF_EFFENDWAIT_BG"),
    enumValue(6, "WAIT_PALFADE_STAGE", "BTLEFF_EFFENDWAIT_PALFADE_STAGE"),
    enumValue(7, "WAIT_PALFADE_FIELD", "BTLEFF_EFFENDWAIT_PALFADE_FIELD"),
    enumValue(8, "WAIT_PALFADE_3D", "BTLEFF_EFFENDWAIT_PALFADE_3D"),
    enumValue(9, "WAIT_PALFADE_EFFECT", "BTLEFF_EFFENDWAIT_PALFADE_EFFECT"),
    enumValue(10, "WAIT_SE_ALL", "BTLEFF_EFFENDWAIT_SEALL"),
    enumValue(11, "WAIT_SE1", "BTLEFF_EFFENDWAIT_SE1"),
    enumValue(12, "WAIT_SE2", "BTLEFF_EFFENDWAIT_SE2"),
    enumValue(13, "WAIT_SE3", "BTLEFF_EFFENDWAIT_SE3"),
    enumValue(14, "WAIT_PSG", "BTLEFF_EFFENDWAIT_PSG"),
    enumValue(15, "WAIT_SYSTEM", "BTLEFF_EFFENDWAIT_SYSTEM"),
    enumValue(16, "WAIT_VOICE", "BTLEFF_EFFENDWAIT_VOICE"),
    enumValue(17, "WAIT_WINDOW", "BTLEFF_EFFENDWAIT_WINDOW"),
  ],
  controlMode: [
    enumValue(0, "CONTINUE", "BTLEFF_CONTROL_MODE_CONTINUE", ["CONTROL_CONTINUE"]),
    enumValue(1, "SUSPEND", "BTLEFF_CONTROL_MODE_SUSPEND", ["CONTROL_SUSPEND"]),
  ],
  workVar: [
    enumValue(0, "WORK_WAZA_RANGE", "BTLEFF_WORK_WAZA_RANGE"),
    enumValue(1, "WORK_TURN_COUNT", "BTLEFF_WORK_TURN_COUNT"),
    enumValue(2, "WORK_CONTINUE_COUNT", "BTLEFF_WORK_CONTINUE_COUNT"),
    enumValue(3, "WORK_YURE_CNT", "BTLEFF_WORK_YURE_CNT"),
    enumValue(4, "WORK_GET_SUCCESS", "BTLEFF_WORK_GET_SUCCESS"),
    enumValue(5, "WORK_GET_CRITICAL", "BTLEFF_WORK_GET_CRITICAL"),
    enumValue(6, "WORK_ITEM_NO", "BTLEFF_WORK_ITEM_NO"),
    enumValue(17, "WORK_SEQUENCE_WORK", "BTLEFF_WORK_SEQUENCE_WORK"),
    enumValue(18, "WORK_ATTACKER_POKEMON", "BTLEFF_WORK_ATTACK_POKEMON", ["WORK_ATTACK_POKEMON"]),
    enumValue(19, "WORK_ATTACKER_POKEMON_VANISH", "BTLEFF_WORK_ATTACK_POKEMON_VANISH", ["WORK_ATTACK_POKEMON_VANISH"]),
    enumValue(20, "WORK_ATTACKER_POKEMON_DIR", "BTLEFF_WORK_ATTACK_POKEMON_DIR", ["WORK_ATTACK_POKEMON_DIR"]),
    enumValue(38, "WORK_MULTI", "BTLEFF_WORK_MULTI"),
    enumValue(39, "WORK_RULE", "BTLEFF_WORK_RULE"),
    enumValue(53, "WORK_ZOOM_OUT", "BTLEFF_WORK_ZOOM_OUT"),
    enumValue(54, "WORK_PUSH_CAMERA_POS", "BTLEFF_WORK_PUSH_CAMERA_POS"),
    enumValue(55, "WORK_WCS_CAMERA_WORK", "BTLEFF_WORK_WCS_CAMERA_WORK"),
    enumValue(56, "WORK_CAMERA_MOVE_IGNORE", "BTLEFF_WORK_CAMERA_MOVE_IGNORE"),
    enumValue(57, "WORK_DEFENDER_POKEMON", "BTLEFF_WORK_DEFENCE_POKEMON", ["WORK_DEFENCE_POKEMON", "WORK_DEFENSE_POKEMON"]),
  ],
  condition: [
    enumValue(0, "COND_EQUAL", "BTLEFF_COND_EQUAL", ["EQ"]),
    enumValue(1, "COND_NOT_EQUAL", "BTLEFF_COND_NOT_EQUAL", ["NE"]),
    enumValue(2, "COND_LESS_THAN", "BTLEFF_COND_MIMAN", ["LT"]),
    enumValue(3, "COND_GREATER_THAN", "BTLEFF_COND_KOERU", ["GT"]),
    enumValue(4, "COND_LESS_OR_EQUAL", "BTLEFF_COND_IKA", ["LE"]),
    enumValue(5, "COND_GREATER_OR_EQUAL", "BTLEFF_COND_IJOU", ["GE"]),
  ],
  existCondition: [enumValue(0, "COND_NO_EXIST", "BTLEFF_COND_NO_EXIST"), enumValue(1, "COND_EXIST", "BTLEFF_COND_EXIST")],
  substituteMode: [enumValue(0, "SUBSTITUTE_OFF", "BTLEFF_MIGAWARI_OFF"), enumValue(1, "SUBSTITUTE_ON", "BTLEFF_MIGAWARI_ON")],
  cryDirection: [enumValue(0, "CRY_NORMAL", "BTLEFF_NAKIGOE_NORMAL"), enumValue(1, "CRY_REVERSE", "BTLEFF_NAKIGOE_REVERSE")],
  ballMode: [
    enumValue(0, "BALL_AA", "BTLEFF_CAPTURE_BALL_POS_AA"),
    enumValue(1, "BALL_BB", "BTLEFF_CAPTURE_BALL_POS_BB"),
    enumValue(2, "BALL_A", "BTLEFF_CAPTURE_BALL_POS_A"),
    enumValue(3, "BALL_B", "BTLEFF_CAPTURE_BALL_POS_B"),
    enumValue(4, "BALL_C", "BTLEFF_CAPTURE_BALL_POS_C"),
    enumValue(5, "BALL_D", "BTLEFF_CAPTURE_BALL_POS_D"),
    enumValue(6, "BALL_E", "BTLEFF_CAPTURE_BALL_POS_E"),
    enumValue(7, "BALL_F", "BTLEFF_CAPTURE_BALL_POS_F"),
    enumValue(8, "BALL_USE_ITEM", "BTLEFF_USE_BALL"),
    enumValue(9, "BALL_ATTACKER", "BTLEFF_CAPTURE_BALL_ATTACK", ["BALL_ATTACK"]),
  ],
  gaugeMode: [
    enumValue(0, "GAUGE_DRAW_OFF", "BTLEFF_GAUGE_DRAW_OFF"),
    enumValue(1, "GAUGE_DRAW_ON", "BTLEFF_GAUGE_DRAW_ON"),
    enumValue(2, "GAUGE_MOVE_DRAW_OFF", "BTLEFF_GAUGE_MOVE_DRAW_OFF"),
    enumValue(3, "GAUGE_MOVE_DRAW_ON", "BTLEFF_GAUGE_MOVE_DRAW_ON"),
  ],
  gaugeTarget: [
    enumValue(0, "GAUGE_MINE", "BTLEFF_GAUGE_MINE"),
    enumValue(1, "GAUGE_ENEMY", "BTLEFF_GAUGE_ENEMY"),
    enumValue(2, "GAUGE_ALL", "BTLEFF_GAUGE_ALL"),
    enumValue(3, "GAUGE_ATTACKER", "BTLEFF_GAUGE_ATTACK", ["GAUGE_ATTACK"]),
    enumValue(4, "GAUGE_DEFENDER", "BTLEFF_GAUGE_DEFENCE", ["GAUGE_DEFENCE", "GAUGE_DEFENSE"]),
  ],
  landingWait: [enumValue(0, "LANDING_MINE", "BTLEFF_LANDING_WAIT_MINE"), enumValue(1, "LANDING_ENEMY", "BTLEFF_LANDING_WAIT_ENEMY")],
} satisfies Record<string, MoveAnimationEnumValue[]>;

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
  9: worldFx32Semantic("Projectile arc height/top value; 4096 is 1px in orthographic/world-unit terms."),
  10: fx32Semantic(),
  11: fx32Semantic(),
});
applyCommandSemantics("DoSPAProjectileAnimation3", {
  2: enumSemantic("emitterMove"),
  3: enumSemantic("particlePosition"),
  4: enumSemantic("particlePosition"),
  5: worldFx32Semantic("Orthographic projectile Y offset; 4096 is 1px."),
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
  if (semantic.kind === "enum" && semantic.group) return { ...semantic, values: enumGroups[semantic.group as keyof typeof enumGroups]?.map((value) => ({ ...value, aliases: value.aliases?.slice() })) ?? [] };
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
  return enumGroups[semantic.group as keyof typeof enumGroups] ?? [];
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
    const matched = parseEnumToken(semantic.group as keyof typeof enumGroups, token);
    if (matched !== undefined) return matched;
    throw new Error(`${displayCommandName} parameter ${paramIndex + 1} must be an integer or one of: ${validEnumNames(semantic.group as keyof typeof enumGroups)}`);
  }

  throw new Error(`${displayCommandName} parameter ${paramIndex + 1} must be an integer`);
}

export function formatMoveAnimationParam(commandName: string, paramIndex: number, value: number): string {
  const semantic = getMoveAnimationParamSemantic(commandName, paramIndex);
  if (semantic?.kind === "enum" && semantic.group) {
    const entry = enumGroups[semantic.group as keyof typeof enumGroups]?.find((candidate) => candidate.value === value);
    if (entry) return entry.name;
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
  return Object.values(enumGroups).some((values) => values.some((value) => enumNames(value).some((name) => normalizeSymbol(name) === normalized)));
}

export function isMoveAnimationFx32Token(token: string): boolean {
  return tryParseFx32Token(token, "multiplier") !== undefined || tryParseFx32Token(token, "world") !== undefined;
}

export function formatFx32Value(value: number, unit: MoveAnimationFx32Unit = "multiplier"): string {
  if (value === 0) return "0";
  const scaled = value / FX32_ONE;
  if (!Number.isInteger(scaled * 16)) return String(value);
  const suffix = unit === "world" ? "px" : "x";
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

function enumValue(value: number, name: string, source?: string, aliases: string[] = [], description?: string): MoveAnimationEnumValue {
  return { value, name, source, aliases: source ? [source, ...aliases] : aliases, description };
}

function paramKey(commandName: string, paramIndex: number): CommandParamKey {
  return `${resolveMoveAnimationCommandName(commandName).toLowerCase()}:${paramIndex}`;
}

function enumNames(value: MoveAnimationEnumValue): string[] {
  return [value.name, ...(value.aliases ?? [])];
}

function parseEnumToken(group: keyof typeof enumGroups, token: string): number | undefined {
  const normalized = normalizeSymbol(token);
  for (const value of enumGroups[group]) {
    if (enumNames(value).some((name) => normalizeSymbol(name) === normalized)) return value.value;
  }
  return undefined;
}

function validEnumNames(group: keyof typeof enumGroups): string {
  return enumGroups[group].map((value) => value.name).join(", ");
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
  const suffix = unit === "world" ? "px" : "x";
  const match = new RegExp(`^([-+]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))${suffix}$`, "iu").exec(token.trim());
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return undefined;
  const scaled = Math.round(value * FX32_ONE);
  if (!Number.isSafeInteger(scaled) || scaled < -2147483648 || scaled > 2147483647) throw new Error("FX32 value must fit in signed 32-bit range");
  return scaled;
}
