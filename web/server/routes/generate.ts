/**
 * Generation API routes.
 *
 *   POST /api/generate            — generate all modes
 *   POST /api/generate/:mode      — generate for one mode
 *   POST /api/generate/:mode/:ws  — generate single workspace
 *                                   (+ regenerate mode startup script — T7)
 *
 * After successful generation, updates lastGeneratedAt in config.json.
 */

import { Router, Request, Response } from 'express';
import { readConfig, writeConfig } from '../services/config.js';
import {
  generateAll,
  generateMode,
  generateWorkspace,
} from '../services/generate.js';
import {
  generateAllStartupScripts,
  generateStartupScript,
} from '../services/startup.js';

const router = Router();

/**
 * POST /api/generate
 * Generate layout JSONs for all modes.
 * Returns list of generated files and skipped workspaces.
 */
router.post('/', async (_req: Request, res: Response) => {
  try {
    const config = await readConfig();
    const result = await generateAll(config);
    const startupResults = await generateAllStartupScripts(config);

    // Update lastGeneratedAt timestamp
    config.lastGeneratedAt = new Date().toISOString();
    await writeConfig(config);

    res.json({
      success: true,
      lastGeneratedAt: config.lastGeneratedAt,
      ...result,
      startupScripts: startupResults.map((s) => s.scriptPath),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to generate layouts';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/generate/:mode
 * Generate layout JSONs for a single mode.
 */
router.post('/:mode', async (req: Request<{ mode: string }>, res: Response) => {
  try {
    const { mode: modeName } = req.params;
    const config = await readConfig();

    if (!config.modes[modeName]) {
      res.status(404).json({ error: `Mode "${modeName}" not found` });
      return;
    }

    const result = await generateMode(config, modeName);
    const startupResult = await generateStartupScript(config, modeName);

    // Update lastGeneratedAt timestamp
    config.lastGeneratedAt = new Date().toISOString();
    await writeConfig(config);

    res.json({
      success: true,
      mode: modeName,
      lastGeneratedAt: config.lastGeneratedAt,
      ...result,
      startupScript: startupResult.scriptPath,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to generate mode layouts';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/generate/:mode/:ws
 * Generate a single workspace layout JSON.
 * Also regenerates the mode's startup script to keep active-workspace list consistent.
 */
router.post(
  '/:mode/:ws',
  async (req: Request<{ mode: string; ws: string }>, res: Response) => {
    try {
      const { mode: modeName, ws: wsName } = req.params;
      const config = await readConfig();

      if (!config.modes[modeName]) {
        res.status(404).json({ error: `Mode "${modeName}" not found` });
        return;
      }

      const result = await generateWorkspace(config, modeName, wsName);
      const startupResult = await generateStartupScript(config, modeName);

      // Update lastGeneratedAt timestamp
      config.lastGeneratedAt = new Date().toISOString();
      await writeConfig(config);

      res.json({
        success: true,
        mode: modeName,
        workspace: wsName,
        lastGeneratedAt: config.lastGeneratedAt,
        ...result,
        startupScript: startupResult.scriptPath,
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to generate workspace layout';
      res.status(500).json({ error: message });
    }
  }
);

export default router;
