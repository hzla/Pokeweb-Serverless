import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { bw2ScriptSourceOffset, highlightBw2ScriptLine } from "../ui/bw2ScriptCodeEditor";

describe("Ruby-like script highlighting", () => {
  const tokens = (line: string) => highlightBw2ScriptLine(line).map((token) => [line.slice(token.from, token.to), token.kind]);
  it("distinguishes symbols and declarations from numbers and comments", () => {
    expect(tokens("script :main, entry: 1 do # start")).toEqual([["script", "keyword"], [":main", "symbol"], ["entry", "keyword"], ["1", "number"], ["do", "keyword"], ["# start", "comment"]]);
    expect(tokens("work :count, 0x8000")).toEqual([["work", "keyword"], [":count", "symbol"], ["0x8000", "number"]]);
  });
  it("keeps comments inside escaped quoted text as string content", () => {
    expect(tokens('say "a \\"quoted\\" # string" # comment')).toEqual([['"a \\"quoted\\" # string"', "string"], ["# comment", "comment"]]);
    expect(tokens('say "unfinished # string')).toEqual([['"unfinished # string', "string"]]);
  });
  it("highlights helpers, commands, constants, and operators without requiring valid syntax", () => {
    expect(tokens("def pause_once()")).toEqual([["def", "keyword"], ["pause_once", "helper"]]);
    expect(tokens("sleep LIMIT unless count!=2")).toEqual([["sleep", "command"], ["LIMIT", "constant"], ["unless", "keyword"], ["!=", "operator"], ["2", "number"]]);
  });
});

describe("compiler error selection", () => {
  const document = Text.of(["script :main, entry: 1 do", "  unknown", "end", ""]);
  it("resolves one-based compiler positions to editor offsets", () => {
    expect(bw2ScriptSourceOffset(document, { line: 2, column: 3 })).toBe(document.line(2).from + 2);
  });
  it("clamps EOF and out-of-range locations safely", () => {
    expect(bw2ScriptSourceOffset(document, { line: 99, column: 99 })).toBe(document.length);
    expect(bw2ScriptSourceOffset(document, { line: 0, column: 0 })).toBe(0);
    expect(bw2ScriptSourceOffset(document, { line: 2, column: 99 })).toBe(document.line(2).to);
  });
});
