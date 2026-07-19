import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readAscii } from "../src/nds/binary";
import { NintendoDSRom } from "../src/nds/rom";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { installBundledPmc, stageCodeInjectionDll } from "../src/pokeweb/pmcModel";
import {
  installPwanRuntime,
  PWAN_LEGACY_W2_RUNTIME_FILENAME,
  PWAN_LEGACY_W2_RUNTIME_PATH,
  PWAN_W2_RUNTIME_PATHS,
} from "../src/pokeweb/pwanAnimationModel";

const [romPath, legacyDllPath] = process.argv.slice(2);
if (!romPath || !legacyDllPath) {
  throw new Error("Usage: npm run pwan:runtime:verify-w2-migration -- cleanwhite2.nds PokewebPwanW2.dll");
}

const cleanBytes = new Uint8Array(await readFile(romPath));
const legacyBytes = new Uint8Array(await readFile(legacyDllPath));
if (sha256(legacyBytes) !== "b5eb73819af80655fd4b56ac84daa4cd25cef06e72fb7fa9ef7d6a7f58b65602") {
  throw new Error("The supplied legacy DLL is not the known Serverless PokewebPwanW2.dll.");
}
const previousFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input));
  const fileName = url.pathname.split("/").pop() ?? "";
  try {
    const asset = new Uint8Array(await readFile(new URL(`../src/assets/codeinjection/${fileName}`, import.meta.url)));
    return new Response(asset);
  } catch {
    return new Response(undefined, { status: 404 });
  }
}) as typeof fetch;

try {
  const pendingProject = await loadProjectFromRomBytes(cleanBytes, "cleanwhite2-pending.nds", {
    selectedNarcs: ["pokemon_sprites", "personal"],
  });
  await installBundledPmc(pendingProject);
  stageCodeInjectionDll(pendingProject, PWAN_LEGACY_W2_RUNTIME_FILENAME, legacyBytes, "patches");
  await installPwanRuntime(pendingProject);
  if (pendingProject.fileSystem?.additions?.[PWAN_LEGACY_W2_RUNTIME_PATH]) {
    throw new Error("Known pending legacy PWAN addition was not removed during split-runtime upgrade.");
  }
  if (PWAN_W2_RUNTIME_PATHS.some((path) => !pendingProject.fileSystem?.additions?.[path])) {
    throw new Error("Pending-project migration did not stage every split White 2 runtime.");
  }

  const conflictProject = await loadProjectFromRomBytes(cleanBytes, "cleanwhite2-conflict.nds", {
    selectedNarcs: ["pokemon_sprites", "personal"],
  });
  await installBundledPmc(conflictProject);
  const conflictingLegacyBytes = legacyBytes.slice();
  conflictingLegacyBytes[conflictingLegacyBytes.length - 1] ^= 0x01;
  stageCodeInjectionDll(conflictProject, PWAN_LEGACY_W2_RUNTIME_FILENAME, conflictingLegacyBytes, "patches");
  let conflictRejected = false;
  try {
    await installPwanRuntime(conflictProject);
  } catch (error) {
    conflictRejected = error instanceof Error && /custom or unknown DLL/u.test(error.message);
  }
  if (!conflictRejected) throw new Error("A conflicting legacy PWAN DLL was not rejected.");

  const legacyProject = await loadProjectFromRomBytes(cleanBytes, "cleanwhite2.nds", {
    selectedNarcs: ["pokemon_sprites", "personal"],
  });
  await installBundledPmc(legacyProject);
  stageCodeInjectionDll(legacyProject, PWAN_LEGACY_W2_RUNTIME_FILENAME, legacyBytes, "patches");
  const legacyRomBytes = await exportModifiedRom(legacyProject);
  const legacyRom = new NintendoDSRom(legacyRomBytes);
  if (sha256(legacyRom.getFileByName(PWAN_LEGACY_W2_RUNTIME_PATH)) !== sha256(legacyBytes)) {
    throw new Error("Failed to create the legacy migration input ROM.");
  }

  const migrationProject = await loadProjectFromRomBytes(legacyRomBytes, "legacy-pwan-white2.nds", {
    selectedNarcs: ["pokemon_sprites", "personal"],
  });
  await installPwanRuntime(migrationProject);
  const migratedBytes = await exportModifiedRom(migrationProject);
  const migratedRom = new NintendoDSRom(migratedBytes);
  for (const path of PWAN_W2_RUNTIME_PATHS) {
    if (readAscii(migratedRom.getFileByName(path), 0, 4) !== "DLXF") {
      throw new Error(`Current split runtime is missing or invalid: ${path}`);
    }
  }
  const retiredHash = sha256(migratedRom.getFileByName(PWAN_LEGACY_W2_RUNTIME_PATH));
  if (retiredHash !== "65d88246013f7ac3a7d87168a8f5058091a2d8f7561d364a5a051c3e632447cb") {
    throw new Error(`Legacy embedded DLL was not retired in place (${retiredHash}).`);
  }
  console.log("White 2 legacy migration passed: known pending additions are removed, custom conflicts are rejected, and an embedded monolith is retired in place before all three split runtimes export.");
} finally {
  globalThis.fetch = previousFetch;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
