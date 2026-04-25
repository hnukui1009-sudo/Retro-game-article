#!/usr/bin/env node

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_PORT = 4173;
const HOST = "127.0.0.1";
const port = parsePort(process.env.PORT, DEFAULT_PORT);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

const server = http.createServer(async (request, response) => {
  try {
    const requestedPath = resolveRequestPath(request.url || "/");
    const filePath = path.join(ROOT_DIR, requestedPath);

    if (!filePath.startsWith(ROOT_DIR)) {
      send(response, 403, "text/plain; charset=utf-8", "Forbidden");
      return;
    }

    const content = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";

    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": extension === ".json" ? "no-store" : "no-cache",
    });
    response.end(content);

    console.log(`${request.method} ${requestedPath} -> 200`);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      send(response, 404, "text/plain; charset=utf-8", "Not Found");
      console.log(`${request.method} ${request.url || "/"} -> 404`);
      return;
    }

    console.error(error);
    send(response, 500, "text/plain; charset=utf-8", "Internal Server Error");
  }
});

server.listen(port, HOST, () => {
  console.log(`Preview server running at http://${HOST}:${port}`);
  console.log("Open this URL in IAB or your browser to verify the site.");
});

process.on("SIGINT", () => {
  server.close(() => {
    console.log("\nPreview server stopped.");
    process.exit(0);
  });
});

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

function resolveRequestPath(url) {
  const parsedUrl = new URL(url, `http://${HOST}:${port}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  if (pathname === "/") {
    pathname = "/index.html";
  }

  if (pathname.endsWith("/")) {
    pathname = `${pathname}index.html`;
  }

  return pathname.replace(/^\/+/, "");
}

function send(response, statusCode, contentType, body) {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
}
