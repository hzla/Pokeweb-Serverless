import manifest from "../assets/codeinjection/megaEvolutionManifest.json";
import { recordGenericChange } from "./actionChangelog";
import { canOpenMapStudio } from "./mapStudioAccess";
import { canRemoveStagedCodeInjectionDll, detectBlack2UpgradeDlls, detectWhite2UpgradeDlls, listCodeInjectionDlls, removeStagedCodeInjectionDll, stageCodeInjectionDll } from "./pmcModel";
import { decodeRecord, type ProjectState } from "./projectStore";
import { parseRpm } from "./rpm";

/**
 * Mega Evolution (Black 2 / White 2): one PMC DLL on battle overlay 167 (runtime/mega-evolution).
 *
 * A Pokémon holding its route's trigger item (or knowing its trigger move) changes into the route's target form
 * once per side per battle: the player arms it on the move screen (START or the touch button), opposing trainers
 * do it automatically. Megas happen before the first move of the turn and the turn order is then recalculated
 * (Generation 7). The form, its ability and stats last until the battle ends, then the party gets its own back.
 *
 * Credits: Dararo (original Mega Evolution implementation), Hibiki (Battle UI and transformation animation), both
 * from White2Upgrade.
 */

export type MegaEvolutionVersion = "B2" | "W2";

export type MegaRoute = {
  species: number;
  /** A held item, or a move with `moveTrigger` (Mega Rayquaza). */
  trigger: number;
  sourceForm: number;
  targetForm: number;
  moveTrigger?: boolean;
};

export type MegaEvolutionConfig = {
  version: number;
  routes: MegaRoute[];
  /** Battle std message IDs (0: no message). */
  messages: { reacting: number; evolved: number; wish: number };
  /** The animation BtlvScu_StartMoveEffect plays for the transformation (0: the native form change). */
  animationMove: number;
  revealFrame: number;
  autoFoes: boolean;
  /** Set by the Mega content package (megaContentModel). */
  content?: {
    version: number;
    forms: Array<{ key: string; name: string; species: number; form: number; credits: { front: string; back: string } }>;
    stones: number[];
  };
};

export const MEGA_ROUTE_CAPACITY = 192;
export const MEGA_CREDITS = [
  { name: "Dararo", role: "Original Mega Evolution implementation" },
  { name: "Hibiki", role: "Battle UI and transformation animation" },
] as const;

const DLL_URLS: Record<MegaEvolutionVersion, URL> = {
  W2: new URL("../assets/codeinjection/PokewebMegaW2.dll", import.meta.url),
  B2: new URL("../assets/codeinjection/PokewebMegaB2.dll", import.meta.url),
};

type GameManifest = {
  fileName: string; sha256: string; size: number; tableOffset: number;
  targets: Array<{ kind: string; segment: string; address: string }>;
};
const games = manifest.games as Partial<Record<MegaEvolutionVersion, GameManifest>>;
const TABLE_MAGIC = 0x474d5750; // "PWMG"
const TABLE_VERSION = 1;
const DEFAULT_CONFIG: Omit<MegaEvolutionConfig, "version" | "routes"> = {
  messages: { reacting: 0, evolved: 0, wish: 0 }, animationMove: 0, revealFrame: 244, autoFoes: true,
};

export type MegaEvolutionStatus = {
  supported: boolean;
  installed: boolean;
  updateAvailable: boolean;
  compatible: boolean;
  canUninstall: boolean;
  routes: number;
  message: string;
};

export function megaEvolutionVersion(project: ProjectState): MegaEvolutionVersion | undefined {
  const version = project.session.baseVersion;
  return (version === "W2" || version === "B2") && games[version] ? version : undefined;
}

function dllPath(version: MegaEvolutionVersion): string {
  return `patches/${games[version]!.fileName}`;
}

function stagedPath(project: ProjectState, version: MegaEvolutionVersion): string | undefined {
  const wanted = dllPath(version).toLowerCase();
  return Object.keys(project.fileSystem?.additions ?? {}).find((path) => path.toLowerCase() === wanted);
}

export function isMegaEvolutionInstalled(project: ProjectState): boolean {
  const version = megaEvolutionVersion(project);
  return Boolean(version && project.codeInjection?.megaEvolution && stagedPath(project, version));
}

/** Patch ranges of the runtime's hooks: a branch over a function entry takes 12 bytes, a call-site hook 4. */
function hookRanges(version: MegaEvolutionVersion): Array<{ segment: string; start: number; end: number }> {
  return games[version]!.targets.map((target) => {
    const start = Number(target.address);
    return { segment: target.segment, start, end: start + (target.kind === "THUMB_BRANCH_LINK" ? 4 : 12) };
  });
}

