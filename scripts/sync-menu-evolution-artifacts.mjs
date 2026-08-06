import { createHash } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const checkOnly = process.argv.includes("--check");
const configMarker = Buffer.from("MEVOMSG\0", "ascii");
const artifacts = [
  {
    name: "MenuEvolutionW2.dll",
    source: resolve(
      process.env.MENU_EVOLUTION_W2_BUILD_PATH
        ?? resolve(root, "../../White2Upgrade-Original-pokeweb/build-stripped/src/MenuEvolutionW2.dll"),
    ),
  },
  {
    name: "MenuEvolutionB2.dll",
    source: resolve(
      process.env.MENU_EVOLUTION_B2_BUILD_PATH
        ?? resolve(root, "../../White2Upgrade-Original-pokeweb/build-stripped/src/MenuEvolutionB2.dll"),
    ),
  },
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function validateStrippedDlxf(bytes, path) {
  if (bytes.subarray(0, 4).toString("ascii") !== "DLXF") {
    throw new Error(`${path} is not a DLXF Menu Evolution runtime.`);
  }
  const execOffset = bytes.readUInt32LE(8);
  if (bytes.subarray(execOffset, execOffset + 4).toString("ascii") !== "DLXH") {
    throw new Error(`${path} does not contain a DLXH header.`);
  }
  const infoOffset = execOffset + bytes.readUInt32LE(execOffset + 8);
  if (bytes.subarray(infoOffset, infoOffset + 4).toString("ascii") !== "INFO") {
    throw new Error(`${path} does not contain an INFO section.`);
  }
  const symbolsOffset = execOffset + bytes.readUInt32LE(infoOffset + 4);
  if (bytes.subarray(symbolsOffset, symbolsOffset + 4).toString("ascii") !== "SYM0") {
    throw new Error(`${path} does not contain a SYM0 section.`);
  }
  const symbolCount = bytes.readUInt32LE(symbolsOffset + 20);
  const symbolsStart = symbolsOffset + 24;
  const symbolsEnd = symbolsStart + symbolCount * 12;
  if (symbolsEnd > bytes.length) throw new Error(`${path} has a symbol table outside the RPM image.`);
  for (let index = 0; index < symbolCount; index += 1) {
    if (bytes.readUInt16LE(symbolsStart + index * 12) !== 0) {
      throw new Error(`${path} is not stripped (symbol ${index} retains a name).`);
    }
  }

  let markerCount = 0;
  let markerOffset = -1;
  for (let offset = 0; offset + configMarker.length <= bytes.length; offset += 1) {
    if (bytes.subarray(offset, offset + configMarker.length).equals(configMarker)) {
      markerCount += 1;
      markerOffset = offset;
    }
  }
  if (markerCount !== 1) throw new Error(`${path} contains ${markerCount} MEVOMSG configuration markers; expected one.`);
  if (bytes.readUInt16LE(markerOffset + 8) !== 1) throw new Error(`${path} has an unsupported Menu Evolution configuration version.`);
}

if (checkOnly) {
  for (const artifact of artifacts) {
    const sourceBytes = await readFile(artifact.source);
    const destinationBytes = await readFile(resolve(root, "src/assets/codeinjection", artifact.name));
    validateStrippedDlxf(sourceBytes, artifact.source);
    validateStrippedDlxf(destinationBytes, artifact.name);
    if (hash(sourceBytes) !== hash(destinationBytes)) {
      throw new Error(`The bundled ${artifact.name} differs from the runtime build.`);
    }
  }
  console.log(`Verified ${artifacts.length} Menu Evolution DLLs.`);
  process.exit(0);
}

for (const artifact of artifacts) {
  const sourceBytes = await readFile(artifact.source);
  validateStrippedDlxf(sourceBytes, artifact.source);
  await copyFile(artifact.source, resolve(root, "src/assets/codeinjection", artifact.name));
  console.log(`Synchronized ${artifact.name} (${sourceBytes.length} bytes).`);
}
