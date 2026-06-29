import { describe, expect, it } from "vitest";
import { getMoveAnimationCommandLineColor } from "../ui/moveAnimationCodeEditor";

describe("move animation code editor helpers", () => {
  it("resolves numeric RGB5 color params for color highlighting", () => {
    expect(getMoveAnimationCommandLineColor("ChangeColor POKEMON_ATTACKER, 0, 16, 8, 31, 0, 0")).toBe("#ff0000");
    expect(getMoveAnimationCommandLineColor("ChangeSpriteColor POKEMON_ATTACKER, 0, 16, 8, 31, 0, 0")).toBe("#ff0000");
    expect(getMoveAnimationCommandLineColor("ChangeColor 0, 0, 16, 8, 0x7c00")).toBe("#0000ff");
  });

  it("ignores commands that do not carry editable RGB params", () => {
    expect(getMoveAnimationCommandLineColor("MoveCamera MOVE_INTERPOLATION, CAMERA_DEFENDER, 16, 0, 9")).toBeUndefined();
  });
});
