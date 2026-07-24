const ARM9_MAIN_RAM_START = 0x02000000;
const ARM9_MAIN_RAM_END = 0x02400000;

const GEN5_PARTY_MON_SIZE = 0xdc;
const GEN5_PARTY_TAIL_OFFSET = 0x88;
const GEN5_PARTY_TAIL_SIZE = 0x54;
const MAX_PARTY_SIZE = 6;
const MAX_GEN5_SPECIES_ID = 649;
const MAX_REASONABLE_HP = 750;
const MAX_REASONABLE_NON_HP_STAT = 600;

// Gen 5 BattleMain/PokeCon offsets, ported from the VS Recorder DeSmuME
// pokemon_http_export implementation.
const BATTLE_MAIN_SETUP_PARAM_OFFSET = 0x00;
const BATTLE_MAIN_SERVER_OFFSET = 0x08;
const BATTLE_MAIN_CLIENT_POKECON_OFFSET = 0xc8;
const BATTLE_POKECON_SIZE = 0xe8;
const BATTLE_MAIN_SERVER_POKECON_OFFSET = BATTLE_MAIN_CLIENT_POKECON_OFFSET + BATTLE_POKECON_SIZE;
const BATTLE_SETUP_COMPETITOR_OFFSET = 0x00;
const BATTLE_SETUP_RULE_OFFSET = 0x04;
const BATTLE_SETUP_TRAINER_DATA_OFFSET = 0x48;
const BATTLE_SERVER_MAIN_MODULE_OFFSET = 0x0c;
const BATTLE_SERVER_POKECON_OFFSET = 0x10;
const BATTLE_SERVER_CLIENT_WORK_OFFSET = 0x14;
const BATTLE_SERVER_CLIENT_WORK_SIZE = 0x0c;
const BATTLE_SERVER_FLOW_WORK_OFFSET = 0x44;
const BATTLE_FLOW_SERVER_OFFSET = 0x00;
const BATTLE_FLOW_MAIN_MODULE_OFFSET = 0x04;
const BATTLE_POKECON_MAIN_MODULE_OFFSET = 0x00;
const BATTLE_POKECON_PARTY_OFFSET = 0x04;
const BATTLE_PARTY_SIZE = 0x1c;
const BATTLE_PARTY_MEMBER_COUNT_OFFSET = 0x18;
const BATTLE_POKECON_SOURCE_PARTY_OFFSET = 0x74;
const BATTLE_POKEPARAM_SOURCE_OFFSET = 0x00;
const BATTLE_POKEPARAM_SPECIES_OFFSET = 0x0c;
const BATTLE_POKEPARAM_MAX_HP_OFFSET = 0x0e;
const BATTLE_POKEPARAM_CURRENT_HP_OFFSET = 0x10;
const BATTLE_SOURCE_PARTY_FIRST_MON_OFFSET = 0x08;
const BATTLE_MAIN_NEARBY_SCAN_RADIUS = 0x40;
const BW_BATTLE_MAIN_OFFSET_FROM_CURRENT_BOX = 0x14;
const BW2_BATTLE_MAIN_OFFSET_FROM_BATTLE_WORK_ROOT = 0xf944;

export type TestBattleOpponentPokemonStats = {
  partySlot: number;
  speciesId: number;
  pid: number;
  currentHp: number;
  hp: number;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
};

export type TestBattleOpponentSnapshot = {
  battleMainAddress: number;
  trainerId: number;
  party: TestBattleOpponentPokemonStats[];
};

export type TestBattleOpponentReadOptions = {
  lastKnownBattleMainAddress?: number;
};

type BattleMainRoot = {
  currentBoxIndexAddress?: number;
  battleWorkRootAddress?: number;
};

type DecodedPartyTail = {
  currentHp: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  spAttack: number;
  spDefense: number;
};

class Arm9MainMemory {
  constructor(readonly bytes: Uint8Array) {}

  has(address: number, size = 1): boolean {
    const offset = address - ARM9_MAIN_RAM_START;
    return Number.isInteger(address) && Number.isInteger(size) && offset >= 0 && size >= 0 && offset + size <= this.bytes.length;
  }

  isAlignedPointer(address: number): boolean {
    return (address & 3) === 0 && address >= ARM9_MAIN_RAM_START && address < ARM9_MAIN_RAM_END && this.has(address, 4);
  }

  readU8(address: number): number {
    return this.has(address) ? (this.bytes[address - ARM9_MAIN_RAM_START] ?? 0) : 0;
  }

  readU16(address: number): number {
    if (!this.has(address, 2)) return 0;
    const offset = address - ARM9_MAIN_RAM_START;
    return (this.bytes[offset] ?? 0) | ((this.bytes[offset + 1] ?? 0) << 8);
  }

