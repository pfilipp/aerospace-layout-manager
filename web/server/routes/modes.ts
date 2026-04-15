/**
 * Mode and workspace API routes.
 *
 * Modes:
 *   GET    /api/modes          — list all modes with resolved workspace counts
 *   GET    /api/modes/:mode    — return resolved mode (inheritance merged)
 *   POST   /api/modes          — create new mode
 *   PUT    /api/modes/:mode    — update mode definition
 *   DELETE /api/modes/:mode    — delete mode (409 if dependents exist)
 *
 * Workspaces:
 *   GET    /api/modes/:mode/workspaces        — list resolved workspaces
 *   GET    /api/modes/:mode/workspaces/:ws    — get single resolved workspace
 *   PUT    /api/modes/:mode/workspaces/:ws    — update workspace
 *   DELETE /api/modes/:mode/workspaces/:ws    — remove workspace from mode
 */

import { Router, Request, Response } from "express";
import { readConfig, writeConfig } from "../services/config.js";
import type { Config, Workspace, WorkspaceOverride } from "../types.js";

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a mode's workspaces by merging base + derived overrides.
 *
 * For base modes (inherits: null): returns workspaces as-is.
 * For derived modes:
 *   - Start with all base workspaces
 *   - Apply derived overrides on top (derived takes precedence)
 *   - Derived workspaces with `skip: true` are excluded
 *   - Derived workspaces with no `layout` key inherit layout from base
 *   - Derived workspaces with `layout` key use the derived layout
 */
export function resolveMode(
  config: Config,
  modeName: string
): Record<string, Workspace> | null {
  const mode = config.modes[modeName];
  if (!mode) return null;

  // Base mode — return workspaces directly (cast overrides away since base
  // modes should only have full Workspace entries)
  if (mode.inherits === null) {
    const resolved: Record<string, Workspace> = {};
    for (const [wsName, ws] of Object.entries(mode.workspaces)) {
      const override = ws as WorkspaceOverride;
      if (override.skip) continue;
      const workspace = ws as Workspace;
      resolved[wsName] = {
        ...workspace,
        active: workspace.active ?? true,
      };
    }
    return resolved;
  }

  // Derived mode — merge with base
  const baseMode = config.modes[mode.inherits];
  if (!baseMode) return null;

  // Recursively resolve the base first (handles the case where the base
  // itself might need resolution, though single-level enforcement should
  // prevent deep chains)
  const baseWorkspaces = resolveMode(config, mode.inherits);
  if (!baseWorkspaces) return null;

  // Start with a copy of the resolved base workspaces
  const resolved: Record<string, Workspace> = { ...baseWorkspaces };

  // Apply derived overrides
  for (const [wsName, wsOverride] of Object.entries(mode.workspaces)) {
    const override = wsOverride as WorkspaceOverride;

    // Skip flag — exclude this workspace entirely
    if (override.skip) {
      delete resolved[wsName];
      continue;
    }

    const baseWs = resolved[wsName];

    if (override.layout) {
      // Full layout override — use derived layout, merge metadata
      resolved[wsName] = {
        layout: override.layout,
        project: override.project !== undefined ? override.project : (baseWs?.project ?? null),
        active: override.active !== undefined ? override.active : (baseWs?.active ?? true),
      };
    } else if (baseWs) {
      // Metadata-only override — inherit layout from base
      resolved[wsName] = {
        layout: baseWs.layout,
        project: override.project !== undefined ? override.project : baseWs.project,
        active: override.active !== undefined ? override.active : baseWs.active,
      };
    } else {
      // Override for a workspace that doesn't exist in base — can't resolve
      // without a layout. Skip it (it's incomplete).
    }
  }

  return resolved;
}

/**
 * Validate single-level inheritance constraint.
 * Returns an error message if invalid, or null if OK.
 */
function validateInheritance(
  config: Config,
  modeName: string,
  inheritsTarget: string | null
): string | null {
  if (inheritsTarget === null) return null;

  // Target must exist
  const target = config.modes[inheritsTarget];
  if (!target) {
    return `Inheritance target "${inheritsTarget}" does not exist`;
  }

  // Target must be a base mode (inherits: null)
  if (target.inherits !== null) {
    return `Cannot inherit from "${inheritsTarget}" because it already inherits from "${target.inherits}". Only single-level inheritance is allowed.`;
  }

  // Cycle detection (insurance — single-level enforcement should prevent this)
  if (inheritsTarget === modeName) {
    return `Mode "${modeName}" cannot inherit from itself`;
  }

  return null;
}

/**
 * Find all modes that inherit from the given mode.
 */
function findDependents(config: Config, modeName: string): string[] {
  return Object.entries(config.modes)
    .filter(([, mode]) => mode.inherits === modeName)
    .map(([name]) => name);
}

// ---------------------------------------------------------------------------
// Mode routes
// ---------------------------------------------------------------------------

/**
 * GET /api/modes
 * List all modes with resolved workspace counts.
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const config = await readConfig();
    const modes: Record<
      string,
      { inherits: string | null; workspaceCount: number }
    > = {};

    for (const modeName of Object.keys(config.modes)) {
      const resolved = resolveMode(config, modeName);
      modes[modeName] = {
        inherits: config.modes[modeName].inherits,
        workspaceCount: resolved ? Object.keys(resolved).length : 0,
      };
    }

    res.json(modes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read modes";
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/modes
 * Create a new mode. Body: { name: string, inherits?: string }
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, inherits } = req.body;

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Missing or invalid 'name' field" });
      return;
    }

    const config = await readConfig();

    if (config.modes[name]) {
      res.status(400).json({ error: `Mode "${name}" already exists` });
      return;
    }

    const inheritsValue = inherits ?? null;

    const validationError = validateInheritance(config, name, inheritsValue);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    config.modes[name] = {
      inherits: inheritsValue,
      workspaces: {},
    };

    await writeConfig(config);
    res.status(201).json(config.modes[name]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create mode";
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/modes/:mode
 * Return resolved mode (inheritance merged).
 */
