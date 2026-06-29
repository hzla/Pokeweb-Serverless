import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const ENDPOINT_PREFIX = "/__pokeweb_w2u";
const ROM_ENDPOINT_PREFIX = "/__pokeweb_rom";

const DOMAIN_LABELS = {
  personal: "personal",
  learnsets: "learnset",
  evolutions: "evolution",
  moves: "move",
  trainers: "trainer",
};

const ENUM_FILES = [
  "species",
  "moves",
  "items",
  "types",
  "evolution_methods",
  "pss",
  "btl_eff",
  "btl_target",
  "btl_stat",
  "btl_inflict",
  "status",
  "move_flags",
];

export function createW2uLocalBridgePlugin(options = {}) {
  return {
    name: "pokeweb-w2u-local-bridge",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
        const isW2uRequest = requestUrl.pathname.startsWith(ENDPOINT_PREFIX);
        const isRomRequest = requestUrl.pathname.startsWith(ROM_ENDPOINT_PREFIX);
        if (!isW2uRequest && !isRomRequest) {
          next();
          return;
        }

        if (!isLoopbackAddress(req.socket.remoteAddress)) {
          writeJson(res, 403, { ok: false, message: "W2U local sync only accepts loopback requests." });
          return;
        }

        try {
          if (requestUrl.pathname === `${ROM_ENDPOINT_PREFIX}/pick` && req.method === "POST") {
            const payload = await readJsonBody(req);
            const pickedPath = await pickRomFile(server.config.root, payload?.romPath);
            if (!pickedPath) {
              writeJson(res, 200, { ok: false, cancelled: true, message: "ROM selection cancelled." });
              return;
            }
            writeRomFile(res, pickedPath);
            return;
          }

          if (requestUrl.pathname === `${ROM_ENDPOINT_PREFIX}/read` && req.method === "POST") {
            const payload = await readJsonBody(req);
            const romPath = resolveRomFilePath(server.config.root, payload?.romPath);
            writeRomFile(res, romPath);
            return;
          }

          if (requestUrl.pathname === `${ENDPOINT_PREFIX}/status` && req.method === "GET") {
            writeJson(res, 200, getBridgeStatus(server.config.root, options, requestUrl.searchParams.get("repoPath")));
            return;
          }

          if (requestUrl.pathname === `${ENDPOINT_PREFIX}/pick-folder` && req.method === "POST") {
            const payload = await readJsonBody(req);
            writeJson(res, 200, await pickW2uRepoFolder(server.config.root, payload?.repoPath));
            return;
          }

          if (requestUrl.pathname === `${ENDPOINT_PREFIX}/sync` && req.method === "POST") {
            const payload = await readJsonBody(req);
            const context = createBridgeContext(server.config.root, options, payload?.repoPath);
            if (!context.available) {
              writeJson(res, 503, context);
              return;
            }
            const dryRun = requestUrl.searchParams.get("dryRun") === "1";
            writeJson(res, 200, syncPayload(context, payload, { dryRun }));
            return;
          }

          writeJson(res, 404, { ok: false, message: "Unknown W2U local sync endpoint." });
        } catch (error) {
          writeJson(res, 500, { ok: false, message: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}

function getBridgeStatus(viteRoot, options, requestedRepoPath) {
  const context = createBridgeContext(viteRoot, options, requestedRepoPath);
  if (!context.available) return context;
  return {
    ok: true,
    available: true,
    configured: context.configured,
    repoPath: context.repoPath,
    manifests: Object.fromEntries(Object.entries(context.manifests).map(([name, entries]) => [name, entries.length])),
  };
}

function createBridgeContext(viteRoot, options, requestedRepoPath) {
  const explicitRepoPath = normalizeRepoPathInput(requestedRepoPath, viteRoot);
  if (explicitRepoPath) {
    const resolved = resolveExistingPath(explicitRepoPath);
    if (!resolved) {
      return {
        ok: false,
        available: false,
        configured: true,
        repoPath: explicitRepoPath,
        message: `White2Upgrade repo path does not exist: ${explicitRepoPath}`,
      };
    }
    if (!isWhite2UpgradeRepo(resolved)) {
      return {
        ok: false,
        available: false,
        configured: true,
        repoPath: resolved,
        message: `Path is not a White2Upgrade repo: ${resolved}`,
      };
    }
    return {
      ok: true,
      available: true,
      configured: true,
      repoPath: resolved,
      manifests: readManifests(resolved),
      enums: readEnums(resolved),
    };
  }

  const configured = Boolean(options.repoPath || process.env.POKEWEB_W2U_REPO || process.env.W2U_REPO);
  const repoPath = resolveW2uRepoPath(viteRoot, options);
  if (!repoPath) {
    return {
      ok: false,
      available: false,
      configured,
      message: "White2Upgrade repo not found. Set POKEWEB_W2U_REPO before starting the local dev server.",
    };
  }

  return {
    ok: true,
    available: true,
    configured,
    repoPath,
    manifests: readManifests(repoPath),
    enums: readEnums(repoPath),
  };
}

function resolveW2uRepoPath(viteRoot, options) {
  const candidates = [
    options.repoPath,
    process.env.POKEWEB_W2U_REPO,
    process.env.W2U_REPO,
    path.resolve(viteRoot, "../../White2Upgrade-Original-pokeweb"),
    path.resolve(viteRoot, "../../White2Upgrade-Original"),
    path.resolve(viteRoot, "../White2Upgrade-Original-pokeweb"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = resolveExistingPath(normalizeRepoPathInput(candidate, viteRoot));
    if (!resolved) continue;
    if (isWhite2UpgradeRepo(resolved)) return resolved;
  }
  return undefined;
}

function normalizeRepoPathInput(input, viteRoot) {
  if (typeof input !== "string") return undefined;
  let candidate = input.trim();
  if (!candidate) return undefined;
  if ((candidate.startsWith('"') && candidate.endsWith('"')) || (candidate.startsWith("'") && candidate.endsWith("'"))) candidate = candidate.slice(1, -1);
  if (candidate === "~") candidate = process.env.HOME ?? candidate;
  else if (candidate.startsWith("~/")) candidate = path.join(process.env.HOME ?? "", candidate.slice(2));
  return path.isAbsolute(candidate) ? candidate : path.resolve(viteRoot, candidate);
}

function resolveExistingPath(candidate) {
  if (!candidate) return undefined;
  try {
    return fs.realpathSync(candidate);
  } catch {
    return undefined;
  }
}

function isWhite2UpgradeRepo(repoPath) {
  return (
    fs.existsSync(path.join(repoPath, "data", "pml", "meson.build")) &&
    fs.existsSync(path.join(repoPath, "data", "pml", "moves", "meson.build")) &&
    fs.existsSync(path.join(repoPath, "data", "trainers", "meson.build")) &&
    fs.existsSync(path.join(repoPath, "tools", "mkdata", "enum", "species.toml"))
  );
}

async function pickRomFile(viteRoot, requestedRomPath) {
  const startPath = pickerStartFilePath(viteRoot, requestedRomPath);
  const selectedPath = await openNativeFilePicker(startPath);
  if (!selectedPath) return undefined;
  return resolveRomFilePath(viteRoot, selectedPath);
}

function pickerStartFilePath(viteRoot, requestedRomPath) {
  const requested = normalizeRepoPathInput(requestedRomPath, viteRoot);
  if (requested && fs.existsSync(requested)) {
    const stat = fs.statSync(requested);
    return stat.isDirectory() ? requested : path.dirname(requested);
  }
  return viteRoot;
}

function resolveRomFilePath(viteRoot, requestedRomPath) {
  const requested = normalizeRepoPathInput(requestedRomPath, viteRoot);
  if (!requested) throw new Error("No ROM path was provided.");
  const resolved = resolveExistingPath(requested);
  if (!resolved) throw new Error(`ROM path does not exist: ${requested}`);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`ROM path is not a file: ${resolved}`);
  if (path.extname(resolved).toLowerCase() !== ".nds") throw new Error(`Expected a .nds ROM file: ${resolved}`);
  return resolved;
}

async function openNativeFilePicker(startPath) {
  if (process.platform === "darwin") return openMacFilePicker(startPath);
  if (process.platform === "win32") return openWindowsFilePicker(startPath);
  return openLinuxFilePicker(startPath);
}

async function openMacFilePicker(startPath) {
  const defaultLocation = startPath ? ` default location POSIX file ${appleScriptString(startPath)}` : "";
  const script = `set chosenFile to choose file with prompt "Select Nintendo DS ROM"${defaultLocation}
POSIX path of chosenFile`;
  return runPickerCommand("osascript", ["-e", script]);
}

async function openWindowsFilePicker(startPath) {
  const escapedStartPath = startPath ? powershellString(startPath) : "$null";
  const command = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Select Nintendo DS ROM'
$dialog.Filter = 'Nintendo DS ROM (*.nds)|*.nds|All files (*.*)|*.*'
$selectedPath = ${escapedStartPath}
if ($selectedPath -and (Test-Path -LiteralPath $selectedPath)) { $dialog.InitialDirectory = $selectedPath }
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.FileName }
`;
  return runPickerCommand("powershell.exe", ["-NoProfile", "-STA", "-Command", command]);
}

async function openLinuxFilePicker(startPath) {
  if (commandExists("zenity")) {
    const args = ["--file-selection", "--title=Select Nintendo DS ROM", "--file-filter=Nintendo DS ROM | *.nds"];
    if (startPath) args.push(`--filename=${startPath.endsWith(path.sep) ? startPath : `${startPath}${path.sep}`}`);
    return runPickerCommand("zenity", args);
  }
  if (commandExists("kdialog")) {
    return runPickerCommand("kdialog", ["--getopenfilename", startPath ?? process.cwd(), "*.nds", "--title", "Select Nintendo DS ROM"]);
  }
  throw new Error("No native file picker is available. Install zenity/kdialog or use the browser ROM upload.");
}

function writeRomFile(res, romPath) {
  const stat = fs.statSync(romPath);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("X-Pokeweb-Rom-Path", encodeURIComponent(romPath));
  res.setHeader("X-Pokeweb-Rom-File-Name", encodeURIComponent(path.basename(romPath)));
  fs.createReadStream(romPath).on("error", (error) => {
    if (!res.headersSent) writeJson(res, 500, { ok: false, message: error instanceof Error ? error.message : String(error) });
    else res.destroy(error);
  }).pipe(res);
}

async function pickW2uRepoFolder(viteRoot, requestedRepoPath) {
  const startPath = pickerStartPath(viteRoot, requestedRepoPath);
  const selectedPath = await openNativeFolderPicker(startPath);
  if (!selectedPath) return { ok: false, cancelled: true, message: "Folder selection cancelled." };

  const resolved = resolveExistingPath(selectedPath);
  if (!resolved) {
    return { ok: false, available: false, repoPath: selectedPath, message: `Selected path does not exist: ${selectedPath}` };
  }
  if (!isWhite2UpgradeRepo(resolved)) {
    return { ok: false, available: false, repoPath: resolved, message: `Path is not a White2Upgrade repo: ${resolved}` };
  }
  return {
    ok: true,
    available: true,
    configured: true,
    repoPath: resolved,
    manifests: Object.fromEntries(Object.entries(readManifests(resolved)).map(([name, entries]) => [name, entries.length])),
  };
}

function pickerStartPath(viteRoot, requestedRepoPath) {
  const requested = normalizeRepoPathInput(requestedRepoPath, viteRoot);
  if (requested && fs.existsSync(requested)) {
    const stat = fs.statSync(requested);
    return stat.isDirectory() ? requested : path.dirname(requested);
  }
  const inferred = resolveW2uRepoPath(viteRoot, {});
  return inferred ?? viteRoot;
}

async function openNativeFolderPicker(startPath) {
  if (process.platform === "darwin") return openMacFolderPicker(startPath);
  if (process.platform === "win32") return openWindowsFolderPicker(startPath);
  return openLinuxFolderPicker(startPath);
}

async function openMacFolderPicker(startPath) {
  const script = startPath
    ? `set chosenFolder to choose folder with prompt "Select White2Upgrade repo folder" default location POSIX file ${appleScriptString(startPath)}
POSIX path of chosenFolder`
    : 'set chosenFolder to choose folder with prompt "Select White2Upgrade repo folder"\nPOSIX path of chosenFolder';
  return runPickerCommand("osascript", ["-e", script]);
}

async function openWindowsFolderPicker(startPath) {
  const escapedStartPath = startPath ? powershellString(startPath) : "$null";
  const command = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select White2Upgrade repo folder'
$dialog.ShowNewFolderButton = $false
$selectedPath = ${escapedStartPath}
if ($selectedPath -and (Test-Path -LiteralPath $selectedPath)) { $dialog.SelectedPath = $selectedPath }
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }
`;
  return runPickerCommand("powershell.exe", ["-NoProfile", "-STA", "-Command", command]);
}

async function openLinuxFolderPicker(startPath) {
  if (commandExists("zenity")) {
    const args = ["--file-selection", "--directory", "--title=Select White2Upgrade repo folder"];
    if (startPath) args.push(`--filename=${startPath.endsWith(path.sep) ? startPath : `${startPath}${path.sep}`}`);
    return runPickerCommand("zenity", args);
  }
  if (commandExists("kdialog")) {
    return runPickerCommand("kdialog", ["--getexistingdirectory", startPath ?? process.cwd(), "--title", "Select White2Upgrade repo folder"]);
  }
  throw new Error("No native folder picker is available. Install zenity/kdialog or type the W2U repo path manually.");
}

function runPickerCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: false }, (error, stdout) => {
      if (error) {
        if ("code" in error && (error.code === 1 || error.code === 130)) {
          resolve(undefined);
          return;
        }
        reject(error);
        return;
      }
      resolve(stdout.trim() || undefined);
    });
  });
}

