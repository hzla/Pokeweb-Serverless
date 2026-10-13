import { describe, expect, it } from "vitest";
import { compileBw2Script } from "../pokeweb/bw2ScriptCompiler";
import { bw2ScriptPartPosition, bw2ScriptFullPosition, joinBw2ScriptSource, splitBw2ScriptSource } from "../pokeweb/bw2ScriptSourceParts";

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
  it.each(["\n", "\r\n"])("shows terminal movements in Definitions and maps both editors back to physical source (%j)", (newline) => {
    const header = ["preserve_layout", "work :progress, 0x40a1", ""].join(newline);
    const script = ["script :main, entry: 1 do", "apply_movement 0, :walk", "halt", "end", ""].join(newline);
    const tail = ["movement :walk do", "walk_left 2", "end", "data :pad, 0", ""].join(newline);
    const source = header + script + tail, parts = splitBw2ScriptSource(source);
    expect(parts).toEqual({ definitions: header + tail, script });
    expect(joinBw2ScriptSource(parts)).toBe(source);
    expect(compileBw2Script(joinBw2ScriptSource(parts)).bytes).toEqual(compileBw2Script(source).bytes);
    for (let line = 1; line <= 10; line++) {
      const full = { line, column: 3 }, local = bw2ScriptPartPosition(parts, full);
      expect(bw2ScriptFullPosition(parts, local.part, local.position)).toEqual(full);
    }
    expect(bw2ScriptPartPosition(parts, { line: 8, column: 1 })).toEqual({ part: "definitions", position: { line: 4, column: 1 } });
    expect(bw2ScriptFullPosition(parts, "script", { line: 2, column: 1 }).line).toBe(4);
  });
  it("retains interleaved and leading movements in their original physical positions", () => {
    const source = "preserve_layout\nmovement :early do\nturn_up 1\nend\nscript :main, entry: 1 do\napply_movement 0, :early\nhalt\nend\nmovement :tail do\nturn_down 1\nend";
    const parts = splitBw2ScriptSource(source);
    expect(parts.script).toContain("movement :early");
    expect(parts.definitions).toContain("movement :tail");
    expect(joinBw2ScriptSource(parts)).toBe(source);
    expect(compileBw2Script(joinBw2ScriptSource(parts)).bytes).toEqual(compileBw2Script(source).bytes);
  });
  it("adds separators when authoring a movement in Definitions", () => {
    const parts = { definitions: "STEPS = 2\nmovement :walk do\nwalk_up STEPS\nend", script: "script :main, entry: 1 do\napply_movement 0, :walk\nend" };
    expect(joinBw2ScriptSource(parts)).toBe("STEPS = 2\n" + parts.script + "\nmovement :walk do\nwalk_up STEPS\nend");
    expect(compileBw2Script(joinBw2ScriptSource(parts)).dataBlocks![0].bytes[2]).toBe(2);
  });
});
