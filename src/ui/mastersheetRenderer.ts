import { publicAsset } from "../assetUrl";
import { pokemonSpriteSlug } from "../pokeweb/spriteSlug";
import type { MastersheetElement, MastersheetEncounterRecord, MastersheetInlinePart, MastersheetTrainerRecord } from "../pokeweb/mastersheetModel";
import type { MastersheetHighlightMap } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

type RenderOptions = {
  highlights?: MastersheetHighlightMap;
};

export function renderMasterData(
  masterData: MastersheetElement[],
  trainersById: MastersheetTrainerRecord[] | Record<string, MastersheetTrainerRecord>,
  encountersById: MastersheetEncounterRecord[] | Record<string, MastersheetEncounterRecord>,
  options: RenderOptions = {},
): string {
  let html = "";
  let ulOpen = false;
  let previousEmptyParagraph = false;

  const closeUl = () => {
    if (!ulOpen) return;
    html += "</ul>\n";
    ulOpen = false;
  };

  for (let index = 0; index < masterData.length; index += 1) {
    const element = masterData[index];
    const tag = element.tag;
    const emptyParagraph = tag === "p" && isEmptyParagraphElement(element);
    const ignoreEmptyParagraphInsideList = ulOpen && emptyParagraph;
    if (tag !== "li" && !ignoreEmptyParagraphInsideList) closeUl();

    switch (tag) {
      case "br":
        previousEmptyParagraph = false;
        html += "<br>\n";
        break;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
        previousEmptyParagraph = false;
        html += `<${tag}>${renderInlineParts(element)}</${tag}>\n`;
        break;
      case "p":
        if (emptyParagraph) {
          if (ulOpen || previousEmptyParagraph) break;
          previousEmptyParagraph = true;
          html += "<p></p>\n";
          break;
        }
        previousEmptyParagraph = false;
        html += `<p>${renderInlineParts(element)}</p>\n`;
        break;
      case "li":
        previousEmptyParagraph = false;
        if (!ulOpen) {
          ulOpen = true;
          html += "<ul>\n";
        }
        html += `<li>${renderInlineParts(element)}</li>\n`;
        break;
      case "trainer":
        previousEmptyParagraph = false;
        html += renderTrainerCard(element, getTrainer(trainersById, Number(element.id ?? -1)), options);
        break;
      case "encounter":
        previousEmptyParagraph = false;
        html += renderEncounterCard(element, getEncounter(encountersById, Number(element.id ?? -1)));
        break;
      case "gifts":
        previousEmptyParagraph = false;
        html += renderGiftsBlock(element);
        break;
      case "items":
        previousEmptyParagraph = false;
        html += renderItemsBlock(element);
        break;
      case "notif":
        previousEmptyParagraph = false;
        html += renderNotificationBlock(element);
        break;
      default:
        previousEmptyParagraph = false;
        break;
    }
  }

  closeUl();
  return html;
}

export function renderMastersheetToc(masterRoot: HTMLElement, tocRoot: HTMLElement, scrollContainer: HTMLElement): void {
  const headings = [...masterRoot.querySelectorAll<HTMLElement>("h1, h2")];
  const tocItems: string[] = [];
  headings.forEach((heading, index) => {
    if (index === 0) return;
    const text = (heading.textContent ?? "").split(" (")[0]?.trim() ?? "";
    const link = headingSlug(text);
    heading.dataset.link = link;
    tocItems.push(`<div class="${heading.tagName.toLowerCase() === "h1" ? "toc-header" : "toc-item"}" data-link="${escapeAttr(link)}">${escapeHtml(text)}</div>`);
  });
  tocRoot.innerHTML = tocItems.join("");
  tocRoot.querySelectorAll<HTMLElement>("[data-link]").forEach((item) => {
    item.addEventListener("click", () => {
      const link = item.dataset.link ?? "";
      const target = headings.find((heading) => heading.dataset.link === link);
      if (!target) return;
      const targetTop = target.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top + scrollContainer.scrollTop - 12;
      scrollContainer.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    });
  });
}

function renderInlineParts(element: MastersheetElement): string {
  const parts = Array.isArray(element.content_parts) ? (element.content_parts as MastersheetInlinePart[]) : undefined;
  if (!parts) return escapeHtml(String(element.content ?? ""));
  return parts
    .map((part) => {
      if (part.type === "text") return escapeHtml(part.text ?? "");
      const href = sanitizeUrl(part.href ?? "#");
      const text = escapeHtml(part.text ?? href);
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    })
    .join("");
}

