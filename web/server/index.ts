import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { csrfProtection } from "./middleware/csrf.js";
import { ensureConfig, readConfig, writeConfig } from "./services/config.js";
import modesRouter from "./routes/modes.js";
import projectsRouter, { applyProjectRouter } from "./routes/projects.js";
import appsRouter from "./routes/apps.js";
import generateRouter from "./routes/generate.js";
import migrateRouter from "./routes/migrate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3847;

app.use(express.json());
app.use(csrfProtection);

// Health endpoint
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Config endpoints
app.get("/api/config", async (_req, res) => {
  try {
    const config = await readConfig();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read config" });
  }
});
app.put("/api/config", async (req, res) => {
  try {
    await writeConfig(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to write config" });
  }
});

// API routes
app.use("/api/modes", modesRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/modes/:mode/workspaces/:ws", applyProjectRouter);
app.use("/api/apps", appsRouter);
app.use("/api/generate", generateRouter);
app.use("/api/migrate", migrateRouter);

// In production, serve built frontend
const clientDistPath = path.resolve(__dirname, "../dist/client");

if (process.env.NODE_ENV === "production") {
  app.use(express.static(clientDistPath));

  // SPA fallback — serve index.html for non-API routes
  app.get("*", (req, res) => {
    if (!req.path.startsWith("/api")) {
      res.sendFile(path.join(clientDistPath, "index.html"));
    }
  });
} else {
  // In dev mode, Vite dev server handles frontend via proxy.
  // Express only serves /api/* routes.
  app.get("/", (_req, res) => {
    res.json({
      message: "API server running. Frontend served by Vite dev server.",
      health: "GET /api/health",
    });
  });
}

// Only start the server when run directly (not when imported by tests)
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith("/server/index.ts") ||
  process.argv[1].endsWith("/server/index.js")
);

if (isMainModule) {
  ensureConfig().then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  }).catch((err) => {
    console.error("Failed to initialize config:", err);
    process.exit(1);
  });
}

export default app;
