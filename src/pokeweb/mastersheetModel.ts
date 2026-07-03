import { getEncounterCount, getEncounterRecord } from "./encounterModel";
import {
  enrichTrainerLocations,
  ensureDocs,
  formatTrainerMoveName,
  safeFilename,
  trainerPokemonExportAbility,
  trainerPokemonExportName,
  type TextDownloadFile,
} from "./docGeneratorModel";
import type { ProjectState } from "./projectStore";
import { getAutofilledTrainerPokemonMoveIds, getTrainerCount, getTrainerRecord, type TrainerPokemonSlot, type TrainerRecord } from "./trainerModel";

export type MastersheetInlinePart = { type: "text"; text: string } | { type: "link"; text: string; href: string };

export type MastersheetElement = Record<string, unknown> & {
  tag: "h1" | "h2" | "h3" | "h4" | "p" | "li" | "br" | "trainer" | "encounter" | "gifts" | "items" | "notif";
};

export type MastersheetWarning = {
  line: number;
  message: string;
  blocking: boolean;
};

export type MastersheetParseResult = {
  masterData: MastersheetElement[];
  warnings: MastersheetWarning[];
  trainerPointers: Record<string, { id: number; prev?: number; next?: number }>;
};

export type MastersheetTrainerRecord = Record<string, unknown> | null;
export type MastersheetEncounterRecord = { id: number; name: string; wilds: string[]; locations: string[] } | null;

export type MastersheetExport = MastersheetParseResult & {
  encountersById: MastersheetEncounterRecord[];
  trainersById: MastersheetTrainerRecord[];
};

type BlockListParseResult = {
  description: string;
  names: string[];
  descriptions: Array<string | null>;
  endIndex: number;
  ended: boolean;
};

export function ensureMastersheetMarkdown(project: ProjectState): string {
  const docs = ensureDocs(project);
  docs.mastersheetMarkdown ??= `# ${docs.romTitle || project.session.romName}\n\n`;
  return docs.mastersheetMarkdown;
}

export function setMastersheetMarkdown(project: ProjectState, markdown: string): void {
  ensureDocs(project).mastersheetMarkdown = markdown;
}

export function enrichMastersheetTrainerLocations(project: ProjectState): string {
  if (!project.narcs.headers || !project.narcs.overworlds) return "";
  const result = enrichTrainerLocations(project);
  return result.message;
}