  readU32(address: number): number {
    if (!this.has(address, 4)) return 0;
    const offset = address - ARM9_MAIN_RAM_START;
    return (
      (this.bytes[offset] ?? 0) |
      ((this.bytes[offset + 1] ?? 0) << 8) |
      ((this.bytes[offset + 2] ?? 0) << 16) |
      ((this.bytes[offset + 3] ?? 0) << 24)
    ) >>> 0;
  }
}

export function isSupportedGen5BattleGameCode(gameCode: string): boolean {
  if (gameCode === "IRDO" || gameCode === "IREO") return true;
  return gameCode.length === 4 && gameCode.startsWith("IR") && (gameCode[2] === "A" || gameCode[2] === "B") && "DFIJKOS".includes(gameCode[3] ?? "");
}

export function readTestBattleOpponentSnapshot(
  mainMemoryBytes: Uint8Array,
  gameCode: string,
  options: TestBattleOpponentReadOptions = {},
): TestBattleOpponentSnapshot | undefined {
  if (!isSupportedGen5BattleGameCode(gameCode)) return undefined;
  const memory = new Arm9MainMemory(mainMemoryBytes);
  const candidates = battleMainCandidates(gameCode, options.lastKnownBattleMainAddress);
  for (const rootCandidate of candidates) {
    for (let delta = -BATTLE_MAIN_NEARBY_SCAN_RADIUS; delta <= BATTLE_MAIN_NEARBY_SCAN_RADIUS; delta += 4) {
      const battleMainAddress = rootCandidate + delta;
      const snapshot = readBattleMainOpponent(memory, battleMainAddress);
      if (snapshot) return snapshot;
    }
  }
  return undefined;
}

function battleMainCandidates(gameCode: string, lastKnownBattleMainAddress?: number): number[] {
  const candidates: number[] = [];
  addCandidate(candidates, lastKnownBattleMainAddress);
  for (const root of battleMainRoots(gameCode)) {
    if (root.battleWorkRootAddress !== undefined) {
      addCandidate(candidates, root.battleWorkRootAddress + BW2_BATTLE_MAIN_OFFSET_FROM_BATTLE_WORK_ROOT);
    }
    if (root.currentBoxIndexAddress !== undefined) {
      addCandidate(candidates, root.currentBoxIndexAddress - BW_BATTLE_MAIN_OFFSET_FROM_CURRENT_BOX);
    }
  }
  return candidates;
}

function addCandidate(candidates: number[], address: number | undefined): void {
  if (address === undefined || (address & 3) !== 0 || address < ARM9_MAIN_RAM_START || address >= ARM9_MAIN_RAM_END) return;
  if (!candidates.includes(address)) candidates.push(address);
}

function battleMainRoots(gameCode: string): BattleMainRoot[] {
  if (gameCode === "IREO" || gameCode === "IRDO") {
    const partyAddress = gameCode === "IREO" ? 0x022214ec : 0x0221e42c;
    const battleWorkRootAddress = gameCode === "IREO" ? 0x0224795c : 0x0224799c;
    const partyObjectAddress = partyAddress - 0x08;
    const boxBaseAddress = partyObjectAddress - 0x18a00;
    const currentBoxIndexAddress = boxBaseAddress - 0x3e0;
    const roots: BattleMainRoot[] = [{ currentBoxIndexAddress, battleWorkRootAddress }];
    // Volt White 2 Redux QoL shares IRDO but relocates the battle-work root.
    if (gameCode === "IRDO") roots.push({ battleWorkRootAddress: 0x0224ab1c });
    return roots;
  }

  const languageCode = gameCode[3] ?? "";
  const currentBoxRoots: Record<string, number> = {
    D: 0x022696c0,
    F: 0x02269700,
    I: 0x02269680,
    J: 0x022695e0,
    K: 0x02269e80,
    O: 0x02269780,
    S: 0x02269740,
  };
  const baseAddress = currentBoxRoots[languageCode];
  if (baseAddress === undefined) return [];
  const whiteDelta = gameCode[2] === "A" && languageCode !== "K" ? 0x20 : 0;
  return [{ currentBoxIndexAddress: baseAddress + whiteDelta }];
}

