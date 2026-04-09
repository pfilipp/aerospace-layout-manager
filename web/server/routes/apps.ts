import { Router, Request, Response } from "express";
import { readConfig } from "../services/config.js";
import { discoverApps } from "../services/discover.js";

const router = Router();

/**
 * GET /api/apps
 * Return the apps object from config.json.
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const config = await readConfig();
    res.json(config.apps ?? {});
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read apps";
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/apps/discover
 * Execute aerospace list-windows --all, merge results into config, return updated apps.
 * Returns HTTP 503 if aerospace is not running.
 */
router.post("/discover", async (_req: Request, res: Response) => {
  try {
    const apps = await discoverApps();
    res.json(apps);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Discovery failed";

    if (message.includes("AeroSpace must be running")) {
      res.status(503).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

export default router;