/** Other staged DLLs that patch code the runtime hooks. */
export function megaEvolutionConflicts(project: ProjectState): string[] {
  const version = megaEvolutionVersion(project);
  if (!version) return [];
  const ranges = hookRanges(version);
  const own = dllPath(version).toLowerCase();
  const conflicts: string[] = [];
  for (const [path, bytes] of Object.entries(project.fileSystem?.additions ?? {})) {
    if (!path.toLowerCase().endsWith(".dll") || path.toLowerCase() === own) continue;
    let relocations;
    try { relocations = parseRpm(bytes, { allowedMagics: ["DLXF", "RPM0"] }).relocations; } catch { continue; }
    const hits = relocations.some(({ target }) => target.module !== "base" && ranges.some((range) =>
      range.segment === target.module && (target.address & ~1) < range.end && (target.address & ~1) + 4 > range.start));
    if (hits) conflicts.push(path.split("/").pop()!);
  }
  return conflicts;
}

/** The Mega Evolution card is experimental: like Map Studio, it is shown only when Pokeweb runs on localhost. */
export function canUseMegaEvolutionInstaller(hostname = typeof location === "undefined" ? "" : location.hostname): boolean {
  return canOpenMapStudio(hostname);
}

export function getMegaEvolutionStatus(project: ProjectState): MegaEvolutionStatus {
  const version = megaEvolutionVersion(project);
  const status: MegaEvolutionStatus = { supported: false, installed: false, updateAvailable: false, compatible: false, canUninstall: false, routes: 0, message: "" };
  if (!version) return { ...status, message: "Mega Evolution supports US Black 2 and White 2." };
  status.supported = true;
  status.installed = isMegaEvolutionInstalled(project);
  status.routes = project.codeInjection?.megaEvolution?.routes.length ?? 0;
  status.updateAvailable = status.installed && project.codeInjection?.megaEvolution?.version !== manifest.version;
  status.canUninstall = status.installed && canRemoveStagedCodeInjectionDll(project, dllPath(version));
  if (detectWhite2UpgradeDlls(project) || detectBlack2UpgradeDlls(project)) {
    return { ...status, message: "White 2 Upgrade / Black 2 Upgrade include their own Mega Evolution." };
  }
  const conflicts = megaEvolutionConflicts(project);
  if (conflicts.length) return { ...status, message: `${conflicts.join(", ")} patches the same battle code.` };
  status.compatible = true;
  status.message = status.installed ? "Mega Evolution is installed." : "Ready to install.";
  return status;
}

/** Problems with a route list, for the editor and before writing the table. */
export function validateMegaRoutes(project: ProjectState, routes: MegaRoute[]): string[] {
  const problems: string[] = [];
  if (routes.length > MEGA_ROUTE_CAPACITY) problems.push(`At most ${MEGA_ROUTE_CAPACITY} routes fit the runtime.`);
  const seen = new Set<string>();
  routes.forEach((route, index) => {
    const name = `Route ${index + 1}`;
    const bounded = (value: number, max: number) => Number.isInteger(value) && value >= 0 && value <= max;
    if (!bounded(route.species, 0xffff) || route.species === 0) problems.push(`${name}: choose a species.`);
    if (!bounded(route.trigger, 0xffff) || route.trigger === 0) problems.push(`${name}: choose a ${route.moveTrigger ? "move" : "held item"}.`);
    if (!bounded(route.sourceForm, 31) || !bounded(route.targetForm, 31) || route.targetForm === route.sourceForm || route.targetForm === 0) {
      problems.push(`${name}: the Mega form must be another form, 1-31.`);
    }
    let formCount = NaN;
    try { formCount = Number(decodeRecord(project, "personal", route.species).raw?.num_forms ?? NaN); } catch { /* not loaded */ }
    if (Number.isFinite(formCount) && route.targetForm >= Math.max(1, formCount)) {
      problems.push(`${name}: species ${route.species} has no form ${route.targetForm}; add the Mega form first.`);
    }
    const key = `${route.species}:${route.sourceForm}:${route.moveTrigger ? "m" : "i"}${route.trigger}`;
    if (seen.has(key)) problems.push(`${name}: duplicates an earlier route.`);
    seen.add(key);
  });
  return problems;
}

function findTable(bytes: Uint8Array): number {
  for (let i = 0; i + 8 <= bytes.length; i += 4) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + i, 8);
    if (view.getUint32(0, true) === TABLE_MAGIC && view.getUint16(4, true) === TABLE_VERSION) return i;
  }
  return -1;
}