function renderTrainerCard(masterElement: MastersheetElement, trainer: MastersheetTrainerRecord, options: RenderOptions): string {
  if (!trainer) return renderMissingBlock(`Missing trainer ${String(masterElement.id ?? "")}`);

  const cardClass = masterElement.class ? escapeAttr(String(masterElement.class)) : "";
  const trainerSpriteSrc = buildTrainerSpriteSrc(trainer);
  const trainerDisplayName = buildTrainerDisplayName(trainer);
  const battleType = String(trainer.type ?? "");
  const showBattleType = battleType === "Doubles" || battleType === "Triples";
  const isMandatory = String(masterElement.class ?? "").split(/\s+/u).includes("mand");
  const notes = renderTrainerNotes(masterElement);
  const dataIndex = String(masterElement.id ?? "");

  return `
<div class="expanded-field filterable ms-trainer ${cardClass}" data-index="${escapeAttr(dataIndex)}" data-element="">
  <div class="expanded-field-main">
    <div class="trainer-name">
      <img src="${escapeAttr(trainerSpriteSrc)}" loading="lazy" alt="">
      ${trainerDisplayName}
      <div class="tr-notes">
        ${notes}
      </div>
    </div>
  </div>
  ${showBattleType ? renderBattleFormatIcon(battleType) : ""}
  <div class="expanded-card-content expanded-docs">
${renderTrainerDocs(trainer, options)}
  </div>
  ${isMandatory ? `<span class="mandatory-tag">Mandatory</span>` : ""}
</div>
`;
}

function renderBattleFormatIcon(battleType: string): string {
  const count = battleType === "Triples" ? 3 : 2;
  const width = count * 20;
  let people = "";

  for (let index = 0; index < count; index += 1) {
    people += `<g transform="translate(${index * 20 + 1} 1)"><circle cx="9" cy="6" r="5.5"></circle><path d="M0 30v-8.5C0 15.2 3.7 11 9 11s9 4.2 9 10.5V30H0Z"></path></g>`;
  }

  return `<span class="battle-format-icon battle-format-icon--${battleType.toLowerCase()}" role="img" aria-label="${battleType} battle"><svg viewBox="0 0 ${width} 32" aria-hidden="true" focusable="false">${people}</svg></span>`;
}

function renderTrainerDocs(trainer: Record<string, unknown>, options: RenderOptions): string {
  const count = Number(trainer.count ?? 0);
  if (!Number.isFinite(count) || count <= 0) return "";

  let html = "";
  for (let slot = 0; slot < count; slot += 1) {
    const speciesRaw = trainer[`species_id_${slot}`] ?? "";
    const rawSpeciesId = trainer[`raw_species_id_${slot}`] ?? "";
    const level = trainer[`level_${slot}`] ?? "";
    const item = trainer[`item_id_${slot}`] ?? "";
    const nature = trainer[`nature_${slot}`] ?? "";
    const abilityName = trainer[`ability_name_${slot}`] ?? "";
    const displaySpecies = prettifyEnumName(speciesRaw);
    const spriteSrc = buildPokeSpriteSrc(displaySpecies);

    html += `    <div class="trainer-doc-item">\n`;
    html += `      <img src="${escapeAttr(spriteSrc)}" class="doc-sprite" loading="lazy" data-species-id="${escapeAttr(String(rawSpeciesId))}" alt="${escapeAttr(displaySpecies)}" onerror="this.onerror=null; this.src='${escapeAttr(publicAsset("images/pokesprite/-.png"))}'">\n`;
    html += `      <div class="trpok-item-info doc-species" data-species-id="${escapeAttr(String(rawSpeciesId))}">Lv ${escapeHtml(String(level))} ${escapeHtml(displaySpecies)}</div>\n`;
    html += `      <div class="trpok-item-info doc-held-item">${maybeEmphasize(item, String(item ?? ""), options.highlights)}</div>\n`;
    html += `      <div class="trpok-item-info">${escapeHtml(String(nature))}</div>\n`;
    html += `      <div class="trpok-item-info doc-ab">${maybeEmphasize(abilityName, String(abilityName ?? ""), options.highlights)}</div>\n`;
    html += "      <br>\n";

    for (let moveIndex = 1; moveIndex <= 4; moveIndex += 1) {
      const move = trainer[`move_${moveIndex}_${slot}`] ?? "";
      html += `      <div class="trpok-item-info doc-move" data-id="0">${maybeEmphasize(move, prettifyMoveName(move), options.highlights)}</div>\n`;
    }

    html += "    </div>\n";
  }
  return html;
}

