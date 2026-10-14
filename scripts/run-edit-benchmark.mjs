import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { createServer as createViteServer } from "vite";
import { createServer } from "node:net";

const output = process.argv[process.argv.indexOf("--output") + 1];
if (!process.argv.includes("--output") || !output) throw new Error("Usage: node scripts/run-edit-benchmark.mjs --output /absolute/report.json");
const port = await freePort(), debugPort = await freePort();
const profile = await mkdtemp(join(tmpdir(), "pokeweb-benchmark-chrome-"));
const baseline = process.argv.includes("--baseline") ? process.argv[process.argv.indexOf("--baseline") + 1] : undefined;
const sessionCaches = process.argv.includes("--session-caches");
const smokeOnly = process.argv.includes("--smoke-only");
const baselineFiles = new Set(["src/pokeweb/moveItemModel.ts", "src/pokeweb/moveAnimationModel.ts", "src/pokeweb/persistence.ts"]);
const vite = await createViteServer({
  server: { host: "127.0.0.1", port, strictPort: true },
  plugins: baseline ? [{ name: "frozen-edit-baseline", enforce: "pre", async load(id) {
    const file = relative(process.cwd(), id.split("?")[0]);
    if (!baselineFiles.has(file)) return;
    let source = await readFile(resolve(baseline, file), "utf8");
    if (file.endsWith("persistence.ts") && !source.includes("export function persistableProject")) source += "\nexport { persistableProject };\n";
    return source;
  } }] : [],
});
await vite.listen();
const chrome = spawn(process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--enable-precise-memory-info", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });
let cdp;
try {
  await ready(`http://127.0.0.1:${port}/scripts/edit-benchmark.html`);
  await ready(`http://127.0.0.1:${debugPort}/json/version`);
  const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
  const results = [];
  for (const rate of smokeOnly ? [] : [1, 4]) for (const sourceMiB of [256, 512]) for (const loaded of [false, true]) {
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${port}/scripts/edit-benchmark.html`)}`, { method: "PUT" })).json();
    cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("HeapProfiler.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    const evaluation = await cdp.send("Runtime.evaluate", {
      expression: `(async()=>{const bench=await import('/scripts/benchmark-edit-commits.ts');return bench.benchmarkEdits(${sourceMiB},${loaded},${sessionCaches},${Boolean(baseline) && sessionCaches});})()`,
      awaitPromise: true, returnByValue: true,
    });
    if (evaluation.exceptionDetails) throw new Error(JSON.stringify(evaluation.exceptionDetails));
    const heap = await cdp.send("Runtime.getHeapUsage");
    const result = { cpuThrottle: rate, ...evaluation.result.value, heap };
    results.push(result);
    console.log(JSON.stringify(result));
    cdp.close(); cdp = undefined;
    await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
  }
  let uiSmoke, documentSmoke;
  if (!baseline) {
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${port}/scripts/edit-benchmark.html`)}`, { method: "PUT" })).json();
    cdp = await connect(target.webSocketDebuggerUrl);
    const evaluation = await cdp.send("Runtime.evaluate", {
      expression: `(async()=>{const bench=await import('/scripts/benchmark-edit-commits.ts');return bench.smokeMoveItemEditors();})()`,
      awaitPromise: true, returnByValue: true,
    });
    if (evaluation.exceptionDetails) throw new Error(JSON.stringify(evaluation.exceptionDetails));
    uiSmoke = evaluation.result.value;
    if (sessionCaches) {
      const documentEvaluation = await cdp.send("Runtime.evaluate", {
        expression: `(async()=>{const bench=await import('/scripts/benchmark-edit-commits.ts');return bench.smokeProjectDocuments();})()`,
        awaitPromise: true, returnByValue: true,
      });
      if (documentEvaluation.exceptionDetails) throw new Error(JSON.stringify(documentEvaluation.exceptionDetails));
      documentSmoke = documentEvaluation.result.value;
      const seeded = await cdp.send("Runtime.evaluate", {
        expression: `(async()=>{const bench=await import('/scripts/benchmark-edit-commits.ts');await bench.seedUnsupportedProjectDocument();})()`, awaitPromise: true,
      });
      if (seeded.exceptionDetails) throw new Error(JSON.stringify(seeded.exceptionDetails));
      await cdp.send("Page.enable");
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
      let restoreFailureShown = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = await cdp.send("Runtime.evaluate", { expression: `Boolean(document.querySelector('#retry-project-restore') && document.body.textContent.includes('version 99'))`, returnByValue: true });
        if (state.result?.value) { restoreFailureShown = true; break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!restoreFailureShown) throw new Error("App did not show the future-version restore failure");
      const preserved = await cdp.send("Runtime.evaluate", {
        expression: `new Promise((resolve,reject)=>{const opening=indexedDB.open('pokeweb-serverless',2);opening.onsuccess=()=>{const db=opening.result,request=db.transaction('projects','readonly').objectStore('projects').get('active');request.onsuccess=()=>{const value=request.result;db.close();resolve(value.version===99&&value.narcs.personal.rawFiles[1][0]===99)};request.onerror=()=>reject(request.error)};opening.onerror=()=>reject(opening.error)})`,
        awaitPromise: true, returnByValue: true,
      });
      if (preserved.exceptionDetails || !preserved.result.value) throw new Error("App boot replaced the unsupported saved document");
      documentSmoke = { ...documentSmoke, restoreFailureShown, unsupportedDocumentPreserved: true };
    }
    cdp.close(); cdp = undefined;
    await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
    console.log(JSON.stringify({ uiSmoke, documentSmoke }));
  }
  await writeFile(output, JSON.stringify({ uiSmoke, documentSmoke, sessionCaches, baseline: Boolean(baseline), browser: version.Browser, createdAt: new Date().toISOString(), results }, null, 2));
} finally {
  cdp?.close(); chrome.kill(); await vite.close();
  await new Promise(resolve => setTimeout(resolve, 500));
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function ready(url) {
  for (let n = 0; n < 200; n++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let id = 0;
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject); });
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (request) { pending.delete(message.id); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); }
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })); });
    },
    close() { socket.close(); },
  };
}
