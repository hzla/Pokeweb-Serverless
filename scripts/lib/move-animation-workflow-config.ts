import { access, readFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

export const MOVEANIM_CONFIG_FILE = ".moveanim.local.json";

export type MoveAnimationWorkflowConfigKey = "buildRepo" | "mirrorRepo" | "cleanRom" | "outputRom" | "java";

export type MoveAnimationWorkflowConfig = Record<MoveAnimationWorkflowConfigKey, string>;

export type MoveAnimationWorkflowConfigSource = "cli" | "env" | "local" | "default";

export type ResolvedMoveAnimationWorkflowConfig = {
  values: MoveAnimationWorkflowConfig;
  sources: Record<MoveAnimationWorkflowConfigKey, MoveAnimationWorkflowConfigSource>;
  configPath: string;
  serverlessRoot: string;
  workspaceRoot: string;
};

export type ResolveMoveAnimationWorkflowConfigOptions = {
  serverlessRoot: string;
  cli?: Partial<Record<MoveAnimationWorkflowConfigKey, string>>;
  env?: NodeJS.ProcessEnv;
};

const ENV_KEYS: Record<MoveAnimationWorkflowConfigKey, string> = {
  buildRepo: "MOVEANIM_BUILD_REPO",
  mirrorRepo: "MOVEANIM_MIRROR_REPO",
  cleanRom: "MOVEANIM_CLEAN_ROM",
  outputRom: "MOVEANIM_OUTPUT_ROM",
  java: "MOVEANIM_JAVA",
};

export async function resolveMoveAnimationWorkflowConfig(
  options: ResolveMoveAnimationWorkflowConfigOptions,
): Promise<ResolvedMoveAnimationWorkflowConfig> {
  const serverlessRoot = path.resolve(options.serverlessRoot);
  const workspaceRoot = path.dirname(serverlessRoot);
  const configPath = path.join(serverlessRoot, MOVEANIM_CONFIG_FILE);
  const local = await readLocalConfig(configPath);
  const env = options.env ?? process.env;
  const defaults: MoveAnimationWorkflowConfig = {
    buildRepo: path.resolve(workspaceRoot, "../White2Upgrade-Original-pokeweb"),
    mirrorRepo: path.join(workspaceRoot, "White2Upgrade"),
    cleanRom: path.join(workspaceRoot, "cleanwhite2.nds"),
    outputRom: path.resolve(workspaceRoot, "../White2Upgrade.nds"),
    java: "java",
  };

  const values = {} as MoveAnimationWorkflowConfig;
  const sources = {} as Record<MoveAnimationWorkflowConfigKey, MoveAnimationWorkflowConfigSource>;
  for (const key of Object.keys(defaults) as MoveAnimationWorkflowConfigKey[]) {
    const cliValue = cleanString(options.cli?.[key]);
    const envValue = cleanString(env[ENV_KEYS[key]]);
    const localValue = cleanString(local[key]);
    const [raw, source] = cliValue !== undefined
      ? [cliValue, "cli" as const]
      : envValue !== undefined
        ? [envValue, "env" as const]
        : localValue !== undefined
          ? [localValue, "local" as const]
          : [defaults[key], "default" as const];
    values[key] = key === "java" && !looksLikePath(raw) ? raw : resolveFrom(serverlessRoot, raw);
    sources[key] = source;
  }

  return { values, sources, configPath, serverlessRoot, workspaceRoot };
}

export function configOverrideHelp(configPath: string): string {
  return [
    `Create ${configPath} from .moveanim.local.example.json,`,
    "or override with --build-repo/--mirror/--clean-rom/--output-rom/--java,",
    "or MOVEANIM_BUILD_REPO/MOVEANIM_MIRROR_REPO/MOVEANIM_CLEAN_ROM/MOVEANIM_OUTPUT_ROM/MOVEANIM_JAVA.",
  ].join(" ");
}

export async function pathKind(value: string): Promise<"file" | "directory" | "missing"> {
  try {
    const info = await stat(value);
    if (info.isFile()) return "file";
    if (info.isDirectory()) return "directory";
    return "missing";
  } catch {
    return "missing";
  }
}

export async function writableParent(value: string): Promise<string | undefined> {
  let candidate = path.resolve(path.dirname(value));
  while (true) {
    if ((await pathKind(candidate)) === "directory") {
      try {
        await access(candidate, fsConstants.W_OK);
        return candidate;
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) return undefined;
    candidate = parent;
  }
}

async function readLocalConfig(configPath: string): Promise<Partial<MoveAnimationWorkflowConfig>> {
  try {
    const value = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("top level must be an object");
    const out: Partial<MoveAnimationWorkflowConfig> = {};
    for (const key of Object.keys(ENV_KEYS) as MoveAnimationWorkflowConfigKey[]) {
      const candidate = (value as Record<string, unknown>)[key];
      if (candidate !== undefined && typeof candidate !== "string") throw new Error(`${key} must be a string`);
      if (typeof candidate === "string") out[key] = candidate;
    }
    return out;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Cannot read ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function cleanString(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function looksLikePath(value: string): boolean {
  return path.isAbsolute(value) || value.includes("/") || value.includes("\\") || value.startsWith(".");
}

function resolveFrom(base: string, value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(base, value);
}