function renderEncounterCard(masterElement: MastersheetElement, encounter: MastersheetEncounterRecord): string {
  if (!encounter) return renderMissingBlock(`Missing encounter ${String(masterElement.id ?? "")}`);
  const dataIndex = String(masterElement.id ?? "");
  const wilds = encounter.wilds ?? [];
  return `
<h3 style="display: none;">${escapeHtml(encounter.name)}</h3>
<div class="expanded-field filterable doc-enc" data-index="${escapeAttr(dataIndex)}">
  <div class="expanded-field-main">
    <div class="encounter-locations">
      ${escapeHtml(encounter.name)}
    </div>
    <div class="encounter-wilds">
      ${wilds
        .map((wild) => {
          const species = String(wild);
          return `<div class="wild" data-species-name="${escapeAttr(species)}"><img src="${escapeAttr(buildPokeSpriteSrc(species))}" loading="lazy" alt="${escapeAttr(species)}" onerror="this.onerror=null; this.src='${escapeAttr(publicAsset("images/pokesprite/-.png"))}'"></div>`;
        })
        .join("\n")}
    </div>
  </div>
</div>
`;
}

function renderGiftsBlock(element: MastersheetElement): string {
  const title = escapeHtml(String(element.giftsTitle ?? ""));
  const description = escapeHtml(String(element.giftsDescription ?? ""));
  const mons = Array.isArray(element.giftPokemonList) ? element.giftPokemonList : [];
  const descriptions = Array.isArray(element.giftPokemonDescriptions) ? element.giftPokemonDescriptions : [];

  return `
<div class="flex-break"></div>
<div class="ms-block ms-gifts">
  <div class="ms-row">
    <div class="ms-left">
      <div class="ms-left-title">${title}</div>
      ${description ? `<div class="ms-left-desc">${description}</div>` : ""}
    </div>
    <div class="ms-cells">
      ${mons
        .map((mon, index) => {
          const name = String(mon ?? "");
          const desc = String(descriptions[index] ?? "");
          return `
      <div class="ms-cell ms-gift-cell" data-species-name="${escapeAttr(name)}">
        <div class="ms-cell-top"><img src="${escapeAttr(buildPokeSpriteSrc(name))}" loading="lazy" alt="${escapeAttr(name)}" onerror="this.onerror=null; this.src='${escapeAttr(publicAsset("images/pokesprite/-.png"))}'"></div>
        ${desc ? `<div class="ms-cell-bottom"><div class="ms-gift-desc">${escapeHtml(desc)}</div></div>` : `<div class="ms-cell-bottom"></div>`}
      </div>`;
        })
        .join("\n")}
    </div>
  </div>
</div>
<div class="flex-break"></div>
`;
}

function renderItemsBlock(element: MastersheetElement): string {
  const title = escapeHtml(String(element.itemsTitle ?? ""));
  const description = escapeHtml(String(element.itemsDescription ?? ""));
  const items = Array.isArray(element.itemList) ? element.itemList : [];
  const descriptions = Array.isArray(element.itemDescriptions) ? element.itemDescriptions : [];

  return `
<div class="ms-block ms-items">
  <div class="ms-row">
    <div class="ms-left">
      <div class="ms-left-title">${title}</div>
      ${description ? `<div class="ms-left-desc">${description}</div>` : ""}
    </div>
    <div class="ms-item-rows">
      ${items
        .map((item, index) => {
          const name = String(item ?? "").replace("é", "e");
          const desc = String(descriptions[index] ?? "");
          return `
      <div class="ms-item-row" data-item-name="${escapeAttr(name)}">
        <div class="ms-item-icon"><img src="${escapeAttr(buildItemSpriteSrc(name))}" loading="lazy" alt="${escapeAttr(name)}" onerror="this.onerror=null; this.src='${escapeAttr(publicAsset("images/default.png"))}'"></div>
        <div class="ms-item-text"><div class="ms-item-desc">${escapeHtml(desc || name)}</div></div>
      </div>`;
        })
        .join("\n")}
    </div>
  </div>
</div>
`;
}

function renderNotificationBlock(element: MastersheetElement): string {
  const title = escapeHtml(String(element.notificationTitle ?? "NOTE"));
  const body = allowOnlyBr(element.text ?? "").replaceAll(",", ", ");
  const color = safeCssColor(String(element.fontColor ?? ""));
  return `
<div class="flex-break"></div>
<div class="ms-block ms-notif">
  <div class="ms-row">
    <div class="ms-left"${color ? ` style="background: ${escapeAttr(color)}"` : ""}>
      <div class="ms-left-title">${title}</div>
    </div>
    <div class="ms-notif-body">${body}</div>
  </div>
</div>
<div class="flex-break"></div>
`;
}

