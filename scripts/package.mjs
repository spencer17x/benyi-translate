import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { zipSync } from "fflate";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const output = resolve(root, "release");

const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
const archiveName = `benyi-translate-v${manifest.version}.zip`;
const archivePath = resolve(output, archiveName);
const checksumPath = `${archivePath}.sha256`;

const files = {};
await collectFiles(dist);

const archive = zipSync(files, { level: 9 });
const checksum = createHash("sha256").update(archive).digest("hex");

await mkdir(output, { recursive: true });
await Promise.all([
  rm(archivePath, { force: true }),
  rm(checksumPath, { force: true }),
]);
await Promise.all([
  writeFile(archivePath, archive),
  writeFile(checksumPath, `${checksum}  ${archiveName}\n`),
]);

console.log(`Created ${relative(root, archivePath)}`);
console.log(`SHA-256 ${checksum}`);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(path);
      continue;
    }
    if (entry.name === ".DS_Store" || entry.name.endsWith(".map")) continue;

    const name = relative(dist, path).split(sep).join("/");
    files[name] = new Uint8Array(await readFile(path));
  }
}