export function parseMastersheetMarkdown(markdown: string, project?: ProjectState): MastersheetParseResult {
  const source = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const masterData: MastersheetElement[] = [];
  const warnings: MastersheetWarning[] = [];
  const trainerLinks: Array<{ id: number; prev?: number; next?: number }> = [];
  let previousTrainerId: number | undefined;
  let previousTrainerIndex: number | undefined;

  let index = 0;
  while (index < source.length) {
    const lineNumber = index + 1;
    const rawLine = source[index] ?? "";
    const line = rawLine.replace(/\t/gu, "  ").trimEnd();
    const stripped = line.trim();

    if (stripped === "") {
      masterData.push({ tag: "p", content: "", content_parts: [{ type: "text", text: "" }] });
      index += 1;
      continue;
    }

    if (stripped.toLowerCase() === "<br>") {
      masterData.push({ tag: "br" });
      index += 1;
      continue;
    }

    if (stripped.startsWith("!gifts")) {
      const title = stripped.slice("!gifts".length).trim();
      const block = parseBlockList(source, index + 1);
      if (!block.ended) warnings.push({ line: lineNumber, message: `!gifts "${title || "(untitled)"}" is missing an end line.`, blocking: false });
      masterData.push({
        tag: "gifts",
        giftsTitle: title,
        giftsDescription: block.description,
        giftPokemonList: block.names,
        giftPokemonDescriptions: block.descriptions,
      });
      index = block.ended ? block.endIndex + 1 : block.endIndex;
      continue;
    }

    if (stripped.startsWith("!items")) {
      const title = stripped.slice("!items".length).trim();
      const block = parseBlockList(source, index + 1);
      if (!block.ended) warnings.push({ line: lineNumber, message: `!items "${title || "(untitled)"}" is missing an end line.`, blocking: false });
      masterData.push({
        tag: "items",
        itemsTitle: title,
        itemsDescription: block.description,
        itemList: block.names,
        itemDescriptions: block.descriptions,
      });
      index = block.ended ? block.endIndex + 1 : block.endIndex;
      continue;
    }

    if (stripped.startsWith("!notif")) {
      const payload = stripped.slice("!notif".length).trim();
      const parts = payload.split(",").map((part) => part.trim());
      const title = parts[0] ?? "";
      const last = parts.at(-1);
      const hasColor = parts.length >= 3 && isColorToken(last);
      const textParts = hasColor ? parts.slice(1, -1) : parts.slice(1);
      const element: MastersheetElement = {
        tag: "notif",
        notificationTitle: title,
        text: textParts.join(",").trim(),
      };
      if (hasColor && last) element.fontColor = last;
      masterData.push(element);
      index += 1;
      continue;
    }

    if (line.startsWith("####")) {
      pushInlineElement(masterData, "h4", line.slice(5));
    } else if (line.startsWith("###")) {
      pushInlineElement(masterData, "h3", line.slice(4));
    } else if (line.startsWith("##")) {
      pushInlineElement(masterData, "h2", line.slice(3));
    } else if (line.startsWith("#")) {
      pushInlineElement(masterData, "h1", line.slice(2));
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      pushInlineElement(masterData, "li", line.slice(2));
    } else if (line.startsWith("!tr")) {
      const trainerElement = parseTrainerElement(line, lineNumber, project, warnings);
      const trainerId = Number(trainerElement.id ?? 0);
      const trainerLink: { id: number; prev?: number; next?: number } = { id: trainerId, prev: previousTrainerId };
      if (previousTrainerIndex !== undefined) trainerLinks[previousTrainerIndex].next = trainerId;
      previousTrainerId = trainerId;
      previousTrainerIndex = trainerLinks.length;
      trainerLinks.push(trainerLink);
      masterData.push(trainerElement);
    } else if (line.startsWith("!enc")) {
      masterData.push(parseEncounterElement(line, lineNumber, project, warnings));
    } else {
      const chunks = splitWithLineBreaks(line);
      if (chunks.length > 1) {
        chunks.forEach((chunk, chunkIndex) => {
          const content = chunk.trim();
          if (content === "") return;
          pushInlineElement(masterData, "p", content);
          if (chunkIndex < chunks.length - 1) masterData.push({ tag: "br" });
        });
      } else {
        pushInlineElement(masterData, "p", line);
      }
    }

    index += 1;
  }

  const trainerPointers: Record<string, { id: number; prev?: number; next?: number }> = {};
  trainerLinks.forEach((trainer) => {
    trainerPointers[String(trainer.id)] = trainer;
  });

  return { masterData, warnings, trainerPointers };
}

export function buildMastersheetExport(project: ProjectState, markdown = ensureMastersheetMarkdown(project)): MastersheetExport {
  const parsed = parseMastersheetMarkdown(markdown, project);
  return {
    ...parsed,
    encountersById: buildMastersheetEncountersById(project),
    trainersById: buildMastersheetTrainersById(project),
  };
}

export function generateMastersheetDownload(project: ProjectState): TextDownloadFile {
  const docs = ensureDocs(project);
  const exportData = buildMastersheetExport(project, ensureMastersheetMarkdown(project));
  const blockingWarnings = exportData.warnings.filter((warning) => warning.blocking);
  if (blockingWarnings.length > 0) throw new Error(blockingWarnings.map((warning) => `Line ${warning.line}: ${warning.message}`).join("\n"));

  const title = docs.romTitle.trim() || project.session.romName;
  const contents = [
    `masterData = ${JSON.stringify(exportData.masterData, null, 2)};`,
    `encountersById = ${JSON.stringify(exportData.encountersById, null, 2)};`,
    `trainersById = ${JSON.stringify(exportData.trainersById, null, 2)};`,
    "",
  ].join("\n");
  return {
    filename: `${safeFilename(title)}.js`,
    contents,
    mimeType: "text/javascript",
  };
}

export function mastersheetMarkdownFromLegacyJs(source: string): string {
  return mastersheetMarkdownFromMasterData(readJsonAssignment(source, "masterData"));
}

