import { usesWhite2UpgradePokemonData } from "./pokemonModel";
import { decodeRecord, type ProjectState, type RawRecord } from "./projectStore";

export type W2uSyncDomain = "personal" | "learnsets" | "evolutions" | "moves" | "trainers";

type W2uSyncRecord = {
  id: number;
  raw: RawRecord;
};

type W2uTrainerSyncRecord = {
  id: number;
  trdata: RawRecord;
  trpok: RawRecord;
};

type W2uSyncPayload = {
  repoPath?: string;
  records: Partial<Record<Exclude<W2uSyncDomain, "trainers">, W2uSyncRecord[]> & { trainers: W2uTrainerSyncRecord[] }>;
};

type W2uSyncResponse = {
  ok: boolean;
  message?: string;
  dryRun?: boolean;
  repoPath?: string;
  fileCount?: number;
  summary?: string;
  files?: Array<{ domain: W2uSyncDomain; id: number; path: string; bytes: number }>;
};

export const W2U_REPO_PATH_STORAGE_KEY = "pokeweb.w2u.repoPath";

export function canOfferW2uLocalSync(project: ProjectState): boolean {
  return isLocalSyncHost() && project.session.baseRom === "BW2" && (usesWhite2UpgradePokemonData(project) || hasLikelyW2uEditableData(project));
}

export async function getW2uSyncStatus(repoPath?: string): Promise<W2uSyncResponse> {
  const query = repoPath?.trim() ? `?repoPath=${encodeURIComponent(repoPath.trim())}` : "";
  const response = await fetch(`/__pokeweb_w2u/status${query}`);
  const body = (await response.json()) as W2uSyncResponse;
  if (!response.ok) throw new Error(body.message ?? `W2U status request failed with HTTP ${response.status}.`);
  return body;
}

export async function pickW2uRepoFolder(repoPath?: string): Promise<W2uSyncResponse & { cancelled?: boolean }> {
  const response = await fetch("/__pokeweb_w2u/pick-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(repoPath?.trim() ? { repoPath: repoPath.trim() } : {}),
  });
  const body = (await response.json()) as W2uSyncResponse & { cancelled?: boolean };
  if (!response.ok) throw new Error(body.message ?? `W2U folder picker request failed with HTTP ${response.status}.`);
  return body;
}

export function readStoredW2uRepoPath(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(W2U_REPO_PATH_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberW2uRepoPath(repoPath: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const trimmed = repoPath.trim();
    if (trimmed) localStorage.setItem(W2U_REPO_PATH_STORAGE_KEY, trimmed);
    else localStorage.removeItem(W2U_REPO_PATH_STORAGE_KEY);
  } catch {
    // Browser storage may be unavailable in private or constrained contexts.
  }
}

export async function syncW2uDomains(project: ProjectState, domains: readonly W2uSyncDomain[], options: { repoPath?: string } = {}): Promise<W2uSyncResponse | undefined> {
  if (!isLocalSyncHost()) throw new Error("W2U TOML sync is only available from localhost.");
  const payload = buildW2uSyncPayload(project, domains, options.repoPath);
  if (countPayloadRecords(payload) === 0) {
    window.alert("No dirty W2U TOML changes for this page.");
    return undefined;
  }

  const dryRun = await postW2uSync("/__pokeweb_w2u/sync?dryRun=1", payload);
  if (!dryRun.ok) throw new Error(dryRun.message ?? "W2U dry run failed.");
  if ((dryRun.fileCount ?? 0) === 0) {
    window.alert(dryRun.summary ?? "No W2U TOML files to sync.");
    return undefined;
  }

  if (!window.confirm(formatConfirmMessage(dryRun))) return undefined;

  const result = await postW2uSync("/__pokeweb_w2u/sync", payload);
  if (!result.ok) throw new Error(result.message ?? "W2U sync failed.");
  window.alert(`Synced ${result.summary ?? `${result.fileCount ?? 0} W2U TOML files`}.\n\n${result.repoPath ?? ""}`.trim());
  if (result.repoPath) rememberW2uRepoPath(result.repoPath);
  return result;
}

function buildW2uSyncPayload(project: ProjectState, domains: readonly W2uSyncDomain[], repoPath?: string): W2uSyncPayload {
  const records: W2uSyncPayload["records"] = {};
  if (domains.includes("personal")) records.personal = dirtyRecords(project, "personal");
  if (domains.includes("learnsets")) records.learnsets = dirtyRecords(project, "learnsets");
  if (domains.includes("evolutions")) records.evolutions = dirtyRecords(project, "evolutions");
  if (domains.includes("moves")) records.moves = dirtyRecords(project, "moves");
  if (domains.includes("trainers")) records.trainers = dirtyTrainerRecords(project);
  const trimmedRepoPath = repoPath?.trim();
  return trimmedRepoPath ? { repoPath: trimmedRepoPath, records } : { records };
}

function dirtyRecords(project: ProjectState, name: "personal" | "learnsets" | "evolutions" | "moves"): W2uSyncRecord[] {
  const store = project.narcs[name];
  if (!store) return [];
  return [...store.dirty]
    .sort((a, b) => a - b)
    .map((id) => {
      const record = decodeRecord(project, name, id);
      if (!record.raw) throw new Error(`Unable to decode ${name} record ${id}.`);
      return { id, raw: cloneRawRecord(record.raw) };
    });
}

function dirtyTrainerRecords(project: ProjectState): W2uTrainerSyncRecord[] {
  const ids = new Set<number>();
  for (const id of project.narcs.trdata?.dirty ?? []) ids.add(id);
  for (const id of project.narcs.trpok?.dirty ?? []) ids.add(id);
  return [...ids].sort((a, b) => a - b).map((id) => {
    const trdata = decodeRecord(project, "trdata", id);
    const trpok = decodeRecord(project, "trpok", id);
    if (!trdata.raw || !trpok.raw) throw new Error(`Unable to decode trainer ${id}.`);
    return { id, trdata: cloneRawRecord(trdata.raw), trpok: cloneRawRecord(trpok.raw) };
  });
}

function cloneRawRecord(raw: RawRecord): RawRecord {
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Number(value)]));
}

function countPayloadRecords(payload: W2uSyncPayload): number {
  return Object.values(payload.records).reduce((sum, records) => sum + (records?.length ?? 0), 0);
}

async function postW2uSync(url: string, payload: W2uSyncPayload): Promise<W2uSyncResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as W2uSyncResponse;
  if (!response.ok) throw new Error(body.message ?? `W2U sync request failed with HTTP ${response.status}.`);
  return body;
}

function formatConfirmMessage(result: W2uSyncResponse): string {
  const files = result.files ?? [];
  const shown = files.slice(0, 12).map((file) => `- ${file.path}`).join("\n");
  const more = files.length > 12 ? `\n- ...and ${files.length - 12} more` : "";
  return `Sync ${result.summary ?? `${files.length} W2U TOML files`} to:\n${result.repoPath ?? "configured White2Upgrade repo"}\n\n${shown}${more}`;
}

function isLocalSyncHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "::1" || window.location.hostname === "[::1]";
}

function hasLikelyW2uEditableData(project: ProjectState): boolean {
  return Boolean(project.narcs.moves || project.narcs.trdata || project.narcs.trpok);
}