router.get("/:mode", async (req: Request<{ mode: string }>, res: Response) => {
  try {
    const config = await readConfig();
    const modeName = req.params.mode;
    const mode = config.modes[modeName];

    if (!mode) {
      res.status(404).json({ error: `Mode "${modeName}" not found` });
      return;
    }

    const resolved = resolveMode(config, modeName);

    res.json({
      name: modeName,
      inherits: mode.inherits,
      workspaces: resolved ?? {},
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read mode";
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/modes/:mode
 * Update mode definition. Validates single-level inheritance.
 */
router.put("/:mode", async (req: Request<{ mode: string }>, res: Response) => {
  try {
    const config = await readConfig();
    const modeName = req.params.mode;

    if (!config.modes[modeName]) {
      res.status(404).json({ error: `Mode "${modeName}" not found` });
      return;
    }

    const { inherits, workspaces } = req.body;
    const inheritsValue = inherits !== undefined ? inherits : config.modes[modeName].inherits;

    const validationError = validateInheritance(config, modeName, inheritsValue);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    // If changing from base to derived, check no other modes inherit from us
    if (
      config.modes[modeName].inherits === null &&
      inheritsValue !== null
    ) {
      const dependents = findDependents(config, modeName);
      if (dependents.length > 0) {
        res.status(400).json({
          error: `Cannot set inheritance on "${modeName}" because the following modes inherit from it: ${dependents.join(", ")}. A derived mode cannot be an inheritance target.`,
        });
        return;
      }
    }

    config.modes[modeName] = {
      inherits: inheritsValue,
      workspaces: workspaces !== undefined ? workspaces : config.modes[modeName].workspaces,
    };

    await writeConfig(config);
    res.json(config.modes[modeName]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update mode";
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /api/modes/:mode
 * Delete a mode. Returns 409 if other modes inherit from it.
 */
router.delete("/:mode", async (req: Request<{ mode: string }>, res: Response) => {
  try {
    const config = await readConfig();
    const modeName = req.params.mode;

    if (!config.modes[modeName]) {
      res.status(404).json({ error: `Mode "${modeName}" not found` });
      return;
    }

    const dependents = findDependents(config, modeName);
    if (dependents.length > 0) {
      res.status(409).json({
        error: `Cannot delete mode "${modeName}" because the following modes inherit from it: ${dependents.join(", ")}`,
      });
      return;
    }

    delete config.modes[modeName];
    await writeConfig(config);
    res.status(204).send();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete mode";
    res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Workspace routes
// ---------------------------------------------------------------------------

/**
 * GET /api/modes/:mode/workspaces
 * List resolved workspaces for a mode.
 */
router.get("/:mode/workspaces", async (req: Request<{ mode: string }>, res: Response) => {
  try {
    const config = await readConfig();
    const modeName = req.params.mode;

    if (!config.modes[modeName]) {
      res.status(404).json({ error: `Mode "${modeName}" not found` });
      return;
    }

    const resolved = resolveMode(config, modeName);
    res.json(resolved ?? {});
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to read workspaces";
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/modes/:mode/workspaces/:ws
 * Get a single resolved workspace with layout tree.
 */
router.get("/:mode/workspaces/:ws", async (req: Request<{ mode: string; ws: string }>, res: Response) => {
  try {
    const config = await readConfig();
    const { mode: modeName, ws: wsName } = req.params;

    if (!config.modes[modeName]) {
      res.status(404).json({ error: `Mode "${modeName}" not found` });
      return;
    }

    const resolved = resolveMode(config, modeName);
    if (!resolved || !resolved[wsName]) {
      res.status(404).json({
        error: `Workspace "${wsName}" not found in mode "${modeName}"`,
      });
      return;
    }

    res.json({ name: wsName, ...resolved[wsName] });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to read workspace";
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/modes/:mode/workspaces/:ws
 * Update a workspace layout. Body is the workspace object.
 */
router.put("/:mode/workspaces/:ws", async (req: Request<{ mode: string; ws: string }>, res: Response) => {
  try {
    const config = await readConfig();
    const { mode: modeName, ws: wsName } = req.params;

    if (!config.modes[modeName]) {
      res.status(404).json({ error: `Mode "${modeName}" not found` });
      return;
    }

    const body = req.body;

    if (!body || typeof body !== "object") {
      res.status(400).json({ error: "Request body must be a workspace object" });
      return;
    }

    // Store the workspace directly on the mode
    config.modes[modeName].workspaces[wsName] = body;
    await writeConfig(config);

    res.json(config.modes[modeName].workspaces[wsName]);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update workspace";
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /api/modes/:mode/workspaces/:ws
 * Remove a workspace from a mode.
 */
router.delete("/:mode/workspaces/:ws", async (req: Request<{ mode: string; ws: string }>, res: Response) => {
  try {
    const config = await readConfig();
    const { mode: modeName, ws: wsName } = req.params;

    if (!config.modes[modeName]) {
      res.status(404).json({ error: `Mode "${modeName}" not found` });
      return;
    }

    if (!config.modes[modeName].workspaces[wsName]) {
      res.status(404).json({
        error: `Workspace "${wsName}" not found in mode "${modeName}"`,
      });
      return;
    }

    delete config.modes[modeName].workspaces[wsName];
    await writeConfig(config);
    res.status(204).send();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to delete workspace";
    res.status(500).json({ error: message });
  }
});

export default router;