export function mastersheetMarkdownFromMasterData(masterData: unknown): string {
  if (!Array.isArray(masterData)) throw new Error("Imported JS must contain a masterData array.");
  const lines = masterData.map((element) => mastersheetElementToMarkdown(element));
  return `${lines.join("\n").replace(/\s+$/u, "")}\n`;
}

function pushInlineElement(masterData: MastersheetElement[], tag: "h1" | "h2" | "h3" | "h4" | "p" | "li", content: string): void {
  masterData.push({ tag, content, content_parts: parseInline(content) });
}

function mastersheetElementToMarkdown(value: unknown): string {
  if (!isRecord(value)) return "";

  switch (value.tag) {
    case "h1":
      return `# ${inlineMarkdownFromElement(value)}`;
    case "h2":
      return `## ${inlineMarkdownFromElement(value)}`;
    case "h3":
      return `### ${inlineMarkdownFromElement(value)}`;
    case "h4":
      return `#### ${inlineMarkdownFromElement(value)}`;
    case "li":
      return `- ${inlineMarkdownFromElement(value)}`;
    case "p":
      return inlineMarkdownFromElement(value);
    case "br":
      return "<br>";
    case "trainer": {
      const command = String(value.class ?? "")
        .split(/\s+/u)
        .includes("mand")
        ? "!trm"
        : "!tr";
      const notes = trainerNotesMarkdown(value);
      return `${command} ${String(value.id ?? 0)}${notes ? ` ${notes}` : ""}`;
    }
    case "encounter":
      return `!enc ${String(value.id ?? 0)}`;
    case "items":
      return blockListToMarkdown("!items", value.itemsTitle, value.itemsDescription, value.itemList, value.itemDescriptions);
    case "gifts":
      return blockListToMarkdown("!gifts", value.giftsTitle, value.giftsDescription, value.giftPokemonList, value.giftPokemonDescriptions);
    case "notif": {
      const parts = [String(value.notificationTitle ?? "").trim(), String(value.text ?? "").trim()].filter((part) => part !== "");
      const color = String(value.fontColor ?? "").trim();
      if (color) parts.push(color);
      return `!notif ${parts.join(", ")}`;
    }
    default:
      return inlineMarkdownFromElement(value);
  }
}

function blockListToMarkdown(command: "!items" | "!gifts", title: unknown, description: unknown, namesValue: unknown, descriptionsValue: unknown): string {
  const lines = [`${command}${String(title ?? "").trim() ? ` ${String(title ?? "").trim()}` : ""}`];
  const desc = String(description ?? "").trim();
  if (desc) lines.push(`desc: ${desc}`);

  const names = Array.isArray(namesValue) ? namesValue : [];
  const descriptions = Array.isArray(descriptionsValue) ? descriptionsValue : [];
  names.forEach((nameValue, index) => {
    const name = String(nameValue ?? "").trim();
    if (!name) return;
    const itemDescription = descriptions[index] == null ? "" : String(descriptions[index]).trim();
    lines.push(itemDescription ? `${name}, ${itemDescription}` : name);
  });
  lines.push("end");
  return lines.join("\n");
}

function trainerNotesMarkdown(value: Record<string, unknown>): string {
  if (Array.isArray(value.notes_parts)) return inlinePartsToMarkdown(value.notes_parts).trim();
  if (Array.isArray(value.notes)) return value.notes.map((note) => String(note ?? "")).join(" ").trim();
  return String(value.notes ?? "").trim();
}

function inlineMarkdownFromElement(value: Record<string, unknown>): string {
  const parts = value.content_parts;
  if (Array.isArray(parts)) return inlinePartsToMarkdown(parts);
  if (isRecord(parts)) return inlinePartsToMarkdown([parts]);
  return String(value.content ?? "");
}

function inlinePartsToMarkdown(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (!isRecord(part)) return "";
      if (part.type === "link") return `[${String(part.text ?? part.href ?? "")}](${String(part.href ?? "")})`;
      return String(part.text ?? "");
    })
    .join("");
}

