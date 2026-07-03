import { listCodeInjectionDlls } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { cascadeWhiteAiAbilitiesForSpecies } from "./cascadeWhiteAiAbilities";
import { isGen4Project } from "./constants";

export const CASCADE_WHITE_AI_DLL_PATH = "patches/A2_AIChanges.dll";
export const CASCADE_WHITE_TRAINER_ABILITY_SLOT_MAX = 6;

export const CASCADE_WHITE_PERSONAL_NAMES: Readonly<Record<number, string>> = {
  652: "Sawsbuck-Summer",
  653: "Sawsbuck-Autumn",
  654: "Sawsbuck-Winter",
  655: "Shellos-East",
  656: "Gastrodon-East",
};

type CascadeDetectionCacheEntry = {
  signature: string;
  result: boolean;
};

const detectionCache = new WeakMap<ProjectState, CascadeDetectionCacheEntry>();

export function detectCascadeWhiteRom(project: ProjectState): boolean {
  if (project.session.baseRom !== "BW2") return false;
  const signature = cascadeDetectionSignature(project);
  const cached = detectionCache.get(project);
  if (cached?.signature === signature) return cached.result;
  const targetPath = normalizeDllPath(CASCADE_WHITE_AI_DLL_PATH);
  const result = listCodeInjectionDlls(project).some((module) => normalizeDllPath(module.path) === targetPath);
  detectionCache.set(project, { signature, result });
  return result;
}

export function cascadeWhitePersonalName(project: ProjectState, personalId: number): string | undefined {
  return detectCascadeWhiteRom(project) ? CASCADE_WHITE_PERSONAL_NAMES[personalId] : undefined;
}

export function trainerAbilitySlotMax(project: ProjectState): number {
  if (isGen4Project(project)) return 2;
  return detectCascadeWhiteRom(project) ? CASCADE_WHITE_TRAINER_ABILITY_SLOT_MAX : 3;
}

export function cascadeWhiteTrainerAbilityName(project: ProjectState, speciesId: number, abilitySlot: number): string | undefined {
  if (abilitySlot < 4 || abilitySlot > CASCADE_WHITE_TRAINER_ABILITY_SLOT_MAX || !detectCascadeWhiteRom(project)) return undefined;
  return cascadeWhiteAiAbilitiesForSpecies(speciesId)?.[abilitySlot - 4];
}

function cascadeDetectionSignature(project: ProjectState): string {
  const stateModules = (project.codeInjection?.modules ?? [])
    .map((module) => module.path)
    .sort((a, b) => a.localeCompare(b))
    .join("|");
  const stagedModules = Object.keys(project.fileSystem?.additions ?? {})
    .filter((path) => /\.dll$/iu.test(path))
    .sort((a, b) => a.localeCompare(b))
    .join("|");
  const romBytes = project.originalRomBytes;
  const romSignature = romBytes ? `${romBytes.length}:${project.romInfo.idCode}:${project.romInfo.size}` : "";
  return `${project.session.baseRom}:${project.session.baseVersion}:${stateModules}:${stagedModules}:${romSignature}`;
}

function normalizeDllPath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/^\/+/u, "").toLowerCase();
}
