/**
 * Migration API routes.
 *
 * GET  /api/migrate/preview — read-only scan returning migration preview
 * POST /api/migrate         — execute migration
 */

import { Router, Request, Response } from 'express';
import { previewMigration, executeMigration } from '../services/migrate.js';

const router = Router();

/**
 * GET /api/migrate/preview
 * Scan existing layout files and projects.json, return a preview
 * of what migration would import. No files are written.
 */
router.get('/preview', async (_req: Request, res: Response) => {
  try {
    const preview = await previewMigration();
    res.json(preview);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to generate migration preview';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/migrate
 * Execute migration — import existing layout JSONs and projects
 * into config.json. Merges with existing data (does not overwrite).
 */
router.post('/', async (_req: Request, res: Response) => {
  try {
    const result = await executeMigration();
    res.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to execute migration';
    res.status(500).json({ error: message });
  }
});

export default router;
