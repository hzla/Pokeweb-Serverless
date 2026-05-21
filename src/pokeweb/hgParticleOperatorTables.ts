import { TARGET_BATTLE_ANCHOR, USER_BATTLE_ANCHOR, type BattlePreviewAnchor } from "./battlePreviewAnchors";

type Vec3 = [number, number, number];
type ClientType = 0 | 1 | 2 | 3 | 4 | 5;
export type HgParticleOperatorEndpoint = "attacker" | "defender" | "attackerSide" | "defenderSide";

export type HgParticleOperatorContext = {
  attackerSide: "player" | "opponent";
  contest?: boolean;
  cameraMode?: 0 | 1;
};

const CLIENT_AA = 0;
const CLIENT_BB = 1;
const CLIENT_A = 2;
const CLIENT_B = 3;

const OPERATOR_TARGET_AT = 1;
const OPERATOR_TARGET_DF = 2;
const OPERATOR_TARGET_AT_SIDE = 3;
const OPERATOR_TARGET_DF_SIDE = 4;

const POS_MODE_NORMAL = 0;
const POS_MODE_LASER = 1;
const POS_MODE_LASER_2 = 2;
const POS_MODE_LASER_3 = 3;
const POS_MODE_L095 = 4;
const POS_MODE_L161 = 5;
const POS_MODE_L308 = 6;
const POS_MODE_L304 = 7;
const POS_MODE_L320 = 8;
const POS_MODE_L406 = 9;
const POS_MODE_LOOK_AT = 10;
const POS_MODE_RING = 11;

const SOURCE_POSITION_RAW: Vec3 = [-14936,-5032,64];
const TARGET_POSITION_RAW: Vec3 = [7368,5960,-5248];
const AXIS_REFERENCE_RAW: Vec3 = [5986,1584,3064];
const POS_145_RAW: Vec3[] = [[-5760,-4352,0],[9488,-1984,0],[-11760,3280,0],[13768,-1464,0],[-5376,-2808,0],[6984,2056,0]];
const AXIS_145_RAW: Vec3[] = [[2864,3752,0],[-2944,1456,0],[2840,-854,0],[-3760,-2536,0],[2288,2408,0],[-3312,-2776,0]];

const POSITION_SCALE: Vec3 = [
  (TARGET_BATTLE_ANCHOR[0] - USER_BATTLE_ANCHOR[0]) / (TARGET_POSITION_RAW[0] - SOURCE_POSITION_RAW[0]),
  (TARGET_BATTLE_ANCHOR[1] - USER_BATTLE_ANCHOR[1]) / (TARGET_POSITION_RAW[1] - SOURCE_POSITION_RAW[1]),
  (TARGET_BATTLE_ANCHOR[2] - USER_BATTLE_ANCHOR[2]) / (TARGET_POSITION_RAW[2] - SOURCE_POSITION_RAW[2]),
];

const AXIS_SCALE: Vec3 = [
  (TARGET_BATTLE_ANCHOR[0] - USER_BATTLE_ANCHOR[0]) / AXIS_REFERENCE_RAW[0],
  (TARGET_BATTLE_ANCHOR[1] - USER_BATTLE_ANCHOR[1]) / AXIS_REFERENCE_RAW[1],
  (TARGET_BATTLE_ANCHOR[2] - USER_BATTLE_ANCHOR[2]) / AXIS_REFERENCE_RAW[2],
];

