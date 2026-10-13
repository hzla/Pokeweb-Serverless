import type { SourcePosition } from "./bw2ScriptCompiler";

export type Bw2ScriptSourcePart = "script" | "definitions";
export type Bw2ScriptSourceParts = { script: string; definitions: string };

/** Definitions displays the preamble and trailing movement declarations together.
 * Joining restores canonical source order. Older inline movements stay in
 * Script rather than moving across later code without placement metadata. */
export function splitBw2ScriptSource(source: string): Bw2ScriptSourceParts {
  const headers = [...source.matchAll(/^[\t ]*(script\s+:|def(?:\s|$)|block\s+:|movement\s+:)/gm)];
  const code = headers.find((header) => !header[1].startsWith("movement"));
  const first = headers[0];
  if (code && first) {
    const lastCode = headers.filter((header) => !header[1].startsWith("movement")).at(-1)!;
    const tail = headers.find((header) => header[1].startsWith("movement") && header.index! > lastCode.index!);
    return { definitions: source.slice(0, first.index) + (tail ? source.slice(tail.index) : ""), script: source.slice(first.index, tail?.index) };
  }
  if (first) return { definitions: source, script: "" };
  const hasDefinitions = /^[\t ]*(?:work\s+:|[A-Z][A-Z_0-9]*\s*=|preserve_layout\b|condition_encoding\b|movement_alignment\b|overlay\b|entry\s+\d|data\s+:)/m.test(source);
  return hasDefinitions ? { definitions: source, script: "" } : { definitions: "", script: source };
}

function segments(parts: Bw2ScriptSourceParts): { header: string; script: string; tail: string } {
  const movement = /^[\t ]*movement\s+:/m.exec(parts.definitions);
  const header = parts.definitions.slice(0, movement?.index), tail = movement ? parts.definitions.slice(movement.index) : "";
  const separate = (text: string, next: string) => text + (text && next && !text.endsWith("\n") ? "\n" : "");
  return { header: separate(header, parts.script), script: separate(parts.script, tail), tail };
}
const lineBreaks = (text: string): number => (text.match(/\n/g) ?? []).length;
export function joinBw2ScriptSource(parts: Bw2ScriptSourceParts): string {
  if (!parts.script) return parts.definitions;
  const { header, script, tail } = segments(parts); return header + script + tail;
}
export function bw2ScriptPreambleLines(parts: Bw2ScriptSourceParts): number { return lineBreaks(segments(parts).header); }

export function bw2ScriptPartPosition(parts: Bw2ScriptSourceParts, position: SourcePosition): { part: Bw2ScriptSourcePart; position: SourcePosition } {
  if (!parts.script) return { part: "definitions", position };
  const { header, script, tail } = segments(parts), before = lineBreaks(header), code = lineBreaks(script);
  if (position.line <= before) return { part: "definitions", position };
  if (tail && position.line > before + code) return { part: "definitions", position: { ...position, line: position.line - code } };
  return { part: "script", position: { ...position, line: position.line - before } };
}

export function bw2ScriptFullPosition(parts: Bw2ScriptSourceParts, part: Bw2ScriptSourcePart, position: SourcePosition): SourcePosition {
  if (!parts.script) return position;
  const { header, script, tail } = segments(parts), before = lineBreaks(header);
  const delta = part === "script" ? before : tail && position.line > before ? lineBreaks(script) : 0;
  return { ...position, line: position.line + delta };
}
