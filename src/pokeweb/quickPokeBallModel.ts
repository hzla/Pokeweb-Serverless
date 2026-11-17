import manifest from "../assets/codeinjection/quickPokeBallManifest.json";
import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { sha256Hex } from "../nds/sha256";
import { recordGenericChange } from "./actionChangelog";
import { installCodeInjectionPatch, withProjectMutationLock } from "./codeInjectionInstall";
import { addRomFile, setRomFileReplacement } from "./fileSystemModel";
import { canRemoveStagedCodeInjectionDll, listCodeInjectionDlls, removeStagedCodeInjectionDll, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";

const dllUrls = {
  B: new URL("../assets/codeinjection/QuickPokeBallB.dll", import.meta.url),
  W: new URL("../assets/codeinjection/QuickPokeBallW.dll", import.meta.url),
  B2: new URL("../assets/codeinjection/QuickPokeBallB2.dll", import.meta.url),
  W2: new URL("../assets/codeinjection/QuickPokeBallW2.dll", import.meta.url),
};
const archiveUrl = new URL("../assets/codeinjection/quickPokeBall.narc", import.meta.url);

function romFile(project: ProjectState, rom: NintendoDSRom | undefined, path: string) {
  const added = Object.keys(project.fileSystem?.additions ?? {}).find(key => key.toLowerCase() === path.toLowerCase());
  if (added) return project.fileSystem?.additions?.[added];
  const id = rom?.filenames.idOf(path);
  return rom && id !== undefined ? project.fileSystem?.replacements?.[id] ?? rom.files[id] : undefined;
}

function overlapsHook(rpm: RpmModule, { segment, address }: { segment: string; address: number }) {
  return rpm.relocations.some(({ target, sourceSymbolIndex }) => {
    if (target.module !== segment) return false;
    const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
      : target.type === "THUMB_BRANCH" ? 2
      : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : 4;
    return target.address < address + 4 && target.address + size > address;
  });
}

function archiveVersion(bytes: Uint8Array): "current" | "previous" | undefined {
  if (sha256Hex(bytes) === manifest.archiveSha256) return "current";
  try {
    // ROM export can reserialize unnamed NARCs with different block padding.
    const { files } = new NARC(bytes);
    if (files.length !== manifest.archiveMembers.length) return;
    const hashes = files.map(sha256Hex);
    if (hashes.every((hash, index) => hash === manifest.archiveMembers[index])) return "current";
    const digest = sha256Hex(new TextEncoder().encode(hashes.join("")));
    if (manifest.previousArchiveMemberDigests.includes(digest)) return "previous";
  } catch {
    return;
  }
}

type QuickPokeBallStatus = {
  supported: boolean;
  compatible: boolean;
  installed: boolean;
  updateAvailable: boolean;
  canUninstall: boolean;
  message: string;
  dllPath?: string;
};

export function getQuickPokeBallStatus(project: ProjectState, bytes = project.originalRomBytes): QuickPokeBallStatus {
  const state = { supported: false, compatible: false, installed: false, updateAvailable: false, canUninstall: false,
    message: "Quick Poké Ball supports US revision-0 Black, White, Black 2, and White 2." };
  const version = project.session.baseVersion;
  if (version !== "B" && version !== "W" && version !== "B2" && version !== "W2") return state;
  if (project.session.baseRom !== (version === "B" || version === "W" ? "BW" : "BW2")) return state;
  const profile = manifest.games[version];
  const previousHash = "previousRuntimeSha256" in profile ? profile.previousRuntimeSha256 : undefined;
  const previousSize = "previousRuntimeSize" in profile ? profile.previousRuntimeSize : undefined;
  let rom: NintendoDSRom | undefined;
  try {
    if (bytes) rom = new NintendoDSRom(bytes, { fileData: "view" });
  } catch {
    return { ...state, message: "Reload the ROM to check Quick Poké Ball compatibility." };
  }
  if ((rom?.idCode ?? project.romInfo.idCode) !== profile.idCode || (rom && rom.data[0x1e] !== 0)) return state;
  state.supported = true;

  let dllPath: string | undefined;
  let previousRuntime = false;
  for (const entry of listCodeInjectionDlls(project)) {
    const data = romFile(project, rom, entry.path);
    if (!data && !rom) continue; // IndexedDB-backed projects are checked again during installation.
    const hash = entry.target === "patches" && data &&
      (data.length === profile.size || data.length === previousSize) ? sha256Hex(data) : undefined;
    if (hash && (hash === profile.sha256 || hash === previousHash)) {
      if (dllPath) return { ...state, message: "Multiple Quick Poké Ball modules are installed." };
      dllPath = entry.path;
      previousRuntime = hash === previousHash;
      continue;
    }
    if (/^quickpokeball[wb]2?(?:\.debug)?\.dll$/iu.test(entry.fileName))
      return { ...state, message: `Quick Poké Ball does not recognize ${entry.path}.` };
    if (!data || entry.target !== "patches") continue;
    try {
      const rpm = parseRpm(data, { allowedMagics: ["DLXF"] });
      if (profile.hooks.some(hook => overlapsHook(rpm, hook)))
        return { ...state, message: `Quick Poké Ball conflicts with ${entry.path}.` };
    } catch {
      return { ...state, message: `Could not check battle hook compatibility with ${entry.path}.` };
    }
  }

  const archive = romFile(project, rom, manifest.archivePath);
  const graphics = archive && archiveVersion(archive);
  if (archive && !graphics)
    return { ...state, message: `Quick Poké Ball does not recognize ${manifest.archivePath}.` };
  state.installed = !!dllPath && !!archive;
  state.updateAvailable = previousRuntime || (state.installed && graphics === "previous");
  state.canUninstall = !!dllPath && canRemoveStagedCodeInjectionDll(project, dllPath);

  if (rom) {
    try {
      const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
        (_id, fileId) => project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId], new Set(profile.abi.map(check => check.overlay)));
      for (const check of profile.abi) {
        const overlay = overlays.get(check.overlay);
        const code = project.overlays[check.overlay] ?? overlay?.data;
        const offset = check.address - (overlay?.ramAddress ?? 0);
        if (!code || offset < 0 || sha256Hex(code.subarray(offset, offset + check.size)) !== check.sha256)
          return { ...state, message: `Quick Poké Ball compatibility failed at ${check.label}.` };
      }
      const arm9 = project.arm9.length ? project.arm9 : decompressCode(rom.arm9);
      for (const hook of profile.hooks.filter(hook => hook.segment === "ARM9")) {
        const offset = hook.address - rom.arm9RamAddress;
        const bytes = arm9.subarray(offset, offset + 4);
        const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
        if (offset < 0 || hex !== hook.expectedHex)
          return { ...state, message: "Quick Poké Ball compatibility failed at the Bag cursor initialization hook." };
      }
    } catch {
      return { ...state, message: "Could not read the battle overlays for compatibility checks." };
    }
  }

  const message = state.updateAvailable ? "Update available." : state.installed ? "Installed."
    : dllPath ? "Graphics missing. Reinstall to repair." : "";
  return { ...state, compatible: true, message, dllPath };
}

