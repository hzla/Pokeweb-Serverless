export type LocalRomFile = {
  bytes: Uint8Array;
  path: string;
  fileName: string;
};

const LOCAL_ROM_PATH_STORAGE_KEY = "pokeweb.localRom.path";

export function canUseLocalRomBridge(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "::1" || window.location.hostname === "[::1]";
}

export function readStoredLocalRomPath(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(LOCAL_ROM_PATH_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberLocalRomPath(romPath: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const trimmed = romPath.trim();
    if (trimmed) localStorage.setItem(LOCAL_ROM_PATH_STORAGE_KEY, trimmed);
    else localStorage.removeItem(LOCAL_ROM_PATH_STORAGE_KEY);
  } catch {
    // Browser storage may be unavailable in private or constrained contexts.
  }
}

export async function pickLocalRomFile(currentPath = readStoredLocalRomPath()): Promise<LocalRomFile | undefined> {
  return requestLocalRomFile("/__pokeweb_rom/pick", currentPath ? { romPath: currentPath } : {});
}

export async function readLocalRomFile(romPath = readStoredLocalRomPath()): Promise<LocalRomFile> {
  const result = await requestLocalRomFile("/__pokeweb_rom/read", { romPath });
  if (!result) throw new Error("ROM selection was cancelled.");
  return result;
}

async function requestLocalRomFile(url: string, body: Record<string, string>): Promise<LocalRomFile | undefined> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { message?: string; cancelled?: boolean };
    if (payload.cancelled) return undefined;
    throw new Error(payload.message ?? `Local ROM request failed with HTTP ${response.status}.`);
  }

  if (!response.ok) throw new Error(`Local ROM request failed with HTTP ${response.status}.`);
  const pathHeader = response.headers.get("X-Pokeweb-Rom-Path") ?? "";
  const nameHeader = response.headers.get("X-Pokeweb-Rom-File-Name") ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  const romPath = decodeURIComponent(pathHeader);
  const fileName = decodeURIComponent(nameHeader) || romPath.split(/[\\/]/u).pop() || "local-rom.nds";
  if (!romPath) throw new Error("Local ROM response did not include a file path.");
  rememberLocalRomPath(romPath);
  return { bytes, path: romPath, fileName };
}
