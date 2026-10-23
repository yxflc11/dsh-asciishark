import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

// Bundle both workers into one generated module: no extra asset requests.
await mkdir(".tmp", { recursive: true });
const workerSources = [];
for (const [entry, name] of [["ocean-worker", "WORKER_SOURCE"], ["glass-worker", "GLASS_WORKER_SOURCE"]]) {
  await build({ entryPoints: [`src/${entry}.ts`], bundle: true, format: "iife", target: ["chrome110"],
    outfile: `.tmp/${entry}.js`, legalComments: "none", logLevel: "info" });
  workerSources.push(`export const ${name} = ${JSON.stringify(await readFile(`.tmp/${entry}.js`, "utf8"))};`);
}
await writeFile("src/worker-source.generated.ts", "/** Generated worker sources for Blob URLs. */\n" + workerSources.join("\n") + "\n");

// 2. Browser half: lazy-CJS bundle registering the plugin factory.
await build({
  entryPoints: ["src/client.ts"],
  bundle: true,
  format: "iife",
  target: ["chrome110"],
  outfile: "lib/client.js",
  legalComments: "none",
  logLevel: "info",
});

// 3. Standalone preview: exposes `window.OceanEngine` for preview/index.html.
await build({
  entryPoints: ["src/preview.ts"],
  bundle: true,
  format: "iife",
  target: ["chrome110"],
  outfile: "preview/ocean.global.js",
  legalComments: "none",
  logLevel: "info",
});

await rm(".tmp", { recursive: true, force: true });
