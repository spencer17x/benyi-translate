import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(root, "tests/fixtures/static-article.html");
const port = Number(process.env.PORT ?? 4173);

const server = createServer(async (request, response) => {
  if (request.url !== "/" && request.url !== "/static-article.html") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const fixture = await readFile(fixturePath);
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(fixture);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Benyi fixture: http://127.0.0.1:${port}/`);
});
