export function pokemonSpriteSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(". ", "-")
      .toLowerCase()
      .replace(/['%]/gu, "")
      .replace(/\s+/gu, "-")
      .replace(/[^a-z0-9-]+/gu, "")
      .replace(/-+/gu, "-")
      .replace(/^-|-$/gu, "") || "-"
  );
}
