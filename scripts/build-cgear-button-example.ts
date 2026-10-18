/** Build the beginner guide's design without using the browser editor.
 * Uses the production compiler and atomic installer; never overwrites a ROM.
 */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import {
  ensureCGearButtons,
  validateButtonArchive,
} from "../src/pokeweb/cgearButtonsModel";
import { defaults, type Document } from "../src/cgearButtons/document";
import {
  installCGearQuickActions,
  CGEAR_QUICK_ACTIONS_VERSION,
} from "../src/pokeweb/cgearQuickActionsModel";

const help =
  "Usage: npx vite-node scripts/build-cgear-button-example.ts INPUT.nds --output NEW.nds [--design FILE.json] [--resources NEW_DIRECTORY]";
const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log(help);
} else {
  const input = args.shift()!;
  const options = new Map<string, string>();
  while (args.length) {
    const name = args.shift()!,
      value = args.shift();
    if (
      !["--output", "--design", "--resources"].includes(name) ||
      !value ||
      value.startsWith("--") ||
      options.has(name)
    ) {
      throw new Error(help);
    }
    options.set(name, value);
  }
  const output = options.get("--output");
  if (!output || resolve(input) === resolve(output))
    throw new Error("Choose a new output ROM filename.\n" + help);
  try {
    await access(output);
    throw new Error("Output already exists; choose another filename.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  // CLI equivalent of the app's bundled-asset loader. No remote downloads.
  globalThis.fetch = (async (request: RequestInfo | URL) => {
    const url =
      request instanceof URL
        ? request
        : new URL(request instanceof Request ? request.url : String(request));
    const name = url.pathname.split("/").pop()!;
    return new Response(
      new Uint8Array(
        await readFile(
          new URL(`../src/assets/codeinjection/${name}`, import.meta.url),
        ),
      ),
    );
  }) as typeof fetch;

  const source = new Uint8Array(await readFile(input));
  const project = await loadProjectFromRomBytes(source, basename(input), {
    selectedNarcs: [],
  });
  if (project.session.baseRom !== "BW2")
    throw new Error(
      "This lesson targets English US B2/W2 revision 0; use the separate BW1 adapter for B/W.",
    );
  const designPath = options.get("--design");
  const document = JSON.parse(
    await readFile(
      designPath ??
        new URL("../docs/cgear-buttons/example-design.json", import.meta.url),
      "utf8",
    ),
  ) as Document;
  // Omitted skins use the same bundled catalog as the editor. Explicit skin
  // settings in the lesson document are respected and validated normally.
  ensureCGearButtons(project).document = {
    ...document,
    skins: document.skins ?? defaults().skins,
  };
  await installCGearQuickActions(project);

  const bytes = await exportModifiedRom(project);
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  const archive = rom.files[rom.fileId("quick-actions/ui.narc")];
  validateButtonArchive(archive);
  const compiled = new NARC(archive);
  if (compiled.files[0][20] !== document.buttons.length)
    throw new Error("Compiled button count does not match the lesson.");

  const resourceDirectory = options.get("--resources");
  if (resourceDirectory) {
    await mkdir(dirname(resolve(resourceDirectory)), { recursive: true });
    await mkdir(resourceDirectory); // An existing directory is never overwritten.
    const game = project.session.baseVersion;
    for (const path of [
      "quick-actions/ui.narc",
      "a/2/8/7",
      `patches/CGearQuickActions${game}.dll`,
      `patches/BgmToggle${game}.dll`,
    ]) {
      const destination = resolve(resourceDirectory, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, rom.files[rom.fileId(path)], { flag: "wx" });
    }
    await writeFile(
      resolve(resourceDirectory, "lesson.json"),
      JSON.stringify(document, null, 2) + "\n",
      { flag: "wx" },
    );
    await writeFile(
      resolve(resourceDirectory, "resources.txt"),
      "Inspection copies of the compiled lesson resources.\n" +
        "The exported ROM is the complete installed result, including PMC/dependency updates.\n" +
        "These four files alone are not a general-purpose installer or conflict checker.\n",
      { flag: "wx" },
    );
  }
  const hash = (data: Uint8Array) =>
    createHash("sha256").update(data).digest("hex");
  if (hash(new Uint8Array(await readFile(input))) !== hash(source))
    throw new Error(
      "Input ROM changed during the build; no output was written.",
    );
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, bytes, { flag: "wx" });
  console.log(
    `${project.session.baseVersion}: ${document.buttons.length} buttons, runtime ${CGEAR_QUICK_ACTIONS_VERSION}. Input ROM preserved.`,
  );
  console.log(`Created ${output}`);
  if (resourceDirectory)
    console.log(`Inspection resources: ${resourceDirectory}`);
}
