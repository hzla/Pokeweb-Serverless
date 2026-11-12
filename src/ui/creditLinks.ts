import { escapeHtml } from "./dom";

/** Credited artists with a page of their own: their name in a credit becomes a link to it. */
export const CREDIT_LINKS: ReadonlyArray<{ name: string; url: string }> = [
  { name: "RetroNC", url: "https://www.youtube.com/@RetroNC" },
  { name: "Aronousqui20", url: "https://www.deviantart.com/aronousqui20" },
];

const pattern = new RegExp(`\\b(${CREDIT_LINKS.map((credit) => credit.name).join("|")})\\b`, "giu");

/** A credit as HTML: escaped, with each linked artist's name ("RetroNC; Aronousqui20") a link to their page. */
export function creditHtml(text: string): string {
  return escapeHtml(text).replace(pattern, (name) => {
    const credit = CREDIT_LINKS.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())!;
    return `<a class="credit-link" href="${credit.url}" target="_blank" rel="noopener noreferrer">${name}</a>`;
  });
}