/** The DLL with the project's routes and settings written into its PWMG table. */
export function writeMegaEvolutionTable(bytes: Uint8Array, config: MegaEvolutionConfig): Uint8Array {
  const out = bytes.slice();
  const at = findTable(out);
  if (at < 0) throw new Error("The Mega Evolution DLL has no route table.");
  if (config.routes.length > MEGA_ROUTE_CAPACITY) throw new Error(`At most ${MEGA_ROUTE_CAPACITY} Mega routes fit the runtime.`);
  const view = new DataView(out.buffer, out.byteOffset + at, 24 + MEGA_ROUTE_CAPACITY * 8);
  view.setUint16(6, config.routes.length, true);
  view.setUint16(8, config.messages.reacting, true);
  view.setUint16(10, config.messages.evolved, true);
  view.setUint16(12, config.messages.wish, true);
  view.setUint16(14, config.animationMove, true);
  view.setUint16(20, config.revealFrame, true);
  view.setUint16(22, config.autoFoes ? 1 : 0, true);
  for (let index = 0; index < MEGA_ROUTE_CAPACITY; index++) {
    const route = config.routes[index];
    const o = 24 + index * 8;
    view.setUint16(o, route?.species ?? 0, true);
    view.setUint16(o + 2, route?.trigger ?? 0, true);
    view.setUint8(o + 4, route?.sourceForm ?? 0);
    view.setUint8(o + 5, route?.targetForm ?? 0);
    view.setUint8(o + 6, route?.moveTrigger ? 1 : 0);
    view.setUint8(o + 7, 0);
  }
  return out;
}

/** Writes the project's routes into the staged DLL; called on install, on edits and before every export. */
export function materializeMegaEvolutionTable(project: ProjectState): void {
  const version = megaEvolutionVersion(project);
  const config = project.codeInjection?.megaEvolution;
  const path = version && stagedPath(project, version);
  const additions = project.fileSystem?.additions;
  if (!version || !config || !path || !additions) return;
  additions[path] = writeMegaEvolutionTable(additions[path], config);
}

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url.pathname.split("/").pop()}.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Install (or update) on a staged project; use through installCodeInjectionPatch. Keeps existing routes. */
export async function stageMegaEvolution(project: ProjectState): Promise<{ dll: string }> {
  const version = megaEvolutionVersion(project);
  if (!version) throw new Error("Mega Evolution supports US Black 2 and White 2.");
  const status = getMegaEvolutionStatus(project);
  if (!status.compatible) throw new Error(status.message);
  const game = games[version]!;
  const bytes = await fetchBytes(DLL_URLS[version]);
  if ((await sha256Hex(bytes)) !== game.sha256) throw new Error(`Bundled ${game.fileName} is invalid; reload Pokeweb.`);
  stageCodeInjectionDll(project, game.fileName, bytes, "patches", project.originalRomBytes);
  project.codeInjection ??= {};
  const previous = project.codeInjection.megaEvolution;
  project.codeInjection.megaEvolution = { ...DEFAULT_CONFIG, ...previous, routes: previous?.routes ?? [], version: manifest.version };
  materializeMegaEvolutionTable(project);
  recordGenericChange(project, "code_injection",
    `Mega Evolution v${manifest.version} (by Dararo; battle UI and animation by Hibiki): ${project.codeInjection.megaEvolution.routes.length} routes, Generation 7 turn order.`,
    "Mega Evolution", { key: "code-injection:mega-evolution" });
  return { dll: game.fileName };
}

/** Replaces the route list (and optionally the messages / animation); the DLL table is rewritten at once. */
export function setMegaEvolutionConfig(project: ProjectState, change: Partial<Omit<MegaEvolutionConfig, "version">>): void {
  const config = project.codeInjection?.megaEvolution;
  if (!config) throw new Error("Install Mega Evolution first.");
  const next = { ...config, ...change };
  const problems = validateMegaRoutes(project, next.routes);
  if (problems.length) throw new Error(problems[0]);
  project.codeInjection!.megaEvolution = next;
  materializeMegaEvolutionTable(project);
  recordGenericChange(project, "code_injection", `Mega Evolution: ${next.routes.length} routes.`, "Mega Evolution", { key: "code-injection:mega-evolution" });
}

export function uninstallMegaEvolution(project: ProjectState): void {
  const version = megaEvolutionVersion(project);
  if (!version) return;
  if (stagedPath(project, version)) removeStagedCodeInjectionDll(project, dllPath(version));
  // The Mega content's forms and stones stay in the ROM; keep its routes for a reinstall.
  if (project.codeInjection && !project.codeInjection.megaEvolution?.content) delete project.codeInjection.megaEvolution;
  recordGenericChange(project, "code_injection", "Mega Evolution removed.", "Mega Evolution", { key: "code-injection:mega-evolution" });
}

export function listedMegaEvolutionDll(project: ProjectState): boolean {
  const version = megaEvolutionVersion(project);
  return Boolean(version && listCodeInjectionDlls(project).some((module) => module.path.toLowerCase() === dllPath(version).toLowerCase()));
}
