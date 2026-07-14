import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "src");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await Promise.all([
  mkdir(resolve(dist, "assets/icons"), { recursive: true }),
  mkdir(resolve(dist, "sidepanel"), { recursive: true }),
]);

await Promise.all([
  ...[16, 32, 48, 128].map((size) =>
    cp(
      resolve(src, `assets/icons/benyi-logo-${size}.png`),
      resolve(dist, `assets/icons/benyi-logo-${size}.png`),
    ),
  ),
  cp(resolve(src, "manifest.json"), resolve(dist, "manifest.json")),
  cp(resolve(src, "sidepanel/index.html"), resolve(dist, "sidepanel/index.html")),
  cp(resolve(src, "sidepanel/sidepanel.css"), resolve(dist, "sidepanel/sidepanel.css")),
]);

const common = {
  bundle: true,
  target: "chrome138",
  logLevel: "info",
  sourcemap: true,
};

await Promise.all([
  build({
    ...common,
    entryPoints: [resolve(src, "background/service-worker.ts")],
    outfile: resolve(dist, "background/service-worker.js"),
    format: "esm",
  }),
  build({
    ...common,
    entryPoints: [resolve(src, "content/content-script.ts")],
    outfile: resolve(dist, "content/content-script.js"),
    format: "iife",
  }),
  build({
    ...common,
    entryPoints: [resolve(src, "sidepanel/sidepanel.ts")],
    outfile: resolve(dist, "sidepanel/sidepanel.js"),
    format: "esm",
  }),
]);

const manifestPath = resolve(dist, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.version = process.env.BENYI_VERSION ?? manifest.version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
