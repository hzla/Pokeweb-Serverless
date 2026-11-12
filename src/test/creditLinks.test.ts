import { describe, expect, it } from "vitest";
import { creditHtml } from "../ui/creditLinks";

describe("creditHtml", () => {
  it("links RetroNC and Aronousqui20 and escapes the rest", () => {
    expect(creditHtml("RetroNC; Aronousqui20")).toBe(
      '<a class="credit-link" href="https://www.youtube.com/@RetroNC" target="_blank" rel="noopener noreferrer">RetroNC</a>; ' +
      '<a class="credit-link" href="https://www.deviantart.com/aronousqui20" target="_blank" rel="noopener noreferrer">Aronousqui20</a>');
    expect(creditHtml("Smogon <Sprite> Project")).toBe("Smogon &lt;Sprite&gt; Project");
    expect(creditHtml("RetroNCX")).toBe("RetroNCX");
  });
});
