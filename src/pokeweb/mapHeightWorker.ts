import { generateGen5MapHeights } from "./gen5MapHeightGeneration";
self.addEventListener("message", (event: MessageEvent<Parameters<typeof generateGen5MapHeights>>) => {
  try { self.postMessage({ result: generateGen5MapHeights(...event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
});
