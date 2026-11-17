import { createServer as createNetServer } from "node:net";
import { createServer } from "vite";

const args = process.argv.slice(2);
const portFlag = args.indexOf("--port");
const requestedPort = portFlag === -1 ? "auto" : args[portFlag + 1];
const hostFlag = args.indexOf("--host");
const host = hostFlag === -1 ? "127.0.0.1" : args[hostFlag + 1];

async function unusedPort() {
  const probe = createNetServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, host, resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

const port = requestedPort === "auto" ? await unusedPort() : Number(requestedPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Use --port auto or an unused port between 1 and 65535.");
}

const server = await createServer({ server: { host, port, strictPort: true } });
await server.listen();
server.printUrls();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