function readJsonAssignment(source: string, name: string): unknown {
  const pattern = new RegExp(`(?:^|[;\\n])\\s*(?:var\\s+|let\\s+|const\\s+)?${escapeRegExp(name)}\\s*=`, "u");
  const match = pattern.exec(source);
  if (!match) throw new Error(`Imported JS must contain a ${name} assignment.`);

  let valueStart = source.indexOf("=", match.index) + 1;
  while (valueStart < source.length && /\s/u.test(source[valueStart] ?? "")) valueStart += 1;
  if (source[valueStart] !== "[" && source[valueStart] !== "{") throw new Error(`${name} must be a JSON array or object assignment.`);

  const valueEnd = findJsonValueEnd(source, valueStart);
  try {
    return JSON.parse(source.slice(valueStart, valueEnd));
  } catch (error) {
    throw new Error(`Could not parse ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function findJsonValueEnd(source: string, startIndex: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "[") {
      stack.push("]");
    } else if (char === "{") {
      stack.push("}");
    } else if (char === "]" || char === "}") {
      const expected = stack.pop();
      if (char !== expected) throw new Error("Imported JS contains mismatched JSON brackets.");
      if (stack.length === 0) return index + 1;
    }
  }

  throw new Error("Imported JS ended before the masterData JSON value was complete.");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTrainerElement(
  line: string,
  lineNumber: number,
  project: ProjectState | undefined,
  warnings: MastersheetWarning[],
): MastersheetElement {
  const tokens = line.trim().split(/\s+/u);
  const token = tokens[1] ?? "";
  const notes = tokens.slice(2);
  const element: MastersheetElement = { tag: "trainer", id: 0 };
  if (line.startsWith("!trm")) element.class = "mand";
  if (notes.length > 0) {
    element.notes = notes;
    element.notes_parts = parseInline(notes.join(" "));
  }

  const id = resolveTrainerReference(token, project);
  element.id = id ?? 0;
  if (id === undefined) {
    warnings.push({ line: lineNumber, message: `Unable to resolve trainer reference "${token || "(missing)"}".`, blocking: true });
  }
  return element;
}

function parseEncounterElement(
  line: string,
  lineNumber: number,
  project: ProjectState | undefined,
  warnings: MastersheetWarning[],
): MastersheetElement {
  const token = line.slice(5).trim();
  const id = resolveEncounterReference(token, project);
  if (id === undefined) {
    warnings.push({ line: lineNumber, message: `Unable to resolve encounter reference "${token || "(missing)"}".`, blocking: true });
  }
  return { tag: "encounter", id: id ?? 0 };
}

function resolveTrainerReference(token: string, project: ProjectState | undefined): number | undefined {
  if (!token) return undefined;
  if (/^\d+$/u.test(token)) {
    const id = Number(token);
    return trainerExists(project, id) ? id : undefined;
  }
  const numericHintMatch = token.match(/^(\d+)\/\d+$/u);
  if (numericHintMatch) {
    const id = Number(numericHintMatch[1]);
    return trainerExists(project, id) ? id : undefined;
  }
  if (!project) return undefined;

  const [trainerName = "", pokemonOrLevel = "", levelText = ""] = token.split("/");
  const monLevel = /^\d+$/u.test(pokemonOrLevel) ? Number(pokemonOrLevel) : Number(levelText);
  const monName = /^\d+$/u.test(pokemonOrLevel) ? "" : pokemonOrLevel;
  const normalizedTrainer = normalizeLookup(trainerName);
  const normalizedMon = normalizeLookup(monName);

  for (let id = 0; id < getTrainerCount(project); id += 1) {
    const trainer = safeTrainerRecord(project, id);
    if (!trainer) continue;
    const displayName = `${trainer.readable.class ?? ""} ${trainer.readable.name ?? ""}`;
    const nameMatches = [trainer.readable.name, displayName].some((value) => normalizeLookup(String(value ?? "")).includes(normalizedTrainer));
    if (!nameMatches) continue;
    if (normalizedMon && !trainer.party.some((pok) => normalizeLookup(pok.speciesName) === normalizedMon)) continue;
    if (Number.isFinite(monLevel) && monLevel > 0 && !trainer.party.some((pok) => pok.level === monLevel)) continue;
    return id;
  }
  return undefined;
}

function resolveEncounterReference(token: string, project: ProjectState | undefined): number | undefined {
  if (!token) return undefined;
  if (/^\d+$/u.test(token)) {
    const id = Number(token);
    return encounterExists(project, id) ? id : undefined;
  }
  if (!project) return undefined;

  const normalizedToken = normalizeLookup(token);
  for (let id = 0; id < getEncounterCount(project); id += 1) {
    const encounter = safeEncounterRecord(project, id);
    if (!encounter) continue;
    if (encounter.locations.some((location) => normalizeLookup(location.replace(/\s*\(\d+\)\s*$/u, "")) === normalizedToken)) return id;
  }
  return undefined;
}

function trainerExists(project: ProjectState | undefined, id: number): boolean {
  return Boolean(project && id >= 0 && id < getTrainerCount(project) && safeTrainerRecord(project, id));
}

function encounterExists(project: ProjectState | undefined, id: number): boolean {
  return Boolean(project && id >= 0 && id < getEncounterCount(project) && safeEncounterRecord(project, id));
}

function safeTrainerRecord(project: ProjectState, id: number): TrainerRecord | undefined {
  try {
    return getTrainerRecord(project, id);
  } catch {
    return undefined;
  }
}

function safeEncounterRecord(project: ProjectState, id: number): ReturnType<typeof getEncounterRecord> | undefined {
  try {
    return getEncounterRecord(project, id);
  } catch {
    return undefined;
  }
}

function buildMastersheetTrainersById(project: ProjectState): MastersheetTrainerRecord[] {
  const trainers: MastersheetTrainerRecord[] = [];
  for (let trainerId = 0; trainerId < getTrainerCount(project); trainerId += 1) {
    const trainer = safeTrainerRecord(project, trainerId);
    trainers[trainerId] = trainer ? buildMastersheetTrainer(project, trainer) : null;
  }
  return trainers;
}

function buildMastersheetTrainer(project: ProjectState, trainer: TrainerRecord): Record<string, unknown> {
  const trainerClass = String(trainer.readable.class ?? "");
  const trainerName = trainerNameWithLocation(project, trainer);
  const out: Record<string, unknown> = {
    class: trainerClass,
    name: trainerName,
    count: trainer.party.length,
    type: normalizeBattleType(trainer.readable.battle_type_1),
    tr_sprite: trainerSpriteFragment(trainerClass),
  };

  for (const pok of trainer.party) {
    const slot = pok.slot;
    const moves = trainerPokemonMoves(project, trainer, pok);
    out[`species_id_${slot}`] = trainerPokemonExportName(project, pok);
    out[`raw_species_id_${slot}`] = pok.speciesId;
    out[`level_${slot}`] = pok.level;
    out[`item_id_${slot}`] = pok.itemName ?? (trainer.hasItems ? "None" : "");
    out[`nature_${slot}`] = pok.nature;
    out[`ability_name_${slot}`] = trainerPokemonExportAbility(project, pok);
    for (let moveIndex = 1; moveIndex <= 4; moveIndex += 1) {
      out[`move_${moveIndex}_${slot}`] = formatTrainerMoveName(moves[moveIndex - 1] ?? "");
    }
  }
  return out;
}

function trainerPokemonMoves(project: ProjectState, trainer: TrainerRecord, pok: TrainerPokemonSlot): Array<string | number> {
  const explicitMoves = pok.moves.filter((move) => Number(move) !== 0 && String(move).trim() !== "" && String(move) !== "0");
  if (explicitMoves.length > 0) return pok.moves;
  try {
    return getAutofilledTrainerPokemonMoveIds(project, pok.speciesId, pok.level).map((moveId) => project.texts.banks.moves?.[moveId] ?? moveId);
  } catch {
    return trainer.hasMoves ? pok.moves : [];
  }
}

function buildMastersheetEncountersById(project: ProjectState): MastersheetEncounterRecord[] {
  const encounters: MastersheetEncounterRecord[] = [];
  for (let id = 0; id < getEncounterCount(project); id += 1) {
    const encounter = safeEncounterRecord(project, id);
    encounters[id] = encounter
      ? {
          id,
          name: encounterName(encounter, id),
          wilds: encounter.wilds,
          locations: encounter.locations,
        }
      : null;
  }
  return encounters;
}

function trainerNameWithLocation(project: ProjectState, trainer: TrainerRecord): string {
  const baseName = String(trainer.readable.name ?? "").trim() || `Trainer ${trainer.id}`;
  const location = ensureDocs(project).trainerLocations[String(trainer.id)]?.[0];
  return location ? `${baseName} - ${location}` : baseName;
}

function encounterName(encounter: ReturnType<typeof getEncounterRecord>, fallbackId: number): string {
  const location = encounter.locations[0]?.replace(/\s*\(\d+\)\s*$/u, "").trim();
  return location || `Location ${fallbackId}`;
}

function normalizeBattleType(value: unknown): string {
  const text = String(value ?? "");
  if (/triple/iu.test(text)) return "Triples";
  if (/double/iu.test(text)) return "Doubles";
  return "Singles";
}

function trainerSpriteFragment(trainerClass: string): string {
  const classSlug = trainerClass
    .toLowerCase()
    .replace(/pkmn/gu, "pokemon")
    .replace(/\s+/gu, "_")
    .replace(/[^a-z0-9_]/gu, "")
    .replace(/__+/gu, "_");
  return `trainer_sprites/${classSlug || "unknown"}.png`;
}

function parseInline(text: string): MastersheetInlinePart[] {
  const parts: MastersheetInlinePart[] = [];
  let index = 0;

  while (index < text.length) {
    if (text[index] === "[") {
      const closeBracket = text.indexOf("]", index);
      if (closeBracket >= 0 && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen >= 0) {
          parts.push({
            type: "link",
            text: text.slice(index + 1, closeBracket),
            href: text.slice(closeBracket + 2, closeParen),
          });
          index = closeParen + 1;
          continue;
        }
      }
      parts.push({ type: "text", text: "[" });
      index += 1;
      continue;
    }

    if (text.startsWith("http://", index) || text.startsWith("https://", index)) {
      let end = index;
      while (end < text.length && !/\s/u.test(text[end] ?? "")) end += 1;
      const url = text.slice(index, end);
      parts.push({ type: "link", text: url, href: url });
      index = end;
      continue;
    }

    const nextBracket = text.indexOf("[", index);
    const nextHttp = text.indexOf("http://", index);
    const nextHttps = text.indexOf("https://", index);
    const nextSpecial = [nextBracket, nextHttp, nextHttps].filter((value) => value >= 0).sort((a, b) => a - b)[0];
    if (nextSpecial !== undefined) {
      if (nextSpecial > index) parts.push({ type: "text", text: text.slice(index, nextSpecial) });
      index = nextSpecial;
    } else {
      parts.push({ type: "text", text: text.slice(index) });
      break;
    }
  }

  return mergeTextParts(parts);
}

function mergeTextParts(parts: MastersheetInlinePart[]): MastersheetInlinePart[] {
  const merged: MastersheetInlinePart[] = [];
  for (const part of parts) {
    const previous = merged.at(-1);
    if (part.type === "text" && previous?.type === "text") {
      previous.text += part.text;
    } else {
      merged.push(part);
    }
  }
  return merged;
}

function splitWithLineBreaks(text: string): string[] {
  return text.split(/\s*<br>\s*/iu);
}

function parseBlockList(source: string[], startIndex: number): BlockListParseResult {
  const names: string[] = [];
  const descriptions: Array<string | null> = [];
  let description = "";
  let index = startIndex;

  while (index < source.length) {
    const line = String(source[index] ?? "").trim();
    if (line.toLowerCase() === "end") return { description, names, descriptions, endIndex: index, ended: true };
    if (line !== "") {
      const descMatch = line.match(/^(desc|description)\s*:\s*/iu);
      if (descMatch) {
        description = line.replace(/^(desc|description)\s*:\s*/iu, "").trim();
      } else {
        const commaIndex = line.indexOf(",");
        const name = commaIndex >= 0 ? line.slice(0, commaIndex).trim() : line;
        const rest = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : "";
        names.push(name);
        descriptions.push(rest && rest !== "" ? rest : null);
      }
    }
    index += 1;
  }

  return { description, names, descriptions, endIndex: index, ended: false };
}

function isColorToken(value: string | undefined): boolean {
  if (!value) return false;
  const text = value.trim();
  return (
    /^#[0-9a-f]{3}$/iu.test(text) ||
    /^#[0-9a-f]{6}$/iu.test(text) ||
    /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/iu.test(text) ||
    /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0(\.\d+)?|1(\.0+)?)\s*\)$/iu.test(text) ||
    /^[a-z]+$/iu.test(text)
  );
}

function normalizeLookup(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}
