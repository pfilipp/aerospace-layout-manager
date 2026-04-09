import { Router, Request, Response } from "express";
import { readConfig, writeConfig } from "../services/config.js";
import type {
  Config,
  Project,
  TreeNode,
  WindowNode,
  Workspace,
  WorkspaceOverride,
} from "../types.js";

const router = Router();

// --- Helper: recursive tree walker ---

/**
 * Walk a layout tree recursively, collecting window nodes whose
 * app-bundle-id is in the given set of bundle IDs.
 */
function findWindowsByBundleId(
  node: TreeNode,
  bundleIds: Set<string>
): WindowNode[] {
  if (node.type === "window") {
    if (bundleIds.has(node["app-bundle-id"])) {
      return [node];
    }
    return [];
  }
  // Container node — recurse into children
  const results: WindowNode[] = [];
  for (const child of node.children) {
    results.push(...findWindowsByBundleId(child, bundleIds));
  }
  return results;
}

/**
 * Walk a layout tree recursively, replacing startup commands for windows
 * whose app-bundle-id matches. Returns the mutated tree (in-place mutation).
 */
function applyStartupToTree(
  node: TreeNode,
  bundleIds: Set<string>,
  startupMap: Map<string, string>
): void {
  if (node.type === "window") {
    if (bundleIds.has(node["app-bundle-id"])) {
      const newStartup = startupMap.get(node["app-bundle-id"]);
      if (newStartup !== undefined) {
        node.startup = newStartup;
      }
    }
    return;
  }
  // Container node
  for (const child of node.children) {
    applyStartupToTree(child, bundleIds, startupMap);
  }
}

/**
 * Substitute project template variables in a startup command string.
 * Handles edge case: if PROJECT_SUBDIR is empty, ${PROJECT_DIR}/${PROJECT_SUBDIR}
 * should produce just ${PROJECT_DIR} without trailing slash.
 */
function substituteProjectVars(
  template: string,
  project: Project
): string {
  let result = template;

  // Handle the compound pattern first: ${PROJECT_DIR}/${PROJECT_SUBDIR}
  // When subdir is empty, collapse to just the dir (no trailing slash)
  if (!project.subdir) {
    result = result.replace(
      /\$\{PROJECT_DIR\}\/\$\{PROJECT_SUBDIR\}/g,
      "${PROJECT_DIR}"
    );
  }

  result = result.replace(/\$\{PROJECT_DIR\}/g, project.dir);
  result = result.replace(/\$\{PROJECT_SUBDIR\}/g, project.subdir);
  result = result.replace(/\$\{PROJECT_NAME\}/g, project.name);
  result = result.replace(/\$\{PROJECT_ITERM_CMD\}/g, project.iterm_cmd);
  result = result.replace(/\$\{PROJECT_XCODEPROJ\}/g, project.xcodeproj);

  return result;
}

/**
 * Resolve a workspace from a mode, handling inheritance from a base mode.
 * Returns the resolved workspace or null if not found.
 */
function resolveWorkspace(
  config: Config,
  modeName: string,
  wsName: string
): Workspace | null {
  const mode = config.modes[modeName];
  if (!mode) return null;

  const wsEntry = mode.workspaces[wsName];

  if (mode.inherits === null) {
    // Base mode — workspace must exist directly
    if (!wsEntry) return null;
    // Check it's a full workspace (has layout)
    const ws = wsEntry as Workspace;
    if (!ws.layout) return null;
    return ws;
  }

  // Derived mode — resolve inheritance
  const baseMode = config.modes[mode.inherits];
  if (!baseMode) return null;

  if (wsEntry) {
    const override = wsEntry as WorkspaceOverride;
    // Skip flag
    if (override.skip) return null;

    if (override.layout) {
      // Full override
      return {
        layout: override.layout,
        project: override.project ?? null,
        active: override.active ?? true,
      };
    }

    // Metadata-only override — inherit layout from base
    const baseWs = baseMode.workspaces[wsName] as Workspace | undefined;
    if (!baseWs || !baseWs.layout) return null;
    return {
      layout: baseWs.layout,
      project: override.project !== undefined ? override.project : baseWs.project,
      active: override.active !== undefined ? override.active : baseWs.active,
    };
  }

  // Not in derived mode — inherit from base
  const baseWs = baseMode.workspaces[wsName] as Workspace | undefined;
  if (!baseWs || !baseWs.layout) return null;
  return {
    layout: baseWs.layout,
    project: baseWs.project,
    active: baseWs.active,
  };
}

// --- Project CRUD routes ---

/**
 * GET /api/projects
 * List all project presets from config.
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const config = await readConfig();
    res.json(config.projects ?? {});
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read projects";
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/projects/:name
 * Create or update a project preset (idempotent upsert).
 * Body must include: name, dir, apps. Optional: subdir, iterm_cmd, xcodeproj.
 * Name in URL must match name in body.
 */
