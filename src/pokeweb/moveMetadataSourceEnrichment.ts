export type MoveMetadata = Record<string, unknown>;

export type MoveMetadataEnrichmentResult = {
  source: string;
  modifiedMoves: string[];
  unchangedMoves: string[];
  unmatchedMoves: string[];
};

type JsonRange = {
  start: number;
  end: number;
};

type ObjectEntryRange = JsonRange & {
  key: string;
  keyStart: number;
};

const MANAGED_FIELDS = ["critRatio", "willCrit", "recoil", "drain", "heal"] as const;

export function enrichMoveMetadataSource(
  source: string,
  metadataByMove: Record<string, MoveMetadata>,
  moveNumbersByName: Record<string, number> = {},
): MoveMetadataEnrichmentResult {
  const rootStart = source.indexOf("{");
  if (rootStart < 0) throw new Error("Data source does not contain a root object.");

  const rootEntries = objectEntryRanges(source, rootStart);
  const movesEntry = rootEntries.find((entry) => entry.key === "moves");
  if (!movesEntry || source[movesEntry.start] !== "{") {
    throw new Error("Data source does not contain a top-level moves object.");
  }

  const sourceMoves = objectEntryRanges(source, movesEntry.start);
  const sourceMovesById = new Map<string, ObjectEntryRange>();
  const sourceMovesByNumber = new Map<number, ObjectEntryRange>();
  for (const [index, entry] of sourceMoves.entries()) {
    const id = moveId(entry.key);
    if (sourceMovesById.has(id)) throw new Error(`Duplicate normalized move id in source: ${id}`);
    sourceMovesById.set(id, entry);
    const value = JSON.parse(source.slice(entry.start, entry.end)) as Record<string, unknown>;
    const explicitNumber = Number(value.num);
    const moveNumber = Number.isInteger(explicitNumber) ? explicitNumber : index;
    if (!sourceMovesByNumber.has(moveNumber)) sourceMovesByNumber.set(moveNumber, entry);
  }
  const replacementSourcesByTarget = moveReplacementSources(source, rootEntries);

  const replacements: Array<JsonRange & { text: string }> = [];
  const modifiedMoves: string[] = [];
  const unchangedMoves: string[] = [];
  const unmatchedMoves: string[] = [];

  for (const [metadataName, metadata] of Object.entries(metadataByMove)) {
    const metadataId = moveId(metadataName);
    const replacementSourceId = replacementSourcesByTarget.get(metadataId);
    const moveNumber = moveNumbersByName[metadataName];
    const entry =
      sourceMovesById.get(metadataId) ??
      (replacementSourceId ? sourceMovesById.get(replacementSourceId) : undefined) ??
      (Number.isInteger(moveNumber) ? sourceMovesByNumber.get(moveNumber) : undefined);
    if (!entry) {
      unmatchedMoves.push(metadataName);
      continue;
    }

    const current = JSON.parse(source.slice(entry.start, entry.end)) as Record<string, unknown>;
    const updated = applyMoveMetadata(current, metadata);
    if (managedFieldsEqual(current, updated)) {
      unchangedMoves.push(entry.key);
      continue;
    }

    replacements.push({
      start: entry.start,
      end: entry.end,
      text: formatObjectForEntry(source, entry, updated),
    });
    modifiedMoves.push(entry.key);
  }

  replacements.sort((left, right) => right.start - left.start);
  let enriched = source;
  for (const replacement of replacements) {
    enriched = enriched.slice(0, replacement.start) + replacement.text + enriched.slice(replacement.end);
  }

  return {
    source: enriched,
    modifiedMoves,
    unchangedMoves,
    unmatchedMoves,
  };
}

