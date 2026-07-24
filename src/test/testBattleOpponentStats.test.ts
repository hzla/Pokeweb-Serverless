import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { isSupportedGen5BattleGameCode, readTestBattleOpponentSnapshot } from "../pokeweb/testBattleOpponentStats";

const MAIN_RAM_START = 0x02000000;
const BATTLE_MAIN = 0x022572e0;
const SETUP = 0x02260000;
const SERVER = 0x02261000;
const FLOW = 0x02262000;
const TRAINER_DATA = 0x02263000;
const PLAYER_PARAM = 0x02264000;
const ENEMY_PARAM_1 = 0x02265000;
const ENEMY_PARAM_2 = 0x02265100;
const ENEMY_SOURCE_PARTY = 0x02268000;
const PARTY_MON_SIZE = 0xdc;

describe("testBattleOpponentStats", () => {
  it("reads the live BW2 enemy trainer party and decrypts PID-seeded stat tails", () => {
    const memory = makeBattleMemory();
    writeEnemy(memory, ENEMY_PARAM_1, 0, 25, 0x12345678, [111, 95, 82, 120, 101, 88], true);
    writeEnemy(memory, ENEMY_PARAM_2, 2, 6, 0xfedcba98, [143, 117, 109, 80, 95, 73], true);

    const snapshot = readTestBattleOpponentSnapshot(memory, "IRDO");

    expect(snapshot).toEqual({
      battleMainAddress: BATTLE_MAIN,
      trainerId: 621,
      party: [
        {
          partySlot: 1,
          speciesId: 25,
          pid: 0x12345678,
          currentHp: 93,
          hp: 111,
          attack: 95,
          defense: 82,
          spAttack: 101,
          spDefense: 88,
          speed: 120,
        },
        {
          partySlot: 3,
          speciesId: 6,
          pid: 0xfedcba98,
          currentHp: 125,
          hp: 143,
          attack: 117,
          defense: 109,
          spAttack: 95,
          spDefense: 73,
          speed: 80,
        },
      ],
    });
  });

  it("accepts the transient plaintext party tail used while the game mutates a Pokemon", () => {
    const memory = makeBattleMemory(1);
    writeEnemy(memory, ENEMY_PARAM_1, 0, 1, 0x10203040, [120, 70, 80, 90, 100, 110], false);

    expect(readTestBattleOpponentSnapshot(memory, "IRDO")?.party[0]).toMatchObject({
      pid: 0x10203040,
      hp: 120,
      attack: 70,
      defense: 80,
      speed: 90,
      spAttack: 100,
      spDefense: 110,
    });
  });

  it("returns no snapshot outside a validated trainer battle", () => {
    const memory = makeBattleMemory();
    write32(memory, SETUP, 0);

    expect(readTestBattleOpponentSnapshot(memory, "IRDO")).toBeUndefined();
    expect(readTestBattleOpponentSnapshot(memory, "ABCD")).toBeUndefined();
    expect(isSupportedGen5BattleGameCode("IRAO")).toBe(true);
    expect(isSupportedGen5BattleGameCode("IRDO")).toBe(true);
  });
});

function makeBattleMemory(enemyCount = 2): Uint8Array {
  const memory = new Uint8Array(4 * 1024 * 1024);
  const clientPokeCon = BATTLE_MAIN + 0xc8;
  const serverPokeCon = BATTLE_MAIN + 0x1b0;
  const playerParty = clientPokeCon + 0x04;
  const enemyParty = playerParty + 0x1c;
  const playerClientWork = SERVER + 0x14;
  const enemyClientWork = playerClientWork + 0x0c;

  write32(memory, BATTLE_MAIN, SETUP);
  write32(memory, BATTLE_MAIN + 0x08, SERVER);
  write32(memory, clientPokeCon, BATTLE_MAIN);
  write32(memory, serverPokeCon, BATTLE_MAIN);
  write32(memory, SERVER + 0x0c, BATTLE_MAIN);
  write32(memory, SERVER + 0x10, serverPokeCon);
  write32(memory, SERVER + 0x44, FLOW);
  write32(memory, FLOW, SERVER);
  write32(memory, FLOW + 0x04, BATTLE_MAIN);
  write32(memory, SETUP, 1);
  write32(memory, SETUP + 0x04, 0);
  write32(memory, SETUP + 0x4c, TRAINER_DATA);
  write16(memory, TRAINER_DATA, 621);

  write8(memory, playerClientWork + 0x08, 1);
  write8(memory, playerClientWork + 0x09, 1);
  write8(memory, enemyClientWork + 0x08, enemyCount);
  write8(memory, enemyClientWork + 0x09, 1);
  write32(memory, playerParty, PLAYER_PARAM);
  write16(memory, PLAYER_PARAM + 0x0c, 1);
  write32(memory, enemyParty, ENEMY_PARAM_1);
  if (enemyCount > 1) write32(memory, enemyParty + 0x04, ENEMY_PARAM_2);
  write8(memory, enemyParty + 0x18, enemyCount);
  write32(memory, clientPokeCon + 0x78, ENEMY_SOURCE_PARTY);
  return memory;
}

function writeEnemy(memory: Uint8Array, pokeParam: number, partySlot: number, speciesId: number, pid: number, stats: [number, number, number, number, number, number], encrypted: boolean): void {
  const sourceMon = ENEMY_SOURCE_PARTY + 0x08 + partySlot * PARTY_MON_SIZE;
  const [hp, attack, defense, speed, spAttack, spDefense] = stats;
  write32(memory, pokeParam, sourceMon);
  write16(memory, pokeParam + 0x0c, speciesId);
  write16(memory, pokeParam + 0x0e, hp);
  write16(memory, pokeParam + 0x10, hp - 18);
  write32(memory, sourceMon, pid);

  const tail = new Uint16Array(0x54 / 2);
  tail[2] = 50;
  tail[3] = hp - 18;
  tail[4] = hp;
  tail[5] = attack;
  tail[6] = defense;
  tail[7] = speed;
  tail[8] = spAttack;
  tail[9] = spDefense;
  let seed = pid;
  for (let index = 0; index < tail.length; index += 1) {
    seed = advanceLcrng(seed);
    write16(memory, sourceMon + 0x88 + index * 2, encrypted ? tail[index]! ^ (seed >>> 16) : tail[index]!);
  }
}

function advanceLcrng(seed: number): number {
  return (Math.imul(seed, 0x41c64e6d) + 0x6073) >>> 0;
}

function write8(memory: Uint8Array, address: number, value: number): void {
  memory[address - MAIN_RAM_START] = value & 0xff;
}

function write16(memory: Uint8Array, address: number, value: number): void {
  writeU16(memory, address - MAIN_RAM_START, value);
}

function write32(memory: Uint8Array, address: number, value: number): void {
  writeU32(memory, address - MAIN_RAM_START, value);
}