router.put("/:name", async (req: Request<{ name: string }>, res: Response) => {
  try {
    const { name: urlName } = req.params;
    const body = req.body;

    // Validate required fields
    if (!body.name || typeof body.name !== "string") {
      res.status(400).json({ error: "Missing required field: name" });
      return;
    }
    if (!body.dir || typeof body.dir !== "string") {
      res.status(400).json({ error: "Missing required field: dir" });
      return;
    }
    if (!Array.isArray(body.apps)) {
      res.status(400).json({ error: "Missing required field: apps (must be an array)" });
      return;
    }

    // Name in URL must match name in body
    if (urlName !== body.name) {
      res.status(400).json({
        error: `URL name "${urlName}" does not match body name "${body.name}"`,
      });
      return;
    }

    const config = await readConfig();

    const project: Project = {
      name: body.name,
      dir: body.dir,
      subdir: body.subdir ?? "",
      iterm_cmd: body.iterm_cmd ?? "",
      xcodeproj: body.xcodeproj ?? "",
      apps: body.apps,
    };

    config.projects[urlName] = project;
    await writeConfig(config);

    res.json(project);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save project";
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /api/projects/:name
 * Delete a project preset. Returns 404 if not found.
 */
router.delete("/:name", async (req: Request<{ name: string }>, res: Response) => {
  try {
    const { name } = req.params;
    const config = await readConfig();

    if (!config.projects[name]) {
      res.status(404).json({ error: `Project "${name}" not found` });
      return;
    }

    delete config.projects[name];
    await writeConfig(config);

    res.json({ deleted: name });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete project";
    res.status(500).json({ error: message });
  }
});

export default router;

// --- Apply project endpoint ---
// This is exported separately because it mounts under /api/modes/:mode/workspaces/:ws/
// and must be wired in index.ts at that path.

export const applyProjectRouter = Router({ mergeParams: true });

/**
 * POST /api/modes/:mode/workspaces/:ws/apply-project
 * Apply a project preset to a workspace.
 * Body: { project: "<name>" }
 * Query: ?confirm=true to apply changes, otherwise returns preview only.
 */
applyProjectRouter.post("/apply-project", async (req: Request<{ mode: string; ws: string }>, res: Response) => {
  try {
    const { mode: modeName, ws: wsName } = req.params;
    const { project: projectName } = req.body;

    if (!projectName || typeof projectName !== "string") {
      res.status(400).json({ error: "Missing required field: project" });
      return;
    }

    const config = await readConfig();

    // Look up the project
    const project = config.projects[projectName];
    if (!project) {
      res.status(404).json({ error: `Project "${projectName}" not found` });
      return;
    }

    // Look up the mode
    const mode = config.modes[modeName];
    if (!mode) {
      res.status(404).json({ error: `Mode "${modeName}" not found` });
      return;
    }

    // Resolve workspace (handles inheritance)
    const workspace = resolveWorkspace(config, modeName, wsName);
    if (!workspace) {
      res.status(404).json({ error: `Workspace "${wsName}" not found in mode "${modeName}"` });
      return;
    }

    // Find matching windows
    const bundleIds = new Set(project.apps);
    const matchingWindows = findWindowsByBundleId(workspace.layout, bundleIds);

    // Build preview: for each matching window, compute old and new startup commands
    const changes = matchingWindows.map((win) => {
      const appEntry = config.apps[win["app-bundle-id"]];
      const template = appEntry?.defaultStartup ?? win.startup;
      const newStartup = substituteProjectVars(template, project);

      // Flag incomplete if xcodeproj is empty and the command references it
      const incomplete =
        !project.xcodeproj && newStartup.includes("${PROJECT_XCODEPROJ}");

      return {
        "app-bundle-id": win["app-bundle-id"],
        "app-name": win["app-name"],
        "window-id": win["window-id"],
        oldStartup: win.startup,
        newStartup,
        incomplete,
      };
    });

    // If not confirming, return preview only
    const confirm = req.query.confirm === "true";
    if (!confirm) {
      res.json({
        preview: true,
        project: projectName,
        workspace: wsName,
        mode: modeName,
        changes,
      });
      return;
    }

    // Apply changes: build a map of bundle-id -> new startup command
    const startupMap = new Map<string, string>();
    for (const change of changes) {
      startupMap.set(change["app-bundle-id"], change.newStartup);
    }

    // We need to mutate the actual config workspace, not the resolved copy.
    // For base modes, mutate directly. For derived modes, we need to ensure
    // the workspace exists as an override with a layout.
    const actualMode = config.modes[modeName];

    // Determine which workspace entry to mutate
    let targetWs: Workspace;

    if (actualMode.inherits === null) {
      // Base mode — mutate directly
      targetWs = actualMode.workspaces[wsName] as Workspace;
    } else {
      // Derived mode — ensure we have a full workspace override
      const existingOverride = actualMode.workspaces[wsName] as WorkspaceOverride | undefined;
      if (existingOverride?.layout) {
        targetWs = existingOverride as Workspace;
      } else {
        // Promote inherited workspace to a full override
        targetWs = {
          layout: JSON.parse(JSON.stringify(workspace.layout)),
          project: workspace.project,
          active: workspace.active,
        };
        actualMode.workspaces[wsName] = targetWs;
      }
    }

    // Apply startup commands to the layout tree
    applyStartupToTree(targetWs.layout, bundleIds, startupMap);

    // Store project reference on the workspace
    targetWs.project = projectName;

    await writeConfig(config);

    res.json({
      applied: true,
      project: projectName,
      workspace: wsName,
      mode: modeName,
      changes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to apply project";
    res.status(500).json({ error: message });
  }
});
