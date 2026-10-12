import type { SourcePosition } from "./bw2ScriptCompiler";

export type Bw2ScriptSourcePart = "script" | "definitions";
export type Bw2ScriptSourceParts = { script: string; definitions: string };

/** Keep physical code/data order and original text when separating the preamble. */
export function splitBw2ScriptSource(source: string): Bw2ScriptSourceParts {
  const code = /^[\t ]*(?:script\s+:|def(?:\s|$)|block\s+:)/m.exec(source);
  if (code) return { definitions: source.slice(0, code.index), script: source.slice(code.index) };
  const hasDefinitions = /^[\t ]*(?:work\s+:|[A-Z][A-Z_0-9]*\s*=|preserve_layout\b|condition_encoding\b|overlay\b|entry\s+\d|data\s+:)/m.test(source);
  return hasDefinitions ? { definitions: source, script: "" } : { definitions: "", script: source };
}

function preamble(parts: Bw2ScriptSourceParts): string {
  return parts.definitions + (parts.definitions && !parts.definitions.endsWith("\n") ? "\n" : "");
}
export function joinBw2ScriptSource(parts: Bw2ScriptSourceParts): string { return parts.script ? preamble(parts) + parts.script : parts.definitions; }
export function bw2ScriptPreambleLines(parts: Bw2ScriptSourceParts): number { return (preamble(parts).match(/\n/g) ?? []).length; }

export function bw2ScriptPartPosition(parts: Bw2ScriptSourceParts, position: SourcePosition): { part: Bw2ScriptSourcePart; position: SourcePosition } {
  const lines = bw2ScriptPreambleLines(parts);
  return position.line <= lines
    ? { part: "definitions", position }
    : { part: "script", position: { ...position, line: position.line - lines } };
}
