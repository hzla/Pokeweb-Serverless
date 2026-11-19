import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";

export const TRAINER_NICKNAMES_PATH = "battle/trainer-nicknames.bin";
export const TRAINER_NICKNAME_MAX_LENGTH = 10;
const HEADER = 16;
const ENTRY = 4 + (TRAINER_NICKNAME_MAX_LENGTH + 1) * 2;
const MAGIC = 0x4e545750; // PWTN
const TERMINATOR = 0xffff;

export function validateTrainerNickname(nickname: string): void {
  if (nickname.length > TRAINER_NICKNAME_MAX_LENGTH) throw new Error("Use at most 10 characters for the nickname.");
  if (/[\u0000-\u001f\u007f-\u009f\ud800-\udfff\ufff0-\uffff]/u.test(nickname) || /[\u{10000}-\u{10ffff}]/u.test(nickname))
    throw new Error("Use characters supported by the DS text field.");
}

export function decodeTrainerNicknames(bytes?: Uint8Array): Map<number, string> {
  const result = new Map<number, string>();
  if (!bytes) return result;
  const fail = () => new Error("Invalid trainer nickname data.");
  if (bytes.length < HEADER || readU32(bytes, 0) !== MAGIC || readU16(bytes, 4) !== 1
    || readU16(bytes, 6) !== ENTRY || readU32(bytes, 12)) throw fail();
  const count = readU32(bytes, 8);
  if (count > 0x100000 || bytes.length !== HEADER + count * ENTRY) throw fail();
  let previous = -1;
  for (let at = HEADER; at < bytes.length; at += ENTRY) {
    const key = readU32(bytes, at);
    if (key > 0xffffff || key <= previous) throw fail();
    previous = key;
    let name = "";
    for (let i = 0; i <= TRAINER_NICKNAME_MAX_LENGTH; ++i) {
      const unit = readU16(bytes, at + 4 + i * 2);
      if (unit === TERMINATOR) break;
      name += String.fromCharCode(unit);
    }
    if (!name.length) throw fail();
    validateTrainerNickname(name);
    result.set(key, name);
  }
  return result;
}

export function encodeTrainerNicknames(nicknames: ReadonlyMap<number, string>): Uint8Array {
  const bytes = new Uint8Array(HEADER + nicknames.size * ENTRY);
  writeU32(bytes, 0, MAGIC);
  writeU16(bytes, 4, 1);
  writeU16(bytes, 6, ENTRY);
  writeU32(bytes, 8, nicknames.size);
  let at = HEADER;
  for (const [key, nickname] of [...nicknames].sort(([a], [b]) => a - b)) {
    validateTrainerNickname(nickname);
    writeU32(bytes, at, key);
    for (let i = 0; i < nickname.length; ++i) writeU16(bytes, at + 4 + i * 2, nickname.charCodeAt(i));
    writeU16(bytes, at + 4 + nickname.length * 2, TERMINATOR);
    at += ENTRY;
  }
  return bytes;
}
