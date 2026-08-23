import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const sourceRoot = fileURLToPath(new URL("./animation-viewer", import.meta.url));
const outputRoot = fileURLToPath(new URL("../White2Expansion/animation-viewer", import.meta.url));

export default defineConfig({
  base: "./",
  root: sourceRoot,
  publicDir: false,
  build: {
    emptyOutDir: true,
    outDir: outputRoot,
    rollupOptions: {
      input: fileURLToPath(new URL("./animation-viewer/index.html", import.meta.url)),
    },
  },
});
