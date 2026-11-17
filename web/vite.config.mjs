import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import browse from "./api/browse.mjs";

// Match the public Vercel route during local development without credentials.
const browseApi = {
  name: "yomiru-library-api",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname !== "/api/browse") return next();
      request.query = Object.fromEntries([...url.searchParams.keys()].map(key => {
        const values = url.searchParams.getAll(key);
        return [key, values.length > 1 ? values : values[0]];
      }));
      response.status = code => { response.statusCode = code; return response; };
      response.json = body => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(body)); };
      void browse(request, response);
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