const PARTICLE_POSITION_TABLE: Vec3[][] = [[[-9616,-5464,64],[-10240,-6400,64],[-3968,-3328,64],[-6568,-4000,64],[-3968,-3328,64],[-6720,-5792,64],[-8632,-6936,0],[-8632,-6936,0],[-12544,-3840,0],[-12544,-3840,0],[-9632,-5856,0],[-9632,-5856,0],[-4144,-5200,0],[-4144,-5200,0],[-12480,-4288,0],[-12480,-4288,0],[-1792,-4224,0],[-1792,-4224,0],[-8320,-4160,0],[-8320,-4160,0],[9080,5536,0],[9080,5536,0],[-6248,-2944,0],[-6248,-2944,0]],[[11056,4400,-5248],[10240,3072,-5248],[9344,2176,-5248],[8800,6464,-5248],[9344,2176,-5248],[14528,8032,-5248],[12904,5108,0],[12904,5108,0],[5432,6680,0],[5432,6680,0],[13144,11272,0],[13144,11272,0],[16592,5168,0],[16592,5168,0],[13184,7616,0],[13184,7616,0],[16896,3328,0],[16896,3328,0],[10880,4480,0],[10880,4480,0],[-6936,-4832,0],[-6936,-4832,0],[8280,5432,0],[8280,5432,0]],[[-14936,-5032,64],[-15360,-6272,64],[-9856,-3200,64],[-11400,-2944,64],[-9856,-3200,64],[-9856,-3200,64],[-9456,-3104,0],[-9456,-3104,0],[-17856,-3624,0],[-17856,-3624,0],[-12592,-2976,0],[-12592,-2976,0],[-6366,-3776,0],[-6366,-3776,0],[-14912,-2176,0],[-14912,-2176,0],[-6080,-5504,0],[-6080,-5504,0],[-12032,-3200,0],[-12032,-3200,0],[10824,7488,0],[10824,7488,0],[-9856,-3200,0],[-9856,-3200,0]],[[7368,5960,-5248],[13568,2944,-5248],[13568,2944,-5248],[12656,5736,-5248],[13568,2944,-5248],[13568,2944,-5248],[17984,6336,0],[17984,6336,0],[8024,6008,0],[8024,6008,0],[13072,6208,0],[13072,6208,0],[17408,5184,0],[17408,5184,0],[16128,7360,0],[16128,7360,0],[20672,3480,0],[20672,3480,0],[13440,5408,0],[13440,5408,0],[-9536,-3120,2728],[-9536,-3120,2728],[13568,2944,0],[13568,2944,0]],[[-5364,-6568,-1024],[-7552,-6912,-1024],[-2308,-5632,-1024],[-2984,-5272,-1024],[-2308,-5632,-1024],[-2308,-5632,-1024],[-2480,-5568,0],[-2480,-5568,0],[-8200,-4776,0],[-8200,-4776,0],[-5600,-6480,0],[-5600,-6480,0],[-632,-5176,0],[-632,-5176,0],[-8448,-8384,0],[-8448,-8384,0],[512,-6528,0],[512,-6528,0],[-6848,-6144,0],[-6848,-6144,0],[5152,7488,0],[5152,7488,0],[-2308,-5632,0],[-2308,-5632,0]],[[15184,4424,-7344],[6912,4096,-7344],[6912,4096,-7344],[6904,8264,-7344],[6912,4096,-7344],[6912,4096,-7344],[12816,5600,0],[12816,5600,0],[2008,4696,0],[2008,4696,0],[8024,6312,0],[8024,6312,0],[11784,6152,0],[11784,6152,0],[9984,9472,0],[9984,9472,0],[13888,3480,0],[13888,3480,0],[6208,5440,0],[6208,5440,0],[-5408,-6000,0],[-5408,-6000,0],[6912,4096,0],[6912,4096,0]],[[7368,-5032,64],[13568,-6272,64],[13568,-3200,64],[12656,-2944,64],[13568,-3200,64],[13568,-3200,64],[13568,-3200,0],[13568,-3200,0],[7568,-3200,0],[7568,-3200,0],[13568,-3200,0],[13568,-3200,0],[13568,-3200,0],[13568,-3200,0],[13568,-3200,0],[13568,-3200,0],[13568,-3200,0],[13568,-3200,0],[13568,-3200,0],[13568,-3200,0],[-9536,7488,0],[-9536,7488,0],[13568,-3200,0],[13568,-2944,0]],[[-5364,4424,-5248],[-7552,4096,-5248],[-2308,4096,-5248],[-2984,8264,-5248],[-2308,4096,-5248],[-2308,4096,-5248],[-2480,5600,0],[-2480,5600,0],[-8200,4696,0],[-8200,4696,0],[-5600,6312,0],[-5600,6312,0],[-632,6152,0],[-632,6152,0],[-8448,9472,0],[-8448,9472,0],[512,3480,0],[512,3480,0],[-6848,5440,0],[-6848,5440,0],[5152,-6000,2728],[5152,-5408,2728],[-2308,4096,0],[-2984,8264,0]]];

