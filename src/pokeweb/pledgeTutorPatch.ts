import { readU16, writeU16 } from "../nds/binary";

export const PLEDGE_TUTOR_PICKER_OVERLAY_ID = 165;
export const STOCK_PLEDGE_MOVES = [520, 519, 518] as const;
export type PledgeTutorMoves = readonly [grass: number, fire: number, water: number];

// These Thumb offsets are shared by the US B2 and W2 versions. Keep both
// routines the same size so other overlay code and branch targets stay in place.
const FIELD_FIRE = 0x2fbf8;
const FIELD_WATER = 0x2fbfc;
const FIELD_GRASS = FIELD_WATER + 2;
const PICKER_MOVES = 0x40e8;

type CodeEdit = { offset: number; stock: readonly number[]; patched: readonly number[] };

// PokeParty_GetTutorMoveID: pack Grass and Water into Water's literal word
// and use ADR/LDRH for each. Slide the Blast Burn fallback into the padding.
const FIELD_CODE: readonly CodeEdit[] = [
  { offset: 0x2fb7e, stock: [0xd01a, 0xe031], patched: [0xd01a, 0xe032] },
  { offset: 0x2fbaa, stock: [0xd01c], patched: [0xd01d] },
  { offset: 0x2fbbe, stock: [0xd002, 0x2082, 0x0080, 0xbd10], patched: [0xd002, 0xa00e, 0x8840, 0xbd10] },
  { offset: 0x2fbe0, stock: [0xd001, 0x4806, 0xbd10, 0x4802, 0xbd10, 0x46c0],
    patched: [0xd002, 0xa006, 0x8800, 0xbd10, 0x4801, 0xbd10] },
];

// PokeList_CheckLearnMove: load three independent halfwords into the same
// comparison slots that stock code fills with 652 minus 132, 133 and 134.
const PICKER_PREFIX: CodeEdit = {
  offset: 0x40d4,
  stock: [0x1e49, 0x4288, 0xd10a, 0x9801, 0x9003, 0x3884, 0x9003, 0x9801, 0x9002, 0x3885],
  patched: [0x1e49, 0x4288, 0xd10a, 0xa103, 0x8808, 0x9003, 0x8848, 0x9002, 0x8888, 0xe004],
};
const PICKER_TAIL: CodeEdit = {
  offset: PICKER_MOVES,
  stock: [0x9002, 0x9801, 0x3886, 0xe000],
  patched: [...STOCK_PLEDGE_MOVES, 0x46c0],
};

export function readPledgeTutorMoves(field: Uint8Array | undefined, picker: Uint8Array | undefined): PledgeTutorMoves | undefined {
  if (!field || field.length < FIELD_WATER + 4 || !picker || picker.length < PICKER_MOVES + 14) return undefined;
  if (!matchesWords(field, 0x2fbd2, [0x4809, 0xbd10]) || !matchesWords(picker, 0x40f0, [0x9002, 0x9001, 0x2500])) return undefined;

  const stockField = FIELD_CODE.every(({ offset, stock }) => matchesWords(field, offset, stock));
  if (!stockField && !FIELD_CODE.every(({ offset, patched }) => matchesWords(field, offset, patched))) return undefined;
  const moves: PledgeTutorMoves = [stockField ? STOCK_PLEDGE_MOVES[0] : readU16(field, FIELD_GRASS), readU16(field, FIELD_FIRE), readU16(field, FIELD_WATER)];
  if (readU16(field, FIELD_FIRE + 2) !== 0 || (stockField && readU16(field, FIELD_GRASS) !== 0)) return undefined;

  const stockPicker = matchesWords(picker, PICKER_PREFIX.offset, PICKER_PREFIX.stock) && matchesWords(picker, PICKER_TAIL.offset, PICKER_TAIL.stock);
  if (stockPicker) return sameMoves(moves, STOCK_PLEDGE_MOVES) ? moves : undefined;
  if (!matchesWords(picker, PICKER_PREFIX.offset, PICKER_PREFIX.patched) || readU16(picker, PICKER_MOVES + 6) !== 0x46c0) return undefined;
  return moves.every((id) => id > 0) && matchesWords(picker, PICKER_MOVES, moves) ? moves : undefined;
}

export function patchPledgeTutorMoves(field: Uint8Array, picker: Uint8Array, moves: PledgeTutorMoves): { field: Uint8Array; picker: Uint8Array } {
  if (!readPledgeTutorMoves(field, picker)) throw new Error("The Pledge tutor code in overlays 36 and 165 is unsupported or out of sync.");
  if (moves.some((id) => !Number.isInteger(id) || id < 1 || id > 0xffff)) throw new Error("Invalid Pledge tutor move ID.");

  const stock = sameMoves(moves, STOCK_PLEDGE_MOVES);
  const nextField = field.slice();
  const nextPicker = picker.slice();
  FIELD_CODE.forEach((edit) => writeCode(nextField, edit, stock));
  writeU16(nextField, FIELD_GRASS, stock ? 0 : moves[0]);
  writeU16(nextField, FIELD_FIRE, moves[1]);
  writeU16(nextField, FIELD_WATER, moves[2]);
  writeCode(nextPicker, PICKER_PREFIX, stock);
  writeCode(nextPicker, PICKER_TAIL, stock);
  if (!stock) moves.forEach((id, index) => writeU16(nextPicker, PICKER_MOVES + index * 2, id));
  return { field: nextField, picker: nextPicker };
}

function matchesWords(bytes: Uint8Array, offset: number, words: readonly number[]): boolean {
  return words.every((word, index) => readU16(bytes, offset + index * 2) === word);
}

function writeCode(bytes: Uint8Array, edit: CodeEdit, stock: boolean): void {
  const words = stock ? edit.stock : edit.patched;
  words.forEach((word, index) => writeU16(bytes, edit.offset + index * 2, word));
}

function sameMoves(left: PledgeTutorMoves, right: PledgeTutorMoves): boolean {
  return left.every((move, index) => move === right[index]);
}
