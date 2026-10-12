import { describe, expect, it } from "vitest";
import { compileBw2Script } from "../pokeweb/bw2ScriptCompiler";
import { bw2ScriptPartPosition, joinBw2ScriptSource, splitBw2ScriptSource } from "../pokeweb/bw2ScriptSourceParts";

describe("BW2 script and definitions source sections", () => {
  it("separates metadata, bindings, constants and leading data without reordering bytes", () => {
    const definitions = "# original\npreserve_layout\ncondition_encoding :stack\nwork :intro, 0x40a1\nZERO = 0\nentry 2, :main\ndata :prefix, 0, 0\n\n";
    const script = "script :main, entry: 1 do\nif intro == ZERO\nnop\nend\nhalt\nend\ndata :tail, 0, 0\n";
    const source = definitions + script;
    expect(splitBw2ScriptSource(source)).toEqual({ definitions, script });
    expect(joinBw2ScriptSource(splitBw2ScriptSource(source))).toBe(source);
    expect(compileBw2Script(joinBw2ScriptSource(splitBw2ScriptSource(source))).bytes).toEqual(compileBw2Script(source).bytes);
  });
  it.each(["def helper\nvm_return\nend\n", "block :shared do\nhalt\nend\n"]) ("keeps helpers/shared blocks in the scripting section: %s", (body) => {
    const source = "preserve_layout\nentry 1, :shared\n" + body;
    expect(splitBw2ScriptSource(source).script).toBe(body);
    expect(joinBw2ScriptSource(splitBw2ScriptSource(source))).toBe(source);
  });
  it.each(["# Start here\n", "script :main, entry: 1 do\nnop\nend", "work :x, 0x8020", "entry 1, :unknown\ndata :unknown, 0xff, 0xff", "work :x, 0x8020\r\n\r\nscript :main, entry: 1 do\r\nend\r\n"]) ("preserves existing draft text exactly: %s", (source) => {
    expect(joinBw2ScriptSource(splitBw2ScriptSource(source))).toBe(source);
  });
  it("adds a separator for new definitions and maps errors to visible tab lines", () => {
    const parts = { definitions: "work :intro, 0x40a1", script: "script :main, entry: 1 do\nunknown\nend" };
    expect(joinBw2ScriptSource(parts)).toBe(parts.definitions + "\n" + parts.script);
    expect(bw2ScriptPartPosition(parts, { line: 1, column: 6 })).toEqual({ part: "definitions", position: { line: 1, column: 6 } });
    expect(bw2ScriptPartPosition(parts, { line: 3, column: 1 })).toEqual({ part: "script", position: { line: 2, column: 1 } });
  });
});
