import { readU16, writeU16 } from "../nds/binary";

export const TRAINER_SHINY_OPTIONS = ["Default", "Always shiny", "Never shiny"] as const;
export const TRAINER_STATUS_OPTIONS = ["No status", "Paralysis", "Sleep", "Freeze", "Burn", "Poison", "Toxic"] as const;
export const TRAINER_HP_OPTIONS = ["Full", "Percent", "Exact HP"] as const;
export type TrainerMemberSettings = { shiny: number; status: number; sleepTurns: number; hpMode: number; hp: number };

export const DEFAULT_TRAINER_MEMBER_SETTINGS: Readonly<TrainerMemberSettings> = { shiny: 0, status: 0, sleepTurns: 0, hpMode: 0, hp: 0 };

export function readTrainerMemberSettings(bytes: Uint8Array, offset: number): TrainerMemberSettings {
  return { shiny: bytes[offset], status: bytes[offset + 1], sleepTurns: bytes[offset + 2], hpMode: bytes[offset + 3], hp: readU16(bytes, offset + 4) };
}

export function writeTrainerMemberSettings(bytes: Uint8Array, offset: number, settings: TrainerMemberSettings): void {
  bytes.set([settings.shiny, settings.status, settings.sleepTurns, settings.hpMode], offset);
  writeU16(bytes, offset + 4, settings.hp);
}

export function changeTrainerMemberSetting(previous: TrainerMemberSettings, field: keyof TrainerMemberSettings, value: number): TrainerMemberSettings {
  const settings = { ...previous, [field]: value };
  if (field === "hpMode" && settings.hpMode !== previous.hpMode) settings.hp = [0, 100, 1][settings.hpMode];
  if (field === "status" && settings.status !== 2) settings.sleepTurns = 0;
  return settings;
}

export function validTrainerMemberSettings(settings: TrainerMemberSettings): boolean {
  const inRange = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  return inRange(settings.shiny, 0, 2) && inRange(settings.status, 0, 6) && inRange(settings.hpMode, 0, 2)
    && inRange(settings.sleepTurns, 0, settings.status === 2 ? 3 : 0)
    && inRange(settings.hp, settings.hpMode ? 1 : 0, [0, 100, 65535][settings.hpMode]);
}
