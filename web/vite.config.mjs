import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import path from "node:path";
import browse, { createHandler as createBrowseHandler } from "./api/browse.mjs";
import vocabulary, { createHandler as createVocabularyHandler } from "./api/vocabulary.mjs";
import selection, { createSelectionHandler } from "./api/vocabulary-selection.mjs";
import { createBlobVocabularyReader } from "./lib/episode-vocabulary.mjs";
import { publicCatalogueOrigin, publicVocabularyPreview } from "./scripts/public-vocabulary-preview.mjs";
import { addLocalPracticeExamples } from "./lib/practice-context.mjs";

const usePublicCatalogue = process.env.YOMIRU_PUBLIC_CATALOGUE === "1" && !process.env.YOMIRU_LIBRARY_DIR;

const publicCatalogueProxy = {
  "^/api/(?:browse|vocabulary)(?:\\?|$)": {
    target: publicCatalogueOrigin,
    changeOrigin: true,
    configure(proxy) {
      proxy.on("proxyReq", request => {
        request.removeHeader("cookie");
        request.removeHeader("authorization");
        request.removeHeader("proxy-authorization");
      });
    },
  },
};

// Match the public Vercel route during local development without credentials.
const browseApi = {
  name: "yomiru-library-api",
  async configureServer(server) {
    let browseHandler = usePublicCatalogue ? null : browse;
    let vocabularyHandler = usePublicCatalogue ? null : vocabulary;
    let selectionHandler = usePublicCatalogue ? publicVocabularyPreview : selection;
    const socket = process.env.YOMIRU_PRACTICE_CONTEXT_SOCKET;
    if (socket) {
      const revision = process.env.YOMIRU_PRACTICE_CONTEXT_REVISION;
      if (!usePublicCatalogue || !socket.startsWith("/") || (revision && !/^[0-9a-f]{64}$/.test(revision))) {
        throw new Error("Practice context preview requires the public catalogue and a local database socket");
      }
      const sql = postgres({ host: socket, database: "postgres", max: 1 });
      server.httpServer?.once("close", () => void sql.end());
      selectionHandler = (request, response) => publicVocabularyPreview(request, response,
        (page, selection, cues, roster) => addLocalPracticeExamples(sql, page, selection, revision, cues, roster));
    }
    // Administrator preview only: validate a complete local candidate, with no upload.
    if (process.env.YOMIRU_LIBRARY_DIR) {
      const directory = path.resolve(process.env.YOMIRU_LIBRARY_DIR);
      const { preparePublication } = await import("./scripts/upload-library.mjs");
      const prepared = await preparePublication(directory);
      const readLibrary = async () => ({ ...prepared, publication: prepared.pointer.sha256 });
      const fetcher = async url => {
        const pathname = new URL(url).pathname;
        if (!prepared.assets.has(pathname)) return new Response(null, { status: 404 });
        return new Response(await readFile(path.join(directory, path.basename(pathname))));
      };
      const store = () => null;
      browseHandler = createBrowseHandler({ readLibrary, store });
      vocabularyHandler = createVocabularyHandler({ readLibrary, fetcher, store });
      selectionHandler = createSelectionHandler({ readLibrary, store, readVocabulary: createBlobVocabularyReader(fetcher) });
    }
    server.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url, "http://localhost");
      const handler = {
        "/api/browse": browseHandler, "/api/vocabulary": vocabularyHandler,
        "/api/vocabulary-selection": selectionHandler,
      }[url.pathname];
      if (!handler) return next();
      request.query = Object.fromEntries([...url.searchParams.keys()].map(key => {
        const values = url.searchParams.getAll(key);
        return [key, values.length > 1 ? values : values[0]];
      }));
      response.status = code => { response.statusCode = code; return response; };
      response.json = body => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(body)); };
      if (handler === selectionHandler && request.method === "POST") {
        try {
          const chunks = [];
          let size = 0;
          for await (const chunk of request.iterator({ destroyOnReturn: false })) {
            size += chunk.length;
            if (size > 4 * 1024 * 1024) return response.status(413).end();
            chunks.push(chunk);
          }
          request.body = Buffer.concat(chunks).toString();
        } catch { return response.status(400).end(); }
      }
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
    proxy: usePublicCatalogue ? publicCatalogueProxy : undefined,
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [browseApi, react()],
});
