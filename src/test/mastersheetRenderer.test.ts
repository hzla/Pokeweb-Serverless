import { describe, expect, it } from "vitest";
import { renderMasterData } from "../ui/mastersheetRenderer";
import type { MastersheetElement } from "../pokeweb/mastersheetModel";

describe("mastersheetRenderer", () => {
  it("renders prose, grouped lists, and safe inline links", () => {
    const html = renderMasterData(
      [
        { tag: "h1", content: "Title", content_parts: [{ type: "text", text: "Title" }] },
        { tag: "p", content: "Go ", content_parts: [{ type: "text", text: "Go " }, { type: "link", text: "safe", href: "https://example.com" }] },
        { tag: "p", content: "Bad", content_parts: [{ type: "link", text: "bad", href: "javascript:alert(1)" }] },
        { tag: "li", content: "One", content_parts: [{ type: "text", text: "One" }] },
        { tag: "li", content: "Two", content_parts: [{ type: "text", text: "Two" }] },
        { tag: "p", content: "After", content_parts: [{ type: "text", text: "After" }] },
      ] satisfies MastersheetElement[],
      [],
      [],
    );

    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">safe</a>');
    expect(html).toContain('<a href="#" target="_blank" rel="noopener noreferrer">bad</a>');
    expect(html).toContain("<ul>\n<li>One</li>\n<li>Two</li>\n</ul>");
  });

  it("renders trainer and encounter cards", () => {
    const html = renderMasterData(
      [
        { tag: "trainer", id: 1, class: "mand" },
        { tag: "encounter", id: 0 },
      ] satisfies MastersheetElement[],
      [
        null,
        {
          class: "Ace Trainer",
          name: "Dan - Route 19",
          count: 1,
          type: "Doubles",
          tr_sprite: "trainer_sprites/ace_trainer.png",
          species_id_0: "Bulbasaur",
          raw_species_id_0: 1,
          level_0: 42,
          item_id_0: "Potion",
          nature_0: "Hardy",
          ability_name_0: "Overgrow",
          move_1_0: "Tackle",
          move_2_0: "Growl",
          move_3_0: "",
          move_4_0: "",
        },
      ],
      [{ id: 0, name: "Route 19", wilds: ["Bulbasaur"], locations: ["Route 19"] }],
      { highlights: { changed: { tackle: 1 }, minor: { growl: 1 } } },
    );

    expect(html).toContain("Ace Trainer Dan - Route 19");
    expect(html).toContain("expanded-card-content expanded-docs");
    expect(html).toContain("Lv 42 Bulbasaur");
    expect(html).toContain("Potion");
    expect(html).toContain('class="mandatory-tag">Mandatory</span>');
    expect(html).toContain('class="battle-format-icon battle-format-icon--doubles"');
    expect(html).toContain('aria-label="Doubles battle"');
    expect(html).not.toContain("(Doubles)");
    expect(html).toContain('<span class="mastersheet-highlight">Tackle</span>');
    expect(html).toContain('<span class="mastersheet-highlight-minor">Growl</span>');
    expect(html).toContain("Route 19");
    expect(html).toContain('data-species-name="Bulbasaur"');
  });

  it("renders three silhouettes for triple battles", () => {
    const html = renderMasterData(
      [{ tag: "trainer", id: 0 }],
      [{ class: "Trainer", name: "Tri", count: 0, type: "Triples" }],
      [],
    );

    expect(html).toContain('class="battle-format-icon battle-format-icon--triples"');
    expect(html.match(/<g transform=/gu)).toHaveLength(3);
    expect(html).not.toContain("(Triples)");
  });

  it("renders gifts, items, notifications, and missing placeholders", () => {
    const html = renderMasterData(
      [
        { tag: "gifts", giftsTitle: "Gift", giftsDescription: "Pick one", giftPokemonList: ["Bulbasaur"], giftPokemonDescriptions: ["Starter"] },
        { tag: "items", itemsTitle: "Mart", itemsDescription: "Basics", itemList: ["Potion"], itemDescriptions: ["Cheap"] },
        { tag: "notif", notificationTitle: "Warning", text: "Bring<br>items", fontColor: "red" },
        { tag: "trainer", id: 99 },
      ] satisfies MastersheetElement[],
      [],
      [],
    );

    expect(html).toContain("ms-gifts");
    expect(html).toContain("Starter");
    expect(html).toContain("ms-items");
    expect(html).toContain("Cheap");
    expect(html).toContain('style="background: red"');
    expect(html).toContain("Bring<br>items");
    expect(html).toContain("Missing trainer 99");
  });
});
