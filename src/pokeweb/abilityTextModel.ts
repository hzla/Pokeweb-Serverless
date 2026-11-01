import { isGen5Project } from "./constants";
import type { ProjectState } from "./projectStore";
import { encodeGen5TextBank } from "./text";
import { getTextBank, parseTextEntryId, updateTextEntry } from "./textModel";

export function normalizeAbilityDescription(text: string): string {
  const value = text.replace(/\r\n?/gu, "\n").replace(/\n/gu, "\\n");
  // Validate controls before changing the project's decoded text or dirty state.
  encodeGen5TextBank([["0_0", value, 0]]);
  return value;
}
function descriptionEntry(project: ProjectState, id: number) {
  if (!isGen5Project(project) || !Number.isInteger(id) || id < 1 || id > 255) throw Error("Choose a Gen 5 ability ID between 1 and 255.");
  if (!project.narcs.message_texts) throw Error("Ability description text is unavailable. Load Message Texts with the ROM.");
  const bankId = project.session.baseRom === "BW" ? 183 : 375;
  const bank = getTextBank(project, "message_texts", bankId);
  const index = bank.findIndex(entry => { const key = parseTextEntryId(entry[0]); return key.block === 0 && key.entry === id; });
  if (index < 0) throw Error("This ability does not have a description text entry.");
  return { bankId, index, bank };
}
export function getAbilityDescription(project: ProjectState, id: number): string {
  const { bank, index } = descriptionEntry(project, id);
  return bank[index][1];
}
export function getAbilitySummaryName(project: ProjectState, id: number): string {
  const bank = getTextBank(project, "message_texts", project.session.baseRom === "BW" ? 182 : 374);
  return bank.find(entry => { const key = parseTextEntryId(entry[0]); return key.block === 0 && key.entry === id; })?.[1] ?? project.texts.banks.abilities?.[id] ?? "";
}
export function updateAbilityDescription(project: ProjectState, id: number, text: string): void {
  const { bankId, bank, index } = descriptionEntry(project, id);
  const value = normalizeAbilityDescription(text);
  // Preserve the bank's entry IDs, flags and other blocks, and preflight encoding.
  const entries = bank.map((entry, n) => n === index ? [entry[0], value, entry[2]] as typeof entry : entry);
  encodeGen5TextBank(entries);
  if (bank[index][1] !== value) updateTextEntry(project, "message_texts", bankId, index, value);
}