function readBattleMainOpponent(memory: Arm9MainMemory, battleMainAddress: number): TestBattleOpponentSnapshot | undefined {
  if (!memory.isAlignedPointer(battleMainAddress)) return undefined;
  const setupAddress = memory.readU32(battleMainAddress + BATTLE_MAIN_SETUP_PARAM_OFFSET);
  const serverAddress = memory.readU32(battleMainAddress + BATTLE_MAIN_SERVER_OFFSET);
  const clientPokeConAddress = battleMainAddress + BATTLE_MAIN_CLIENT_POKECON_OFFSET;
  const serverPokeConAddress = battleMainAddress + BATTLE_MAIN_SERVER_POKECON_OFFSET;
  if (!memory.isAlignedPointer(setupAddress) || !memory.isAlignedPointer(serverAddress)) return undefined;
  if (memory.readU32(clientPokeConAddress + BATTLE_POKECON_MAIN_MODULE_OFFSET) !== battleMainAddress) return undefined;
  if (memory.readU32(serverPokeConAddress + BATTLE_POKECON_MAIN_MODULE_OFFSET) !== battleMainAddress) return undefined;
  if (memory.readU32(serverAddress + BATTLE_SERVER_MAIN_MODULE_OFFSET) !== battleMainAddress) return undefined;
  if (memory.readU32(serverAddress + BATTLE_SERVER_POKECON_OFFSET) !== serverPokeConAddress) return undefined;

  const flowWorkAddress = memory.readU32(serverAddress + BATTLE_SERVER_FLOW_WORK_OFFSET);
  if (!memory.isAlignedPointer(flowWorkAddress)) return undefined;
  if (memory.readU32(flowWorkAddress + BATTLE_FLOW_SERVER_OFFSET) !== serverAddress) return undefined;
  if (memory.readU32(flowWorkAddress + BATTLE_FLOW_MAIN_MODULE_OFFSET) !== battleMainAddress) return undefined;

  const competitor = memory.readU32(setupAddress + BATTLE_SETUP_COMPETITOR_OFFSET);
  const rule = memory.readU32(setupAddress + BATTLE_SETUP_RULE_OFFSET);
  if ((competitor !== 1 && competitor !== 2) || rule > 3) return undefined;

  const playerClientWorkAddress = serverAddress + BATTLE_SERVER_CLIENT_WORK_OFFSET;
  const enemyClientWorkAddress = playerClientWorkAddress + BATTLE_SERVER_CLIENT_WORK_SIZE;
  const playerMemberCount = memory.readU8(playerClientWorkAddress + 0x08);
  const enemyMemberCount = memory.readU8(enemyClientWorkAddress + 0x08);
  const playerCoverCount = memory.readU8(playerClientWorkAddress + 0x09);
  const enemyCoverCount = memory.readU8(enemyClientWorkAddress + 0x09);
  if (
    !isPartyCount(playerMemberCount) ||
    !isPartyCount(enemyMemberCount) ||
    playerCoverCount < 1 ||
    playerCoverCount > 3 ||
    enemyCoverCount < 1 ||
    enemyCoverCount > 3 ||
    playerCoverCount > playerMemberCount ||
    enemyCoverCount > enemyMemberCount
  ) {
    return undefined;
  }

  const playerBattlePartyAddress = clientPokeConAddress + BATTLE_POKECON_PARTY_OFFSET;
  const enemyBattlePartyAddress = playerBattlePartyAddress + BATTLE_PARTY_SIZE;
  const firstPlayerPokeParam = memory.readU32(playerBattlePartyAddress);
  const firstEnemyPokeParam = memory.readU32(enemyBattlePartyAddress);
  if (!memory.isAlignedPointer(firstPlayerPokeParam) || !memory.isAlignedPointer(firstEnemyPokeParam)) return undefined;
  if (!isSpeciesId(memory.readU16(firstPlayerPokeParam + BATTLE_POKEPARAM_SPECIES_OFFSET))) return undefined;
  if (!isSpeciesId(memory.readU16(firstEnemyPokeParam + BATTLE_POKEPARAM_SPECIES_OFFSET))) return undefined;

  const trainerDataAddress = memory.readU32(setupAddress + BATTLE_SETUP_TRAINER_DATA_OFFSET + 4);
  const trainerId = memory.isAlignedPointer(trainerDataAddress) ? memory.readU16(trainerDataAddress) : 0;
  const sourcePartyAddress = memory.readU32(clientPokeConAddress + BATTLE_POKECON_SOURCE_PARTY_OFFSET + 4);
  const battlePartyCount = memory.readU8(enemyBattlePartyAddress + BATTLE_PARTY_MEMBER_COUNT_OFFSET);
  const memberCount = isPartyCount(battlePartyCount) ? battlePartyCount : enemyMemberCount;
  const party: TestBattleOpponentPokemonStats[] = [];
  const usedSlots = new Set<number>();

  for (let memberIndex = 0; memberIndex < memberCount; memberIndex += 1) {
    const pokeParamAddress = memory.readU32(enemyBattlePartyAddress + memberIndex * 4);
    if (!memory.isAlignedPointer(pokeParamAddress)) continue;
    const speciesId = memory.readU16(pokeParamAddress + BATTLE_POKEPARAM_SPECIES_OFFSET);
    const currentHp = memory.readU16(pokeParamAddress + BATTLE_POKEPARAM_CURRENT_HP_OFFSET);
    const maxHp = memory.readU16(pokeParamAddress + BATTLE_POKEPARAM_MAX_HP_OFFSET);
    if (!isSpeciesId(speciesId) || maxHp < 1 || currentHp > maxHp) continue;

    const sourceMonAddress = memory.readU32(pokeParamAddress + BATTLE_POKEPARAM_SOURCE_OFFSET);
    const sourceSlot = sourcePartySlot(memory, sourcePartyAddress, sourceMonAddress) ?? memberIndex;
    if (sourceSlot < 0 || sourceSlot >= MAX_PARTY_SIZE || usedSlots.has(sourceSlot)) continue;
    const decoded = readPartyStats(memory, sourceMonAddress);
    if (!decoded) continue;
    usedSlots.add(sourceSlot);
    party.push({
      partySlot: sourceSlot + 1,
      speciesId,
      pid: memory.readU32(sourceMonAddress),
      currentHp,
      hp: decoded.hp,
      attack: decoded.attack,
      defense: decoded.defense,
      spAttack: decoded.spAttack,
      spDefense: decoded.spDefense,
      speed: decoded.speed,
    });
  }

  party.sort((left, right) => left.partySlot - right.partySlot);
  return { battleMainAddress, trainerId, party };
}