function commandExists(command) {
  const paths = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return paths.some((directory) => fs.existsSync(path.join(directory, command)));
}

function appleScriptString(value) {
  return `"${String(value).replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

function powershellString(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

function readManifests(repoPath) {
  const pmlMeson = fs.readFileSync(path.join(repoPath, "data", "pml", "meson.build"), "utf8");
  const movesMeson = fs.readFileSync(path.join(repoPath, "data", "pml", "moves", "meson.build"), "utf8");
  const trainersMeson = fs.readFileSync(path.join(repoPath, "data", "trainers", "meson.build"), "utf8");
  return {
    personal: extractMesonArray(pmlMeson, "personal_sources"),
    learnsets: extractMesonArray(pmlMeson, "learnset_sources"),
    evolutions: extractMesonArray(pmlMeson, "evolution_sources"),
    moves: extractMesonArray(movesMeson, "moves"),
    trainers: extractMesonArray(trainersMeson, "trainers"),
  };
}

function extractMesonArray(text, name) {
  const match = text.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "u"));
  if (!match) throw new Error(`Unable to find ${name} in W2U meson.build.`);
  return [...match[1].matchAll(/['"]([^'"]+)['"]/gu)].map((item) => item[1]);
}

function readEnums(repoPath) {
  return Object.fromEntries(ENUM_FILES.map((name) => [name, readEnum(repoPath, name)]));
}

function readEnum(repoPath, name) {
  const text = fs.readFileSync(path.join(repoPath, "tools", "mkdata", "enum", `${name}.toml`), "utf8");
  const valueToLabel = new Map();
  for (const match of text.matchAll(/"([^"]+)"\s*=\s*(-?\d+)/gu)) {
    const label = match[1];
    const value = Number(match[2]);
    if (!valueToLabel.has(value)) valueToLabel.set(value, label);
  }
  return valueToLabel;
}

function syncPayload(context, payload, { dryRun }) {
  const files = [];
  for (const record of recordsFor(payload, "personal")) {
    addOutput(context, files, "personal", record.id, serializePersonal(context, record.id, record.raw), dryRun);
  }
  for (const record of recordsFor(payload, "learnsets")) {
    addOutput(context, files, "learnsets", record.id, serializeLearnset(context, record.id, record.raw), dryRun);
  }
  for (const record of recordsFor(payload, "evolutions")) {
    addOutput(context, files, "evolutions", record.id, serializeEvolution(context, record.id, record.raw), dryRun);
  }
  for (const record of recordsFor(payload, "moves")) {
    addOutput(context, files, "moves", record.id, serializeMove(context, record.id, record.raw), dryRun);
  }
  for (const record of recordsFor(payload, "trainers")) {
    addOutput(context, files, "trainers", record.id, serializeTrainer(context, record), dryRun);
  }

  const domainCounts = files.reduce((counts, file) => {
    counts[file.domain] = (counts[file.domain] ?? 0) + 1;
    return counts;
  }, {});

  return {
    ok: true,
    dryRun,
    repoPath: context.repoPath,
    fileCount: files.length,
    domainCounts,
    files,
    summary: summarizeFiles(files),
  };
}

function recordsFor(payload, domain) {
  const records = payload?.records?.[domain];
  if (!Array.isArray(records)) return [];
  if (domain === "trainers") {
    return records.filter((record) => Number.isInteger(record?.id) && record.trdata && typeof record.trdata === "object" && record.trpok && typeof record.trpok === "object");
  }
  return records.filter((record) => Number.isInteger(record?.id) && record.raw && typeof record.raw === "object");
}

function addOutput(context, files, domain, id, text, dryRun) {
  const outputPath = outputPathFor(context, domain, id);
  const relativePath = path.relative(context.repoPath, outputPath);
  const file = {
    domain,
    id,
    path: relativePath,
    bytes: Buffer.byteLength(text),
  };
  files.push(file);
  if (!dryRun) fs.writeFileSync(outputPath, text);
}

function outputPathFor(context, domain, id) {
  const entries = context.manifests[domain];
  if (!entries) throw new Error(`Unsupported W2U sync domain: ${domain}`);
  const manifestEntry = entries[id];
  if (!manifestEntry) throw new Error(`W2U ${domain} manifest has no entry for record ${id}.`);

  if (domain === "moves") return safeRepoPath(context.repoPath, "data", "pml", "moves", manifestEntry);
  if (domain === "trainers") return safeRepoPath(context.repoPath, "data", "trainers", manifestEntry);
  return safeRepoPath(context.repoPath, "data", "pml", manifestEntry);
}

function safeRepoPath(repoPath, ...parts) {
  const target = path.resolve(repoPath, ...parts);
  const relative = path.relative(repoPath, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refusing to write outside W2U repo: ${target}`);
  return target;
}

