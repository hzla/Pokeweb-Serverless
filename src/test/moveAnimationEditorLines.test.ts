import { describe, expect, it } from "vitest";
import { moveAnimationScriptCommandLines, parseMoveAnimationScript } from "../pokeweb/moveAnimationModel";
import { describeMoveAnimationLine, formatMoveAnimationLine } from "../ui/moveAnimationCodeEditor";

describe("move animation editor line helpers", () => {
  it("maps each parsed command back to its editor line", () => {
    const script = [
      ".include \"anim.inc\"",
      "",
      ".word 1",
      ".word SCRIPT_A",
      ".word SCRIPT_A",
      ".word SCRIPT_A",
      ".word SCRIPT_A",
      ".word SCRIPT_A",
      ".word SCRIPT_A",
      ".word SCRIPT_A",
      ".word SCRIPT_A",
      ".word SCRIPT_A",
      ".word SCRIPT_A",
      ".word SCRIPT_A",
      ".word SCRIPT_A",
      ".word SCRIPT_A",
      ".word SCRIPT_A",
      "",
      "SCRIPT_A:",
      "  @ comment only",
      "  Wait 4",
      "",
      "  TerminateMoveScript @ done",
    ].join("\n");
    const lines = moveAnimationScriptCommandLines(script).get("SCRIPT_A");
    const parsed = parseMoveAnimationScript(script).scripts.get("SCRIPT_A") ?? [];
    expect(lines).toEqual([21, 23]);
    expect(parsed.map((command) => command.index)).toEqual([0, 1]);
  });

  it("splits a command line and rebuilds it with edited params", () => {
    const info = describeMoveAnimationLine("  Wait 4 @ pause", 3);
    expect(info.kind).toBe("command");
    expect(info.params).toEqual(["4"]);
    expect(info.comment).toBe("@ pause");
    expect(formatMoveAnimationLine(info, ["12"])).toBe("  Wait 12 @ pause");
    expect(describeMoveAnimationLine("SCRIPT_A:").kind).toBe("label");
    expect(describeMoveAnimationLine("  NotACommand 1").kind).toBe("unknown");
  });
});
