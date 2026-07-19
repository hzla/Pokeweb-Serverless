export type Gen5BattleVec3 = readonly [number, number, number];

const FX32_ONE = 0x1000;

const fx32 = (value: number): number => value / FX32_ONE;

// Source: swan_export/prog/src/battle/btlv/btlv_camera.c
// GFL_G3D_CAMERA_Create receives SIN13/COS13, i.e. a 13-degree half-FOV.
export const GEN5_BATTLE_VERTICAL_FOV = 26;
export const GEN5_DEFAULT_CAMERA_POSITION: Gen5BattleVec3 = [6.7, 6.7, 17.3];
export const GEN5_DEFAULT_CAMERA_TARGET: Gen5BattleVec3 = [0, 2.6, 0];

// Source: swan_export/prog/src/battle/btlv/btlv_effvm.c
// cam_pos_table_1vs1 and cam_target_table_1vs1.
export const GEN5_SINGLE_USER_CAMERA_POSITION: Gen5BattleVec3 = [fx32(0x5ca6), fx32(0x5f33), fx32(0x13cc3)];
export const GEN5_SINGLE_USER_CAMERA_TARGET: Gen5BattleVec3 = [fx32(-0xe8d), fx32(0x1d9a), fx32(0x27f6)];
export const GEN5_SINGLE_TARGET_CAMERA_POSITION: Gen5BattleVec3 = [fx32(0x6994), fx32(0x6f33), fx32(0x6e79)];
export const GEN5_SINGLE_TARGET_CAMERA_TARGET: Gen5BattleVec3 = [fx32(-0x19f), fx32(0x2d9a), fx32(-0xa654)];

// Source: swan_export/prog/src/battle/btlv/btlv_stage.c
// stage_pos_table; BTLV_STAGE_DEFAULT_SCALE is FX32_ONE.
export const GEN5_USER_PLATFORM_POSITION: Gen5BattleVec3 = [0, 0, 5.449];
export const GEN5_TARGET_PLATFORM_POSITION: Gen5BattleVec3 = [0, 0, -12.718];
export const GEN5_PLATFORM_SCALE = 1;

// Source: swan_export/prog/src/battle/btlv/btlv_mcss.c
// poke_pos_single_table and poke_scale_single_table.
export const GEN5_SINGLE_USER_POKEMON_POSITION: Gen5BattleVec3 = [fx32(0x800), fx32(0x666), fx32(0x7000)];
export const GEN5_SINGLE_TARGET_POKEMON_POSITION: Gen5BattleVec3 = [fx32(0x4cd), fx32(0x666), fx32(-0xa000)];
export const GEN5_SINGLE_USER_POKEMON_SCALE = fx32(0x1030);
export const GEN5_SINGLE_TARGET_POKEMON_SCALE = fx32(0x11bf);

// Source: swan_export/prog/src/system/mcss.c
// MCSS_DEFAULT_SHIFT is FX32_SHIFT - 4, so one sprite pixel spans 1/16
// of a battle-world unit in perspective mode.
export const GEN5_MCSS_PIXELS_PER_WORLD_UNIT = 16;

// Source: swan_export/prog/src/battle/btlv/btlv_effvm.c
// EFFVM_InitEmitterPos moves regular particle emitters five MCSS depth steps
// toward the camera so they share the retail renderer's Pokemon/effect order.
export const GEN5_EFFECT_PARTICLE_DEPTH_OFFSET = 5 / GEN5_MCSS_PIXELS_PER_WORLD_UNIT;