function summarizeFiles(files) {
  if (files.length === 0) return "No W2U TOML files to sync.";
  const counts = files.reduce((result, file) => {
    const label = DOMAIN_LABELS[file.domain] ?? file.domain;
    result[label] = (result[label] ?? 0) + 1;
    return result;
  }, {});
  return Object.entries(counts)
    .map(([label, count]) => `${count} ${label}${count === 1 ? "" : "s"}`)
    .join(", ");
}

function serializePersonal(context, id, raw) {
  const section = enumLabel(context, "species", id);
  return renderSectionedToml(section, [
    ["Base HP", number(raw.base_hp)],
    ["Base Attack", number(raw.base_atk)],
    ["Base Defense", number(raw.base_def)],
    ["Base Speed", number(raw.base_speed)],
    ["Base Special Attack", number(raw.base_spatk)],
    ["Base Special Defense", number(raw.base_spdef)],
    ["Primary Type", enumLabel(context, "types", raw.type_1)],
    ["Secondary Type", enumLabel(context, "types", raw.type_2)],
    ["Capture Rate", number(raw.catchrate)],
    ["Evolution Stage", number(raw.stage)],
    ["EV Yield", number(raw.evs)],
    ["Wild Item (50%)", optionalEnumLabel(context, "items", raw.item_1)],
    ["Wild Item (5%)", optionalEnumLabel(context, "items", raw.item_2)],
    ["Wild Item (1%)", optionalEnumLabel(context, "items", raw.item_3)],
    ["Gender Probability", number(raw.gender)],
    ["Egg Happiness", number(raw.hatch_cycle)],
    ["Base Happiness", number(raw.base_happy)],
    ["Experience Group", number(raw.exp_rate)],
    ["Egg Group 1", number(raw.egg_group_1)],
    ["Egg Group 2", number(raw.egg_group_2)],
    ["Primary Ability", number(raw.ability_1)],
    ["Secondary Ability", number(raw.ability_2)],
    ["Hidden Ability", number(raw.ability_3)],
    ["Escape Rate", number(raw.flee)],
    ["Form Data Offset", number(raw.form_id)],
    ["Form Sprite Offset", number(raw.form)],
    ["Form Count", number(raw.num_forms)],
    ["Color", number(raw.color)],
    ["Base Experience", number(raw.base_exp)],
    ["Height (cm)", number(raw.height)],
    ["Weight (cg)", number(raw.weight)],
    ["TM HM 1", toS32(raw["tm_1-32"])],
    ["TM HM 2", toS32(raw["tm_33-64"])],
    ["TM HM 3", toS32(raw["tm_65-95+hm_1"])],
    ["TM HM 4", toS32(raw["hm_2-6"])],
    ["Type Tutors", toS32(number(raw.tutors) + number(raw.padding) * 256)],
    ["Special Tutors", [toS32(raw.driftveil_tutor), toS32(raw.lentimas_tutor), toS32(raw.humilau_tutor), toS32(raw.nacrene_tutor)]],
  ]);
}