function moveReplacementSources(source: string, rootEntries: ObjectEntryRange[]): Map<string, string> {
  const replacementsEntry = rootEntries.find((entry) => entry.key === "move_replacements");
  if (!replacementsEntry || source[replacementsEntry.start] !== "{") return new Map();

  const out = new Map<string, string>();
  for (const entry of objectEntryRanges(source, replacementsEntry.start)) {
    const replacement = JSON.parse(source.slice(entry.start, entry.end));
    if (typeof replacement !== "string") continue;
    const targetId = moveId(replacement);
    if (!out.has(targetId)) out.set(targetId, moveId(entry.key));
  }
  return out;
}

function applyMoveMetadata(current: Record<string, unknown>, metadata: MoveMetadata): Record<string, unknown> {
  const updated = { ...current };

  if (Object.hasOwn(metadata, "critRatio")) {
    updated.critRatio = metadata.critRatio;
    if (metadata.willCrit === true) updated.willCrit = true;
    else delete updated.willCrit;
  }

  if (Object.hasOwn(metadata, "recoil")) {
    updated.recoil = metadata.recoil;
    delete updated.drain;
  } else if (Object.hasOwn(metadata, "drain")) {
    updated.drain = metadata.drain;
    delete updated.recoil;
  }

  if (Object.hasOwn(metadata, "heal")) updated.heal = metadata.heal;
  return updated;
}

function managedFieldsEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return MANAGED_FIELDS.every((field) => JSON.stringify(left[field]) === JSON.stringify(right[field]));
}

function formatObjectForEntry(source: string, entry: ObjectEntryRange, value: Record<string, unknown>): string {
  const lineStart = source.lastIndexOf("\n", entry.keyStart - 1) + 1;
  const indent = source.slice(lineStart, entry.keyStart);
  return JSON.stringify(value, null, 2)
    .split("\n")
    .map((line, index) => (index === 0 ? line : indent + line))
    .join("\n");
}

function objectEntryRanges(source: string, objectStart: number): ObjectEntryRange[] {
  if (source[objectStart] !== "{") throw new Error(`Expected object at offset ${objectStart}.`);
  const entries: ObjectEntryRange[] = [];
  let cursor = objectStart + 1;

  while (cursor < source.length) {
    cursor = skipWhitespaceAndCommas(source, cursor);
    if (source[cursor] === "}") return entries;
    if (source[cursor] !== '"') throw new Error(`Expected object key at offset ${cursor}.`);

    const keyStart = cursor;
    const keyEnd = scanString(source, cursor);
    const key = JSON.parse(source.slice(keyStart, keyEnd)) as string;
    cursor = skipWhitespace(source, keyEnd);
    if (source[cursor] !== ":") throw new Error(`Expected colon after ${key} at offset ${cursor}.`);
    cursor = skipWhitespace(source, cursor + 1);
    const start = cursor;
    const end = scanValue(source, start);
    entries.push({ key, keyStart, start, end });
    cursor = end;
  }

  throw new Error(`Unterminated object at offset ${objectStart}.`);
}

function scanValue(source: string, start: number): number {
  const first = source[start];
  if (first === '"') return scanString(source, start);
  if (first !== "{" && first !== "[") {
    let cursor = start;
    while (cursor < source.length && !/[\s,}\]]/u.test(source[cursor] ?? "")) cursor += 1;
    return cursor;
  }

  const stack = [first];
  let cursor = start + 1;
  while (cursor < source.length && stack.length > 0) {
    const char = source[cursor];
    if (char === '"') {
      cursor = scanString(source, cursor);
      continue;
    }
    if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") stack.pop();
    cursor += 1;
  }
  if (stack.length > 0) throw new Error(`Unterminated value at offset ${start}.`);
  return cursor;
}

function scanString(source: string, start: number): number {
  let escaped = false;
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === '"') return cursor + 1;
  }
  throw new Error(`Unterminated string at offset ${start}.`);
}

function skipWhitespace(source: string, start: number): number {
  let cursor = start;
  while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function skipWhitespaceAndCommas(source: string, start: number): number {
  let cursor = start;
  while (source[cursor] === "," || /\s/u.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function moveId(name: string): string {
  return name.toLowerCase().replace(/é/gu, "e").replace(/[^a-z0-9]+/gu, "");
}
