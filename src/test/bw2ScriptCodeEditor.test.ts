import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { bw2ScriptSourceOffset, highlightBw2ScriptLine, bw2ScriptEditorSymbols } from "../ui/bw2ScriptCodeEditor";

describe("Ruby-like script highlighting", () => {
  const tokens = (line: string) => highlightBw2ScriptLine(line).map((token) => [line.slice(token.from, token.to), token.kind]);
  it("recognizes helper parameters and locals within their own routine", () => {
    const source = "script :main, entry: 1 do\nreward(4)\nend\ndef reward(item)\nquantity = 1\ngive_item item: item, quantity: quantity\nend";
    const symbols = bw2ScriptEditorSymbols(source), scope = symbols.scopes.find((scope) => scope.from === 4)!;
    expect(symbols.helpers.get("reward")).toEqual(["item"]);
    expect([...scope.variables]).toEqual(["item", "quantity"]);
    expect([...symbols.scopes[0].variables]).toEqual([]);
    const line = "reward(item)";
    expect(highlightBw2ScriptLine(line, { helpers: symbols.helpers, variables: scope.variables }).map((token) => [line.slice(token.from, token.to), token.kind])).toEqual([["reward", "helper"], ["item", "work"]]);
  });
  it("keeps parameter completion during incomplete edits and reads bindings from Definitions", () => {
    const source = "def reward(item)\nprogress = 1\nquantity = 2\ntalk message: 0x";
    const symbols = bw2ScriptEditorSymbols(source, "work :progress, 0x40a1\n" + source);
    expect([...symbols.scopes[0].variables]).toEqual(["item", "quantity"]);
  });
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
  it("highlights the companion macro and Ruby-style keyword arguments", () => {
    expect(tokens("stop_companion_following script: 1, movement: :none")).toEqual([["stop_companion_following", "command"], ["script", "keyword"], ["1", "number"], ["movement", "keyword"], [":none", "symbol"]]);
  });
  it("highlights interaction macros and their keyword arguments without coloring bare argument names as keywords", () => {
    expect(tokens("talk message: MESSAGE")).toEqual([["talk", "command"], ["message", "keyword"], ["MESSAGE", "constant"]]);
    expect(tokens("read_sign style: :town, message: 26")).toEqual([["read_sign", "command"], ["style", "keyword"], [":town", "symbol"], ["message", "keyword"], ["26", "number"]]);
    expect(tokens("give_item item: VS_RECORDER, quantity: 1")).toEqual([["give_item", "command"], ["item", "keyword"], ["VS_RECORDER", "constant"], ["quantity", "keyword"], ["1", "number"]]);
    expect(tokens("finish_interaction")).toEqual([["finish_interaction", "command"]]);
    expect(tokens("stack_push message")).toEqual([["stack_push", "command"]]);
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
