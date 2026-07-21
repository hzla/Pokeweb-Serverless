import type { BaseVersion } from "./constants";
import type { ProjectState } from "./projectStore";

export type ActionChangelogEntryPart = {
  text: string;
  changed?: boolean;
  breakBefore?: boolean;
};

export type ActionChangelogEntry = {
  id: string;
  key: string;
  domain: string;
  subject?: string;
  label?: string;
  before?: string;
  after?: string;
  text: string;
  parts?: ActionChangelogEntryPart[];
  firstChangedAt: string;
  updatedAt: string;
  kind: "field" | "generic";
};

export type ActionChangelogState = {
  startedAt: string;
  romName: string;
  baseVersion: BaseVersion;
  entries: ActionChangelogEntry[];
};

type RecordOptions = {
  key?: string;
  parts?: ActionChangelogEntryPart[];
};

export function resetActionChangelog(project: ProjectState, startedAt = new Date().toISOString()): ActionChangelogState {
  project.actionChangelog = {
    startedAt,
    romName: project.session?.romName ?? "Unknown ROM",
    baseVersion: project.session?.baseVersion ?? "W2",
    entries: [],
  };
  return project.actionChangelog;
}

export function ensureActionChangelog(project: ProjectState): ActionChangelogState {
  const current = project.actionChangelog;
  if (current && current.romName === (project.session?.romName ?? "Unknown ROM") && current.baseVersion === (project.session?.baseVersion ?? "W2")) return current;
  return resetActionChangelog(project);
}

export function clearActionChangelog(project: ProjectState): void {
  resetActionChangelog(project);
}

export function recordFieldChange(
  project: ProjectState,
  domain: string,
  subject: string | undefined,
  label: string,
  before: unknown,
  after: unknown,
  options: RecordOptions = {},
): void {
  if (normalizeValue(before) === normalizeValue(after)) return;
  const beforeText = formatValue(before);
  const afterText = formatValue(after);
  const key = options.key ?? fieldKey(domain, subject, label);
  const text = `${subject ? `${subject} ` : ""}${label} changed from ${beforeText} to ${afterText}.`;
  upsertEntry(project, {
    key,
    domain,
    subject,
    label,
    before: beforeText,
    after: afterText,
    text,
    parts: options.parts,
    kind: "field",
  });
}

export function recordGenericChange(project: ProjectState, domain: string, text: string, subject?: string, options: RecordOptions = {}): void {
  const key = options.key ?? genericKey(domain, subject, text);
  upsertEntry(project, {
    key,
    domain,
    subject,
    text,
    parts: options.parts,
    kind: "generic",
  });
}

export function renderActionChangelogText(project: ProjectState): string {
  const state = ensureActionChangelog(project);
  const lines = [
    `Changelog: ${state.romName}`,
    `Game version: ${state.baseVersion}`,
    `Started: ${state.startedAt}`,
    `Total changes: ${state.entries.length}`,
    "",
  ];
  if (state.entries.length === 0) {
    lines.push("No changes recorded since this ROM was loaded.");
    return lines.join("\n");
  }

  for (const [domain, entries] of groupBy(state.entries, (entry) => entry.domain)) {
    lines.push(`${domainTitle(domain)} (${entries.length})`);
    for (const entry of entries) lines.push(`- ${entry.text}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function domainTitle(domain: string): string {
  const titles: Record<string, string> = {
    headers: "Headers",
    personal: "Pokemon Personal Data",
    learnsets: "Learnsets",
    evolutions: "Evolutions",
    egg_moves: "Egg Moves",
    pokemon_cries: "Pokemon Cries",
    moves: "Moves",
    items: "Items",
    tms: "TMs",
    tutor_moves: "Tutor Moves",
    type_chart: "Type Chart",
    move_effects_table: "Move Effect Handlers",
    trdata: "Trainer Data",
    trpok: "Trainer Pokemon",
    trainer_text: "Trainer Text",
    encounters: "Encounters",
    habitats: "Dex Habitats",
    marts: "Marts",
    mart_counts: "Mart Counts",
    grottos: "Hidden Grottoes",
    grotto_odds: "Hidden Grotto Odds",
    story_texts: "Story Text",
    message_texts: "Info Text",
    maps: "Maps",
    matrix: "Matrices",
    overworlds: "Overworld Files",
    maps3d: "3D Maps",
    move_animations: "Move Animations",
    battle_animations: "Battle Animations",
    move_spas: "Move Particle Files",
    pokemon_sprites: "Pokemon Sprites",
    trainer_sprites: "Trainer Sprites",
    pokemon_icons: "Pokemon Icons",
    starter_sprites: "Starter Sprites",
    regulations: "Battle Regulations",
    wbt_sets: "Black Tower / White Treehollow Sets",
    wbt_trainers: "Black Tower / White Treehollow Trainers",
    wbt_area_pools: "Black Tower / White Treehollow Area Pools",
    facilities: "Battle Facilities",
    patches: "Patches",
    file_system: "File System",
    code_injection: "Code Injection",
  };
  return titles[domain] ?? titleize(domain);
}

function upsertEntry(
  project: ProjectState,
  next: Pick<ActionChangelogEntry, "key" | "domain" | "subject" | "label" | "before" | "after" | "text" | "parts" | "kind">,
): void {
  const state = ensureActionChangelog(project);
  const now = new Date().toISOString();
  const existing = state.entries.find((entry) => entry.key === next.key);
  if (existing) {
    if (next.kind === "field" && existing.before !== undefined && normalizeValue(existing.before) === normalizeValue(next.after)) {
      state.entries = state.entries.filter((entry) => entry !== existing);
      return;
    }
    existing.domain = next.domain;
    existing.subject = next.subject;
    existing.label = next.label;
    existing.after = next.after;
    existing.text = next.kind === "field" && existing.before !== undefined && next.after !== undefined
      ? `${next.subject ? `${next.subject} ` : ""}${next.label} changed from ${existing.before} to ${next.after}.`
      : next.text;
    existing.parts = next.parts;
    existing.updatedAt = now;
    return;
  }
  state.entries.push({
    id: `${now}-${state.entries.length}`,
    ...next,
    firstChangedAt: now,
    updatedAt: now,
  });
}

function fieldKey(domain: string, subject: string | undefined, label: string): string {
  return `field:${domain}:${subject ?? ""}:${label}`;
}

function genericKey(domain: string, subject: string | undefined, text: string): string {
  return `generic:${domain}:${subject ?? ""}:${text}`;
}

function normalizeValue(value: unknown): string {
  return String(value ?? "").trim();
}

function formatValue(value: unknown): string {
  const text = normalizeValue(value);
  return text.length > 0 ? text : "None";
}

function groupBy<T>(items: T[], keyFor: (item: T) => string): Array<[string, T[]]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped.entries()];
}

function titleize(value: string): string {
  return value
    .replace(/_/gu, " ")
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