function serializeLearnset(context, id, raw) {
  const section = enumLabel(context, "species", id);
  const lines = [`[${section}]`, ""];
  let entryIndex = 0;
  for (let index = 0; index < 32; index += 1) {
    const move = raw[`move_id_${index}`];
    const level = raw[`lvl_learned_${index}`];
    if (move === undefined || level === undefined) break;
    if (number(move) === 65535 && number(level) === 65535) break;
    if (number(move) === 0 && number(level) === 0) break;
    lines.push(`[${section}.LEARNSET_ENTRY_${entryIndex}]`);
    lines.push(`MOVE = ${tomlValue(enumLabel(context, "moves", move))}`);
    lines.push(`LEVEL = ${tomlValue(number(level))}`);
    lines.push("");
    entryIndex += 1;
  }
  lines.push(`[${section}.LEARNSET_END]`);
  lines.push("MOVE = 65535");
  lines.push("LEVEL = 65535");
  return `${lines.join("\n")}\n`;
}

function serializeEvolution(context, id, raw) {
  const section = enumLabel(context, "species", id);
  const lines = [`[${section}]`, ""];
  for (let index = 0; index < 8; index += 1) {
    lines.push(`[${section}.EVOLUTION_${index}]`);
    lines.push(`Method = ${tomlValue(enumLabel(context, "evolution_methods", raw[`method_${index}`] ?? 0))}`);
    lines.push(`Parameter = ${tomlValue(number(raw[`param_${index}`]))}`);
    lines.push(`"Target Species" = ${tomlValue(enumLabel(context, "species", raw[`target_${index}`] ?? 0))}`);
    if (index < 7) lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function serializeMove(context, id, raw) {
  const section = enumLabel(context, "moves", id);
  const hits = number(raw.hits);
  return renderSectionedToml(section, [
    ["Type", enumLabel(context, "types", raw.type)],
    ["Quality", enumLabel(context, "btl_eff", raw.effect_category)],
    ["Category", enumLabel(context, "pss", raw.category)],
    ["Power", number(raw.power)],
    ["Accuracy", number(raw.accuracy)],
    ["Base PP", number(raw.pp)],
    ["Priority", toS8(raw.priority)],
    ["Hit", `${hits & 0xf} | ${(hits >>> 4) & 0xf}`],
    ["Inflict Status", enumLabel(context, "status", raw.result_effect)],
    ["Inflict Chance", number(raw.effect_chance)],
    ["Inflict Duration", enumLabel(context, "btl_inflict", raw.status)],
    ["Turn (min)", number(raw.min_turns)],
    ["Turn (max)", number(raw.max_turns)],
    ["Critical Hit Stage", number(raw.crit)],
    ["Flinch Rate", number(raw.flinch)],
    ["Move Animation ID", number(raw.effect)],
    ["Recoil", toS8(raw.recoil)],
    ["Heal", toS8(raw.healing)],
    ["Target", enumLabel(context, "btl_target", raw.target)],
    ["Status Change Stats", [number(raw.stat_1), number(raw.stat_2), number(raw.stat_3)]],
    ["Status Change Stages", [toS8(raw.magnitude_1), toS8(raw.magnitude_2), toS8(raw.magnitude_3)]],
    ["Status Change Chances", [toS8(raw.stat_chance_1), toS8(raw.stat_chance_2), toS8(raw.stat_chance_3)]],
    ["Padding", number(raw.flag)],
    ["Flags", flagsValue(context, "move_flags", raw.properties)],
  ]);
}

function serializeTrainer(context, record) {
  const trdata = record.trdata;
  const trpok = record.trpok;
  if (!trdata || !trpok) throw new Error(`Trainer ${record.id} requires both trdata and trpok records.`);

  const hasMoves = (number(trdata.template) & 1) !== 0;
  const hasItems = (number(trdata.template) & 2) !== 0;
  const count = number(trdata.num_pokemon);
  const lines = [
    `CLASS = ${tomlValue(number(trdata.class))}`,
    `BATTLE_TYPE = ${tomlValue(number(trdata.battle_type_1))}`,
    `ITEMS = ${tomlValue([1, 2, 3, 4].map((slot) => optionalEnumLabel(context, "items", trdata[`item_${slot}`])))}`,
    `AI = ${tomlValue(number(trdata.ai))}`,
    `CAN_HEAL = ${tomlValue(number(trdata.heal))}`,
    `REWARD_MONEY = ${tomlValue(number(trdata.money))}`,
    `REWARD_ITEM = ${tomlValue(optionalEnumLabel(context, "items", trdata.reward_item))}`,
  ];

  for (let slot = 0; slot < count; slot += 1) {
    const abilityGender = normalizeAbilityGender(trpok[`ability_${slot}`]);
    lines.push("[[PARTY]]");
    lines.push(`SPECIES = ${tomlValue(enumLabel(context, "species", trpok[`species_id_${slot}`]))}`);
    lines.push(`LEVEL = ${tomlValue(number(trpok[`level_${slot}`]))}`);
    lines.push(`FORM = ${tomlValue(number(trpok[`form_${slot}`]))}`);
    lines.push(`GENDER = ${tomlValue(abilityGender.gender)}`);
    lines.push(`ABILITY = ${tomlValue(abilityGender.ability)}`);
    lines.push(`DIFFICULTY_VALUE = ${tomlValue(number(trpok[`ivs_${slot}`]))}`);
    if (hasItems) lines.push(`HELD_ITEM = ${tomlValue(optionalEnumLabel(context, "items", trpok[`item_id_${slot}`]))}`);
    if (hasMoves) {
      lines.push(`MOVES = ${tomlValue([1, 2, 3, 4].map((move) => enumLabel(context, "moves", trpok[`move_${move}_${slot}`] ?? 0)))}`);
    }
    if (slot < count - 1) lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function renderSectionedToml(section, fields) {
  return `${[`[${section}]`, ...fields.map(([key, value]) => `${tomlKey(key)} = ${tomlValue(value)}`)].join("\n")}\n`;
}

function enumLabel(context, enumName, value) {
  const numeric = number(value);
  return context.enums[enumName]?.get(numeric) ?? numeric;
}

function optionalEnumLabel(context, enumName, value) {
  const numeric = number(value);
  return numeric === 0 ? 0 : enumLabel(context, enumName, numeric);
}

function flagsValue(context, enumName, value) {
  let remaining = number(value);
  if (remaining === 0) return 0;
  const labels = [];
  const entries = [...(context.enums[enumName]?.entries() ?? [])].sort(([a], [b]) => a - b);
  for (const [flagValue, label] of entries) {
    if (flagValue > 0 && (remaining & flagValue) === flagValue) {
      labels.push(label);
      remaining &= ~flagValue;
    }
  }
  if (remaining !== 0) labels.push(String(remaining));
  return labels.length ? labels.join(" | ") : number(value);
}

function tomlKey(key) {
  return /^[A-Za-z0-9_-]+$/u.test(key) ? key : JSON.stringify(key);
}

function tomlValue(value) {
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(Number.isFinite(Number(value)) ? Number(value) : 0);
}

function normalizeAbilityGender(value) {
  const byte = number(value) === 255 ? 0 : number(value);
  return {
    ability: Math.floor(byte / 16),
    gender: byte & 0xf,
  };
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function toS8(value) {
  const byte = number(value) & 0xff;
  return byte > 0x7f ? byte - 0x100 : byte;
}

function toS32(value) {
  const uint = number(value) >>> 0;
  return uint > 0x7fffffff ? uint - 0x100000000 : uint;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000_000) reject(new Error("W2U sync payload is too large."));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function isLoopbackAddress(address) {
  return !address || address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
