/**
 * Generation service — produce layout JSON files from config.
 *
 * Provides:
 * - generateAll(config): generate layout JSONs for ALL modes
 * - generateMode(config, modeName): generate for a single mode
 * - generateWorkspace(config, modeName, wsName): generate single workspace
 *
 * Output format matches what aerospace-layout-manager consumes:
 * A JSON array with exactly one workspace object containing a root-container.
 *
 * Window IDs are renumbered with unique sequential integers starting from 1
 * within each workspace file during generation.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  Config,
  ContainerNode,
  LayoutJsonFile,
  TreeNode,
  Workspace,
} from '../types.js';
import { resolveMode } from '../routes/modes.js';

// --- Output paths ---

const LAYOUTS_DIR = path.join(os.homedir(), '.config', 'aerospace', 'layouts');

/**
 * Determine the output directory for a given mode's layout JSONs.
 * - "dual" mode: ~/.config/aerospace/layouts/ (top-level)
 * - "avp" mode: ~/.config/aerospace/layouts/avp/
 * - Other modes: ~/.config/aerospace/layouts/<mode>/
 */
function getLayoutDir(modeName: string): string {
  if (modeName === 'dual') {
    return LAYOUTS_DIR;
  }
  return path.join(LAYOUTS_DIR, modeName);
}

/**
 * Get the full output path for a workspace layout JSON file.
 */
function getLayoutPath(modeName: string, wsName: string): string {
  return path.join(getLayoutDir(modeName), `${wsName}.json`);
}

// --- Window ID renumbering ---

/**
 * Renumber all window-id fields in a tree with unique sequential integers
 * starting from a given counter. Returns the next available counter value.
 */
function renumberWindowIds(node: TreeNode, counter: { value: number }): void {
  if (node.type === 'window') {
    node['window-id'] = counter.value;
    counter.value += 1;
    return;
  }
  // Container — recurse into children
  for (const child of node.children) {
    renumberWindowIds(child, counter);
  }
}

// --- Deep clone a container node ---

function deepCloneContainer(container: ContainerNode): ContainerNode {
  const cloned = JSON.parse(JSON.stringify(container));
  // Strip runtime _nodeId fields that shouldn't appear in generated output
  function stripNodeIds(node: Record<string, unknown>): void {
    delete node['_nodeId'];
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        stripNodeIds(child as Record<string, unknown>);
      }
    }
  }
  stripNodeIds(cloned);
  return cloned;
}

// --- Build layout JSON output ---

/**
 * Build the layout JSON output for a single workspace.
 * Returns the JSON array format that aerospace-layout-manager expects.
 * Window IDs are renumbered starting from 1.
 */
function buildLayoutJson(wsName: string, workspace: Workspace): LayoutJsonFile {
  // Deep clone the layout tree so we don't mutate the original config
  const layoutClone = deepCloneContainer(workspace.layout);

  // Renumber window IDs starting from 1
  const counter = { value: 1 };
  renumberWindowIds(layoutClone, counter);

  return [
    {
      name: wsName,
      type: 'workspace',
      'root-container': layoutClone,
    },
  ];
}

// --- File writing ---

/**
 * Write a layout JSON file to disk, creating directories as needed.
 */
async function writeLayoutFile(
  filePath: string,
  layoutJson: LayoutJsonFile
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(layoutJson, null, 2) + '\n', 'utf-8');
}

// --- Generation result ---

export interface GenerationResult {
  generatedFiles: string[];
  skippedWorkspaces: string[];
}

// --- Public API ---

/**
 * Generate layout JSONs for ALL modes in the config.
 * Skips workspaces with active: false.
 * Returns list of generated file paths and skipped workspaces.
 */
export async function generateAll(config: Config): Promise<GenerationResult> {
  const result: GenerationResult = {
    generatedFiles: [],
    skippedWorkspaces: [],
  };

  for (const modeName of Object.keys(config.modes)) {
    const modeResult = await generateModeLayouts(config, modeName);
    result.generatedFiles.push(...modeResult.generatedFiles);
    result.skippedWorkspaces.push(...modeResult.skippedWorkspaces);
  }

  return result;
}

/**
 * Generate layout JSONs for a single mode.
 * Resolves mode inheritance, skips inactive workspaces.
 */
export async function generateMode(
  config: Config,
  modeName: string
): Promise<GenerationResult> {
  return generateModeLayouts(config, modeName);
}

/**
 * Generate a single workspace layout JSON.
 * Returns the generated file path or throws if workspace not found.
 */
export async function generateWorkspace(
  config: Config,
  modeName: string,
  wsName: string
): Promise<GenerationResult> {
  const resolved = resolveMode(config, modeName);
  if (!resolved) {
    throw new Error(`Mode "${modeName}" not found or cannot be resolved`);
  }

  const workspace = resolved[wsName];
  if (!workspace) {
    throw new Error(
      `Workspace "${wsName}" not found in resolved mode "${modeName}"`
    );
  }

  const result: GenerationResult = {
    generatedFiles: [],
    skippedWorkspaces: [],
  };

  if (workspace.active === false) {
    result.skippedWorkspaces.push(`${modeName}/${wsName}`);
    return result;
  }

  const layoutJson = buildLayoutJson(wsName, workspace);
  const filePath = getLayoutPath(modeName, wsName);
  await writeLayoutFile(filePath, layoutJson);
  result.generatedFiles.push(filePath);

  return result;
}

// --- Internal helpers ---

/**
 * Generate layout JSONs for all workspaces in a single mode.
 */
async function generateModeLayouts(
  config: Config,
  modeName: string
): Promise<GenerationResult> {
  const resolved = resolveMode(config, modeName);
  if (!resolved) {
    throw new Error(`Mode "${modeName}" not found or cannot be resolved`);
  }

  const result: GenerationResult = {
    generatedFiles: [],
    skippedWorkspaces: [],
  };

  for (const [wsName, workspace] of Object.entries(resolved)) {
    if (workspace.active === false) {
      result.skippedWorkspaces.push(`${modeName}/${wsName}`);
      continue;
    }

    const layoutJson = buildLayoutJson(wsName, workspace);
    const filePath = getLayoutPath(modeName, wsName);
    await writeLayoutFile(filePath, layoutJson);
    result.generatedFiles.push(filePath);
  }

  return result;
}
