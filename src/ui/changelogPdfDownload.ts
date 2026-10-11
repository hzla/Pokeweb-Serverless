import regularFontUrl from "../assets/fonts/LiberationSans-Regular.ttf?url";
import boldFontUrl from "../assets/fonts/LiberationSans-Bold.ttf?url";
import { buildChangelogPdf, type ChangelogPdfFonts } from "../pokeweb/changelogPdf";
import type { ChangelogDocument } from "../pokeweb/changelogDocument";

let fontsPromise: Promise<ChangelogPdfFonts> | undefined;
function fontBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
async function loadFonts(): Promise<ChangelogPdfFonts> {
  const [regular, bold] = await Promise.all([regularFontUrl, boldFontUrl].map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not load the PDF font. Please retry the download.");
    return fontBase64(new Uint8Array(await response.arrayBuffer()));
  }));
  return { regular, bold };
}
export async function downloadChangelogPdf(documents: ChangelogDocument[], filename: string): Promise<void> {
  const fonts = await (fontsPromise ??= loadFonts().catch((error) => { fontsPromise = undefined; throw error; }));
  const pdf = buildChangelogPdf(documents, fonts);
  const url = URL.createObjectURL(pdf.output("blob"));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