function renderMissingBlock(label: string): string {
  return `<div class="expanded-field filterable ms-missing">${escapeHtml(label)}</div>\n`;
}

function renderTrainerNotes(masterElement: MastersheetElement): string {
  if (Array.isArray(masterElement.notes_parts)) return renderInlineParts({ tag: "p", content_parts: masterElement.notes_parts as MastersheetInlinePart[] });
  const notes = Array.isArray(masterElement.notes) ? masterElement.notes : [];
  return notes.map((note) => escapeHtml(String(note))).join(" ");
}

function getTrainer(trainersById: MastersheetTrainerRecord[] | Record<string, MastersheetTrainerRecord>, id: number): MastersheetTrainerRecord {
  if (Array.isArray(trainersById)) return trainersById[id] ?? null;
  return trainersById[String(id)] ?? null;
}

function getEncounter(encountersById: MastersheetEncounterRecord[] | Record<string, MastersheetEncounterRecord>, id: number): MastersheetEncounterRecord {
  if (Array.isArray(encountersById)) return encountersById[id] ?? null;
  return encountersById[String(id)] ?? null;
}

function buildTrainerDisplayName(trainer: Record<string, unknown>): string {
  const trainerClass = trainer.class ? escapeHtml(String(trainer.class)) : "Trainer";
  const name = trainer.name ? escapeHtml(String(trainer.name)) : trainerClass;
  return `${trainerClass} ${name}`;
}

function buildTrainerSpriteSrc(trainer: Record<string, unknown>): string {
  const raw = String(trainer.tr_sprite ?? "");
  if (!raw) return publicAsset("images/trainer_sprites/unknown.png");
  if (/^(https?:)?\/\//iu.test(raw) || raw.startsWith("/") || raw.startsWith("./")) return raw;
  if (raw.startsWith("images/")) return publicAsset(raw);
  return publicAsset(`images/${raw}`);
}

function buildPokeSpriteSrc(speciesName: string): string {
  return publicAsset(`images/pokesprite/${pokemonSpriteSlug(speciesName)}.png`);
}

function buildItemSpriteSrc(itemName: string): string {
  return publicAsset(`images/item_sprites/${cleanString(itemName)}.png`);
}

function maybeEmphasize(rawName: unknown, displayText: string, highlights: MastersheetHighlightMap | undefined): string {
  const key = cleanString(String(rawName ?? ""));
  const safeText = escapeHtml(displayText);
  if (!key || !highlights) return safeText;
  const major = highlights.changed?.[key] === 1 || highlights.new?.[key] === 1;
  if (major) return `<span class="mastersheet-highlight">${safeText}</span>`;
  return highlights.minor?.[key] === 1 ? `<span class="mastersheet-highlight-minor">${safeText}</span>` : safeText;
}

function isEmptyParagraphElement(element: MastersheetElement): boolean {
  return inlinePlainText(element).trim().length === 0;
}

function inlinePlainText(element: MastersheetElement): string {
  const parts = Array.isArray(element.content_parts) ? (element.content_parts as MastersheetInlinePart[]) : undefined;
  if (!parts) return String(element.content ?? "");
  return parts.map((part) => (part.type === "link" ? (part.text ?? part.href) : part.text)).join("");
}

function prettifyEnumName(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text
    .toLowerCase()
    .split(/[\s_]+/gu)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function prettifyMoveName(value: unknown): string {
  return prettifyEnumName(value);
}

function allowOnlyBr(value: unknown): string {
  return escapeHtml(String(value ?? "")).replace(/&lt;br\s*\/?&gt;/giu, "<br>");
}

function cleanString(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/gu, "").toLowerCase();
}

function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/gu, "")
    .replace(/\s+/gu, "-")
    .trim();
}

function sanitizeUrl(url: string): string {
  const value = url.trim();
  return /^https?:\/\//iu.test(value) ? value : "#";
}

function safeCssColor(value: string): string {
  const text = value.trim();
  if (
    /^#[0-9a-f]{3}$/iu.test(text) ||
    /^#[0-9a-f]{6}$/iu.test(text) ||
    /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/iu.test(text) ||
    /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0(\.\d+)?|1(\.0+)?)\s*\)$/iu.test(text) ||
    /^[a-z]+$/iu.test(text)
  ) {
    return text;
  }
  return "";
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/gu, "&#096;");
}