async function readBundle(url: URL, expected: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load the Quick Poké Ball bundle.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256Hex(bytes) !== expected) throw new Error("The Quick Poké Ball bundle failed its integrity check.");
  return bytes;
}

export async function installQuickPokeBall(project: ProjectState) {
  await installCodeInjectionPatch(project, async staged => {
    const status = getQuickPokeBallStatus(staged);
    if (!status.compatible) throw new Error(status.message);
    const version = staged.session.baseVersion as keyof typeof dllUrls;
    const profile = manifest.games[version];
    const [dll, archive] = await Promise.all([
      readBundle(dllUrls[version], profile.sha256),
      readBundle(archiveUrl, manifest.archiveSha256),
    ]);
    const rom = new NintendoDSRom(staged.originalRomBytes!, { fileData: "view" });
    if (!status.dllPath || status.updateAvailable)
      stageCodeInjectionDll(staged, status.dllPath?.split("/").at(-1) ?? profile.fileName, dll);
    const fileId = rom.filenames.idOf(manifest.archivePath);
    if (fileId === undefined) addRomFile(staged, manifest.archivePath, archive);
    else setRomFileReplacement(staged, fileId, archive);
    const message = status.updateAvailable ? "Updated Quick Poké Ball." : "Installed Quick Poké Ball.";
    recordGenericChange(staged, "code_injection", message, "Quick Poké Ball", { key: "code-injection:quick-poke-ball" });
  });
}

export async function uninstallQuickPokeBall(project: ProjectState) {
  await withProjectMutationLock(project, () => {
    const status = getQuickPokeBallStatus(project);
    if (!status.dllPath || !status.canUninstall) throw new Error("Only a staged Quick Poké Ball installation can be removed.");
    removeStagedCodeInjectionDll(project, status.dllPath);
    delete project.fileSystem?.additions?.[manifest.archivePath];
    recordGenericChange(project, "code_injection", "Removed the staged Quick Poké Ball patch.", "Quick Poké Ball", { key: "code-injection:quick-poke-ball" });
  });
}
