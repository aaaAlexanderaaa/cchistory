import { createApiRuntime } from "./app.js";

const rawPort = Number(process.env.PORT ?? "8040");
if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
  console.error(`Invalid port: ${process.env.PORT ?? "(not set)"}. Must be an integer between 1 and 65535.`);
  process.exit(1);
}
const port = rawPort;
const host = process.env.HOST ?? "127.0.0.1";
const { app, storage } = await createApiRuntime();

function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}. Shutting down...`);
  app.close().then(
    () => {
      storage.close();
      process.exit(0);
    },
    (error) => {
      console.error("Error during shutdown:", error);
      storage.close();
      process.exit(1);
    },
  );
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

await app.listen({ port, host });
console.log(`CCHistory API listening on ${host}:${port}`);
