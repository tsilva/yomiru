import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import browse, { createHandler as createBrowseHandler } from "./api/browse.mjs";
import vocabulary, { createHandler as createVocabularyHandler } from "./api/vocabulary.mjs";

// Match the public Vercel route during local development without credentials.
const browseApi = {
  name: "yomiru-library-api",
  async configureServer(server) {
    let browseHandler = browse, vocabularyHandler = vocabulary;
    // Administrator preview only: validate a complete local candidate, with no upload.
    if (process.env.YOMIRU_LIBRARY_DIR) {
      const directory = path.resolve(process.env.YOMIRU_LIBRARY_DIR);
      const { preparePublication } = await import("./scripts/upload-library.mjs");
      const prepared = await preparePublication(directory);
      const readLibrary = async () => ({ ...prepared, publication: prepared.pointer.sha256 });
      browseHandler = createBrowseHandler({ readLibrary });
      vocabularyHandler = createVocabularyHandler({ readLibrary, fetcher: async url => {
        const pathname = new URL(url).pathname;
        if (!prepared.assets.has(pathname)) return new Response(null, { status: 404 });
        return new Response(await readFile(path.join(directory, path.basename(pathname))));
      } });
    }
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url, "http://localhost");
      const handler = { "/api/browse": browseHandler, "/api/vocabulary": vocabularyHandler }[url.pathname];
      if (!handler) return next();
      request.query = Object.fromEntries([...url.searchParams.keys()].map(key => {
        const values = url.searchParams.getAll(key);
        return [key, values.length > 1 ? values : values[0]];
      }));
      response.status = code => { response.statusCode = code; return response; };
      response.json = body => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(body)); };
      void handler(request, response);
    });
  },
};

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [browseApi, react()],
});
