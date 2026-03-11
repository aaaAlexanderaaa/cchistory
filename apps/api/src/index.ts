import { createApiRuntime } from "./app.js";

const port = Number(process.env.PORT ?? "4040");
const { app } = await createApiRuntime();

await app.listen({ port, host: "0.0.0.0" });