const AXIS_TABLES: Record<string, Vec3[][]> = {"AxisPosTable":[[[0,0,0],[3776,2112,3064],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[-4228,-2728,3064],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[5986,1584,3064],[1040,-600,0],[4304,2536,3064]],[[0,0,0],[0,0,0],[-6480,-2040,3064],[0,0,0],[-4384,-2968,3064],[-832,224,0]],[[0,0,0],[0,0,0],[-2008,376,0],[4034,2696,3064],[0,0,0],[3092,3036,3064]],[[0,0,0],[0,0,0],[-4760,-2672,3064],[1728,-400,0],[-3472,-4648,3064],[0,0,0]]],"AxisPosTable3":[[[0,0,0],[2408,1248,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[-1544,-936,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[1944,336,0],[568,-560,0],[1944,928,0]],[[0,0,0],[0,0,0],[-2424,-816,0],[0,0,0],[-2424,-1024,0],[-872,8,0]],[[0,0,0],[0,0,0],[-1432,120,0],[1496,776,0],[0,0,0],[1496,1208,0]],[[0,0,0],[0,0,0],[-1920,-824,0],[672,8,0],[-1920,-1076,0],[0,0,0]]],"AxisPosTable095":[[[0,0,0],[1408,736,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[-1208,-784,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[2040,672,0],[928,-616,0],[1760,784,0]],[[0,0,0],[0,0,0],[-1816,-664,0],[0,0,0],[-1440,-928,0],[-680,8,0]],[[0,0,0],[0,0,0],[-1032,8,0],[1280,672,0],[0,0,0],[1080,1032,0]],[[0,0,0],[0,0,0],[-1648,-480,0],[792,8,0],[-960,-928,0],[0,0,0]]],"AxisPosTable161":[[[0,0,0],[2528,1588,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[-4264,-5056,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[3928,1112,0],[704,-672,0],[2784,1120,0]],[[0,0,0],[0,0,0],[-4152,-1560,0],[0,0,0],[-3096,-1976,0],[-692,-24,0]],[[0,0,0],[0,0,0],[-792,104,0],[2824,1616,0],[0,0,0],[2144,1936,0]],[[0,0,0],[0,0,0],[-2904,-1528,0],[1128,-408,0],[-1912,-2072,0],[0,0,0]]],"AxisPosTable308":[[[0,0,0],[1952,1096,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[-2016,-968,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[1920,768,0],[832,-448,0],[1728,832,0]],[[0,0,0],[0,0,0],[-2096,-744,0],[0,0,0],[-2096,-1240,0],[-752,24,0]],[[0,0,0],[0,0,0],[-1008,168,0],[1744,872,0],[0,0,0],[1496,1240,0]],[[0,0,0],[0,0,0],[-1980,-712,0],[632,-200,0],[-1680,-1656,0],[0,0,0]]],"AxisPosTable304":[[[0,0,0],[3200,1720,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[-3520,-1976,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[3560,968,0],[1600,-1472,0],[3264,1552,0]],[[0,0,0],[0,0,0],[-4000,-784,0],[0,0,0],[-3232,-2256,0],[-1248,560,0]],[[0,0,0],[0,0,0],[-1080,1240,0],[3144,1944,0],[0,0,0],[2120,2336,0]],[[0,0,0],[0,0,0],[-2992,-1440,0],[1888,-592,0],[-2592,-2704,0],[0,0,0]]],"AxisPosTable320":[[[0,0,0],[1600,-64,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[-1856,-1608,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[2000,-192,0],[672,-1328,0],[2000,192,0]],[[0,0,0],[0,0,0],[-2184,-1536,0],[0,0,0],[-2064,-1880,0],[-592,-792,0]],[[0,0,0],[0,0,0],[-1288,-128,0],[1528,-448,0],[0,0,0],[1528,296,0]],[[0,0,0],[0,0,0],[-1528,-1560,0],[856,-368,0],[-1384,-2032,0],[0,0,0]]],"AxisPosTable406":[[[0,0,0],[3584,2048,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[-3392,-1776,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[4992,2032,0],[1024,-688,0],[3776,1968,0]],[[0,0,0],[0,0,0],[-5544,-1592,0],[0,0,0],[-3752,-2232,0],[-1704,264,0]],[[0,0,0],[0,0,0],[-2008,-64,0],[4088,2352,0],[0,0,0],[2644,2416,0]],[[0,0,0],[0,0,0],[-3784,-1936,0],[1784,-16,0],[-3240,-2744,0],[0,0,0]]]};

const POSITION_MODE: Record<number, { mode: number; endpoint: HgParticleOperatorEndpoint }> = {
  1: { mode: POS_MODE_NORMAL, endpoint: "attacker" },
  2: { mode: POS_MODE_NORMAL, endpoint: "defender" },
  4: { mode: POS_MODE_NORMAL, endpoint: "attacker" },
  5: { mode: POS_MODE_NORMAL, endpoint: "defender" },
  6: { mode: POS_MODE_LASER, endpoint: "attacker" },
  7: { mode: POS_MODE_LASER, endpoint: "defender" },
  8: { mode: POS_MODE_RING, endpoint: "attacker" },
  9: { mode: POS_MODE_RING, endpoint: "defender" },
  10: { mode: POS_MODE_LASER_2, endpoint: "attacker" },
  11: { mode: POS_MODE_LASER_2, endpoint: "defender" },
  12: { mode: POS_MODE_NORMAL, endpoint: "attackerSide" },
  13: { mode: POS_MODE_NORMAL, endpoint: "defenderSide" },
  14: { mode: POS_MODE_LASER_3, endpoint: "attacker" },
  15: { mode: POS_MODE_LASER_3, endpoint: "defender" },
  16: { mode: POS_MODE_L095, endpoint: "attacker" },
  17: { mode: POS_MODE_L095, endpoint: "defender" },
  18: { mode: POS_MODE_L161, endpoint: "attacker" },
  19: { mode: POS_MODE_L161, endpoint: "defender" },
  20: { mode: POS_MODE_L308, endpoint: "attacker" },
  21: { mode: POS_MODE_L308, endpoint: "defender" },
  22: { mode: POS_MODE_L304, endpoint: "attacker" },
  23: { mode: POS_MODE_L304, endpoint: "defender" },
  24: { mode: POS_MODE_L320, endpoint: "attacker" },
  25: { mode: POS_MODE_L320, endpoint: "defender" },
  26: { mode: POS_MODE_L406, endpoint: "attacker" },
  27: { mode: POS_MODE_L406, endpoint: "defender" },
};

const AXIS_MODE_TABLE: Record<number, { table: keyof typeof AXIS_TABLES; halveZ: boolean; reverse: boolean }> = {
  1: { table: "AxisPosTable", halveZ: true, reverse: false },
  2: { table: "AxisPosTable", halveZ: true, reverse: false },
  4: { table: "AxisPosTable", halveZ: true, reverse: false },
  5: { table: "AxisPosTable", halveZ: true, reverse: false },
  8: { table: "AxisPosTable3", halveZ: true, reverse: false },
  9: { table: "AxisPosTable3", halveZ: true, reverse: false },
  10: { table: "AxisPosTable095", halveZ: true, reverse: false },
  11: { table: "AxisPosTable095", halveZ: true, reverse: false },
  12: { table: "AxisPosTable161", halveZ: false, reverse: false },
  13: { table: "AxisPosTable161", halveZ: false, reverse: false },
  14: { table: "AxisPosTable308", halveZ: false, reverse: false },
  15: { table: "AxisPosTable308", halveZ: false, reverse: false },
  16: { table: "AxisPosTable304", halveZ: false, reverse: false },
  17: { table: "AxisPosTable304", halveZ: false, reverse: false },
  18: { table: "AxisPosTable320", halveZ: false, reverse: false },
  19: { table: "AxisPosTable320", halveZ: false, reverse: false },
  20: { table: "AxisPosTable406", halveZ: false, reverse: false },
  21: { table: "AxisPosTable406", halveZ: false, reverse: false },
};

export function hgOperatorPosition(positionMode: number, targetMode: number, context: HgParticleOperatorContext): Vec3 | undefined {
  if (positionMode === 3) return undefined;
  if (positionMode === 28) return rawPositionToPreview([11488, 0, 0]);
  if (positionMode === 31) return rawPositionToPreview(POS_145_RAW[clientContext(targetMode, context).attacker]);
  if (positionMode === 33) return rawPositionToPreview([-5000, -6000, 0]);
  const descriptor = POSITION_MODE[positionMode];
  if (!descriptor) return undefined;
  const clients = clientContext(targetMode, context);
  const client = clientForEndpoint(descriptor.endpoint, clients);
  const cameraMode = context.cameraMode ?? 0;
  const tableIndex = descriptor.mode * 2 + cameraMode;
  return rawPositionToPreview(PARTICLE_POSITION_TABLE[client][tableIndex]);
}

export function hgOperatorEndpointPosition(endpoint: HgParticleOperatorEndpoint, targetMode: number, context: HgParticleOperatorContext): Vec3 {
  const clients = clientContext(targetMode, context);
  const client = clientForEndpoint(endpoint, clients);
  return rawPositionToPreview(PARTICLE_POSITION_TABLE[client][context.cameraMode ?? 0]);
}

export function hgOperatorAxis(axisMode: number, targetMode: number, context: HgParticleOperatorContext): Vec3 | undefined {
  if (axisMode === 0) return undefined;
  if (axisMode === 6 || axisMode === 7) return oldAxis(context, axisMode === 7);
  if (axisMode === 3) return rawAxisToPreview([-800, 1200, 500]);
  if (axisMode === 22) return rawAxisToPreview([-3410, -2644, 0]);
  if (axisMode === 24) return rawAxisToPreview(AXIS_145_RAW[clientContext(targetMode, context).attacker]);
  if (axisMode === 25) return rawAxisToPreview([-3440, 1952, 0]);
  const descriptor = AXIS_MODE_TABLE[axisMode];
  if (!descriptor) return undefined;
  const clients = clientContext(targetMode, context);
  const raw = AXIS_TABLES[descriptor.table][clients.attacker][clients.defender];
  const z = descriptor.halveZ ? raw[2] / 2 : raw[2];
  const axis = rawAxisToPreview([raw[0], raw[1], z]);
  return descriptor.reverse ? scaleVec(axis, -1) : axis;
}

export function convertHgParticleOffset(raw: Vec3): Vec3 {
  return [raw[0] * POSITION_SCALE[0], raw[1] * POSITION_SCALE[1], raw[2] * POSITION_SCALE[2]];
}

export function convertHgRawParticlePosition(raw: Vec3): Vec3 {
  return rawPositionToPreview(raw);
}

export function hgOperatorPositionName(positionMode: number): string {
  const descriptor = POSITION_MODE[positionMode];
  if (!descriptor) return positionMode === 3 ? "explicit-position" : `position mode ${positionMode}`;
  return `${descriptor.endpoint} ${positionModeName(descriptor.mode)}`;
}

function clientContext(targetMode: number, context: HgParticleOperatorContext): { attacker: ClientType; defender: ClientType; attackerSide: ClientType; defenderSide: ClientType } {
  const playerAttacks = context.attackerSide === "player";
  const attacker = playerAttacks ? CLIENT_A : CLIENT_B;
  const defender = playerAttacks ? CLIENT_B : CLIENT_A;
  const attackerSide = playerAttacks ? CLIENT_AA : CLIENT_BB;
  const defenderSide = playerAttacks ? CLIENT_BB : CLIENT_AA;
  if (targetMode === OPERATOR_TARGET_AT) return { attacker: defender, defender: attacker, attackerSide: defenderSide, defenderSide: attackerSide };
  if (targetMode === OPERATOR_TARGET_AT_SIDE) return { attacker: attackerSide, defender, attackerSide, defenderSide };
  if (targetMode === OPERATOR_TARGET_DF_SIDE) return { attacker, defender: defenderSide, attackerSide, defenderSide };
  if (targetMode === OPERATOR_TARGET_DF) return { attacker, defender, attackerSide, defenderSide };
  return { attacker, defender, attackerSide, defenderSide };
}

function clientForEndpoint(endpoint: HgParticleOperatorEndpoint, clients: { attacker: ClientType; defender: ClientType; attackerSide: ClientType; defenderSide: ClientType }): ClientType {
  return clients[endpoint];
}

function rawPositionToPreview(raw: Vec3): Vec3 {
  return [
    USER_BATTLE_ANCHOR[0] + (raw[0] - SOURCE_POSITION_RAW[0]) * POSITION_SCALE[0],
    USER_BATTLE_ANCHOR[1] + (raw[1] - SOURCE_POSITION_RAW[1]) * POSITION_SCALE[1],
    USER_BATTLE_ANCHOR[2] + (raw[2] - SOURCE_POSITION_RAW[2]) * POSITION_SCALE[2],
  ];
}

function rawAxisToPreview(raw: Vec3): Vec3 {
  return normalize([raw[0] * AXIS_SCALE[0], raw[1] * AXIS_SCALE[1], raw[2] * AXIS_SCALE[2]]);
}

function oldAxis(context: HgParticleOperatorContext, reverse: boolean): Vec3 {
  const base = normalize(sub(context.attackerSide === "player" ? TARGET_BATTLE_ANCHOR : USER_BATTLE_ANCHOR, context.attackerSide === "player" ? USER_BATTLE_ANCHOR : TARGET_BATTLE_ANCHOR));
  return reverse ? scaleVec(base, -1) : base;
}

function positionModeName(mode: number): string {
  switch (mode) {
    case POS_MODE_NORMAL: return "normal";
    case POS_MODE_LASER: return "laser";
    case POS_MODE_LASER_2: return "laser2";
    case POS_MODE_LASER_3: return "laser3";
    case POS_MODE_L095: return "laser095";
    case POS_MODE_L161: return "laser161";
    case POS_MODE_L308: return "laser308";
    case POS_MODE_L304: return "laser304";
    case POS_MODE_L320: return "laser320";
    case POS_MODE_L406: return "laser406";
    case POS_MODE_LOOK_AT: return "lookAt";
    case POS_MODE_RING: return "ring";
    default: return `mode${mode}`;
  }
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length < 0.00001 ? [0, 1, 0] : [v[0] / length, v[1] / length, v[2] / length];
}

function sub(a: BattlePreviewAnchor, b: BattlePreviewAnchor): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scaleVec(v: Vec3, scale: number): Vec3 {
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}