function sourcePartySlot(memory: Arm9MainMemory, sourcePartyAddress: number, sourceMonAddress: number): number | undefined {
  if (!memory.isAlignedPointer(sourcePartyAddress) || !memory.isAlignedPointer(sourceMonAddress)) return undefined;
  const firstMonAddress = sourcePartyAddress + BATTLE_SOURCE_PARTY_FIRST_MON_OFFSET;
  if (sourceMonAddress < firstMonAddress) return undefined;
  const offset = sourceMonAddress - firstMonAddress;
  if (offset % GEN5_PARTY_MON_SIZE !== 0) return undefined;
  const slot = offset / GEN5_PARTY_MON_SIZE;
  return slot < MAX_PARTY_SIZE ? slot : undefined;
}

function readPartyStats(memory: Arm9MainMemory, sourceMonAddress: number): DecodedPartyTail | undefined {
  if (!memory.has(sourceMonAddress, GEN5_PARTY_MON_SIZE)) return undefined;
  const pid = memory.readU32(sourceMonAddress);
  if (pid === 0) return undefined;
  const rawWords: number[] = [];
  const decryptedWords: number[] = [];
  let seed = pid;
  for (let offset = 0; offset < GEN5_PARTY_TAIL_SIZE; offset += 2) {
    const rawWord = memory.readU16(sourceMonAddress + GEN5_PARTY_TAIL_OFFSET + offset);
    rawWords.push(rawWord);
    seed = advanceLcrng(seed);
    decryptedWords.push(rawWord ^ (seed >>> 16));
  }

  const words = isReasonablePartyTail(decryptedWords) ? decryptedWords : isReasonablePartyTail(rawWords) ? rawWords : undefined;
  if (!words) return undefined;
  return {
    currentHp: words[3] ?? 0,
    hp: words[4] ?? 0,
    attack: words[5] ?? 0,
    defense: words[6] ?? 0,
    speed: words[7] ?? 0,
    spAttack: words[8] ?? 0,
    spDefense: words[9] ?? 0,
  };
}

function advanceLcrng(seed: number): number {
  return (Math.imul(seed, 0x41c64e6d) + 0x6073) >>> 0;
}

function isReasonablePartyTail(words: number[]): boolean {
  if (words.length < 10) return false;
  const level = (words[2] ?? 0) & 0xff;
  const currentHp = words[3] ?? 0;
  const maxHp = words[4] ?? 0;
  if (level < 1 || level > 100 || currentHp > MAX_REASONABLE_HP || maxHp < 1 || maxHp > MAX_REASONABLE_HP || currentHp > maxHp) return false;
  for (let index = 5; index <= 9; index += 1) {
    if ((words[index] ?? 0) > MAX_REASONABLE_NON_HP_STAT) return false;
  }
  return true;
}

function isPartyCount(value: number): boolean {
  return value >= 1 && value <= MAX_PARTY_SIZE;
}

function isSpeciesId(value: number): boolean {
  return value >= 1 && value <= MAX_GEN5_SPECIES_ID;
}
