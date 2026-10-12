import profile from "../assets/translation/white2ItalianProfile.json";
import variants from "../assets/translation/white2AssetVariants.json";
import black2Variants from "../assets/translation/black2AssetVariants.json";

type AssetVariant = { nativeSha256: string; expandedSha256?: string };

/** Exact retail resource variants; this never relaxes executable signatures. */
export function white2ItalianAssetVariant(path: string, member: number): AssetVariant | undefined {
  const assets = profile.patchAssets as Record<string, Record<string, AssetVariant>>;
  return assets[path]?.[member];
}

/** Accept only audited regional graphics, including their checked US panel expansion. */
export function white2LocalizedAssetVariant(path: string, member: number, digest: string): AssetVariant | undefined {
  return localizedAssetVariant("W2", path, member, digest);
}

export function localizedAssetVariant(game: "W2" | "B2", path: string, member: number, digest: string): AssetVariant | undefined {
  const assets = (game === "B2" ? black2Variants : variants) as Record<string, Record<string, AssetVariant[]>>;
  return assets[path]?.[member]?.find(item => item.nativeSha256 === digest || item.expandedSha256 === digest);
}
