import { NintendoDSRom } from "../nds/rom";
import { decompressCode } from "../nds/codeCompression";
import type { ProjectState } from "./projectStore";

type PwanCompatibilityModule = "arm9" | "overlay";

export type PwanCompatibilityStatus = "matched" | "changed" | "missing" | "unsupported";

export type PwanCompatibilitySignature = {
  id: string;
  label: string;
  group: string;
  module: PwanCompatibilityModule;
  overlayId?: number;
  address: number;
  windowStart: number;
  expectedHex: string;
};

export type PwanCompatibilityCheck = PwanCompatibilitySignature & {
  status: PwanCompatibilityStatus;
  actualHex?: string;
  message: string;
};

export type PwanCompatibilityReport = {
  compatible: boolean;
  supportedBase: boolean;
  passed: number;
  failed: number;
  missing: number;
  checks: PwanCompatibilityCheck[];
};

const DEFAULT_W2_ARM9_BASE_ADDRESS = 0x02004000;

export const PWAN_W2_COMPATIBILITY_SIGNATURES: PwanCompatibilitySignature[] = [
  { id: "summary-update-hook", label: "Summary update hook", group: "Summary", module: "overlay", overlayId: 207, address: 0x021b337e, windowStart: 0x021b337a, expectedHex: "6ef675fb98f61ffaa06f66f6c6fb96f69cfb96f6c6fba06f" },
  { id: "summary-draw-hook", label: "Summary draw hook", group: "Summary", module: "overlay", overlayId: 207, address: 0x021b3396, windowStart: 0x021b3392, expectedHex: "66f651fc96f699fb3148251c0168226ae07e8a1a1206120e" },
  { id: "summary-term-hook", label: "Summary teardown hook", group: "Summary", module: "overlay", overlayId: 207, address: 0x021b31aa, windowStart: 0x021b31a6, expectedHex: "c173281c00f0a5fe281c00f00eff281c00f071fd291c9431" },
  { id: "battle-update-hook", label: "Battle update hook", group: "Battle", module: "overlay", overlayId: 168, address: 0x021df2c0, windowStart: 0x021df2bc, expectedHex: "183008580af010fb6af6fefb6af628fc201c29680c300858" },
  { id: "battle-draw-hook", label: "Battle draw hook", group: "Battle", module: "overlay", overlayId: 168, address: 0x021df2f8, windowStart: 0x021df2f4, expectedHex: "45fb20886af6e8fb38bdc04680421f020406000478b581b0" },
  { id: "battle-term-hook", label: "Battle teardown hook", group: "Battle", module: "overlay", overlayId: 168, address: 0x021df248, windowStart: 0x021df244, expectedHex: "19f828685bf616f82e6070bd80421f0238b52a4d28680028" },
  { id: "battle-summary-cache-hook", label: "Battle summary cache hook", group: "Battle", module: "overlay", overlayId: 167, address: 0x021b2416, windowStart: 0x021b2412, expectedHex: "281c211cfff71fff38bd017042707047000038b5041c2068" },
  { id: "nonbattle-build-params-hook", label: "Nonbattle MCSS build params hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 298, address: 0x021a8efa, windowStart: 0x021a8ef6, expectedHex: "201c3a1c73f6b9f803a80090281c00210022002371f6e3fc" },
  { id: "nonbattle-add-hook", label: "Nonbattle MCSS add hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 298, address: 0x021a8f0a, windowStart: 0x021a8f06, expectedHex: "0022002371f6e3fc041c012171f6f1ff201c71f6f8fe201c" },
  { id: "nonbattle-draw-hook", label: "Nonbattle MCSS draw hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 298, address: 0x021a8664, windowStart: 0x021a8660, expectedHex: "002801d071f6e8fa08bd00000148024b08581847ac060000" },
  { id: "nonbattle-del-hook", label: "Nonbattle MCSS delete hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 298, address: 0x021a8f48, windowStart: 0x021a8f44, expectedHex: "281c211c71f6b0fd38bd000030b583b0041c71f661ffe4f6" },
  { id: "evolution-add-loop-hook", label: "Evolution MCSS add loop hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e5364, windowStart: 0x021e5360, expectedHex: "0022002336f608ff2065206d012135f6c3fd206d36f6a2ff" },
  { id: "evolution-add-single-hook", label: "Evolution MCSS add single hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e53ae, windowStart: 0x021e53aa, expectedHex: "6968002336f6e3fe6865012135f69ffd686d36f67eff686d" },
  { id: "evolution-main-mcss-hook", label: "Evolution MCSS main hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e51b0, windowStart: 0x021e51ac, expectedHex: "02d0e06c34f6b0fc201c00f0f3fa04b0f8bdc046ff7f0000" },
  { id: "evolution-main-independent-hook", label: "Evolution independent main hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e51b6, windowStart: 0x021e51b2, expectedHex: "b0fc201c00f0f3fa04b0f8bdc046ff7f000000f8ffff08b5" },
  { id: "evolution-draw-mcss-hook", label: "Evolution MCSS draw hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e51d2, windowStart: 0x021e51ce, expectedHex: "03d0c06c34f631fd08bd00f012fb08bd00000121c1617047" },
  { id: "evolution-draw-independent-hook", label: "Evolution independent draw hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e51d8, windowStart: 0x021e51d4, expectedHex: "31fd08bd00f012fb08bd00000121c16170470000006a7047" },
  { id: "evolution-del-hook", label: "Evolution delete hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e53f0, windowStart: 0x021e53ec, expectedHex: "e86c316d35f65cfb601c0006040e022cefd370bd002801d1" },
  { id: "evolution-after-graphic-end-hook", label: "Evolution graphic-end hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e3dae, windowStart: 0x021e3daa, expectedHex: "0efa606800f003ff002009b0f0bd1d0100001f010000f144" },
  { id: "egg-frame-tail-hook", label: "Egg hatch frame-tail hook", group: "Egg Hatch", module: "overlay", overlayId: 307, address: 0x021de040, windowStart: 0x021de03c, expectedHex: "1bff606800f07afc0020f8bd1801000080d91d0210b50c1c" },
  { id: "egg-add-poke-mcss-hook", label: "Egg hatch add Pokemon MCSS hook", group: "Egg Hatch", module: "overlay", overlayId: 307, address: 0x021def54, windowStart: 0x021def50, expectedHex: "696800243df610f9012168633bf6ccff6868ab2100223df6" },
  { id: "egg-draw-hook", label: "Egg hatch draw hook", group: "Egg Hatch", module: "overlay", overlayId: 307, address: 0x021dee7a, windowStart: 0x021dee76, expectedHex: "041c206b3af6ddfe201c00f078fa606c00f055fa10bd0121" },
  { id: "egg-after-obj-main-hook", label: "Egg hatch ObjMain hook", group: "Egg Hatch", module: "overlay", overlayId: 307, address: 0x021dee86, windowStart: 0x021dee82, expectedHex: "78fa606c00f055fa10bd01210161704700004069704738b5" },
  { id: "egg-del-hook", label: "Egg hatch delete hook", group: "Egg Hatch", module: "overlay", overlayId: 307, address: 0x021df10a, windowStart: 0x021df106, expectedHex: "206b616b3bf6cffc10bd406b014b1847c046a9ad010270b5" },
  { id: "nonbattle-pp-build-hook", label: "Nonbattle PP build hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 265, address: 0x0219a156, windowStart: 0x0219a152, expectedHex: "0858311c81f657ff00960b21a869084a0904002380f6b5fb" },
  { id: "nonbattle-pp-add-hook", label: "Nonbattle PP add hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 265, address: 0x0219a166, windowStart: 0x0219a162, expectedHex: "0904002380f6b5fbe861211c80f621fde86980f6cafd0db0" },
  { id: "nonbattle-pp-draw-hook", label: "Nonbattle PP draw hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 265, address: 0x02199efc, windowStart: 0x02199ef8, expectedHex: "0dfea0697ff69cfeaff6e4fd10bd000010b5041caff6dafd" },
  { id: "nonbattle-pp-del-hook", label: "Nonbattle PP delete hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 265, address: 0x0219a194, windowStart: 0x0219a190, expectedHex: "04d0a06980f68afc0020e06110bd000030b583b0041ce069" },
  { id: "arm9-mcss-draw", label: "ARM9 MCSS draw function", group: "ARM9 vanilla calls", module: "arm9", address: 0x02019c38, windowStart: 0x02019c38, expectedHex: "f0b5edb00b904df0c3ffd74a00201060111f08601190906003200860119846ac" },
  { id: "arm9-mcss-del", label: "ARM9 MCSS delete function", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201aaac, windowStart: 0x0201aaac, expectedHex: "38b50c1c051c201c00f0f8ff2068002803d001f029f8002020606068002803d0" },
  { id: "arm9-mcss-hide", label: "ARM9 MCSS vanish setter", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201ada8, windowStart: 0x0201ada8, expectedHex: "052292010221835889021943815070470522920183580249194081507047c046" },
  { id: "arm9-mcss-shadow-hide", label: "ARM9 MCSS shadow vanish setter", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201aef8, windowStart: 0x0201aef8, expectedHex: "18b405239b01c458034ac9072240090a1143c15018bc7047ffff7fff05218901" },
  { id: "arm9-add-poke-mcss", label: "ARM9 add Pokemon MCSS function", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201c178, windowStart: 0x0201c178, expectedHex: "f8b58ab00c1c051c161c201c002100221f1c00f0cbfd011c281c00f00ff8201c" },
  { id: "arm9-pp-get", label: "ARM9 Pokemon param getter", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201cd24, windowStart: 0x0201cd24, expectedHex: "70b5051c0c1c161c01f050f8281c211c321c01f09df8041c281c01f075f8201c" },
  { id: "arm9-buffer-swap", label: "ARM9 render buffer swap", group: "ARM9 vanilla calls", module: "arm9", address: 0x02049acc, windowStart: 0x02049acc, expectedHex: "08b51ef07bf80348012100689430016008bdc046641914020b490a68002a11d0" },
];

export const PWAN_B2_COMPATIBILITY_SIGNATURES: PwanCompatibilitySignature[] = [
  { id: "battle-update-hook", label: "Battle update hook", group: "Battle", module: "overlay", overlayId: 168, address: 0x021df280, windowStart: 0x021df27c, expectedHex: "183008580af010fb6af608fc6af632fc201c29680c300858" },
  { id: "battle-draw-hook", label: "Battle draw hook", group: "Battle", module: "overlay", overlayId: 168, address: 0x021df2b8, windowStart: 0x021df2b4, expectedHex: "4ffb20886af6f2fb38bdc04640421f020406000478b581b0" },
  { id: "battle-term-hook", label: "Battle teardown hook", group: "Battle", module: "overlay", overlayId: 168, address: 0x021df208, windowStart: 0x021df204, expectedHex: "23f828685bf620f82e6070bd40421f0238b52a4d28680028" },
  { id: "battle-form-begin-hook", label: "Form-change begin hook", group: "Battle", module: "overlay", overlayId: 167, address: 0x021d36c0, windowStart: 0x021d36bc, expectedHex: "03d161680bf0f8ff02e061680cf050f8e068401ce06038bd" },
  { id: "battle-form-swap-hook", label: "Form-change swap hook", group: "Battle", module: "overlay", overlayId: 168, address: 0x021e07e2, windowStart: 0x021e07de, expectedHex: "2168083207f0cbfb606806b0401c6060f8bd082000900122" },
  { id: "battle-form-end-hook", label: "Form-change end hook", group: "Battle", module: "overlay", overlayId: 168, address: 0x021e08d2, windowStart: 0x021e08ce, expectedHex: "002901d1fff76bfd06b0f8bdc04640421f020cfeffffaa05" },
  { id: "battle-form-refresh-hook", label: "Form refresh hook", group: "Battle", module: "overlay", overlayId: 168, address: 0x021df79c, windowStart: 0x021df798, expectedHex: "c0592a1c08f0eefb09b0f0bd40421f020149024b1847c046" },
  { id: "battle-sprite-index-call", label: "Battle sprite index function", group: "Battle vanilla calls", module: "overlay", overlayId: 168, address: 0x021e9795, windowStart: 0x021e9794, expectedHex: "30b400255c222b1c5343c418a368002b05d0236d994202d1" },
  { id: "battle-sprite-maw-call", label: "Battle sprite carrier function", group: "Battle vanilla calls", module: "overlay", overlayId: 168, address: 0x021e7f7d, windowStart: 0x021e7f7c, expectedHex: "f8b5051c161c01f007fc2f1c5c21041c4c430c373b190422" },
  { id: "battle-form-begin-call", label: "Form-change begin original call", group: "Battle vanilla calls", module: "overlay", overlayId: 168, address: 0x021df6b5, windowStart: 0x021df6b4, expectedHex: "f8b5071c2548264e00900d1c7e2031688000095a2348244b" },
  { id: "battle-form-end-call", label: "Form-change end original call", group: "Battle vanilla calls", module: "overlay", overlayId: 168, address: 0x021e03ad, windowStart: 0x021e03ac, expectedHex: "70b5051cfff7ecff041c002d1ed0281c5af688f9061c0e48" },
  { id: "battle-main-call", label: "Battle MCSS main function", group: "Battle vanilla calls", module: "overlay", overlayId: 168, address: 0x021e98a5, windowStart: 0x021e98a4, expectedHex: "004b184795b7040210b586b0941c0094d41c0194029308ac" },
  { id: "arm9-buffer-swap", label: "ARM9 render buffer swap", group: "ARM9 vanilla calls", module: "arm9", address: 0x02049aa1, windowStart: 0x02049aa0, expectedHex: "08b51ef07bf80348012100689430016008bdc04624191402" },
  { id: "arm9-battle-free", label: "ARM9 battle teardown", group: "ARM9 vanilla calls", module: "arm9", address: 0x0203a24d, windowStart: 0x0203a24c, expectedHex: "10b5041c00f0caf8201cfff7e9fd10bd08b5fff727fe0028" },
  { id: "summary-update-hook", label: "Summary update hook", group: "Summary", module: "overlay", overlayId: 207, address: 0x021b333e, windowStart: 0x021b333a, expectedHex: "6ef67ffb98f629faa06f66f6d0fb96f6a6fb96f6d0fba06f" },
  { id: "summary-draw-hook", label: "Summary draw hook", group: "Summary", module: "overlay", overlayId: 207, address: 0x021b3356, windowStart: 0x021b3352, expectedHex: "66f65bfc96f6a3fb3148251c0168226ae07e8a1a1206120e" },
  { id: "summary-term-hook", label: "Summary teardown hook", group: "Summary", module: "overlay", overlayId: 207, address: 0x021b316a, windowStart: 0x021b3166, expectedHex: "c173281c00f0a5fe281c00f00eff281c00f071fd291c9431" },
  { id: "summary-current-pp-call", label: "Summary current Pokemon function", group: "Summary vanilla calls", module: "overlay", overlayId: 207, address: 0x021b4d9d, windowStart: 0x021b4d9c, expectedHex: "10b5041ca168087b002804d0012806d002280bd012e00868" },
  { id: "arm9-summary-tick", label: "ARM9 summary cell tick", group: "ARM9 vanilla calls", module: "arm9", address: 0x0204b795, windowStart: 0x0204b794, expectedHex: "10b50b4c2068002810d0002000f038ff00f062ff00f072ff" },
  { id: "arm9-summary-pp-get", label: "ARM9 summary Pokemon param getter", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201cd89, windowStart: 0x0201cd88, expectedHex: "70b5051c0c1c161c01f01af8281c211c321c01f095f8041c" },
  { id: "arm9-mcss-hide", label: "ARM9 MCSS vanish setter", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201ad7d, windowStart: 0x0201ad7c, expectedHex: "052292010221835889021943815070470522920183580249" },
  { id: "arm9-mcss-show", label: "ARM9 MCSS vanish resetter", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201ad8d, windowStart: 0x0201ad8c, expectedHex: "0522920183580249194081507047c046fff7ffff18b40523" },
  { id: "arm9-mcss-shadow-hide", label: "ARM9 MCSS shadow vanish setter", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201aecd, windowStart: 0x0201aecc, expectedHex: "18b405239b01c458034ac9072240090a1143c15018bc7047" },
  { id: "nonbattle-build-params-hook", label: "Nonbattle MCSS build params hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 298, address: 0x021a8eba, windowStart: 0x021a8eb6, expectedHex: "201c3a1c73f6c3f803a80090281c00210022002371f6edfc" },
  { id: "nonbattle-add-hook", label: "Nonbattle MCSS add hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 298, address: 0x021a8eca, windowStart: 0x021a8ec6, expectedHex: "0022002371f6edfc041c012171f6fbff201c71f602ff201c" },
  { id: "nonbattle-draw-hook", label: "Nonbattle MCSS draw hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 298, address: 0x021a8624, windowStart: 0x021a8620, expectedHex: "002801d071f6f2fa08bd00000148024b08581847ac060000" },
  { id: "nonbattle-del-hook", label: "Nonbattle MCSS delete hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 298, address: 0x021a8f08, windowStart: 0x021a8f04, expectedHex: "281c211c71f6bafd38bd000030b583b0041c71f66bffe4f6" },
  { id: "evolution-add-loop-hook", label: "Evolution MCSS add loop hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e5324, windowStart: 0x021e5320, expectedHex: "0022002336f612ff2065206d012135f6cdfd206d36f6acff" },
  { id: "evolution-add-single-hook", label: "Evolution MCSS add single hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e536e, windowStart: 0x021e536a, expectedHex: "6968002336f6edfe6865012135f6a9fd686d36f688ff686d" },
  { id: "evolution-main-mcss-hook", label: "Evolution MCSS main hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e5170, windowStart: 0x021e516c, expectedHex: "02d0e06c34f6bafc201c00f0f3fa04b0f8bdc046ff7f0000" },
  { id: "evolution-main-independent-hook", label: "Evolution independent main hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e5176, windowStart: 0x021e5172, expectedHex: "bafc201c00f0f3fa04b0f8bdc046ff7f000000f8ffff08b5" },
  { id: "evolution-draw-mcss-hook", label: "Evolution MCSS draw hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e5192, windowStart: 0x021e518e, expectedHex: "03d0c06c34f63bfd08bd00f012fb08bd00000121c1617047" },
  { id: "evolution-draw-independent-hook", label: "Evolution independent draw hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e5198, windowStart: 0x021e5194, expectedHex: "3bfd08bd00f012fb08bd00000121c16170470000006a7047" },
  { id: "evolution-del-hook", label: "Evolution delete hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e53b0, windowStart: 0x021e53ac, expectedHex: "e86c316d35f666fb601c0006040e022cefd370bd002801d1" },
  { id: "evolution-after-graphic-end-hook", label: "Evolution graphic-end hook", group: "Evolution", module: "overlay", overlayId: 284, address: 0x021e3d6e, windowStart: 0x021e3d6a, expectedHex: "0efa606800f003ff002009b0f0bd1d0100001f010000b144" },
  { id: "egg-frame-tail-hook", label: "Egg hatch frame-tail hook", group: "Egg Hatch", module: "overlay", overlayId: 307, address: 0x021de000, windowStart: 0x021ddffc, expectedHex: "1bff606800f07afc0020f8bd1801000040d91d0210b50c1c" },
  { id: "egg-add-poke-mcss-hook", label: "Egg hatch add Pokemon MCSS hook", group: "Egg Hatch", module: "overlay", overlayId: 307, address: 0x021def14, windowStart: 0x021def10, expectedHex: "696800243df61af9012168633bf6d6ff6868ab2100223df6" },
  { id: "egg-draw-hook", label: "Egg hatch draw hook", group: "Egg Hatch", module: "overlay", overlayId: 307, address: 0x021dee3a, windowStart: 0x021dee36, expectedHex: "041c206b3af6e7fe201c00f078fa606c00f055fa10bd0121" },
  { id: "egg-after-obj-main-hook", label: "Egg hatch ObjMain hook", group: "Egg Hatch", module: "overlay", overlayId: 307, address: 0x021dee46, windowStart: 0x021dee42, expectedHex: "78fa606c00f055fa10bd01210161704700004069704738b5" },
  { id: "egg-del-hook", label: "Egg hatch delete hook", group: "Egg Hatch", module: "overlay", overlayId: 307, address: 0x021df0ca, windowStart: 0x021df0c6, expectedHex: "206b616b3bf6d9fc10bd406b014b1847c0467dad010270b5" },
  { id: "nonbattle-pp-build-hook", label: "Nonbattle PP build hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 265, address: 0x0219a116, windowStart: 0x0219a112, expectedHex: "0858311c81f661ff00960b21a869084a0904002380f6bffb" },
  { id: "nonbattle-pp-add-hook", label: "Nonbattle PP add hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 265, address: 0x0219a126, windowStart: 0x0219a122, expectedHex: "0904002380f6bffbe861211c80f62bfde86980f6d4fd0db0" },
  { id: "nonbattle-pp-draw-hook", label: "Nonbattle PP draw hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 265, address: 0x02199ebc, windowStart: 0x02199eb8, expectedHex: "17fea0697ff6a6feaff6eefd10bd000010b5041caff6e4fd" },
  { id: "nonbattle-pp-del-hook", label: "Nonbattle PP delete hook", group: "Nonbattle MCSS", module: "overlay", overlayId: 265, address: 0x0219a154, windowStart: 0x0219a150, expectedHex: "04d0a06980f694fc0020e06110bd000030b583b0041ce069" },
  { id: "evolution-independent-main-call", label: "Evolution independent main function", group: "Evolution vanilla calls", module: "overlay", overlayId: 284, address: 0x021e5761, windowStart: 0x021e5760, expectedHex: "f8b5876d011c0e883968009003290bd849187944c9880904" },
  { id: "evolution-independent-draw-call", label: "Evolution independent draw function", group: "Evolution vanilla calls", module: "overlay", overlayId: 284, address: 0x021e57c1, windowStart: 0x021e57c0, expectedHex: "f8b5a0b0061c18a8b46d63f6dbfb0fa863f6bcfc274b0caa" },
  { id: "evolution-graphic-end-call", label: "Evolution graphic-end function", group: "Evolution vanilla calls", module: "overlay", overlayId: 284, address: 0x021e4b79, windowStart: 0x021e4b78, expectedHex: "014b08301847c046c94d1e02014b001d1847c046354d1e02" },
  { id: "egg-obj-main-call", label: "Egg hatch ObjMain function", group: "Egg Hatch vanilla calls", module: "overlay", overlayId: 307, address: 0x021df2f5, windowStart: 0x021df2f4, expectedHex: "004b184755f9040201490122425070471448000038b5051c" },
  { id: "egg-frame-tail-call", label: "Egg hatch frame-tail function", group: "Egg Hatch vanilla calls", module: "overlay", overlayId: 307, address: 0x021de8f9, windowStart: 0x021de8f8, expectedHex: "014b08301847c046c9ea1d02014b001d1847c04635ea1d02" },
  { id: "arm9-party-pp-get", label: "ARM9 party Pokemon param getter", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201ccf9, windowStart: 0x0201ccf8, expectedHex: "70b5051c0c1c161c01f050f8281c211c321c01f09df8041c" },
  { id: "arm9-build-sprite-params", label: "ARM9 sprite-param builder", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201c045, windowStart: 0x0201c044, expectedHex: "f8b586b00d9c0390049105921f1c0c9d0e9e17f087fb2060" },
  { id: "arm9-build-sprite-params-pp", label: "ARM9 party sprite-param builder", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201bfdd, windowStart: 0x0201bfdc, expectedHex: "38b50d1c141c01f01ffb291c221c00f001f838bdf8b586b0" },
  { id: "arm9-add-poke-mcss", label: "ARM9 add Pokemon MCSS function", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201c14d, windowStart: 0x0201c14c, expectedHex: "f8b58ab00c1c051c161c201c002100221f1c00f0cbfd011c" },
  { id: "arm9-mcss-add", label: "ARM9 MCSS add function", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201a8a9, windowStart: 0x0201a8a8, expectedHex: "f8b584b0041c02922269002601910393002a00dcd3e06169" },
  { id: "arm9-mcss-main", label: "ARM9 MCSS main function", group: "ARM9 vanilla calls", module: "arm9", address: 0x02019ae9, windowStart: 0x02019ae8, expectedHex: "f0b585b0051c2869002600284edd5d208000009034380090" },
  { id: "arm9-mcss-draw", label: "ARM9 MCSS draw function", group: "ARM9 vanilla calls", module: "arm9", address: 0x02019c0d, windowStart: 0x02019c0c, expectedHex: "f0b5edb00b904df0c3ffd74a00201060111f086011909060" },
  { id: "arm9-mcss-del", label: "ARM9 MCSS delete function", group: "ARM9 vanilla calls", module: "arm9", address: 0x0201aa81, windowStart: 0x0201aa80, expectedHex: "38b50c1c051c201c00f0f8ff2068002803d001f029f80020" },
];

// Kept as the White 2 profile for callers that used the original public name.
export const PWAN_COMPATIBILITY_SIGNATURES = PWAN_W2_COMPATIBILITY_SIGNATURES;

export function detectPwanRuntimeCompatibility(project: ProjectState): PwanCompatibilityReport {
  const version = project.session.baseVersion;
  const supportedBase = version === "W2" || version === "B2";
  const rom = parseOriginalRom(project);
  const expectedIdCode = version === "B2" ? "IREO" : version === "W2" ? "IRDO" : undefined;
  if (!supportedBase || (rom && rom.idCode !== expectedIdCode)) {
    const check: PwanCompatibilityCheck = {
      id: "base-rom",
      label: "Base ROM",
      group: "ROM",
      module: "arm9",
      address: 0,
      windowStart: 0,
      expectedHex: "",
      status: "unsupported",
      message: supportedBase
        ? `PWAN runtime requires the stock US ${version === "B2" ? "Black 2 (IREO)" : "White 2 (IRDO)"} code layout.`
        : "PWAN runtime supports stock US Black 2 and White 2 code layouts only.",
    };
    return { compatible: false, supportedBase: false, passed: 0, failed: 1, missing: 0, checks: [check] };
  }

  const signatures = version === "B2" ? PWAN_B2_COMPATIBILITY_SIGNATURES : PWAN_W2_COMPATIBILITY_SIGNATURES;
  const overlayIds = [...new Set(signatures.map((signature) => signature.overlayId).filter((id): id is number => id !== undefined))];
  const originalOverlays = loadOriginalOverlays(rom, overlayIds);
  const arm9BaseAddress = rom?.arm9RamAddress ?? DEFAULT_W2_ARM9_BASE_ADDRESS;
  const arm9 = project.arm9.length > 0 ? project.arm9 : rom ? decompressCode(rom.arm9) : project.arm9;
  const baseLabel = version === "B2" ? "Black 2" : "White 2";
  const checks = signatures.map((signature) => checkSignature(project, signature, originalOverlays, arm9, arm9BaseAddress, baseLabel));
  const passed = checks.filter((check) => check.status === "matched").length;
  const missing = checks.filter((check) => check.status === "missing").length;
  const failed = checks.length - passed - missing;
  return {
    compatible: checks.every((check) => check.status === "matched"),
    supportedBase: true,
    passed,
    failed,
    missing,
    checks,
  };
}

export function pwanCompatibilityFailureSummary(report: PwanCompatibilityReport, max = 4): string {
  const failures = report.checks.filter((check) => check.status !== "matched");
  if (failures.length === 0) return "PWAN hook compatibility check passed.";
  const listed = failures.slice(0, max).map((check) => `${check.group}: ${check.label}`).join("; ");
  const remaining = failures.length > max ? `; ${failures.length - max} more` : "";
  return `PWAN runtime is not compatible with this ROM code layout (${listed}${remaining}).`;
}

function checkSignature(
  project: ProjectState,
  signature: PwanCompatibilitySignature,
  originalOverlays: Map<number, { data: Uint8Array; ramAddress: number }>,
  arm9: Uint8Array,
  arm9BaseAddress: number,
  baseLabel: string,
): PwanCompatibilityCheck {
  const source = signature.module === "arm9"
    ? { data: arm9, ramAddress: arm9BaseAddress, label: "ARM9" }
    : overlaySource(project, originalOverlays, signature.overlayId);
  if (!source) {
    return {
      ...signature,
      status: "missing",
      message: `${moduleLabel(signature)} could not be loaded for compatibility checking.`,
    };
  }
  const length = signature.expectedHex.length / 2;
  const offset = signature.windowStart - source.ramAddress;
  if (offset < 0 || offset + length > source.data.length) {
    return {
      ...signature,
      status: "missing",
      message: `${source.label} does not cover ${hexAddress(signature.windowStart)}.`,
    };
  }
  const actualHex = bytesToHex(source.data.subarray(offset, offset + length));
  if (actualHex !== signature.expectedHex) {
    return {
      ...signature,
      status: "changed",
      actualHex,
      message: `${source.label} bytes differ from stock ${baseLabel} at ${hexAddress(signature.windowStart)}.`,
    };
  }
  return {
    ...signature,
    status: "matched",
    actualHex,
    message: `${source.label} matches stock ${baseLabel} at ${hexAddress(signature.windowStart)}.`,
  };
}

function parseOriginalRom(project: ProjectState): NintendoDSRom | undefined {
  if (!project.originalRomBytes) return undefined;
  try {
    return new NintendoDSRom(project.originalRomBytes);
  } catch {
    return undefined;
  }
}

function loadOriginalOverlays(rom: NintendoDSRom | undefined, overlayIds: number[]): Map<number, { data: Uint8Array; ramAddress: number }> {
  if (!rom) return new Map();
  try {
    return rom.loadArm9Overlays(overlayIds);
  } catch {
    return new Map();
  }
}

function overlaySource(
  project: ProjectState,
  originalOverlays: Map<number, { data: Uint8Array; ramAddress: number }>,
  overlayId: number | undefined,
): { data: Uint8Array; ramAddress: number; label: string } | undefined {
  if (overlayId === undefined) return undefined;
  const original = originalOverlays.get(overlayId);
  const data = project.overlays[overlayId] ?? original?.data;
  if (!data || !original) return undefined;
  return { data, ramAddress: original.ramAddress, label: `Overlay ${overlayId}` };
}

function moduleLabel(signature: PwanCompatibilitySignature): string {
  return signature.module === "arm9" ? "ARM9" : `Overlay ${signature.overlayId}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function hexAddress(address: number): string {
  return `0x${address.toString(16).padStart(8, "0")}`;
}
